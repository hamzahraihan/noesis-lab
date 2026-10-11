import { describe, expect, it } from 'vitest';
import { FirmwareRuntime, type FirmwareServices } from './interpreter';
import { toSingleFileProject } from './project';

interface DriveLog {
  pinModes: Array<{ pin: number; mode: number }>;
  writes: Array<{ pin: number; level: number }>;
  now: number;
}

/** Services stub that records every GPIO drive, with scriptable time. */
function makeDrive(): { services: FirmwareServices; log: DriveLog } {
  const log: DriveLog = { pinModes: [], writes: [], now: 0 };
  const services: FirmwareServices = {
    nowMs: () => log.now,
    pinMode: (pin, mode) => {
      log.pinModes.push({ pin, mode });
    },
    digitalWrite: (pin, level) => {
      log.writes.push({ pin, level: level !== 0 ? 1 : 0 });
    },
    digitalRead: () => 1,
    analogWrite: () => {},
    analogRead: () => 0,
    serialBegin: () => {},
    serialWrite: () => {},
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
  return { services, log };
}

const SEVSEG_SETUP = `
SevSeg sevseg;
void setup() {
  byte digitPins[] = {2, 3, 4, 5};
  byte segmentPins[] = {6, 7, 8, 9, 10, 11, 12};
  sevseg.begin(1, 4, digitPins, segmentPins, false, false, true, true);
}
`;

describe('deduced-size arrays', () => {
  it('sizes a global and a local from their initialisers', () => {
    const runtime = FirmwareRuntime.fromProject(
      toSingleFileProject(
        `byte pins[] = {2, 3, 4, 5};
         void setup() {
           byte local[] = {6, 7};
           Serial.println(pins[3] + local[1]);
         }
         void loop() {}`,
        'arduino-cpp',
      ),
    );
    const serial: string[] = [];
    const drive = makeDrive();
    const main = runtime.main({
      ...drive.services,
      serialWrite: (text) => {
        serial.push(text);
      },
    });
    for (let step = 0; step < 10 && !main.next().done; step++) {
      // Drain setup; the loop then idles.
    }
    // pins[3] is 5 and local[1] is 7: the stores sized from the braces
    // rather than erroring or reading zero.
    expect(serial.join('')).toBe('12\n');
  });

  it('resolves sizeof over a deduced array', () => {
    const runtime = FirmwareRuntime.fromProject(
      toSingleFileProject(
        `static const uint16_t TONES[] = {500, 800};
         const uint16_t NUM_TONES = sizeof(TONES) / sizeof(TONES[0]);
         void setup() { Serial.println(NUM_TONES); }
         void loop() {}`,
        'arduino-cpp',
      ),
    );
    const serial: string[] = [];
    const drive = makeDrive();
    const main = runtime.main({
      ...drive.services,
      serialWrite: (text) => {
        serial.push(text);
      },
    });
    for (let step = 0; step < 10 && !main.next().done; step++) {
      // Drain setup; the loop then idles.
    }
    expect(serial.join('')).toBe('2\n');
  });
});

describe('SevSeg on the interpreter', () => {
  it('begins as outputs on the recorded pins', () => {
    const drive = makeDrive();
    const runtime = FirmwareRuntime.fromProject(
      toSingleFileProject(`${SEVSEG_SETUP} void loop() {}`, 'arduino-cpp'),
    );
    const main = runtime.main(drive.services);
    for (let step = 0; step < 10 && !main.next().done; step++) {
      // Drain setup; the loop then idles.
    }
    const modes = drive.log.pinModes.filter((entry) => entry.mode === 1).map((entry) => entry.pin);
    expect(modes).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('multiplexes one digit per refresh with common-anode levels', () => {
    const drive = makeDrive();
    const runtime = FirmwareRuntime.fromProject(
      toSingleFileProject(
        `${SEVSEG_SETUP}
         void loop() {
           sevseg.setNumber(1);
           sevseg.refreshDisplay();
         }`,
        'arduino-cpp',
      ),
    );
    const main = runtime.main(drive.services);
    for (let step = 0; step < 30 && !main.next().done; step++) {
      // setup plus several loop passes; only the first four refreshes matter.
    }
    // Digit commons driven HIGH in 2,3,4,5 order, one per refresh.
    const selects = drive.log.writes.filter(
      (entry) => entry.pin >= 2 && entry.pin <= 5 && entry.level === 1,
    );
    expect(selects.length).toBeGreaterThanOrEqual(4);
    expect(selects.slice(0, 4).map((entry) => entry.pin)).toEqual([2, 3, 4, 5]);
    // setNumber(1) zero-pads to "0001": segment A (pin 6) is driven lit-low
    // for the three zeros and released high for the one. A digit's segment
    // writes precede its own select, so each select closes the bucket for
    // that digit in select order.
    const perDigitA: number[] = [];
    let pending: number[] = [];
    let selectsSeen = 0;
    for (const entry of drive.log.writes) {
      if (entry.pin >= 2 && entry.pin <= 5 && entry.level === 1) {
        if (selectsSeen < 4) perDigitA.push(pending[pending.length - 1] ?? -1);
        selectsSeen++;
        pending = [];
      } else if (entry.pin === 6) {
        pending.push(entry.level);
      }
    }
    expect(perDigitA).toEqual([0, 0, 0, 1]);
  });

  it('maps setChars through the gallery status glyphs', () => {
    const drive = makeDrive();
    const runtime = FirmwareRuntime.fromProject(
      toSingleFileProject(
        `${SEVSEG_SETUP}
         void loop() {
           sevseg.setChars(" on");
           sevseg.refreshDisplay();
         }`,
        'arduino-cpp',
      ),
    );
    const main = runtime.main(drive.services);
    for (let step = 0; step < 30 && !main.next().done; step++) {
      // setup plus several loop passes; the first cycle carries the proof.
    }
    // A digit's segment writes land between the previous select and its
    // own: digit index 1 ('o') belongs to bucket 0, index 2 ('n') to bucket 1.
    const bucketed = new Map<number, Array<{ pin: number; level: number }>>();
    let refresh = -1;
    for (const entry of drive.log.writes) {
      if (entry.pin >= 2 && entry.pin <= 5 && entry.level === 1) refresh++;
      else if (refresh >= 0 && refresh < 4) {
        const bucket = bucketed.get(refresh) ?? [];
        bucket.push(entry);
        bucketed.set(refresh, bucket);
      }
    }
    const lastLevel = (bucket: number, pin: number): number | undefined => {
      const writes = (bucketed.get(bucket) ?? []).filter((entry) => entry.pin === pin);
      return writes[writes.length - 1]?.level;
    };
    // 'o' renders as '0': A-F low, G (pin 12) high.
    expect(lastLevel(0, 12), "'o' leaves G dark").toBe(1);
    expect(lastLevel(0, 6), "'o' lights A").toBe(0);
    // 'n' is C/E/G: segment C (pin 8) low, A (pin 6) high.
    expect(lastLevel(1, 8), "'n' lights C").toBe(0);
    expect(lastLevel(1, 6), "'n' leaves A dark").toBe(1);
  });
});

describe('tone and noTone on the interpreter', () => {
  it('drives HIGH without blocking, retires on expiry, silences on noTone', () => {
    const drive = makeDrive();
    const runtime = FirmwareRuntime.fromProject(
      toSingleFileProject(
        `void setup() { tone(9, 440, 100); }
         void loop() {
           if (millis() >= 500 && millis() < 600) { tone(9, 880, 100); }
           if (millis() >= 700) { noTone(9); }
         }`,
        'arduino-cpp',
      ),
    );
    const seen: number[] = [];
    const main = runtime.main(drive.services);
    const step = (count: number): void => {
      for (let pass = 0; pass < count; pass++) {
        const result = main.next();
        if (result.done) return;
        seen.push(result.value as number);
      }
    };
    step(10);
    expect(drive.log.writes).toContainEqual({ pin: 9, level: 1 });
    // Past the 100 ms duration the next tone retires the old one (LOW)
    // before driving the new one (HIGH).
    drive.log.now = 500;
    step(60);
    const firstLow = drive.log.writes.findIndex(
      (entry, index) => index > 0 && entry.pin === 9 && entry.level === 0,
    );
    expect(firstLow).toBeGreaterThan(0);
    expect(drive.log.writes[firstLow + 1]).toEqual({ pin: 9, level: 1 });
    // noTone silences unconditionally.
    drive.log.now = 700;
    step(60);
    expect(drive.log.writes[drive.log.writes.length - 1]).toEqual({ pin: 9, level: 0 });
    // A blocking tone would have yielded its duration; every wait observed
    // is the loop quantum instead.
    expect(seen.every((value) => value === 0), 'tone never blocks').toBe(true);
  });
});
