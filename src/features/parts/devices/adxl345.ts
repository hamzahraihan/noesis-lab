/**
 * ADXL345 digital accelerometer: a three-axis accelerometer on the I2C bus.
 *
 * The model speaks the register protocol rather than offering acceleration
 * calls, because the protocol is the exercise. A sketch writes the power
 * control register to start measuring, sets the data format for the range,
 * and then reads six bytes from the data registers: X low, X high, Y low,
 * Y high, Z low, Z high. Each axis is a signed sixteen-bit count scaled by
 * the range's milli-g per LSB.
 *
 * The three axes are the operator's knobs, read when the chip reports rather
 * than pushed in on a tick: a knob turned between two reads is seen by the
 * very next one.
 */
import type { KnobSpec } from '../catalog';
import type { I2cDevice } from './device';

/** The address the module silkscreens, and the only one the chip answers to. */
export const ADXL345_ADDRESS = 0x53;

/** The acceleration on the X axis, in g. */
export const ADXL345_X_KNOB: KnobSpec = {
  id: 'x',
  label: 'X acceleration',
  min: -2,
  max: 2,
  step: 0.01,
  unit: 'g',
  defaultValue: 0,
};

/** The acceleration on the Y axis, in g. */
export const ADXL345_Y_KNOB: KnobSpec = {
  id: 'y',
  label: 'Y acceleration',
  min: -2,
  max: 2,
  step: 0.01,
  unit: 'g',
  defaultValue: 0,
};

/** The acceleration on the Z axis, in g. */
export const ADXL345_Z_KNOB: KnobSpec = {
  id: 'z',
  label: 'Z acceleration',
  min: -2,
  max: 2,
  step: 0.01,
  unit: 'g',
  defaultValue: 1,
};

/** The device ID the chip reports. */
const DEVID = 0xe5;

/** The register addresses the chip names. */
const REG_DEVID = 0x00;
const REG_POWER_CTL = 0x2d;
const REG_DATAX0 = 0x32;

/** Milli-g per LSB at ±2 g range (10-bit). */
const MG_PER_LSB = 3.9;

export class Adxl345 implements I2cDevice {
  readonly address = ADXL345_ADDRESS;
  onBus = false;

  /** Where the next read starts. */
  private pointer = REG_DEVID;
  /** The acceleration the chip reports when the operator has not dialled one. */
  private x = 0;
  private y = 0;
  private z = 1;
  /**
   * Where the acceleration is.
   *
   * The chip reads the world when a sketch asks for it, so a knob turned
   * between two reads is seen by the very next one.
   */
  private world: (() => { readonly x: number; readonly y: number; readonly z: number }) | null = null;

  /** Points the accelerometer at the bench. */
  setAccelerationSource(read: () => { readonly x: number; readonly y: number; readonly z: number }): void {
    this.world = read;
  }

  receive(byte: number, isControlPosition: boolean): boolean {
    if (isControlPosition) {
      this.pointer = byte & 0xff;
      return true;
    }
    // Power control register: bit 3 enables measurement.
    if (this.pointer === REG_POWER_CTL) {
      // acknowledged; measurement always on in the model
    }
    // Data writes to other registers are acknowledged and discarded.
    return true;
  }

  read(count: number): readonly number[] {
    const n = Math.max(0, count);
    if (this.pointer === REG_DEVID) {
      const bytes = [DEVID];
      return Array.from({ length: n }, (_, i) => (i < bytes.length ? bytes[i]! : 0));
    }
    if (this.pointer >= REG_DATAX0 && this.pointer <= REG_DATAX0 + 5) {
      const accel = this.world?.() ?? { x: this.x, y: this.y, z: this.z };
      this.x = accel.x;
      this.y = accel.y;
      this.z = accel.z;
      const xs = Math.round((this.x * 1000) / MG_PER_LSB);
      const ys = Math.round((this.y * 1000) / MG_PER_LSB);
      const zs = Math.round((this.z * 1000) / MG_PER_LSB);
      const dataBytes = [
        xs & 0xff, (xs >> 8) & 0xff,
        ys & 0xff, (ys >> 8) & 0xff,
        zs & 0xff, (zs >> 8) & 0xff,
      ];
      const offset = this.pointer - REG_DATAX0;
      return Array.from({ length: n }, (_, i) => {
        const idx = offset + i;
        return idx < dataBytes.length ? dataBytes[idx]! : 0;
      });
    }
    return Array.from({ length: n }, () => 0);
  }
}
