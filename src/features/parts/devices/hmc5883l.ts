/**
 * HMC5883L 3-axis magnetometer: a compass on the I2C bus.
 *
 * The model speaks the register protocol rather than offering a heading
 * call, because the protocol is the exercise. A sketch writes the mode
 * register to start continuous measurement, sets the gain, and then reads
 * six bytes from the data registers: X high, X low, Z high, Z low, Y high,
 * Y low. Each axis is a signed sixteen-bit count scaled by the gain's
 * milli-gauss per LSB.
 *
 * The three axes are the operator's knobs, read when the chip reports rather
 * than pushed in on a tick: a knob turned between two reads is seen by the
 * very next one.
 */
import type { KnobSpec } from '../catalog';
import type { I2cDevice } from './device';

/** The address the module silkscreens, and the only one the chip answers to. */
export const HMC5883L_ADDRESS = 0x1e;

/** The magnetic field on the X axis, in gauss. */
export const HMC5883L_X_KNOB: KnobSpec = {
  id: 'x',
  label: 'X field',
  min: -2,
  max: 2,
  step: 0.01,
  unit: 'G',
  defaultValue: 0,
};

/** The magnetic field on the Y axis, in gauss. */
export const HMC5883L_Y_KNOB: KnobSpec = {
  id: 'y',
  label: 'Y field',
  min: -2,
  max: 2,
  step: 0.01,
  unit: 'G',
  defaultValue: 0,
};

/** The magnetic field on the Z axis, in gauss. */
export const HMC5883L_Z_KNOB: KnobSpec = {
  id: 'z',
  label: 'Z field',
  min: -2,
  max: 2,
  step: 0.01,
  unit: 'G',
  defaultValue: 0.5,
};

/** The device ID bytes the chip reports at registers 0x0A-0x0C. */
const ID_A = 0x48;
const ID_B = 0x34;
const ID_C = 0x33;

/** The register addresses the chip names. */
const REG_CONFIG_A = 0x00;
const REG_DATA_X_MSB = 0x03;
const REG_ID_A = 0x0a;

/** Milli-gauss per LSB at default gain (±1.3 Ga). */
const MG_PER_LSB = 0.92;

export class Hmc5883l implements I2cDevice {
  readonly address = HMC5883L_ADDRESS;
  onBus = false;

  /** Where the next read starts. */
  private pointer = REG_CONFIG_A;
  /** The magnetic field the chip reports when the operator has not dialled one. */
  private x = 0;
  private y = 0;
  private z = 0.5;
  /**
   * Where the field is.
   *
   * The chip reads the world when a sketch asks for it, so a knob turned
   * between two reads is seen by the very next one.
   */
  private world: (() => { readonly x: number; readonly y: number; readonly z: number }) | null = null;

  /** Points the magnetometer at the bench. */
  setFieldSource(read: () => { readonly x: number; readonly y: number; readonly z: number }): void {
    this.world = read;
  }

  receive(byte: number, isControlPosition: boolean): boolean {
    if (isControlPosition) {
      this.pointer = byte & 0xff;
      return true;
    }
    // Data writes to config registers are acknowledged and discarded.
    return true;
  }

  read(count: number): readonly number[] {
    const n = Math.max(0, count);
    if (this.pointer === REG_ID_A) {
      const bytes = [ID_A, ID_B, ID_C];
      return Array.from({ length: n }, (_, i) => (i < bytes.length ? bytes[i]! : 0));
    }
    if (this.pointer >= REG_DATA_X_MSB && this.pointer <= REG_DATA_X_MSB + 5) {
      const field = this.world?.() ?? { x: this.x, y: this.y, z: this.z };
      this.x = field.x;
      this.y = field.y;
      this.z = field.z;
      const xs = Math.round((this.x * 1000) / MG_PER_LSB);
      const zs = Math.round((this.z * 1000) / MG_PER_LSB);
      const ys = Math.round((this.y * 1000) / MG_PER_LSB);
      // HMC5883L order: X, Z, Y
      const dataBytes = [
        (xs >> 8) & 0xff, xs & 0xff,
        (zs >> 8) & 0xff, zs & 0xff,
        (ys >> 8) & 0xff, ys & 0xff,
      ];
      const offset = this.pointer - REG_DATA_X_MSB;
      return Array.from({ length: n }, (_, i) => {
        const idx = offset + i;
        return idx < dataBytes.length ? dataBytes[idx]! : 0;
      });
    }
    return Array.from({ length: n }, () => 0);
  }
}
