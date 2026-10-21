/**
 * HX711 load-cell amplifier, on the breakout that answers on I2C.
 *
 * The amplifier on its own speaks a two-wire bit-banged protocol; the module
 * sold as an I2C load cell has a microcontroller on it that puts the reading
 * on the bus instead, and that is the part this models. The address is the
 * module's, not the amplifier's, and a sketch reads it the way it would read
 * anything else on the bus: ask for three bytes, decode them.
 *
 * There is no register file at all, which is the one thing to know about it.
 * There is nothing to point at, so a read always starts at the sample, and a
 * byte written to the amplifier is acknowledged and dropped.
 */
import { repeatLast, type I2cDevice } from './device';

/** The address the module answers to, fixed in the onboard microcontroller. */
export const HX711_ADDRESS = 0x28;

/**
 * Counts one gram moves the reading by.
 *
 * The amplifier has no notion of grams, so this is the bench's figure and not
 * the datasheet's. What the HX711 fixes is the *format* -- 24 bits, two's
 * complement, most significant byte first, top bit set when the result is
 * ready -- and the choice of gain. Everything that turns a mass into counts
 * belongs to the load cell bolted to the board: its sensitivity in mV/V, the
 * excitation the module feeds it, and the reference the module puts on its own
 * analogue section.
 *
 * The bench pairs the module with a 2 mV/V cell fed from that same 2.048 V
 * regulator, which is the pairing the standard sketches are written for. On
 * that pairing a gram is 4.1 uV of bridge output and a count is worth about
 * 1.9 uV at the 128 gain the module ships set to, and those are the two
 * figures below. Change the cell and this is the one line in the model that
 * moves with it.
 */
export const COUNTS_PER_GRAM = 2148;

/**
 * The reading of an unloaded cell, in counts.
 *
 * A real bridge never reads exactly zero: the module's reference and amplifier
 * offset, plus the cell's own, are what a scale zeroes at power-up. Without
 * this the answer would be 0x000000 with the ready bit clear and a sketch
 * waiting on bit 23 would wait forever. A fifth of one per cent of full scale
 * is enough to leave the flag standing.
 */
const ZERO_COUNTS = 16_384;

/**
 * Bit 23 of the answer: the datasheet's first output bit, standing when the
 * conversion behind the word is ready.
 *
 * It is a flag rather than the top of the reading, which is why a sketch
 * sign-extends the way the standard libraries do -- `(word ^ 0x800000) -
 * 0x800000` -- rather than treating the word as a 24-bit signed number.
 */
const DATA_READY = 0x800000;

/** The largest reading the word can hold, and where the converter saturates. */
const FULL_SCALE = 0x7fffff;

export class Hx711 implements I2cDevice {
  readonly address = HX711_ADDRESS;
  onBus = false;

  /** The load on the cell, in grams, as the bench last set it. */
  private grams = 0;
  /**
   * Where the load is.
   *
   * The amplifier reads the world when it reports rather than being told
   * about it, so a knob turned between two reads is seen by the very next
   * one -- in the page and in the worker alike, which is where a pushed
   * value would have gone stale.
   */
  private world: (() => number) | null = null;

  /**
   * Puts a load on the cell.
   *
   * The conversion to counts is one multiply in the read, so the bench can
   * move the load as often as it likes and the next read answers with the
   * sample that load produces.
   */
  setLoad(grams: number): void {
    this.grams = grams;
  }

  /** Points the amplifier at the load the bench is carrying. */
  setLoadSource(read: () => number): void {
    this.world = read;
  }

  /** The load on the cell, as the world describes it. */
  private load(): number {
    if (this.world === null) return this.grams;
    this.grams = this.world();
    return this.grams;
  }

  /**
   * Acknowledges the address and drops the byte.
   *
   * The amplifier has no register for a byte to land in, and it holds a
   * conversion either way, so there is nothing for a write to change. The
   * acknowledge is the honest part: `Wire.endTransmission()` reports success
   * because the part is there, whether or not it had anything to do.
   */
  receive(_byte: number, _isControlPosition: boolean): boolean {
    return true;
  }

  /**
   * Answers with a fresh sample: three bytes, most significant first, the
   * ready flag in bit 23 and the reading in the 23 bits below it.
   *
   * There is no conversion time in the model, so a sample is always ready by
   * the time it is asked for. A load past the end of the word saturates rather
   * than wrapping, which is what a converter that has run out of range does.
   * A read longer than a sample repeats the last byte, since the bus has no
   * way to say a device has nothing more to give.
   */
  read(count: number): readonly number[] {
    const counts = Math.round(this.load() * COUNTS_PER_GRAM) + ZERO_COUNTS;
    const word = (Math.max(-FULL_SCALE, Math.min(FULL_SCALE, counts)) & FULL_SCALE) | DATA_READY;
    return repeatLast([(word >> 16) & 0xff, (word >> 8) & 0xff, word & 0xff], count);
  }
}
