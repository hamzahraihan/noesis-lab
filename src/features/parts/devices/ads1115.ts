/**
 * ADS1115 sixteen-bit analogue-to-digital converter: the breakout that reads
 * four voltages and reports them as counts.
 *
 * The model speaks the register protocol rather than offering a "read the
 * voltage" call, because the protocol is the whole exercise. The chip is
 * pointed at a register with a one-byte write, told which input to look at
 * and how much of the range to give it, and then asked for the conversion
 * register -- sixteen bits, most significant byte first, in two's
 * complement. The counts are only as good as the gain the sketch chose, which
 * is the part of the exercise that catches people out: a channel read at the
 * widest range has a bit less resolution than the same channel read at the
 * narrowest.
 *
 * The four channels are the operator's inputs, the way the load cell's load
 * is the HX711's input: the bench has no analogue input pins to wire to, so
 * the voltage on a channel is what the operator has dialled in. A channel is
 * read the way a real one is -- against the internal reference, in counts,
 * with the range the gain setting gives.
 */
import { type KnobSpec } from '../catalog';
import { type I2cDevice } from './device';

/** The address the module silkscreens, and the only one the chip answers to. */
export const ADS1115_ADDRESS = 0x48;

/** The voltage on the chip's first channel, in volts. */
export const ADS1115_CHANNEL_KNOBS: readonly KnobSpec[] = [
  { id: 'a0', label: 'Channel 0', min: -4, max: 4, step: 0.01, unit: 'V', defaultValue: 0 },
  { id: 'a1', label: 'Channel 1', min: -4, max: 4, step: 0.01, unit: 'V', defaultValue: 0 },
  { id: 'a2', label: 'Channel 2', min: -4, max: 4, step: 0.01, unit: 'V', defaultValue: 0 },
  { id: 'a3', label: 'Channel 3', min: -4, max: 4, step: 0.01, unit: 'V', defaultValue: 0 },
];

/**
 * The chip's internal reference, in volts.
 *
 * Four point zero nine six is what the reference is, and the gain setting
 * divides it: the widest range is the whole reference either side of zero,
 * and the narrowest is a sixteenth of it.
 */
const REFERENCE_VOLTS = 4.096;

/** The registers, in the order the datasheet numbers them. */
const CONVERSION = 0x00;
const CONFIG = 0x01;

/** The number of registers the chip answers at. */
const REGISTER_COUNT = 4;

/** The configuration the chip powers up with: continuous, gain sixteen. */
const RESET_CONFIG = 0x8583;

export class Ads1115 implements I2cDevice {
  readonly address = ADS1115_ADDRESS;
  onBus = false;

  /** The voltage on each channel, in volts. */
  private readonly channels = [0, 0, 0, 0];

  /** The registers the chip holds, each two bytes, most significant first. */
  private readonly registers = new Uint8Array(REGISTER_COUNT * 2);
  /** The register the chip is pointed at. */
  private pointer = CONVERSION;
  /** Which byte of that register the next written byte lands in. */
  private byteIndex = 0;
  /**
   * Where the voltages are.
   *
   * The chip reads the world when it converts rather than being told about
   * it, so a knob turned between two reads is seen by the very next one -- in
   * the page and in the worker alike, which is where a pushed value would
   * have gone stale.
   */
  private world: (() => readonly number[]) | null = null;

  constructor() {
    this.writeWord(CONFIG, RESET_CONFIG);
    this.refresh();
  }

  /** Points the chip at the voltages the bench is in. */
  setChannelsSource(read: () => readonly number[]): void {
    this.world = read;
  }

  /** The voltages on the chip's channels, as the world describes them. */
  private conditions(): boolean {
    if (this.world === null) return false;
    const volts = this.world();
    let changed = false;
    for (let index = 0; index < this.channels.length; index++) {
      const value = volts[index] ?? 0;
      if (value !== this.channels[index]) {
        this.channels[index] = value;
        changed = true;
      }
    }
    return changed;
  }

  /**
   * Recomputes the conversion register from the channel the chip is pointed
   * at and the range the gain setting gives it.
   *
   * A reading past the range saturates at the end of the scale, which is
   * what a converter that cannot represent the voltage does.
   */
  private refresh(): void {
    const config = this.readWord(CONFIG);
    const gain = config & 0x07;
    const range = REFERENCE_VOLTS / 2 ** gain;
    const volts = this.selectedVolts((config >> 12) & 0x07);
    const counts = Math.round((volts / range) * 32767);
    this.writeWord(CONVERSION, Math.max(-32768, Math.min(32767, counts)));
  }

  /**
   * The voltage the chip is looking at, for each of the input settings.
   *
   * The low three bits of the input setting choose a single-ended channel or
   * a difference between two of them, and the difference is what the chip
   * measures when it is asked for one.
   */
  private selectedVolts(mux: number): number {
    switch (mux) {
      case 0x00:
      case 0x01:
        return this.channels[0] - this.channels[1];
      case 0x02:
      case 0x03:
        return this.channels[0] - this.channels[3];
      case 0x04:
        return this.channels[0];
      case 0x05:
        return this.channels[1];
      case 0x06:
        return this.channels[2];
      default:
        return this.channels[3];
    }
  }

  /** Writes a register that holds a sixteen-bit value, most significant first. */
  private writeWord(register: number, value: number): void {
    const word = value & 0xffff;
    this.registers[register * 2] = (word >> 8) & 0xff;
    this.registers[register * 2 + 1] = word & 0xff;
  }

  /** Reads a register that holds a sixteen-bit value, most significant first. */
  private readWord(register: number): number {
    return (this.registers[register * 2] << 8) | this.registers[register * 2 + 1];
  }

  receive(byte: number, isControlPosition: boolean): boolean {
    if (isControlPosition) {
      // The pointer register is two bits wide, and the chip keeps it: a read
      // after a write starts where the write left off.
      this.pointer = byte & 0x03;
      this.byteIndex = 0;
      return true;
    }
    this.write(this.pointer, this.byteIndex, byte);
    this.byteIndex += 1;
    if (this.byteIndex === 2) {
      // A register is two bytes wide, so the next byte belongs to the
      // register after it.
      this.pointer = (this.pointer + 1) & 0x03;
      this.byteIndex = 0;
    }
    return true;
  }

  read(count: number): readonly number[] {
    if (this.conditions()) this.refresh();
    const out: number[] = [];
    for (let index = 0; index < count; index++) {
      const register = this.pointer + (index >> 1);
      out.push(this.registerByte(register, index % 2 === 0));
    }
    return out;
  }

  /** One byte of a register: the high byte first, the low byte second. */
  private registerByte(register: number, high: boolean): number {
    if (register >= REGISTER_COUNT) return 0;
    return this.registers[register * 2 + (high ? 0 : 1)];
  }

  /**
   * Handles a written byte.
   *
   * The configuration is the chip's own setting, and a write to it changes
   * what the chip reports -- so the conversion is recomputed once the
   * configuration is complete rather than left stale. The conversion itself
   * is the chip's own answer: a write to it changes nothing.
   */
  private write(register: number, byteIndex: number, value: number): void {
    if (register !== CONFIG) return;
    this.registers[register * 2 + byteIndex] = value & 0xff;
    if (byteIndex === 1) {
      this.conditions();
      this.refresh();
    }
  }
}
