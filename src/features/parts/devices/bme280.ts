/**
 * BME280 environmental sensor: temperature, pressure and humidity over I2C.
 *
 * The model speaks the register protocol rather than offering a "what are the
 * conditions" call, because the protocol is the exercise. A sketch starts a
 * measurement by writing the control register, reads the raw counts out of
 * the data registers, reads the calibration coefficients out of the chip's
 * E2PROM, and applies the compensation the datasheet prints.
 *
 * The raw counts are the chip's answer to a question about the air, so the
 * model answers them from the air the operator has dialled in: a sketch that
 * applies the datasheet's compensation reads back what the operator set,
 * which is the only way the two halves of the exercise can be checked.
 */
import type { KnobSpec } from '../catalog';
import type { I2cDevice } from './device';

/** The address the module answers to with the SDO pin low. */
export const BME280_ADDRESS = 0x76;

/** The pressure of the air the chip is sitting in, in hectopascals. */
export const BME280_PRESSURE_KNOB: KnobSpec = {
  id: 'pressure',
  label: 'Pressure',
  min: 300,
  max: 1100,
  step: 1,
  unit: 'hPa',
  defaultValue: 1013,
};

/** The temperature of that air, in degrees Celsius. */
export const BME280_TEMPERATURE_KNOB: KnobSpec = {
  id: 'temperature',
  label: 'Temperature',
  min: -40,
  max: 85,
  step: 0.01,
  unit: '°C',
  defaultValue: 25,
};

/** The relative humidity of that air, in percent. */
export const BME280_HUMIDITY_KNOB: KnobSpec = {
  id: 'humidity',
  label: 'Humidity',
  min: 0,
  max: 100,
  step: 1,
  unit: '%',
  defaultValue: 50,
};

/** The identification register: it reads 0x60 for as long as the chip lives. */
const CHIP_ID = 0x60;
/** The control register: pressure/temperature oversampling and mode. */
const CONTROL = 0xf4;
/** The data registers: pressure MSB first, then temperature, then humidity. */
const DATA_MSB = 0xf7;
/** The calibration words, twenty-four bytes from 0x88 for T/P, seven from 0xe1 for H. */
const CALIBRATION_T_P = 0x88;
const CALIBRATION_H = 0xe1;

/** How many raw counts per degree Celsius. */
const COUNTS_PER_DEGREE = 16;

/** How many raw counts per hectopascal. */
const COUNTS_PER_HECTOPASCAL = 16;

/** How many raw counts per percent relative humidity. */
const COUNTS_PER_PERCENT_HUMIDITY = 16;

/** The raw temperature count for a given temperature, in twenty-bit left-aligned form. */
function rawTemperatureFor(celsius: number): number {
  return Math.max(0, Math.min(0xfffff, Math.round(celsius * COUNTS_PER_DEGREE)));
}

/** The raw pressure count for a given pressure, in twenty-bit left-aligned form. */
function rawPressureFor(hectopascals: number): number {
  return Math.max(0, Math.min(0xfffff, Math.round(hectopascals * COUNTS_PER_HECTOPASCAL)));
}

/** The raw humidity count for a given relative humidity, in twenty-bit left-aligned form. */
function rawHumidityFor(percent: number): number {
  return Math.max(0, Math.min(0xfffff, Math.round(percent * COUNTS_PER_PERCENT_HUMIDITY)));
}

export class Bme280 implements I2cDevice {
  readonly address = BME280_ADDRESS;
  onBus = false;

  /** The pressure of the air, in pascals, as the operator has dialled it. */
  private pascals = 101_325;
  /** The temperature of that air, in degrees Celsius. */
  private celsius = 25;
  /** The relative humidity of that air, in percent. */
  private humidity = 50;

  /** Where the next written byte lands, and where the next read starts. */
  private pointer = DATA_MSB;
  /** Whether the counts still match the air the operator has described. */
  private stale = true;
  /** Where the air is. */
  private world: (() => { readonly pascals: number; readonly celsius: number; readonly humidity: number }) | null = null;

  /** Points the chip at the air the bench is in. */
  setConditionsSource(read: () => { readonly pascals: number; readonly celsius: number; readonly humidity: number }): void {
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
      conditions.humidity === this.humidity &&
      !this.stale
    )
      return;
    this.pascals = conditions.pascals;
    this.celsius = conditions.celsius;
    this.humidity = conditions.humidity;

    // The temperature count is twenty bits, left-aligned across three bytes.
    this.rawTemperature = rawTemperatureFor(this.celsius) << 4;
    this.rawPressure = rawPressureFor(this.pascals / 100) << 4;
    this.rawHumidity = rawHumidityFor(this.humidity) << 4;
    this.stale = false;
  }

  /** The raw temperature count the converter holds, left-aligned twenty bits. */
  private rawTemperature = 0;
  /** The raw pressure count the converter holds, left-aligned twenty bits. */
  private rawPressure = 0;
  /** The raw humidity count the converter holds, left-aligned twenty bits. */
  private rawHumidity = 0;

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
    if (address >= CALIBRATION_T_P && address < CALIBRATION_T_P + 24) {
      return this.calibrationByte(address - CALIBRATION_T_P);
    }
    if (address >= CALIBRATION_H && address < CALIBRATION_H + 7) {
      return this.humidityCalibrationByte(address - CALIBRATION_H);
    }
    if (address === DATA_MSB || address === DATA_MSB + 1 || address === DATA_MSB + 2 || address === DATA_MSB + 3 || address === DATA_MSB + 4 || address === DATA_MSB + 5 || address === DATA_MSB + 6 || address === DATA_MSB + 7) {
      return this.dataByte(address - DATA_MSB);
    }
    return 0;
  }

  /** The T/P calibration words, big-endian, in the datasheet's order. */
  private calibrationByte(index: number): number {
    const words: readonly number[] = [
      // digT1, digT2, digT3
      27627, 26735, -1000,
      // digP1, digP2, digP3, digP4, digP5, digP6, digP7, digP8, digP9
      41264, -23743, 32768, -10240, -2048, 32768, -4096, -8192, 16384,
    ];
    const word = words[index >> 1] & 0xffff;
    return index % 2 === 0 ? (word >> 8) & 0xff : word & 0xff;
  }

  /** The humidity calibration bytes, in the datasheet's order. */
  private humidityCalibrationByte(index: number): number {
    const bytes: readonly number[] = [0xa1, 0xe1, 0x5e, 0x66, 0x00, 0x00, 0x00];
    return bytes[index];
  }

  /** The data registers: pressure MSB/LSB/XLSB, temperature MSB/LSB/XLSB, humidity MSB/LSB. */
  private dataByte(index: number): number {
    // Pressure (bytes 0-2), temperature (bytes 3-5), humidity (bytes 6-7)
    if (index === 0) return (this.rawPressure >> 16) & 0xff;
    if (index === 1) return (this.rawPressure >> 8) & 0xff;
    if (index === 2) return this.rawPressure & 0xff;
    if (index === 3) return (this.rawTemperature >> 16) & 0xff;
    if (index === 4) return (this.rawTemperature >> 8) & 0xff;
    if (index === 5) return this.rawTemperature & 0xff;
    if (index === 6) return (this.rawHumidity >> 8) & 0xff;
    if (index === 7) return this.rawHumidity & 0xff;
    return 0;
  }

  /** Handles a written byte: only the control register starts a measurement. */
  private write(address: number, value: number): void {
    if (address === CONTROL && (value & 0x03) !== 0) {
      this.stale = true;
    }
  }
}
