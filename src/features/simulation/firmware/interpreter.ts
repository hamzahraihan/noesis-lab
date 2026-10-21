/**
 * The firmware virtual machine.
 *
 * Execution is a generator: every call that has to wait -- `delay`,
 * `delayMicroseconds` -- yields the number of milliseconds it needs, and the
 * driver decides how that time is actually spent simulating the circuit. That
 * split is what makes a blocking sketch behave like blocking hardware while
 * still letting the UI render between steps and put breakpoints anywhere.
 *
 * Statements signal `break`, `continue` and `return` as return values rather
 * than by throwing. With `yield*` delegating to nested calls, a return value
 * propagates out of an arbitrarily deep call stack without a throw path.
 */

import { parsePython } from './python';
import type { PythonModule } from './python-modules';
import type { ArduinoPins } from '@/features/parts';
import type { I2cBusPins } from '../engine';
import {
  WL_CONNECT_FAILED,
  WL_CONNECTED,
  WL_DISCONNECTED,
  WL_IDLE_STATUS,
  WL_NO_SSID_AVAIL,
} from '../net/network';

/**
 * Which grammar a program is written in.
 *
 * Both front ends produce the same AST, so this chooses a parser and nothing
 * else: the VM below cannot tell the two languages apart.
 */
export type FirmwareLanguage = 'arduino-cpp' | 'python';

/**
 * `Pin(26)`, `26`, or the name of a constant holding one: the pin a machine
 * constructor names.
 *
 * A program is free to write the pin down once and use it everywhere --
 * `MOVE = 4`, then `Button(MOVE)` -- so a name is read through the scope
 * rather than refused.
 */
function pinArgument(expression: Expr | undefined, scope?: Scope): number | null {
  if (expression === undefined) return null;
  if (expression.kind === 'number') return Math.trunc(expression.value);
  if (expression.kind === 'identifier') {
    if (scope === undefined) return null;
    const value = scope.lookup(expression.name);
    return typeof value === 'number' ? Math.trunc(value) : null;
  }
  if (expression.kind !== 'call') return null;
  const callee = expression.callee;
  const named =
    callee.kind === 'identifier'
      ? callee.name === 'Pin'
      : callee.kind === 'member' &&
        callee.target.kind === 'identifier' &&
        callee.target.name === 'machine' &&
        callee.member === 'Pin';
  if (!named) return null;
  const pin = expression.args[0];
  if (pin?.kind === 'number') return Math.trunc(pin.value);
  if (pin?.kind === 'identifier' && scope !== undefined) {
    const value = scope.lookup(pin.name);
    return typeof value === 'number' ? Math.trunc(value) : null;
  }
  return null;
}

/** What kind of GPIO device a name in a Python program is holding. */
type DeviceKind = 'led' | 'switch' | 'output' | 'input' | 'pwm' | 'adc' | 'i2c';

/**
 * A GPIO device a Python program built with `LED(17)` and kept in a name.
 *
 * gpiozero objects are objects: which pin they drive, and whether they drive it
 * at all, is settled when they are constructed rather than when a method is
 * called. Holding them in a table keyed by name is what lets `led.on()` find the
 * pin behind whatever the programmer called the variable. Dispatching on the
 * name alone, as the C side does for `Serial` and `Wire`, cannot work here --
 * in Python the name is theirs to choose.
 */
interface Device {
  readonly pin: number;
  readonly kind: DeviceKind;
  /**
   * The bus an I2C device talks on, when the sketch named one.
   *
   * A device with no port here talks on the board's own bus, which is what a
   * sketch that names no pins gets.
   */
  readonly i2cPort?: WirePort;
  /** The pins the sketch named, when it named any. */
  readonly i2cPins?: I2cBusPins;
}

/**
 * The pins a `machine.I2C` call names, in either spelling.
 *
 * `I2C(0, 21, 22)` and `I2C(0, sda=21, scl=22)` are the same call, and
 * MicroPython accepts both. A call that names neither gets the board's bus.
 */
function i2cPinsFrom(expression: Expr): I2cBusPins | null {
  if (expression.kind !== 'call') return null;
  const keyword = (name: string): Expr | undefined =>
    expression.keywords?.find((entry) => entry.name === name)?.value;
  const sda = keyword('sda') ?? expression.args[1];
  const scl = keyword('scl') ?? expression.args[2];
  if (sda?.kind !== 'number' || scl?.kind !== 'number') return null;
  return { sda: sda.value, scl: scl.value };
}

/** The gpiozero constructors, and the kind of device each one makes. */
const DEVICE_CONSTRUCTORS: Readonly<Record<string, DeviceKind>> = {
  LED: 'led',
  Button: 'switch',
  OutputDevice: 'output',
  InputDevice: 'input',
  PWMOutputDevice: 'pwm',
};

/**
 * The polarity a `Button` reads.
 *
 * gpiozero's button is active low: the pin is pulled up and a press pulls it
 * down, which is how a button on a breadboard behaves. Inverting here is what
 * makes `button.is_pressed` mean the same thing here as it does there.
 */
const SWITCH_ACTIVE_LOW = true;

/**
 * The `machine` constructors, the MicroPython spelling of the same hardware.
 *
 * The Pico and the Nano RP2040 boot MicroPython, so their sketches write
 * `Pin(2, Pin.OUT)` rather than `LED(2)`. Both end up as the same `Device`
 * table entry: the pin is the pin, and which method a program calls
 * (`value(1)` or `on()`) is a spelling, not a second model of the board.
 */
const MACHINE_CONSTRUCTORS: Readonly<Record<string, DeviceKind>> = {
  Pin: 'output',
  ADC: 'adc',
  PWM: 'pwm',
  I2C: 'i2c',
};

import {
  type ClassDecl,
  type Expr,
  type FunctionDecl,
  type Program,
  type Stmt,
  parseFirmware,
} from './parser';
import {
  DateTimeValue,
  RtcHandle,
  TimeSpanValue,
  addSeconds,
  bcdToDec,
  compareDateTime,
  decToBcd,
  DS1307_ADDRESS,
  NVRAM_BASE,
} from './rtc-shim';
import { FirmwareProjectError, validateProject, type FirmwareProject } from './project';

/**
 * A runtime value: numbers for everything numeric, strings for Serial,
 * whole-array copies where a sketch names an array, dictionaries for the
 * programs that keep a table of things, and RTClib values for sketches that
 * keep time. Date and span objects pass through assignments, arguments and
 * returns untouched; only the operations RTClib defines (field reads,
 * comparison, plus-a-span) see inside them, and everything else reads them as
 * zero rather than crashing. Arrays likewise read as zero wherever a number
 * is wanted (`sizeof` and the SevSeg wiring tables are the readers that see
 * inside them).
 */
export type Value =
  | number
  | string
  | number[]
  | DictValue
  | DateTimeValue
  | TimeSpanValue
  | RtcHandle
  | GeneratorValue
  | Yielded;

/**
 * A generator: a function that hands its values over one at a time.
 *
 * The body is a generator of its own, so nothing runs until the first value
 * is asked for -- the whole point of a generator, and the reason a sketch can
 * write `while True: yield sensor.read()` without taking the bench with it.
 */
export class GeneratorValue {
  readonly generator: Generator<Produced, Flow, void>;

  constructor(generator: Generator<Produced, Flow, void>) {
    this.generator = generator;
  }
}

/**
 * A value a generator hands over, wrapped so a wait and a value differ.
 *
 * The VM's driver is handed a number of milliseconds to wait; a generator
 * hands over a value. Wrapping the value keeps the two apart without
 * guessing from the number.
 */
export interface Yielded {
  readonly yielded: Value;
}

/**
 * A dictionary: the keys are the program's own strings, the values anything a
 * program can hold.
 */
export type DictValue = Map<string, Value>;

/**
 * A Python exception, as the VM raises one and a sketch catches it.
 *
 * The type is the name the sketch wrote (`OSError`, `ValueError`), and the
 * message is the text a person reads. Both travel together because `except`
 * picks a handler by the type and the Problems panel shows the message.
 *
 * Only these are catchable: a fault in the VM itself is a fault in the
 * simulator, and swallowing it would hide the bug rather than the sketch's
 * mistake.
 */
export class PythonError extends Error {
  readonly typeName: string;

  constructor(typeName: string, message: string) {
    super(message);
    this.name = 'PythonError';
    this.typeName = typeName;
  }
}

/**
 * The line a firmware failure reads as.
 *
 * A Python error names its type, the way Python prints it, so the Problems
 * panel shows what the sketch would have shown rather than a bare message.
 */
