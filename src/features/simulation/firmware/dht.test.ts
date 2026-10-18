import { describe, expect, it } from 'vitest';
import { FirmwareRunner, type FirmwareServices } from './interpreter';

function stubServices(dht?: {
  begin: (pin: number) => void;
  temperature: (pin: number) => number;
  humidity: (pin: number) => number;
}): FirmwareServices {
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
    ...(dht ? { dht } : {}),
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

describe('dht firmware', () => {
  it('reads knob climate through the port', () => {
    const output = runSketch(
      'void setup() { float t = dht.temperature(2); float h = dht.humidity(2); Serial.println(t); Serial.println(h); } void loop() { delay(1000); }',
      stubServices({ begin: () => {}, temperature: () => 23.5, humidity: () => 61 }),
    );
    // Floats print through formatPrintValue; match loosely, not exactly.
    expect(output).toContain('23.5');
    expect(output).toContain('61');
  });

  it('reads 0 with no dht service', () => {
    const output = runSketch(
      'void setup() { Serial.println(dht.temperature(2)); } void loop() { delay(1000); }',
      stubServices(),
    );
    expect(output).toContain('0');
  });
});
