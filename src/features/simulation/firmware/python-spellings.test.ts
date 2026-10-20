import { describe, expect, it } from 'vitest';
import { FirmwareRunner, type FirmwareServices } from './interpreter';

/**
 * The call spellings a MicroPython sketch uses.
 *
 * The front end used to stop at the first keyword argument and the first
 * bytes literal, so a sketch written the way its documentation does could not
 * run at all on the interpreter path: the emulated chip ran it happily, and
 * the Problems panel called it a syntax error.
 */
function host(): { services: FirmwareServices; bus: string[]; serial: string[] } {
  const bus: string[] = [];
  const serial: string[] = [];
  const services = {
    nowMs: () => 0,
    pinMode: () => {},
    digitalWrite: () => {},
    digitalRead: () => 0,
    analogWrite: () => {},
    analogRead: () => 0,
    adcFullScale: 4095,
    serialBegin: () => {},
    serialWrite: (text: string) => serial.push(text),
    wire: {
      begin: (sda: number, scl: number) => bus.push(`begin ${sda} ${scl}`),
      beginTransmission: (address: number) => bus.push(`start ${address}`),
      write: (value: number) => {
        bus.push(`write ${value}`);
        return 1;
      },
      endTransmission: () => {
        bus.push('end');
        return 0;
      },
      requestFrom: (address: number, count: number) => {
        bus.push(`request ${address} ${count}`);
        return count;
      },
      read: () => 0,
      available: () => 0,
    },
    spi: {} as never,
  } as unknown as FirmwareServices;
  return { services, bus, serial };
}

function run(source: string): { serial: string; bus: string[] } {
  const target = host();
  const runner = new FirmwareRunner(source, target.services, 'python');
  for (let step = 0; step < 60; step++) {
    const wait = runner.step();
    if (wait === null) break;
  }
  return { serial: target.serial.join(''), bus: target.bus };
}

describe('a call spelled the way Python spells it', () => {
  it('binds a keyword argument to the parameter of that name', () => {
    const { serial } = run(
      ['def add(a, b):', '    return a + b', "print(add(1, b=2))"].join('\n'),
    );

    expect(serial).toContain('3');
  });

  it('binds a keyword argument whatever position it sits in', () => {
    const { serial } = run(
      ['def add(a, b):', '    return a + b', "print(add(b=2, a=1))"].join('\n'),
    );

    expect(serial).toContain('3');
  });

  it('takes a parameter default when the caller leaves the argument out', () => {
    const { serial } = run(['def add(a, b=2):', '    return a + b', 'print(add(1))'].join('\n'));

    expect(serial).toContain('3');
  });

  it('runs a machine call that names its pins', () => {
    const { bus } = run(
      [
        'from machine import I2C',
        'i2c = I2C(0, sda=21, scl=22)',
        "i2c.writeto(0x3c, b'\\x00\\xaf')",
      ].join('\n'),
    );

    // The bytes the sketch wrote, as the bus saw them.
    expect(bus).toContain('write 0');
    expect(bus).toContain('write 175');
  });

  it('runs a machine call that writes a list', () => {
    const { bus } = run(
      [
        'from machine import I2C',
        'i2c = I2C(0)',
        'i2c.writeto(0x3c, [0, 175])',
      ].join('\n'),
    );

    expect(bus).toContain('write 0');
    expect(bus).toContain('write 175');
  });
});
