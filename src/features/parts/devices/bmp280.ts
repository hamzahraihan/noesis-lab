/**
 * BMP280 barometric pressure sensor: the I2C breakout that reports pressure
 * and temperature as raw counts, with the compensation arithmetic left to the
 * sketch.
 *
 * The model speaks the register protocol rather than offering a "what is the
 * pressure" call, because the protocol is the exercise. A sketch starts a
 * measurement by writing the control register, reads the raw counts out of
 * the data registers, reads the calibration coefficients out of the chip's
 * E2PROM, and applies the compensation the datasheet prints. Point it at the
 * wrong register and it gets a plausible-looking wrong answer, which is
 * exactly what a real chip does.
 *
 * The raw counts are the chip's answer to a question about the air, so the
 * model answers them from the air the operator has dialled in: a sketch that
 * applies the datasheet's compensation reads back what the operator set,
 * which is the only way the two halves of the exercise can be checked.
 */
import type { KnobSpec } from '../catalog';
import type { I2cDevice } from './device';

/** The address the module answers to with the SDO pin low. */
export const BMP280_ADDRESS = 0x76;

/** The pressure of the air the chip is sitting in, in hectopascals. */
export const BMP280_PRESSURE_KNOB: KnobSpec = {
  id: 'pressure',
  label: 'Pressure',
  min: 300,
  max: 1100,
  step: 1,
  unit: 'hPa',
  defaultValue: 1013,
};

/** The temperature of that air, in degrees Celsius. */
export const BMP280_TEMPERATURE_KNOB: KnobSpec = {
  id: 'temperature',
  label: 'Temperature',
  min: -40,
  max: 85,
  step: 0.01,
  unit: '°C',
  defaultValue: 25,
};

/** The identification register: it reads 0x58 for as long as the chip lives. */
const CHIP_ID = 0x58;
/** The control register: oversampling, mode and the measurement that starts. */
const CONTROL = 0xf4;
const DATA_MSB = 0xf7;
const CALIBRATION = 0x88;

/** The twelve calibration coefficients the chip carries in its E2PROM. */
export const BMP280_CALIBRATION = {
  /** Temperature compensation, unsigned. */
  digT1: 27627,
  /** Temperature compensation, signed. */
  digT2: 26735,
  /** Temperature compensation, signed. */
  digT3: -1000,
  /** Pressure compensation, unsigned. */
  digP1: 41264,
  /** Pressure compensation, signed. */
  digP2: -23743,
  /** Pressure compensation, signed. */
  digP3: 32768,
  /** Pressure compensation, signed. */
  digP4: -10240,
  /** Pressure compensation, signed. */
  digP5: -2048,
  /** Pressure compensation, signed. */
  digP6: 32768,
  /** Pressure compensation, signed. */
  digP7: -4096,
  /** Pressure compensation, signed. */
  digP8: -8192,
  /** Pressure compensation, signed. */
  digP9: 16384,
} as const;

/**
 * How many raw counts per degree Celsius. The BMP280's temperature word is
 * twenty bits, so a scale of 16 counts per degree keeps the whole range in
 * range with room to spare.
 */
const COUNTS_PER_DEGREE = 16;

/** How many raw counts per hectopascal. */
const COUNTS_PER_HECTOPASCAL = 16;

/**
 * The datasheet's temperature compensation: raw count in, hundredths of a
 * degree out. The divisions truncate towards zero, matching the chip's C.
 */
export function bmp280CompensateTemperature(raw: number): number {
  const cal = BMP280_CALIBRATION;
  const var1 = (((raw >> 3) - (cal.digT1 << 1)) * cal.digT2) / 2048;
  const var2 =
    (((((raw >> 4) - cal.digT1) * ((raw >> 4) - cal.digT1)) / 4096) * cal.digT3) / 16384;
  const tFine = var1 + var2;
  return (tFine * 5) / 512;
}

/**
 * The datasheet's pressure compensation: raw count and t_fine in, hectopascals
 * out. The divisions truncate towards zero, matching the chip's C.
 */
export function bmp280CompensatePressure(raw: number, tFine: number): number {
  const cal = BMP280_CALIBRATION;
  let var1 = tFine / 2 - 64000;
  let var2 =
    var1 * var1 * cal.digP6 / 8192 + var1 * cal.digP5 * 2;
  var2 = var2 / 4 + cal.digP4 * 65536;
  var1 =
    (cal.digP3 * var1 * var1 / 32768 + cal.digP2 * var1) / 256 + 32768;
  var1 = (32768 + var1) * cal.digP1 / 32768;
  if (var1 === 0) return 0;
  let pressure = 1048576 - raw;
  pressure = ((pressure - var2 / 4096) * 3125) / var1;
  const var1p = (cal.digP9 * pressure * pressure) / 2147483648;
  const var2p = (pressure * cal.digP8) / 524288;
  pressure = (pressure + var1p + var2p + cal.digP7 * 16) / 100;
  return pressure;
}

