import { describe, expect, it } from 'vitest';
import { FirmwareRunner, type FirmwareServices } from './interpreter';

function stubServices(sd?: {
  begin: (pin: number) => number;
  write: (pin: number, name: string, text: string) => number;
  read: (pin: number, name: string) => string;
  exists: (pin: number, name: string) => number;
  remove: (pin: number, name: string) => number;
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
    ...(sd ? { sd } : {}),
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

describe('sd firmware', () => {
  it('round-trips a file through the port', () => {
    const store = new Map<string, string>();
    const output = runSketch(
      'void setup() { sd.begin(10); sd.write(10, "log.txt", "hi"); Serial.println(sd.read(10, "log.txt")); } void loop() { delay(1000); }',
      stubServices({
        begin: () => 1,
        write: (_pin, name, text) => {
          store.set(name, text);
          return text.length;
        },
        read: (_pin, name) => store.get(name) ?? '',
        exists: (_pin, name) => (store.has(name) ? 1 : 0),
        remove: (_pin, name) => (store.delete(name) ? 1 : 0),
      }),
    );
    expect(output).toContain('hi');
  });

  it('fails closed with no sd service', () => {
    const output = runSketch(
      'void setup() { Serial.println(sd.begin(10)); Serial.println(sd.read(10, "x")); } void loop() { delay(1000); }',
      stubServices(),
    );
    expect(output).toContain('0');
  });

  it('normalizes truthy begin values to 1', () => {
    const output = runSketch(
      'void setup() { Serial.println(sd.begin(10)); } void loop() { delay(1000); }',
      stubServices({
        begin: () => 2,
        write: () => 0,
        read: () => '',
        exists: () => 0,
        remove: () => 0,
      }),
    );
    expect(output.trim()).toBe('1');
  });
});
