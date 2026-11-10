/**
 * MAX30100 pulse oximeter: heart rate and blood oxygen over I2C.
 *
 * The model speaks the register protocol rather than offering a "what is the
 * heart rate" call, because the protocol is the exercise. A sketch starts
 * the PPG, reads the FIFO data registers, and converts the counts with the
 * datasheet formula.
 *
 * The raw counts are the chip's answer to a question about the finger, so
 * the model answers them from the vitals the operator has dialled in: a
 * sketch that applies the datasheet's conversion reads back what the
 * operator set, which is the only way the two halves of the exercise can
 * be checked.
 */
import type { KnobSpec } from '../catalog';
import type { I2cDevice } from './device';

/** The address the module answers to with the SDO pin low. */
export const MAX30100_ADDRESS = 0x57;

/** The heart rate, in beats per minute. */
export const MAX30100_HEART_RATE_KNOB: KnobSpec = {
  id: 'heartRate',
  label: 'Heart rate',
  min: 40,
  max: 180,
  step: 1,
  unit: 'bpm',
  defaultValue: 72,
};

/** The blood oxygen saturation, in percent. */
export const MAX30100_SPO2_KNOB: KnobSpec = {
  id: 'spo2',
  label: 'SpO2',
  min: 70,
  max: 100,
  step: 1,
  unit: '%',
  defaultValue: 98,
};

/** The part id register: it reads 0x11 for as long as the chip lives. */
const PART_ID = 0xff;
/** The FIFO data register: infrared and red counts, four bytes. */
const DATA_MSB = 0x05;

/** How many raw counts per beat per minute. */
const COUNTS_PER_BPM = 16;

/** How many raw counts per percent of SpO2. */
const COUNTS_PER_PERCENT_SPO2 = 16;

/** The raw IR count for a given heart rate. */
function rawIrFor(bpm: number): number {
  const clamped = Math.max(40, Math.min(180, Math.round(bpm)));
  return Math.max(0, Math.min(0xffff, clamped * COUNTS_PER_BPM));
}

/** The raw red count for a given SpO2. */
function rawRedFor(percent: number): number {
  const clamped = Math.max(70, Math.min(100, Math.round(percent)));
  return Math.max(0, Math.min(0xffff, clamped * COUNTS_PER_PERCENT_SPO2));
}

export class Max30100 implements I2cDevice {
  readonly address = MAX30100_ADDRESS;
  onBus = false;

  /** The heart rate, in beats per minute. */
  private heartRate = 72;
  /** The blood oxygen saturation, in percent. */
  private spo2 = 98;

  /** Where the next written byte lands, and where the next read starts. */
  private pointer = DATA_MSB;
  /** Whether the counts still match the vitals the operator has described. */
  private stale = true;
  /** Where the finger is. */
  private world: (() => { readonly heartRate: number; readonly spo2: number }) | null = null;

  /** The raw IR count the converter holds, sixteen bits. */
  private rawIr = 0;
  /** The raw red count the converter holds, sixteen bits. */
  private rawRed = 0;

  /** Points the oximeter at the vitals the bench is in. */
  setConditionsSource(read: () => { readonly heartRate: number; readonly spo2: number }): void {
    this.world = read;
    this.stale = true;
  }

  /** Recomputes the counts the converter holds from the vitals. */
  private recompute(): void {
    if (this.world === null) return;
    const conditions = this.world();
    if (conditions.heartRate === this.heartRate && conditions.spo2 === this.spo2 && !this.stale) {
      return;
    }
    this.heartRate = conditions.heartRate;
    this.spo2 = conditions.spo2;

    this.rawIr = rawIrFor(this.heartRate);
    this.rawRed = rawRedFor(this.spo2);
    this.stale = false;
  }

  receive(byte: number, isControlPosition: boolean): boolean {
    if (isControlPosition) {
      this.pointer = byte & 0xff;
      return true;
    }
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
    if (address === PART_ID) return 0x11;
    if (address === DATA_MSB || address === DATA_MSB + 1) {
      const idx = address - DATA_MSB;
      return idx === 0 ? (this.rawIr >> 8) & 0xff : this.rawIr & 0xff;
    }
    if (address === DATA_MSB + 2 || address === DATA_MSB + 3) {
      const idx = address - DATA_MSB - 2;
      return idx === 0 ? (this.rawRed >> 8) & 0xff : this.rawRed & 0xff;
    }
    return 0;
  }
}
