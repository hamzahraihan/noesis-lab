import { describe, expect, it } from 'vitest';
import { FirmwareRunner, type FirmwareServices } from './interpreter';

function stubServices(
  pixels?: {
    count: (pin: number) => number;
    setColor: (pin: number, i: number, r: number, g: number, b: number) => void;
  },
): FirmwareServices {
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
    ...(pixels ? { pixels } : {}),
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

describe('pixels firmware', () => {
  it('sets a color through the port', () => {
    const calls: number[][] = [];
    const output = runSketch(
      'void setup() { pixels.setColor(2, 0, 255, 128, 0); Serial.println(pixels.count(2)); } void loop() { delay(1000); }',
      stubServices({
        count: () => 1,
        setColor: (pin, i, r, g, b) => calls.push([pin, i, r, g, b]),
      }),
    );
    expect(calls).toEqual([[2, 0, 255, 128, 0]]);
    expect(output).toContain('1');
  });

  it('is a no-op with no pixels service', () => {
    const output = runSketch(
      'void setup() { pixels.setColor(2, 0, 255, 0, 0); Serial.println(pixels.count(2)); } void loop() { delay(1000); }',
      stubServices(),
    );
    expect(output).toContain('0');
  });
});
