/**
 * SCD40 CO2 sensor: carbon dioxide, temperature and humidity over I2C.
 *
 * The model speaks the command protocol rather than offering a "what are the
 * conditions" call, because the protocol is the exercise. A sketch starts
 * periodic measurement, reads the nine-byte frame, and converts the three
 * sixteen-bit words with the datasheet formula.
 *
 * The raw counts are the chip's answer to a question about the air, so the
 * model answers them from the air the operator has dialled in: a sketch that
 * applies the datasheet's conversion reads back what the operator set,
 * which is the only way the two halves of the exercise can be checked.
 */
import type { KnobSpec } from '../catalog';
import type { I2cDevice } from './device';

/** The address the module answers to with the SDO pin low. */
export const SCD40_ADDRESS = 0x62;

/** The carbon dioxide concentration of the air, in parts per million. */
export const SCD40_CO2_KNOB: KnobSpec = {
  id: 'co2',
  label: 'CO2',
  min: 400,
  max: 5000,
  step: 1,
  unit: 'ppm',
  defaultValue: 800,
};

/** The temperature of that air, in degrees Celsius. */
export const SCD40_TEMPERATURE_KNOB: KnobSpec = {
  id: 'temperature',
  label: 'Temperature',
  min: -10,
  max: 60,
  step: 0.01,
  unit: '°C',
  defaultValue: 25,
};

/** The relative humidity of that air, in percent. */
export const SCD40_HUMIDITY_KNOB: KnobSpec = {
  id: 'humidity',
  label: 'Humidity',
  min: 0,
  max: 100,
  step: 1,
  unit: '%',
  defaultValue: 50,
};

/** The periodic-read command the sketch writes. */
const READ_COMMAND = 0xe0;

/** The AHT20-style data start: the answer is read from here. */
const DATA_MSB = 0xe0;

/** How many raw counts per ppm of CO2. */
const COUNTS_PER_PPM = 16;

/** How many raw counts per degree Celsius. */
const COUNTS_PER_DEGREE = 16;

/** How many raw counts per percent relative humidity. */
const COUNTS_PER_PERCENT_HUMIDITY = 16;

/** The CRC-8 polynomial the SCD4x uses, with initial value 0xFF. */
const CRC_POLYNOMIAL = 0x31;

/** Computes the CRC-8 check byte for two data bytes, datasheet-style. */
function crc8(high: number, low: number): number {
  let crc = 0xff;
  for (const value of [high, low]) {
    crc = crc ^ value;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 0x80) !== 0 ? (((crc << 1) ^ CRC_POLYNOMIAL) & 0xff) : ((crc << 1) & 0xff);
    }
  }
  return crc;
}

/** The raw CO2 count for a given concentration. */
function rawCo2For(ppm: number): number {
  const clamped = Math.max(400, Math.min(5000, Math.round(ppm)));
  return Math.max(0, Math.min(0xffff, clamped * COUNTS_PER_PPM));
}

/** The raw temperature count for a given temperature. */
function rawTemperatureFor(celsius: number): number {
  const clamped = Math.max(-10, Math.min(60, celsius));
  return Math.max(0, Math.min(0xffff, Math.round(clamped * COUNTS_PER_DEGREE)));
}

/** The raw humidity count for a given relative humidity. */
function rawHumidityFor(percent: number): number {
  const clamped = Math.max(0, Math.min(100, percent));
  return Math.max(0, Math.min(0xffff, Math.round(clamped * COUNTS_PER_PERCENT_HUMIDITY)));
}

export class Scd40 implements I2cDevice {
  readonly address = SCD40_ADDRESS;
  onBus = false;

  /** The carbon dioxide concentration, in parts per million. */
  private co2 = 800;
  /** The temperature of that air, in degrees Celsius. */
  private celsius = 25;
  /** The relative humidity of that air, in percent. */
  private humidity = 50;

  /** Where the next written byte lands, and where the next read starts. */
  private pointer = DATA_MSB;
  /** Whether the counts still match the air the operator has described. */
  private stale = true;
  /** Where the air is. */
  private world: (() => { readonly co2: number; readonly celsius: number; readonly humidity: number }) | null = null;

  /** The raw CO2 count the converter holds. */
  private rawCo2 = 0;
  /** The raw temperature count the converter holds. */
  private rawTemperature = 0;
  /** The raw humidity count the converter holds. */
  private rawHumidity = 0;

  /** Points the chip at the air the bench is in. */
  setConditionsSource(read: () => { readonly co2: number; readonly celsius: number; readonly humidity: number }): void {
    this.world = read;
    this.stale = true;
  }

  /** Recomputes the counts the converter holds from the air conditions. */
  private recompute(): void {
    if (this.world === null) return;
    const conditions = this.world();
    if (conditions.co2 === this.co2 && conditions.celsius === this.celsius && conditions.humidity === this.humidity && !this.stale) {
      return;
    }
    this.co2 = conditions.co2;
    this.celsius = conditions.celsius;
    this.humidity = conditions.humidity;

    this.rawCo2 = rawCo2For(this.co2);
    this.rawTemperature = rawTemperatureFor(this.celsius);
    this.rawHumidity = rawHumidityFor(this.humidity);
    this.stale = false;
  }

  receive(byte: number, isControlPosition: boolean): boolean {
    if (isControlPosition) {
      this.pointer = byte & 0xff;
      return true;
    }
    /*
     * Writing to the periodic-read register is acknowledged; anything else is
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
    if (address === READ_COMMAND || address === READ_COMMAND + 1 || address === READ_COMMAND + 2) {
      return this.co2Byte(address - READ_COMMAND);
    }
    if (address === READ_COMMAND + 3 || address === READ_COMMAND + 4 || address === READ_COMMAND + 5) {
      return this.temperatureByte(address - READ_COMMAND - 3);
    }
    if (address === READ_COMMAND + 6 || address === READ_COMMAND + 7 || address === READ_COMMAND + 8) {
      return this.humidityByte(address - READ_COMMAND - 6);
    }
    return 0;
  }

  /** The CO2 word with its CRC byte. */
  private co2Byte(index: number): number {
    if (index === 0) return (this.rawCo2 >> 8) & 0xff;
    if (index === 1) return this.rawCo2 & 0xff;
    return crc8((this.rawCo2 >> 8) & 0xff, this.rawCo2 & 0xff);
  }

  /** The temperature word with its CRC byte. */
  private temperatureByte(index: number): number {
    if (index === 0) return (this.rawTemperature >> 8) & 0xff;
    if (index === 1) return this.rawTemperature & 0xff;
    return crc8((this.rawTemperature >> 8) & 0xff, this.rawTemperature & 0xff);
  }

  /** The humidity word with its CRC byte. */
  private humidityByte(index: number): number {
    if (index === 0) return (this.rawHumidity >> 8) & 0xff;
    if (index === 1) return this.rawHumidity & 0xff;
    return crc8((this.rawHumidity >> 8) & 0xff, this.rawHumidity & 0xff);
  }
}
