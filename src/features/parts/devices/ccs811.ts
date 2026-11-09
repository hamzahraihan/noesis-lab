/**
 * CCS811 air quality sensor: an eCO2 and TVOC sensor on the I2C bus.
 *
 * The model speaks the register protocol rather than offering a reading
 * call, because the protocol is the exercise. A sketch writes APP_START
 * to enter application mode, sets the measurement mode, and then reads
 * four bytes from ALG_RESULT_DATA: eCO2 high, eCO2 low, TVOC high, TVOC
 * low. The chip also reports a status byte and an error ID.
 *
 * The two readings are the operator's knobs, read when the chip reports
 * rather than pushed in on a tick: a knob turned between two reads is seen
 * by the very next one.
 */
import type { KnobSpec } from '../catalog';
import type { I2cDevice } from './device';

/** The address the module silkscreens, and the only one the chip answers to. */
export const CCS811_ADDRESS = 0x5a;

/** The equivalent CO2 concentration, in parts per million. */
export const CCS811_ECO2_KNOB: KnobSpec = {
  id: 'eco2',
  label: 'eCO2',
  min: 400,
  max: 8192,
  step: 1,
  unit: 'ppm',
  defaultValue: 400,
};

/** The total volatile organic compounds, in parts per billion. */
export const CCS811_TVOC_KNOB: KnobSpec = {
  id: 'tvoc',
  label: 'TVOC',
  min: 0,
  max: 1187,
  step: 1,
  unit: 'ppb',
  defaultValue: 0,
};

/** The register addresses the chip names. */
const REG_STATUS = 0x00;
const REG_MEAS_MODE = 0x01;
const REG_ALG_RESULT_DATA = 0x02;
const REG_APP_START = 0xf4;
const REG_HW_ID = 0x20;

/** The hardware ID the chip reports. */
const HW_ID = 0x81;

export class Ccs811 implements I2cDevice {
  readonly address = CCS811_ADDRESS;
  onBus = false;

  /** Where the next read starts. */
  private pointer = REG_STATUS;
  /** Whether the application has started. */
  private appStarted = false;
  /** The readings the chip reports when the operator has not dialled one. */
  private eco2 = 400;
  private tvoc = 0;
  /**
   * Where the readings are.
   *
   * The chip reads the world when a sketch asks for it, so a knob turned
   * between two reads is seen by the very next one.
   */
  private world: (() => { readonly eco2: number; readonly tvoc: number }) | null = null;

  /** Points the sensor at the air the bench is in. */
  setAirSource(read: () => { readonly eco2: number; readonly tvoc: number }): void {
    this.world = read;
  }

  receive(byte: number, isControlPosition: boolean): boolean {
    if (isControlPosition) {
      this.pointer = byte & 0xff;
      return true;
    }
    // APP_START command: no data byte needed.
    if (this.pointer === REG_APP_START) {
      this.appStarted = true;
    }
    // MEAS_MODE register: acknowledged.
    if (this.pointer === REG_MEAS_MODE) {
      // acknowledged
    }
    return true;
  }

  read(count: number): readonly number[] {
    const n = Math.max(0, count);
    if (this.pointer === REG_HW_ID) {
      return [HW_ID];
    }
    if (this.pointer === REG_STATUS) {
      return [this.appStarted ? 0x98 : 0x10];
    }
    if (this.pointer === REG_ALG_RESULT_DATA) {
      const air = this.world?.() ?? { eco2: this.eco2, tvoc: this.tvoc };
      this.eco2 = air.eco2;
      this.tvoc = air.tvoc;
      const eco2 = Math.min(65535, Math.max(0, this.eco2));
      const tvoc = Math.min(65535, Math.max(0, this.tvoc));
      const bytes = [(eco2 >> 8) & 0xff, eco2 & 0xff, (tvoc >> 8) & 0xff, tvoc & 0xff, 0x10, 0x00];
      return Array.from({ length: n }, (_, i) => (i < bytes.length ? bytes[i]! : 0));
    }
    return Array.from({ length: n }, () => 0);
  }
}
