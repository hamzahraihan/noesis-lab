import { describe, expect, it } from 'vitest';
import { FirmwareRunner, type FirmwareServices } from './interpreter';

/**
 * The spellings a MicroPython sketch uses.
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

  it('builds a list from a comprehension over a range', () => {
    const { serial } = run(['squares = [i * i for i in range(5)]', 'print(squares[2])'].join('\n'));

    expect(serial).toContain('4');
  });

  it('builds a list from a comprehension over an array', () => {
    const { serial } = run(
      ['values = [1, 2, 3]', 'doubled = [v * 2 for v in values]', 'print(doubled[2])'].join('\n'),
    );

    expect(serial).toContain('6');
  });

  it('reads and writes a dictionary', () => {
    const { serial } = run(
      [
        "d = {'a': 1, 'b': 2}",
        "d['c'] = 3",
        "print(d['a'])",
        'print(d.b)',
        "print(d['c'])",
      ].join('\n'),
    );

    expect(serial).toContain('1');
    expect(serial).toContain('2');
    expect(serial).toContain('3');
  });

  it('runs a class with a constructor, methods and fields', () => {
    const { serial } = run(
      [
        'class Counter:',
        '    def __init__(self):',
        '        self.n = 0',
        '    def bump(self):',
        '        self.n = self.n + 1',
        '        return self.n',
        'c = Counter()',
        'print(c.bump())',
        'print(c.bump())',
      ].join('\n'),
    );

    expect(serial).toContain('1');
    expect(serial).toContain('2');
  });

  it('runs a range loop the way Python counts it', () => {
    const { serial } = run(
      ['total = 0', 'for i in range(4):', '    total = total + i', 'print(total)'].join('\n'),
    );

    expect(serial).toContain('6');
  });

  it('runs a range loop with a start and a stop', () => {
    const { serial } = run(
      ['total = 0', 'for i in range(2, 5):', '    total = total + i', 'print(total)'].join('\n'),
    );

    expect(serial).toContain('9');
  });

  it('collects the extra arguments into a starred parameter', () => {
    const { serial } = run(
      ['def first_of(*rest):', '    return rest[0]', 'print(first_of(7, 8))'].join('\n'),
    );

    expect(serial).toContain('7');
  });

  it('keeps the named arguments apart from the starred ones', () => {
    const { serial } = run(
      ['def add(first, *rest):', '    return first + rest[0]', 'print(add(1, 2))'].join('\n'),
    );

    expect(serial).toContain('3');
  });

  it('passes arguments to a Python constructor', () => {
    const { serial } = run(
      [
        'class Counter:',
        '    def __init__(self, start):',
        '        self.n = start',
        '    def value(self):',
        '        return self.n',
        'c = Counter(7)',
        'print(c.value())',
      ].join('\n'),
    );

    expect(serial).toContain('7');
  });
});

/**
 * A guarded block.
 *
 * A sketch that guards a read had no way to say so: the front end stopped at
 * the `try` keyword and the Problems panel called it a syntax error, while the
 * emulated chip ran the same sketch happily.
 */
describe('a guarded block', () => {
  it('catches the error it names and carries on', () => {
    const { serial } = run(
      [
        'try:',
        "    raise ValueError('bad reading')",
        'except ValueError as e:',
        "    print('caught', e)",
        "print('after')",
      ].join('\n'),
    );

    expect(serial).toContain('caught');
    expect(serial).toContain('bad reading');
    expect(serial).toContain('after');
  });

  it('catches anything with a bare except', () => {
    const { serial } = run(
      ['try:', "    raise ValueError('boom')", 'except:', "    print('caught')"].join('\n'),
    );

    expect(serial).toContain('caught');
  });

  it('catches the errors of several types', () => {
    const { serial } = run(
      [
        'try:',
        "    raise OSError('no device')",
        'except (ValueError, OSError):',
        "    print('caught')",
      ].join('\n'),
    );

    expect(serial).toContain('caught');
  });

  it('leaves an error of another type to travel on', () => {
    const target = host();
    const runner = new FirmwareRunner(
      ['try:', "    raise ValueError('boom')", 'except OSError:', "    print('caught')"].join('\n'),
      target.services,
      'python',
    );

    expect(() => runner.step()).toThrow(/boom/);
    expect(target.serial.join('')).not.toContain('caught');
  });

  it('runs finally whether or not the body raised', () => {
    const { serial } = run(
      [
        'try:',
        "    raise ValueError('boom')",
        'except ValueError:',
        "    print('caught')",
        'finally:',
        "    print('finally')",
      ].join('\n'),
    );

    expect(serial).toContain('caught');
    expect(serial).toContain('finally');
  });

  it('runs finally after a body that raised nothing', () => {
    const { serial } = run(
      ['try:', "    print('body')", 'finally:', "    print('finally')"].join('\n'),
    );

    expect(serial).toContain('body');
    expect(serial).toContain('finally');
  });

  it('runs else only when the body raised nothing', () => {
    const { serial } = run(
      [
        'try:',
        "    raise ValueError('boom')",
        'except ValueError:',
        "    print('caught')",
        'else:',
        "    print('else')",
      ].join('\n'),
    );

    expect(serial).toContain('caught');
    expect(serial).not.toContain('else');
  });

  it('runs else when the body raised nothing', () => {
    const { serial } = run(
      ['try:', "    print('body')", 'else:', "    print('else')"].join('\n'),
    );

    expect(serial).toContain('body');
    expect(serial).toContain('else');
  });
});

