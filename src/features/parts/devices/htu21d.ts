/**
 * HTU21D temperature and humidity sensor: a digital sensor on the I2C bus.
 *
 * The model speaks the register protocol rather than offering readings,
 * because the protocol is the exercise. A sketch sends a command byte
 * (0xF3 for temperature, 0xF5 for humidity) and reads three bytes: MSB,
 * LSB, and CRC-8. Temperature converts as T = -46.85 + 175.72 * raw / 65536;
 * humidity as RH = -6 + 125 * raw / 65536.
 *
 * The two readings are the operator's knobs, read when the chip reports
 * rather than pushed in on a tick: a knob turned between two reads is seen
 * by the very next one.
 */
import type { KnobSpec } from '../catalog';
import type { I2cDevice } from './device';

/** The address the module silkscreens, and the only one the chip answers to. */
export const HTU21D_ADDRESS = 0x40;

/** The temperature of the air the chip is sitting in, in degrees Celsius. */
export const HTU21D_TEMPERATURE_KNOB: KnobSpec = {
  id: 'temperature',
  label: 'Temperature',
  min: -10,
  max: 85,
  step: 0.1,
  unit: '°C',
  defaultValue: 21,
};

/** The relative humidity of that air, as a percentage. */
export const HTU21D_HUMIDITY_KNOB: KnobSpec = {
  id: 'humidity',
  label: 'Humidity',
  min: 0,
  max: 100,
  step: 1,
  unit: '%',
  defaultValue: 45,
};

/** The commands the chip implements, all one byte wide. */
const MEASURE_TEMPERATURE = 0xf3;
const MEASURE_HUMIDITY = 0xf5;
const RESET = 0xfe;

/** CRC-8: polynomial 0x31, initial value 0x00. */
function crc8(bytes: readonly number[]): number {
  let crc = 0x00;
  for (const byte of bytes) {
    crc ^= byte & 0xff;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x80 ? ((crc << 1) ^ 0x31) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc;
}

export class Htu21d implements I2cDevice {
  readonly address = HTU21D_ADDRESS;
  onBus = false;

  /** Where the next read starts. */
  private pointer = MEASURE_TEMPERATURE;
  /** The temperature the chip reports when the operator has not dialled one. */
  private celsius = 21;
  private humidity = 45;
  /**
   * Where the readings are.
   *
   * The chip reads the world when a sketch asks for it, so a knob turned
   * between two reads is seen by the very next one.
   */
  private world: (() => { readonly celsius: number; readonly humidity: number }) | null = null;

  /** Points the sensor at the air the bench is in. */
  setConditionsSource(read: () => { readonly celsius: number; readonly humidity: number }): void {
    this.world = read;
  }

  receive(byte: number, isControlPosition: boolean): boolean {
    if (isControlPosition) {
      this.pointer = byte & 0xff;
      return true;
    }
    // Data writes are acknowledged and discarded.
    return true;
  }

  read(count: number): readonly number[] {
    const n = Math.max(0, count);
    const air = this.world?.() ?? { celsius: this.celsius, humidity: this.humidity };
    this.celsius = air.celsius;
    this.humidity = air.humidity;

    if (this.pointer === MEASURE_TEMPERATURE) {
      const raw = Math.min(0xffff, Math.max(0, Math.round(((this.celsius + 46.85) * 65536) / 175.72)));
      const bytes = [(raw >> 8) & 0xff, raw & 0xff, crc8([(raw >> 8) & 0xff, raw & 0xff])];
      return Array.from({ length: n }, (_, i) => (i < bytes.length ? bytes[i]! : 0));
    }
    if (this.pointer === MEASURE_HUMIDITY) {
      const raw = Math.min(0xffff, Math.max(0, Math.round(((this.humidity + 6) * 65536) / 125)));
      const bytes = [(raw >> 8) & 0xff, raw & 0xff, crc8([(raw >> 8) & 0xff, raw & 0xff])];
      return Array.from({ length: n }, (_, i) => (i < bytes.length ? bytes[i]! : 0));
    }
    if (this.pointer === RESET) {
      // Reset acknowledged.
      return [];
    }
    return Array.from({ length: n }, () => 0);
  }
}
