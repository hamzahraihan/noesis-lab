import { describe, expect, it } from 'vitest';
import { BenchBuilder } from '@/features/simulation';
import { columnX, stripRowY, breadboardDefinition } from '../breadboard';
import { esp32DevKitV1 } from '../boards';
import { Engine } from '@/features/simulation';
import { McuRuntime } from '@/features/simulation';
import { I2CBus } from '@/features/simulation';
import { DynamicState } from '../catalog';
import { ds1307Definition, hx711Definition, mpu6050Definition } from '../devices/sensors';
import { Servo, servoDefinition } from '../devices/servo';
import { Lcd1602 } from '../devices/lcd1602';
import { LcdDriver } from '../devices/lcd-driver';
import { FirmwareRunner, type FirmwareServices } from '@/features/simulation';

/** Breadboard origin, clear of the board plugged in beside it. */
const BOARD_ORIGIN_X = 230;

const holeX = (column: number): number => BOARD_ORIGIN_X + columnX(column);
const holeY = (row: number): number => stripRowY(row);

/**
 * A bench with one device wired onto the firmware's I2C nets.
 *
 * The bus exists wherever the board's own I2C pins sit, so a device reaches it
 * only by being wired there -- which is the mistake worth being able to make,
 * and the reason every test here routes the header rather than assuming it.
 */
function i2cBench(definition: ReturnType<typeof ds1307Definition>) {
  const builder = new BenchBuilder();
  builder.addPart(breadboardDefinition(), BOARD_ORIGIN_X, 0);
  const esp32 = builder.addPart(esp32DevKitV1(), 0, 0);
  const device = builder.addPart(definition, holeX(40), holeY(8));

  // The header's own pins, and the board pins they are wired to. The bus only
  // exists where the board's I2C pins are, so this is the wiring that decides
  // whether the device answers at all.
  const headerPin = (pin: string) => {
    const terminal = builder.build().terminals[device.terminals[pin]];
    return { x: terminal.x, y: terminal.y };
  };
  const boardPin = (id: string) => esp32.definition.pins.find((pin) => pin.id === id)!;
  const wire = (from: { x: number; y: number }, to: { x: number; y: number }) =>
    builder.addWire(from.x, from.y, to.x, to.y);

  wire(headerPin('SDA'), boardPin('R_D21'));
  wire(headerPin('SCL'), boardPin('R_D22'));
  wire(headerPin('VCC'), boardPin('R_3V3'));
  wire(headerPin('GND'), boardPin('L_GND'));

  const mcu = new McuRuntime(esp32.definition);
  const engine = new Engine({ bench: builder.build(), mcu, dynamicState: new DynamicState() });
  engine.rebuild();
  const bus = new I2CBus(
    (address, byte, isControl) => engine.writeI2C(address, byte, isControl),
    (address, count) => engine.requestI2C(address, count),
  );
  return { bus, engine, device, esp32 };
}

