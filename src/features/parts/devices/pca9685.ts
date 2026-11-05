/**
 * PCA9685: sixteen PWM channels on two wires.
 *
 * The chip is a counter with sixteen comparators behind it. A sketch writes
 * the count at which each channel turns on and the count at which it turns
 * off, and the chip repeats that pattern forever. The interesting part is
 * that the two counts are independent: a channel can start high late in the
 * period and wrap through the end, which is how a servo pulse is placed
 * rather than merely sized.
 *
 * The bench models the counter, not an averaged voltage. A channel's output
 * is high while the counter is between its ON and OFF counts, so the solver
 * sees the same switched waveform a real chip makes. The counter runs at
 * 25 MHz through a prescaler; the register is the chip's own, and the
 * frequency follows from it.
 *
 * Only the parts of the chip a sketch actually uses are acted on: the
 * oscillator sleep bit, auto-increment, output inversion, the sixteen LED
 * groups, the ALL_LED group, and the prescaler. Subaddresses are stored but
 * have no effect, and the test register is not modelled, which is honest for
 * a single chip on a bench.
 */

import type { PartDefinition, PinSpec } from '../catalog';
import type { I2cDevice } from './device';

/** The address the module answers on, with every address jumper open. */
export const PCA9685_ADDRESS = 0x40;

/** How many PWM channels the chip has. */
export const PCA9685_CHANNELS = 16;

/** The chip's internal oscillator, in hertz. */
export const PCA9685_OSCILLATOR_HZ = 25_000_000;

/** The counter runs through twelve bits, so a period is 4096 counts. */
export const PCA9685_COUNTS = 4096;

/** The bit that means "always on" in an ON register, or "always off" in an OFF. */
export const PCA9685_FULL = 0x1000;

/**
 * The prescaler for a 50 Hz frame, which is where hobby servos live.
 *
 * `25 MHz / (4096 * 50) - 1` is 121.07; the register takes the integer part,
 * so the bench lands a little above 50 Hz, as the chip does.
 */
export const PCA9685_PRESCALE_50_HZ = 121;

/**
 * The output stage, in ohms.
 *
 * The chip's outputs are rated at 25 mA, but the bench gives every part-driven
 * output the same kilohm it gives the shift register and expanders. A light
 * on this chip therefore reads as driven rather than as a short, and the
 * number is about what the output stage looks like at a few milliamps.
 */
export const PCA9685_OUTPUT_OHMS = 1000;

/** The register map, as the datasheet numbers it. */
const MODE1 = 0x00;
const MODE2 = 0x01;
const ALLCALLADR = 0x05;
const LED0_ON_L = 0x06;
const LED_LAST = LED0_ON_L + PCA9685_CHANNELS * 4 - 1;
const ALL_LED_ON_L = 0xfa;
const PRESCALE = 0xfe;
const REGISTER_COUNT = 0x100;

/** MODE1 bits. */
const RESTART = 0x80;
const EXTCLK = 0x40;
const AI = 0x20;
const SLEEP = 0x10;
const SUB1 = 0x08;
const SUB2 = 0x04;
const SUB3 = 0x02;
const ALLCALL = 0x01;
const MODE1_BITS = RESTART | EXTCLK | AI | SLEEP | SUB1 | SUB2 | SUB3 | ALLCALL;

/** MODE2 bits. INVRT swaps the output polarity; the rest are stored. */
const INVRT = 0x10;
const MODE2_BITS = 0x1f;

/** One channel's four registers, as the counts they encode. */
interface Channel {
  on: number;
  off: number;
}

/**
 * The chip's register file and its free-running counter.
 *
 * The counter is derived from the bench's clock rather than advanced by a
 * tick: a solve can ask for any instant, and the answer has to be the same
 * whether the engine stepped there in one millisecond or one microsecond.
 */
export class Pca9685 implements I2cDevice {
  readonly address = PCA9685_ADDRESS;
  onBus = false;

  private readonly registers = new Uint8Array(REGISTER_COUNT);
  /** Which register the next byte goes to or comes from. */
  private pointer = MODE1;
  /** Output Enable asserted (active low): holds all outputs low. */
  private oe = false;

