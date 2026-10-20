import { describe, expect, it } from 'vitest';
import { FirmwareRunner, type FirmwareServices } from './interpreter';
import type { ArduinoPins } from '@/features/parts';

/**
 * The Arduino pin namespace.
 *
 * A C++ sketch names pin indexes and a Python sketch names GPIOs. On most
 * boards the two are the same number; on the Nano RP2040 Connect they are
 * not, because its header is an Arduino silkscreen wrapped around a chip
 * with its own numbering. These tests pin the two halves of the answer: what
 * a board says its numbers mean, and what the VM does with what the board
 * said.
 */
interface Host {
  readonly services: FirmwareServices;
  readonly writes: ReadonlyArray<{ pin: number; level: number }>;
  readonly modes: ReadonlyArray<{ pin: number; mode: number }>;
  readonly analogReads: number[];
  readonly serial: string[];
}

function host(pins?: ArduinoPins): Host {
  const writes: { pin: number; level: number }[] = [];
  const modes: { pin: number; mode: number }[] = [];
  const analogReads: number[] = [];
  const serial: string[] = [];

  return {
    writes,
    modes,
    analogReads,
    serial,
    services: {
      nowMs: () => 0,
      pins,
      pinMode: (pin: number, mode: number) => modes.push({ pin, mode }),
      digitalWrite: (pin: number, level: number) => writes.push({ pin, level }),
      digitalRead: () => 0,
      analogWrite: () => {},
      analogRead: (pin: number) => {
        analogReads.push(pin);
        return 0;
      },
      adcFullScale: 4095,
      serialBegin: () => {},
      serialWrite: (text: string) => serial.push(text),
      wire: {} as never,
      spi: {} as never,
    } as unknown as FirmwareServices,
  };
}

function run(
  source: string,
  target: Host,
  language: 'arduino-cpp' | 'python' = 'arduino-cpp',
  steps = 4,
): void {
  const runner = new FirmwareRunner(source, target.services, language);
  for (let step = 0; step < steps; step++) {
    if (runner.step() === null) break;
  }
}

describe('the Arduino pin namespace', () => {
  it('drives the GPIO an index names', () => {
    const target = host({ map: { 2: 25 } });
    run(
      ['void setup() { pinMode(2, OUTPUT); }', 'void loop() { digitalWrite(2, HIGH); }'].join('\n'),
      target,
    );

    expect(target.modes).toEqual([{ pin: 25, mode: 1 }]);
    expect(target.writes.length).toBeGreaterThan(0);
    for (const write of target.writes) expect(write.pin).toBe(25);
  });

  it('leaves a Python sketch its own numbers', () => {
    /*
     * `Pin(25)` already is the GPIO, and `Pin(2)` is a different hole: the
     * Arduino index means nothing to a program that speaks the chip's
     * numbering, so the map is not applied there.
     */
    const target = host({ map: { 2: 25 } });
    run(
      ['from machine import Pin', 'led = Pin(2, Pin.OUT)', 'led.value(1)'].join('\n'),
      target,
      'python',
    );

    expect(target.modes).toEqual([{ pin: 2, mode: 1 }]);
    expect(target.writes).toEqual([{ pin: 2, level: 1 }]);
  });

  it('gives the analog constants the values the board says', () => {
    const print = 'void setup() { Serial.begin(9600); Serial.println(A0); }';

    // An ESP32 names its analog pins by the GPIO behind them.
    const esp32 = host({ aliases: { A0: 36 } });
    run(print, esp32);
    expect(esp32.serial.join('').trim()).toBe('36');

    // An Uno numbers them 14 to 19, which is the default.
    const uno = host();
    run(print, uno);
    expect(uno.serial.join('').trim()).toBe('14');
  });

  it('reads the analog hole the constant names', () => {
    /*
     * The Nano RP2040 Connect's `A0` is the analog index 14, and index 14 is
     * GPIO26 -- the hole labelled A0. A sketch that says `analogRead(A0)` has
     * to land there.
     */
    const target = host({ map: { 14: 26 } });
    run('void setup() { Serial.begin(9600); Serial.println(analogRead(A0)); }', target);

    expect(target.analogReads).toEqual([26]);
  });
});