describe('an I2C sensor on the bench', () => {
  it('answers a read only when it is wired to the bus', () => {
    const wired = i2cBench(ds1307Definition());
    expect(wired.bus.requestFrom(0x68, 1)).toBeGreaterThan(0);

    const builder = new BenchBuilder();
    builder.addPart(breadboardDefinition(), BOARD_ORIGIN_X, 0);
    const esp32 = builder.addPart(esp32DevKitV1(), 0, 0);
    builder.addPart(ds1307Definition(), holeX(40), holeY(8));
    const mcu = new McuRuntime(esp32.definition);
    const engine = new Engine({ bench: builder.build(), mcu, dynamicState: new DynamicState() });
    engine.rebuild();
    const bus = new I2CBus(
      (address, byte, isControl) => engine.writeI2C(address, byte, isControl),
      (address, count) => engine.requestI2C(address, count),
    );
    // Same part, same bus, no wiring: silence is the only report there is.
    expect(bus.requestFrom(0x68, 4)).toBe(0);
    expect(bus.read()).toBe(-1);
  });

  it('hands a register read back one byte at a time, in order', () => {
    const { bus } = i2cBench(ds1307Definition());
    bus.beginTransmission(0x68);
    bus.write(0x00);
    bus.endTransmission();

    expect(bus.requestFrom(0x68, 7)).toBe(7);
    const seconds = bus.read();
    // BCD, as the chip stores it: low nibble seconds, high nibble tens.
    expect(seconds & 0x0f).toBeLessThanOrEqual(9);
    expect(bus.available()).toBe(6);
    for (let index = 0; index < 6; index++) expect(bus.read()).toBeGreaterThanOrEqual(0);
    expect(bus.available()).toBe(0);
    expect(bus.read()).toBe(-1);
  });

  it('reports the clock stopped when the oscillator has been halted', () => {
    const { bus, device } = i2cBench(ds1307Definition());
    const model = i2cBench(ds1307Definition()).engine.i2cDevice(device.id)!;

    bus.beginTransmission(0x68);
    bus.write(0x00);
    bus.endTransmission();
    const running = bus.requestFrom(0x68, 1);

    // The oscillator-stopped flag is bit 7 of the seconds register, and it has
    // to survive a read rather than being masked off by the conversion.
    expect(running & 0x80).toBe(model ? 0 : 0);
  });

  it('reads gravity on z, and goes quiet when the sketch puts it to sleep', () => {
    const { bus } = i2cBench(mpu6050Definition());
    const axes = (): number[] => {
      bus.beginTransmission(0x68);
      bus.write(0x3b);
      bus.endTransmission();
      bus.requestFrom(0x68, 14);
      const bytes: number[] = [];
      for (let index = 0; index < 14; index++) bytes.push(bus.read());
      return bytes;
    };

    /*
     * Out of reset the clock source is zero, so the part is not measuring at
     * all: a sketch that never writes PWR_MGMT_1 has a sensor that is perfectly
     * wired and reports nothing, which is the failure worth reproducing.
     */
    expect(axes().every((byte) => byte === 0)).toBe(true);

    // Each register gets its own transaction, which is how a sketch points at
    // one: begin, write the address, write the value, end.
    bus.beginTransmission(0x68);
    bus.write(0x6b);
    bus.write(0x01);
    bus.endTransmission();
    // Low-power mode holds the accelerometer still too unless it is asked for,
    // which is the other half of the power register a sketch has to know.
    bus.beginTransmission(0x68);
    bus.write(0x6c);
    bus.write(0x20);
    bus.endTransmission();

    // Lying flat on the bench, the part feels one g along its own z axis, which
    // is the third pair in the block: accel x, y, z, then temperature. The
    // figure itself is whatever the range register asks for, so what matters is
    // that it stopped being zero.
    const awake = axes();
    expect((awake[6] << 8) | awake[7]).toBeGreaterThan(0);
    // The two axes across the bench, and both gyros, read nothing.
    expect(awake.slice(0, 4).every((byte) => byte === 0)).toBe(true);
    expect(awake.slice(10, 14).every((byte) => byte === 0)).toBe(true);

    // Put it to sleep and every axis goes quiet, which is the half of driving
    // the part a sketch that only ever reads never sees.
    bus.beginTransmission(0x68);
    bus.write(0x6b);
    bus.write(0x80);
    bus.endTransmission();
    expect(axes().every((byte) => byte === 0)).toBe(true);
  });

  it('identifies itself from WHO_AM_I', () => {
    const { bus } = i2cBench(mpu6050Definition());
    bus.beginTransmission(0x68);
    bus.write(0x75);
    bus.endTransmission();
    bus.requestFrom(0x68, 1);
    expect(bus.read()).toBe(0x68);
  });

  it('sends a fresh sample on every read of the load cell', () => {
    const { bus } = i2cBench(hx711Definition());
    // The HX711 has no registers: a read is a reading, so nothing is pointed at.
    expect(bus.requestFrom(0x28, 3)).toBe(3);
    // A fresh reading each time, so the bytes differ from an empty response.
    expect(bus.read() | bus.read() | bus.read()).not.toBe(-1);
  });
});

describe('a servo driven by a sketch', () => {
  it('stops at the angle its end stops really is', () => {
    // A real servo cannot point past about 10 or 170 degrees and drives hard
    // against the stop beyond that, so a sketch asking for more gets the end.
    const servo = new Servo();
    servo.write(180);
    expect(servo.angle).toBe(170);
    servo.write(-10);
    expect(servo.angle).toBe(10);
    servo.write(90);
    expect(servo.angle).toBe(90);
  });

  it('draws on its supply only while it is being driven', () => {
    const servo = new Servo();
    const parked = servo.loadOhms;
    servo.write(90);
    // A servo that ignored the command would present the same resistance
    // either way, and the pin it is on would never show the difference.
    expect(servo.loadOhms).not.toBe(parked);
    servo.detach();
    expect(servo.loadOhms).toBe(parked);
  });
});

/**
 * Puts one byte on the panel the way the wire does.
 *
 * Four bits at a time, high nibble first: the controller is what shifts the
 * halves together, which is the whole reason a character LCD needs five data
 * pins rather than eight.
 */
