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

import {
  type Expr,
  type FunctionDecl,
  type Program,
  type Stmt,
  parseFirmware,
} from './parser';

/** A runtime value: numbers for everything numeric, plus strings for Serial. */
export type Value = number | string;

/** Yields the milliseconds a blocking call wants to wait. */
export type DelayRequest = number;
export type Evaluator = Generator<DelayRequest, Value, void>;

export interface FirmwareServices {
  nowMs(): number;
  pinMode(pin: number, mode: number): void;
  digitalWrite(pin: number, level: number): void;
  digitalRead(pin: number): number;
  analogWrite(pin: number, value: number): void;
  analogRead(pin: number): number;
  serialBegin(baud: number): void;
  serialWrite(text: string): void;
  /** The I2C bus, for sketches that drive a display or sensor directly. */
  wire: WirePort;
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
  servo?: ServoPort;
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

export const PIN_INPUT = 0;
export const PIN_OUTPUT = 1;
export const PIN_INPUT_PULLUP = 2;
export const LEVEL_LOW = 0;
export const LEVEL_HIGH = 1;

/** Signals a non-local exit from a statement. */
type Flow =
  | { kind: 'normal' }
  | { kind: 'break' }
  | { kind: 'continue' }
  | { kind: 'return'; value: Value };

const NORMAL: Flow = { kind: 'normal' };


class Scope {
  readonly values = new Map<string, Value>();
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
}

/** Yields a scope and each of its enclosing scopes, innermost first. */
function* chainFrom(start: Scope): Generator<Scope> {
  for (let node: Scope | null = start; node !== null; node = node.parent) {
    yield node;
  }
}

function isTruthy(value: Value): boolean {
  return typeof value === 'number' ? value !== 0 : value.length > 0;
}

function asNumber(value: Value): number {
  if (typeof value === 'number') return value;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export class FirmwareRuntime {
  readonly program: Program;
  readonly defines: Map<string, number>;

  private readonly globals = new Scope();
  private readonly functions = new Map<string, FunctionDecl>();

  constructor(source: string) {
    this.program = parseFirmware(source);
    this.defines = new Map(this.program.defines);

    for (const declaration of this.program.functions.values()) {
      this.functions.set(declaration.name, declaration);
    }

    for (const name of ['HIGH', 'LOW', 'INPUT', 'OUTPUT', 'INPUT_PULLUP']) {
      this.globals.values.set(name, BUILTIN_CONSTANTS[name]);
    }
    this.globals.values.set('true', 1);
    this.globals.values.set('false', 0);
  }

  hasFunction(name: string): boolean {
    return this.functions.has(name);
  }

  /** Runs `setup()` once, then `loop()` forever. Yields each blocking wait. */
  *main(services: FirmwareServices): Generator<DelayRequest, void, void> {
    for (const declaration of this.program.globals) {
      yield* this.execute(declaration, this.globals, services);
    }

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
  ): Generator<DelayRequest, Value, void> {
    const builtin = BUILTINS[name];
    if (builtin) return builtin(args.map(asNumber));

    const declaration = this.functions.get(name);
    if (!declaration) {
      return yield* this.evaluateCall(name, args, services);
    }

    const scope = new Scope(parent);
    declaration.parameters.forEach((parameter, index) => {
      scope.values.set(parameter.name, args[index] ?? 0);
    });

    const flow = yield* this.execute(declaration.body, scope, services);
    // The body's `return` carries the value out; falling off the end, as C
    // does, yields whatever the last expression left behind.
    return flow.kind === 'return' ? flow.value : 0;
  }

  /** Builtins the VM does not implement itself delegate to the host services. */
  private *evaluateCall(
    name: string,
    args: Value[],
    services: FirmwareServices,
  ): Generator<DelayRequest, Value, void> {
    switch (name) {
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
        services.pinMode(asNumber(args[0] ?? 0), asNumber(args[1] ?? 0));
        return 0;
      case 'digitalWrite':
        services.digitalWrite(asNumber(args[0] ?? 0), asNumber(args[1] ?? 0));
        return 0;
      case 'digitalRead':
        return services.digitalRead(asNumber(args[0] ?? 0));
      case 'analogWrite':
        services.analogWrite(asNumber(args[0] ?? 0), asNumber(args[1] ?? 0));
        return 0;
      case 'analogRead':
        return services.analogRead(asNumber(args[0] ?? 0));
      case 'random':
        return Math.floor(Math.random() * asNumber(args[0] ?? 1));
      case 'constrain':
        return Math.min(
          asNumber(args[2] ?? 0),
          Math.max(asNumber(args[1] ?? 0), asNumber(args[0] ?? 0)),
        );
      default:
        return 0;
    }
  }

  // -- statements ----------------------------------------------------------

  private *execute(
    statement: Stmt,
    scope: Scope,
    services: FirmwareServices,
  ): Generator<DelayRequest, Flow, void> {
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

      case 'varDecl': {
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

      case 'expression':
        yield* this.evaluate(statement.value, scope, services);
        return NORMAL;

      case 'if': {
        const condition = yield* this.evaluate(statement.condition, scope, services);
        if (isTruthy(condition as Value)) return yield* this.execute(statement.then, scope, services);
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
        const loopScope = new Scope(scope);
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

      case 'break':
        return { kind: 'break' };

      case 'continue':
        return { kind: 'continue' };

      case 'return': {
        const value = statement.value
          ? ((yield* this.evaluate(statement.value, scope, services)) as Value)
          : 0;
        return { kind: 'return', value };
      }
    }
  }

  // -- expressions ---------------------------------------------------------

  private *evaluate(
    expression: Expr,
    scope: Scope,
    services: FirmwareServices,
  ): Generator<DelayRequest, Value, void> {
    switch (expression.kind) {
      case 'number':
        return expression.value;

      case 'string':
        return expression.value;

      case 'boolean':
        return expression.value ? 1 : 0;

      case 'identifier': {
        const found = scope.lookup(expression.name);
        return found ?? this.defines.get(expression.name) ?? 0;
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
          return isTruthy((yield* this.evaluate(expression.right, scope, services)) as Value) ? 1 : 0;
        }
        if (expression.operator === '||') {
          const left = (yield* this.evaluate(expression.left, scope, services)) as Value;
          if (isTruthy(left)) return 1;
          return isTruthy((yield* this.evaluate(expression.right, scope, services)) as Value) ? 1 : 0;
        }

        const left = asNumber((yield* this.evaluate(expression.left, scope, services)) as Value);
        const right = asNumber((yield* this.evaluate(expression.right, scope, services)) as Value);
        return applyBinary(expression.operator, left, right);
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
          const store = this.resolveArray(expression.target.target, scope);
          const index = asNumber((yield* this.evaluate(expression.target.index, scope, services)) as Value);
          if (!store || index < 0 || index >= store.length) return 0;
          store[index] = asNumber(value);
          return store[index];
        }

        return value;
      }

      case 'index': {
        const store = this.resolveArray(expression.target, scope);
        const index = asNumber((yield* this.evaluate(expression.index, scope, services)) as Value);
        if (!store || index < 0 || index >= store.length) return 0;
        return store[index];
      }

      case 'member': {
        // A bare `Serial`, `Wire` or `SPI` on the right of a dot has no value
        // of its own; their methods are reached through the `call` branch.
        return 0;
      }

      case 'call': {
        const callee = expression.callee;
        if (callee.kind === 'identifier') {
          const args: Value[] = [];
          for (const argument of expression.args) {
            args.push((yield* this.evaluate(argument, scope, services)) as Value);
          }
          return (yield* this.callFunction(callee.name, args, scope, services)) as Value;
        }
        if (callee.kind === 'member' && callee.target.kind === 'identifier') {
          const args: Value[] = [];
          for (const argument of expression.args) {
            args.push((yield* this.evaluate(argument, scope, services)) as Value);
          }
          if (callee.target.name === 'lcd' || callee.target.name === 'LiquidCrystal') {
            return this.evaluateLcdCall(callee.member, args, services);
          }
          if (callee.target.name === 'servo' || callee.target.name === 'Servo') {
            return this.evaluateServoCall(callee.member, args, services);
          }
          if (callee.target.name === 'Wire') {
            yield* this.evaluateWireCall(callee.member, args, services);
            return 0;
          }
          if (callee.target.name === 'SPI') {
            yield* this.evaluateSpiCall(callee.member, args, services);
            return 0;
          }
          return this.evaluateSerialCall(callee.member, args, services);
        }
        return 0;
      }
    }
  }

  private resolveArray(expression: Expr, scope: Scope): number[] | undefined {
    if (expression.kind !== 'identifier') return undefined;
    return scope.arrayFor(expression.name);
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
        return 0;
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
  ): Generator<DelayRequest, Value, void> {
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
        lcd.createChar(number(0), bitmap.map((row) => asNumber(row)));
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
    const pin = asNumber(args[0] ?? -1);

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
  ): Generator<DelayRequest, Value, void> {
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
const BUILTINS: Readonly<
  Record<string, (args: number[]) => Value>
> = {
  abs: (args) => Math.abs(args[0] ?? 0),
  min: (args) => Math.min(...args),
  max: (args) => Math.max(...args),
  sq: (args) => (args[0] ?? 0) ** 2,
  pow: (args) => (args[0] ?? 0) ** (args[1] ?? 0),
  map: (args) => {
    const [value, inLow, inHigh, outLow, outHigh] = args;
    if (inHigh === inLow) return outLow ?? 0;
    return (
      (outLow ?? 0) +
      ((value ?? 0) - (inLow ?? 0)) * ((outHigh ?? 0) - (outLow ?? 0)) / (inHigh - inLow)
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
      // C integer division truncates toward zero; JS rounds. Matching C here
      // matters because sketches divide loop counters by 2 constantly.
      return right === 0 ? 0 : Math.trunc(left / right);
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

export class FirmwareRunner {
  readonly runtime: FirmwareRuntime;
  readonly output: string[] = [];

  private readonly generator: Generator<DelayRequest, void, void>;
  private finished = false;
  constructor(source: string, services: FirmwareServices) {
    this.runtime = new FirmwareRuntime(source);
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
    return result.value > 0 ? result.value : NON_BLOCKING_QUANTUM_MS;
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