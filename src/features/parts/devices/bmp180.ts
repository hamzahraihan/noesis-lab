/**
 * BMP180 barometric pressure sensor: the I2C breakout that reports pressure
 * and temperature as raw counts and leaves the arithmetic to the caller.
 *
 * The model speaks the register protocol rather than offering a "what is the
 * pressure" call, because the protocol is the whole exercise. A sketch starts
 * a measurement by writing the control register, reads the raw counts out of
 * the data registers, reads the eleven calibration coefficients out of the
 * chip's E2PROM, and applies the compensation the datasheet prints. Point it
 * at the wrong register and it gets a plausible-looking wrong answer, which is
 * exactly what a real chip does.
 *
 * The chip on the bench carries a calibration of its own, as every BMP180
 * does: the eleven coefficients live in its E2PROM and a sketch reads them
 * over the bus rather than assuming them. They are stated here so that the
 * compensation in a sketch can be checked, and they are chosen so that the
 * datasheet's compensation covers the chip's whole range -- -39 to +74 degrees
 * Celsius, and 300 to 1100 hPa. Every one of them fits in a signed sixteen-bit
 * word, so a sketch can read the E2PROM as one signed word per coefficient and
 * be right about all eleven.
 *
 * The raw counts are the chip's answer to a question about the air, so the
 * model answers them the way the silicon does: the compensation is run
 * backwards, by bisection, to find the counts that would compensate to the
 * pressure and temperature the operator has dialled in. A sketch that applies
 * the datasheet's compensation therefore reads back what the operator set,
 * which is the only way the two halves of the exercise can be checked.
 */
import { type KnobSpec } from '../catalog';
import { type I2cDevice } from './device';

/** The address the module silkscreens, and the only one the chip answers to. */
export const BMP180_ADDRESS = 0x77;

/** The pressure of the air the chip is sitting in, in hectopascals. */
export const BMP180_PRESSURE_KNOB: KnobSpec = {
  id: 'pressure',
  label: 'Pressure',
  min: 300,
  max: 1100,
  step: 1,
  unit: 'hPa',
  defaultValue: 1013,
};

/** The temperature of that air, in degrees Celsius. */
export const BMP180_TEMPERATURE_KNOB: KnobSpec = {
  id: 'temperature',
  label: 'Temperature',
  min: -30,
  max: 70,
  step: 0.5,
  unit: '°C',
  defaultValue: 20,
};

/** The identification register: it reads 0x55 for as long as the chip lives. */
const CHIP_ID = 0xd0;
/** The control register: writing to it starts a measurement. */
const CONTROL = 0xf4;
/** The soft-reset register: writing 0xB6 puts the chip back to power-up. */
const SOFT_RESET = 0xe0;
/** The data registers, MSB first, with the pressure's third byte on top. */
const DATA_MSB = 0xf6;
const DATA_LSB = 0xf7;
const DATA_XLSB = 0xf8;
/** The E2PROM: eleven calibration words, from AC1 to MD. */
const CALIBRATION = 0xaa;
const CALIBRATION_BYTES = 22;

/** Writing this to the control register starts a temperature measurement. */
const TEMPERATURE_COMMAND = 0x2e;
/** Writing this to the control register starts a pressure measurement. */
const PRESSURE_COMMAND = 0x34;
/** Where the oversampling bits sit above the pressure command. */
const OVERSAMPLING_SHIFT = 6;

/**
 * The eleven coefficients in the chip's E2PROM, in the order the datasheet
 * lists them: AC1 to AC6, B1, B2, MB, MC and MD.
 *
 * The values are the bench's chip's own -- every BMP180 carries its own -- and
 * they are chosen so that the compensation below spans the chip's range
 * rather than a corner of it. AC3 and B1 are the ones the pressure's
 * compensation leans on, and the rest follow the datasheet's own signs.
 */
export const BMP180_CALIBRATION = {
  ac1: 408,
  ac2: -300,
  ac3: -400,
  ac4: 32741,
  ac5: 6400,
  ac6: 1004,
  b1: -6190,
  b2: 4,
  mb: -32768,
  mc: -5361,
  md: 2000,
} as const;

/**
 * The datasheet's temperature compensation, in the chip's own arithmetic: the
 * raw count in, tenths of a degree out.
 *
 * The division truncates towards zero and the shifts floor, which is what the
 * chip's C does and what a sketch written against the datasheet gets.
 */
