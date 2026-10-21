import { describe, expect, it } from 'vitest';
import { buildFor, galleryById } from '@/features/learn/gallery';
import {
  describeFirmwareError,
  FirmwareRunner,
  FirmwareRuntime,
  PIN_INPUT_PULLUP,
  type FirmwareLanguage,
  type FirmwareServices,
} from './interpreter';
import { FirmwareProjectError, toSingleFileProject, type FirmwareProject } from './project';

function stubServices(serial: string[]): FirmwareServices {
  return {
    nowMs: () => 0,
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

/** Runs a sketch and reports the failure it stopped with, if any. */
function failure(source: string, language: FirmwareLanguage = 'arduino-cpp'): string {
  const serial: string[] = [];
  const runner = new FirmwareRunner(source, stubServices(serial), language);
  try {
    for (let step = 0; step < 20; step++) {
      if (runner.step() === null) break;
    }
  } catch (error) {
    return describeFirmwareError(error);
  }
  return '';
}

describe('class instances', () => {
  it('constructs a global and dispatches a method', () => {
    const project = toSingleFileProject(
      `class Counter { public: int bump(); int n; }; Counter c; void setup() { c.n = 41; } void loop() {}`,
      'arduino-cpp',
    );
    const runtime = FirmwareRuntime.fromProject(project);
    expect(runtime.hasFunction('setup')).toBe(true);
  });

  it('persists compound member-assign and dispatches returns', () => {
    const project = toSingleFileProject(
      `class Counter { public: int bump() { n = n + 1; return n; } int n; };
       Counter c;
       void setup() {
         c.n = 41; c.n += 1; ++c.n; c.n++; --c.n; c.n--;
         c.n -= 2; c.n *= 2; c.n /= 4; c.n %= 7;
         c.n <<= 2; c.n >>= 1; c.n &= 10; c.n |= 1; c.n ^= 3;
         Serial.println(c.bump());
       }
       void loop() {}`,
      'arduino-cpp',
    );
    const runtime = FirmwareRuntime.fromProject(project);
    const serial: string[] = [];
    const main = runtime.main(stubServices(serial));
    for (let step = 0; step < 10; step++) {
      if (main.next().done) break;
    }
    // 41+1+1+1-1-1-2=40, *2=80, /4=20, %7=6, <<2=24, >>1=12, &10=8,
    // |1=9, ^3=10, bump=11: every compound store landed in the field frame
    // and the method body saw them through the shared frame.
    expect(serial.join('')).toBe('11\n');
  });

  it('rejects an unknown class global loudly instead of answering zero', () => {
    const typo = toSingleFileProject(
      `Buton b(A0);\nvoid setup() {}\nvoid loop() {}`,
      'arduino-cpp',
    );
    expect(() => FirmwareRuntime.fromProject(typo)).toThrowError(FirmwareProjectError);
    expect(() => FirmwareRuntime.fromProject(typo)).toThrowError("unknown class 'Buton'");
  });

  it('lets library-owned instances through with no tab declaration', () => {
    const project = toSingleFileProject(
      `SevSeg sevseg;\nRTC_DS1307 rtc;\nvoid setup() {}\nvoid loop() {}`,
      'arduino-cpp',
    );
    expect(() => FirmwareRuntime.fromProject(project)).not.toThrow();
  });

  it('says a member the class never had is not a member', () => {
    // The same-named global is beside it on purpose: a read of the field
    // frame must not answer with the global's value either.
    expect(
      failure(
        `class Counter { public: int n; };\nCounter c;\nint missing;\n` +
          'void setup() { missing = 7; c.n = 1; Serial.println(c.missing + c.n); }\nvoid loop() {}',
        'arduino-cpp',
      ),
    ).toBe("Error: class 'Counter' has no member 'missing'");
  });

  it('says a field nobody set was never set', () => {
    expect(
      failure(
        'class Counter { public: int n; };\nCounter c;\n' +
          'void setup() { Serial.println(c.n); }\nvoid loop() {}',
        'arduino-cpp',
      ),
    ).toBe("Error: field 'n' of 'Counter' was never set");
  });

  it('reads a field the constructor set', () => {
    const project = toSingleFileProject(
      'class Counter { public: int n; Counter() { n = 41; } };\nCounter c;\n' +
        'void setup() { Serial.println(c.n); }\nvoid loop() {}',
      'arduino-cpp',
    );
    const runtime = FirmwareRuntime.fromProject(project);
    const serial: string[] = [];
    const main = runtime.main(stubServices(serial));
    for (let step = 0; step < 10; step++) {
      if (main.next().done) break;
    }
    expect(serial.join('')).toBe('41\n');
  });

  it('says a method is not a value', () => {
    expect(
      failure(
        'class Counter { public: int bump() { return 1; } };\nCounter c;\n' +
          'void setup() { Serial.println(c.bump); }\nvoid loop() {}',
        'arduino-cpp',
      ),
    ).toBe("Error: 'bump' is a method of 'Counter', not a value");
  });

  it('writes the member from inside a method, the way C++ does', () => {
    // `n = n + 1` names the member without saying so: inside a member
    // function an unqualified name is the member, not a local.
    const project = toSingleFileProject(
      'class Counter { public: int n; int bump() { n = n + 1; return n; } };\nCounter c;\n' +
        'void setup() { c.n = 41; c.bump(); Serial.println(c.n); }\nvoid loop() {}',
      'arduino-cpp',
    );
    const runtime = FirmwareRuntime.fromProject(project);
    const serial: string[] = [];
    const main = runtime.main(stubServices(serial));
    for (let step = 0; step < 10; step++) {
      if (main.next().done) break;
    }
    expect(serial.join('')).toBe('42\n');
  });

  it('keeps a local of the same name out of the member', () => {
    // A local declared in the method is the programmer's own name, and it
    // is the one the body reads and writes.
    const project = toSingleFileProject(
      'class Counter { public: int n; int show() { int n = 5; return n; } };\nCounter c;\n' +
        'void setup() { c.n = 41; Serial.println(c.show()); Serial.println(c.n); }\nvoid loop() {}',
      'arduino-cpp',
    );
    const runtime = FirmwareRuntime.fromProject(project);
    const serial: string[] = [];
    const main = runtime.main(stubServices(serial));
    for (let step = 0; step < 10; step++) {
      if (main.next().done) break;
    }
    expect(serial.join('')).toBe('5\n41\n');
  });
});

const BUTTON_HIGH = 1;
const BUTTON_LOW = 0;

/**
 * A multi-file project running the verbatim gallery `button.h`/`button.cpp`
 * tabs (pulled from the library build, never copied) under a minimal sketch.
 * A typo'd include fails loudly in `fromProject` resolution instead of
 * answering zero at runtime like an unknown single-file class would.
 */
function buttonProject(sketch: string): FirmwareProject {
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
      { name: 'button.h', content: tab('button.h') },
      { name: 'button.cpp', content: tab('button.cpp') },
    ],
    activeName: 'main.ino',
  };
}