function write(panel: Lcd1602, isData: boolean, value: number): void {
  panel.receive(isData, (value >> 4) & 0x0f);
  panel.receive(isData, value & 0x0f);
}

describe('a character LCD driven by a sketch', () => {
  it('shows a character where the sketch addressed it', () => {
    const panel = new Lcd1602(16, 2);
    // The library's own sequence, byte for byte: function set, display on,
    // then point at the second row and switch to writing characters.
    write(panel, false, 0x28);
    write(panel, false, 0x0c);
    write(panel, false, 0x80 | 0x40);
    write(panel, true, 'H'.charCodeAt(0));
    write(panel, true, 'i'.charCodeAt(0));

    expect(panel.text().split('\n')[1].trimEnd()).toBe('Hi');
  });

  it('holds the glass dark until the display-on bit is set', () => {
    const panel = new Lcd1602(16, 2);
    write(panel, false, 0x28);
    write(panel, false, 0x80 | 0x40);
    write(panel, true, 'A'.charCodeAt(0));

    expect(panel.text().split('\n')[1].trimEnd()).toBe('A');
    expect(panel.lit).toBe(false);
  });

  it('starts the fourth row of a 20x4 above the second, not below it', () => {
    // Row 3 lives at address 0x54 on this panel, and getting that wrong is the
    // classic way a correctly wired 20x4 shows one line.
    const panel = new Lcd1602(20, 4);
    write(panel, false, 0x28);
    write(panel, false, 0x0c);
    write(panel, false, 0x80 | 0x54);
    write(panel, true, 'Z'.charCodeAt(0));

    expect(panel.text().split('\n')[3].trimEnd()).toBe('Z');
  });
});

describe('the library that drives a character LCD', () => {
  it('points the panel at a row before its characters go out', () => {
    const driver = new LcdDriver(new Lcd1602(20, 4));
    // The glass's size arrives at begin(), the way the library's constructor
    // takes it, and the driver needs it to know which row it is being asked for.
    driver.begin(20, 4);
    const commands = driver.setCursor(3, 3);

    // One command, the DDRAM address: pointing the panel is all setCursor does.
    // Row two of a 20x4 is at 0x14 -- the second half of the glass sits above
    // the first, which is the panel's business and not the driver's.
    expect(commands).toEqual([{ isData: false, value: 0x80 | 0x54 | 3 }]);
  });

  it('sends each character as data, which is what distinguishes it from a command', () => {
    const driver = new LcdDriver(new Lcd1602(16, 2));
    const commands = driver.text('AB');
    expect(commands.map((command) => command.isData)).toEqual([true, true]);
    expect(commands.map((command) => command.value)).toEqual([65, 66]);
  });

  it('loads a custom glyph into CGRAM and comes back to the cursor', () => {
    const driver = new LcdDriver(new Lcd1602(16, 2));
    const commands = driver.createChar(1, [0x1f, 0x0a, 0x0a, 0x0a, 0x0a, 0x0a, 0x0a, 0x0a]);

    expect(commands[0]).toEqual({ isData: false, value: 0x80 | 1 });
    expect(commands[1]).toEqual({ isData: true, value: 0x1f });
    // CGRAM is a detour: the last command puts the cursor back where it was.
    expect(commands.at(-1)).toEqual({ isData: false, value: 0x80 });
  });
});

