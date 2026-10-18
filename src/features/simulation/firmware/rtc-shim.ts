/**
 * RTClib value types for the firmware VM.
 *
 * `DateTime` and `TimeSpan` are values, not bench objects: a sketch copies
 * them into locals (`DateTime now = clock.now()`), compares them
 * (`alarm >= now`) and adds whole days (`alarm + TIMESPAN_DAY`), all without
 * touching the bus. Holding them as plain data here is what lets the
 * interpreter carry them through its value slots untouched, while the RTC
 * member that *does* touch the bus stays a separate handle below.
 *
 * Components read as methods (`hour()`, `day()`) rather than fields, matching
 * the RTClib spelling call sites use. A field and a method cannot share a
 * name in TypeScript, so the stored components stay private behind them.
 */

/** The bus address the DS1307 answers to, silkscreened on the breakout. */
export const DS1307_ADDRESS = 0x68;

/**
 * Where the NVRAM starts: `readnvram(i)` addresses register `0x08 + i`,
 * mirroring the bench model's plain-storage RAM at 0x08-0x1F.
 */
export const NVRAM_BASE = 0x08;

/** Packs 0-99 as two binary-coded digits, the way each time register reads. */
export function decToBcd(value: number): number {
  const clamped = Math.max(0, Math.min(99, Math.floor(value)));
  return (Math.floor(clamped / 10) << 4) | (clamped % 10);
}

/**
 * Unpacks two binary-coded digits.
 *
 * The same shift-and-mask the raw build's `clkBcd` helper applies to the
 * bytes `Wire.read` returns, so the library shim and the plain-functions
 * build decode identical registers identically.
 */
export function bcdToDec(value: number): number {
  return (((value >> 4) & 0x0f) * 10 + (value & 0x0f)) | 0;
}

export class DateTimeValue {
  private readonly storedYear: number;
  private readonly storedMonth: number;
  private readonly storedDay: number;
  private readonly storedHour: number;
  private readonly storedMinute: number;
  private readonly storedSecond: number;

  constructor(year = 2000, month = 1, day = 1, hour = 0, minute = 0, second = 0) {
    this.storedYear = year;
    this.storedMonth = month;
    this.storedDay = day;
    this.storedHour = hour;
    this.storedMinute = minute;
    this.storedSecond = second;
  }

  year(): number {
    return this.storedYear;
  }

  month(): number {
    return this.storedMonth;
  }

  day(): number {
    return this.storedDay;
  }

  hour(): number {
    return this.storedHour;
  }

  minute(): number {
    return this.storedMinute;
  }

  second(): number {
    return this.storedSecond;
  }

  /** Milliseconds since the Unix epoch, for ordering and arithmetic. */
  toMillis(): number {
    return Date.UTC(
      this.storedYear,
      this.storedMonth - 1,
      this.storedDay,
      this.storedHour,
      this.storedMinute,
      this.storedSecond,
    );
  }

  /** Rebuilds a value from epoch milliseconds, rolling days and months. */
  static fromMillis(millis: number): DateTimeValue {
    const date = new Date(millis);
    return new DateTimeValue(
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      date.getUTCDate(),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
    );
  }
}

/** Negative when `a` is earlier, zero when equal, positive when later. */
export function compareDateTime(a: DateTimeValue, b: DateTimeValue): number {
  return a.toMillis() - b.toMillis();
}

/** Whole calendar days later, rolling months and years like the calendar. */
export function addDays(value: DateTimeValue, days: number): DateTimeValue {
  return addSeconds(value, days * 86400);
}

/** Seconds later, for adding a `TimeSpan` to a `DateTime`. */
export function addSeconds(value: DateTimeValue, seconds: number): DateTimeValue {
  return DateTimeValue.fromMillis(value.toMillis() + seconds * 1000);
}

export class TimeSpanValue {
  private readonly spanDays: number;
  private readonly spanHours: number;
  private readonly spanMinutes: number;
  private readonly spanSeconds: number;

  constructor(days = 0, hours = 0, minutes = 0, seconds = 0) {
    this.spanDays = days;
    this.spanHours = hours;
    this.spanMinutes = minutes;
    this.spanSeconds = seconds;
  }

  days(): number {
    return this.spanDays;
  }

  hours(): number {
    return this.spanHours;
  }

  minutes(): number {
    return this.spanMinutes;
  }

  seconds(): number {
    return this.spanSeconds;
  }

  totalSeconds(): number {
    return ((this.spanDays * 24 + this.spanHours) * 60 + this.spanMinutes) * 60 + this.spanSeconds;
  }
}

/**
 * A live handle on the DS1307 itself, as opposed to the values above.
 *
 * It carries no state of its own: every method goes out over the bench I2C
 * the way the raw build's `clkRead`/`nvReadByte` helpers do, so two handles
 * never disagree about the time. The interpreter installs one wherever a
 * class declares an `RTC_DS1307` member.
 */
export class RtcHandle {}
