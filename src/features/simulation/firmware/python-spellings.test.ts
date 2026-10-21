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

/**
 * A sketch as the bench actually runs it: a project with a `main.py` tab.
 *
 * A bare source string skips the project loader, and the loader is where an
 * import is resolved -- as `import gc` proved when it was looked for as a
 * tab. Tests that never touch the loader cannot see that.
 */
function python(source: string, services: FirmwareServices): FirmwareRunner {
  return new FirmwareRunner(
    {
      language: 'python',
      activeName: 'main.py',
      files: [{ name: 'main.py', content: source }],
    },
    services,
    'python',
  );
}

function run(source: string): { serial: string; bus: string[] } {
  const target = host();
  const runner = python(source, target.services);
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
    const runner = python(
      ['try:', "    raise ValueError('boom')", 'except OSError:', "    print('caught')"].join('\n'),
      target.services,
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
describe('the time module', () => {
  it('waits the unit the member names', () => {
    const target = host();
    const runner = python('import time\ntime.sleep_ms(50)\n', target.services);

    // The step reports the wait it wants; 50 milliseconds is not 50 seconds.
    expect(runner.step()).toBe(50);
  });

  it('counts milliseconds from the bench clock', () => {
    const { serial } = run('import time\nprint(time.ticks_ms())\n');

    expect(serial).toBe('0\n');
  });

  it("measures the gap the way ticks_diff does", () => {
    const { serial } = run(
      ['import time', 'start = 10', 'print(time.ticks_diff(35, start))'].join('\n'),
    );

    expect(serial).toBe('25\n');
  });

  it('says so for a member it does not have', () => {
    const target = host();
    const runner = python('import time\ntime.warp(2)\n', target.services);

    expect(() => runner.step()).toThrow(/time.*has no attribute 'warp'/);
  });
});

describe('a quoted string', () => {
  it('reads an escaped quote as part of the string', () => {
    const { serial } = run("print('it\\'s')\nprint(\"a \\\"b\\\" c\")\n");

    expect(serial).toBe("it's\na \"b\" c\n");
  });

  it('reads a single-quoted string as the same text as a double-quoted one', () => {
    const { serial } = run("print('a', \"a\")\n");

    expect(serial).toBe('a a\n');
  });
});

describe('the idioms a MicroPython sketch opens with', () => {
  it('treats const as the value it promises', () => {
    const { serial } = run('from micropython import const\nX = const(5)\nprint(X)\n');

    expect(serial).toBe('5\n');
  });

  it('collects without complaining', () => {
    const { serial } = run('import gc\ngc.collect()\nprint("done")\n');

    expect(serial).toBe('done\n');
  });

  it('loads a project whose imports name libraries rather than tabs', () => {
    const target = host();
    const runner = new FirmwareRunner(
      {
        language: 'python',
        activeName: 'main.py',
        files: [
          {
            name: 'main.py',
            content: [
              'from micropython import const',
              'import gc',
              'import time',
              'X = const(5)',
              'gc.collect()',
              'print(X, time.ticks_ms())',
            ].join('\n'),
          },
        ],
      },
      target.services,
      'python',
    );
    for (let step = 0; step < 20; step++) {
      if (runner.step() === null) break;
    }

    expect(target.serial.join('')).toBe('5 0\n');
  });

  it('takes utime as the older name for time', () => {
    const { serial } = run('import utime\nprint(utime.ticks_ms())\n');

    expect(serial).toBe('0\n');
  });

  it('reads back the PWM setting it was given', () => {
    const target = host();
    const runner = python(
      [
        'from machine import PWM, Pin',
        'p = PWM(Pin(4))',
        'p.freq(1000)',
        'p.duty_u16(32768)',
        'print(p.freq(), p.duty_u16())',
      ].join('\n'),
      target.services,
    );
    for (let step = 0; step < 40; step++) {
      if (runner.step() === null) break;
    }

    // The channel is eight bits wide, so the duty reads back quantised.
    expect(target.serial.join('')).toBe('1000 32896\n');
  });
});

describe('an I2C bus a sketch scans', () => {
  it('lists the address the bench answers at', () => {
    const target = host();
    const services = {
      ...target.services,
      i2cHasDevice: (address: number) => address === 0x3c,
    };
    const runner = python(
      ['from machine import I2C', 'i2c = I2C(0)', 'print(i2c.scan())'].join('\n'),
      services,
    );
    for (let step = 0; step < 40; step++) {
      if (runner.step() === null) break;
    }

    expect(target.serial.join('')).toBe('[60]\n');
  });
});

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
    const runner = python(
      ['def broken():', '    yield from 7', '', 'for value in broken():', '    print(value)'].join(
        '\n',
      ),
      target.services,
    );

    expect(() => {
      for (let step = 0; step < 60; step++) {
        if (runner.step() === null) break;
      }
    }).toThrow(/is not iterable/);
  });

  it('refuses a yield outside a function', () => {
    const target = host();
    const runner = python('yield 1\n', target.services);

    expect(() => runner.step()).toThrow(/yield outside a function/);
  });

  it('says so when the thing being walked cannot be walked', () => {
    const target = host();
    const runner = python(
      ['for value in 7:', '    print(value)'].join('\n'),
      target.services,
    );

    expect(() => runner.step()).toThrow(/not iterable/);
  });
});