  constructor() {
    // MODE1 powers up asleep, with all-call enabled; MODE2 powers up with a
    // totem-pole output stage. The prescaler reset value is 30.
    this.registers[MODE1] = SLEEP | ALLCALL;
    this.registers[MODE2] = 0x04;
    this.registers[PRESCALE] = 0x1e;
  }

  /** Set Output Enable (asserted = all outputs held low). */
  setOE(asserted: boolean): void {
    this.oe = asserted;
  }

  /** True while the oscillator is stopped, which holds every output low. */
  get isSleeping(): boolean {
    return (this.registers[MODE1]! & SLEEP) !== 0;
  }

  /** The PWM frame rate the prescaler asks for. */
  get frequencyHz(): number {
    return PCA9685_OSCILLATOR_HZ / (PCA9685_COUNTS * (this.registers[PRESCALE]! + 1));
  }

  /** True while at least one channel is switching rather than held at a rail. */
  get isPwmActive(): boolean {
    if (this.isSleeping) return false;
    for (let channel = 0; channel < PCA9685_CHANNELS; channel++) {
      const width = this.duty(channel);
      if (width > 0 && width < 1) return true;
    }
    return false;
  }

  /**
   * One byte of a transaction.
   *
   * The first byte names the register. Every byte after it lands in the
   * register file and, when MODE1's auto-increment bit is set, moves the
   * pointer on. Without that bit the chip keeps writing the same register,
   * which is why a library sets AI before it writes a channel's four bytes.
   */
  receive(byte: number, isControlPosition: boolean): boolean {
    if (isControlPosition) {
      this.pointer = byte & 0xff;
      return true;
    }
    this.writeRegister(this.pointer, byte & 0xff);
    if (this.autoIncrement) this.pointer = (this.pointer + 1) % REGISTER_COUNT;
    return true;
  }

  /** Reads the register file from the pointer, wrapping at the end. */
  read(count: number): readonly number[] {
    const out: number[] = [];
    for (let index = 0; index < Math.max(0, count); index++) {
      out.push(this.readRegister(this.pointer));
      if (this.autoIncrement) this.pointer = (this.pointer + 1) % REGISTER_COUNT;
    }
    return out;
  }

  /**
   * The fraction of a frame a channel is high.
   *
   * This is the register's width, not the instantaneous level: a channel with
   * ON at 1024 and OFF at 3072 is high for half a frame wherever that half
   * sits. The level is what the solver stamps.
   */
  duty(channel: number): number {
    // Output Enable asserted holds all outputs low.
    if (this.oe) return 0;
    if (this.isSleeping) return 0;
    const { on, off } = this.channel(channel);
    // The datasheet gives the full-off bit precedence when both are set.
    if ((off & PCA9685_FULL) !== 0) return 0;
    if ((on & PCA9685_FULL) !== 0) return 1;
    const start = on & 0x0fff;
    const end = off & 0x0fff;
    if (start === end) return 0;
    return ((end - start + PCA9685_COUNTS) % PCA9685_COUNTS) / PCA9685_COUNTS;
  }

  /**
   * The instantaneous level of a channel at `timeMs`, as 0 or 1.
   *
   * The counter is a sawtooth across the frame. An ON count after the OFF
   * count means the high part wraps through the end of the frame, which is
   * the shape a pulse placed late in the period has.
   */
  level(channel: number, timeMs: number): number {
    if (this.isSleeping) return 0;
    const { on, off } = this.channel(channel);
    // OFF wins when both full-on and full-off are set, as the datasheet says.
    if ((off & PCA9685_FULL) !== 0) return this.inverted ? 1 : 0;
    if ((on & PCA9685_FULL) !== 0) return this.inverted ? 0 : 1;
    const start = on & 0x0fff;
    const end = off & 0x0fff;
    const periodMs = 1000 / this.frequencyHz;
    const phase = (((timeMs / periodMs) % 1) + 1) % 1;
    const count = Math.floor(phase * PCA9685_COUNTS) % PCA9685_COUNTS;
    const high =
      start === end
        ? false
        : start < end
          ? count >= start && count < end
          : count >= start || count < end;
    return (high ? 1 : 0) ^ (this.inverted ? 1 : 0);
  }