/**
 * A generator.
 *
 * A function that yields hands its values over one at a time, which is what
 * lets a sketch write `while True: yield sensor.read()` without the bench
 * running out of values to wait for.
 */
describe('a generator', () => {
  it('hands its values over one at a time', () => {
    const { serial } = run(
      [
        'def counter():',
        '    yield 1',
        '    yield 2',
        '    yield 3',
        '',
        'total = 0',
        'for value in counter():',
        '    total = total + value',
        'print(total)',
      ].join('\n'),
    );

    expect(serial).toContain('6');
  });

  it('runs nothing until the first value is asked for', () => {
    const { serial } = run(
      ['def counter():', "    print('started')", '    yield 1', '', "g = counter()", "print('made')"].join(
        '\n',
      ),
    );

    // The body has not run: making the generator is not running it.
    expect(serial).toContain('made');
    expect(serial).not.toContain('started');
  });

  it('is lazy, so a generator that never ends does not hang the bench', () => {
    const { serial } = run(
      [
        'def readings():',
        '    i = 0',
        '    while True:',
        '        yield i',
        '        i = i + 1',
        '',
        'count = 0',
        'for value in readings():',
        '    count = count + 1',
        '    if count > 3:',
        '        break',
        'print(count)',
      ].join('\n'),
    );

    expect(serial).toContain('4');
  });

  it('iterates a list the way Python does', () => {
    const { serial } = run(
      ['total = 0', 'for value in [1, 2, 3]:', '    total = total + value', 'print(total)'].join(
        '\n',
      ),
    );

    expect(serial).toContain('6');
  });

  it("hands over another generator's values in turn", () => {
    const { serial } = run(
      [
        'def inner():',
        '    yield 1',
        '    yield 2',
        '',
        'def outer():',
        '    yield 0',
        '    yield from inner()',
        '    yield 3',
        '',
        'for value in outer():',
        '    print(value)',
      ].join('\n'),
    );

    expect(serial).toBe('0\n1\n2\n3\n');
  });

  it('keeps the last value the generator it delegates to returned', () => {
    const { serial } = run(
      [
        'def inner():',
        '    yield 1',
        '    return 7',
        '',
        'def outer():',
        '    got = yield from inner()',
        '    print(got)',
        '',
        'for value in outer():',
        '    print(value)',
      ].join('\n'),
    );

    expect(serial).toBe('1\n7\n');
  });

  it('hands over a list with yield from', () => {
    const { serial } = run(
      ['def all_of():', '    yield from [1, 2]', '', 'for value in all_of():', '    print(value)'].join(
        '\n',
      ),
    );

    expect(serial).toBe('1\n2\n');
  });

  it('says so when there is nothing to delegate to', () => {
    const target = host();
    const runner = new FirmwareRunner(
      ['def broken():', '    yield from 7', '', 'for value in broken():', '    print(value)'].join(
        '\n',
      ),
      target.services,
      'python',
    );

    expect(() => {
      for (let step = 0; step < 60; step++) {
        if (runner.step() === null) break;
      }
    }).toThrow(/is not iterable/);
  });

  it('refuses a yield outside a function', () => {
    const target = host();
    const runner = new FirmwareRunner('yield 1\n', target.services, 'python');

    expect(() => runner.step()).toThrow(/yield outside a function/);
  });

  it('says so when the thing being walked cannot be walked', () => {
    const target = host();
    const runner = new FirmwareRunner(
      ['for value in 7:', '    print(value)'].join('\n'),
      target.services,
      'python',
    );

    expect(() => runner.step()).toThrow(/not iterable/);
  });
});
