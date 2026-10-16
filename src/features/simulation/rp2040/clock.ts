/**
 * The engine's clock: a structural mirror of rp2040js's SimulationClock.
 *
 * rp2040js keeps its clock class behind a package `exports` allowlist, so the
 * engine cannot hand the stock class to `new RP2040(clock)` — it hands this
 * one instead. Behaviour mirrors SimulationClock exactly: alarms fire in
 * scheduled order *at their instant*, not at the tick boundary, because
 * peripheral timing (PIO state machines, PWM) depends on that.
 */

type AlarmCallback = () => void;

/** Structural twin of rp2040js's IAlarm, kept local to avoid the unexported import. */
interface ClockAlarmHandle {
  schedule(deltaNanos: number): void;
  cancel(): void;
}

class Rp2040Alarm implements ClockAlarmHandle {
  next: Rp2040Alarm | null = null;
  nanos = 0;
  scheduled = false;
  readonly callback: AlarmCallback;
  private readonly clock: Rp2040Clock;

  constructor(clock: Rp2040Clock, callback: AlarmCallback) {
    this.clock = clock;
    this.callback = callback;
  }

  schedule(deltaNanos: number): void {
    if (this.scheduled) {
      this.cancel();
    }
    this.clock.linkAlarm(deltaNanos, this);
  }

  cancel(): void {
    this.clock.unlinkAlarm(this);
    this.scheduled = false;
  }
}

export class Rp2040Clock {
  private nextAlarm: Rp2040Alarm | null = null;
  private nanosCounter = 0;

  get nanos(): number {
    return this.nanosCounter;
  }

  get micros(): number {
    return this.nanosCounter / 1000;
  }

  createAlarm(callback: AlarmCallback): Rp2040Alarm {
    return new Rp2040Alarm(this, callback);
  }

  /** Link an alarm at `nanos` from now, keeping the list sorted by instant. */
  linkAlarm(nanos: number, alarm: Rp2040Alarm): void {
    alarm.nanos = this.nanosCounter + nanos;
    let item = this.nextAlarm;
    let last: Rp2040Alarm | null = null;
    while (item && item.nanos < alarm.nanos) {
      last = item;
      item = item.next;
    }
    if (last) {
      last.next = alarm;
    } else {
      this.nextAlarm = alarm;
    }
    alarm.next = item;
    alarm.scheduled = true;
  }

  unlinkAlarm(alarm: Rp2040Alarm): boolean {
    let item = this.nextAlarm;
    let last: Rp2040Alarm | null = null;
    while (item) {
      if (item === alarm) {
        if (last) {
          last.next = item.next;
        } else {
          this.nextAlarm = item.next;
        }
        return true;
      }
      last = item;
      item = item.next;
    }
    return false;
  }

  /**
   * Advance to `nanos + deltaNanos`, firing every alarm that comes due at its
   * own instant. The head is re-read after each callback so alarms scheduled
   * from inside one still fire within the same tick when due.
   */
  tick(deltaNanos: number): void {
    const targetNanos = this.nanosCounter + deltaNanos;
    let alarm = this.nextAlarm;
    while (alarm && alarm.nanos <= targetNanos) {
      this.nextAlarm = alarm.next;
      this.nanosCounter = alarm.nanos;
      alarm.callback();
      alarm = this.nextAlarm;
    }
    this.nanosCounter = targetNanos;
  }

  /** Nanoseconds until the next alarm; 0 when none is scheduled. */
  get nanosToNextAlarm(): number {
    if (this.nextAlarm) {
      return this.nextAlarm.nanos - this.nanosCounter;
    }
    return 0;
  }
}
