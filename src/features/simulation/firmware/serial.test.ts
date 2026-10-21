import { describe, expect, it } from 'vitest';
import { FirmwareRunner, type FirmwareServices } from './interpreter';

/**
 * What a sketch's `Serial` writes, and what a character literal is.
 *
 * The serial monitor is where a learner reads their own program, so the text
 * has to be the text the board would write: two places for a fraction, a
 * field's base when the call asks for one, and a character literal that is
 * the number it names.
 */
function host(): { services: FirmwareServices; serial: string[] } {
  const serial: string[] = [];
  const services = {
    nowMs: () => 0,
    pinMode: () => {},
    digitalWrite: () => {},
    digitalRead: () => 0,
    analogWrite: () => {},
    analogRead: () => 0,
    adcFullScale: 1023,
    serialBegin: () => {},
    serialWrite: (text: string) => serial.push(text),
    wire: {} as never,
    spi: {} as never,
  } as unknown as FirmwareServices;
  return { services, serial };
}

function run(body: string): string {
  const target = host();
  const runner = new FirmwareRunner(
    `void setup() {\n${body}\n}\nvoid loop() {}\n`,
    target.services,
    'arduino-cpp',
  );
  for (let step = 0; step < 40; step++) {
    if (runner.step() === null) break;
  }
  return target.serial.join('');
}

describe('Serial', () => {
  it('writes a fraction to two places and a whole number bare', () => {
    expect(run('Serial.println(3.14159); Serial.println(7);')).toBe('3.14\n7\n');
  });

  it('keeps the places a second argument asks for', () => {
    expect(run('Serial.println(3.14159, 4);')).toBe('3.1416\n');
  });

  it('writes a whole number in the base a second argument names', () => {
    expect(run('Serial.println(255, HEX); Serial.println(255, BIN);')).toBe(
      'FF\n11111111\n',
    );
  });

  it('joins prints without a separator and ends a line on println', () => {
    expect(run('Serial.print(1); Serial.print(2); Serial.println(3);')).toBe('123\n');
  });

  it('writes a byte as its character', () => {
    expect(run('Serial.write(65);')).toBe('A');
  });
});

describe('a character literal', () => {
  it('is the number it names', () => {
    expect(run("Serial.println('A');")).toBe('65\n');
  });

  it('binds to a char and compares as a number', () => {
    expect(
      run("char c = 'a'; if (c == 'a') { Serial.println(\"yes\"); } else { Serial.println(\"no\"); }"),
    ).toBe('yes\n');
  });

  it('reads an escape', () => {
    expect(run("Serial.println('\\n'); Serial.println('a' + 1);")).toBe('10\n98\n');
  });
});
