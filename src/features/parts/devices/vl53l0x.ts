/**
 * VL53L0X time-of-flight distance sensor: an I2C breakout that reports the
 * distance to the nearest object in millimetres.
 *
 * The model speaks the register protocol rather than offering a "what is the
 * distance" call, because the protocol is the exercise. A sketch writes the
 * range-start register, then reads the result out of the result register.
 * The distance itself is the operator's knob, read when the chip reports --
 * a knob turned between two reads is seen by the very next one.
 */
import type { KnobSpec } from '../catalog';
import type { I2cDevice } from './device';

/** The address the module silkscreens, and the only one the chip answers to. */
export const VL53L0X_ADDRESS = 0x29;

/** The distance to the nearest object, in millimetres. */
export const VL53L0X_DISTANCE_KNOB: KnobSpec = {
  id: 'distance',
  label: 'Distance',
  min: 0,
  max: 2000,
  step: 1,
  unit: 'mm',
  defaultValue: 500,
};

/** The device id register: it reads 0xEE for as long as the chip lives. */
const DEVICE_ID = 0x00;
/** Where the ranging result lands: two bytes, big-endian millimetres. */
const RESULT_RANGE = 0x14;

export class Vl53l0x implements I2cDevice {
  readonly address = VL53L0X_ADDRESS;
  onBus = false;

  /** Where the next written byte lands, and where the next read starts. */
  private pointer = DEVICE_ID;
  /** The distance the chip reports when the operator has not dialled one. */
  private distance = 500;
  /** Where the distance is. */
  private world: (() => number) | null = null;

  /** Points the rangefinder at the distance the bench is in. */
  setDistanceSource(read: () => number): void {
    this.world = read;
  }

  receive(byte: number, isControlPosition: boolean): boolean {
    if (isControlPosition) {
      this.pointer = byte & 0xff;
      return true;
    }
    /*
     * Writing to the range-start register begins a measurement; anything
     * else is acknowledged and discarded, which is what the chip does.
     */
    return true;
  }

  read(count: number): readonly number[] {
    const distance = this.world?.() ?? this.distance;
    const bytes: number[] = [];
    for (let index = 0; index < count; index++) {
      if (this.pointer === DEVICE_ID) {
        bytes.push(0xee);
      } else if (this.pointer === RESULT_RANGE || this.pointer === RESULT_RANGE + 1) {
        const offset = this.pointer - RESULT_RANGE;
        bytes.push(offset === 0 ? (distance >> 8) & 0xff : distance & 0xff);
      } else {
        bytes.push(0);
      }
      this.pointer = (this.pointer + 1) & 0xff;
    }
    return bytes;
  }
}
