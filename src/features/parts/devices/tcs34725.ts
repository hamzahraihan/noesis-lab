/**
 * TCS34725 color sensor: an I2C color sensor that reports red, green, blue
 * and clear channels as sixteen-bit counts.
 *
 * The model speaks the register protocol rather than offering a "what color"
 * call, because the protocol is the exercise. A sketch points at a command
 * register, enables the sensor, and reads the four channel registers. The
 * channels are the operator's knobs, read when the chip reports rather than
 * pushed in on a tick.
 */
import type { KnobSpec } from '../catalog';
import type { I2cDevice } from './device';

/** The address the module silkscreens, and the only one the chip answers to. */
export const TCS34725_ADDRESS = 0x29;

/** The red channel count. */
export const TCS34725_RED_KNOB: KnobSpec = {
  id: 'red',
  label: 'Red',
  min: 0,
  max: 65535,
  step: 1,
  unit: '',
  defaultValue: 1000,
};

/** The green channel count. */
export const TCS34725_GREEN_KNOB: KnobSpec = {
  id: 'green',
  label: 'Green',
  min: 0,
  max: 65535,
  step: 1,
  unit: '',
  defaultValue: 2000,
};

/** The blue channel count. */
export const TCS34725_BLUE_KNOB: KnobSpec = {
  id: 'blue',
  label: 'Blue',
  min: 0,
  max: 65535,
  step: 1,
  unit: '',
  defaultValue: 1500,
};

/** The clear channel count. */
export const TCS34725_CLEAR_KNOB: KnobSpec = {
  id: 'clear',
  label: 'Clear',
  min: 0,
  max: 65535,
  step: 1,
  unit: '',
  defaultValue: 4500,
};

/** Enable register. */
const ENABLE = 0x00;
/** RGBC timing register. */
const ATIME = 0x01;
/** ID register: reads 0x44 for TCS34725. */
const ID = 0x12;
/** Clear data low byte. */
const CDATAL = 0x14;
/** Red data low byte. */
const RDATAL = 0x16;
/** Green data low byte. */
const GDATAL = 0x18;
/** Blue data low byte. */
const BDATAL = 0x1a;



export class Tcs34725 implements I2cDevice {
  readonly address = TCS34725_ADDRESS;
  onBus = false;

  /** The four channel counts the chip reports. */
  private red = 1000;
  private green = 2000;
  private blue = 1500;
  private clear = 4500;

  /** The pointer register. */
  private pointer = 0;

  private world: (() => { red: number; green: number; blue: number; clear: number }) | null = null;

  setSource(read: () => { red: number; green: number; blue: number; clear: number }): void {
    this.world = read;
  }

  private conditions(): void {
    if (this.world === null) return;
    const c = this.world();
    this.red = c.red;
    this.green = c.green;
    this.blue = c.blue;
    this.clear = c.clear;
  }

  receive(byte: number, isControlPosition: boolean): boolean {
    if (isControlPosition) {
      // The command bit must be set; the pointer is the register address.
      this.pointer = byte & 0x1f;
      return true;
    }
    // Writes go to the enable register or timing register.
    if (this.pointer === ENABLE) {
      return true;
    }
    if (this.pointer === ATIME) {
      return true;
    }
    return true;
  }

  read(count: number): readonly number[] {
    this.conditions();
    const out: number[] = [];
    for (let index = 0; index < count; index++) {
      const reg = (this.pointer + index) & 0x1f;
      out.push(this.register(reg));
    }
    return out;
  }

  private register(reg: number): number {
    if (reg === ID) return 0x44;
    if (reg === CDATAL) return this.clear & 0xff;
    if (reg === CDATAL + 1) return (this.clear >> 8) & 0xff;
    if (reg === RDATAL) return this.red & 0xff;
    if (reg === RDATAL + 1) return (this.red >> 8) & 0xff;
    if (reg === GDATAL) return this.green & 0xff;
    if (reg === GDATAL + 1) return (this.green >> 8) & 0xff;
    if (reg === BDATAL) return this.blue & 0xff;
    if (reg === BDATAL + 1) return (this.blue >> 8) & 0xff;
    return 0;
  }
}