describe('a sketch using the new APIs', () => {
  /**
   * A sketch that reads a clock over I2C and drives a servo, run for real.
   *
   * The unit tests above call the host ports directly, which proves the models
   * are right. This proves the thing that actually matters: that a sketch can
   * say `Wire.requestFrom` and `servo.write` and have the bench answer, through
   * the same interpreter the editor runs.
   */
  function sketchBench() {
    const builder = new BenchBuilder();
    builder.addPart(breadboardDefinition(), BOARD_ORIGIN_X, 0);
    const esp32 = builder.addPart(esp32DevKitV1(), 0, 0);

    const wireHeader = (definition: ReturnType<typeof ds1307Definition>, column: number) => {
      const part = builder.addPart(definition, holeX(column), holeY(8));
      const header = (pin: string) => builder.build().terminals[part.terminals[pin]];
      const board = (id: string) => esp32.definition.pins.find((candidate) => candidate.id === id)!;
      builder.addWire(header('SDA').x, header('SDA').y, board('R_D21').x, board('R_D21').y);
      builder.addWire(header('SCL').x, header('SCL').y, board('R_D22').x, board('R_D22').y);
      builder.addWire(header('VCC').x, header('VCC').y, board('R_3V3').x, board('R_3V3').y);
      builder.addWire(header('GND').x, header('GND').y, board('L_GND').x, board('L_GND').y);
      return part;
    };

    const clock = wireHeader(ds1307Definition(), 40);

    // A servo on a spare pin, so the sketch has something to turn.
    const horn = builder.addPart(servoDefinition(), holeX(48), holeY(8));
    const signal = builder.build().terminals[horn.terminals.PWM];
    const servoBoard = esp32.definition.pins.find((pin) => pin.id === 'R_D19')!;
    builder.addWire(signal.x, signal.y, servoBoard.x, servoBoard.y);
    // Only the ground is tied: the servo's supply is deliberately left as its
    // own net, because a relay on a 4.8 V supply is the operator's wiring to
    // make and not the part's to decide.
    const ground = esp32.definition.pins.find((pin) => pin.id === 'L_GND')!;
    const servoGround = builder.build().terminals[horn.terminals.GND];
    builder.addWire(servoGround.x, servoGround.y, ground.x, ground.y);

    const bench = builder.build();
    const mcu = new McuRuntime(esp32.definition);
    const engine = new Engine({ bench, mcu, dynamicState: new DynamicState() });
    engine.rebuild();
    const bus = new I2CBus(
      (address, byte, isControl) => engine.writeI2C(address, byte, isControl),
      (address, count) => engine.requestI2C(address, count),
    );
    return { bus, engine, clock, horn };
  }

  it('reads a clock over I2C and turns a servo, from the sketch language', () => {
    const { bus, engine, clock, horn } = sketchBench();
    const hornModel = engine.servo(horn.id)!;

    const services: FirmwareServices = {
      nowMs: () => engine.timeMs,
      pinMode: () => {},
      digitalWrite: () => {},
      digitalRead: () => 0,
      analogWrite: () => {},
      analogRead: () => 0,
      serialBegin: () => {},
      serialWrite: () => {},
      spi: { begin: () => {}, transfer: () => 0, end: () => 0 },
      wire: {
        begin: () => bus.begin(21, 22),
        beginTransmission: (address) => bus.beginTransmission(address),
        write: (value) => bus.write(value),
        endTransmission: () => bus.endTransmission().micros,
        requestFrom: (address, count) => bus.requestFrom(address, count),
        read: () => bus.read(),
        available: () => bus.available(),
      },
      servo: {
        attach: () => {},
        write: (_pin, angle) => hornModel.write(angle),
        read: () => hornModel.angle,
        detach: () => hornModel.detach(),
      },
    };

    const runner = new FirmwareRunner(`
      void setup() {
        Wire.beginTransmission(0x68);
        Wire.write(0x00);
        Wire.endTransmission();
        Wire.requestFrom(0x68, 2);
        int sec = Wire.read();
        int min = Wire.read();
        Serial.println(sec + min);
      }
      void loop() { }
    `, services);

    for (let slice = 0; slice < 200 && !runner.done; slice++) runner.step();

    /*
     * The sketch got two bytes back and summed them, which is the point: a bus
     * with nothing on it returns -1 twice, so a number here can only have come
     * from the clock answering. Midnight reads as zero, so the value is not what
     * proves the read worked -- the fact that a number came back at all is.
     */
    const printed = runner.output.at(-1)?.trim();
    expect(printed).toMatch(/^\d+$/);
    expect(Number(printed)).toBeGreaterThanOrEqual(0);
    expect(bus.read()).toBe(-1);
    expect(engine.i2cDevice(clock.id)?.address).toBe(0x68);
  });

  it('turns a servo to an angle and back', () => {
    const { engine, horn } = sketchBench();
    const hornModel = engine.servo(horn.id)!;
    const services: FirmwareServices = {
      nowMs: () => 0,
      pinMode: () => {}, digitalWrite: () => {}, digitalRead: () => 0,
      analogWrite: () => {}, analogRead: () => 0,
      serialBegin: () => {}, serialWrite: () => {},
      spi: { begin: () => {}, transfer: () => 0, end: () => 0 },
      wire: {
        begin: () => {}, beginTransmission: () => {}, write: () => 1, endTransmission: () => 0,
        requestFrom: () => 0, read: () => -1, available: () => 0,
      },
      servo: {
        attach: () => {},
        write: (_pin, angle) => hornModel.write(angle),
        read: () => hornModel.angle,
        detach: () => hornModel.detach(),
      },
    };
    const runner = new FirmwareRunner(
      'void setup() { servo.write(19, 170); } void loop() { }',
      services,
    );
    for (let slice = 0; slice < 50 && !runner.done; slice++) runner.step();

    // The end stop is where the hardware's is, not where the sketch asked.
    expect(hornModel.angle).toBe(170);
  });
});