  private get autoIncrement(): boolean {
    return (this.registers[MODE1]! & AI) !== 0;
  }

  private get inverted(): boolean {
    return (this.registers[MODE2]! & INVRT) !== 0;
  }

  private channel(index: number): Channel {
    if (index < 0 || index >= PCA9685_CHANNELS) return { on: 0, off: 0 };
    const at = LED0_ON_L + index * 4;
    return {
      on: this.registers[at]! | (this.registers[at + 1]! << 8),
      off: this.registers[at + 2]! | (this.registers[at + 3]! << 8),
    };
  }

  /** Whether the datasheet gives this address a register rather than a gap. */
  private isRegister(register: number): boolean {
    return (
      register <= ALLCALLADR ||
      (register >= LED0_ON_L && register <= LED_LAST) ||
      (register >= ALL_LED_ON_L && register <= ALL_LED_ON_L + 3) ||
      register === PRESCALE
    );
  }

  private writeRegister(register: number, value: number): void {
    // Reserved addresses have no storage: a burst that runs through one writes
    // past it, and a read there answers zero.
    if (!this.isRegister(register)) return;
    if (register === MODE1) {
      // RESTART is a strobe, not a level: a write sets it, and the chip
      // clears it once the oscillator has restarted.
      this.registers[MODE1] = value & MODE1_BITS & ~RESTART;
      if ((value & RESTART) !== 0 && (value & SLEEP) === 0) this.registers[MODE1] &= ~SLEEP;
      return;
    }
    if (register === MODE2) {
      this.registers[MODE2] = value & MODE2_BITS;
      return;
    }
    if (register === PRESCALE) {
      // The datasheet allows a prescaler write only while the oscillator is
      // asleep. A sketch that writes it awake is talking past the chip.
      if (this.isSleeping) this.registers[PRESCALE] = value & 0xff;
      return;
    }
    this.registers[register] = value & 0xff;
    if (register >= ALL_LED_ON_L && register <= ALL_LED_ON_L + 3) {
      // The ALL_LED group is the same four counts applied to every channel.
      const offset = register - ALL_LED_ON_L;
      for (let index = 0; index < PCA9685_CHANNELS; index++) {
        this.registers[LED0_ON_L + index * 4 + offset] = value & 0xff;
      }
    }
  }

  private readRegister(register: number): number {
    // Reserved addresses answer zero rather than leaking whatever a walking
    // pointer left there; the five address registers above MODE2 are the only
    // stored but inert bytes, and the test register is not part of the model.
    return this.isRegister(register) ? this.registers[register]! : 0;
  }
}

/**
 * The module as it is sold: a small breakout with the bus header along one
 * edge and sixteen three-pin servo channels across the board. The bench draws
 * one pin per channel, because the middle pin of each servo header is the
 * supply and the part does not model a connector it cannot wire.
 */
export function pca9685Definition(): PartDefinition {
  const pins: PinSpec[] = [
    { id: 'VCC', label: 'VCC', x: 2.54, y: 4.0, net: 'VCC' },
    { id: 'GND', label: 'GND', x: 5.08, y: 4.0, net: 'GND' },
    { id: 'SDA', label: 'SDA', x: 7.62, y: 4.0 },
    { id: 'SCL', label: 'SCL', x: 10.16, y: 4.0 },
  ];
  for (let index = 0; index < PCA9685_CHANNELS; index++) {
    pins.push({
      id: `PWM${index}`,
      label: `${index}`,
      x: 2.54 + (index % 8) * 2.54,
      y: 18.0 + Math.floor(index / 8) * 5.08,
    });
  }
  return {
    id: 'pca9685',
    name: 'PWM driver (PCA9685)',
    category: 'output',
    widthMm: 25.4,
    heightMm: 27.94,
    component: { kind: 'pca9685' },
    pins,
    bodyColour: '#3f1d1d',
    legendColour: '#fde68a',
  };
}