export function describeFirmwareError(error: unknown): string {
  if (error instanceof PythonError) return `${error.typeName}: ${error.message}`;
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * One SevSeg display's wiring and frame, as `begin` records it.
 *
 * The sketch owns the text: `setNumber`/`setChars` stage segment patterns
 * into `buffer`, and `refreshDisplay` multiplexes one digit per call through
 * the recorded pins, the way the real library drives GPIO rather than a
 * controller. The bench latches each digit electrically from those writes,
 * so the glass the tests read is the solved circuit rather than a second
 * framebuffer.
 */
interface SevSegState {
  digitPins: number[];
  segmentPins: number[];
  digits: number;
  commonAnode: boolean;
  leadingZeros: boolean;
  /** Per-digit A-G patterns, in SEGMENT_ORDER bit order. */
  buffer: number[];
  brightness: number;
  /** Next digit `refreshDisplay` will light. */
  mux: number;
  /**
   * Last driven level by pin. Empty before the first refresh, so the first
   * pass drives every pin; steady passes then emit only real changes.
   * Keyed by pin, never by position: the selected common moves each pass,
   * and a positional record would drop the previous common's release and
   * leave two digits lit at once.
   */
  levels: Map<number, number>;
}

/**
 * Segment patterns by character, in A-G bit order.
 *
 * Digits and the display letters match the bench's own glass table;
 * `'o'` renders as `'0'`, `'n'` lights C/E/G, and `'f'` shares `'F'`'s bars
 * per the SevSeg alpha table the gallery status views rely on. No decimal
 * point is ever wired (the gallery passes seven segment pins with the point
 * disabled), so the alarm snooze mark lights every bar instead.
 */
const SEVSEG_GLYPHS: Readonly<Record<string, number>> = {
  ' ': 0x00,
  '0': 0x3f,
  '1': 0x06,
  '2': 0x5b,
  '3': 0x4f,
  '4': 0x66,
  '5': 0x6d,
  '6': 0x7d,
  '7': 0x07,
  '8': 0x7f,
  '9': 0x6f,
  A: 0x77,
  b: 0x7c,
  C: 0x39,
  c: 0x58,
  d: 0x5e,
  E: 0x79,
  F: 0x71,
  f: 0x71,
  H: 0x76,
  h: 0x74,
  L: 0x38,
  n: 0x54,
  N: 0x54,
  o: 0x3f,
  O: 0x3f,
  P: 0x73,
  U: 0x3e,
  u: 0x1c,
  y: 0x6e,
  '-': 0x40,
  _: 0x08,
  '*': 0x7f,
};

/** Yields the milliseconds a blocking call wants to wait. */
export type DelayRequest = number;

/**
 * What a running program hands back to its driver.
 *
 * A wait is a number of milliseconds; a value a generator yields is wrapped.
 */
export type Produced = DelayRequest | Yielded;

export type Evaluator = Generator<Produced, Value, void>;

export interface FirmwareServices {
  nowMs(): number;
  /**
   * The pin numbers a sketch on this board names pins by.
   *
   * A C++ sketch names Arduino pin indexes and a Python sketch names GPIOs,
   * so the board -- not the program -- decides what a number means. On most
   * boards the two are the same number and this is empty; on the Nano RP2040
   * Connect, whose header is a silkscreen around a chip with its own
   * numbering, it is the difference between `pinMode(2)` and `Pin(25)`.
   */
  readonly pins?: ArduinoPins;
  /**
   * The Python modules this board's runtime has.
   *
   * MicroPython boards speak `machine` and a Raspberry Pi speaks `gpiozero`;
   * a board that says nothing here is taken to have both, which is what a
   * host that does not know the board would assume.
   */
  readonly pythonModules?: readonly PythonModule[];
  pinMode(pin: number, mode: number): void;
  digitalWrite(pin: number, level: number): void;
  digitalRead(pin: number): number;
  analogWrite(pin: number, value: number): void;
  analogRead(pin: number): number;
  /**
   * The top of the board's ADC scale (1023 for ten bits, 4095 for twelve).
   *
   * `analogRead` answers in board counts; MicroPython's `read_u16` answers in
   * sixteen-bit counts on every port, so the translation needs the range it is
   * translating from. Optional, because a host that stubs hardware may not
   * care; ten bits is the common case.
   */
  adcFullScale?: number;
  serialBegin(baud: number): void;
  serialWrite(text: string): void;
  /** The I2C bus, for sketches that drive a display or sensor directly. */
  wire: WirePort;
  /**
   * The bus on a named pair of pins, for a sketch that named them.
   *
   * Optional for the same reason as every other port here: a host that cannot
   * move the bus keeps the board's one, and the sketch talks on it as before.
   */
  wireOnPins?(pins: I2cBusPins): WirePort;
  /**
   * Whether anything on the bench answers at this I2C address.
   *
   * Optional because a host that stubs the bus may not know: the bench itself
   * does, and a MicroPython sketch that reads a device nobody wired gets an
   * `OSError` there, exactly as it would on real hardware. The pins are the
   * ones the sketch named, when it named any.
   */
  i2cHasDevice?(address: number, pins?: I2cBusPins): boolean;
  /** The SPI bus, for sketches that drive a TFT or a flash chip. */
  spi: SpiPort;
  /**
   * Character LCDs and servos.
   *
   * Optional because a host that has no such part on the bench has nothing to
   * drive: a display test has no reason to implement a servo, and requiring it
   * would only teach the next reader that the field is decorative. The bench
   * itself always supplies both.
   */
  lcd?: LiquidCrystalPort;
  /**
   * Map tiles, which a program asks for and polls for.
   *
   * Optional for the same reason `lcd` and `servo` are: a host with no display
   * on the bench has nothing to draw a map on, and a sketch about blinking an
   * LED has no business fetching one.
   */
  map?: MapPort;
  servo?: ServoPort;
  /**
   * A colour TFT: turning it, drawing on it, and asking how big it is.
   *
   * Optional for the same reason as every other port here. The layer is the
   * library, so it reaches the panel over the same four signals the raw path
   * needs: with a jumper missing the panel hears nothing and keeps its last
   * picture, and only the queries (size, text metrics) still answer.
   */
  tft?: TftPort;
  /**
   * Temperature/humidity sensor, by the pin its data line is wired to.
   *
   * Optional because a host with no such part on the bench has nothing to
   * read, for the same reason `lcd` and `servo` are.
   */
  dht?: DhtPort;
  /**
   * IR receiver, by the pin its data line is wired to.
   *
   * Optional because a host with no receiver on the bench has nothing to
   * decode, for the same reason `dht` and `servo` are.
   */
  ir?: IrPort;
  /**
   * Rotary dialer, by the pin its dial line is wired to.
   *
   * Optional because a host with no dialer on the bench has nothing to
   * read back, for the same reason `ir` and `dht` are.
   */
  dialer?: DialerPort;
  /**
   * MicroSD card, by the pin its chip-select line is wired to.
   *
   * Optional because a host with no card on the bench has nowhere to
   * store, for the same reason `dialer` and `ir` are.
   */
  sd?: SdPort;
  /**
   * Addressable LEDs, by the pin their data line is wired to.
   *
   * Optional because a host with no such part on the bench has nothing to
   * paint, for the same reason `dht` and `servo` are.
   */
  pixels?: PixelsPort;
  /**
   * The bench's network, for a board with a radio.
   *
   * Optional because a host with no network has nothing to join, for the same
   * reason `sd` and `dht` are -- and because a bench that never asks for a
   * page should not have to grow one.
   */
  net?: NetPort;
  /**
   * Sonar echo measurement, split across the wait it reports.
   *
   * Optional for the same reason `lcd` and `servo` are: hosts without a
   * sonar part have nothing to measure. `pulseInBegin` arms the echo line
   * and reports its width in microseconds (0 on timeout or with nothing
   * wired); the interpreter waits that long, then calls `pulseInEnd` to
   * release the line. The split is what keeps ECHO high only while a
   * measurement is actually running.
   */
  pulseInBegin?(pin: number, level: number, timeoutUs: number): number;
  pulseInEnd?(): void;
}

/**
 * A slippy map, as firmware sees it.
 *
 * Two calls, and the shape between them is the whole lesson: ask for a tile,
 * find out whether it has arrived, draw it if it has. `request` returning
 * false means "not yet, ask again" rather than "no such tile" -- which is what a
 * real fetch of a real picture over a real radio looks like, and the reason a
 * map program has a loop in it that a drawing program does not.
 */
export interface MapPort {
  /**
   * Asks for the tile at a zoom and grid position, and reports whether it is
   * already here to be drawn.
   */
  request(z: number, x: number, y: number): boolean;
  /**
   * Copies a tile onto the panel at a position, in pixels. Returns false when
   * the tile has not arrived, so a program can leave a hole rather than draw
   * something wrong.
   */
  blit(z: number, x: number, y: number, destX: number, destY: number): boolean;
  /** True once everything asked for has arrived. */
  ready(): boolean;
  /** Forgets outstanding requests, so a new region starts from nothing. */
  reset(): void;
}

/**
 * The bench's network, as firmware sees it.
 *
 * Two halves, deliberately spelled the way the real board spells them. Joining
 * is Arduino's: `begin`, then `status` until it says `WL_CONNECTED`, because
 * that is the loop every ESP32 sketch in the world starts with and it needs no
 * sockets to be true here. Asking for something is the bench's: a url goes out,
 * `get` answers whether the answer has arrived, and `read` hands it over --
 * the same "not yet, ask again" shape `MapPort` uses, for the same reason. A
 * page cannot open a socket, so a method that pretended to would be a lie the
 * learner only discovers later.
 */
export interface NetPort {
  /** Starts joining a network by name and password. */
  join(ssid: string, password: string): number;
  /** The connection status, in `WL_*` codes. Idle until the join lands. */
  status(): number;
  /** The address the network handed out, or "" while there is none. */
  localIp(): string;
  /** Asks for a url: 1 when the answer is ready, 0 while it is not. */
  get(url: string): number;
  /** The body of the ready answer, or "". */
  read(): string;
  /** 1 when the ready answer is a failure rather than a body. */
  failed(): number;
  /** Joins a topic on the network's sensor; 1 when it was accepted. */
  subscribe(topic: string): number;
  /** 1 when a message is waiting for a subscribed topic. */
  available(): number;
  /** The waiting payload, handed over once. "" when nothing is waiting. */
  message(): string;
  /** Sends a message to the network; 1 when it was accepted. */
  publish(topic: string, payload: string): number;
  /** Forgets the last request, so a new one starts from nothing. */
  reset(): void;
}

/**
 * The SPI bus as firmware sees it.
 *
 * The `dataSelect` flag is the D/C level the caller wants on the pin. For a
 * display that choice decides whether a byte is a command or pixel data, so it
 * belongs to the sketch rather than the driver.
 */
export interface SpiPort {
  begin(): void;
  /** Sends one byte with D/C high (data) or low (command). */
  transfer(value: number, dataSelect: boolean): number;
  /** Ends the transfer and reports how long it took, in microseconds. */
  end(): number;
}

/**
 * The I2C bus as firmware sees it.
 *
 * `endTransmission` returns the bus time in microseconds rather than an
 * acknowledgement code, because the VM has to actually wait out a transfer --
 * pushing a full framebuffer over I2C is tens of milliseconds of real time,
 * and skipping it would let a sketch redraw faster than the hardware could.
 */
export interface WirePort {
  begin(sda: number, scl: number): void;
  beginTransmission(address: number): void;
  write(value: number): number;
  /** Finishes the transfer and reports how long it took, in microseconds. */
  endTransmission(): number;
  /**
   * Asks the device at an address for `count` bytes, returning how many are
   * waiting. The register to start from is whatever the last write left as the
   * device's pointer, exactly as on hardware.
   */
  requestFrom(address: number, count: number): number;
  /** One byte of the last request, or -1 once they are spent. */
  read(): number;
  /** Bytes of the last request still unread. */
  available(): number;
}

/**
 * A character LCD, as the Arduino library presents it.
 *
 * The pins are not passed to `begin` because the bench already shows them: an
 * LCD part on the bench carries its own RS/RW/E/D4-D7 header, and a sketch
 * that repeated those numbers would be a second place to get the wiring wrong.
 * Wiring the display to the wrong pins is a mistake worth being able to make.
 */
export interface LiquidCrystalPort {
  /** Binds to the LCD on the bench, or reports that there is none. */
  begin(columns: number, rows: number): number;
  clear(): void;
  home(): void;
  setCursor(column: number, row: number): void;
  /** Writes text at the cursor, advancing it. */
  print(text: string): void;
  /** Writes one byte: a character, or a command when `isCommand`. */
  write(value: number): void;
  /** Loads one custom glyph into CGRAM slot 0-7. */
  createChar(slot: number, bitmap: readonly number[]): void;
  backlight(): void;
  noBacklight(): void;
}

/**
 * A colour TFT, as the TFT_eSPI library presents it.
 *
 * A different shape of display from `LiquidCrystalPort`, and worth being a
 * separate interface for it: an LCD is a grid of characters addressed by row
 * and column, while a TFT is a rectangle of pixels addressed in whatever
 * orientation it happens to be held. `setRotation` is the whole difference in
 * one call, and it changes both the size the sketch thinks it is drawing into
 * and the direction the pixels come out.
 *
 * Optional like the other ports, because a host with no colour panel on the
 * bench has nothing for these calls to act on.
 */
export interface TftPort {
  /**
   * Powers the panel on, the way a library's `begin()` does before it draws.
   *
   * A real controller ignores pixels until its display-on command has arrived,
   * so a convenience layer that drew without this would leave the glass
   * modelled as off while the framebuffer filled up.
   */
  begin(): number;
  /**
   * Turns the panel to orientation `rotation`, 0 to 3, and reports the
   * orientation it ended up in.
   *
   * Returning the orientation rather than nothing is what lets a sketch read
   * back what it asked for: the ILI9341 clamps an out-of-range value to a real
   * orientation instead of failing, exactly as the hardware does.
   */
  setRotation(rotation: number): number;
  /** Visible width after the current orientation. */
  width(): number;
  /** Visible height after the current orientation. */
  height(): number;
  /** Wipes the panel to black. */
  clear(): number;
  /** Fills a rectangle, which is what a status bar or a header actually is. */
  fillRect(x: number, y: number, width: number, height: number, colour: number): number;
  /**
   * Draws text at a position, in the panel's own 5x7 font.
   *
   * Here because the map lesson cannot get on properly without it: the
   * OpenStreetMap tile policy asks any client to say where its data came from,
   * and a sketch that draws somebody else's map and credits nobody is not the
   * example this curriculum wants to set. A credit line is also the smallest
   * genuinely useful thing to put on a display, so it earns the method twice.
   *
   * Text is measured in the same font rather than guessed at, so a sketch can
   * place a line without hard-coding a width that only suits one string.
   */
  print(text: string, x: number, y: number, colour: number): number;
  /** The width in pixels a string will occupy, gaps included. */
  textWidth(text: string): number;
  /** The font's cap height in pixels. */
  textHeight(): number;
}

/**
 * Servos, by the pin they are attached to.
 *
 * An angle is a fact about the servo rather than about a pulse, so this is
 * where the pulse width lives: the bench measures what the sketch sent and
 * the part shows where it ended up.
 */
export interface ServoPort {
  attach(pin: number): void;
  /** Angle in degrees, clamped to whatever the servo can actually reach. */
  write(pin: number, angle: number): void;
  read(pin: number): number;
  detach(pin: number): void;
}

/**
 * A temperature/humidity sensor, by the pin its data line is wired to.
 *
 * Climate is a fact about the part rather than about a waveform, the same
 * way an angle is a fact about a servo: the bench reads the knobs and the
 * sketch reads the bench. The single-wire protocol is deliberately not
 * modeled -- see the `dht` netlist case.
 */
export interface DhtPort {
  begin(pin: number): void;
  /** Degrees of whatever unit the part's temperature knob works in. */
  temperature(pin: number): number;
  /** Percent relative humidity from the part's humidity knob. */
  humidity(pin: number): number;
}

/**
 * An IR receiver, by the pin its data line is wired to.
 *
 * The code is a fact about the air rather than about a carrier burst,
 * the same way climate is a fact about a DHT sensor: a held remote
 * transmits, the engine holds the code past release, and the sketch
 * reads it here. Carrier modulation is deliberately not modeled.
 */
export interface IrPort {
  /** Live NEC code on the pin, or 0 with nothing transmitting. */
  readCode(pin: number): number;
}

/**
 * A rotary dialer, by the pin its dial line is wired to.
 *
 * The digit is a fact about the last dial rather than about a pulse
 * train, the same way a code is a fact about the air: the operator
 * dials, the engine latches the digit, and the sketch reads it here.
 * Pulse trains are deliberately not modeled -- see the dialer netlist
 * case.
 */
export interface DialerPort {
  /** Last dialed digit on the pin, or -1 before the first dial. */
  read(pin: number): number;
}

/**
 * A MicroSD card, by the pin its chip-select line is wired to.
 *
 * Files are facts about the card rather than about a bus protocol,
 * the same way a digit is a fact about the last dial: the sketch
 * writes text and reads it back. FAT, the SPI command set, and binary
 * files are deliberately not modeled -- see the `microsd` netlist case.
 */
export interface SdPort {
  /** 1 when a card answers on the pin, else 0. */
  begin(pin: number): number;
  /** Stores text under a name; bytes stored, or 0 past the cap. */
  write(pin: number, name: string, text: string): number;
  /** Text under a name, or "" when missing. */
  read(pin: number, name: string): string;
  /** 1 when a name exists on the card, else 0. */
  exists(pin: number, name: string): number;
  /** Deletes a name; 1 when something was removed, else 0. */
  remove(pin: number, name: string): number;
}

/**
 * Addressable LEDs, by the pin their data line is wired to.
 *
 * Colors are facts about the part rather than about a bitstream, the same
 * way climate is a fact about a DHT sensor: the sketch sets entries in a
 * buffer and the artwork paints them. The WS2812 timing is deliberately
 * not modeled.
 */
export interface PixelsPort {
  /** LEDs on the part wired to a pin, or 0 with nothing there. */
  count(pin: number): number;
  /** Paints one LED; out-of-range indexes are ignored. */
  setColor(pin: number, index: number, r: number, g: number, b: number): void;
}

export const PIN_INPUT = 0;
export const PIN_OUTPUT = 1;
export const PIN_INPUT_PULLUP = 2;
export const LEVEL_LOW = 0;
export const LEVEL_HIGH = 1;

/** Signals a non-local exit from a statement. */
export type Flow =
  | { kind: 'normal' }
  | { kind: 'break' }
  | { kind: 'continue' }
  | { kind: 'return'; value: Value };

const NORMAL: Flow = { kind: 'normal' };

/**
 * Whether a statement tree yields somewhere.
 *
 * A walk over the tree rather than a list of the kinds that can hold one: a
 * yield can sit in an expression inside any of them, and a list would be a
 * list to keep in step with the grammar.
 */
function containsYield(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(containsYield);
  if (node === null || typeof node !== 'object') return false;
  const record = node as Record<string, unknown>;
  if (record.kind === 'yield') return true;
  for (const key of Object.keys(record)) {
    if (key === 'location') continue;
    if (containsYield(record[key])) return true;
  }
  return false;
}

class Scope {
  readonly values = new Map<string, Value>();
  /** GPIO devices built by a Python program, kept beside the values. */
  readonly devices = new Map<string, Device>();
  /** Arrays keep their own store so `data[i] = x` writes through. */
  readonly arrays = new Map<string, number[]>();
  readonly parent: Scope | null;

  constructor(parent: Scope | null = null) {
    this.parent = parent;
  }

  lookup(name: string): Value | undefined {
    for (const scope of chainFrom(this)) {
      if (scope.values.has(name)) return scope.values.get(name);
    }
    return undefined;
  }

  /** Assigns in the nearest scope that already declares the name, else locally. */
  assign(name: string, value: Value): void {
    for (const scope of chainFrom(this)) {
      if (scope.values.has(name)) {
        scope.values.set(name, value);
        return;
      }
    }
    this.values.set(name, value);
  }

  arrayFor(name: string): number[] | undefined {
    for (const scope of chainFrom(this)) {
      if (scope.arrays.has(name)) return scope.arrays.get(name);
    }
    return undefined;
  }

  /**
   * The GPIO device a name is holding, searched the way values are.
   *
   * A Python function assigns into the nearest scope that already declares a
   * name, so a device built in a function and used after it has to be found by
   * the same walk that finds the value itself.
   */
  deviceFor(name: string): Device | undefined {
    for (const scope of chainFrom(this)) {
      const device = scope.devices.get(name);
      if (device) return device;
    }
    return undefined;
  }

  /** Binds a name to a device, or shadows an outer binding with a new one. */
  bindDevice(name: string, device: Device): void {
    for (const scope of chainFrom(this)) {
      if (scope.devices.has(name) || scope.values.has(name)) {
        scope.devices.set(name, device);
        return;
      }
    }
    this.devices.set(name, device);
  }
}

/** Yields a scope and each of its enclosing scopes, innermost first. */
function* chainFrom(start: Scope): Generator<Scope> {
  for (let node: Scope | null = start; node !== null; node = node.parent) {
    yield node;
  }
}

/**
 * A live class instance: its class name plus its field frame.
 *
 * Fields live in a real `Scope` chained to the runtime globals, so a method
 * body reads and writes them through the ordinary lookup walk -- parameters,
 * then fields, then globals -- with no copying. Sharing the frame rather than
 * copying it is what keeps re-entrant calls (`c.reset()` calling back into
 * another method on `c`) from clobbering each other's writes.
 */
export class Instance {
  readonly className: string;
  readonly scope: Scope;
  constructor(className: string, globals: Scope) {
    this.className = className;
    this.scope = new Scope(globals);
  }
}

function isTruthy(value: Value): boolean {
  if (typeof value === 'number') return value !== 0;
  // A dictionary is something when it holds something, the way Python reads
  // it; an empty one is nothing.
  if (value instanceof Map) return value.size > 0;
  // A date, a span or an RTC handle is always something rather than nothing;
  // sketches test their fields, never the object itself.
  if (typeof value === 'object') return true;
  return value.length > 0;
}

function asNumber(value: Value): number {
  if (typeof value === 'number') return value;
  // RTClib values have no numeric reading: only their fields and comparisons
  // do, through the dispatch that understands them.
  if (typeof value === 'object') return 0;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * The name a value has in Python, for the message an error reads as.
 */
function pythonTypeName(value: Value): string {
  if (typeof value === 'string') return 'str';
  if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'float';
  if (Array.isArray(value)) return 'list';
  if (value instanceof Map) return 'dict';
  if (value instanceof DateTimeValue) return 'datetime';
  if (value instanceof TimeSpanValue) return 'timespan';
  if (value instanceof RtcHandle) return 'rtc';
  if (value instanceof GeneratorValue) return 'generator';
  return 'object';
}

/**
 * The errors a call the interpreter does not know raises.
 *
 * A call that resolves nowhere used to answer 0. That is a wrong answer a
 * sketch cannot see: `len(data)` and `d.get('a')` read as zero, and the
 * learner believes the data was zero rather than the bench missing the call.
 * The bench's own rule is that a sketch which cannot say something says so,
 * so the call stops with a reason and the message names what was called.
 *
 * The four kinds share one vocabulary, so the Problems panel reads the same
 * way whichever front end the sketch was written in.
 */
function unknownError(
  kind: 'call' | 'member' | 'object' | 'callable',
  name: string,
  typeName: string,
  language: FirmwareLanguage,
): PythonError {
  if (language === 'python') {
    switch (kind) {
      case 'call':
      case 'object':
        return new PythonError('NameError', `name '${name}' is not defined`);
      case 'member':
        return new PythonError('AttributeError', `'${typeName}' object has no attribute '${name}'`);
      case 'callable':
        return new PythonError('TypeError', `'${typeName}' object is not callable`);
    }
  }
  switch (kind) {
    case 'call':
      return new PythonError('Error', `no function named '${name}'`);
    case 'object':
      return new PythonError('Error', `no object named '${name}'`);
    case 'member':
      return new PythonError('Error', `no method named '${name}' on a ${typeName}`);
    case 'callable':
      return new PythonError('Error', `a ${typeName} is not something that can be called`);
  }
}

/** Renders a value the way `print` and an f-string would write it. */
function formatValue(value: Value): string {
  if (typeof value === 'string') return value;
  // C has no array printing; brackets name the contents rather than the
  // misleading library fallback below.
  if (Array.isArray(value)) return `[${value.join(', ')}]`;
  // A dictionary prints the way Python prints one: the keys in quotes.
  if (value instanceof Map) {
    const entries = [...value.entries()].map(
      ([key, item]) => `'${key}': ${formatValue(item)}`,
    );
    return `{${entries.join(', ')}}`;
  }
  // A generator prints as what it is; a value on its way out of one prints
  // as the value it carries.
  if (typeof value === 'object') {
    if ('yielded' in value) return formatValue(value.yielded);
    if (value instanceof GeneratorValue) return '<generator>';
    return formatObjectValue(value);
  }
  return formatPrintValue(asNumber(value));
}

/** Renders an RTClib value for `print`: dates read as calendar text. */
function formatObjectValue(value: DateTimeValue | TimeSpanValue | RtcHandle): string {
  if (value instanceof DateTimeValue) {
    const pad = (part: number): string => String(part).padStart(2, '0');
    return `${value.year()}-${pad(value.month())}-${pad(value.day())} ${pad(value.hour())}:${pad(value.minute())}:${pad(value.second())}`;
  }
  if (value instanceof TimeSpanValue) return String(value.totalSeconds());
  return 'rtc';
}

/**
 * Builds a `DateTime` from call arguments: RTClib defaults every trailing
 * component, so two to six arguments all construct (`year, month, day` then
 * `hour = 0, minute = 0, second = 0`), and bare construction is the
 * zero time, 2000-01-01 00:00:00.
 */
function constructDateTime(args: Value[]): DateTimeValue {
  const component = (index: number, fallback: number): number =>
    args[index] === undefined ? fallback : asNumber(args[index] as Value);
  return new DateTimeValue(
    component(0, 2000),
    component(1, 1),
    component(2, 1),
    component(3, 0),
    component(4, 0),
    component(5, 0),
  );
}

/** Builds a `TimeSpan` from call arguments: days, hours, minutes, seconds. */
function constructTimeSpan(args: Value[]): TimeSpanValue {
  const component = (index: number): number =>
    args[index] === undefined ? 0 : asNumber(args[index] as Value);
  return new TimeSpanValue(component(0), component(1), component(2), component(3));
}

/** Reads a `DateTime` field the way `now.hour()` spells it. */
function dateTimeMember(value: DateTimeValue, member: string): Value {
  switch (member) {
    case 'year':
      return value.year();
    case 'month':
      return value.month();
    case 'day':
      return value.day();
    case 'hour':
      return value.hour();
    case 'minute':
      return value.minute();
    case 'second':
      return value.second();
    default:
      return 0;
  }
}

/** Reads a `TimeSpan` field; the gallery only builds them, never reads them. */
function timeSpanMember(value: TimeSpanValue, member: string): Value {
  switch (member) {
    case 'days':
      return value.days();
    case 'hours':
      return value.hours();
    case 'minutes':
      return value.minutes();
    case 'seconds':
      return value.seconds();
    case 'totalseconds':
      return value.totalSeconds();
    default:
      return 0;
  }
}

const LOCAL_INCLUDE = /^#\s*include\s*"([^"]+)"/;
/** Quoted core headers that ride through (toolchain -I), never project tabs. */
const SYSTEM_QUOTED_HEADERS = new Set(['arduino.h', 'wire.h', 'spi.h']);
/**
 * Library-owned instance types with no tab declaration: the class is never
 * declared in the project (the library owns it), so a global of that type
 * answers through services rather than through method bodies. `SevSeg` and
 * `RTC_DS1307` are the only two the gallery library tabs and the Tier-2
 * fixture instantiate -- every other `Type name` global must name a class
 * the merged tabs declare, or `fromProject` rejects it as a probable typo.
 */
const LIBRARY_OWNED_INSTANCES = new Set(['SevSeg', 'RTC_DS1307']);
function localIncludes(content: string): string[] {
  return content
    .split('\n')
    .map((line) => LOCAL_INCLUDE.exec(line.trim())?.[1])
    .filter((name): name is string => Boolean(name));
}
function pythonImports(content: string): string[] {
  const names: string[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    const direct = /^import\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(trimmed)?.[1];
    const from = /^from\s+([A-Za-z_][A-Za-z0-9_]*)\s+import\s+/.exec(trimmed)?.[1];
    const candidate = direct ?? from;
    if (candidate && candidate !== 'time') names.push(candidate);
  }
  return names;
}

/**
 * The Python modules a program imports that name a runtime rather than a file.
 *
 * `machine` and `gpiozero` are not tabs: they are the vocabulary of the
 * runtime a board boots, and a program that imports the one its board does
 * not have is asking for a library that is not there.
 */
const RUNTIME_MODULES: readonly PythonModule[] = ['machine', 'gpiozero'];

function isRuntimeModule(name: string): name is PythonModule {
  return (RUNTIME_MODULES as readonly string[]).includes(name);
}

function pythonRuntimeImports(content: string): PythonModule[] {
  return pythonImports(content).filter(isRuntimeModule);
}

export class FirmwareRuntime {
  program!: Program;
  defines!: Map<string, number>;
  /** Expression defines, evaluated where used (see the `Program` contract). */
  macros!: Map<string, Expr>;

  private globals!: Scope;
  private functions!: Map<string, FunctionDecl>;
  private instances!: Map<string, Instance>;
  private classMethods!: Map<string, Map<string, FunctionDecl>>;
  private classes!: Map<string, ClassDecl>;
  /** Folded `static const` field values per class (`Button::RELEASED` → 1). */
  private classStatics!: Map<string, Map<string, number>>;
  /**
   * The instance whose method body is running, for sibling dispatch.
   *
   * A bare call inside a method (`read()` in `Button::pressed`) names a
   * sibling, not a global; `callFunction` checks this before the global
   * table. Null outside any method, so plain sketches never consult it.
   */
  private currentInstance!: Instance | null;
  /**
   * The name a Python method binds its object to, the `self` of
   * `def bump(self)`.
   *
   * Python's methods take the object they work on as their first argument and
   * the body reaches it by that name, so the name has to be known to read and
   * write the object's own fields. Null outside a Python method, which is
   * every C++ one.
   */
  private currentSelfName: string | null = null;
  /**
   * Which functions are generators, cached per declaration.
   *
   * A function that yields is a generator: calling it hands back a generator
   * rather than a value, and its body does not run until the first value is
   * asked for. The answer is cached because a sketch may call such a
   * function once a second for a whole session.
   */
  private generators!: WeakMap<FunctionDecl, boolean>;
  /**
   * Macro names currently being expanded, against self-reference: a define
   * that names itself (`#define X X + 1`) answers zero rather than recursing
   * forever. Saved per runtime, not per call, because expansion nests through
   * ordinary evaluation.
   */
  private macroResolving!: string[];
  /**
   * Sounding `tone()` pins to their silence time, or null while indefinite.
   *
   * `tone` never blocks: it drives HIGH and records when the note ends, and
   * the next `tone`/`noTone` on the pin retires it. A sketch that polls
   * (`AlarmTone::play` every loop) hears the 500/800 Hz alternation through
   * its own table; the bench reads levels, never frequencies.
   */
  private tones!: Map<number, { endsAt: number | null }>;
  /**
   * SevSeg wiring and frames by instance, as each `begin` records them.
   *
   * Keyed by instance rather than kept in the field frame so method bodies
   * never see reserved names and two displays never share a frame.
   */
  private sevseg!: Map<Instance, SevSegState>;
  /**
   * Last RTC read plus how many times it has been served. One bench carries
   * one DS1307 at 0x68, so a single slot is exact — and `adjust` clears it,
   * since time moved under the cache.
   *
   * Served by count, never by the clock: reads must not call nowMs(), which
   * would perturb call-count-scripted time sources. Each served pass still
   * costs its 1ms scheduler quantum, so 50 serves bound staleness to roughly
   * 50ms — far below the per-second glass and the raw build's own 10 Hz
   * re-read rate.
   */
  private rtcNowCache: { value: DateTimeValue; served: number } | null = null;
  private language!: FirmwareLanguage;

  constructor(source: string, language: FirmwareLanguage = 'arduino-cpp') {
    this.init(language === 'python' ? parsePython(source) : parseFirmware(source), language);
  }

  /** Shared init for the single-source and merged-project paths. */
  private init(program: Program, language: FirmwareLanguage): void {
    this.program = program;
    this.language = language;
    this.defines = new Map(program.defines);
    this.macros = new Map(program.macros);
    this.macroResolving = [];
    // Set here rather than by a field initializer: the merged-project path
    // builds the runtime without its constructor, so a field initializer
    // would never run.
    this.generators = new WeakMap();
    this.tones = new Map();
    this.sevseg = new Map();
    this.rtcNowCache = null;
    this.globals = new Scope();
    this.functions = new Map();
    this.instances = new Map();
    this.classes = new Map(program.classes);
    this.classMethods = new Map();

    for (const declaration of this.program.functions.values()) {
      this.functions.set(declaration.name, declaration);
    }

    for (const [className, declaration] of program.classes) {
      this.classMethods.set(className, new Map(declaration.methods));
    }
    /*
     * Out-of-line definitions (`Counter::bump`) parse as qualified function
     * names; file them back under their class so method dispatch finds them.
     * A definition carries the body, so it wins over the in-class declaration
     * stub (empty body) it completes. Defaults live on the declaration
     * (`= 100` is not repeated out of line), so each parameter inherits the
     * stub's default when the definition omits it.
     */
    for (const declaration of this.functions.values()) {
      const separator = declaration.name.indexOf('::');
      if (separator < 0) continue;
      const className = declaration.name.slice(0, separator);
      const method = declaration.name.slice(separator + 2);
      if (!className || !method) continue;
      let methods = this.classMethods.get(className);
      if (!methods) {
        methods = new Map();
        this.classMethods.set(className, methods);
      }
      const stub = methods.get(method);
      let parameters = declaration.parameters;
      if (stub && stub.parameters.length === declaration.parameters.length) {
        parameters = declaration.parameters.map((parameter, index) => {
          const fallback = stub.parameters[index]?.defaultValue;
          if (parameter.defaultValue !== undefined || fallback === undefined) return parameter;
          return { ...parameter, defaultValue: fallback };
        });
      }
      methods.set(method, { ...declaration, name: method, parameters });
    }

    for (const name of ['HIGH', 'LOW', 'INPUT', 'OUTPUT', 'INPUT_PULLUP']) {
      this.globals.values.set(name, BUILTIN_CONSTANTS[name]);
    }
    /*
     * SevSeg display types, as SevSeg.h numbers them: the gallery's
     * `#define DISPLAY_TYPE COMMON_ANODE` resolves through here, so `begin`
     * learns the polarity from the name rather than a magic literal.
     */
    this.globals.values.set('COMMON_CATHODE', 0);
    this.globals.values.set('COMMON_ANODE', 1);
    this.globals.values.set('true', 1);
    this.globals.values.set('false', 0);
    /*
     * The network's status codes, imported rather than copied: a sketch written
     * here compares against `WL_CONNECTED` and means what it would on a real
     * board, and the values live with the network that produces them.
     */
    this.globals.values.set('WL_IDLE_STATUS', WL_IDLE_STATUS);
    this.globals.values.set('WL_NO_SSID_AVAIL', WL_NO_SSID_AVAIL);
    this.globals.values.set('WL_CONNECTED', WL_CONNECTED);
    this.globals.values.set('WL_CONNECT_FAILED', WL_CONNECT_FAILED);
    this.globals.values.set('WL_DISCONNECTED', WL_DISCONNECTED);
    /*
     * Uno analog aliases: A0 is GPIO 14 through A5 at 19. Sketches name pins
     * `A0`, and an unknown identifier would otherwise read zero and bind the
     * button to the wrong pin without a word anywhere.
     */
    for (let pin = 0; pin <= 5; pin++) {
      this.globals.values.set(`A${pin}`, 14 + pin);
    }
    this.currentInstance = null;
    /*
     * Static consts (`const static bool RELEASED = HIGH`): folded here so
     * `Button::MEMBER` reads resolve with no instance, and construction seeds
     * the same values into each instance's field frame.
     */
    this.classStatics = new Map();
    for (const [className, declaration] of program.classes) {
      const table = new Map<string, number>();
      for (const field of declaration.fields) {
        if (!field.init) continue;
        const value = this.staticValue(field.init);
        if (value !== undefined) table.set(field.name, value);
      }
      if (table.size > 0) this.classStatics.set(className, table);
    }
  }

  /** Merged-construction path for fromProject; shares init with the constructor. */
  private static __merged(
    merged: {
      defines: Map<string, number>;
      macros: Map<string, Expr>;
      globals: Stmt[];
      functions: Map<string, FunctionDecl>;
      classes: Map<string, ClassDecl>;
    },
    language: FirmwareLanguage,
  ): FirmwareRuntime {
    const runtime = Object.create(FirmwareRuntime.prototype) as FirmwareRuntime;
    runtime.init(
      {
        defines: merged.defines,
        macros: merged.macros,
        globals: merged.globals,
        functions: merged.functions,
        classes: merged.classes,
      },
      language,
    );
    return runtime;
  }

  static fromProject(project: FirmwareProject): FirmwareRuntime {
    const problems = validateProject(project);
    if (problems.length > 0) throw new FirmwareProjectError(problems[0]);
    const byName = new Map(project.files.map((file) => [file.name, file.content]));
    // Bench-legal tab names are lowercase, but verbatim upstream tabs keep
    // capitalized quoted includes ("Button.h"). Resolve case-insensitively
    // to match packager.ts, so a broken include still fails as not-found
    // instead of resolving the wrong tab.
    const byLower = new Map([...byName.keys()].map((k) => [k.toLowerCase(), k]));
    // Resolve + cycle check over local edges only.
    const order: string[] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (name: string, stack: string[]) => {
      if (visited.has(name)) return;
      if (visiting.has(name))
        throw new FirmwareProjectError(`${[...stack, name].join(' → ')}: include cycle detected`);
      visiting.add(name);
      const content = byName.get(name) ?? '';
      const rawEdges =
        project.language === 'python'
          ? pythonImports(content)
              .filter((mod) => !isRuntimeModule(mod))
              .map((mod) => `${mod}.py`)
          : localIncludes(content);
      // Quoted system headers ride through like packager.ts (they resolve
      // via the toolchain -I roots): only project tabs are edges here.
      // Upstream tabs quote "Arduino.h"; the bench core provides it.
      const edges =
        project.language === 'python'
          ? rawEdges
          : rawEdges.filter((e) => !SYSTEM_QUOTED_HEADERS.has(e.toLowerCase()));
      for (const edge of edges) {
        const target = byLower.get(edge.toLowerCase());
        if (!target) {
          const owner = name;
          throw new FirmwareProjectError(
            project.language === 'python'
              ? `${owner}: import ${edge.replace(/\.py$/, '')} not found`
              : `${owner}: #include "${edge}" not found`,
          );
        }
        visit(target, [...stack, name]);
      }
      visiting.delete(name);
      visited.add(name);
      order.push(name);
    };
    const entry = project.language === 'python' ? 'main.py' : 'main.ino';
    visit(project.files.find((f) => f.name === entry)?.name ?? project.files[0].name, []);
    for (const file of project.files) if (!visited.has(file.name)) visit(file.name, []);
    // Parse each file with its own name, then merge.
    const programs = order.map((name) =>
      project.language === 'python'
        ? parsePython(byName.get(name)!, name)
        : parseFirmware(byName.get(name)!, name),
    );
    const defines = new Map<string, number>();
    const macros = new Map<string, Expr>();
    const globals: Stmt[] = [];
    const functions = new Map<string, FunctionDecl>();
    // A class is declared once (usually in a header) while its `Class::`
    // definitions live in other tabs, so per-file declarations merge instead
    // of colliding: fields union, methods union, duplicate methods rejected
    // like duplicate functions.
    const classes = new Map<string, ClassDecl>();
    const functionOwner = new Map<string, string>();
    const defineOwner = new Map<string, string>();
    const classOwner = new Map<string, string>();
    programs.forEach((program, index) => {
      const owner = order[index];
      for (const [key, value] of program.defines) {
        if (defines.has(key) && defines.get(key) !== value) {
          throw new FirmwareProjectError(
            `${owner}: conflicting #define ${key} (also in ${defineOwner.get(key)})`,
          );
        }
        defines.set(key, value);
        if (!defineOwner.has(key)) defineOwner.set(key, owner);
      }
      globals.push(...program.globals);
      for (const [key, expression] of program.macros) {
        // First tab wins: a name that also differs as a numeric define
        // already threw in the defines merge above, so only identical
        // expression defines can meet here.
        if (!macros.has(key)) macros.set(key, expression);
      }
      for (const [key, decl] of program.functions) {
        if (functions.has(key)) {
          throw new FirmwareProjectError(
            `${owner}: duplicate function '${key}' (also in ${functionOwner.get(key)})`,
          );
        }
        functions.set(key, decl);
        functionOwner.set(key, owner);
      }
      for (const [key, decl] of program.classes) {
        const existing = classes.get(key);
        if (!existing) {
          classes.set(key, decl);
          classOwner.set(key, owner);
          continue;
        }
        const fields = [...existing.fields];
        for (const field of decl.fields) {
          if (!fields.some((known) => known.name === field.name)) fields.push(field);
        }
        const methods = new Map(existing.methods);
        for (const [methodName, methodDecl] of decl.methods) {
          if (methods.has(methodName)) {
            throw new FirmwareProjectError(
              `${owner}: duplicate method '${key}::${methodName}' (also in ${classOwner.get(key)})`,
            );
          }
          methods.set(methodName, methodDecl);
        }
        classes.set(key, { name: key, fields, methods, location: existing.location });
      }
    });
    /*
     * A `Type name` global builds a class instance when the globals run, so
     * an unknown class name here is almost certainly a typo (`Buton b(A0)`)
     * that would otherwise run dark answering zeros. Library-owned types
     * with no tab declaration ride through; everything else must name a
     * class the merged tabs declare.
     */
    programs.forEach((program, index) => {
      const owner = order[index];
      for (const statement of program.globals) {
        if (statement.kind !== 'instanceDecl') continue;
        if (classes.has(statement.className)) continue;
        if (LIBRARY_OWNED_INSTANCES.has(statement.className)) continue;
        throw new FirmwareProjectError(
          `${owner}: unknown class '${statement.className}' (global '${statement.name}')`,
        );
      }
    });
    return FirmwareRuntime.__merged(
      { defines, macros, globals, functions, classes },
      project.language,
    );
  }

  hasFunction(name: string): boolean {
    return this.functions.has(name);
  }

  /**
   * The GPIO a pin number names, in the namespace this program speaks.
   *
   * A C++ sketch names Arduino pin indexes, and on a board whose header and
   * chip disagree -- the Nano RP2040 Connect -- that index is not the GPIO.
   * A Python sketch names GPIOs already, so nothing is translated there: the
   * same board answers `Pin(25)` and `pinMode(2)` with the same hole.
   */
  private pinOf(services: FirmwareServices, pin: number): number {
    if (this.language !== 'arduino-cpp') return pin;
    const map = services.pins?.map;
    if (!map) return pin;
    return map[pin] ?? pin;
  }

  /**
   * Whether this board's runtime has a Python module.
   *
   * A host that says nothing is taken to have both, which is what a stub
   * without a board would assume.
   */
  private hasModule(services: FirmwareServices, module: PythonModule): boolean {
    const modules = services.pythonModules;
    return modules === undefined || modules.includes(module);
  }

  /** Runs `setup()` once, then `loop()` forever. Yields each blocking wait. */
  *main(services: FirmwareServices): Generator<Produced, void, void> {
    /*
     * The `A0`..`A5` constants belong to the board, not to the Uno: an ESP32
     * names its analog pins by the GPIO behind them and a Mega numbers them
     * from 54, so a sketch that says `analogRead(A0)` has to mean the hole
     * the board's own core would.
     */
    const aliases = services.pins?.aliases;
    if (aliases) {
      for (const [name, value] of Object.entries(aliases)) {
        this.globals.values.set(name, value);
      }
    }
    for (const declaration of this.program.globals) {
      yield* this.execute(declaration, this.globals, services);
    }
    /*
     * Arduino has two entry points the board calls in turn. Python has
     * neither: the module body above is the whole program, and calling a
     * function the programmer happened to name `setup` would invent an entry
     * point they never wrote.
     */
    if (this.language === 'python') return;
    if (this.functions.has('setup')) {
      yield* this.callFunction('setup', [], this.globals, services);
    }
    if (!this.functions.has('loop')) return;

    // Real firmware resets the watchdog and yields to the RTOS here. Nothing
    // needs modelling, but loop() must hand control back after every pass: a
    // loop() containing no delay would otherwise never yield and would wedge
    // the whole simulation inside one generator step.
    for (;;) {
      yield* this.callFunction('loop', [], this.globals, services);
      yield 0;
    }
  }

  private *callFunction(
    name: string,
    args: Value[],
    parent: Scope,
    services: FirmwareServices,
    keywords: readonly { name: string; value: Value }[] = [],
  ): Generator<Produced, Value, void> {
    /*
     * `len` measures what it is handed: a string's characters, a list's
     * elements, a dictionary's keys. It used to look the argument up as a
     * *name*, so it measured nothing and answered 0 for every value.
     */
    if (name === 'len') {
      const value = args[0] ?? 0;
      if (typeof value === 'string') return value.length;
      if (Array.isArray(value)) return value.length;
      if (value instanceof Map) return value.size;
      throw new PythonError('TypeError', `object of type '${pythonTypeName(value)}' has no len()`);
    }

    /*
     * RTClib value construction (`DateTime(2026, 10, 11, 9, 30)`,
     * `TimeSpan(1, 0, 0, 0)`): checked before sibling dispatch, because a
     * type name can never be a method and a constructor call inside a Clock
     * body must build a value rather than recurse into a same-named member.
     */
    if (name === 'DateTime') return constructDateTime(args);
    if (name === 'TimeSpan') return constructTimeSpan(args);

    /*
     * A bare call inside a method body (`read()` in `Button::pressed`):
     * members hide globals in C++, so a sibling method wins over any
     * same-named builtin or global here. Outside a method there is no
     * instance and the lookup below never runs.
     */
    if (this.currentInstance) {
      const sibling = this.classMethods.get(this.currentInstance.className)?.get(name);
      if (sibling) {
        return yield* this.runMethodBody(this.currentInstance, sibling, args, services);
      }
    }

    const builtin = BUILTINS[name];
    if (builtin) return builtin(args.map(asNumber));

    const declaration = this.functions.get(name);
    if (!declaration) {
      /*
       * A name that holds a value is not a function. Calling it used to
       * answer 0, which reads as a call that returned nothing rather than as
       * a call that cannot be made.
       */
      const held = parent.lookup(name);
      if (held !== undefined) {
        throw unknownError('callable', name, pythonTypeName(held), this.language);
      }
      return yield* this.evaluateCall(name, args, services);
    }

    const scope = new Scope(parent);
    this.bindCallArguments(scope, declaration, args, keywords);
    if (this.isGenerator(declaration)) {
      /*
       * A generator hands its values over one at a time, so the call builds
       * the body without running it: the first value is asked for when the
       * loop asks, and nothing at all happens until then.
       */
      return new GeneratorValue(this.execute(declaration.body, scope, services));
    }

    const flow = yield* this.execute(declaration.body, scope, services);
    return flow.kind === 'return' ? flow.value : 0;
  }

  /**
   * Binds a call's arguments to a function's parameters.
   *
   * The named parameters take the arguments by position, a parameter the
   * caller left out takes its default, a `*args` parameter takes what is
   * left, and a keyword argument binds the parameter of that name wherever
   * the argument sits. A name the function does not have is left alone: the
   * built-ins take what they know and ignore the rest, and a sketch that
   * spells a call the way its documentation does should not stop at the
   * spelling.
   */
  private bindCallArguments(
    scope: Scope,
    declaration: FunctionDecl,
    args: Value[],
    keywords: readonly { name: string; value: Value }[],
  ): void {
    const varargs = declaration.varargs;
    declaration.parameters.forEach((parameter, index) => {
      // The `*args` parameter is bound below, to the arguments the named
      // parameters did not take.
      if (varargs !== undefined && parameter.name === varargs) return;
      const argument = args[index];
      if (argument !== undefined) {
        scope.values.set(parameter.name, argument);
        return;
      }
      // An argument the caller left out takes the parameter's default, or
      // nothing at all when it has none.
      scope.values.set(
        parameter.name,
        parameter.defaultValue === undefined ? 0 : (this.staticValue(parameter.defaultValue) ?? 0),
      );
    });
    if (varargs !== undefined) {
      const named = declaration.parameters.filter((parameter) => parameter.name !== varargs).length;
      scope.values.set(varargs, args.slice(named));
    }
    for (const keyword of keywords) {
      if (declaration.parameters.some((parameter) => parameter.name === keyword.name)) {
        scope.values.set(keyword.name, keyword.value);
      }
    }
  }

  /** Whether a function yields, and is therefore a generator. */
  private isGenerator(declaration: FunctionDecl): boolean {
    const cached = this.generators.get(declaration);
    if (cached !== undefined) return cached;
    const found = containsYield(declaration.body);
    this.generators.set(declaration, found);
    return found;
  }

  /**
   * Folds a field initializer that needs no runtime (`= LOW`, `= 100`).
   *
   * Anything that calls out (`= read()`) answers undefined and evaluates at
   * construction instead, against the live field frame.
   */
  private staticValue(expression: Expr): number | undefined {
    switch (expression.kind) {
      case 'number':
        return expression.value;
      case 'boolean':
        return expression.value ? 1 : 0;
      case 'unary': {
        const operand = this.staticValue(expression.operand);
        if (operand === undefined) return undefined;
        switch (expression.operator) {
          case '-':
            return -operand;
          case '+':
            return operand;
          case '!':
            return operand !== 0 ? 0 : 1;
          case '~':
            return ~operand;
          default:
            return undefined;
        }
      }
      case 'binary': {
        const left = this.staticValue(expression.left);
        const right = this.staticValue(expression.right);
        if (left === undefined || right === undefined) return undefined;
        return applyBinary(expression.operator, left, right);
      }
      case 'identifier': {
        const global = this.globals.lookup(expression.name);
        if (typeof global === 'number') return global;
        if (typeof global === 'string') return asNumber(global);
        return this.defines.get(expression.name);
      }
      default:
        return undefined;
    }
  }

  /**
   * Builds a global instance: every field defaults to zero, in-class field
   * initializers seed their values, then the constructor binds its arguments
   * (falling back to declared defaults), runs its initializer list, and runs
   * its body. The list matters because Button constructs entirely in it --
   * the body alone is empty, so skipping it would leave every field zero.
   */
  private *constructInstance(
    className: string,
    name: string,
    args: Value[],
    services: FirmwareServices,
  ): Generator<Produced, void, void> {
    const instance = new Instance(className, this.globals);
    const declaration = this.classes.get(className);
    for (const field of declaration?.fields ?? []) {
      if (!instance.scope.values.has(field.name)) instance.scope.values.set(field.name, 0);
    }
    for (const field of declaration?.fields ?? []) {
      if (!field.init) continue;
      const known = this.classStatics.get(className)?.get(field.name);
      instance.scope.values.set(
        field.name,
        known ?? ((yield* this.evaluate(field.init, instance.scope, services)) as Value),
      );
    }
    /*
     * A member wired to the bench rather than to a number: any field declared
     * as an `RTC_DS1307` starts as a live handle on the I2C clock, so method
     * bodies call `_rtc.now()` against the registers instead of a zero.
     * General for any class that holds one, exercised here by Clock.
     */
    for (const field of declaration?.fields ?? []) {
      if (field.type === 'RTC_DS1307' && !field.init) {
        instance.scope.values.set(field.name, new RtcHandle());
      }
    }
    this.instances.set(name, instance);
    const methods = this.classMethods.get(className);
    /*
     * Python's constructor is `__init__`; C++'s is a method named after the
     * class, and the two are not the same thing.
     */
    const ctor = this.language === 'python' ? methods?.get('__init__') : methods?.get(className);
    if (!ctor) return;
    const previous = this.currentInstance;
    this.currentInstance = instance;
    const previousSelf = this.currentSelfName;
    this.currentSelfName =
      this.language === 'python' ? (ctor.parameters[0]?.name ?? null) : null;
    try {
      const frame = new Scope(instance.scope);
      yield* this.bindMethodParameters(frame, instance, ctor, args, services);
      for (const entry of ctor.initList ?? []) {
        instance.scope.values.set(
          entry.field,
          (yield* this.evaluate(entry.value, frame, services)) as Value,
        );
      }
      yield* this.execute(ctor.body, frame, services);
    } finally {
      this.currentInstance = previous;
      this.currentSelfName = previousSelf;
    }
  }

  /**
   * Binds call-site arguments over declared defaults. A missing argument
   * evaluates its default in the field frame; with no default it binds zero,
   * the way an uninitialised field reads.
   */
  private *bindMethodParameters(
    frame: Scope,
    instance: Instance,
    declaration: FunctionDecl,
    args: Value[],
    services: FirmwareServices,
  ): Generator<Produced, void, void> {
    let index = 0;
    /*
     * A Python method's first parameter is the object itself, and the caller
     * does not pass it: `c.bump()` reaches the object as `self`. The C++ path
     * has no such parameter, so the two bind differently.
     */
    const parameters =
      this.language === 'python' ? declaration.parameters.slice(1) : declaration.parameters;
    const varargs = declaration.varargs;
    for (const parameter of parameters) {
      // The `*args` parameter is bound below, to the arguments the named
      // parameters did not take.
      if (varargs !== undefined && parameter.name === varargs) continue;
      const arg = args[index++];
      if (arg !== undefined) {
        frame.values.set(parameter.name, arg);
      } else if (parameter.defaultValue) {
        frame.values.set(
          parameter.name,
          (yield* this.evaluate(parameter.defaultValue, instance.scope, services)) as Value,
        );
      } else {
        frame.values.set(parameter.name, 0);
      }
    }
    if (varargs !== undefined) {
      const named = parameters.filter((parameter) => parameter.name !== varargs).length;
      frame.values.set(varargs, args.slice(named));
    }
  }

  /**
   * Runs a method body with the instance fields in scope, without touching
   * the sibling-dispatch pointer: callers either set it (callMethod) or
   * already hold it (a bare call inside a body).
   */
  private *runMethodBody(
    instance: Instance,
    declaration: FunctionDecl,
    args: Value[],
    services: FirmwareServices,
  ): Generator<Produced, Value, void> {
    const frame = new Scope(instance.scope);
    yield* this.bindMethodParameters(frame, instance, declaration, args, services);
    /*
     * While a Python method runs, the name its first parameter carries is the
     * object the body works on, so `self.n` reads that object's field.
     */
    const previousSelf = this.currentSelfName;
    this.currentSelfName =
      this.language === 'python' ? (declaration.parameters[0]?.name ?? null) : null;
    try {
      const flow = yield* this.execute(declaration.body, frame, services);
      return flow.kind === 'return' ? flow.value : 0;
    } finally {
      this.currentSelfName = previousSelf;
    }
  }

  /**
   * Runs a method body with the instance fields in scope.
   *
   * The frame chains parameters over the instance's field frame, so bare
   * field names read and write the live store -- including through nested
   * blocks, which the plain `Scope` walk reaches because the fields are a
   * real link in the chain rather than a copy. Missing methods answer zero,
   * the way unknown functions do. While the body runs,
   * bare calls resolve to siblings on this instance (saved and restored
   * around nesting, the way a call stack behaves).
   */
  *callMethod(
    instance: Instance,
    method: string,
    args: Value[],
    services: FirmwareServices,
  ): Generator<Produced, Value, void> {
    /*
     * A global RTC (`RTC_DS1307 rtc; rtc.now()`): the class is never declared
     * in a tab -- the library owns it -- so the handle answers directly
     * rather than through method bodies that do not exist.
     */
    if (instance.className === 'RTC_DS1307') {
      return yield* this.evaluateRtcCall(method, args, services);
    }
    /*
     * A SevSeg display (`SevSeg sevseg; sevseg.setNumber(...)`): the class is
     * never declared in a tab -- the library owns it -- so the instance
     * answers through recorded wiring and GPIO rather than through method
     * bodies that do not exist, the way the RTC handle does.
     */
    if (instance.className === 'SevSeg') {
      return this.evaluateSevSegCall(instance, method, args, services);
    }
    const declaration = this.classMethods.get(instance.className)?.get(method);
    if (!declaration) return 0;
    const previous = this.currentInstance;
    this.currentInstance = instance;
    try {
      return yield* this.runMethodBody(instance, declaration, args, services);
    } finally {
      this.currentInstance = previous;
    }
  }

  /**
   * Binds a name to a GPIO device when its initialiser builds one.
   *
   * `led = LED(17)` is a constructor call whose result is an object rather than
   * a number, so the name has to be told what it is holding. Settling that here,
   * where the name itself is bound, is what keeps the two in step: a
   * constructor reaching `callFunction` would have no way to know which name it
   * was being stored under.
   *
   * Returns whether it bound one. The pin has to be a literal, because that is
   * the only thing it could be read from without evaluating the initialiser
   * twice.
   */
  private bindDeviceFrom(
    name: string,
    expression: Expr,
    scope: Scope,
    services: FirmwareServices,
  ): boolean {
    if (expression.kind !== 'call') return false;
    const callee = expression.callee;
    const called =
      callee.kind === 'identifier'
        ? { name: callee.name, viaMachine: false }
        : callee.kind === 'member' &&
            callee.target.kind === 'identifier' &&
            callee.target.name === 'machine'
          ? { name: callee.member, viaMachine: true }
          : null;
    if (called === null) return false;

    // gpiozero first: its names are the unambiguous ones.
    const gpiozero = called.viaMachine ? undefined : DEVICE_CONSTRUCTORS[called.name];
    if (gpiozero !== undefined) {
      if (!this.hasModule(services, 'gpiozero')) return false;
      const pin = pinArgument(expression.args[0], scope);
      if (pin === null) return false;
      const device: Device = { pin, kind: gpiozero };
      scope.bindDevice(name, device);
      /*
       * gpiozero's inputs are pulled up by default -- `Button(pin)` means
       * `pull_up=True` -- which is what makes a button on a pin and a leg to
       * ground read as a press rather than as a floating line. Leaving them as
       * plain inputs would have the pin sit at whatever the solver thinks an
       * undriven net is, and the button would report presses nobody made.
       */
      services.pinMode(
        device.pin,
        gpiozero === 'switch' || gpiozero === 'input' ? PIN_INPUT_PULLUP : PIN_OUTPUT,
      );
      return true;
    }

    /*
     * `machine` next, and bare names only from a Python program: after
     * `from machine import Pin`, `Pin(2, Pin.OUT)` is the idiom, while in C++
     * that spelling may well be a call of the program's own.
     */
    if (!called.viaMachine && this.language !== 'python') return false;
    const kind = MACHINE_CONSTRUCTORS[called.name];
    if (kind === undefined) return false;
    if (!this.hasModule(services, 'machine')) return false;

    if (kind === 'i2c') {
      /*
       * `machine.I2C(0, sda=21, scl=22)` names the pair it wants, and a
       * sketch that names one gets the bus on those pins: a device wired
       * elsewhere is not answered, which is what the pins mean on real
       * hardware. A sketch that names neither gets the board's own bus, and a
       * host that cannot move the bus keeps the board's one either way.
       */
      const pins = i2cPinsFrom(expression);
      const port = pins !== null ? services.wireOnPins?.(pins) : undefined;
      scope.bindDevice(name, {
        pin: 0,
        kind,
        ...(port ? { i2cPort: port } : {}),
        ...(pins ? { i2cPins: pins } : {}),
      });
      return true;
    }

    const pin = pinArgument(expression.args[0], scope);
    if (pin === null) return false;

    if (kind === 'adc') {
      scope.bindDevice(name, { pin, kind });
      return true;
    }

    /*
     * `Pin(n, Pin.OUT)`: MicroPython's default is an input, and the direction
     * is an expression (`Pin.OUT` is a member read of a name that is not an
     * object) rather than an evaluated value, so it is read from the AST.
     */
    const mode = expression.args[1];
    const pull = expression.args[2];
    const output =
      kind === 'pwm' ||
      (mode?.kind === 'member' && mode.member === 'OUT') ||
      (mode?.kind === 'number' && mode.value !== 0);
    const pullUp = kind !== 'pwm' && pull?.kind === 'member' && pull.member === 'PULL_UP';
    const device: Device = { pin, kind: kind === 'pwm' ? 'pwm' : output ? 'output' : 'input' };
    scope.bindDevice(name, device);
    services.pinMode(
      pin,
      kind === 'pwm' || output ? PIN_OUTPUT : pullUp ? PIN_INPUT_PULLUP : PIN_INPUT,
    );
    return true;
  }

  /**
   * Binds a name to an object when the initialiser builds one.
   *
   * `c = Counter()` is a constructor call whose result is an object rather
   * than a number, so the name has to be told what it is holding. The class
   * has to be one this program declared: the built-ins answer for themselves.
   */
  private *bindInstanceFrom(
    name: string,
    expression: Expr,
    scope: Scope,
    services: FirmwareServices,
  ): Generator<Produced, boolean, void> {
    if (expression.kind !== 'call' || expression.callee.kind !== 'identifier') return false;
    const className = expression.callee.name;
    if (!this.classes.has(className)) return false;
    const args: Value[] = [];
    for (const argument of expression.args) {
      args.push((yield* this.evaluate(argument, scope, services)) as Value);
    }
    yield* this.constructInstance(className, name, args, services);
    return true;
  }

  /** Builtins the VM does not implement itself delegate to the host services. */
  private *evaluateCall(
    name: string,
    args: Value[],
    services: FirmwareServices,
  ): Generator<Produced, Value, void> {
    switch (name) {
      /*
       * Python's `print`, which is where a Pi program writes. It goes to the
       * same serial sink as `Serial.print` rather than to the page console,
       * because the serial monitor is the one place this bench shows a
       * program talking to something.
       */
      case 'print': {
        const separator = args.length > 1 ? ' ' : '';
        services.serialWrite(args.map(formatValue).join(separator) + '\n');
        return 0;
      }

      /*
       * The conversions a Python program uses to put a number into a string.
       * Without `str` there is no way to build text from a value at all, which
       * makes every `"pin " + something` quietly produce a zero.
       */
      case 'str':
        return formatValue(args[0] ?? 0);
      case 'int':
        return Math.trunc(asNumber(args[0] ?? 0));
      case 'float':
        return asNumber(args[0] ?? 0);
      case 'bool':
        return isTruthy(args[0] ?? 0) ? 1 : 0;
      case 'delay': {
        const ms = Math.max(0, asNumber(args[0] ?? 0));
        if (ms > 0) yield ms;
        return 0;
      }
      case 'delayMicroseconds': {
        const micros = Math.max(0, asNumber(args[0] ?? 0));
        // Round to the nearest millisecond the simulator can represent, but
        // never round a sub-millisecond wait away entirely.
        const ms = micros / 1000;
        if (ms > 0) yield ms;
        return 0;
      }
      case 'millis':
        return services.nowMs();
      case 'micros':
        return services.nowMs() * 1000;
      case 'pinMode':
        services.pinMode(this.pinOf(services, asNumber(args[0] ?? 0)), asNumber(args[1] ?? 0));
        return 0;
      case 'digitalWrite':
        services.digitalWrite(this.pinOf(services, asNumber(args[0] ?? 0)), asNumber(args[1] ?? 0));
        return 0;
      case 'digitalRead':
        return services.digitalRead(this.pinOf(services, asNumber(args[0] ?? 0)));
      case 'analogWrite':
        services.analogWrite(this.pinOf(services, asNumber(args[0] ?? 0)), asNumber(args[1] ?? 0));
        return 0;
      case 'analogRead':
        return services.analogRead(this.pinOf(services, asNumber(args[0] ?? 0)));
      case 'pulseIn': {
        const timeoutUs = asNumber(args[2] ?? 1000000);
        const micros =
          services.pulseInBegin?.(
            this.pinOf(services, asNumber(args[0] ?? 0)),
            asNumber(args[1] ?? 0),
            timeoutUs,
          ) ?? 0;
        // A timeout still costs the wait: hardware sits on the line for
        // the whole window, so a sketch timing around the call observes it.
        if (micros <= 0) {
          if (timeoutUs > 0) yield timeoutUs / 1000;
          return 0;
        }
        yield micros / 1000;
        services.pulseInEnd?.();
        return micros;
      }
      case 'random':
        return Math.floor(Math.random() * asNumber(args[0] ?? 1));
      case 'constrain':
        return Math.min(
          asNumber(args[2] ?? 0),
          Math.max(asNumber(args[1] ?? 0), asNumber(args[0] ?? 0)),
        );
      /*
       * The numbers a range covers, as an array: `range(3)` is 0, 1, 2. A
       * `for` loop over a range is desugared by the parser, so this is the
       * range as a value -- which is what a list comprehension walks.
       */
      case 'range': {
        const start = args.length > 1 ? asNumber(args[0] ?? 0) : 0;
        const stop = args.length > 1 ? asNumber(args[1] ?? 0) : asNumber(args[0] ?? 0);
        const step = args.length > 2 ? asNumber(args[2] ?? 1) : 1;
        const items: number[] = [];
        if (step > 0) {
          for (let value = start; value < stop; value += step) items.push(value);
        } else if (step < 0) {
          for (let value = start; value > stop; value += step) items.push(value);
        }
        return items;
      }
      /*
       * `abort()` ends the sketch on hardware (Clock::begin calls it when no
       * RTC answers). The VM has no halt state for a missing part, so it is
       * a no-op and execution continues past it; the begin probe still
       * reports the absence through its return value.
       */
      case 'abort':
        return 0;
      /*
       * `sizeof` over an array answers its length, so the idiom
       * `sizeof(TONES) / sizeof(TONES[0])` counts entries; over anything
       * else it answers one unit, which keeps the same ratio exact.
       */
      case 'sizeof': {
        const target = args[0];
        return Array.isArray(target) ? target.length : 1;
      }
      /*
       * `tone(pin, freq, dur?)` starts a non-blocking note (see `startTone`):
       * it drives HIGH and records the silence time rather than yielding it,
       * because a sketch that polls (`AlarmTone::play` every loop) must keep
       * sampling its buttons while the note sounds.
       */
      case 'tone': {
        const duration = args[2] === undefined ? 0 : asNumber(args[2]);
        this.startTone(asNumber(args[0] ?? 0), duration, services);
        return 0;
      }
      case 'noTone':
        this.stopTone(asNumber(args[0] ?? 0), services);
        return 0;
      default:
        /*
         * A call that resolves nowhere. It used to answer 0, which is a
         * wrong answer a sketch cannot see, so it stops with a reason that
         * names the call.
         */
        throw unknownError('call', name, '', this.language);
    }
  }

  // -- statements ----------------------------------------------------------

  private *execute(
    statement: Stmt,
    scope: Scope,
    services: FirmwareServices,
  ): Generator<Produced, Flow, void> {
    switch (statement.kind) {
      case 'empty':
        return NORMAL;

      case 'block': {
        const inner = new Scope(scope);
        for (const child of statement.statements) {
          const flow = yield* this.execute(child, inner, services);
          if (flow.kind !== 'normal') return flow;
        }
        return NORMAL;
      }

      /*
       * A Python suite, which is a block of statements and not a scope. Only
       * `def` opens one, so running this in a fresh scope would bind every
       * name in a loop body somewhere the rest of the program cannot see --
       * and `n = n + 1` inside a `while` would silently count nothing.
       */
      case 'suite': {
        for (const child of statement.statements) {
          const flow = yield* this.execute(child, scope, services);
          if (flow.kind !== 'normal') return flow;
        }
        return NORMAL;
      }

      case 'varDecl': {
        if (statement.init) {
          /*
           * `c = Counter()` builds an object rather than a number, so the
           * name has to be told what it is holding. Settled here, where the
           * name itself is bound: a constructor reaching the call machinery
           * would have no way to know which name it was stored under.
           */
          const built = yield* this.bindInstanceFrom(
            statement.name,
            statement.init,
            scope,
            services,
          );
          if (built) return NORMAL;
        }
        if (
          statement.init &&
          this.bindDeviceFrom(statement.name, statement.init, scope, services)
        ) {
          return NORMAL;
        }
        const value = statement.init
          ? ((yield* this.evaluate(statement.init, scope, services)) as Value)
          : 0;
        scope.values.set(statement.name, value);
        return NORMAL;
      }

      case 'arrayDecl': {
        const store = new Array<number>(statement.size).fill(0);
        // A plain loop, not forEach: evaluating an initialiser may itself
        // block, and `yield` is not available inside a non-generator callback.
        const initialisers = statement.init ?? [];
        for (let index = 0; index < initialisers.length && index < store.length; index++) {
          store[index] = asNumber(
            (yield* this.evaluate(initialisers[index], scope, services)) as Value,
          );
        }
        scope.arrays.set(statement.name, store);
        scope.values.set(statement.name, 0);
        return NORMAL;
      }

      case 'instanceDecl': {
        const args: Value[] = [];
        for (const argument of statement.args) {
          args.push((yield* this.evaluate(argument, scope, services)) as Value);
        }
        yield* this.constructInstance(statement.className, statement.name, args, services);
        return NORMAL;
      }

      case 'expression':
        yield* this.evaluate(statement.value, scope, services);
        return NORMAL;

      case 'if': {
        const condition = yield* this.evaluate(statement.condition, scope, services);
        if (isTruthy(condition as Value))
          return yield* this.execute(statement.then, scope, services);
        if (statement.otherwise) return yield* this.execute(statement.otherwise, scope, services);
        return NORMAL;
      }

      case 'while': {
        for (;;) {
          const condition = yield* this.evaluate(statement.condition, scope, services);
          if (!isTruthy(condition as Value)) break;
          const flow = yield* this.execute(statement.body, scope, services);
          if (flow.kind === 'break') break;
          if (flow.kind === 'return') return flow;
        }
        return NORMAL;
      }

      case 'doWhile': {
        for (;;) {
          const flow = yield* this.execute(statement.body, scope, services);
          if (flow.kind === 'break') break;
          if (flow.kind === 'return') return flow;
          const condition = yield* this.evaluate(statement.condition, scope, services);
          if (!isTruthy(condition as Value)) break;
        }
        return NORMAL;
      }

      case 'for': {
        /*
         * C's braces open a scope and Python's do not: only `def` does. A
         * Python loop body assigns into the program it belongs to, so a name
         * bound in the body is a name the rest of the program can still see.
         * A loop that hid its assignments would count to nothing and say so
         * by counting nothing.
         */
        const loopScope = this.language === 'python' ? scope : new Scope(scope);
        if (statement.init) yield* this.execute(statement.init, loopScope, services);
        for (;;) {
          if (statement.condition) {
            const condition = yield* this.evaluate(statement.condition, loopScope, services);
            if (!isTruthy(condition as Value)) break;
          }
          const flow = yield* this.execute(statement.body, loopScope, services);
          if (flow.kind === 'break') break;
          if (flow.kind === 'return') return flow;
          if (statement.update) yield* this.evaluate(statement.update, loopScope, services);
        }
        return NORMAL;
      }

      /*
       * A loop over anything iterable: a list, a dictionary's keys, or a
       * generator.
       *
       * A generator hands its values over one at a time, so the loop asks for
       * one, runs the body, and asks for the next -- which is what lets a
       * sketch write `while True: yield sensor.read()` without the bench
       * ever running out of values to wait for. A wait inside the generator
       * is the bench's own time to spend, so it is handed on rather than
       * swallowed.
       *
       * The body is not a scope of its own -- Python's indentation does not
       * open one -- so a name the body binds is a name the program can still
       * see.
       */
      case 'forEach': {
        const iterable = (yield* this.evaluate(statement.iterable, scope, services)) as Value;
        if (iterable instanceof GeneratorValue) {
          for (;;) {
            const step = iterable.generator.next();
            if (step.done) break;
            const produced = step.value;
            if (typeof produced === 'number') {
              yield produced;
              continue;
            }
            scope.values.set(statement.variable, produced.yielded);
            const flow = yield* this.execute(statement.body, scope, services);
            if (flow.kind === 'break') break;
            if (flow.kind === 'return') return flow;
          }
          return NORMAL;
        }
        if (Array.isArray(iterable)) {
          for (const item of iterable) {
            scope.values.set(statement.variable, item);
            const flow = yield* this.execute(statement.body, scope, services);
            if (flow.kind === 'break') break;
            if (flow.kind === 'return') return flow;
          }
          return NORMAL;
        }
        // A dictionary iterates its keys, the way Python does.
        if (iterable instanceof Map) {
          for (const key of iterable.keys()) {
            scope.values.set(statement.variable, key);
            const flow = yield* this.execute(statement.body, scope, services);
            if (flow.kind === 'break') break;
            if (flow.kind === 'return') return flow;
          }
          return NORMAL;
        }
        // Something that cannot be walked is said so: a loop that quietly
        // did nothing is worse than one that stopped with a reason.
        throw new PythonError('TypeError', `${formatValue(iterable)} is not iterable`);
      }

      case 'break':
        return { kind: 'break' };

      case 'continue':
        return { kind: 'continue' };

      /*
       * A `switch`: the discriminant picks the first matching case (or the
       * first `default`), and bodies run from there to the end -- falling
       * through labels until a `break` leaves the switch. The `break` is
       * consumed here rather than propagated, so a switch inside a loop
       * breaks the switch the way C does.
       */
      case 'switch': {
        const discriminant = asNumber(
          (yield* this.evaluate(statement.value, scope, services)) as Value,
        );
        let selected = -1;
        let fallback = -1;
        for (let index = 0; index < statement.cases.length; index++) {
          const entry = statement.cases[index];
          if (!entry) continue;
          if (entry.test === null) {
            if (fallback < 0) fallback = index;
            continue;
          }
          const probe = asNumber((yield* this.evaluate(entry.test, scope, services)) as Value);
          if (probe === discriminant) {
            selected = index;
            break;
          }
        }
        if (selected < 0) selected = fallback;
        if (selected < 0) return NORMAL;
        const inner = new Scope(scope);
        for (let index = selected; index < statement.cases.length; index++) {
          const entry = statement.cases[index];
          if (!entry) continue;
          for (const child of entry.body) {
            const flow = yield* this.execute(child, inner, services);
            if (flow.kind === 'break') return NORMAL;
            if (flow.kind !== 'normal') return flow;
          }
        }
        return NORMAL;
      }

      case 'return': {
        const value = statement.value
          ? ((yield* this.evaluate(statement.value, scope, services)) as Value)
          : 0;
        return { kind: 'return', value };
      }

      /*
       * A guarded block.
       *
       * The `finally` clause runs on every path out of the statement -- the
       * body succeeded, a handler caught the error, the error had no handler,
       * or the body returned early -- which is the whole point of writing one.
       * The `else` clause runs only when the body raised nothing, so a `try`
       * that guards a write can put the follow-up in `else` rather than after
       * the block.
       *
       * A handler binds the error to its name when it has one, so a sketch
       * can say what went wrong rather than only that something did.
       */
      case 'try': {
        let flow: Flow = NORMAL;
        let raised = false;
        let failure: unknown = null;

        try {
          flow = yield* this.execute(statement.body, scope, services);
        } catch (error) {
          raised = true;
          if (!(error instanceof PythonError)) {
            // A fault in the VM is not the sketch's to catch.
            failure = error;
          } else {
            let handled = false;
            for (const handler of statement.handlers) {
              if (!this.handlerCatches(handler.types, error)) continue;
              handled = true;
              if (handler.name) scope.values.set(handler.name, error.message);
              try {
                flow = yield* this.execute(handler.body, scope, services);
              } catch (nested) {
                failure = nested;
              }
              break;
            }
            // No handler took it: the error goes on, after `finally`.
            if (!handled) failure = error;
          }
        }

        if (!raised && statement.otherwise) {
          flow = yield* this.execute(statement.otherwise, scope, services);
        }

        let finalFlow: Flow = NORMAL;
        if (statement.final) {
          finalFlow = yield* this.execute(statement.final, scope, services);
        }
        // A `finally` that returns or breaks owns the statement's outcome,
        // the way it does in Python.
        if (finalFlow.kind !== 'normal') return finalFlow;
        if (failure !== null) throw failure;
        return flow;
      }

      case 'raise': {
        const expression = statement.error;
        let value: Value | undefined;
        if (expression !== null) {
          /*
           * `raise ValueError('bad reading')` names its type in the call and
           * its message in the argument, so the argument is what is read:
           * the call itself would answer zero, because the VM has no
           * exception classes to construct.
           */
          const argument =
            expression.kind === 'call' && expression.callee.kind === 'identifier'
              ? expression.args[0]
              : undefined;
          const read = argument ?? expression;
          value = (yield* this.evaluate(read, scope, services)) as Value;
        }
        throw this.raisedError(expression, value);
      }
    }
  }

  /**
   * Whether a handler takes this error.
   *
   * A handler with no types catches everything, and so does one naming
   * `Exception` or `BaseException`: those are the base of every error a
   * sketch can raise. Any other name has to match the error's own type.
   */
  private handlerCatches(types: readonly string[], error: PythonError): boolean {
    if (types.length === 0) return true;
    return types.some(
      (type) =>
        type === 'Exception' ||
        type === 'BaseException' ||
        type === error.typeName,
    );
  }

  /**
   * The exception a `raise` names.
   *
   * `raise ValueError('bad reading')` names its type in the call, so the
   * type is taken from there and the message from the argument. Anything
   * else is an `Exception` carrying the value it was given.
   */
  private raisedError(expression: Expr | null, value: Value | undefined): PythonError {
    if (expression !== null && expression.kind === 'call' && expression.callee.kind === 'identifier') {
      const typeName = expression.callee.name;
      const message =
        expression.args.length === 0 ? typeName : formatValue(value === undefined ? '' : value);
      return new PythonError(typeName, message);
    }
    return new PythonError('Exception', value === undefined ? 'exception' : formatValue(value));
  }

  // -- expressions ---------------------------------------------------------

  private *evaluate(
    expression: Expr,
    scope: Scope,
    services: FirmwareServices,
  ): Generator<Produced, Value, void> {
    switch (expression.kind) {
      case 'number':
        return expression.value;

      case 'string':
        return expression.value;

      case 'boolean':
        return expression.value ? 1 : 0;

      /*
       * The value a generator hands over.
       *
       * It goes *up* to whoever is iterating the generator, which is what
       * stops the body where it is: the wait the driver is handed is a
       * number of milliseconds, and a generator hands over a value. The wrap
       * keeps the two apart.
       */
      case 'yield': {
        const value = expression.value
          ? ((yield* this.evaluate(expression.value, scope, services)) as Value)
          : 0;
        yield { yielded: value };
        return 0;
      }

      case 'list': {
        /*
         * A list of values, and the bytes literal too: the bench's buffers
         * are arrays, so `b'\x00\xaf'` is two numbers and not four
         * characters.
         */
        const items: number[] = [];
        for (const item of expression.items) {
          items.push(asNumber((yield* this.evaluate(item, scope, services)) as Value));
        }
        return items;
      }

      case 'dict': {
        /*
         * A dictionary: the keys are the program's own strings, the values
         * whatever the program holds. A key that is not a string is written
         * the way it prints, so a number key and a string key of the same
         * spelling are the same key.
         */
        const entries = new Map<string, Value>();
        for (const entry of expression.entries) {
          const key = formatValue((yield* this.evaluate(entry.key, scope, services)) as Value);
          entries.set(key, (yield* this.evaluate(entry.value, scope, services)) as Value);
        }
        return entries;
      }

      case 'comprehension': {
        /*
         * A list comprehension: the element is evaluated once per item, with
         * the name bound to it, and the list is what those came to. The name
         * lives in a scope of its own, so it does not outlive the list.
         */
        const iterable = (yield* this.evaluate(expression.iterable, scope, services)) as Value;
        const items: number[] = [];
        if (Array.isArray(iterable)) {
          const inner = new Scope(scope);
          for (const item of iterable) {
            inner.values.set(expression.variable, item);
            items.push(asNumber((yield* this.evaluate(expression.element, inner, services)) as Value));
          }
        }
        return items;
      }

      case 'identifier': {
        /*
         * A name that holds an array evaluates to a copy of its store, so a
         * wiring table (`digitPins`) can be handed to a call (`begin`) the
         * way C decays it. The walk is innermost-out with the values entry
         * winning per scope, so a parameter shadowing a global array reads
         * the parameter rather than the table behind it. Copies, not the
         * live store: a callee cannot scribble the caller's table through
         * the argument.
         */
        for (const frame of chainFrom(scope)) {
          if (frame.values.has(expression.name)) {
            const store = frame.arrays.get(expression.name);
            if (store !== undefined) return [...store];
            return frame.values.get(expression.name) ?? 0;
          }
          if (frame.arrays.has(expression.name)) {
            return [...(frame.arrays.get(expression.name) ?? [])];
          }
        }
        /*
         * An expression define (`MINUTE`, `TIMESPAN_DAY`): evaluated where it
         * is used, against the scope that names it. A self-referencing macro
         * answers zero rather than recursing.
         */
        const macro = this.macros.get(expression.name);
        if (macro !== undefined) {
          if (this.macroResolving.includes(expression.name)) return 0;
          this.macroResolving.push(expression.name);
          try {
            return (yield* this.evaluate(macro, scope, services)) as Value;
          } finally {
            this.macroResolving.pop();
          }
        }
        return this.defines.get(expression.name) ?? 0;
      }

      case 'unary': {
        const operand = (yield* this.evaluate(expression.operand, scope, services)) as Value;
        switch (expression.operator) {
          case '-':
            return -asNumber(operand);
          case '+':
            return asNumber(operand);
          case '!':
            return isTruthy(operand) ? 0 : 1;
          case '~':
            return ~asNumber(operand);
          // `*p` and `&x` have no meaning without a memory model; arrays are
          // addressed by name and index instead.
          default:
            return 0;
        }
      }

      case 'binary': {
        // Short-circuit before evaluating the right side, as C requires.
        if (expression.operator === '&&') {
          const left = (yield* this.evaluate(expression.left, scope, services)) as Value;
          if (!isTruthy(left)) return 0;
          return isTruthy((yield* this.evaluate(expression.right, scope, services)) as Value)
            ? 1
            : 0;
        }
        if (expression.operator === '||') {
          const left = (yield* this.evaluate(expression.left, scope, services)) as Value;
          if (isTruthy(left)) return 1;
          return isTruthy((yield* this.evaluate(expression.right, scope, services)) as Value)
            ? 1
            : 0;
        }

        const leftValue = (yield* this.evaluate(expression.left, scope, services)) as Value;
        const rightValue = (yield* this.evaluate(expression.right, scope, services)) as Value;

        /*
         * String joining. A Python f-string is parsed into a `+` chain of
         * fragments, so this is what turns one back into text. No C sketch
         * reaches here -- in C, `+` on strings is pointer arithmetic this VM
         * has never modelled, and it answered zero.
         */
        if (
          expression.operator === '+' &&
          (typeof leftValue === 'string' || typeof rightValue === 'string')
        ) {
          return `${formatValue(leftValue)}${formatValue(rightValue)}`;
        }

        /*
         * RTClib arithmetic: dates compare with every relational operator
         * (`alarm >= now`), and a date plus a span moves the calendar
         * (`alarm + TIMESPAN_DAY`). Anything else involving a date or a span
         * answers zero, the way unmodelled operations always have.
         */
        if (leftValue instanceof DateTimeValue && rightValue instanceof DateTimeValue) {
          switch (expression.operator) {
            case '==':
              return compareDateTime(leftValue, rightValue) === 0 ? 1 : 0;
            case '!=':
              return compareDateTime(leftValue, rightValue) !== 0 ? 1 : 0;
            case '<':
              return compareDateTime(leftValue, rightValue) < 0 ? 1 : 0;
            case '>':
              return compareDateTime(leftValue, rightValue) > 0 ? 1 : 0;
            case '<=':
              return compareDateTime(leftValue, rightValue) <= 0 ? 1 : 0;
            case '>=':
              return compareDateTime(leftValue, rightValue) >= 0 ? 1 : 0;
            default:
              return 0;
          }
        }
        if (expression.operator === '+') {
          if (leftValue instanceof DateTimeValue && rightValue instanceof TimeSpanValue) {
            return addSeconds(leftValue, rightValue.totalSeconds());
          }
          if (leftValue instanceof TimeSpanValue && rightValue instanceof DateTimeValue) {
            return addSeconds(rightValue, leftValue.totalSeconds());
          }
        }

        return applyBinary(expression.operator, asNumber(leftValue), asNumber(rightValue));
      }

      case 'ternary': {
        const condition = (yield* this.evaluate(expression.condition, scope, services)) as Value;
        return (yield* this.evaluate(
          isTruthy(condition) ? expression.whenTrue : expression.whenFalse,
          scope,
          services,
        )) as Value;
      }

      case 'assign': {
        const value = (yield* this.evaluate(expression.value, scope, services)) as Value;

        if (
          expression.target.kind === 'identifier' &&
          expression.operator === '=' &&
          this.bindDeviceFrom(expression.target.name, expression.value, scope, services)
        ) {
          return 0;
        }

        // `led.value = 0.5` and `pwm.value = 1` drive the pin directly.
        if (expression.target.kind === 'member' && expression.target.target.kind === 'identifier') {
          const device = scope.deviceFor(expression.target.target.name);
          if (device && expression.operator === '=') {
            this.writeDevice(device, expression.target.member, value, services);
            return value;
          }
          // `c.n = 41` stores into the instance's field frame, never into a
          // global of the same name: routing through `assign` would bind a
          // global when the field is missing instead of keeping it on the
          // instance.
          const instance = this.instances.get(expression.target.target.name);
          if (instance) {
            if (expression.operator === '=') {
              instance.scope.values.set(expression.target.member, value);
              return value;
            }
            // `c.n += 1` and `c.n++` combine against the current field the
            // same way bare identifiers do (`++`/`--` arrive as `+ 1`/`- 1`),
            // then store back into the same frame the plain write uses. The
            // read stays inside the field frame, the way the plain member
            // read does -- a same-named global must not leak into the
            // combination and mask a typo'd field.
            const current =
              instance.scope.values.get(expression.target.member) ??
              this.classStatics.get(instance.className)?.get(expression.target.member) ??
              0;
            const combined = applyBinary(
              expression.operator.slice(0, -1),
              asNumber(current),
              asNumber(value),
            );
            instance.scope.values.set(expression.target.member, combined);
            return combined;
          }
          // `self.n = 1` writes the field of the object the running method
          // works on, the same field the read above reaches.
          if (
            expression.operator === '=' &&
            this.currentSelfName === expression.target.target.name &&
            this.currentInstance
          ) {
            this.currentInstance.scope.values.set(expression.target.member, value);
            return value;
          }
        }
        if (expression.target.kind === 'identifier') {
          const name = expression.target.name;
          if (expression.operator !== '=') {
            const current = scope.lookup(name) ?? 0;
            const combined = applyBinary(
              expression.operator.slice(0, -1),
              asNumber(current),
              asNumber(value),
            );
            scope.assign(name, combined);
            return combined;
          }
          scope.assign(name, value);
          return value;
        }

        if (expression.target.kind === 'index') {
          const key = (yield* this.evaluate(expression.target.index, scope, services)) as Value;
          const store = this.resolveArray(expression.target.target, scope);
          if (store) {
            const index = asNumber(key);
            if (index < 0 || index >= store.length) return 0;
            store[index] = asNumber(value);
            return store[index];
          }
          // A dictionary is written by its key: `d['a'] = 2`.
          const target = (yield* this.evaluate(expression.target.target, scope, services)) as Value;
          if (target instanceof Map) {
            target.set(formatValue(key), value);
            return value;
          }
          return 0;
        }

        return value;
      }

      case 'index': {
        const index = (yield* this.evaluate(expression.index, scope, services)) as Value;
        const store = this.resolveArray(expression.target, scope);
        if (store) {
          const position = asNumber(index);
          if (position < 0 || position >= store.length) return 0;
          return store[position];
        }
        // A dictionary is read by its key: `d['a']`.
        const target = (yield* this.evaluate(expression.target, scope, services)) as Value;
        if (target instanceof Map) return target.get(formatValue(index)) ?? 0;
        return 0;
      }

      case 'member': {
        // `button.is_pressed` is a reading of the pin, not a call.
        if (expression.target.kind === 'identifier') {
          const device = scope.deviceFor(expression.target.name);
          if (device) return this.readDevice(device, expression.member, services);
          // `c.n` reads the instance's own field frame, never globals: writes
          // store into the frame, so chaining past it would answer a
          // same-named global and mask a typo'd field. Folded statics back
          // the read for names the frame never seeded.
          const instance = this.instances.get(expression.target.name);
          if (instance) {
            return (
              instance.scope.values.get(expression.member) ??
              this.classStatics.get(instance.className)?.get(expression.member) ??
              0
            );
          }
          // `self.n` reads the field of the object the running method works
          // on, which is the object itself rather than a name in scope.
          if (this.currentSelfName === expression.target.name && this.currentInstance) {
            return this.currentInstance.scope.values.get(expression.member) ?? 0;
          }
          // A dictionary is read by its key, and Python lets a key that is a
          // name be written as one: `d.a` is `d['a']`.
          const held = scope.lookup(expression.target.name);
          if (held instanceof Map) return held.get(expression.member) ?? 0;
          // `Button::RELEASED`: static consts live in the class table, since
          // no instance is involved. Instance-qualified statics (`b.PRESSED`)
          // already resolved above through the seeded field frame.
          const statics = this.classStatics.get(expression.target.name);
          if (statics?.has(expression.member)) return statics.get(expression.member) ?? 0;
        }
        // A bare `Serial`, `Wire` or `SPI` on the right of a dot has no value
        // of its own; their methods are reached through the `call` branch.
        return 0;
      }

      case 'call': {
        const callee = expression.callee;
        const keywords: { name: string; value: Value }[] = [];
        for (const keyword of expression.keywords ?? []) {
          keywords.push({
            name: keyword.name,
            value: (yield* this.evaluate(keyword.value, scope, services)) as Value,
          });
        }
        if (callee.kind === 'identifier') {
          const args: Value[] = [];
          for (const argument of expression.args) {
            args.push((yield* this.evaluate(argument, scope, services)) as Value);
          }
          return (yield* this.callFunction(callee.name, args, scope, services, keywords)) as Value;
        }
        if (callee.kind === 'member' && callee.target.kind === 'identifier') {
          const args: Value[] = [];
          for (const argument of expression.args) {
            args.push((yield* this.evaluate(argument, scope, services)) as Value);
          }

          /*
           * A method on a device the program built. Checked before the
           * name-based dispatch below, because in Python the name holding a
           * device is the programmer's to choose and `led` collides with
           * nothing the C side assumes.
           */
          const device = scope.deviceFor(callee.target.name);
          if (device) {
            return (yield* this.callDevice(device, callee.member, args, services)) as Value;
          }
          /*
           * A method on a class instance (`c.bump()`), built from a global
           * (`Counter c;`) when the globals ran. Checked here, beside the
           * device dispatch, because both resolve a method through the name
           * before the target rather than through a value.
           */
          const instance = this.instances.get(callee.target.name);
          if (instance) {
            return (yield* this.callMethod(instance, callee.member, args, services)) as Value;
          }
          /*
           * A method on a value the program is holding: a `DateTime` local
           * answering `hour()`, or the RTC member a constructor wired to the
           * bench answering `now()`. Values answer before the name-based
           * library dispatch below, the way instances do above -- a name only
           * reaches `lcd`/`servo`/serial when it holds no value at all.
           */
          const bound = scope.lookup(callee.target.name);
          if (bound instanceof DateTimeValue) return dateTimeMember(bound, callee.member);
          if (bound instanceof TimeSpanValue) return timeSpanMember(bound, callee.member);
          if (bound instanceof RtcHandle) {
            return (yield* this.evaluateRtcCall(callee.member, args, services)) as Value;
          }
          if (callee.target.name === 'lcd' || callee.target.name === 'LiquidCrystal') {
            return this.evaluateLcdCall(callee.member, args, services);
          }
          if (callee.target.name === 'servo' || callee.target.name === 'Servo') {
            return this.evaluateServoCall(callee.member, args, services);
          }
          if (callee.target.name === 'dht' || callee.target.name === 'DHT') {
            return this.evaluateDhtCall(callee.member, args, services);
          }
          if (callee.target.name === 'pixels' || callee.target.name === 'Pixels') {
            return this.evaluatePixelsCall(callee.member, args, services);
          }
          if (callee.target.name === 'ir' || callee.target.name === 'IR') {
            return this.evaluateIrCall(callee.member, args, services);
          }
          if (callee.target.name === 'dialer' || callee.target.name === 'Dialer') {
            return this.evaluateDialerCall(callee.member, args, services);
          }
          if (callee.target.name === 'sd' || callee.target.name === 'SD') {
            return this.evaluateSdCall(callee.member, args, services);
          }

          /*
           * `time.sleep`, which waits in seconds where `delay` waits in
           * milliseconds. Reading `0.5` as half a millisecond would make every
           * gpiozero blink five hundred times too fast, and the difference is
           * exactly the kind of thing that only shows up as "why is this
           * wrong" rather than as an error.
           */
          if (callee.target.name === 'time') {
            const seconds = Math.max(0, asNumber(args[0] ?? 0));
            if (seconds > 0) yield seconds * 1000;
            return 0;
          }
          if (callee.target.name === 'Wire') {
            return (yield* this.evaluateWireCall(callee.member, args, services)) ?? 0;
          }
          if (callee.target.name === 'map' || callee.target.name === 'Map') {
            return this.evaluateMapCall(callee.member, args, services);
          }
          if (callee.target.name === 'tft' || callee.target.name === 'TFT') {
            return this.evaluateTftCall(callee.member, args, services);
          }
          if (callee.target.name === 'SPI') {
            return (yield* this.evaluateSpiCall(callee.member, args, services)) ?? 0;
          }
          /*
           * The network, before the Serial fallback below: an unmatched member
           * call lands there, where `WiFi.begin("ssid", "pw")` would quietly
           * become `serialBegin(0)` and the sketch would never connect with
           * nothing said about why.
           */
          if (callee.target.name === 'WiFi' || callee.target.name === 'wifi') {
            return this.evaluateWifiCall(callee.member, args, services);
          }
          if (callee.target.name === 'net' || callee.target.name === 'Net') {
            return this.evaluateNetCall(callee.member, args, services);
          }
          /*
           * A value the sketch is holding, asked for something it does not
           * have. `'abc'.upper()` used to answer 0, which reads as a value of
           * zero rather than as a call the bench cannot make. The library
           * names above are answered before this, so a sketch that owns a
           * `lcd` still reaches it.
           */
          if (bound !== undefined) {
            throw unknownError('member', callee.member, pythonTypeName(bound), this.language);
          }
          /*
           * `Serial` is the last library a sketch reaches by name, and the
           * modules the bench answers in its own vocabulary.
           */
          if (callee.target.name === 'machine' || callee.target.name === 'gpiozero') {
            const constructors =
              callee.target.name === 'machine' ? MACHINE_CONSTRUCTORS : DEVICE_CONSTRUCTORS;
            if (!Object.prototype.hasOwnProperty.call(constructors, callee.member)) {
              throw unknownError('member', callee.member, callee.target.name, this.language);
            }
            /*
             * A constructor with no name to hold it: the call has nowhere to
             * put the device, so it answers nothing. Giving it a name --
             * `led = machine.Pin(2)` -- is what puts it on the bench.
             */
            return 0;
          }
          if (callee.target.name === 'Serial') {
            return this.evaluateSerialCall(callee.member, args, services);
          }
          /*
           * A name the sketch has never heard of. It used to fall through to
           * the serial call below, where `myLib.begin()` quietly became
           * `serialBegin(0)`.
           */
          throw unknownError('object', callee.target.name, '', this.language);
        }
        /*
         * A call on something that is not a name: a literal or a computed
         * value. The bench has no member to answer with, so it says so.
         */
        if (callee.kind !== 'member') {
          /*
           * The parser reads a callee as a name or a member, so this is a
           * guard rather than a path.
           */
          throw new PythonError('Error', 'a call has no name to call');
        }
        const target = (yield* this.evaluate(callee.target, scope, services)) as Value;
        throw unknownError('member', callee.member, pythonTypeName(target), this.language);
      }
    }
  }

  private resolveArray(expression: Expr, scope: Scope): number[] | undefined {
    if (expression.kind !== 'identifier') return undefined;
    const declared = scope.arrayFor(expression.name);
    if (declared !== undefined) return declared;
    /*
     * A value can be an array too: `data = i2c.readfrom(addr, 2)` is how a
     * MicroPython program reads a sensor, and `data[0]` has to index what the
     * bus returned rather than a compiled array declaration.
     */
    const bound = scope.lookup(expression.name);
    return Array.isArray(bound) ? bound : undefined;
  }

  /**
   * Drives a device from a method call: `on()`, `off()`, `toggle()`, `close()`.
   *
   * `toggle` reads the pin back rather than keeping its own copy of the last
   * level written. A wire can pull a pin away from what was asked for -- a
   * short to ground drives it low whatever the program believes -- and reading
   * the line is what makes a toggle behave the way the circuit is actually
   * behaving rather than the way the program intended.
   */
  private *callDevice(
    device: Device,
    member: string,
    args: Value[],
    services: FirmwareServices,
  ): Generator<Produced, Value, void> {
    /*
     * `machine.ADC` answers in sixteen-bit counts on every port, while the
     * host's `analogRead` answers in the board's own (ten or twelve bits).
     * `read` is the raw counts, the way some ports spell the same reading.
     */
    if (device.kind === 'adc') {
      switch (member) {
        case 'read_u16': {
          const full = services.adcFullScale ?? 1023;
          return Math.round((services.analogRead(device.pin) / full) * 65535);
        }
        case 'read':
          return services.analogRead(device.pin);
        default:
          return 0;
      }
    }

    if (device.kind === 'i2c') {
      return (yield* this.evaluateMachineI2cCall(
        member,
        args,
        services,
        device.i2cPort,
        device.i2cPins,
      )) as Value;
    }

    if (device.kind === 'pwm') {
      switch (member) {
        case 'duty_u16': {
          const duty = Math.min(65535, Math.max(0, asNumber(args[0] ?? 0)));
          services.analogWrite(device.pin, Math.round((duty / 65535) * 255));
          return 0;
        }
        case 'duty': {
          const duty = Math.min(1023, Math.max(0, asNumber(args[0] ?? 0)));
          services.analogWrite(device.pin, Math.round((duty / 1023) * 255));
          return 0;
        }
        case 'freq':
        case 'deinit':
          return 0;
      }
    }

    switch (member) {
      /*
       * `machine.Pin.value()` reads, `value(1)` writes -- the same pin the
       * gpiozero spelling calls `on`/`off`, with the argument deciding which
       * half of the pair is meant.
       */
      case 'value':
        if (args.length > 0) {
          this.writeDevice(device, 'value', args[0], services);
          return 0;
        }
        return this.readDevice(device, 'value', services);
      /*
       * A press waits the way the real call does: by not returning until the
       * line says so. Polling a millisecond at a time is what keeps the rest
       * of the simulation moving while the program sits inside it.
       */
      case 'wait_for_press':
      case 'wait_for_release': {
        const wanted = member === 'wait_for_press';
        for (;;) {
          const pressed = asNumber(this.readDevice(device, 'is_pressed', services)) !== 0;
          if (pressed === wanted) return 0;
          yield 1;
        }
      }
      case 'on':
        this.writeLevel(device, LEVEL_HIGH, services);
        return 0;
      case 'off':
        this.writeLevel(device, LEVEL_LOW, services);
        return 0;
      case 'toggle': {
        const level = this.readDevice(device, 'value', services);
        this.writeLevel(device, asNumber(level) !== 0 ? LEVEL_LOW : LEVEL_HIGH, services);
        return 0;
      }
      case 'close':
        this.writeLevel(device, LEVEL_LOW, services);
        return 0;
      default:
        return 0;
    }
  }

  /**
   * Handles a `SevSeg` call against the instance's recorded wiring.
   *
   * `begin` records the digit/segment pins (handed over as whole arrays by
   * the identifier evaluation) and takes them as outputs; `setNumber` and
   * `setChars` stage patterns; `refreshDisplay` multiplexes one digit per
   * call so the phase matches the raw build's one-digit `dspRefresh`; a
   * refresh before any `begin` is a silent no-op. Unknown methods answer
   * zero, the way unknown functions do.
   */
  private evaluateSevSegCall(
    instance: Instance,
    method: string,
    args: Value[],
    services: FirmwareServices,
  ): Value {
    let state = this.sevseg.get(instance);
    if (!state) {
      state = {
        digitPins: [],
        segmentPins: [],
        digits: 4,
        commonAnode: true,
        leadingZeros: false,
        buffer: [0, 0, 0, 0],
        brightness: 100,
        mux: 0,
        levels: new Map(),
      };
      this.sevseg.set(instance, state);
    }
    const pins = (value: Value | undefined): number[] =>
      Array.isArray(value) ? value.map((pin) => Math.trunc(asNumber(pin))) : [];

    switch (method) {
      case 'begin': {
        const digits = Math.max(1, Math.min(8, Math.trunc(asNumber(args[1] ?? 4))));
        state.commonAnode = asNumber(args[0] ?? 1) !== 0;
        state.digitPins = pins(args[2]).slice(0, digits);
        state.segmentPins = pins(args[3]).slice(0, 8);
        state.digits = digits;
        state.leadingZeros = isTruthy(args[6] ?? 0);
        state.buffer = new Array<number>(digits).fill(0);
        state.mux = 0;
        for (const pin of [...state.digitPins, ...state.segmentPins]) {
          services.pinMode(pin, PIN_OUTPUT);
        }
        return 0;
      }
      case 'setNumber': {
        /*
         * The second argument is the caller's decimal/leading-zero request:
         * the gallery passes -1 (no point) or omits it, both of which keep
         * the zero-padded HHMM the glass shows. Only an explicit zero blanks
         * the leading zeros; the instance flag from `begin` decides the rest.
         */
        const padded = args[1] === undefined ? state.leadingZeros : isTruthy(args[1]);
        const text = Math.abs(Math.trunc(asNumber(args[0] ?? 0)))
          .toString()
          .padStart(state.digits, '0')
          .slice(-state.digits);
        state.buffer = [...text].map((char, index) => {
          if (!padded && index < text.length - 1 && char === '0') return SEVSEG_GLYPHS[' '] ?? 0;
          // A leading-zero blank never eats the units: the last digit keeps
          // its zero so an empty value still reads as zero, not as blank.
          return SEVSEG_GLYPHS[char] ?? 0;
        });
        return 0;
      }
      case 'setChars': {
        const text = typeof args[0] === 'string' ? args[0] : formatValue(args[0] ?? 0);
        const chars = [...text].slice(0, state.digits);
        while (chars.length < state.digits) chars.push(' ');
        state.buffer = chars.map((char) => SEVSEG_GLYPHS[char] ?? SEVSEG_GLYPHS[' '] ?? 0);
        return 0;
      }
      case 'setBrightness': {
        state.brightness = Math.max(0, Math.min(100, Math.trunc(asNumber(args[0] ?? 100))));
        return 0;
      }
      case 'refreshDisplay': {
        if (state.digitPins.length === 0 || state.segmentPins.length === 0) return 0;
        const select = state.commonAnode ? LEVEL_HIGH : LEVEL_LOW;
        const release = state.commonAnode ? LEVEL_LOW : LEVEL_HIGH;
        const digit = state.mux % state.digits;
        const pattern = state.buffer[digit] ?? 0;
        const want: Array<{ pin: number; level: number }> = [];
        for (const pin of state.digitPins) want.push({ pin, level: release });
        state.segmentPins.forEach((pin, bit) => {
          want.push({ pin, level: (pattern >> bit) & 1 ? release : select });
        });
        const common = state.digitPins[digit];
        if (common !== undefined) want.push({ pin: common, level: select });
        // The mux advances every call — the glass multiplexes even when the
        // picture is steady — but pins already at their level stay silent, so
        // a steady buffer costs the common-pin swap, not a full drive.
        for (const { pin, level } of want) {
          if (state.levels.get(pin) !== level) {
            services.digitalWrite(pin, level);
            state.levels.set(pin, level);
          }
        }
        state.mux = (digit + 1) % state.digits;
        return 0;
      }
      default:
        return 0;
    }
  }

  /**
   * Starts a non-blocking tone: drives HIGH and records when the note ends.
   *
   * An expired note retires (LOW) on the next `tone`/`noTone` for its pin;
   * nothing retires it in between, which is what keeps the siren live across
   * loop passes without ever yielding. The frequency is recorded nowhere the
   * bench reads: levels, not waveforms, are what the buzzer net carries.
   */
  private startTone(pin: number, durationMs: number, services: FirmwareServices): void {
    const sounding = this.tones.get(pin);
    if (sounding && sounding.endsAt !== null && sounding.endsAt <= services.nowMs()) {
      this.tones.delete(pin);
      services.digitalWrite(pin, LEVEL_LOW);
    }
    services.digitalWrite(pin, LEVEL_HIGH);
    this.tones.set(pin, { endsAt: durationMs > 0 ? services.nowMs() + durationMs : null });
  }

  /** Silences a pin unconditionally, retiring any recorded note. */
  private stopTone(pin: number, services: FirmwareServices): void {
    this.tones.delete(pin);
    services.digitalWrite(pin, LEVEL_LOW);
  }

  /**
   * Handles an RTC call: `begin`, `now`, `adjust` and the two NVRAM verbs.
   *
   * Every verb goes out over the bench I2C with the same register sequences
   * the raw build's helpers use: `now` points the chip at 0x00 and reads the
   * seven BCD time registers; `adjust` writes them; the NVRAM verbs address
   * `0x08 + offset`. Only `endTransmission` blocks, yielding the bus time the
   * way `Wire` itself does.
   */
  private *evaluateRtcCall(
    member: string,
    args: Value[],
    services: FirmwareServices,
  ): Generator<Produced, Value, void> {
    const wire = services.wire;

    switch (member) {
      case 'begin': {
        // Probes for the part: with nothing answering at the address the bus
        // stays silent, which is the bench's report of a missing clock.
        wire.requestFrom(DS1307_ADDRESS, 1);
        return wire.available() > 0 ? 1 : 0;
      }
      case 'now': {
        /*
         * One bus read per burst of passes: the glass blinks per second and
         * the raw build itself re-reads at 10 Hz, so serving recent reads
         * from cache changes nothing observable. The cached path still yields
         * (1ms quantum) so delay-free loops keep suspending — without a yield
         * the runner would never return from step() and the bench would hang.
         */
        if (this.rtcNowCache && this.rtcNowCache.served < RTC_NOW_CACHE_READS) {
          this.rtcNowCache.served++;
          yield 0;
          return this.rtcNowCache.value;
        }
        wire.beginTransmission(DS1307_ADDRESS);
        wire.write(0x00);
        const selected = wire.endTransmission();
        if (selected > 0) yield selected / 1000;
        wire.requestFrom(DS1307_ADDRESS, 7);
        const raw: number[] = [];
        for (let index = 0; index < 7; index++) {
          raw.push(wire.available() > 0 ? wire.read() : 0);
        }
        const second = raw[0] ?? 0;
        const minute = raw[1] ?? 0;
        const hour = raw[2] ?? 0;
        const date = raw[4] ?? 0;
        const month = raw[5] ?? 0;
        const year = raw[6] ?? 0;
        // The seconds carry the halt flag in bit 7; the hour is read as a
        // 24-hour register, the only packing the bench produces.
        const value = new DateTimeValue(
          2000 + bcdToDec(year),
          bcdToDec(month),
          bcdToDec(date),
          bcdToDec(hour & 0x3f),
          bcdToDec(minute),
          bcdToDec(second & 0x7f),
        );
        this.rtcNowCache = { value, served: 1 };
        return value;
      }
      case 'adjust': {
        // Time moved under the cache: drop it before writing.
        this.rtcNowCache = null;
        const current = args[0] instanceof DateTimeValue ? args[0] : new DateTimeValue();
        // Sunday is 0 to the calendar and 7 on the chip.
        const weekday = new Date(
          Date.UTC(current.year(), current.month() - 1, current.day()),
        ).getUTCDay();
        wire.beginTransmission(DS1307_ADDRESS);
        wire.write(0x00);
        for (const byte of [
          decToBcd(current.second()),
          decToBcd(current.minute()),
          decToBcd(current.hour()),
          decToBcd(weekday === 0 ? 7 : weekday),
          decToBcd(current.day()),
          decToBcd(current.month()),
          decToBcd(current.year() - 2000),
        ]) {
          wire.write(byte);
        }
        const written = wire.endTransmission();
        if (written > 0) yield written / 1000;
        return 0;
      }
      case 'readnvram': {
        wire.beginTransmission(DS1307_ADDRESS);
        wire.write(NVRAM_BASE + (asNumber(args[0] ?? 0) & 0xff));
        const selected = wire.endTransmission();
        if (selected > 0) yield selected / 1000;
        wire.requestFrom(DS1307_ADDRESS, 1);
        return wire.available() > 0 ? wire.read() : -1;
      }
      case 'writenvram': {
        wire.beginTransmission(DS1307_ADDRESS);
        wire.write(NVRAM_BASE + (asNumber(args[0] ?? 0) & 0xff));
        wire.write(asNumber(args[1] ?? 0));
        const written = wire.endTransmission();
        if (written > 0) yield written / 1000;
        return 0;
      }
      default:
        return 0;
    }
  }

  /**
   * Handles a `WiFi.*` call: joining a network, and reporting on the join.
   *
   * The spellings are Arduino's, including `localIP`'s capitalisation, because
   * this is the part of a real ESP32 sketch that needs no sockets to be honest:
   * `begin`, then `status` until it reads `WL_CONNECTED`. The radio's work
   * happens in the host, which is the same arrangement as the map's.
   */
  private evaluateWifiCall(member: string, args: Value[], services: FirmwareServices): Value {
    const net = services.net;
    if (!net) return 0;
    switch (member) {
      case 'begin':
        net.join(formatValue(args[0] ?? ''), formatValue(args[1] ?? ''));
        // `begin` returns void on a real board: the answer is read from status.
        return 0;
      case 'status':
        return net.status();
      case 'localIP':
        return net.localIp();
      default:
        return 0;
    }
  }

  /**
   * Handles a `net.*` call: asking the network for a url, and reading it.
   *
   * `get` answers whether the answer has arrived rather than what it says, so a
   * sketch polls -- the shape a real request has, and the reason a program that
   * uses the network has a loop in it that one that does not never needs.
   */
  private evaluateNetCall(member: string, args: Value[], services: FirmwareServices): Value {
    const net = services.net;
    if (!net) return 0;
    switch (member) {
      case 'get':
        return net.get(formatValue(args[0] ?? ''));
      case 'read':
        return net.read();
      case 'failed':
        return net.failed();
      case 'subscribe':
        return net.subscribe(formatValue(args[0] ?? ''));
      case 'available':
        return net.available();
      case 'message':
        return net.message();
      case 'publish':
        return net.publish(formatValue(args[0] ?? ''), formatValue(args[1] ?? ''));
      case 'reset':
        net.reset();
        return 0;
      default:
        return 0;
    }
  }

  /**
   * Handles a `map.*` call: asking for a tile, and drawing one.
   *
   * Dispatched by name like `Wire` and `SPI`, so it reaches the same code from
   * a C++ sketch and a Python one -- which is the point of the VM having one
   * AST rather than two.
   */
  private evaluateMapCall(member: string, args: Value[], services: FirmwareServices): Value {
    const map = services.map;
    if (!map) return 0;

    switch (member) {
      case 'request':
        return map.request(asNumber(args[0] ?? 0), asNumber(args[1] ?? 0), asNumber(args[2] ?? 0))
          ? 1
          : 0;
      case 'blit':
        return map.blit(
          asNumber(args[0] ?? 0),
          asNumber(args[1] ?? 0),
          asNumber(args[2] ?? 0),
          asNumber(args[3] ?? 0),
          asNumber(args[4] ?? 0),
        )
          ? 1
          : 0;
      case 'ready':
        return map.ready() ? 1 : 0;
      case 'reset':
        map.reset();
        return 0;
      default:
        return 0;
    }
  }

  /**
   * Handles a `tft.*` call: turning the panel, and asking how big it is.
   *
   * Dispatched by name like `map`, so a C++ sketch and a Python one reach the
   * same code. Every method reports what the panel actually did rather than
   * echoing the argument, which is what makes `setRotation` worth having: a
   * sketch that asks for an orientation it cannot have learns that from the
   * return value instead of carrying on with the wrong idea about the screen.
   */
  private evaluateTftCall(member: string, args: Value[], services: FirmwareServices): Value {
    const tft = services.tft;
    if (!tft) return 0;

    switch (member) {
      case 'begin':
        return tft.begin();
      case 'setRotation':
        return tft.setRotation(asNumber(args[0] ?? 0));
      case 'width':
        return tft.width();
      case 'height':
        return tft.height();
      case 'clear':
      case 'fillScreen':
        return tft.clear();
      case 'fillRect':
        return tft.fillRect(
          asNumber(args[0] ?? 0),
          asNumber(args[1] ?? 0),
          asNumber(args[2] ?? 0),
          asNumber(args[3] ?? 0),
          asNumber(args[4] ?? 0),
        );
      /*
       * Text arrives as one Value rather than as several numbers, so it is
       * stringified rather than indexed. `drawString` is accepted alongside
       * `print` because a library that has a fill call has a draw call too, and
       * a sketch should not have to be rewritten over which word it uses.
       */
      case 'print':
      case 'drawString':
        return tft.print(
          String(args[0] ?? ''),
          asNumber(args[1] ?? 0),
          asNumber(args[2] ?? 0),
          asNumber(args[3] ?? 0),
        );
      case 'textWidth':
        return tft.textWidth(String(args[0] ?? ''));
      case 'textHeight':
        return tft.textHeight();
      default:
        return 0;
    }
  }

  /** Writes a `0`/`1` or `0..1` value to a device's pin. */
  private writeDevice(
    device: Device,
    member: string,
    value: Value,
    services: FirmwareServices,
  ): void {
    if (member !== 'value') return;
    if (device.kind === 'pwm') {
      services.analogWrite(device.pin, asNumber(value));
      return;
    }
    if (device.kind === 'input' || device.kind === 'switch') return;
    this.writeLevel(device, isTruthy(value) ? LEVEL_HIGH : LEVEL_LOW, services);
  }

  /** Reads a device's pin as `value` is written, or as its switch reads. */
  private readDevice(device: Device, member: string, services: FirmwareServices): Value {
    const raw = services.digitalRead(device.pin);
    const level = device.kind === 'switch' && SWITCH_ACTIVE_LOW ? (raw ? 0 : 1) : raw ? 1 : 0;

    switch (member) {
      case 'value':
      case 'is_pressed':
      case 'is_active':
        return level;
      case 'is_inactive':
      case 'is_released':
        return level ? 0 : 1;
      default:
        return 0;
    }
  }

  private writeLevel(device: Device, level: number, services: FirmwareServices): void {
    if (device.kind === 'input' || device.kind === 'switch') return;
    if (device.kind === 'pwm') {
      services.analogWrite(device.pin, level ? 1 : 0);
      return;
    }
    services.digitalWrite(device.pin, level);
  }

  private evaluateSerialCall(member: string, args: Value[], services: FirmwareServices): Value {
    switch (member) {
      case 'begin':
        services.serialBegin(asNumber(args[0] ?? 9600));
        return 0;
      case 'print':
      case 'println': {
        let text: string;
        const first = args[0];
        if (typeof first === 'string') {
          text = first;
        } else {
          text = formatPrintValue(asNumber(first));
        }
        // Serial.print(a, b) prints a numeric field.
        if (member === 'print' && args.length > 1 && typeof first !== 'string') {
          text = formatPrintValue(asNumber(first), asNumber(args[1]));
        }
        if (member === 'println') text += '\n';
        services.serialWrite(text);
        return 0;
      }
      case 'write':
        services.serialWrite(String.fromCharCode(asNumber(args[0] ?? 0)));
        return 0;
      case 'available':
        return 0;
      case 'read':
        return -1;
      default:
        /*
         * A member the port does not have. It used to answer 0, which reads
         * as a port that had nothing to say rather than as a call the bench
         * cannot make.
         */
        throw unknownError('member', member, 'Serial', this.language);
    }
  }

  /**
   * Handles a `Wire.*` call.
   *
   * Only `endTransmission` can block: it yields however long the transfer took
   * on the bus, so a sketch pushing a framebuffer genuinely waits for the
   * screen to catch up instead of finishing instantly.
   */
  private *evaluateWireCall(
    member: string,
    args: Value[],
    services: FirmwareServices,
  ): Generator<Produced, Value, void> {
    const wire = services.wire;

    switch (member) {
      case 'begin':
        wire.begin(asNumber(args[0] ?? 0), asNumber(args[1] ?? 0));
        return 0;
      case 'beginTransmission':
        wire.beginTransmission(asNumber(args[0] ?? 0));
        return 0;
      case 'write':
        return wire.write(asNumber(args[0] ?? 0));
      case 'endTransmission': {
        const micros = wire.endTransmission();
        if (micros > 0) yield micros / 1000;
        return 0;
      }
      case 'requestFrom':
        return wire.requestFrom(asNumber(args[0] ?? 0), asNumber(args[1] ?? 0));
      case 'read':
        return wire.read();
      case 'available':
        return wire.available();
      default:
        return 0;
    }
  }

  /**
   * Handles a `machine.I2C` call.
   *
   * MicroPython's spelling of the same transactions `Wire` makes, over the
   * bench's bus: `readfrom_mem(0x68, 0, 1)` is the datasheet's "write the
   * register pointer, then read a byte". The bus is the board's, so the
   * constructor's pins are accepted and ignored, exactly as `Wire.begin()`
   * without arguments is.
   */
  private *evaluateMachineI2cCall(
    member: string,
    args: Value[],
    services: FirmwareServices,
    port?: WirePort,
    pins?: I2cBusPins,
  ): Generator<Produced, Value, void> {
    const wire = port ?? services.wire;
    /*
     * A buffer is an array, and a single byte is accepted where a one-byte
     * buffer is meant: the Python front end has no bytes literal, and making
     * `writeto_mem(0x68, 0, 30)` the spelling keeps the register protocol
     * legible without teaching a literal the parser cannot read.
     */
    const bytes = (value: Value | undefined): number[] =>
      Array.isArray(value)
        ? value.map((byte) => Math.trunc(asNumber(byte)) & 0xff)
        : value === undefined
          ? []
          : [Math.trunc(asNumber(value)) & 0xff];

    switch (member) {
      case 'writeto': {
        wire.beginTransmission(asNumber(args[0] ?? 0));
        for (const byte of bytes(args[1])) wire.write(byte);
        const micros = wire.endTransmission();
        if (micros > 0) yield micros / 1000;
        return 0;
      }
      case 'writeto_mem': {
        wire.beginTransmission(asNumber(args[0] ?? 0));
        wire.write(Math.trunc(asNumber(args[1] ?? 0)) & 0xff);
        for (const byte of bytes(args[2])) wire.write(byte);
        const micros = wire.endTransmission();
        if (micros > 0) yield micros / 1000;
        return 0;
      }
      case 'readfrom': {
        const address = asNumber(args[0] ?? 0);
        const count = Math.max(0, Math.trunc(asNumber(args[1] ?? 0)));
        this.requireI2cDevice(services, address, pins);
        wire.requestFrom(address, count);
        const out: number[] = [];
        for (let i = 0; i < count; i++) out.push(wire.read());
        return out;
      }
      case 'readfrom_mem': {
        const address = asNumber(args[0] ?? 0);
        const count = Math.max(0, Math.trunc(asNumber(args[2] ?? 0)));
        wire.beginTransmission(address);
        wire.write(Math.trunc(asNumber(args[1] ?? 0)) & 0xff);
        /*
         * The pointer write is a transaction and costs the bus its time, the
         * same way `writeto_mem` does. Skipping it would let a MicroPython
         * clock outrun the C++ clock on the same bench by the cost of every
         * register address it sent.
         */
        const micros = wire.endTransmission();
        if (micros > 0) yield micros / 1000;
        this.requireI2cDevice(services, address, pins);
        wire.requestFrom(address, count);
        const out: number[] = [];
        for (let i = 0; i < count; i++) out.push(wire.read());
        return out;
      }
      /*
       * A real scan probes addresses from 8 to 119 one transaction at a time.
       * The bench's bus reports a transfer's timing, not an acknowledgement,
       * so there is nothing honest to answer here -- an empty scan is the one
       * answer that does not invent a device.
       */
      case 'scan':
        return [];
      default:
        return 0;
    }
  }

  /**
   * A read from a device nobody wired.
   *
   * MicroPython raises `OSError` when the controller is not acknowledged, and
   * a sketch that guards its reads has to be able to catch that. The bus on
   * this bench answers only for a device that is really on it, so the answer
   * is the honest one -- and a host that cannot say is left alone.
   */
  private requireI2cDevice(
    services: FirmwareServices,
    address: number,
    pins?: I2cBusPins,
  ): void {
    if (services.i2cHasDevice === undefined) return;
    if (services.i2cHasDevice(address, pins)) return;
    throw new PythonError('OSError', `[Errno 5] no device at 0x${(address & 0x7f).toString(16)}`);
  }

  /**
   * Handles an `lcd.*` call.
   *
   * Nothing here blocks: an HD44780 is a parallel device whose whole cost is
   * the microseconds the bus takes, which no sketch here is fast enough to
   * notice. What matters is that the characters land on the glass and that a
   * display wired to the wrong pins stays blank.
   */
  private evaluateLcdCall(member: string, args: Value[], services: FirmwareServices): Value {
    const lcd = services.lcd;
    if (!lcd) return 0;
    const number = (index: number): number => asNumber(args[index] ?? 0);

    switch (member) {
      case 'begin':
        return lcd.begin(number(0), number(1));
      case 'clear':
        lcd.clear();
        return 0;
      case 'home':
        lcd.home();
        return 0;
      case 'setCursor':
        lcd.setCursor(number(0), number(1));
        return 0;
      case 'print':
        lcd.print(typeof args[0] === 'string' ? args[0] : String(asNumber(args[0] ?? 0)));
        return 0;
      case 'write':
        lcd.write(number(0));
        return 0;
      case 'createChar': {
        const bitmap = Array.isArray(args[1]) ? (args[1] as number[]) : [];
        lcd.createChar(
          number(0),
          bitmap.map((row) => asNumber(row)),
        );
        return 0;
      }
      case 'backlight':
        lcd.backlight();
        return 0;
      case 'noBacklight':
        lcd.noBacklight();
        return 0;
      default:
        return 0;
    }
  }

  /** Handles a `servo.*` call, which addresses servos by the pin they are on. */
  private evaluateServoCall(member: string, args: Value[], services: FirmwareServices): Value {
    const servo = services.servo;
    if (!servo) return 0;
    const pin = this.pinOf(services, asNumber(args[0] ?? -1));

    switch (member) {
      case 'attach':
        servo.attach(pin);
        return 0;
      case 'write':
        servo.write(pin, asNumber(args[1] ?? 0));
        return 0;
      case 'read':
        return servo.read(pin);
      case 'detach':
        servo.detach(pin);
        return 0;
      default:
        return 0;
    }
  }

  /** Handles a `dht.*` call, which addresses sensors by the pin SDA is on. */
  private evaluateDhtCall(member: string, args: Value[], services: FirmwareServices): Value {
    const dht = services.dht;
    if (!dht) return 0;
    const pin = this.pinOf(services, asNumber(args[0] ?? -1));

    switch (member) {
      case 'begin':
        dht.begin(pin);
        return 0;
      case 'temperature':
        return dht.temperature(pin);
      case 'humidity':
        return dht.humidity(pin);
      default:
        return 0;
    }
  }

  /** Handles a `pixels.*` call, which addresses LED parts by their DIN pin. */
  private evaluatePixelsCall(member: string, args: Value[], services: FirmwareServices): Value {
    const pixels = services.pixels;
    if (!pixels) return 0;
    const pin = this.pinOf(services, asNumber(args[0] ?? -1));

    switch (member) {
      case 'count':
        return pixels.count(pin);
      case 'setColor':
        pixels.setColor(
          pin,
          asNumber(args[1] ?? 0),
          asNumber(args[2] ?? 0),
          asNumber(args[3] ?? 0),
          asNumber(args[4] ?? 0),
        );
        return 0;
      default:
        return 0;
    }
  }

  /** Handles an `ir.*` call, which addresses receivers by their DAT pin. */
  private evaluateIrCall(member: string, args: Value[], services: FirmwareServices): Value {
    const ir = services.ir;
    if (!ir) return 0;
    const pin = this.pinOf(services, asNumber(args[0] ?? -1));

    switch (member) {
      case 'readCode':
        return ir.readCode(pin);
      default:
        return 0;
    }
  }

  /** Handles a `dialer.*` call, which addresses dialers by their DIAL pin. */
  private evaluateDialerCall(member: string, args: Value[], services: FirmwareServices): Value {
    const dialer = services.dialer;
    const pin = this.pinOf(services, asNumber(args[0] ?? -1));

    switch (member) {
      case 'read':
        return dialer ? dialer.read(pin) : -1;
      default:
        return 0;
    }
  }

  /** Handles an `sd.*` call, which addresses cards by their CS pin. */
  private evaluateSdCall(member: string, args: Value[], services: FirmwareServices): Value {
    const sd = services.sd;
    const pin = this.pinOf(services, asNumber(args[0] ?? -1));
    const text = (index: number): string => {
      const arg = args[index];
      return typeof arg === 'string' ? arg : String(asNumber(arg ?? 0));
    };

    switch (member) {
      case 'begin':
        return sd ? (sd.begin(pin) ? 1 : 0) : 0;
      case 'write':
        return sd ? sd.write(pin, text(1), text(2)) : 0;
      case 'read':
        return sd ? sd.read(pin, text(1)) : '';
      case 'exists':
        return sd ? sd.exists(pin, text(1)) : 0;
      case 'remove':
        return sd ? sd.remove(pin, text(1)) : 0;
      default:
        return 0;
    }
  }

  /**
   * Handles an `SPI.*` call.
   *
   * Only `end()` blocks: it yields the bus time for the whole transfer, so a
   * sketch pushing a 320x240 frame genuinely waits for it. Pushing a full frame
   * at the bus clock is over a hundred milliseconds, and hiding that would make
   * SPI look like something it is not.
   */
  private *evaluateSpiCall(
    member: string,
    args: Value[],
    services: FirmwareServices,
  ): Generator<Produced, Value, void> {
    const spi = services.spi;

    switch (member) {
      case 'begin':
        return 0;
      case 'beginTransaction':
      case 'setClockDivider':
      case 'setBitOrder':
      case 'setDataMode':
        spi.begin();
        return 0;
      case 'end': {
        const micros = spi.end();
        if (micros > 0) yield micros / 1000;
        return 0;
      }
      // `transfer(byte, true)` sends data; anything else sends a command.
      case 'transfer':
        return spi.transfer(asNumber(args[0] ?? 0), asNumber(args[1] ?? 1) !== 0);
      default:
        return 0;
    }
  }
}

const BUILTIN_CONSTANTS: Readonly<Record<string, number>> = {
  HIGH: LEVEL_HIGH,
  LOW: LEVEL_LOW,
  INPUT: PIN_INPUT,
  OUTPUT: PIN_OUTPUT,
  INPUT_PULLUP: PIN_INPUT_PULLUP,
};

/** Native helpers that are pure arithmetic and need no host access. */
const BUILTINS: Readonly<Record<string, (args: number[]) => Value>> = {
  abs: (args) => Math.abs(args[0] ?? 0),
  min: (args) => Math.min(...args),
  max: (args) => Math.max(...args),
  sq: (args) => (args[0] ?? 0) ** 2,
  sqrt: (args) => Math.sqrt(args[0] ?? 0),
  /*
   * Trigonometry and logarithms.
   *
   * Here because any lesson that places something on a curved surface needs
   * them: the projection behind every slippy map is a sine and a natural
   * logarithm, and a VM that can do neither cannot draw one.
   */
  sin: (args) => Math.sin(args[0] ?? 0),
  cos: (args) => Math.cos(args[0] ?? 0),
  tan: (args) => Math.tan(args[0] ?? 0),
  log: (args) => Math.log(args[0] ?? 0),
  exp: (args) => Math.exp(args[0] ?? 0),
  /*
   * Rounding. `(int)` truncates towards zero, which is not what casting a
   * negative number to a whole one usually means -- hence the separate floor.
   */
  floor: (args) => Math.floor(args[0] ?? 0),
  ceil: (args) => Math.ceil(args[0] ?? 0),
  round: (args) => Math.round(args[0] ?? 0),
  pow: (args) => (args[0] ?? 0) ** (args[1] ?? 0),
  /*
   * Integer division, truncating toward zero.
   *
   * Spelled out rather than folded into `/`, because `/` is floating-point
   * division and C only truncates when it knows both sides are whole numbers --
   * which a VM that carries no types cannot know.
   */
  idiv: (args) => (args[1] === 0 ? 0 : Math.trunc(args[0] / args[1])),
  map: (args) => {
    const [value, inLow, inHigh, outLow, outHigh] = args;
    if (inHigh === inLow) return outLow ?? 0;
    return (
      (outLow ?? 0) +
      (((value ?? 0) - (inLow ?? 0)) * ((outHigh ?? 0) - (outLow ?? 0))) / (inHigh - inLow)
    );
  },
};

function applyBinary(operator: string, left: number, right: number): number {
  switch (operator) {
    case '+':
      return left + right;
    case '-':
      return left - right;
    case '*':
      return left * right;
    case '/':
      /*
       * True division.
       *
       * This used to truncate toward zero on the grounds that C integer
       * division does. But C only truncates when *both* operands are integral,
       * and this VM does not carry types, so truncating unconditionally made
       * every expression involving a `float` or a `double` wrong -- silently,
       * and worst for the expressions that depend on it most: a latitude in
       * degrees divided by 360 came out as zero, and the map it was placing a
       * point on drew the point at the edge of the world.
       *
       * Sketches that want the old behaviour want it explicitly, which is what
       * `idiv` is for.
       */
      return right === 0 ? 0 : left / right;
    case '%':
      return right === 0 ? 0 : Math.trunc(left % right);
    case '<':
      return left < right ? 1 : 0;
    case '>':
      return left > right ? 1 : 0;
    case '<=':
      return left <= right ? 1 : 0;
    case '>=':
      return left >= right ? 1 : 0;
    case '==':
      return left === right ? 1 : 0;
    case '!=':
      return left !== right ? 1 : 0;
    case '&':
      return left & right;
    case '|':
      return left | right;
    case '^':
      return left ^ right;
    case '<<':
      return left << right;
    case '>>':
      return left >> right;
    default:
      return 0;
  }
}

/** Mirrors Arduino's `Serial.print` formatting closely enough to be useful. */
function formatPrintValue(value: number, decimals?: number): string {
  if (!Number.isFinite(value)) return 'nan';
  if (decimals !== undefined) return value.toFixed(decimals);
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2);
}

/**
 * Drives a firmware program against a set of services.
 *
 * `runSlice` executes until the program next blocks, then hands the requested
 * wait to `advance`. Callers loop until `done`, which keeps rendering and
 * stepping control with whoever owns the frame loop.
 */
/**
 * Simulated time attributed to one non-blocking pass of loop().
 *
 * Small enough that a delay-free sketch still animates at a watchable rate,
 * large enough that it does not monopolise the frame.
 */
const NON_BLOCKING_QUANTUM_MS = 1;

/**
 * Cached RTC reads served before the next bus read. Each served pass still
 * costs its 1ms scheduler quantum, so this bounds staleness to roughly
 * 50ms — far below the per-second glass.
 */
const RTC_NOW_CACHE_READS = 50;

/**
 * Checks that a program imports only the Python modules its board has.
 *
 * The board's runtime decides the vocabulary: MicroPython speaks `machine`,
 * a Raspberry Pi speaks `gpiozero`. A program that asks for the other one
 * gets an error here rather than a sketch that runs and does nothing.
 */
export function assertPythonModules(
  files: ReadonlyArray<{ readonly name: string; readonly content: string }>,
  modules: readonly PythonModule[] | undefined,
): void {
  if (modules === undefined) return;
  const allowed = new Set(modules);
  for (const file of files) {
    for (const module of pythonRuntimeImports(file.content)) {
      if (allowed.has(module)) continue;
      const other: PythonModule = module === 'machine' ? 'gpiozero' : 'machine';
      throw new FirmwareProjectError(
        allowed.has(other)
          ? `${file.name}: this board speaks \`${other}\`, not \`${module}\``
          : `${file.name}: this board has no \`${module}\`; it runs Arduino C++ sketches`,
      );
    }
  }
}

export class FirmwareRunner {
  readonly runtime: FirmwareRuntime;
  readonly output: string[] = [];

  private readonly generator: Generator<Produced, void, void>;
  private finished = false;
  constructor(
    source: string | FirmwareProject,
    services: FirmwareServices,
    language: FirmwareLanguage = 'arduino-cpp',
  ) {
    const programLanguage = typeof source === 'string' ? language : source.language;
    if (programLanguage === 'python') {
      const files =
        typeof source === 'string' ? [{ name: 'main.py', content: source }] : source.files;
      assertPythonModules(files, services.pythonModules);
    }
    this.runtime =
      typeof source === 'string'
        ? new FirmwareRuntime(source, language)
        : FirmwareRuntime.fromProject(source);
    this.generator = this.runtime.main(this.withSerialSink(services));
  }

  get done(): boolean {
    return this.finished;
  }

  /**
   * Runs the program until it next blocks, reporting how long it wants to wait.
   *
   * The runner deliberately does not spend that time itself. Handing the wait
   * back lets the host decide how much of it fits in the current frame, which
   * is what keeps simulated time tracking wall-clock time instead of racing away
   * at whatever rate the solver happens to manage.
   *
   * Returns null once the program has finished.
   */
  step(): number | null {
    if (this.finished) return null;
    const result = this.generator.next();
    if (result.done) {
      this.finished = true;
      return null;
    }
    const produced = result.value;
    if (typeof produced !== 'number') {
      // A value yielded outside a generator: the sketch asked for something
      // that has no meaning outside one, and saying so beats swallowing it.
      throw new PythonError('SyntaxError', 'yield outside a function');
    }
    return produced > 0 ? produced : NON_BLOCKING_QUANTUM_MS;
  }

  /** Stops the program at the next opportunity to block. */
  stop(): void {
    this.finished = true;
  }

  private withSerialSink(services: FirmwareServices): FirmwareServices {
    return {
      ...services,
      serialWrite: (text) => {
        services.serialWrite(text);
        this.output.push(text);
        // Keep the buffer bounded; a chatty sketch would otherwise grow it
        // without limit over a long run.
        if (this.output.length > 500) this.output.splice(0, this.output.length - 500);
      },
    };
  }
}
