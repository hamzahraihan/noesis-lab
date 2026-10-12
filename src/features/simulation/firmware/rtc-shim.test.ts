import { describe, expect, it } from 'vitest';
import {
  DateTimeValue,
  TimeSpanValue,
  compareDateTime,
  addDays,
  addSeconds,
  bcdToDec,
  decToBcd,
  DS1307_ADDRESS,
  NVRAM_BASE,
} from './rtc-shim';
import { buildFor, galleryById } from '@/features/learn/gallery';
import { FirmwareRuntime, type FirmwareServices } from './interpreter';
import { toSingleFileProject, type FirmwareProject } from './project';

describe('rtc shim', () => {
  it('orders alarm vs now across midnight', () => {
    const now = new DateTimeValue(2026, 10, 11, 23, 59, 0);
    const alarm = new DateTimeValue(2026, 10, 11, 0, 0, 0);
    expect(compareDateTime(alarm, now) < 0).toBe(true);
    expect(addDays(alarm, 1).day()).toBe(12);
  });

  it('rolls addDays across month and year boundaries', () => {
    const newYear = addDays(new DateTimeValue(2026, 11, 30, 9, 0, 0), 32);
    expect([newYear.year(), newYear.month(), newYear.day()]).toEqual([2027, 1, 1]);
    expect(addSeconds(new DateTimeValue(2026, 10, 11, 23, 30, 0), 3600).hour()).toBe(0);
  });

  it('counts a TimeSpan in seconds and round-trips BCD', () => {
    expect(new TimeSpanValue(1, 0, 0, 0).totalSeconds()).toBe(86400);
    expect(new TimeSpanValue(0, 1, 30, 15).totalSeconds()).toBe(5415);
    for (const value of [0, 9, 10, 23, 59, 99]) {
      expect(bcdToDec(decToBcd(value))).toBe(value);
    }
    expect(DS1307_ADDRESS).toBe(0x68);
    expect(NVRAM_BASE).toBe(0x08);
  });
});

/** Minimal services: serial capture plus a scriptable clock. */
function stubServices(serial: string[], nowMs: () => number = () => 0): FirmwareServices {
  return {
    nowMs,
    pinMode: () => {},
    digitalWrite: () => {},
    digitalRead: () => 0,
    analogWrite: () => {},
    analogRead: () => 0,
    serialBegin: () => {},
    serialWrite: (text) => {
      serial.push(text);
    },
    wire: {
      begin: () => {},
      beginTransmission: () => {},
      write: () => 1,
      endTransmission: () => 0,
      requestFrom: () => 0,
      read: () => -1,
      available: () => 0,
    },
    spi: { begin: () => {}, transfer: () => 0, end: () => 0 },
  };
}

