import { describe, expect, it } from 'vitest';
import { BenchBuilder } from '@/features/simulation';
import { columnX, railRowY, stripRowY, breadboardDefinition } from '../breadboard';
import { esp32DevKitV1 } from '../boards';
import { Engine } from '@/features/simulation';
import { McuRuntime } from '@/features/simulation';
import type { LiquidCrystalPort, ServoPort } from '@/features/simulation';
import { I2CBus } from '@/features/simulation';
import { ssd1306Definition } from './part';
import { Ssd1306 } from './ssd1306';
import { FirmwareRunner, type FirmwareServices } from '@/features/simulation';

const BOARD_ORIGIN_X = 0;
const BREADBOARD_ORIGIN_X = 230;

const holeX = (column: number): number => BREADBOARD_ORIGIN_X + columnX(column);
const holeY = (row: number): number => stripRowY(row);

/**
 * An ESP32 and a breadboard with a 4-pin OLED wired in.
 *
 * `wireDisplay` decides whether SDA and SCL are actually routed to the pins the
 * firmware drives, which is what separates a working screen from a blank one.
 */
function buildDisplayBench(options: {
  wireDisplay?: boolean;
  sdaPin?: string;
  sclPin?: string;
} = {}) {
  const builder = new BenchBuilder();
  const esp32 = builder.addPart(esp32DevKitV1(), BOARD_ORIGIN_X, 0);
  builder.addPart(breadboardDefinition(), BREADBOARD_ORIGIN_X, 0);
  const display = builder.addPart(ssd1306Definition(), BREADBOARD_ORIGIN_X + 40, 90);

  const pinAt = (id: string) => esp32.definition.pins.find((pin) => pin.id === id)!;
  const railY = railRowY(2);

  const route = (pinId: string, column: number) => {
    const pin = pinAt(pinId);
    builder.addWire(pin.x, pin.y, holeX(column), holeY(8));
  };

  // GPIO21 and GPIO22 are the ESP32's default I2C pins, on the right header.
  route(options.sdaPin ?? 'R_D21', 20);
  route(options.sclPin ?? 'R_D22', 22);

  if (options.wireDisplay !== false) {
    // Pin positions in a definition are relative to the part's origin, so a
    // wire to one has to be anchored at the part, not at the pin's local spot.
    const displayPin = (id: string) => {
      const pin = display.definition.pins.find((candidate) => candidate.id === id)!;
      return { x: display.x + pin.x, y: display.y + pin.y };
    };
    const sda = displayPin('SDA');
    const scl = displayPin('SCL');
    builder.addWire(holeX(20), holeY(8), sda.x, sda.y);
    builder.addWire(holeX(22), holeY(8), scl.x, scl.y);

    const vcc = displayPin('VCC');
    const gnd = displayPin('GND');
    builder.addWire(vcc.x, vcc.y, holeX(24), railY);
    builder.addWire(gnd.x, gnd.y, holeX(26), railY);

    const ground = pinAt('L_GND');
    builder.addWire(ground.x, ground.y, holeX(28), railY);
  }

  const mcu = new McuRuntime(esp32.definition);
  const engine = new Engine({ bench: builder.build(), mcu });
  engine.rebuild();
  const bus = new I2CBus(
    (address, byte, isControl) => engine.writeI2C(address, byte, isControl),
    (address, count) => engine.requestI2C(address, count),
  );
  return { builder, esp32, display, engine, mcu, bus };
}
const DRAW_SKETCH = `
int frames = 0;

void oledCommand(int c) {
  Wire.beginTransmission(0x3C);
  Wire.write(0x00);
  Wire.write(c);
  Wire.endTransmission();
}

void setup() {
  Wire.begin(21, 22);
  oledCommand(0xAE);
  oledCommand(0x20); oledCommand(0x00);
  oledCommand(0xB0);
  Wire.beginTransmission(0x3C);
  Wire.write(0x40);
  Wire.write(0xFF);
  Wire.endTransmission();
  oledCommand(0xAF);
}

void loop() {
  frames++;
  delay(50);
}
`;

/** Runs a sketch far enough to complete its setup and first loop pass. */
function runSketch(sources: {
  engine: Engine;
  bus: I2CBus;
  source: string;
  untilMs?: number;
}): FirmwareRunner {
  const services: FirmwareServices = {
    spi: { begin: () => {}, transfer: () => 0, end: () => 0 },
    nowMs: () => sources.engine.timeMs,
    pinMode: () => {},
    digitalWrite: () => {},
    digitalRead: () => 0,
    analogWrite: () => {},
    analogRead: () => 0,
    serialBegin: () => {},
    serialWrite: () => {},
    lcd: UNUSED_LCD,
    servo: UNUSED_SERVO,
    wire: {
      begin: () => sources.bus.begin(21, 22),
      beginTransmission: (address) => sources.bus.beginTransmission(address),
      write: (value) => sources.bus.write(value),
      requestFrom: (address, count) => sources.bus.requestFrom(address, count),
      read: () => sources.bus.read(),
      available: () => sources.bus.available(),
      endTransmission: () => {
        const transfer = sources.bus.endTransmission();
        sources.engine.settle();
        return transfer.micros;
      },
    },
  };

  const runner = new FirmwareRunner(sources.source, services);
  const until = sources.untilMs ?? 60;
  let guard = 0;
  while (sources.engine.timeMs < until && guard++ < 10_000) {
    const requested = runner.step();
    if (requested === null) break;
    const remaining = until - sources.engine.timeMs;
    if (sources.engine.hasDynamics()) {
      const target = sources.engine.timeMs + Math.min(requested, remaining);
      while (sources.engine.timeMs < target) sources.engine.step(0.001);
    } else {
      sources.engine.skip(Math.min(requested, remaining) / 1000);
    }
  }
  return runner;
}

