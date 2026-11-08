/**
 * APDS9960 gesture and proximity sensor: gesture, proximity and ambient
 * light over I2C.
 *
 * The model speaks the register protocol rather than offering a "what is the
 * gesture" call, because the protocol is the exercise. A sketch writes the
 * enable register, reads the proximity, ambient light and gesture status
 * registers, and decodes the gesture that came through.
 *
 * The counts are the chip's answer to a question about the hand, so the
 * model answers them from the conditions the operator has dialled in: a
 * sketch that reads the registers sees what the operator set, which is the
 * only way the two halves of the exercise can be checked.
 */
import type { KnobSpec } from '../catalog';
import type { I2cDevice } from './device';

/** The address the module answers to with the SDO pin low. */
export const APDS9960_ADDRESS = 0x39;

/** The proximity reading, 0 far away to 255 touching. */
export const APDS9960_PROXIMITY_KNOB: KnobSpec = {
  id: 'proximity',
  label: 'Proximity',
  min: 0,
  max: 255,
  step: 1,
  defaultValue: 50,
};

/** The ambient light, in lux. */
export const APDS9960_AMBIENT_KNOB: KnobSpec = {
  id: 'ambient',
  label: 'Ambient light',
  min: 0,
  max: 2000,
  step: 10,
  unit: 'lux',
  defaultValue: 200,
};

/** The gesture through the air: 0 none, 1 up, 2 down, 3 left, 4 right. */
export const APDS9960_GESTURE_KNOB: KnobSpec = {
  id: 'gesture',
  label: 'Gesture',
  min: 0,
  max: 4,
  step: 1,
  defaultValue: 0,
};

/** The part id register: it reads 0xAB for as long as the chip lives. */
const PART_ID = 0x92;
/** The proximity data register. */
const PROXIMITY_DATA = 0x8c;
/** The ambient light data registers. */
const ALS_DATA = 0x8d;
/** The gesture status register. */
const GESTURE_STATUS = 0x93;

/** How many raw counts per lux of ambient light. */
const COUNTS_PER_LUX = 16;

export class Apds9960 implements I2cDevice {
  readonly address = APDS9960_ADDRESS;
  onBus = false;

  /** The proximity reading, 0 far away to 255 touching. */
  private proximity = 50;
  /** The ambient light, in lux. */
  private ambient = 200;
  /** The gesture through the air: 0 none, 1 up, 2 down, 3 left, 4 right. */
  private gesture = 0;

  /** Where the next written byte lands, and where the next read starts. */
  private pointer = PROXIMITY_DATA;
  /** Whether the counts still match the conditions the operator described. */
  private stale = true;
  /** Where the hand is. */
  private world: (() => { readonly proximity: number; readonly ambient: number; readonly gesture: number }) | null = null;

  /** Points the chip at the conditions the bench is in. */
  setConditionsSource(read: () => { readonly proximity: number; readonly ambient: number; readonly gesture: number }): void {
    this.world = read;
    this.stale = true;
  }

  /** Recomputes the counts the converter holds from the conditions. */
  private recompute(): void {
    if (this.world === null) return;
    const conditions = this.world();
    if (
      conditions.proximity === this.proximity &&
      conditions.ambient === this.ambient &&
      conditions.gesture === this.gesture &&
      !this.stale
    )
      return;
    this.proximity = Math.max(0, Math.min(255, Math.round(conditions.proximity)));
    this.ambient = Math.max(0, Math.min(2000, Math.round(conditions.ambient)));
    this.gesture = Math.max(0, Math.min(4, Math.round(conditions.gesture)));
    this.stale = false;
  }

  receive(byte: number, isControlPosition: boolean): boolean {
    if (isControlPosition) {
      this.pointer = byte & 0xff;
      return true;
    }
    /*
     * Writing to the enable register is acknowledged; anything else is
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
    if (address === PART_ID) return 0xab;
    if (address === PROXIMITY_DATA) return this.proximity;
    if (address === ALS_DATA || address === ALS_DATA + 1) {
      const counts = Math.max(0, Math.min(0xffff, Math.round(this.ambient * COUNTS_PER_LUX)));
      return address === ALS_DATA ? (counts >> 8) & 0xff : counts & 0xff;
    }
    if (address === GESTURE_STATUS) return this.gesture;
    return 0;
  }
}