describe('DateTime and TimeSpan in the VM', () => {
  it('constructs DateTime (6-arg, 5-arg, 0-arg) and reads its fields', () => {
    const project = toSingleFileProject(
      `void setup() {
         DateTime t = DateTime(2026, 10, 11, 23, 59, 30);
         Serial.println(t.hour() * 10000 + t.minute() * 100 + t.second());
         Serial.println(t.year() * 10000 + t.month() * 100 + t.day());
         DateTime z;
         Serial.println(z.year() * 10000 + z.month() * 100 + z.day());
         DateTime s = DateTime(2026, 10, 11, 9, 5);
         Serial.println(s.second());
         TimeSpan d = TimeSpan(1, 0, 0, 0);
         Serial.println(d.totalseconds());
         DateTime alarm = DateTime(2026, 10, 11, 0, 0, 0);
         Serial.println(alarm >= t);
         Serial.println(t >= alarm);
       }
       void loop() {}`,
      'arduino-cpp',
    );
    const runtime = FirmwareRuntime.fromProject(project);
    const serial: string[] = [];
    const main = runtime.main(stubServices(serial));
    for (let step = 0; step < 50 && !main.next().done; step++);
    expect(serial.join('')).toBe('235930\n20261011\n20000101\n0\n86400\n0\n1\n');
  });

  it('evaluates expression defines (MINUTE, TIMESPAN_DAY) at runtime', () => {
    const project = toSingleFileProject(
      `#define MINUTE 60 * 1000L
       #define TIMESPAN_DAY TimeSpan(1, 0, 0, 0)
       void setup() {
         Serial.println(MINUTE);
         DateTime alarm = DateTime(2026, 10, 11, 0, 0, 0);
         DateTime next = alarm + TIMESPAN_DAY;
         Serial.println(next.day());
         Serial.println(next.month());
       }
       void loop() {}`,
      'arduino-cpp',
    );
    const runtime = FirmwareRuntime.fromProject(project);
    const serial: string[] = [];
    const main = runtime.main(stubServices(serial));
    for (let step = 0; step < 50 && !main.next().done; step++);
    expect(serial.join('')).toBe('60000\n12\n10\n');
  });

  it('folds a file-scope enum and executes switch with fallthrough', () => {
    const project = toSingleFileProject(
      `enum AlarmState { ALARM_DISABLED, ALARM_OFF, ALARM_ACTIVE };
       int probe(int s) {
         switch (s) {
           case ALARM_OFF:
             return 10;
           case ALARM_ACTIVE:
             return 20;
           default:
             return 30;
         }
       }
       int fall(int s) {
         int r = 0;
         switch (s) {
           case 1:
             r = r + 1;
           case 2:
             r = r + 10;
             break;
           default:
             r = 99;
         }
         return r;
       }
       void setup() {
         Serial.println(ALARM_DISABLED);
         Serial.println(ALARM_OFF);
         Serial.println(probe(1));
         Serial.println(probe(2));
         Serial.println(probe(9));
         Serial.println(fall(1));
         Serial.println(fall(2));
         Serial.println(fall(9));
       }
       void loop() {}`,
      'arduino-cpp',
    );
    const runtime = FirmwareRuntime.fromProject(project);
    const serial: string[] = [];
    const main = runtime.main(stubServices(serial));
    for (let step = 0; step < 50 && !main.next().done; step++);
    expect(serial.join('')).toBe('0\n1\n10\n20\n30\n11\n10\n99\n');
  });
});

/**
 * A multi-file project running the verbatim gallery `config.h`/`clock.h`/
 * `clock.cpp` tabs (pulled from the library build, never copied) under a
 * minimal sketch. Clock methods execute as bodies; only the RTC itself is
 * a bench model behind the stub I2C below.
 */
function clockProject(sketch: string): FirmwareProject {
  const library = buildFor(galleryById('alarm-clock')!, 'uno', 'library')!;
  const tab = (name: string): string => {
    const found = library.files?.find((file) => file.name === name);
    if (!found) throw new Error(`${name}: gallery tab missing`);
    return found.content;
  };
  return {
    language: 'arduino-cpp',
    files: [
      { name: 'main.ino', content: sketch },
      { name: 'config.h', content: tab('config.h') },
      { name: 'clock.h', content: tab('clock.h') },
      { name: 'clock.cpp', content: tab('clock.cpp') },
    ],
    activeName: 'main.ino',
  };
}

interface RtcBench {
  services: FirmwareServices;
  serial: string[];
  regs: Uint8Array;
  setTime(y: number, mo: number, d: number, h: number, mi: number, s: number): void;
}

/**
 * Stub I2C bench modelling the DS1307 register map the VM drives: time
 * registers at 0x00-0x02 (plus date at 0x04-0x06), NVRAM at 0x08 and up.
 * `present: false` answers nothing, the way the engine does with no part
 * on the bus.
 */
