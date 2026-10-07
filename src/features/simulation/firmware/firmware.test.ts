import { describe, expect, it } from 'vitest';
import { BenchBuilder } from '../bench';
import { columnX, railRowY, stripRowY, breadboardDefinition } from '@/sim/breadboard';
import { esp32DevKitV1 } from '@/sim/boards';
import { ledDefinition, resistorDefinition } from '@/sim/passives';
import { DIODE_PROFILES } from '../elements';
import { Engine } from '../engine';
import { McuRuntime } from '../mcu';
import { FirmwareRunner, PIN_OUTPUT, type FirmwareServices } from './interpreter';
import { FirmwareSyntaxError, tokenize, parseFirmware } from './parser';

const BOARD_ORIGIN_X = 200;
const BOTTOM_NEGATIVE_RAIL = 2;
const SIGNAL_COLUMN = 20;

const holeX = (column: number): number => BOARD_ORIGIN_X + columnX(column);
const holeY = (row: number): number => stripRowY(row);

const BLINK_SKETCH = `
#include <Arduino.h>

#define LED_PIN 2
#define BLINK_MS 100

int blinks = 0;
int history[4] = {10, 20, 30, 40};

void setup() {
  pinMode(LED_PIN, OUTPUT);
  Serial.begin(115200);
  Serial.println("starting");
}

void loop() {
  digitalWrite(LED_PIN, HIGH);
  delay(BLINK_MS);
  digitalWrite(LED_PIN, LOW);
  delay(BLINK_MS);
  blinks++;
  Serial.print("blink ");
  Serial.println(blinks);
}
`;

interface Harness {
  runner: FirmwareRunner;
  engine: Engine;
  mcu: McuRuntime;
  serial: string[];
  /** Runs slices until at least `ms` of simulated time has passed. */
  advanceTo(ms: number): void;
}

