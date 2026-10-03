/**
 * DS1307 real-time clock: the coin-cell module sold as a 4-pin I2C breakout.
 *
 * The model speaks the register protocol rather than offering a "what time is
 * it" call, because the protocol is the whole exercise. A sketch points the
 * chip at 0x00, asks for seven bytes, and decodes BCD itself; point it at the
 * wrong register and it gets a plausible-looking wrong answer, which is exactly
 * what a real clock does.
 *
 * The time comes from the host, so what a sketch reads is the bench's
 * simulated time rather than a date frozen into the part when it was placed.
 *
 * The MPU-6050 answers at the same 0x68, because the address is fixed on both
 * chips. That is not a shortcut in the model: it is what the two parts do, and
 * only one of them can be on a bus at a time. The bench does not detect the
 * clash -- a write goes to every part that answers the address, and a read is
 * answered by whichever of them the engine reaches first.
 */
import { type I2cDevice } from './device';

/** The address the module silkscreens, and the only one the chip answers to. */
export const DS1307_ADDRESS = 0x68;

/** Seconds through year: the seven BCD time registers. */
const SECONDS = 0x00;
const MINUTES = 0x01;
const HOURS = 0x02;
const DAY_OF_WEEK = 0x03;
const DATE = 0x04;
const MONTH = 0x05;
const YEAR = 0x06;
/** Bit 6 enables the square wave on SQW, bit 7 turns the oscillator output off. */
const CONTROL = 0x07;

/** The register file: the eight defined registers, then 24 bytes of RAM. */
const REGISTER_COUNT = 0x20;

/**
 * Bit 7 of the seconds register: the oscillator-halt flag.
 *
 * The datasheet describes CH as a thing the crystal does, separately from the
 * count it sits beside, so it is held as a flag of its own and folded into the
 * register on the way out. That is what lets a sketch write the seconds -- the
 * thing a sketch does when it sets the clock -- without taking the flag with
 * it, and read it back still standing.
 */
const OSCILLATOR_STOPPED = 0x80;

/**
 * The bits each defined register actually implements.
 *
 * The reserved bits of the time registers read back as zero, so a sketch that
 * masks them is right and one that does not gets the same answer. The RAM at
 * 0x08 to 0x1F is plain storage and needs no entry.
 */
const REGISTER_MASK: Readonly<Record<number, number>> = {
  [SECONDS]: 0x7f,
  [MINUTES]: 0x3f,
  [HOURS]: 0x7f,
  [DAY_OF_WEEK]: 0x07,
  [DATE]: 0x1f,
  [MONTH]: 0x1f,
  [CONTROL]: 0xc0,
};

/**
 * Packs a number as two binary-coded digits: the tens in the high nibble, the
 * units in the low one, which is how every DS1307 time register is read.
 */
function toBcd(value: number): number {
  return (Math.floor(value / 10) << 4) | (value % 10);
}

export class Ds1307 implements I2cDevice {
  readonly address = DS1307_ADDRESS;
  onBus = false;

  private readonly registers = new Uint8Array(REGISTER_COUNT);
  /** Where the next written byte lands, and where the next read starts. */
  private pointer = SECONDS;
  /**
   * The chip has no crystal of its own in the model, so the time is whatever
   * the host last set. Untouched it reads 00:00:00 on 1 January 2000: the
   * datasheet leaves the time registers undefined at power-up, so any answer
   * here is the bench's choice, and that is the one it makes.
   */
  private clock = new Date(2000, 0, 1);
  /** True while the host's clock, rather than a sketch's write, owns the time. */
  private followingHost = false;
  private oscillatorStopped = false;

  /**
   * Tells the clock what time it is.
   *
   * Call this as the bench's simulated time moves rather than once when the
   * part is placed: the seconds only advance when the host advances them. A
   * sketch that writes the time registers takes the calendar over -- the chip
   * holds what was written, as it does -- and the next `setTime` takes it back.
   */
  setTime(date: Date): void {
    this.clock = new Date(date.getTime());
    this.followingHost = true;
    this.pack();
  }

  /**
   * Stops or starts the crystal, which is what bit 7 of the seconds register
   * reports and what a sketch watching that bit is really asking: has this
   * clock ever been trusted?
   *
   * Nothing on the bench stops a crystal, so it reads clear unless the host
   * says otherwise.
   */
  setOscillatorStopped(stopped: boolean): void {
    this.oscillatorStopped = stopped;
  }

  receive(byte: number, isControlPosition: boolean): boolean {
    if (isControlPosition) {
      // The register address is seven bits wide, so a pointer left to itself
      // walks the whole space and comes back round to 0x00.
      this.pointer = byte & 0x7f;
      return true;
    }
    this.write(this.pointer, byte);
    this.pointer = (this.pointer + 1) & 0x7f;
    return true;
  }

  read(count: number): readonly number[] {
    if (this.followingHost) this.pack();
    const out: number[] = [];
    for (let index = 0; index < count; index++) {
      const register = this.pointer + index;
      // Above the RAM there is no register at all, and the bus has no way of
      // saying so: the reserved space answers with zeros.
      out.push(register < REGISTER_COUNT ? this.registers[register] : 0);
    }
    return out;
  }

  private write(register: number, value: number): void {
    if (register === SECONDS) {
      this.registers[SECONDS] =
        (value & REGISTER_MASK[SECONDS]) | (this.registers[SECONDS] & OSCILLATOR_STOPPED);
      this.followingHost = false;
      return;
    }
    this.registers[register] = value & (REGISTER_MASK[register] ?? 0xff);
    if (register < CONTROL) this.followingHost = false;
  }

  /** Lays the host's clock into the time registers, the way the crystal would. */
  private pack(): void {
    this.registers[SECONDS] =
      toBcd(this.clock.getSeconds()) | (this.oscillatorStopped ? OSCILLATOR_STOPPED : 0);
    this.registers[MINUTES] = toBcd(this.clock.getMinutes());
    this.registers[HOURS] = toBcd(this.clock.getHours());
    // Sunday is 0 to JavaScript and 7 on the chip.
    this.registers[DAY_OF_WEEK] = toBcd(this.clock.getDay() === 0 ? 7 : this.clock.getDay());
    this.registers[DATE] = toBcd(this.clock.getDate());
    this.registers[MONTH] = toBcd(this.clock.getMonth() + 1);
    this.registers[YEAR] = toBcd(this.clock.getFullYear() % 100);
  }
}