interface ButtonBench {
  services: FirmwareServices;
  serial: string[];
  pinModes: Array<{ pin: number; mode: number }>;
  now: () => number;
  advance: (ms: number) => void;
}

/** Bench with scriptable time and pin level, recording what the VM drives. */
function makeButtonBench(levelAt: (nowMs: number) => number): ButtonBench {
  let now = 0;
  const serial: string[] = [];
  const pinModes: Array<{ pin: number; mode: number }> = [];
  const services: FirmwareServices = {
    nowMs: () => now,
    pinMode: (pin, mode) => {
      pinModes.push({ pin, mode });
    },
    digitalWrite: () => {},
    // Only the button pin is driven; anything else reads released.
    digitalRead: (pin) => (pin === 14 ? levelAt(now) : BUTTON_HIGH),
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
  return {
    services,
    serial,
    pinModes,
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

/** Steps `main()` until the sim clock passes the limit, collecting serial. */
function runBench(runtime: FirmwareRuntime, bench: ButtonBench, limitMs: number): void {
  const main = runtime.main(bench.services);
  for (let steps = 0; steps < 10000; steps++) {
    const step = main.next();
    if (step.done) return;
    // The driver is handed a wait; a value belongs to a generator, and this
    // sketch has none.
    if (typeof step.value !== 'number') throw new Error('expected a wait, not a value');
    bench.advance(step.value);
    if (bench.now() > limitMs) return;
  }
  throw new Error('runaway firmware');
}

describe('Button class end to end', () => {
  it('debounces a Button press and reports pressed once', () => {
    const runtime = FirmwareRuntime.fromProject(
      buttonProject(
        '#include <Arduino.h>\n#include "button.h"\nButton b(A0);\n' +
          'void setup() { b.begin(); Serial.println(Button::PRESSED + Button::RELEASED + b.PRESSED + b.RELEASED); }\n' +
          'void loop() { Serial.println(b.pressed() * 10 + b.released()); delay(20); }',
      ),
    );
    // Press at 200 ms with a 220-240 ms bounce flicker, release at 600 ms.
    const bench = makeButtonBench((now) =>
      (now >= 200 && now < 220) || (now >= 240 && now < 600) ? BUTTON_LOW : BUTTON_HIGH,
    );
    runBench(runtime, bench, 800);
    // begin() drove pinMode on the constructor-bound pin, pulled up.
    expect(bench.pinModes).toEqual([{ pin: 14, mode: PIN_INPUT_PULLUP }]);
    // Static consts (0 + 1 + 0 + 1), then one debounced press ("10") and one
    // release ("1") across 41 loop passes sampled every 20 ms.
    const expected = [
      '2',
      ...Array<string>(10).fill('0'),
      '10',
      ...Array<string>(19).fill('0'),
      '1',
      ...Array<string>(10).fill('0'),
    ];
    expect(bench.serial.map((line) => line.trim())).toEqual(expected);
  });

  it('ramps repeat_count under set_repeat and toggles on edges', () => {
    const runtime = FirmwareRuntime.fromProject(
      buttonProject(
        '#include <Arduino.h>\n#include "button.h"\nButton b(A0);\n' +
          'void setup() { b.begin(); b.set_repeat(500, 200); }\n' +
          'void loop() { Serial.println(b.toggled() * 1000 + b.pressed() * 100 + b.repeat_count()); delay(20); }',
      ),
    );
    // Same bounce, but held until 1300 ms so repeats ramp past whole counts.
    const bench = makeButtonBench((now) =>
      (now >= 200 && now < 220) || (now >= 240 && now < 1300) ? BUTTON_LOW : BUTTON_HIGH,
    );
    runBench(runtime, bench, 1500);
    expect(bench.pinModes).toEqual([{ pin: 14, mode: PIN_INPUT_PULLUP }]);
    const values = bench.serial.map((line) => Number(line.trim()));
    for (const value of values) expect(value).toBeGreaterThanOrEqual(0);
    // Exactly two edges: press (no repeats yet) and release (4 repeats in).
    const toggles = values.filter((value) => value >= 1000);
    expect(toggles).toEqual([1000, 1004]);
    expect(values.indexOf(1000)).toBeLessThan(values.indexOf(1004));
    const rest = values.filter((value) => value < 1000);
    expect(Math.max(...rest)).toBeGreaterThanOrEqual(103);
  });
});
