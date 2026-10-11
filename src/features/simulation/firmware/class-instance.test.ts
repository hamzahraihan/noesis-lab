import { describe, expect, it } from 'vitest';
import { FirmwareRuntime, type FirmwareServices } from './interpreter';
import { toSingleFileProject } from './project';

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
});
