/**
 * TSL2561 light sensor: a two-channel light sensor on the I2C bus.
 *
 * The model speaks the register protocol rather than offering a lux value,
 * because the protocol is the exercise. A sketch powers the chip on, sets
 * the integration time and gain, and then reads four bytes from the data
 * registers: channel 0 low, channel 0 high, channel 1 low, channel 1 high.
 * Channel 0 sees visible plus infrared; channel 1 sees infrared only. The
 * sketch combines them with the datasheet's lux equation.
 *
 * The light itself is the operator's knob, read when the chip measures rather
 * than pushed in on a tick: a lamp turned up between two reads is seen by the
 * very next conversion.
 */
import type { KnobSpec } from '../catalog';
import type { I2cDevice } from './device';

/** The address the module silkscreens, and the only one the chip answers to. */
export const TSL2561_ADDRESS = 0x39;

/** The light falling on the chip, in lux. */
export const TSL2561_LIGHT_KNOB: KnobSpec = {
  id: 'light',
  label: 'Light',
  min: 0,
  max: 10_000,
  step: 1,
  unit: 'lx',
  defaultValue: 250,
};

/** The register addresses the chip names. */
const REG_DATA0LOW = 0x0c;
const REG_DATA1LOW = 0x0e;

export class Tsl2561 implements I2cDevice {
  readonly address = TSL2561_ADDRESS;
  onBus = false;

  /** Where the next read starts. */
  private pointer = REG_DATA0LOW;
  /** The light the chip reports when the operator has not dialled one. */
  private lux = 250;
  /**
   * Where the light is.
   *
   * The chip measures the world rather than being told about it, so a knob
   * turned between two reads is seen by the very next conversion.
   */
  private world: (() => number) | null = null;

  /** Points the chip at the light the bench is in. */
  setLightSource(read: () => number): void {
    this.world = read;
  }

  receive(byte: number, isControlPosition: boolean): boolean {
    if (isControlPosition) {
      // Strip the command bit to get the register address.
      this.pointer = (byte & 0x7f) & 0xff;
      return true;
    }
    // Register writes are acknowledged and discarded.
    return true;
  }

  read(count: number): readonly number[] {
    const n = Math.max(0, count);
    const measured = this.world?.() ?? this.lux;
    this.lux = measured;
    // Channel 0 sees visible + IR; channel 1 sees IR only (~30% of ch0).
    const ch0 = Math.min(0xffff, Math.round(measured * 1.2));
    const ch1 = Math.min(0xffff, Math.round(ch0 * 0.3));
    if (this.pointer === REG_DATA0LOW) {
      const bytes = [ch0 & 0xff, (ch0 >> 8) & 0xff, ch1 & 0xff, (ch1 >> 8) & 0xff];
      return Array.from({ length: n }, (_, i) => (i < bytes.length ? bytes[i]! : 0));
    }
    if (this.pointer === REG_DATA1LOW) {
      const bytes = [ch1 & 0xff, (ch1 >> 8) & 0xff];
      return Array.from({ length: n }, (_, i) => (i < bytes.length ? bytes[i]! : 0));
    }
    return Array.from({ length: n }, () => 0);
  }
}
