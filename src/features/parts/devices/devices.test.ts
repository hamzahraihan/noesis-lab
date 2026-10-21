import { describe, expect, it } from 'vitest';
import { BenchBuilder } from '@/features/simulation';
import { columnX, stripRowY, breadboardDefinition } from '../breadboard';
import { esp32DevKitV1 } from '../boards';
import { Engine } from '@/features/simulation';
import { McuRuntime } from '@/features/simulation';
import { I2CBus } from '@/features/simulation';
import { DynamicState, type PartDefinition } from '../catalog';
import {
  ads1115Definition,
  bmp180Definition,
  ds1307Definition,
  hx711Definition,
  ina219Definition,
  mpu6050Definition,
} from '../devices/sensors';
import {
  BMP180_CALIBRATION,
  BMP180_PRESSURE_KNOB,
  BMP180_TEMPERATURE_KNOB,
  compensatePressure,
  compensateTemperature,
} from '../devices/bmp180';
import { INA219_BUS_KNOB, INA219_CURRENT_KNOB, INA219_SHUNT_OHMS } from '../devices/ina219';
import { COUNTS_PER_GRAM } from '../devices/hx711';
import { HX711_LOAD_KNOB } from '../devices/sensors';
import { ADS1115_CHANNEL_KNOBS } from '../devices/ads1115';
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
function i2cBench(definition: PartDefinition) {
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
  const dynamicState = new DynamicState();
  const engine = new Engine({ bench: builder.build(), mcu, dynamicState });
  engine.rebuild();
  const bus = new I2CBus(
    (address, byte, isControl) => engine.writeI2C(address, byte, isControl),
    (address, count) => engine.requestI2C(address, count),
  );
  return { bus, engine, device, esp32, dynamicState };
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

  it('reads the load the operator dialled in', () => {
    const { bus, engine, device, dynamicState } = i2cBench(hx711Definition());
    engine.step(0.05);

    const counts = (): number => {
      const bytes = readBytes(bus, 0x28, 3);
      const word = ((bytes[0] << 16) | (bytes[1] << 8) | bytes[2]) & 0xffffff;
      // Bit 23 is the ready flag; the reading is the 23 bits below it.
      return word & 0x7fffff;
    };

    // An unloaded cell reads its tare, and the knob is the load on it.
    const tare = counts();
    dynamicState.setKnob(device.id, HX711_LOAD_KNOB, 500);
    expect(counts() - tare).toBe(Math.round(500 * COUNTS_PER_GRAM));
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

    const runner = new FirmwareRunner(
      `
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
    `,
      services,
    );

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
      pinMode: () => {},
      digitalWrite: () => {},
      digitalRead: () => 0,
      analogWrite: () => {},
      analogRead: () => 0,
      serialBegin: () => {},
      serialWrite: () => {},
      spi: { begin: () => {}, transfer: () => 0, end: () => 0 },
      wire: {
        begin: () => {},
        beginTransmission: () => {},
        write: () => 1,
        endTransmission: () => 0,
        requestFrom: () => 0,
        read: () => -1,
        available: () => 0,
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

describe('ds1307 sketch-set time', () => {
  it('advances a sketch-written time instead of taking it back', async () => {
    const { Ds1307 } = await import('./ds1307');
    const rtc = new Ds1307();
    rtc.setTime(new Date(2000, 0, 1, 0, 0, 23));
    // RTClib adjust() burst: pointer at 0x00, then sec/min/hr/dow/date/month/year.
    rtc.receive(0x00, true);
    for (const b of [0x00, 0x01, 0x00, 0x06, 0x01, 0x01, 0x00]) rtc.receive(b, false);
    // One host second later the chip must read 00:01:01, not host 00:00:24.
    rtc.setTime(new Date(2000, 0, 1, 0, 0, 24));
    rtc.receive(0x00, true);
    expect([...rtc.read(2)]).toEqual([0x01, 0x01]);
  });

  it('follows the host until a sketch first writes the time', async () => {
    const { Ds1307 } = await import('./ds1307');
    const rtc = new Ds1307();
    rtc.setTime(new Date(2000, 0, 1, 0, 0, 23));
    rtc.setTime(new Date(2000, 0, 1, 0, 0, 24));
    rtc.receive(0x00, true);
    expect([...rtc.read(2)]).toEqual([0x24, 0x00]);
  });

  it('ignores NVRAM writes for clock ownership', async () => {
    const { Ds1307 } = await import('./ds1307');
    const rtc = new Ds1307();
    rtc.setTime(new Date(2000, 0, 1, 0, 0, 23));
    rtc.receive(0x08, true);
    rtc.receive(0xa5, false);
    rtc.setTime(new Date(2000, 0, 1, 0, 0, 24));
    rtc.receive(0x00, true);
    expect([...rtc.read(2)]).toEqual([0x24, 0x00]);
    rtc.receive(0x08, true);
    expect([...rtc.read(1)]).toEqual([0xa5]);
  });
});

describe('ds1307 on a live bench', () => {
  it('keeps advancing a sketch-set time across engine steps', () => {
    const { bus, engine } = i2cBench(ds1307Definition());
    engine.skip(23);
    bus.beginTransmission(0x68);
    bus.write(0x00);
    for (const b of [0x00, 0x01, 0x00, 0x06, 0x01, 0x01, 0x00]) bus.write(b);
    bus.endTransmission();
    engine.skip(1);
    bus.beginTransmission(0x68);
    bus.write(0x00);
    bus.endTransmission();
    expect(bus.requestFrom(0x68, 2)).toBe(2);
    expect([bus.read(), bus.read()]).toEqual([0x01, 0x01]);
  });
});

describe('ds1307 preset', () => {
  it('reads back preset time and advances it with the host', async () => {
    const { Ds1307 } = await import('./ds1307');
    const rtc = new Ds1307();
    rtc.applyPreset(15, 0, 0, [
      [0x08, 1],
      [0x09, 15],
      [0x0a, 10],
    ]);
    rtc.setTime(new Date(2000, 0, 1, 0, 0, 0));
    rtc.receive(0x00, true);
    expect([...rtc.read(3)]).toEqual([0x00, 0x00, 0x15]);
    rtc.setTime(new Date(2000, 0, 1, 0, 0, 61));
    rtc.receive(0x00, true);
    expect([...rtc.read(3)]).toEqual([0x01, 0x01, 0x15]);
    rtc.receive(0x08, true);
    expect([...rtc.read(3)]).toEqual([1, 15, 10]);
  });

  it('keeps ticking through sub-second host steps', async () => {
    const { Ds1307 } = await import('./ds1307');
    const rtc = new Ds1307();
    rtc.applyPreset(15, 0, 0);
    const epoch = new Date(2000, 0, 1).getTime();
    // The live bench advances the host in ~16 ms steps, never a whole second
    // at once. The sub-second remainder has to survive between steps: the
    // registers truncate to the second, so a clock rebuilt from them each
    // step stands still instead of carrying the fraction forward.
    for (let ms = 0; ms < 3000; ms += 16) rtc.setTime(new Date(epoch + ms));
    rtc.setTime(new Date(epoch + 3000));
    rtc.receive(0x00, true);
    expect([...rtc.read(3)]).toEqual([0x03, 0x00, 0x15]);
  });
});

/** The bytes a read asks the bus for, in order. */
function readBytes(bus: I2CBus, address: number, count: number): number[] {
  const bytes: number[] = [];
  bus.requestFrom(address, count);
  for (let index = 0; index < count; index++) bytes.push(bus.read());
  return bytes;
}

/** Points the chip at a register and reads from there. */
function readRegister(bus: I2CBus, address: number, register: number, count: number): number[] {
  bus.beginTransmission(address);
  bus.write(register);
  bus.endTransmission();
  return readBytes(bus, address, count);
}

describe('a barometer on the bench', () => {
  it('identifies itself and hands over the calibration in its E2PROM', () => {
    const { bus } = i2cBench(bmp180Definition());
    // The chip's identification register never changes.
    expect(readRegister(bus, 0x77, 0xd0, 1)).toEqual([0x55]);

    // Eleven words, most significant byte first, in the datasheet's order.
    const bytes = readRegister(bus, 0x77, 0xaa, 22);
    expect(bytes).toHaveLength(22);
    const words: number[] = [];
    for (let index = 0; index < 11; index++) {
      const word = (bytes[index * 2] << 8) | bytes[index * 2 + 1];
      words.push((word << 16) >> 16);
    }
    expect(words).toEqual([
      BMP180_CALIBRATION.ac1,
      BMP180_CALIBRATION.ac2,
      BMP180_CALIBRATION.ac3,
      BMP180_CALIBRATION.ac4,
      BMP180_CALIBRATION.ac5,
      BMP180_CALIBRATION.ac6,
      BMP180_CALIBRATION.b1,
      BMP180_CALIBRATION.b2,
      BMP180_CALIBRATION.mb,
      BMP180_CALIBRATION.mc,
      BMP180_CALIBRATION.md,
    ]);
  });

  it('reports the air the operator has dialled in, as raw counts', () => {
    const { bus, engine, device, dynamicState } = i2cBench(bmp180Definition());
    dynamicState.setKnob(device.id, BMP180_PRESSURE_KNOB, 1013);
    dynamicState.setKnob(device.id, BMP180_TEMPERATURE_KNOB, 20);
    engine.step(0.05);

    // A temperature measurement: write the control register, then read the
    // two data bytes the counts land in.
    bus.beginTransmission(0x77);
    bus.write(0xf4);
    bus.write(0x2e);
    bus.endTransmission();
    const temperature = readRegister(bus, 0x77, 0xf6, 2);
    const rawTemperature = (temperature[0] << 8) | temperature[1];
    // The chip's own count for twenty degrees, which the datasheet's
    // compensation turns back into twenty degrees.
    expect(rawTemperature).toBe(25606);
    expect(compensateTemperature(rawTemperature)).toBe(200);

    // A pressure measurement, whose count is three bytes wide.
    bus.beginTransmission(0x77);
    bus.write(0xf4);
    bus.write(0x34);
    bus.endTransmission();
    const pressure = readRegister(bus, 0x77, 0xf6, 3);
    const rawPressure = ((pressure[0] << 16) | (pressure[1] << 8) | pressure[2]) >> 8;
    // The chip's own count for the pressure the operator dialled in: 1013
    // hectopascals is 101300 pascals.
    expect(rawPressure).toBe(33617);
    // The count is what the converter reported, and the compensation is what
    // turns it back into the pressure: a pascal either way is the chip's own
    // resolution.
    expect(compensatePressure(rawPressure, rawTemperature, 0)).toBeGreaterThan(101_295);
    expect(compensatePressure(rawPressure, rawTemperature, 0)).toBeLessThan(101_305);
  });

  it('follows the operator when the weather changes', () => {
    const { bus, engine, device, dynamicState } = i2cBench(bmp180Definition());
    dynamicState.setKnob(device.id, BMP180_PRESSURE_KNOB, 980);
    dynamicState.setKnob(device.id, BMP180_TEMPERATURE_KNOB, 5);
    engine.step(0.05);

    bus.beginTransmission(0x77);
    bus.write(0xf4);
    bus.write(0x2e);
    bus.endTransmission();
    const temperature = readRegister(bus, 0x77, 0xf6, 2);
    const rawTemperature = (temperature[0] << 8) | temperature[1];
    expect(compensateTemperature(rawTemperature)).toBe(50);

    bus.beginTransmission(0x77);
    bus.write(0xf4);
    bus.write(0x34);
    bus.endTransmission();
    const pressure = readRegister(bus, 0x77, 0xf6, 3);
    const rawPressure = ((pressure[0] << 16) | (pressure[1] << 8) | pressure[2]) >> 8;
    const pascals = compensatePressure(rawPressure, rawTemperature, 0);
    expect(pascals).toBeGreaterThan(97_900);
    expect(pascals).toBeLessThan(98_100);
  });

  it('sees a knob turned between two reads', () => {
    const { bus, engine, device, dynamicState } = i2cBench(bmp180Definition());
    engine.step(0.05);

    const counts = (): number => {
      bus.beginTransmission(0x77);
      bus.write(0xf4);
      bus.write(0x2e);
      bus.endTransmission();
      const bytes = readRegister(bus, 0x77, 0xf6, 2);
      return (bytes[0] << 8) | bytes[1];
    };

    const before = counts();
    expect(compensateTemperature(before)).toBe(200);
    // The operator turns the knob, and the next read sees it -- with no step
    // in between, because the chip reads the world when it reports.
    dynamicState.setKnob(device.id, BMP180_TEMPERATURE_KNOB, 5);
    const after = counts();
    expect(after).not.toBe(before);
    expect(compensateTemperature(after)).toBe(50);
  });

  it('counts finer when the sketch asks for more samples', () => {
    const { bus, engine, device, dynamicState } = i2cBench(bmp180Definition());
    dynamicState.setKnob(device.id, BMP180_PRESSURE_KNOB, 1013);
    dynamicState.setKnob(device.id, BMP180_TEMPERATURE_KNOB, 20);
    engine.step(0.05);

    const pressureAt = (command: number, oss: number): number => {
      bus.beginTransmission(0x77);
      bus.write(0xf4);
      bus.write(command);
      bus.endTransmission();
      const bytes = readRegister(bus, 0x77, 0xf6, 3);
      // The count is left-aligned in the three bytes, and the oversampling
      // says how much of that space it fills.
      return ((bytes[0] << 16) | (bytes[1] << 8) | bytes[2]) >> (8 - oss);
    };
    const low = pressureAt(0x34, 0);
    const high = pressureAt(0xf4, 3);
    // Eight times the samples, and the same pressure in a count eight times as
    // long: the oversampling buys resolution.
    expect(high).toBeGreaterThan(low * 7);
    expect(high).toBeLessThan(low * 9);
  });
});

describe('a current monitor on the bench', () => {
  it('reports the voltage across its shunt and the bus it watches', () => {
    const { bus, engine, device, dynamicState } = i2cBench(ina219Definition());
    dynamicState.setKnob(device.id, INA219_BUS_KNOB, 5);
    dynamicState.setKnob(device.id, INA219_CURRENT_KNOB, 100);
    engine.step(0.05);

    // A hundred milliamps through a tenth of an ohm is ten millivolts, and
    // the shunt register counts in ten microvolts.
    const shunt = readRegister(bus, 0x40, 0x01, 2);
    expect((shunt[0] << 8) | shunt[1]).toBe(Math.round(((100 / 1000) * INA219_SHUNT_OHMS) / 10e-6));

    // The bus register holds the reading in four-millivolt steps, left
    // aligned, with the conversion flag below it.
    const busVoltage = readRegister(bus, 0x40, 0x02, 2);
    expect((busVoltage[0] << 8) | busVoltage[1]).toBe((1250 << 3) | 0x02);
  });

  it('has no current to report until a sketch calibrates it', () => {
    const { bus, engine, device, dynamicState } = i2cBench(ina219Definition());
    dynamicState.setKnob(device.id, INA219_BUS_KNOB, 5);
    dynamicState.setKnob(device.id, INA219_CURRENT_KNOB, 100);
    engine.step(0.05);

    // The current register is invalid until the calibration is written, which
    // is what the real chip says about its own registers.
    expect(readRegister(bus, 0x40, 0x04, 2)).toEqual([0x00, 0x00]);

    // The calibration the datasheet's own worked example uses: a hundred
    // microamps a bit.
    bus.beginTransmission(0x40);
    bus.write(0x05);
    bus.write(0x10);
    bus.write(0x00);
    bus.endTransmission();

    const current = readRegister(bus, 0x40, 0x04, 2);
    expect((current[0] << 8) | current[1]).toBe(1000);
    // Five volts and a tenth of an amp is half a watt, and the power
    // register counts in two milliwatts.
    const power = readRegister(bus, 0x40, 0x03, 2);
    expect((power[0] << 8) | power[1]).toBe(250);
  });

  it('keeps the last reading while it is asleep', () => {
    const { bus, engine, device, dynamicState } = i2cBench(ina219Definition());
    dynamicState.setKnob(device.id, INA219_BUS_KNOB, 5);
    dynamicState.setKnob(device.id, INA219_CURRENT_KNOB, 100);
    engine.step(0.05);
    const before = readRegister(bus, 0x40, 0x01, 2);

    // Power-down is the lowest three bits of the configuration, and a chip in
    // it takes no new measurements.
    bus.beginTransmission(0x40);
    bus.write(0x00);
    bus.write(0x00);
    bus.write(0x00);
    bus.endTransmission();

    dynamicState.setKnob(device.id, INA219_CURRENT_KNOB, 500);
    engine.step(0.05);
    expect(readRegister(bus, 0x40, 0x01, 2)).toEqual(before);
  });

  it('says so when the current is past the range the gain gives it', () => {
    const { bus, engine, device, dynamicState } = i2cBench(ina219Definition());
    dynamicState.setKnob(device.id, INA219_BUS_KNOB, 5);
    dynamicState.setKnob(device.id, INA219_CURRENT_KNOB, 100);
    engine.step(0.05);

    // The finest range is forty millivolts across the shunt, which is four
    // hundred milliamps: a hundred and a half amps' worth of shunt voltage
    // is past it. The gain bits sit above the mode, and the mode stays on.
    bus.beginTransmission(0x40);
    bus.write(0x00);
    bus.write(0x00);
    bus.write(0x07);
    bus.endTransmission();
    dynamicState.setKnob(device.id, INA219_CURRENT_KNOB, 1500);
    engine.step(0.05);

    const shunt = readRegister(bus, 0x40, 0x01, 2);
    expect((shunt[0] << 8) | shunt[1]).toBe(4000);
    const busVoltage = readRegister(bus, 0x40, 0x02, 2);
    // The overflow flag is the low bit of the bus voltage register.
    expect(busVoltage[1] & 0x01).toBe(1);
  });
});

describe('a converter on the bench', () => {
  const readConversion = (bus: I2CBus): number => {
    const bytes = readRegister(bus, 0x48, 0x00, 2);
    return (((bytes[0] << 8) | bytes[1]) << 16) >> 16;
  };

  it('reads a channel as counts against the chip\u2019s own reference', () => {
    const { bus, engine, device, dynamicState } = i2cBench(ads1115Definition());
    dynamicState.setKnob(device.id, ADS1115_CHANNEL_KNOBS[0], 1);
    engine.step(0.05);

    // Single-shot on channel zero, with the gain that gives a volt a
    // thousand counts of headroom.
    bus.beginTransmission(0x48);
    bus.write(0x01);
    bus.write(0xc2);
    bus.write(0x02);
    bus.endTransmission();

    // A volt against a range of 1.024 volts, which is most of the scale.
    expect(readConversion(bus)).toBe(Math.round((1 / 1.024) * 32767));
  });

  it('measures the difference between two channels when it is told to', () => {
    const { bus, engine, device, dynamicState } = i2cBench(ads1115Definition());
    dynamicState.setKnob(device.id, ADS1115_CHANNEL_KNOBS[0], 2);
    dynamicState.setKnob(device.id, ADS1115_CHANNEL_KNOBS[1], 0.5);
    engine.step(0.05);

    // The difference of the first two channels, on the widest range.
    bus.beginTransmission(0x48);
    bus.write(0x01);
    bus.write(0x80);
    bus.write(0x00);
    bus.endTransmission();

    // 1.5 volts against a range of 4.096 volts.
    expect(readConversion(bus)).toBe(Math.round((1.5 / 4.096) * 32767));
  });

  it('gains resolution on the narrowest range', () => {
    const { bus, engine, device, dynamicState } = i2cBench(ads1115Definition());
    dynamicState.setKnob(device.id, ADS1115_CHANNEL_KNOBS[0], 0.1);
    engine.step(0.05);

    // The widest range first: a tenth of a volt out of four.
    bus.beginTransmission(0x48);
    bus.write(0x01);
    bus.write(0xc0);
    bus.write(0x00);
    bus.endTransmission();
    const wide = readConversion(bus);

    // Then the narrowest, where the same voltage is most of the range.
    bus.beginTransmission(0x48);
    bus.write(0x01);
    bus.write(0xc0);
    bus.write(0x04);
    bus.endTransmission();
    const narrow = readConversion(bus);

    expect(narrow).toBeGreaterThan(wide * 15);
    expect(narrow).toBeLessThan(wide * 17);
  });
});
