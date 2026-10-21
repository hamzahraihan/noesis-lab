import { describe, expect, it } from 'vitest';
import { FirmwareRunner, type FirmwareServices } from './interpreter';
import { toSingleFileProject } from './project';

/**
 * The libraries a sketch names the Arduino way.
 *
 * `Servo myServo;` and `myServo.write(90)` are the spellings every real
 * library sketch uses, and the bench answers them as well as its own. The
 * bench's shape -- the pin in every call -- is how the ports address a part,
 * so an object that remembers its own pin carries it on.
 */
interface Recorded {
  readonly serial: string[];
  readonly servo: { attach: number[]; write: Array<[number, number]>; read: number[] };
  readonly dht: { begin: number[]; temperature: number[]; humidity: number[] };
}

/** A host that records what the libraries were told. */
function host(): { recorded: Recorded; services: FirmwareServices } {
  const recorded: Recorded = {
    serial: [],
    servo: { attach: [], write: [], read: [] },
    dht: { begin: [], temperature: [], humidity: [] },
  };
  const services = {
    nowMs: () => 0,
    pinMode: () => {},
    digitalWrite: () => {},
    digitalRead: () => 0,
    analogWrite: () => {},
    analogRead: () => 0,
    serialBegin: () => {},
    serialWrite: (text: string) => {
      recorded.serial.push(text);
    },
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
    servo: {
      attach: (pin: number) => {
        recorded.servo.attach.push(pin);
      },
      write: (pin: number, angle: number) => {
        recorded.servo.write.push([pin, angle]);
      },
      read: (pin: number) => {
        recorded.servo.read.push(pin);
        return 0;
      },
      detach: () => {},
    },
    dht: {
      begin: (pin: number) => {
        recorded.dht.begin.push(pin);
      },
      temperature: (pin: number) => {
        recorded.dht.temperature.push(pin);
        return 21.5;
      },
      humidity: (pin: number) => {
        recorded.dht.humidity.push(pin);
        return 48;
      },
    },
  } as unknown as FirmwareServices;
  return { recorded, services };
}

/** Runs a sketch and reports what the libraries were told. */
function run(sketch: string): Recorded {
  const { recorded, services } = host();
  const runner = new FirmwareRunner(
    toSingleFileProject(sketch, 'arduino-cpp'),
    services,
    'arduino-cpp',
  );
  for (let step = 0; step < 20; step++) {
    if (runner.step() === null) break;
  }
  return recorded;
}

describe('a library a sketch declares the Arduino way', () => {
  it('takes the pin the object attaches and writes the angle it is given', () => {
    const recorded = run(`Servo myServo;
void setup() {
  myServo.attach(9);
  myServo.write(90);
}`);
    expect(recorded.servo.attach).toEqual([9]);
    expect(recorded.servo.write).toEqual([[9, 90]]);
  });

  it('reads the angle from the pin it attached to', () => {
    const recorded = run(`Servo myServo;
void setup() {
  myServo.attach(7);
  Serial.println(myServo.read());
}`);
    expect(recorded.servo.read).toEqual([7]);
  });

  it('takes the pin from the constructor, as the DHT library does', () => {
    const recorded = run(`DHT sensor(2, DHT22);
void setup() {
  sensor.begin();
  Serial.println(sensor.readTemperature());
  Serial.println(sensor.readHumidity());
}`);
    // `begin()` carries no pin of its own, so the constructor's stands.
    expect(recorded.dht.begin).toEqual([2]);
    expect(recorded.dht.temperature).toEqual([2]);
    expect(recorded.dht.humidity).toEqual([2]);
    expect(recorded.serial).toEqual(['21.50\n', '48\n']);
  });

  it("keeps the bench's own shape working", () => {
    const recorded = run(`void setup() {
  servo.attach(9);
  servo.write(9, 90);
  dht.begin(3);
  Serial.println(dht.temperature(3));
}`);
    expect(recorded.servo.write).toEqual([[9, 90]]);
    expect(recorded.dht.temperature).toEqual([3]);
  });

  it("reads the Arduino shape from the bench's own name too", () => {
    const recorded = run(`void setup() {
  servo.attach(9);
  servo.write(90);
}`);
    expect(recorded.servo.write).toEqual([[9, 90]]);
  });

  it("keeps the bench's own read shape working", () => {
    const recorded = run(`void setup() {
  servo.attach(9);
  Serial.println(servo.read(4));
}`);
    expect(recorded.servo.read).toEqual([4]);
  });

  it('drives a display a sketch declared, and a card', () => {
    const printed: string[] = [];
    const files = new Map<string, string>();
    const services = {
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
      lcd: {
        begin: () => {},
        print: (text: string) => {
          printed.push(text);
        },
      },
      sd: {
        begin: () => 1,
        write: (_pin: number, name: string, text: string) => {
          files.set(name, text);
          return 1;
        },
        read: (_pin: number, name: string) => files.get(name) ?? '',
      },
    } as unknown as FirmwareServices;
    const runner = new FirmwareRunner(
      toSingleFileProject(
        `LiquidCrystal display;
SD card;
void setup() {
  display.begin(16, 2);
  display.print("hello");
  card.begin(10);
  card.write("note.txt", "kept");
  Serial.println(card.read("note.txt"));
}`,
        'arduino-cpp',
      ),
      services,
      'arduino-cpp',
    );
    for (let step = 0; step < 20; step++) {
      if (runner.step() === null) break;
    }
    expect(printed).toEqual(['hello']);
    expect(files.get('note.txt')).toBe('kept');
  });

  it("keeps the bench's own card shape working", () => {
    const files = new Map<string, string>();
    const services = {
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
      sd: {
        begin: () => 1,
        write: (_pin: number, name: string, text: string) => {
          files.set(name, text);
          return 1;
        },
        read: (_pin: number, name: string) => files.get(name) ?? '',
      },
    } as unknown as FirmwareServices;
    const runner = new FirmwareRunner(
      toSingleFileProject(
        `void setup() {
  sd.begin(10);
  sd.write(10, "note.txt", "kept");
  Serial.println(sd.read(10, "note.txt"));
}`,
        'arduino-cpp',
      ),
      services,
      'arduino-cpp',
    );
    for (let step = 0; step < 20; step++) {
      if (runner.step() === null) break;
    }
    expect(files.get('note.txt')).toBe('kept');
  });
});
