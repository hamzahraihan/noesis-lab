import { describe, expect, it } from 'vitest';
import { FirmwareRunner, type FirmwareServices } from './interpreter';
import { toSingleFileProject } from './project';

/**
 * The network libraries, the Arduino way.
 *
 * `HTTPClient`, `PubSubClient` and `WiFiUdp` are the three a sketch that
 * talks to a server declares, and the bench's own `net` port is the shape
 * underneath them. The HTTP client blocks the way a real request blocks,
 * because the answer arrives on the bench's own clock.
 */
interface Recorded {
  readonly serial: string[];
  readonly asked: string[];
  readonly published: Array<[string, string]>;
  readonly subscribed: string[];
  readonly failed: boolean;
}

function host(
  read: string,
  failed = false,
  status = 3,
): { recorded: Recorded; services: FirmwareServices } {
  const recorded: Recorded = {
    serial: [],
    asked: [],
    published: [],
    subscribed: [],
    failed,
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
    net: {
      join: () => 0,
      status: () => status,
      localIp: () => '192.168.4.10',
      get: (url: string) => {
        recorded.asked.push(url);
        return 1;
      },
      read: () => read,
      failed: () => recorded.failed,
      subscribe: (topic: string) => {
        recorded.subscribed.push(topic);
        return 1;
      },
      available: () => 1,
      message: () => '20.0',
      publish: (topic: string, payload: string) => {
        recorded.published.push([topic, payload]);
        return 1;
      },
      reset: () => {},
    },
  } as unknown as FirmwareServices;
  return { recorded, services };
}

/** Runs a sketch and reports what the network was told. */
function run(
  sketch: string,
  read = 'hello from api.noesis',
  failed = false,
  status = 3,
): Recorded {
  const { recorded, services } = host(read, failed, status);
  const runner = new FirmwareRunner(
    toSingleFileProject(sketch, 'arduino-cpp'),
    services,
    'arduino-cpp',
  );
  for (let step = 0; step < 40; step++) {
    if (runner.step() === null) break;
  }
  return recorded;
}

describe('the HTTP client', () => {
  it('asks for the url it was given and reads the answer', () => {
    const recorded = run(`HTTPClient http;
void setup() {
  http.begin("http://api.noesis/hello");
  Serial.println(http.GET());
  Serial.println(http.read());
}`);
    expect(recorded.asked).toEqual(['http://api.noesis/hello']);
    expect(recorded.serial).toEqual(['200\n', 'hello from api.noesis\n']);
  });

  it('says so when the answer failed', () => {
    const recorded = run(
      `HTTPClient http;
void setup() {
  http.begin("http://api.noesis/gone");
  Serial.println(http.GET());
}`,
      '',
      true,
    );
    expect(recorded.serial).toEqual(['-1\n']);
  });

  it('remembers the status of the last answer', () => {
    const recorded = run(`HTTPClient http;
void setup() {
  http.begin("http://api.noesis/hello");
  http.GET();
  Serial.println(http.get());
}`);
    expect(recorded.serial).toEqual(['200\n']);
  });

  it('waits for the answer rather than saying it is not there yet', () => {
    // The answer lands on the bench's own clock, so the client waits for it
    // the way a real request waits: the sketch is held until the body is
    // there, and the wait is the network's latency.
    let polls = 0;
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
      net: {
        join: () => 0,
        status: () => 3,
        localIp: () => '192.168.4.10',
        get: () => {
          polls += 1;
          return polls > 3 ? 1 : 0;
        },
        read: () => 'late',
        failed: () => 0,
        subscribe: () => 1,
        available: () => 0,
        message: () => '',
        publish: () => 1,
        reset: () => {},
      },
    } as unknown as FirmwareServices;
    const runner = new FirmwareRunner(
      toSingleFileProject(
        `HTTPClient http;
void setup() {
  http.begin("http://api.noesis/slow");
  Serial.println(http.GET());
  Serial.println(http.read());
}`,
        'arduino-cpp',
      ),
      services,
      'arduino-cpp',
    );
    for (let step = 0; step < 40; step++) {
      if (runner.step() === null) break;
    }
    // It polled until the answer was there, and then read it.
    expect(polls).toBeGreaterThan(3);
  });
});

describe('the MQTT client', () => {
  it('subscribes and publishes the way a sketch asks', () => {
    const recorded = run(`PubSubClient mqtt;
void setup() {
  Serial.println(mqtt.connect("broker.local"));
  mqtt.subscribe("readings/temp");
  mqtt.publish("commands/interval", "5");
  mqtt.loop();
  Serial.println(mqtt.available());
  Serial.println(mqtt.message());
}`);
    expect(recorded.subscribed).toEqual(['readings/temp']);
    expect(recorded.published).toEqual([['commands/interval', '5']]);
    expect(recorded.serial).toEqual(['1\n', '1\n', '20.0\n']);
  });

  it('will not reach a broker on a network it has not joined', () => {
    // The broker is on the bench's network, so a sketch that has not joined
    // has no broker to reach -- and a client that said otherwise would take
    // a sketch down a path that cannot work.
    const recorded = run(
      `PubSubClient mqtt;
void setup() {
  Serial.println(mqtt.connect("broker.local"));
}`,
      '',
      false,
      0,
    );
    expect(recorded.serial).toEqual(['0\n']);
  });
});

describe('the time client', () => {
  it('reads the time the network knows', () => {
    const recorded = run(
      `WiFiUdp udp;
void setup() {
  udp.config("time.noesis", 123);
  Serial.println(udp.update());
  Serial.println(udp.hour());
  Serial.println(udp.minute());
  Serial.println(udp.year());
  Serial.println(udp.month());
  Serial.println(udp.day());
}`,
      '2026-10-17T12:34:56Z',
    );
    expect(recorded.asked).toEqual(['http://time.noesis/time']);
    expect(recorded.serial).toEqual(['1\n', '12\n', '34\n', '2026\n', '10\n', '17\n']);
  });

  it('counts the epoch the way a clock does', () => {
    const recorded = run(
      `WiFiUdp udp;
void setup() {
  udp.config("time.noesis", 123);
  udp.update();
  Serial.println(udp.epochTime());
}`,
      '2026-10-17T12:00:00Z',
    );
    // The epoch counts from 1970-01-01, and 2026-10-17T12:00:00Z is
    // 1792238400 seconds into it.
    expect(recorded.serial).toEqual(['1792238400\n']);
  });
});