function makeRtcBench(present = true, nowMs: () => number = () => 0): RtcBench {
  const serial: string[] = [];
  const regs = new Uint8Array(0x20);
  let pointer = 0;
  let transmitting = false;
  let payload: number[] = [];
  let readBuf: number[] = [];
  const services: FirmwareServices = {
    nowMs,
    pinMode: () => {},
    digitalWrite: () => {},
    digitalRead: () => 0,
    analogWrite: () => {},
    analogRead: () => 0,
    serialBegin: () => {},
    serialWrite: (text) => {
      serial.push(text);
    },
    wire: {
      begin: () => {},
      beginTransmission: () => {
        transmitting = true;
        payload = [];
      },
      write: (value: number) => {
        if (transmitting) payload.push(value & 0xff);
        return 1;
      },
      endTransmission: () => {
        transmitting = false;
        if (!present) return 0;
        payload.forEach((byte, index) => {
          if (index === 0) pointer = byte & 0x7f;
          else {
            if (pointer < regs.length) regs[pointer] = byte;
            pointer = (pointer + 1) & 0x7f;
          }
        });
        return 0;
      },
      requestFrom: (_address: number, count: number) => {
        readBuf = present ? [...regs.slice(pointer, pointer + count)] : [];
        return readBuf.length;
      },
      read: () => (readBuf.length > 0 ? (readBuf.shift() as number) : -1),
      available: () => readBuf.length,
    },
    spi: { begin: () => {}, transfer: () => 0, end: () => 0 },
  };
  return {
    services,
    serial,
    regs,
    setTime(y, mo, d, h, mi, s) {
      regs[0x00] = decToBcd(s);
      regs[0x01] = decToBcd(mi);
      regs[0x02] = decToBcd(h);
      regs[0x04] = decToBcd(d);
      regs[0x05] = decToBcd(mo);
      regs[0x06] = decToBcd(y % 100);
    },
  };
}

function runClock(bench: RtcBench, sketch: string): string {
  const runtime = FirmwareRuntime.fromProject(clockProject(sketch));
  const main = runtime.main(bench.services);
  for (let step = 0; step < 200 && !main.next().done; step++);
  return bench.serial.join('');
}

describe('Clock class end to end', () => {
  it('loads NVRAM in begin and persists toggle and alarm increments', () => {
    const bench = makeRtcBench();
    bench.setTime(2026, 10, 11, 8, 0, 0);
    bench.regs[0x08] = 1;
    bench.regs[0x09] = 9;
    bench.regs[0x0a] = 30;
    const output = runClock(
      bench,
      `#include "clock.h"
       Clock clock;
       void setup() {
         clock.begin();
         Serial.println(clock.alarmEnabled());
         DateTime a = clock.alarmTime();
         Serial.println(a.hour() * 100 + a.minute());
         clock.toggleAlarm();
         Serial.println(clock.alarmEnabled());
         clock.incrementAlarmHour();
         clock.incrementAlarmMinute();
         DateTime b = clock.alarmTime();
         Serial.println(b.hour() * 100 + b.minute());
       }
       void loop() {}`,
    );
    expect(output).toBe('1\n930\n0\n1031\n');
    expect(bench.regs[0x08]).toBe(0);
    expect(bench.regs[0x09]).toBe(10);
    expect(bench.regs[0x0a]).toBe(31);
  });

  it('round-trips now through adjust on incrementHour and incrementMinute', () => {
    const bench = makeRtcBench();
    bench.setTime(2026, 10, 11, 23, 59, 0);
    const output = runClock(
      bench,
      `#include "clock.h"
       Clock clock;
       void setup() {
         clock.begin();
         DateTime a = clock.now();
         Serial.println(a.hour() * 100 + a.minute());
         clock.incrementMinute();
         DateTime b = clock.now();
         Serial.println(b.hour() * 100 + b.minute());
         clock.incrementHour();
         DateTime c = clock.now();
         Serial.println(c.hour() * 100 + c.minute());
       }
       void loop() {}`,
    );
    // incrementMinute wraps the minute without rolling the day, exactly as
    // the gallery source reads: 23:59 becomes 23:00, then hour+1 is 00:00.
    expect(output).toBe('2359\n2300\n0\n');
  });

  it('rolls alarmTime past midnight and reports alarmActive only when due', () => {
    const bench = makeRtcBench();
    bench.setTime(2026, 10, 11, 23, 59, 0);
    bench.regs[0x08] = 1;
    bench.regs[0x09] = 0;
    bench.regs[0x0a] = 0;
    const output = runClock(
      bench,
      `#include "clock.h"
       Clock clock;
       void setup() {
         clock.begin();
         DateTime a = clock.alarmTime();
         Serial.println(a.day());
         Serial.println(a.hour() * 100 + a.minute());
         Serial.println(clock.alarmActive());
       }
       void loop() {}`,
    );
    expect(output).toBe('12\n0\n0\n');
  });

  it('rings when due, holds through snooze, and stops on stopAlarm', () => {
    const firedAt = 1000000;
    let calls = 0;
    const bench = makeRtcBench(true, () => {
      calls++;
      // snooze() stamps millis() once; the two alarmActive() polls below
      // land just inside and exactly on the 9-minute snooze window.
      if (calls === 1) return firedAt;
      if (calls === 2) return firedAt + 9 * 60000 - 1;
      return firedAt + 9 * 60000;
    });
    bench.setTime(2026, 10, 11, 10, 30, 0);
    bench.regs[0x08] = 1;
    bench.regs[0x09] = 10;
    bench.regs[0x0a] = 30;
    const output = runClock(
      bench,
      `#include "clock.h"
       Clock clock;
       void setup() {
         clock.begin();
         Serial.println(clock.alarmActive());
         clock.snooze();
         Serial.println(clock.alarmActive());
         Serial.println(clock.alarmActive());
         clock.stopAlarm();
         Serial.println(clock.alarmActive());
       }
       void loop() {}`,
    );
    expect(output).toBe('1\n0\n1\n0\n');
  });

  it('reports a missing RTC on the bench and keeps running past abort', () => {
    const bench = makeRtcBench(false);
    const output = runClock(
      bench,
      `#include "clock.h"
       Clock clock;
       void setup() {
         clock.begin();
         Serial.println(99);
       }
       void loop() {}`,
    );
    // begin() probes the bus and finds nothing, so Clock::begin prints and
    // calls abort(); the VM treats abort as a no-op and setup continues.
    expect(output).toBe("Couldn't find RTC\n99\n");
  });
});

