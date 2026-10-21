import { describe, expect, it } from 'vitest';
import { FirmwareRunner, type FirmwareServices } from './interpreter';

function stubServices(onewire?: { temperature: (pin: number) => number }): FirmwareServices {
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
    ...(onewire ? { onewire } : {}),
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

describe('one-wire firmware', () => {
  it('reads the temperature through the port', () => {
    // The Arduino spelling: the constructor takes the pin, and the object
    // carries it on to the call.
    const output = runSketch(
      'OneWire ow(2); void setup() { Serial.println(ow.getTemp()); } void loop() { delay(1000); }',
      stubServices({ temperature: () => 22.5 }),
    );
    expect(output).toContain('22.5');
  });

  it('answers in the bench\u2019s own spelling too', () => {
    const output = runSketch(
      'void setup() { Serial.println(onewire.temperature(2)); } void loop() { delay(1000); }',
      stubServices({ temperature: () => 19.25 }),
    );
    expect(output).toContain('19.25');
  });

  it('reads 0 with no one-wire service', () => {
    const output = runSketch(
      'OneWire ow(2); void setup() { Serial.println(ow.getTemp()); } void loop() { delay(1000); }',
      stubServices(),
    );
    expect(output).toContain('0');
  });
});
