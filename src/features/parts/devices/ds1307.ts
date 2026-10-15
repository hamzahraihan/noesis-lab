/**
 * DS1307 real-time clock: the coin-cell module sold as a 4-pin I2C breakout.
 *
 * The model speaks the register protocol rather than offering a "what time is
 * it" call, because the protocol is the whole exercise. A sketch points the
 * chip at 0x00, asks for seven bytes, and decodes BCD itself; point it at the
 * wrong register and it gets a plausible-looking wrong answer, which is exactly
 * what a real clock does.
 *
 * The time comes from the host while no sketch has set it; once a sketch
 * writes the time registers, the host only advances that set time at host
 * rate — the way the crystal would carry a set clock — instead of replacing
 * it. Untouched, the chip follows simulated time from its power-up midnight.
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

/**
 * Decodes two binary-coded digits, or null when either nibble is no digit.
 */
function fromBcd(value: number): number | null {
  const tens = value >> 4;
  const units = value & 0x0f;
  if (tens > 9 || units > 9) return null;
  return tens * 10 + units;
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
  /**
   * True while the host's clock, rather than a sketch's write, owns the time.
   *
   * Power-up follows the host until the first sketch write to a time
   * register. After that the host only ADVANCES the sketch-set time (see
   * setTime): taking it back erased Hour/Minute button edits on the very
   * next step, freezing the alarm clock at midnight.
   */
  private followingHost = true;
  /** Host milliseconds of the last setTime, for advancing sketch-set time. */
  private lastHostMs = Number.NEGATIVE_INFINITY;
  private oscillatorStopped = false;

  /**
   * Tells the clock what time it is.
   *
   * Call this as the bench's simulated time moves rather than once when the
   * part is placed: the seconds only advance when the host advances them.
   *
   * While the host owns the time the registers track it exactly. Once a
   * sketch has written the time registers, the host time only moves the
   * sketch-set time forward at host rate — the way the crystal would carry
   * a set clock — instead of replacing it. A sketch that writes the time
   * registers takes the calendar over and keeps it.
   */
  setTime(date: Date): void {
    const hostMs = date.getTime();
    if (this.followingHost) {
      this.clock = new Date(hostMs);
    } else {
      // No host contact yet (preset before the first advance): zero delta
      // keeps the decoded base exactly instead of clobbering it.
      const delta = Number.isFinite(this.lastHostMs) ? hostMs - this.lastHostMs : 0;
      const base = this.decodeRegisters();
      this.clock = base === null ? new Date(hostMs) : new Date(base + delta);
    }
    this.lastHostMs = hostMs;
    this.pack();
  }

  /**
   * Reads the sketch-written time registers as milliseconds, or null when
   * they hold no valid calendar (all-zero power-up state, never written).
   * Hours decode in 24-hour mode, which is what every shipped sketch uses.
   */
  private decodeRegisters(): number | null {
    const seconds = fromBcd(this.registers[SECONDS] & 0x7f);
    const minutes = fromBcd(this.registers[MINUTES] & 0x3f);
    const hours = fromBcd(this.registers[HOURS] & 0x3f);
    const date = fromBcd(this.registers[DATE] & 0x1f);
    const month = fromBcd(this.registers[MONTH] & 0x1f);
    const year = fromBcd(this.registers[YEAR]);
    if (
      seconds === null || seconds > 59 ||
      minutes === null || minutes > 59 ||
      hours === null || hours > 23 ||
      date === null || date < 1 || date > 31 ||
      month === null || month < 1 || month > 12 ||
      year === null
    ) {
      return null;
    }
    return new Date(2000 + year, month - 1, date, hours, minutes, seconds).getTime();
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

  /**
   * Seeds the chip to a starting time plus NVRAM bytes, for benches whose
   * story starts mid-day (an alarm clock at 15:00, not midnight).
   *
   * Writes go through the same path as a sketch transmission, so ownership
   * flips to the chip exactly as if firmware had set it: the host advances
   * the seeded time from here rather than replacing it. NVRAM addresses are
   * absolute registers (the alarm layout lives at 0x08-0x0A, matching
   * RTClib's 0x08-based nvram mapping); out-of-range addresses are ignored.
   */
  applyPreset(
    hours: number,
    minutes: number,
    seconds: number,
    nvram: ReadonlyArray<readonly [number, number]> = [],
  ): void {
    const at = new Date(2000, 0, 1, hours, minutes, seconds);
    this.write(SECONDS, toBcd(at.getSeconds()));
    this.write(MINUTES, toBcd(at.getMinutes()));
    this.write(HOURS, toBcd(at.getHours()));
    this.write(DAY_OF_WEEK, toBcd(6));
    this.write(DATE, toBcd(at.getDate()));
    this.write(MONTH, toBcd(at.getMonth() + 1));
    this.write(YEAR, toBcd(at.getFullYear() % 100));
    for (const [address, value] of nvram) {
      if (address >= 0 && address < REGISTER_COUNT) this.write(address, value);
    }
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