/** The LCD and servo ports a display test never touches. */
const UNUSED_LCD: LiquidCrystalPort = {
  begin: () => 0, clear: () => {}, home: () => {}, setCursor: () => {},
  print: () => {}, write: () => {}, createChar: () => {},
  backlight: () => {}, noBacklight: () => {},
};
const UNUSED_SERVO: ServoPort = {
  attach: () => {}, write: () => {}, read: () => 0, detach: () => {},
};

describe('display on the bench', () => {
  it('routes a byte to a display that is wired onto the I2C pins', () => {
    const { engine, bus, display } = buildDisplayBench();
    bus.begin(21, 22);
    bus.beginTransmission(0x3c);
    bus.write(0x00);
    bus.write(0xaf);
    const transfer = bus.endTransmission();

    expect(transfer.acknowledged).toBe(true);
    expect((engine.displayController(display.id) as Ssd1306 | undefined)?.lit).toBe(true);
  });

  it('leaves the screen dark when the display is not wired', () => {
    const { engine, bus, display } = buildDisplayBench({ wireDisplay: false });
    bus.begin(21, 22);
    bus.beginTransmission(0x3c);
    bus.write(0x00);
    bus.write(0xaf);
    const transfer = bus.endTransmission();

    // Unplugged: the address is never acknowledged.
    expect(transfer.acknowledged).toBe(false);
    expect((engine.displayController(display.id) as Ssd1306 | undefined)?.lit).toBe(false);
  });

  it('ignores a display wired to pins the firmware is not driving', () => {
    // Both bus lines land on ordinary GPIO rather than the I2C pins, so the
    // bytes go nowhere -- the mistake of wiring the display to "any two pins".
    const { engine, bus, display } = buildDisplayBench({
      // Both land on ordinary GPIO rather than the I2C pins, which is the
      // mistake the test is about. D13 and D14 are the ESP32's header labels
      // for GPIO13 and GPIO14.
      sdaPin: 'L_D13',
      sclPin: 'L_D14',
    });
    bus.begin(21, 22);
    bus.beginTransmission(0x3c);
    bus.write(0x00);
    bus.write(0xaf);

    expect(bus.endTransmission().acknowledged).toBe(false);
    expect((engine.displayController(display.id) as Ssd1306 | undefined)?.lit).toBe(false);
  });

  it('does not claim a display at the wrong I2C address', () => {
    const { engine, bus, display } = buildDisplayBench();
    bus.begin(21, 22);
    bus.beginTransmission(0x3d);
    bus.write(0x00);
    bus.write(0xaf);

    expect(bus.endTransmission().acknowledged).toBe(false);
    expect((engine.displayController(display.id) as Ssd1306 | undefined)?.lit).toBe(false);
  });
});

describe('driving the display from firmware', () => {
  it('lights the panel from a sketch when the wiring is right', () => {
    const { engine, bus, display } = buildDisplayBench();
    runSketch({ engine, bus, source: DRAW_SKETCH });

    const controller = engine.displayController(display.id) as Ssd1306;
    expect(controller.lit).toBe(true);
    // One 0xFF byte fills column 0 of page 0.
    expect(controller.isLit(0, 0)).toBe(true);
    expect(controller.isLit(1, 0)).toBe(false);
  });

  it('runs the same sketch with a blank screen when the display is unplugged', () => {
    const { engine, bus, display } = buildDisplayBench({ wireDisplay: false });
    runSketch({ engine, bus, source: DRAW_SKETCH });

    const controller = engine.displayController(display.id) as Ssd1306;
    expect(controller.lit).toBe(false);
    expect(controller.isLit(0, 0)).toBe(false);
  });

  it('spends real time on the bus for each transfer', () => {
    const { engine, bus } = buildDisplayBench();
    const services: FirmwareServices = {
      spi: { begin: () => {}, transfer: () => 0, end: () => 0 },
      nowMs: () => engine.timeMs,
      pinMode: () => {}, digitalWrite: () => {}, digitalRead: () => 0,
      analogWrite: () => {}, analogRead: () => 0,
      serialBegin: () => {}, serialWrite: () => {},
      wire: {
        begin: () => bus.begin(21, 22),
        beginTransmission: (address) => bus.beginTransmission(address),
        write: (value) => bus.write(value),
        endTransmission: () => bus.endTransmission().micros,
        requestFrom: (address, count) => bus.requestFrom(address, count),
        read: () => bus.read(),
        available: () => bus.available(),
      },
      lcd: UNUSED_LCD,
      servo: UNUSED_SERVO,
    };

    const runner = new FirmwareRunner(DRAW_SKETCH, services);
    // The runner reports the transfer's bus time; the host is what spends it.
    const requested = runner.step();
    if (requested !== null) engine.skip(requested / 1000);


    // Setup pushes four transactions, the last carrying a full 1024-byte frame
    // would be tens of milliseconds; even a handful of bytes must cost time.
    expect(engine.timeMs).toBeGreaterThan(0);
  });
});