import { describe, expect, it } from 'vitest';
import { FirmwareRunner, type FirmwareServices } from './interpreter';

function stubServices(dialer?: { read: (pin: number) => number }): FirmwareServices {
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
    ...(dialer ? { dialer } : {}),
  };
}

function runSketch(source: string, services: FirmwareServices): string {
  const seen: string[] = [];
  const runner = new FirmwareRunner(source, {
    ...services,
    serialWrite: (text) => seen.push(text),
  });
  let guard = 0;
  while (runner.step() !== null && guard++ < 100_000) {}
  return seen.join('');
}

describe('dialer firmware', () => {
  it('reads the latched digit through the port', () => {
    const output = runSketch(
      'void setup() { Serial.println(dialer.read(2)); } void loop() { delay(1000); }',
      stubServices({ read: () => 7 }),
    );
    expect(output).toContain('7');
  });

  it('reads -1 with no dialer service', () => {
    const output = runSketch(
      'void setup() { Serial.println(dialer.read(2)); } void loop() { delay(1000); }',
      stubServices(),
    );
    expect(output).toContain('-1');
  });
});