/** The raw temperature count for a given temperature, in twenty-bit left-aligned form. */
function rawTemperatureFor(celsius: number): number {
  return Math.max(0, Math.min(0xfffff, Math.round(celsius * COUNTS_PER_DEGREE)));
}

/** The raw pressure count for a given pressure, in twenty-bit left-aligned form. */
function rawPressureFor(hectopascals: number): number {
  return Math.max(0, Math.min(0xfffff, Math.round(hectopascals * COUNTS_PER_HECTOPASCAL)));
}

export class Bmp280 implements I2cDevice {
  readonly address = BMP280_ADDRESS;
  onBus = false;

  /** The pressure of the air, in pascals, as the operator has dialled it. */
  private pascals = 101_325;
  /** The temperature of that air, in degrees Celsius. */
  private celsius = 25;

  /** The raw counts the chip's converter is holding. */
  private rawTemperature = 0;
  private rawPressure = 0;
  /** Where the next written byte lands, and where the next read starts. */
  private pointer = DATA_MSB;
  /** Whether the counts still match the air the operator has described. */
  private stale = true;
  /** Where the air is. */
  private world: (() => { readonly pascals: number; readonly celsius: number }) | null = null;

  /** Points the chip at the air the bench is in. */
  setConditionsSource(read: () => { readonly pascals: number; readonly celsius: number }): void {
    this.world = read;
    this.stale = true;
  }

  /** Recomputes the counts the converter holds from the air conditions. */
  private recompute(): void {
    if (this.world === null) return;
    const conditions = this.world();
    if (
      conditions.pascals === this.pascals &&
      conditions.celsius === this.celsius &&
      !this.stale
    )
      return;
    this.pascals = conditions.pascals;
    this.celsius = conditions.celsius;

    // The temperature count is twenty bits, left-aligned across three bytes.
    this.rawTemperature = rawTemperatureFor(this.celsius) << 4;
    this.rawPressure = rawPressureFor(this.pascals / 100) << 4;
    this.stale = false;
  }

  receive(byte: number, isControlPosition: boolean): boolean {
    if (isControlPosition) {
      this.pointer = byte & 0xff;
      return true;
    }
    this.write(this.pointer, byte);
    this.pointer = (this.pointer + 1) & 0xff;
    return true;
  }

  read(count: number): readonly number[] {
    this.recompute();
    const out: number[] = [];
    for (let index = 0; index < count; index++) {
      out.push(this.register(this.pointer + index));
    }
    return out;
  }

  /** The byte at a register address, zero for the addresses that hold none. */
  private register(address: number): number {
    if (address === 0xd0) return CHIP_ID;
    if (address >= CALIBRATION && address < CALIBRATION + 24) {
      return this.calibrationByte(address - CALIBRATION);
    }
    if (address === DATA_MSB || address === DATA_MSB + 1 || address === DATA_MSB + 2) {
      return this.dataByte(address - DATA_MSB);
    }
    return 0;
  }

  /** The calibration words, big-endian, in the datasheet's order. */
  private calibrationByte(index: number): number {
    const cal = BMP280_CALIBRATION;
    const words: readonly number[] = [
      cal.digT1, cal.digT2, cal.digT3,
      cal.digP1, cal.digP2, cal.digP3, cal.digP4, cal.digP5, cal.digP6,
      cal.digP7, cal.digP8, cal.digP9,
    ];
    const word = words[index >> 1] & 0xffff;
    return index % 2 === 0 ? (word >> 8) & 0xff : word & 0xff;
  }

  /** The data registers: pressure MSB, LSB, XLSB then temperature MSB, LSB, XLSB. */
  private dataByte(index: number): number {
    if (index === 0) return (this.rawPressure >> 16) & 0xff;
    if (index === 1) return (this.rawPressure >> 8) & 0xff;
    if (index === 2) return this.rawPressure & 0xff;
    if (index === 3) return (this.rawTemperature >> 16) & 0xff;
    if (index === 4) return (this.rawTemperature >> 8) & 0xff;
    return this.rawTemperature & 0xff;
  }

  /** Handles a written byte: only the control register starts a measurement. */
  private write(address: number, value: number): void {
    if (address === CONTROL && (value & 0x03) !== 0) {
      this.stale = true;
    }
  }
}