describe('a generator that is spoken to', () => {
  it('takes a value back through the yield that is waiting for it', () => {
    const { serial } = run(
      [
        'def counter():',
        '    received = yield 1',
        '    print("got", received)',
        '    yield received + 1',
        '',
        'it = counter()',
        'print(next(it))',
        'print(it.send(5))',
      ].join('\n'),
    );

    // The first advance hands over the 1; the send puts the 5 into the
    // yield that was waiting, and the generator hands back 6.
    expect(serial).toBe('1\ngot 5\n6\n');
  });

  it('advances by a value of its own when it is only asked for one', () => {
    const { serial } = run(
      ['def counter():', '    yield 1', '    yield 2', '', 'it = counter()', 'print(next(it))', 'print(next(it))'].join(
        '\n',
      ),
    );

    expect(serial).toBe('1\n2\n');
  });

  it('raises StopIteration when it has run out, so a sketch can catch it', () => {
    const { serial } = run(
      [
        'def counter():',
        '    yield 1',
        '',
        'it = counter()',
        'print(next(it))',
        'try:',
        '    next(it)',
        'except StopIteration:',
        '    print("finished")',
      ].join('\n'),
    );

    expect(serial).toBe('1\nfinished\n');
  });

  it('answers with the default the caller gave when it has run out', () => {
    const { serial } = run(
      [
        'def counter():',
        '    yield 1',
        '',
        'it = counter()',
        'print(next(it))',
        'print(next(it, "none"))',
      ].join('\n'),
    );

    expect(serial).toBe('1\nnone\n');
  });

  it('refuses a value sent to a generator that has not started', () => {
    const target = host();
    const runner = python(
      ['def counter():', '    yield 1', '', 'it = counter()', 'it.send(5)'].join('\n'),
      target.services,
    );

    expect(() => {
      for (let step = 0; step < 60; step++) {
        if (runner.step() === null) break;
      }
    }).toThrow(/has not started/);
  });

  it('starts a generator that is sent nothing, the way None does', () => {
    const { serial } = run(
      ['def counter():', '    yield 1', '', 'it = counter()', 'print(it.send(0))'].join('\n'),
    );

    expect(serial).toBe('1\n');
  });

  it('refuses a send with no value in it', () => {
    const target = host();
    const runner = python(
      ['def counter():', '    yield 1', '', 'it = counter()', 'it.send()'].join('\n'),
      target.services,
    );

    expect(() => {
      for (let step = 0; step < 60; step++) {
        if (runner.step() === null) break;
      }
    }).toThrow(/exactly one argument/);
  });

  it('says so when what is asked for is not a generator at all', () => {
    const target = host();
    const runner = python('next(7)\n', target.services);

    expect(() => runner.step()).toThrow(/not an iterator/);
  });

  it('leaves a sketch its own `next` to do what it likes with', () => {
    const { serial } = run(
      ['def next(value):', '    return 42', '', 'print(next(7))'].join('\n'),
    );

    expect(serial).toBe('42\n');
  });

  it('passes a value sent to it on to the generator it delegates to', () => {
    const { serial } = run(
      [
        'def inner():',
        '    received = yield 1',
        '    yield received * 2',
        '',
        'def outer():',
        '    yield from inner()',
        '',
        'it = outer()',
        'print(next(it))',
        'print(it.send(4))',
      ].join('\n'),
    );

    expect(serial).toBe('1\n8\n');
  });

  it('refuses a value sent to a generator that is already running', () => {
    const target = host();
    const runner = python(
      [
        'it = None',
        'def g():',
        '    it.send(1)',
        '    yield 1',
        '',
        'it = g()',
        'next(it)',
      ].join('\n'),
      target.services,
    );

    expect(() => {
      for (let step = 0; step < 60; step++) {
        if (runner.step() === null) break;
      }
    }).toThrow(/already executing/);
  });

  it('says so when a generator is asked for something the bench does not model', () => {
    const target = host();
    const runner = python(
      ['def g():', '    yield 1', '', 'it = g()', 'it.close()'].join('\n'),
      target.services,
    );

    expect(() => {
      for (let step = 0; step < 60; step++) {
        if (runner.step() === null) break;
      }
    }).toThrow(/models no generator close/);
  });
});
