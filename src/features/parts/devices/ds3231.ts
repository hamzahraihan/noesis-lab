/**
 * DS3231 real-time clock: the precision clock on the same four-pin breakout
 * the DS1307 uses, with a thermometer on the die.
 *
 * The time registers are the DS1307's, in the same BCD packing, so a sketch
 * that reads a clock a register at a time reads this one the same way. What is
 * different is above them: the DS3231 spends 0x07 to 0x0D on two alarms, puts
 * its control and status at 0x0E and 0x0F, and answers its own temperature at
 * 0x11 and 0x12. The DS1307's RAM is not here, and a sketch that points at
 * 0x08 expecting NVRAM reads an alarm instead -- which is a mistake the bench
 * lets a sketch make, because the chips really do disagree there.
 *
 * The oscillator-stop flag is the part of the story a clock project cares
 * about: a fresh chip reports that it has lost power until a sketch sets the
 * time. The bench clears it when the time registers are written, because
 * writing the time is the act that makes the clock trustworthy.
 */
import type { KnobSpec } from '../catalog';
import type { I2cDevice } from './device';

/** The address the module silkscreens, and the only one the chip answers to. */
export const DS3231_ADDRESS = 0x68;

/**
 * The temperature the chip's own thermometer reads.
 *
 * The DS3231 measures its die, not the room, but on a bench the die is the
 * only place a knob can reach. Quarter-degree steps are what the chip reports.
 */
export const DS3231_TEMPERATURE_KNOB: KnobSpec = {
  id: 'temperature',
  label: 'Die temperature',
  min: -40,
  max: 85,
  step: 0.25,
  unit: '°C',
  defaultValue: 25,
};

/** Seconds through year: the seven BCD time registers. */
const SECONDS = 0x00;
const MINUTES = 0x01;
const HOURS = 0x02;
const DAY_OF_WEEK = 0x03;
const DATE = 0x04;
const MONTH = 0x05;
const YEAR = 0x06;

/** Control, status, aging and the die temperature, above the two alarms. */
const CONTROL = 0x0e;
const STATUS = 0x0f;
const AGING = 0x10;
const TEMPERATURE_MSB = 0x11;
const TEMPERATURE_LSB = 0x12;
/** The last defined register; everything above it answers zero. */
const REGISTER_COUNT = 0x13;

/**
 * The bits each defined register actually implements.
 *
 * The reserved bits of the time registers read back as zero, so a sketch that
 * masks them is right and one that does not gets the same answer. The alarms
 * are byte-wide: their top bits are the mask flags, not spare bits.
 */
const REGISTER_MASK: Readonly<Record<number, number>> = {
  [SECONDS]: 0x7f,
  [MINUTES]: 0x7f,
  [HOURS]: 0x7f,
  [DAY_OF_WEEK]: 0x07,
  [DATE]: 0x3f,
  [MONTH]: 0x1f,
  [YEAR]: 0xff,
  [CONTROL]: 0xff,
  [STATUS]: 0x8f,
  [AGING]: 0xff,
};

/** Bit 7 of the status register: the oscillator stopped, so the time is lost. */
const OSCILLATOR_STOPPED = 0x80;

/** Packs a number as two binary-coded digits. */
function toBcd(value: number): number {
  return (Math.floor(value / 10) << 4) | (value % 10);
}

/** Decodes two binary-coded digits, or null when either nibble is no digit. */
function fromBcd(value: number): number | null {
  const tens = value >> 4;
  const units = value & 0x0f;
  if (tens > 9 || units > 9) return null;
  return tens * 10 + units;
}

export class Ds3231 implements I2cDevice {
  readonly address = DS3231_ADDRESS;
  onBus = false;

  private readonly registers = new Uint8Array(REGISTER_COUNT);
  /** Where the next written byte lands, and where the next read starts. */
  private pointer = SECONDS;
  /**
   * The chip has no crystal of its own in the model, so the time is whatever
   * the host last set. Untouched it reads 00:00:00 on 1 January 2000, with
   * the oscillator flag set: a fresh chip has not been trusted with a time.
   */
  private clock = new Date(2000, 0, 1);
  /** True while the host's clock, rather than a sketch's write, owns the time. */
  private followingHost = true;
  /** Host milliseconds of the last setTime, for advancing sketch-set time. */
  private lastHostMs = Number.NEGATIVE_INFINITY;
  /** The die temperature, in degrees Celsius, before the source is read. */
  private temperature = 25;
  /** Where the die temperature comes from, when the operator has a dial. */
  private temperatureSource: (() => number) | null = null;

  constructor() {
    this.registers[STATUS] = OSCILLATOR_STOPPED;
  }

  /**
   * Tells the clock what time it is.
   *
   * While the host owns the time the registers track it exactly. Once a
   * sketch has written the time registers, the host time only moves the
   * sketch-set time forward at host rate -- the way the crystal would carry
   * a set clock -- instead of replacing it.
   */
  setTime(date: Date): void {
    const hostMs = date.getTime();
    if (this.followingHost) {
      this.clock = new Date(hostMs);
    } else {
      const delta = Number.isFinite(this.lastHostMs) ? hostMs - this.lastHostMs : 0;
      this.clock = new Date(this.clock.getTime() + delta);
    }
    this.lastHostMs = hostMs;
    this.pack();
  }