export function compensateTemperature(ut: number): number {
  const cal = BMP180_CALIBRATION;
  const x1 = ((ut - cal.ac6) * cal.ac5) >> 15;
  const x2 = Math.trunc((cal.mc << 11) / (x1 + cal.md));
  return (x1 + x2 + 8) >> 4;
}

/**
 * The datasheet's pressure compensation: the raw count and the raw
 * temperature in, pascals out.
 *
 * `oss` is the oversampling the sketch asked for, which scales the count as
 * well as the conversion time -- the same count means a different pressure at
 * a different oversampling, which is why the model recomputes the answer
 * whenever the control register changes.
 */
export function compensatePressure(up: number, ut: number, oss: number): number {
  const cal = BMP180_CALIBRATION;
  const x1 = ((ut - cal.ac6) * cal.ac5) >> 15;
  const x2 = Math.trunc((cal.mc << 11) / (x1 + cal.md));
  const b6 = x1 + x2 - 4000;

  const bx1 = (cal.b2 * ((b6 * b6) >> 12)) >> 11;
  const bx2 = (cal.ac2 * b6) >> 11;
  const b3 = (((cal.ac1 * 4 + bx1 + bx2) << oss) + 2) >> 2;
  const by1 = (cal.ac3 * b6) >> 13;
  const by2 = (cal.b1 * ((b6 * b6) >> 12)) >> 16;
  const b4 = (cal.ac4 * (((by1 + by2 + 2) >> 2) + 32768)) >> 15;

  const b7 = (up - b3) * (50000 >> oss);
  let p = b7 < 0x80000000 ? Math.trunc((b7 * 2) / b4) : Math.trunc((b7 / b4) * 2);
  const px1 = ((p >> 8) * (p >> 8) * 3038) >> 16;
  const px2 = (-7357 * p) >> 16;
  p += (px1 + px2 + 3791) >> 4;
  return p;
}

/** The raw count that compensates to `tenths`, found by bisection. */
function rawTemperatureFor(tenths: number): number {
  let low = 0;
  let high = 0xffff;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (compensateTemperature(middle) < tenths) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * The raw count that compensates to `pascals`, found by bisection.
 *
 * The count is only meaningful against the oversampling it was measured at,
 * so the search runs over the range that oversampling can express.
 */
function rawPressureFor(pascals: number, ut: number, oss: number): number {
  let low = 0;
  let high = (1 << (16 + oss)) - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (compensatePressure(middle, ut, oss) < pascals) low = middle + 1;
    else high = middle;
  }
  return low;
}

export class Bmp180 implements I2cDevice {
  readonly address = BMP180_ADDRESS;
  onBus = false;

  /** The pressure of the air, in pascals, as the operator has dialled it. */
  private pascals = 101_325;
  /** The temperature of that air, in degrees Celsius. */
  private celsius = 20;

  /** The oversampling the sketch last asked for. */
  private oss = 0;
  /** The raw counts the chip's converter is holding. */
  private rawTemperature = 0;
  private rawPressure = 0;
  /** Which measurement the data registers are holding. */
  private holding: 'temperature' | 'pressure' = 'temperature';
  /** Where the next written byte lands, and where the next read starts. */
  private pointer = DATA_MSB;
  /** Whether the counts still match the air the operator has described. */
  private stale = true;
  /**
   * Where the air is.
   *
   * The chip reads the world when it computes rather than being told about it,
   * so a knob turned between two reads is seen by the very next one -- in the
   * page and in the worker alike, which is where a pushed value would have
   * gone stale.
   */
  private world: (() => { readonly pascals: number; readonly celsius: number }) | null = null;

  /**
   * Points the chip at the air the bench is in.
   *
   * The raw counts are recomputed from it, because the counts are what the
   * converter would report for that air -- not a number the operator typed
   * into the chip.
   */
  setConditionsSource(read: () => { readonly pascals: number; readonly celsius: number }): void {
    this.world = read;
    this.stale = true;
  }

  /** The air the chip is sitting in, as the world describes it. */
  private conditions(): void {
    if (this.world === null) return;
    const conditions = this.world();
    if (conditions.pascals === this.pascals && conditions.celsius === this.celsius) return;
    this.pascals = conditions.pascals;
    this.celsius = conditions.celsius;
    this.stale = true;
  }

  /** Current temperature in milli-Celsius (for differential harness). */
  getTemperatureMilliC(): number {
    return Math.round(this.celsius * 1000);
  }