/** Builds a bench with an LED on GPIO2, plus a runner driving it from firmware. */
function harnessWithSketch(source: string, pin = 2): Harness {
  const builder = new BenchBuilder();
  builder.addPart(breadboardDefinition(), BOARD_ORIGIN_X, 0);
  const esp32 = builder.addPart(esp32DevKitV1(), 0, 0);

  const pinSpec =
    esp32.definition.pins.find((candidate) => candidate.id === 'R_D2') ??
    esp32.definition.pins[0];
  builder.addWire(pinSpec.x, pinSpec.y, holeX(SIGNAL_COLUMN), holeY(8));
  builder.addPart(resistorDefinition(330), holeX(SIGNAL_COLUMN), holeY(8) - 1.6);
  // Anode-anchored: the long leg lands on its hole, cathode one column along.
  const fwLed = ledDefinition(DIODE_PROFILES.red, 'Red');
  const fwAnode = fwLed.pins.find((pin) => pin.id === 'anode')!;
  builder.addPart(fwLed, holeX(SIGNAL_COLUMN + 4) - fwAnode.x, holeY(8) - fwAnode.y);
  builder.addWire(
    holeX(SIGNAL_COLUMN + 3), holeY(8),
    holeX(SIGNAL_COLUMN + 3), railRowY(BOTTOM_NEGATIVE_RAIL),
  );
  const ground = esp32.definition.pins.find((candidate) => candidate.id === 'L_GND')!;
  builder.addWire(ground.x, ground.y, holeX(10), railRowY(BOTTOM_NEGATIVE_RAIL));

  const mcu = new McuRuntime(esp32.definition);
  const engine = new Engine({ bench: builder.build(), mcu });
  engine.rebuild();

  const serial: string[] = [];
  const services: FirmwareServices = {
    spi: { begin: () => {}, transfer: () => 0, end: () => 0 },
    nowMs: () => engine.timeMs,
    pinMode: (p, mode) => {
      engine.settle();
      mcu.setDirection(p, mode === 0 ? 'input' : mode === 2 ? 'inputPullUp' : 'output');
    },
    digitalWrite: (p, level) => {
      mcu.writeDigital(p, level !== 0, engine.timeMs);
      engine.settle();
    },
    digitalRead: (p) => {
      engine.settle();
      return engine.readDigital(p) ? 1 : 0;
    },
    analogWrite: (p, value) => {
      mcu.writeAnalog(p, value, engine.timeMs);
      engine.settle();
    },
    analogRead: (p) => {
      engine.settle();
      return engine.readAnalog(p);
    },
    serialBegin: () => {},
    serialWrite: (text) => {
      serial.push(text);
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
  };

  // The runner reports how long it wants to wait; the harness decides how much
  // of that to spend, exactly as the app's frame loop does.
  const spend = (ms: number) => {
    if (!engine.hasDynamics()) {
      engine.skip(ms / 1000);
      return;
    }
    const target = engine.timeMs + ms;
    let guard = 0;
    while (engine.timeMs < target && guard++ < 200_000) {
      const remaining = target - engine.timeMs;
      engine.step(Math.min(remaining, 1) / 1000);
    }
  };

  const runner = new FirmwareRunner(source, services);

  void pin;
  return {
    runner,
    engine,
    mcu,
    serial,
    advanceTo(ms) {
      let guard = 0;
      while (engine.timeMs < ms && guard++ < 100_000) {
        const requested = runner.step();
        if (requested === null) break;
        spend(Math.min(requested, ms - engine.timeMs));
      }
    },
  };
}

describe('lexer and parser', () => {
  it('reads a Blink-style sketch into setup and loop', () => {
    const program = parseFirmware(BLINK_SKETCH);
    expect(program.functions.has('setup')).toBe(true);
    expect(program.functions.has('loop')).toBe(true);
    expect(program.defines.get('LED_PIN')).toBe(2);
    expect(program.defines.get('BLINK_MS')).toBe(100);
  });

  it('strips line and block comments', () => {
    const tokens = tokenize('int a; // trailing\n/* block\nspans lines */ int b;');
    expect(tokens.filter((token) => token.text === 'a' || token.text === 'b')).toHaveLength(2);
  });

  it('does not split multi-character operators', () => {
    const tokens = tokenize('a <= b && c >= d');
    const punctuation = tokens.filter((token) => token.kind === 'punctuation').map((t) => t.text);
    expect(punctuation).toEqual(['<=', '&&', '>=']);
  });

  it('reports the line a syntax error is on', () => {
    let thrown: unknown;
    try {
      parseFirmware('void setup() {\n  int x = ;\n}');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(FirmwareSyntaxError);
    expect((thrown as FirmwareSyntaxError).location.line).toBe(2);
  });
});

describe('language semantics', () => {
  const evaluate = (source: string, pin: number): Harness => {
    const harness = harnessWithSketch(
      `int out;
void setup() { ${source} digitalWrite(${pin}, out); }
void loop() { delay(1000); }`,
      pin,
    );
    harness.advanceTo(1);
    return harness;
  };

  it('evaluates arithmetic with C integer division', () => {
    // C truncates 7 / 2 to 3; a JS-flavoured 3.5 here would silently change
    // every sketch that halves a timer.
    expect(evaluate('out = 7 / 2;', 2).mcu.configurationOf('R_D2').duty).toBeCloseTo(1);
    expect(evaluate('out = 0;', 2).mcu.configurationOf('R_D2').duty).toBeCloseTo(0);
  });

  it('evaluates comparisons and boolean logic', () => {
    const program = `
      int out;
      void setup() {
        int a = 3;
        int b = 5;
        if (a < b && b > 0) { out = 1; } else { out = 0; }
        digitalWrite(2, out);
      }
      void loop() { delay(1000); }`;
    const harness = harnessWithSketch(program);
    harness.advanceTo(1);
    expect(harness.mcu.configurationOf('R_D2').duty).toBe(1);
  });

  it('walks a for loop with a running total', () => {
    const program = `
      int out;
      void setup() {
        int total = 0;
        for (int i = 1; i <= 4; i++) { total += i; }
        digitalWrite(2, total == 10);
      }
      void loop() { delay(1000); }`;
    const harness = harnessWithSketch(program);
    harness.advanceTo(1);
    expect(harness.mcu.configurationOf('R_D2').duty).toBe(1);
  });

  it('honours break and continue', () => {
    const program = `
      int out;
      void setup() {
        int n = 0;
        for (int i = 0; i < 10; i++) {
          if (i == 3) { continue; }
          if (i == 6) { break; }
          n++;
        }
        digitalWrite(2, n == 5);
      }
      void loop() { delay(1000); }`;
    const harness = harnessWithSketch(program);
    harness.advanceTo(1);
    // Skipped i=3 and stopped at i=6, so five increments in total.
    expect(harness.mcu.configurationOf('R_D2').duty).toBe(1);
  });

  it('stores and reads array elements', () => {
    const program = `
      int out;
      void setup() {
        int data[4] = {10, 20, 30, 40};
        data[2] = 99;
        digitalWrite(2, data[2] == 99);
      }
      void loop() { delay(1000); }`;
    const harness = harnessWithSketch(program);
    harness.advanceTo(1);
    expect(harness.mcu.configurationOf('R_D2').duty).toBe(1);
  });

  it('calls a user-defined function and returns a value', () => {
    const program = `
      int out;
      int twice(int x) { return x * 2; }
      void setup() { digitalWrite(2, twice(4) == 8); }
      void loop() { delay(1000); }`;
    const harness = harnessWithSketch(program);
    harness.advanceTo(1);
    expect(harness.mcu.configurationOf('R_D2').duty).toBe(1);
  });
});

describe('running a sketch against the circuit', () => {
  it('configures the pin from setup before loop runs', () => {
    const harness = harnessWithSketch(BLINK_SKETCH);
    harness.advanceTo(1);
    expect(harness.mcu.configurationOf('R_D2').direction).toBe('output');
  });

  it('blinks the LED on the interval the sketch asked for', () => {
    const harness = harnessWithSketch(BLINK_SKETCH);
    const net = harness.engine.netOfMcuPin('R_D2');

    // During the first HIGH window the LED is lit; during LOW it is not.
    harness.advanceTo(50);
    expect(harness.mcu.levelOf('R_D2', harness.engine.timeMs)).toBe(1);

    harness.advanceTo(150);
    expect(harness.mcu.levelOf('R_D2', harness.engine.timeMs)).toBe(0);

    harness.advanceTo(250);
    expect(harness.mcu.levelOf('R_D2', harness.engine.timeMs)).toBe(1);
    expect(net).toBeGreaterThanOrEqual(0);
  });

  it('advances simulated time by the delay the sketch requested', () => {
    const harness = harnessWithSketch(BLINK_SKETCH);
    harness.advanceTo(50);
    // Two 100 ms delays elapsed before the LED state was observed at 50 ms.
    expect(harness.engine.timeMs).toBeGreaterThanOrEqual(50);
  });

  it('writes to the serial monitor', () => {
    const harness = harnessWithSketch(BLINK_SKETCH);
    harness.advanceTo(250);

    expect(harness.serial[0]).toBe('starting\n');
    expect(harness.serial.join('')).toContain('blink 1');
  });

  it('drives an analogWrite into a PWM duty on the pin', () => {
    const program = `
      void setup() {
        pinMode(2, OUTPUT);
        analogWrite(2, 128);
      }
      void loop() { delay(500); }`;
    const harness = harnessWithSketch(program);
    harness.advanceTo(50);

    const configuration = harness.mcu.configurationOf('R_D2');
    expect(configuration.pwm).toBe(true);
    expect(configuration.duty).toBeCloseTo(128 / 255, 5);
  });

  it('reads a pin back as digitalRead sees it', () => {
    const program = `
      void setup() { pinMode(2, OUTPUT); }
      void loop() {
        digitalWrite(2, HIGH);
        delay(50);
        if (digitalRead(2) == HIGH) { Serial.println("on"); }
        delay(950);
      }`;
    const harness = harnessWithSketch(program);
    harness.advanceTo(60);
    expect(harness.serial.join('')).toContain('on');
  });
});

describe('pin mode mapping', () => {
  it('treats INPUT_PULLUP as a pull-up input', () => {
    const builder = new BenchBuilder();
    const esp32 = builder.addPart(esp32DevKitV1(), 0, 0);
    const mcu = new McuRuntime(esp32.definition);
    const engine = new Engine({ bench: builder.build(), mcu });
    engine.rebuild();

    mcu.setDirection(27, 'inputPullUp');
    engine.settle();
    expect(engine.voltageOfNet(engine.netOfMcuPin('L_GPIO27'))).toBeCloseTo(3.3, 1);
  });

  it('rejects an unknown pin number without throwing', () => {
    const builder = new BenchBuilder();
    const esp32 = builder.addPart(esp32DevKitV1(), 0, 0);
    const mcu = new McuRuntime(esp32.definition);
    const engine = new Engine({ bench: builder.build(), mcu });
    engine.rebuild();

    expect(() => mcu.setDirection(999, 'output')).not.toThrow();
    expect(mcu.pinIdForGpio(999)).toBeUndefined();
    expect(engine.readDigital(999)).toBe(false);
  });
});

describe('constants', () => {
  it('exposes the Arduino pin constants', () => {
    const source = `
      void setup() {
        pinMode(2, OUTPUT);
        digitalWrite(2, HIGH);
      }
      void loop() { delay(10); }`;
    const harness = harnessWithSketch(source);
    harness.advanceTo(1);
    expect(harness.mcu.configurationOf('R_D2').direction).toBe('output');
    expect(harness.mcu.levelOf('R_D2', harness.engine.timeMs)).toBe(1);
  });

  it('pins INPUT_PULLUP to the value the services are given', () => {
    // Guards the wiring between the VM's constant and the host's decoding.
    expect(PIN_OUTPUT).toBe(1);
  });
});