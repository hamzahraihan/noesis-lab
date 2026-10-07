import { describe, expect, it } from 'vitest';
import { FirmwareRunner, type FirmwareServices } from './interpreter';

function stubServices(ir?: { readCode: (pin: number) => number }): FirmwareServices {
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
    ...(ir ? { ir } : {}),
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

describe('ir firmware', () => {
  it('reads the live code through the port', () => {
    const output = runSketch(
      'void setup() { Serial.println(ir.readCode(2)); } void loop() { delay(1000); }',
      stubServices({ readCode: () => 48 }),
    );
    expect(output).toContain('48');
  });

  it('reads 0 with no ir service', () => {
    const output = runSketch(
      'void setup() { Serial.println(ir.readCode(2)); } void loop() { delay(1000); }',
      stubServices(),
    );
    expect(output).toContain('0');
  });
});
