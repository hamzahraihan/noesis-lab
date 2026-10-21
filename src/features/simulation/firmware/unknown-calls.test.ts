import { describe, expect, it } from 'vitest';
import {
  describeFirmwareError,
  FirmwareRunner,
  type FirmwareLanguage,
  type FirmwareServices,
} from './interpreter';

/**
 * The calls the bench cannot make.
 *
 * They used to answer 0. That is the worst answer there is: `len(data)` and
 * `d.get('a')` read as zero, and a learner believes the data was zero rather
 * than the bench missing the call. The bench's own rule is that a sketch
 * which cannot say something says so, and this file is that rule made
 * permanent -- for the Python front end and the C++ one alike.
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
    adcFullScale: 4095,
    serialBegin: () => {},
    serialWrite: (text: string) => serial.push(text),
    wire: {} as never,
    spi: {} as never,
  } as unknown as FirmwareServices;
  return { services, serial };
}

/** Runs a sketch and reports the failure it stopped with, if any. */
function failure(source: string, language: FirmwareLanguage = 'python'): string {
  const target = host();
  const runner = new FirmwareRunner(source, target.services, language);
  try {
    for (let step = 0; step < 60; step++) {
      if (runner.step() === null) break;
    }
  } catch (error) {
    return describeFirmwareError(error);
  }
  return '';
}

/** Runs a sketch and reports what it printed. */
function output(source: string): string {
  const target = host();
  const runner = new FirmwareRunner(source, target.services, 'python');
  for (let step = 0; step < 60; step++) {
    if (runner.step() === null) break;
  }
  return target.serial.join('');
}

describe('a call the bench cannot make', () => {
  it('says a function it has never heard of', () => {
    expect(failure('print(sorted([3, 1, 2]))')).toBe(
      "NameError: name 'sorted' is not defined",
    );
  });

  it('says a member the value does not have', () => {
    expect(failure("print('abc'.upper())")).toBe(
      "AttributeError: 'str' object has no attribute 'upper'",
    );
  });

  it('says an object the sketch has never heard of', () => {
    expect(failure('myLibrary.begin()')).toBe("NameError: name 'myLibrary' is not defined");
  });

  it('says a value that was called as a function', () => {
    expect(failure('count = 3\ncount()')).toBe("TypeError: 'int' object is not callable");
  });

  it('says a member the serial port does not have', () => {
    expect(failure('Serial.begin(9600)\nSerial.setTimeout(10)')).toBe(
      "AttributeError: 'Serial' object has no attribute 'setTimeout'",
    );
  });

  it('says the same in the C++ front end', () => {
    expect(failure('void setup() { whatever(1); }', 'arduino-cpp')).toBe(
      "Error: no function named 'whatever'",
    );
  });

  it('says a member in the C++ front end too', () => {
    expect(failure('void setup() { Serial.begin(9600); Serial.nonsense(); }', 'arduino-cpp')).toBe(
      "Error: no method named 'nonsense' on a Serial",
    );
  });
});

describe('a name the sketch has never heard of', () => {
  it('says so in the Python front end', () => {
    expect(failure('print(pins)')).toBe("NameError: name 'pins' is not defined");
  });

  it('says so in the C++ front end', () => {
    expect(failure('void setup() { Serial.print(pins); }', 'arduino-cpp')).toBe(
      "Error: 'pins' was not declared in this scope",
    );
  });

  it('says what a device is, rather than claiming the name is unknown', () => {
    expect(failure('from gpiozero import LED\nlamp = LED(17)\nprint(lamp)')).toBe(
      "TypeError: 'lamp' is a device, not a value",
    );
  });

  it('says what a function is', () => {
    expect(failure('def go():\n    return 1\nprint(go)')).toBe(
      "TypeError: 'go' is a function, not a value",
    );
  });

  it('says what a class is', () => {
    expect(failure('class Counter:\n    def bump(self):\n        return 1\nprint(Counter)')).toBe(
      "TypeError: 'Counter' is a class, not a value",
    );
  });
});

describe('a member the bench cannot find', () => {
  it('says a value has no such member', () => {
    expect(failure("print('abc'.length)")).toBe(
      "AttributeError: 'str' object has no attribute 'length'",
    );
  });

  it('says a dictionary has no such key', () => {
    expect(failure("d = {'a': 1}\nprint(d['b'])")).toBe(
      "KeyError: key 'b' is not in the dictionary",
    );
  });

  it('says a device has no such member', () => {
    expect(failure('from gpiozero import LED\nlamp = LED(17)\nprint(lamp.nonsense)')).toBe(
      "AttributeError: 'led' object has no attribute 'nonsense'",
    );
  });

  it('reads a list by its index', () => {
    expect(output('print([1, 2, 3][1])')).toBe('2\n');
  });
});

describe('an index the bench cannot reach', () => {
  it('says a list has no such element', () => {
    expect(failure('print([1, 2, 3][5])')).toBe(
      'IndexError: index 5 is out of range for a list of 3',
    );
  });
});

describe('len', () => {
  it('counts the characters of a string', () => {
    expect(output("print(len('abc'))")).toBe('3\n');
  });

  it('counts the elements of a list', () => {
    expect(output('print(len([1, 2, 3]))')).toBe('3\n');
  });

  it('counts the keys of a dictionary', () => {
    expect(output("print(len({'a': 1, 'b': 2}))")).toBe('2\n');
  });

  it('counts the bytes of a bytes literal', () => {
    expect(output("print(len(b'ab'))")).toBe('2\n');
  });

  it('says so when there is nothing to count', () => {
    expect(failure('print(len(5))')).toBe("TypeError: object of type 'int' has no len()");
  });
});
