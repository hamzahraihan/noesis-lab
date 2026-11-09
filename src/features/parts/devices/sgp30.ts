/**
 * SGP30 air quality sensor: an eCO2 and TVOC sensor on the I2C bus.
 *
 * The model speaks the command protocol rather than offering readings,
 * because the protocol is the exercise. A sketch sends the init command
 * (0x2003), then the measure command (0x2008), and reads six bytes:
 * eCO2 MSB, eCO2 LSB, CRC, TVOC MSB, TVOC LSB, CRC.
 *
 * The two readings are the operator's knobs, read when the chip reports
 * rather than pushed in on a tick: a knob turned between two reads is seen
 * by the very next one.
 */
import type { KnobSpec } from '../catalog';
import type { I2cDevice } from './device';

/** The address the module silkscreens, and the only one the chip answers to. */
export const SGP30_ADDRESS = 0x58;

/** The equivalent CO2 concentration, in parts per million. */
export const SGP30_ECO2_KNOB: KnobSpec = {
  id: 'eco2',
  label: 'eCO2',
  min: 400,
  max: 60000,
  step: 1,
  unit: 'ppm',
  defaultValue: 400,
};

/** The total volatile organic compounds, in parts per billion. */
export const SGP30_TVOC_KNOB: KnobSpec = {
  id: 'tvoc',
  label: 'TVOC',
  min: 0,
  max: 60000,
  step: 1,
  unit: 'ppb',
  defaultValue: 0,
};

/** The commands the chip implements. */
const INIT_AIR_QUALITY = 0x2003;
const MEASURE_AIR_QUALITY = 0x2008;

/** CRC-8: polynomial 0x31, initial value 0xFF. */
function crc8(bytes: readonly number[]): number {
  let crc = 0xff;
  for (const byte of bytes) {
    crc ^= byte & 0xff;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x80 ? ((crc << 1) ^ 0x31) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc;
}

export class Sgp30 implements I2cDevice {
  readonly address = SGP30_ADDRESS;
  onBus = false;

  /** The command being received, byte by byte. */
  private commandHigh: number | null = null;
  /** The last measurement, held until another command asks for one. */
  private measurement: { readonly eco2: number; readonly tvoc: number } | null = null;
  /** The readings the chip reports when the operator has not dialled one. */
  private eco2 = 400;
  private tvoc = 0;
  /**
   * Where the readings are.
   *
   * The chip reads the world when a command arrives, so a knob turned
   * between two measurements is seen by the very next one.
   */
  private world: (() => { readonly eco2: number; readonly tvoc: number }) | null = null;

  /** Points the sensor at the air the bench is in. */
  setAirSource(read: () => { readonly eco2: number; readonly tvoc: number }): void {
    this.world = read;
  }

  receive(byte: number, isControlPosition: boolean): boolean {
    if (isControlPosition || this.commandHigh === null) {
      this.commandHigh = byte & 0xff;
      return true;
    }
    const command = (this.commandHigh << 8) | (byte & 0xff);
    this.commandHigh = null;
    if (command === INIT_AIR_QUALITY) {
      // Acknowledged; nothing to do.
      return true;
    }
    if (command === MEASURE_AIR_QUALITY) {
      this.measure();
      return true;
    }
    // Unknown commands are acknowledged and change nothing.
    return true;
  }

  read(count: number): readonly number[] {
    const n = Math.max(0, count);
    if (this.measurement === null) {
      // Before any measurement, return zeros.
      return Array.from({ length: n }, () => 0);
    }
    const { eco2, tvoc } = this.measurement;
    const eco2Bytes = [(eco2 >> 8) & 0xff, eco2 & 0xff];
    const tvocBytes = [(tvoc >> 8) & 0xff, tvoc & 0xff];
    const bytes = [
      ...eco2Bytes, crc8(eco2Bytes),
      ...tvocBytes, crc8(tvocBytes),
    ];
    return Array.from({ length: n }, (_, i) => (i < bytes.length ? bytes[i]! : 0));
  }

  /** Samples the air and stores the measurement. */
  private measure(): void {
    if (this.world !== null) {
      const air = this.world();
      this.eco2 = air.eco2;
      this.tvoc = air.tvoc;
    }
    this.measurement = { eco2: this.eco2, tvoc: this.tvoc };
  }
}
