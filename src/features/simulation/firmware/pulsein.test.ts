import { describe, expect, it } from 'vitest';
import { FirmwareRunner, type FirmwareServices } from './interpreter';

function stubServices(overrides: Partial<FirmwareServices> = {}): FirmwareServices {
  return {
    nowMs: () => 0,
    pinMode: () => {},
    digitalWrite: () => {},
    digitalRead: () => 0,
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
    ...overrides,
  };
}

function runSketch(source: string, services: FirmwareServices): string[] {
  const serial: string[] = [];
  const runner = new FirmwareRunner(source, {
    ...services,
    serialWrite: (text) => serial.push(text),
  });
  let guard = 0;
  for (;;) {
    const requested = runner.step();
    if (requested === null || guard++ > 100_000) break;
  }
  return serial;
}

describe('pulseIn', () => {
  it('returns the service echo width', () => {
    const serial = runSketch(
      'void setup() { int d = pulseIn(2, HIGH); Serial.println(d); } void loop() { delay(1000); }',
      stubServices({ pulseInBegin: () => 5800, pulseInEnd: () => {} }),
    );
    expect(serial.join('')).toContain('5800');
  });

  it('returns 0 with no pulseIn service', () => {
    const serial = runSketch(
      'void setup() { int d = pulseIn(2, HIGH); Serial.println(d); } void loop() { delay(1000); }',
      stubServices(),
    );
    expect(serial.join('')).toContain('0');
  });

  it('waits out the timeout instead of returning instantly', () => {
    const runner = new FirmwareRunner(
      'void setup() { int d = pulseIn(2, HIGH, 5000); } void loop() { delay(1000); }',
      stubServices(),
    );
    const requested: Array<number | null> = [];
    let guard = 0;
    for (;;) {
      const next = runner.step();
      requested.push(next);
      if (next === null || guard++ > 100_000) break;
    }
    expect(requested).toContain(5);
  });
});