  /** Current pressure in Pascals (for differential harness). */
  getPressurePa(): number {
    return Math.round(this.pascals);
  }

  /**
   * Recomputes the counts the converter holds.
   *
   * The temperature is found first, because the pressure's compensation needs
   * it: a sketch reads the temperature, then starts the pressure, and the
   * pressure's answer is the one the temperature makes sense against.
   */
  private recompute(): void {
    this.rawTemperature = rawTemperatureFor(Math.round(this.celsius * 10));
    this.rawPressure = rawPressureFor(this.pascals, this.rawTemperature, this.oss);
    this.stale = false;
  }

  receive(byte: number, isControlPosition: boolean): boolean {
    if (isControlPosition) {
      // The register address is eight bits wide, and the chip keeps it: a
      // read after a write starts where the write left off.
      this.pointer = byte & 0xff;
      return true;
    }
    this.write(this.pointer, byte);
    this.pointer = (this.pointer + 1) & 0xff;
    return true;
  }

  read(count: number): readonly number[] {
    this.conditions();
    if (this.stale) this.recompute();
    const out: number[] = [];
    for (let index = 0; index < count; index++) {
      out.push(this.register(this.pointer + index));
    }
    return out;
  }

  /** The byte at a register address, zero for the addresses that hold none. */
  private register(address: number): number {
    if (address === CHIP_ID) return 0x55;
    if (address >= CALIBRATION && address < CALIBRATION + CALIBRATION_BYTES) {
      return this.calibrationByte(address - CALIBRATION);
    }
    if (address === DATA_MSB || address === DATA_LSB || address === DATA_XLSB) {
      return this.dataByte(address);
    }
    return 0;
  }

  /**
   * The calibration words, big-endian, in the datasheet's order.
   *
   * Every word is stored as the two's complement of its own value, so the
   * bytes a sketch reads are the same whether it reads the E2PROM as signed
   * or unsigned: the coefficients that are negative say so in their top bit,
   * and the ones that are not do not.
   */
  private calibrationByte(index: number): number {
    const cal = BMP180_CALIBRATION;
    const words = [
      cal.ac1,
      cal.ac2,
      cal.ac3,
      cal.ac4,
      cal.ac5,
      cal.ac6,
      cal.b1,
      cal.b2,
      cal.mb,
      cal.mc,
      cal.md,
    ];
    const word = words[index >> 1] & 0xffff;
    return index % 2 === 0 ? (word >> 8) & 0xff : word & 0xff;
  }

  /**
   * The data registers, which hold whichever measurement was started last.
   *
   * The pressure is a count of up to twenty bits left-aligned across the
   * three bytes, so the third byte carries the low bits and its bottom bits
   * are padding. How many bits it has depends on the oversampling: the higher
   * the oversampling, the finer the count.
   */
  private dataByte(address: number): number {
    if (this.holding === 'temperature') {
      if (address === DATA_MSB) return (this.rawTemperature >> 8) & 0xff;
      if (address === DATA_LSB) return this.rawTemperature & 0xff;
      return 0;
    }
    const raw = this.rawPressure << (8 - this.oss);
    if (address === DATA_MSB) return (raw >> 16) & 0xff;
    if (address === DATA_LSB) return (raw >> 8) & 0xff;
    return raw & 0xff;
  }

  /**
   * Handles a written byte.
   *
   * Only the control register and the soft reset take writes: the data
   * registers and the E2PROM are read-only, and a write to them changes
   * nothing, which is what the chip does.
   */
  private write(address: number, value: number): void {
    if (address === CONTROL) {
      this.startMeasurement(value);
      return;
    }
    if (address === SOFT_RESET && value === 0xb6) {
      this.oss = 0;
      this.holding = 'temperature';
      this.pointer = DATA_MSB;
      this.stale = true;
    }
  }

  /**
   * Starts the measurement the control register asks for.
   *
   * The command's low bits say which measurement to make and the bits above
   * them say how many samples to fold into the pressure. The temperature
   * command has no oversampling of its own.
   */
  private startMeasurement(command: number): void {
    if (command === TEMPERATURE_COMMAND) {
      this.holding = 'temperature';
      this.stale = true;
      return;
    }
    if ((command & 0x1f) !== (PRESSURE_COMMAND & 0x1f)) return;
    this.oss = (command >> OVERSAMPLING_SHIFT) & 0x03;
    this.holding = 'pressure';
    this.stale = true;
  }
}