describe('RTC read caching', () => {
  function countingBench(nowMs: () => number = () => 0): {
    bench: RtcBench;
    services: FirmwareServices;
    requests: () => number;
  } {
    const bench = makeRtcBench(true, nowMs);
    bench.setTime(2026, 10, 11, 9, 30, 0);
    let requests = 0;
    const services: FirmwareServices = {
      ...bench.services,
      wire: {
        ...bench.services.wire,
        requestFrom: (address: number, count: number) => {
          requests++;
          return bench.services.wire.requestFrom(address, count);
        },
      },
    };
    return { bench, services, requests: () => requests };
  }

  function drain(runtime: FirmwareRuntime, services: FirmwareServices, steps = 20): void {
    const main = runtime.main(services);
    for (let step = 0; step < steps && !main.next().done; step++) {
      // Drain setup; the empty loop then idles.
    }
  }

  it('reads the RTC once per 100ms window', () => {
    const { services, requests } = countingBench(() => 0);
    const runtime = FirmwareRuntime.fromProject(
      toSingleFileProject(
        `RTC_DS1307 rtc;
         void setup() {
           rtc.begin();
           rtc.now(); rtc.now(); rtc.now(); rtc.now(); rtc.now();
         }
         void loop() {}`,
        'arduino-cpp',
      ),
    );
    drain(runtime, services);
    // begin() probes once + five now() calls in window 0 share one read.
    expect(requests()).toBe(2);
  });

  it('re-reads after adjust and shows the adjusted time', () => {
    const { bench, services } = countingBench(() => 0);
    const runtime = FirmwareRuntime.fromProject(
      toSingleFileProject(
        `RTC_DS1307 rtc;
         void setup() {
           rtc.begin();
           DateTime a = rtc.now();
           Serial.println(a.hour());
           rtc.adjust(DateTime(2026, 10, 11, 10, 45, 0));
           DateTime b = rtc.now();
           Serial.println(b.hour() * 100 + b.minute());
         }
         void loop() {}`,
        'arduino-cpp',
      ),
    );
    drain(runtime, services, 30);
    // Without cache invalidation the second read would print the stale 930.
    expect(bench.serial.join('')).toBe('9\n1045\n');
  });
});