  /**
   * Points the thermometer at the die temperature the operator dialled in.
   *
   * The chip reads its own die when a sketch asks for the temperature, so a
   * knob turned between two reads is seen by the very next one.
   */
  setTemperatureSource(read: () => number): void {
    this.temperatureSource = read;
  }

  /** The die temperature, in degrees Celsius, as the chip would report it. */
  temperatureCelsius(): number {
    if (this.temperatureSource) this.temperature = this.temperatureSource();
    return this.temperature;
  }

  /** Whether the clock has lost power since it was last set. */
  lostPower(): boolean {
    return (this.registers[STATUS] & OSCILLATOR_STOPPED) !== 0;
  }

  /**
   * Seeds the chip to a starting time, for benches whose story starts
   * mid-day rather than at the power-up midnight.
   *
   * The writes go through the same path as a sketch transmission, so
   * ownership flips to the chip exactly as if firmware had set it.
   */
  applyPreset(hours: number, minutes: number, seconds: number): void {
    const at = new Date(2000, 0, 1, hours, minutes, seconds);
    this.write(SECONDS, toBcd(at.getSeconds()));
    this.write(MINUTES, toBcd(at.getMinutes()));
    this.write(HOURS, toBcd(at.getHours()));
    this.write(DAY_OF_WEEK, toBcd(at.getDay() === 0 ? 7 : at.getDay()));
    this.write(DATE, toBcd(at.getDate()));
    this.write(MONTH, toBcd(at.getMonth() + 1));
    this.write(YEAR, toBcd(at.getFullYear() % 100));
  }

  receive(byte: number, isControlPosition: boolean): boolean {
    if (isControlPosition) {
      this.pointer = byte & 0xff;
      return true;
    }
    this.write(this.pointer, byte);
    this.pointer = (this.pointer + 1) & 0xff;
    return true;
  }

  read(count: number): readonly number[] {
    if (this.followingHost) this.pack();
    const out: number[] = [];
    for (let index = 0; index < count; index++) {
      out.push(this.register((this.pointer + index) & 0xff));
    }
    return out;
  }

  /** The byte at a register address, zero for the addresses that hold none. */
  private register(address: number): number {
    if (address === TEMPERATURE_MSB) return (this.temperatureCounts() >> 2) & 0xff;
    if (address === TEMPERATURE_LSB) return (this.temperatureCounts() & 0x03) << 6;
    if (address >= REGISTER_COUNT) return 0;
    return this.registers[address] ?? 0;
  }

  /**
   * The temperature in quarter-degree counts, as a ten-bit signed number.
   *
   * Negative temperatures are two's complement, which is what the chip's
   * twelve-bit frame is: the four low bits of the LSB are the fraction, and
   * the top two of the ten are the sign.
   */
  private temperatureCounts(): number {
    return Math.round(this.temperatureCelsius() * 4) & 0x3ff;
  }

  private write(register: number, value: number): void {
    const masked = value & (REGISTER_MASK[register] ?? 0xff);
    const pastTheTime = register > YEAR;
    this.registers[register] = masked;
    if (pastTheTime) return;
    /*
     * A write to a time register is a sketch setting the clock. The DS1307
     * keeps its oscillator flag through that; this chip's project story is
     * the other way round -- a clock that was just set is a clock that has
     * not lost power -- so the flag clears here.
     */
    this.registers[STATUS] &= ~OSCILLATOR_STOPPED;
    this.followingHost = false;
    this.adoptRegisters();
  }

  /**
   * Re-bases the running clock onto the written time registers.
   *
   * A sketch writes the seven registers in one burst, so the intermediate
   * states of that burst are not a valid calendar; only the one that is
   * becomes the clock.
   */
  private adoptRegisters(): void {
    const base = this.decodeRegisters();
    if (base !== null) this.clock = new Date(base);
  }

  /** Reads the time registers as milliseconds, or null when they hold no calendar. */
  private decodeRegisters(): number | null {
    const seconds = fromBcd(this.registers[SECONDS]! & 0x7f);
    const minutes = fromBcd(this.registers[MINUTES]! & 0x7f);
    const hours = fromBcd(this.registers[HOURS]! & 0x3f);
    const date = fromBcd(this.registers[DATE]! & 0x3f);
    const month = fromBcd(this.registers[MONTH]! & 0x1f);
    const year = fromBcd(this.registers[YEAR]!);
    if (
      seconds === null ||
      seconds > 59 ||
      minutes === null ||
      minutes > 59 ||
      hours === null ||
      hours > 23 ||
      date === null ||
      date < 1 ||
      date > 31 ||
      month === null ||
      month < 1 ||
      month > 12 ||
      year === null
    ) {
      return null;
    }
    return new Date(2000 + year, month - 1, date, hours, minutes, seconds).getTime();
  }

  /** Lays the host's clock into the time registers, the way the crystal would. */
  private pack(): void {
    this.registers[SECONDS] = toBcd(this.clock.getSeconds());
    this.registers[MINUTES] = toBcd(this.clock.getMinutes());
    this.registers[HOURS] = toBcd(this.clock.getHours());
    // Sunday is 0 to JavaScript and 7 on the chip.
    this.registers[DAY_OF_WEEK] = toBcd(this.clock.getDay() === 0 ? 7 : this.clock.getDay());
    this.registers[DATE] = toBcd(this.clock.getDate());
    this.registers[MONTH] = toBcd(this.clock.getMonth() + 1);
    this.registers[YEAR] = toBcd(this.clock.getFullYear() % 100);
  }
}


