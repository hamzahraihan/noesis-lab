/**
 * BNO055 absolute orientation sensor: heading, pitch and roll over I2C.
 *
 * The model speaks the register protocol rather than offering a "what is the
 * heading" call, because the protocol is the exercise. A sketch writes the
 * power mode, reads the orientation registers, and converts the signed
 * sixteen-bit words with the datasheet divisor.
 *
 * The raw counts are the chip's answer to a question about the board, so the
 * model answers them from the orientation the operator has dialled in: a
 * sketch that applies the datasheet's conversion reads back what the
 * operator set, which is the only way the two halves of the exercise can
 * be checked.
 */
import type { KnobSpec } from '../catalog';
import type { I2cDevice } from './device';

/** The address the module answers to with the SDO pin low. */
export const BNO055_ADDRESS = 0x28;

/** The heading, in degrees from north, 0 to 360. */
export const BNO055_HEADING_KNOB: KnobSpec = {
  id: 'heading',
  label: 'Heading',
  min: 0,
  max: 360,
  step: 1,
  unit: '°',
  defaultValue: 90,
};

/** The pitch, in degrees, -90 nose down to 90 nose up. */
export const BNO055_PITCH_KNOB: KnobSpec = {
  id: 'pitch',
  label: 'Pitch',
  min: -90,
  max: 90,
  step: 1,
  unit: '°',
  defaultValue: 0,
};

/** The roll, in degrees, -90 left down to 90 right down. */
export const BNO055_ROLL_KNOB: KnobSpec = {
  id: 'roll',
  label: 'Roll',
  min: -90,
  max: 90,
  step: 1,
  unit: '°',
  defaultValue: 0,
};

/** The chip id register: it reads 0xA0 for as long as the chip lives. */
const CHIP_ID = 0x00;
/** The orientation data registers: heading, pitch and roll. */
const DATA_MSB = 0x1a;

/** How many raw counts per degree of heading. */
const COUNTS_PER_DEGREE_HEADING = 16;

/** How many raw counts per degree of pitch and roll. */
const COUNTS_PER_DEGREE_TILT = 16;

/** The raw heading count for a given heading, signed sixteen-bit. */
function rawHeadingFor(degrees: number): number {
  const clamped = Math.max(0, Math.min(360, Math.round(degrees)));
  const counts = clamped * COUNTS_PER_DEGREE_HEADING;
  return counts & 0xffff;
}

/** The raw pitch/roll count for a given tilt, signed sixteen-bit. */
function rawTiltFor(degrees: number): number {
  const clamped = Math.max(-90, Math.min(90, Math.round(degrees)));
  const counts = clamped * COUNTS_PER_DEGREE_TILT;
  return counts & 0xffff;
}

export class Bno055 implements I2cDevice {
  readonly address = BNO055_ADDRESS;
  onBus = false;

  /** The heading, in degrees from north. */
  private heading = 90;
  /** The pitch, in degrees. */
  private pitch = 0;
  /** The roll, in degrees. */
  private roll = 0;

  /** Where the next written byte lands, and where the next read starts. */
  private pointer = DATA_MSB;
  /** Whether the counts still match the orientation the operator described. */
  private stale = true;
  /** Where the board is. */
  private world: (() => { readonly heading: number; readonly pitch: number; readonly roll: number }) | null = null;

  /** The raw heading count the converter holds. */
  private rawHeading = 0;
  /** The raw pitch count the converter holds. */
  private rawPitch = 0;
  /** The raw roll count the converter holds. */
  private rawRoll = 0;

  /** Points the compass at the orientation the bench is in. */
  setOrientationSource(read: () => { readonly heading: number; readonly pitch: number; readonly roll: number }): void {
    this.world = read;
    this.stale = true;
  }

  /** Recomputes the counts the converter holds from the orientation. */
  private recompute(): void {
    if (this.world === null) return;
    const conditions = this.world();
    if (
      conditions.heading === this.heading &&
      conditions.pitch === this.pitch &&
      conditions.roll === this.roll &&
      !this.stale
    )
      return;
    this.heading = conditions.heading;
    this.pitch = conditions.pitch;
    this.roll = conditions.roll;

    this.rawHeading = rawHeadingFor(this.heading);
    this.rawPitch = rawTiltFor(this.pitch);
    this.rawRoll = rawTiltFor(this.roll);
    this.stale = false;
  }

  receive(byte: number, isControlPosition: boolean): boolean {
    if (isControlPosition) {
      this.pointer = byte & 0xff;
      return true;
    }
    /*
     * Writing to the power-mode register is acknowledged; anything else is
     * acknowledged and discarded, which is what the chip does.
     */
    return true;
  }

  read(count: number): readonly number[] {
    this.recompute();
    const out: number[] = [];
    for (let index = 0; index < count; index++) {
      out.push(this.register((this.pointer + index) & 0xff));
    }
    return out;
  }

  /** The byte at a register address, zero for the addresses that hold none. */
  private register(address: number): number {
    if (address === CHIP_ID) return 0xa0;
    if (address === DATA_MSB || address === DATA_MSB + 1) {
      return this.wordByte(this.rawHeading, address - DATA_MSB);
    }
    if (address === DATA_MSB + 2 || address === DATA_MSB + 3) {
      return this.wordByte(this.rawPitch, address - DATA_MSB - 2);
    }
    if (address === DATA_MSB + 4 || address === DATA_MSB + 5) {
      return this.wordByte(this.rawRoll, address - DATA_MSB - 4);
    }
    return 0;
  }

  /** One byte of a sixteen-bit word, most significant first. */
  private wordByte(word: number, index: number): number {
    return index === 0 ? (word >> 8) & 0xff : word & 0xff;
  }
}
