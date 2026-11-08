/**
 * BME680 gas sensor: temperature, pressure, humidity and gas resistance over I2C.
 *
 * The model speaks the register protocol rather than offering a "what are the
 * conditions" call, because the protocol is the exercise. A sketch starts a
 * measurement by writing the control register, reads the raw counts out of
 * the data registers, and converts them with the datasheet formula.
 *
 * The raw counts are the chip's answer to a question about the air, so the
 * model answers them from the air the operator has dialled in: a sketch that
 * applies the datasheet's conversion reads back what the operator set,
 * which is the only way the two halves of the exercise can be checked.
 */
import type { KnobSpec } from '../catalog';
import type { I2cDevice } from './device';

/** The address the module answers to with the SDO pin low. */
export const BME680_ADDRESS = 0x76;

/** The pressure of the air the chip is sitting in, in hectopascals. */
export const BME680_PRESSURE_KNOB: KnobSpec = {
  id: 'pressure',
  label: 'Pressure',
  min: 300,
  max: 1100,
  step: 1,
  unit: 'hPa',
  defaultValue: 1013,
};

/** The temperature of that air, in degrees Celsius. */
export const BME680_TEMPERATURE_KNOB: KnobSpec = {
  id: 'temperature',
  label: 'Temperature',
  min: -40,
  max: 85,
  step: 0.01,
  unit: '°C',
  defaultValue: 25,
};

/** The relative humidity of that air, in percent. */
export const BME680_HUMIDITY_KNOB: KnobSpec = {
  id: 'humidity',
  label: 'Humidity',
  min: 0,
  max: 100,
  step: 1,
  unit: '%',
  defaultValue: 50,
};

/** The gas resistance of that air, in ohms. */
export const BME680_GAS_KNOB: KnobSpec = {
  id: 'gas',
  label: 'Gas resistance',
  min: 1000,
  max: 500000,
  step: 1000,
  unit: 'Ω',
  defaultValue: 20000,
};

/** The identification register: it reads 0x61 for as long as the chip lives. */
const CHIP_ID = 0x61;
/** The data registers: pressure, temperature, humidity and gas. */
const DATA_MSB = 0xf7;

/** How many raw counts per hectopascal. */
const COUNTS_PER_HECTOPASCAL = 16;

/** How many raw counts per degree Celsius. */
const COUNTS_PER_DEGREE = 16;

/** How many raw counts per percent relative humidity. */
const COUNTS_PER_PERCENT_HUMIDITY = 16;

/** The raw pressure count for a given pressure. */
function rawPressureFor(hectopascals: number): number {
  const clamped = Math.max(300, Math.min(1100, hectopascals));
  return Math.max(0, Math.min(0xffff, Math.round(clamped * COUNTS_PER_HECTOPASCAL)));
}

/** The raw temperature count for a given temperature. */
function rawTemperatureFor(celsius: number): number {
  const clamped = Math.max(-40, Math.min(85, celsius));
  return Math.max(0, Math.min(0xffff, Math.round(clamped * COUNTS_PER_DEGREE)));
}

/** The raw humidity count for a given relative humidity. */
function rawHumidityFor(percent: number): number {
  const clamped = Math.max(0, Math.min(100, percent));
  return Math.max(0, Math.min(0xffff, Math.round(clamped * COUNTS_PER_PERCENT_HUMIDITY)));
}

/** The raw gas count for a given gas resistance. */
function rawGasFor(ohms: number): number {
  const clamped = Math.max(1000, Math.min(500000, ohms));
  return Math.max(0, Math.min(0xffff, Math.round(clamped / 10)));
}

export class Bme680 implements I2cDevice {
  readonly address = BME680_ADDRESS;
  onBus = false;

  /** The pressure of the air, in pascals, as the operator has dialled it. */
  private pascals = 101_325;
  /** The temperature of that air, in degrees Celsius. */
  private celsius = 25;
  /** The relative humidity of that air, in percent. */
  private humidity = 50;
  /** The gas resistance of that air, in ohms. */
  private gas = 20000;

  /** Where the next written byte lands, and where the next read starts. */
  private pointer = DATA_MSB;
  /** Whether the counts still match the air the operator has described. */
  private stale = true;
  /** Where the air is. */
  private world: (() => { readonly pascals: number; readonly celsius: number; readonly humidity: number; readonly gas: number }) | null = null;

  /** The raw pressure count the converter holds. */
  private rawPressure = 0;
  /** The raw temperature count the converter holds. */
  private rawTemperature = 0;
  /** The raw humidity count the converter holds. */
  private rawHumidity = 0;
  /** The raw gas count the converter holds. */
  private rawGas = 0;

  /** Points the chip at the air the bench is in. */
  setConditionsSource(read: () => { readonly pascals: number; readonly celsius: number; readonly humidity: number; readonly gas: number }): void {
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
      conditions.gas === this.gas &&
      !this.stale
    )
      return;
    this.pascals = conditions.pascals;
    this.celsius = conditions.celsius;
    this.humidity = conditions.humidity;
    this.gas = conditions.gas;

    this.rawPressure = rawPressureFor(this.pascals / 100);
    this.rawTemperature = rawTemperatureFor(this.celsius);
    this.rawHumidity = rawHumidityFor(this.humidity);
    this.rawGas = rawGasFor(this.gas);
    this.stale = false;
  }

  receive(byte: number, isControlPosition: boolean): boolean {
    if (isControlPosition) {
      this.pointer = byte & 0xff;
      return true;
    }
    /*
     * Writing to the control register begins a measurement; anything else is
     * acknowledged and discarded, which is what the chip does.
     */
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
    if (address === DATA_MSB || address === DATA_MSB + 1) {
      return this.wordByte(this.rawPressure, address - DATA_MSB);
    }
    if (address === DATA_MSB + 2 || address === DATA_MSB + 3) {
      return this.wordByte(this.rawTemperature, address - DATA_MSB - 2);
    }
    if (address === DATA_MSB + 4 || address === DATA_MSB + 5) {
      return this.wordByte(this.rawHumidity, address - DATA_MSB - 4);
    }
    if (address === DATA_MSB + 6 || address === DATA_MSB + 7) {
      return this.wordByte(this.rawGas, address - DATA_MSB - 6);
    }
    return 0;
  }

  /** One byte of a sixteen-bit word, most significant first. */
  private wordByte(word: number, index: number): number {
    return index === 0 ? (word >> 8) & 0xff : word & 0xff;
  }
}
