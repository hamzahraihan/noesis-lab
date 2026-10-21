import { describe, expect, it } from 'vitest';
import { FirmwareRunner, type FirmwareServices } from './interpreter';

/**
 * Arduino's `String`.
 *
 * The library's value type is what every tutorial builds a message with, and
 * the bench already carries text as a value -- so what matters is that a
 * declaration binds text, `+` joins it, numbers keep the library's two
 * places, and the mutators change the string the sketch named.
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

describe('a String', () => {
  it('binds text to a name and prints it', () => {
    expect(run('String msg = "hi"; Serial.println(msg);')).toBe('hi\n');
  });

  it('joins text with a number the way the library writes it', () => {
    expect(run('String msg = "T=" + 21.5; Serial.println(msg);')).toBe('T=21.50\n');
  });

  it('keeps a whole number bare', () => {
    expect(run('String msg = "n=" + 7; Serial.println(msg);')).toBe('n=7\n');
  });

  it('builds text from a number', () => {
    expect(run('Serial.println(String(3));')).toBe('3\n');
  });

  it('writes an integer in a base', () => {
    expect(run('Serial.println(String(255, HEX));')).toBe('FF\n');
  });

  it('keeps the places a fraction asks for', () => {
    expect(run('Serial.println(String(3.14159, 2));')).toBe('3.14\n');
  });

  it('changes the string the sketch named', () => {
    expect(run('String msg = "hi"; msg.toUpperCase(); Serial.println(msg);')).toBe('HI\n');
  });

  it('appends with the compound operator', () => {
    expect(run('String msg = "a"; msg += "b"; Serial.println(msg);')).toBe('ab\n');
  });

  it('starts from nothing when the declaration gives no value', () => {
    expect(run('String msg; msg += "a"; Serial.println(msg);')).toBe('a\n');
  });

  it('reports its length and reads a number back out', () => {
    expect(
      run('String msg = "3.5"; Serial.println(msg.toInt()); Serial.println(msg.length());'),
    ).toBe('3\n3\n');
  });

  it('reads one character by index', () => {
    expect(run('String msg = "hi"; Serial.println(msg.charAt(1));')).toBe('105\n');
  });

  it('says so for a method it does not have', () => {
    const target = host();
    const runner = new FirmwareRunner(
      'void setup() { String s = "x"; s.bleep(); }\nvoid loop() {}\n',
      target.services,
      'arduino-cpp',
    );

    expect(() => runner.step()).toThrow(/no method named 'bleep' on a String/);
  });
});
