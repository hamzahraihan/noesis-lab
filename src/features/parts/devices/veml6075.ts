/**
 * VEML6075 UV sensor: a UVA/UVB light sensor on the I2C bus.
 *
 * The model speaks the register protocol rather than offering a UV index
 * call, because the protocol is the exercise. A sketch writes the
 * configuration register to set the integration time and dynamic range,
 * and then reads two words from UVA_DATA and UVB_DATA. The chip also
 * reports compensation channels for ambient light.
 *
 * The UVA and UVB counts are the operator's knobs, read when the chip
 * reports rather than pushed in on a tick: a knob turned between two reads
 * is seen by the very next one.
 */
import type { KnobSpec } from '../catalog';
import type { I2cDevice } from './device';

/** The address the module silkscreens, and the only one the chip answers to. */
export const VEML6075_ADDRESS = 0x10;

/** The UVA raw count. */
export const VEML6075_UVA_KNOB: KnobSpec = {
  id: 'uva',
  label: 'UVA',
  min: 0,
  max: 65535,
  step: 1,
  unit: 'count',
  defaultValue: 100,
};

/** The UVB raw count. */
export const VEML6075_UVB_KNOB: KnobSpec = {
  id: 'uvb',
  label: 'UVB',
  min: 0,
  max: 65535,
  step: 1,
  unit: 'count',
  defaultValue: 50,
};

/** The register addresses the chip names. */
const REG_UVA_DATA = 0x01;
const REG_UVB_DATA = 0x02;
const REG_ID = 0x07;

/** The device ID the chip reports. */
const DEVICE_ID = 0x26;

export class Veml6075 implements I2cDevice {
  readonly address = VEML6075_ADDRESS;
  onBus = false;

  /** Where the next read starts. */
  private pointer = REG_UVA_DATA;
  /** The counts the chip reports when the operator has not dialled one. */
  private uva = 100;
  private uvb = 50;
  /**
   * Where the counts are.
   *
   * The chip reads the world when a sketch asks for it, so a knob turned
   * between two reads is seen by the very next one.
   */
  private world: (() => { readonly uva: number; readonly uvb: number }) | null = null;

  /** Points the sensor at the light the bench is in. */
  setUvSource(read: () => { readonly uva: number; readonly uvb: number }): void {
    this.world = read;
  }

  receive(byte: number, isControlPosition: boolean): boolean {
    if (isControlPosition) {
      this.pointer = byte & 0xff;
      return true;
    }
    // Configuration register writes are acknowledged and discarded.
    return true;
  }

  read(count: number): readonly number[] {
    const n = Math.max(0, count);
    const uv = this.world?.() ?? { uva: this.uva, uvb: this.uvb };
    this.uva = uv.uva;
    this.uvb = uv.uvb;

    if (this.pointer === REG_ID) {
      return [DEVICE_ID];
    }
    if (this.pointer === REG_UVA_DATA) {
      const bytes = [this.uva & 0xff, (this.uva >> 8) & 0xff, this.uvb & 0xff, (this.uvb >> 8) & 0xff];
      return Array.from({ length: n }, (_, i) => (i < bytes.length ? bytes[i]! : 0));
    }
    if (this.pointer === REG_UVB_DATA) {
      const bytes = [this.uvb & 0xff, (this.uvb >> 8) & 0xff];
      return Array.from({ length: n }, (_, i) => (i < bytes.length ? bytes[i]! : 0));
    }
    return Array.from({ length: n }, () => 0);
  }
}
