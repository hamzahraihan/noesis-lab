/**
 * Lexer and parser for the C subset the firmware VM understands.
 *
 * The grammar covers what real Arduino sketches use: globals with initialisers,
 * functions, all the ordinary control flow, arrays, the full operator set, and
 * `#define` constants. It deliberately does not cover pointers, structs,
 * classes, heap allocation or templates. That is not a shortcut so much as a
 * decision about what the simulator is for -- every one of those features is
 * about memory layout, and this tool is about wiring.
 *
 * Parse errors carry the source line, because the most common thing a learner
 * will do here is type something the parser has never seen.
 */

export interface SourceLocation {
  readonly line: number;
  readonly column: number;
}

export class FirmwareSyntaxError extends Error {
  public readonly location: SourceLocation;
  public readonly file: string;
  constructor(message: string, location: SourceLocation, file = 'main.ino') {
    super(`${file}:${location.line}: ${message} (line ${location.line}, column ${location.column})`);
    this.name = 'FirmwareSyntaxError';
    this.location = location;
    this.file = file;
  }
}

// ---------------------------------------------------------------------------
// Lexer
// ---------------------------------------------------------------------------

export type TokenKind =
  | 'number'
  | 'string'
  | 'identifier'
  | 'punctuation'
  | 'keyword'
  | 'directive'
  | 'eof';

export interface Token {
  readonly kind: TokenKind;
  /** Raw text for identifiers, keywords and directives; parsed value otherwise. */
  readonly text: string;
  readonly value?: number;
  readonly location: SourceLocation;
}

const KEYWORDS = new Set([
  'void', 'int', 'float', 'double', 'bool', 'char', 'byte', 'long', 'short',
  'unsigned', 'signed', 'const', 'static', 'volatile', 'true', 'false',
  'if', 'else', 'while', 'do', 'for', 'return', 'break', 'continue',
  'switch', 'case', 'default', 'HIGH', 'LOW', 'INPUT', 'OUTPUT',
  'INPUT_PULLUP', 'true', 'false',
  'class', 'public', 'private', 'protected',
  'uint8_t', 'int8_t', 'uint16_t', 'int16_t', 'uint32_t', 'int32_t',
]);

/** Longest-first so that `<=` never lexes as `<` then `=`. */
const PUNCTUATION = [
  '<<=', '>>=', '...',
  '==', '!=', '<=', '>=', '&&', '||', '++', '--', '+=', '-=', '*=', '/=',
  '%=', '&=', '|=', '^=', '<<', '>>', '->', '::',
  '{', '}', '(', ')', '[', ']', ';', ',', '.', '+', '-', '*', '/', '%',
  '=', '<', '>', '!', '~', '&', '|', '^', '?', ':', '#',
];

export function tokenize(source: string, file = 'main.ino'): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  let line = 1;
  let column = 1;

  const here = (): SourceLocation => ({ line, column });

  const advance = (count: number) => {
    for (let i = 0; i < count; i++) {
      if (source[index] === '\n') {
        line++;
        column = 1;
      } else {
        column++;
      }
      index++;
    }
  };

  while (index < source.length) {
    const char = source[index];

    if (char === ' ' || char === '\t' || char === '\r' || char === '\n') {
      advance(1);
      continue;
    }

    if (char === '/' && source[index + 1] === '/') {
      while (index < source.length && source[index] !== '\n') advance(1);
      continue;
    }

    if (char === '/' && source[index + 1] === '*') {
      advance(2);
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        advance(1);
      }
      advance(2);
      continue;
    }

    const location = here();

    if (char === '#') {
      // Preprocessor lines are kept as a single token; the parser reads the
      // directive name out of the text and only acts on #define.
      while (index < source.length && source[index] !== '\n') advance(1);
      tokens.push({ kind: 'directive', text: source.slice(locationOffset(source, location), index), location });
      continue;
    }

    if (char === '"') {
      advance(1);
      let text = '';
      while (index < source.length && source[index] !== '"') {
        if (source[index] === '\\') {
          const next = source[index + 1];
          text += next === 'n' ? '\n' : next === 't' ? '\t' : next === '\\' ? '\\' : next;
          advance(2);
          continue;
        }
        text += source[index];
        advance(1);
      }
      advance(1);
      tokens.push({ kind: 'string', text, location });
      continue;
    }

    if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(source[index + 1] ?? ''))) {
      let text = '';
      while (index < source.length && /[0-9a-fA-FxX.]/.test(source[index])) {
        text += source[index];
        advance(1);
      }
      if (source[index] === 'e' || source[index] === 'E') {
        text += source[index];
        advance(1);
        if (source[index] === '+' || source[index] === '-') {
          text += source[index];
          advance(1);
        }
        while (index < source.length && /[0-9]/.test(source[index])) {
          text += source[index];
          advance(1);
        }
      }
      /*
       * Integer suffixes (`1000L`, `60UL`): glued to the literal the way C
       * spells them, so the suffix never lexes as a stray identifier. Only
       * immediately adjacent letters count -- `1000 L` stays two tokens, as
       * it is not one literal. `f`/`F` stay out of hex for the reason below.
       */
      while (index < source.length && /[uUlL]/.test(source[index] ?? '')) {
        text += source[index];
        advance(1);
      }

      const isHex = /^0[xX]/.test(text);
      let value = Number(text);
      // `f` is a float suffix in C -- but only for decimal literals. Stripping it
      // from a hex one silently turns 0xAF into 0xA and 0xFF into 0xF, which
      // would corrupt every display constant that happens to end in a nibble of
      // F rather than fail loudly. Integer suffixes strip from either base.
      if (!isHex && /[uUlLfF]+$/.test(text)) {
        value = Number(text.replace(/[uUlLfF]+$/, ''));
      } else if (isHex && /[uUlL]+$/.test(text)) {
        value = Number(text.replace(/[uUlL]+$/, ''));
      }
      if (Number.isNaN(value)) value = 0;
      tokens.push({ kind: 'number', text, value, location });
      continue;
    }

    if (/[A-Za-z_]/.test(char)) {
      let text = '';
      while (index < source.length && /[A-Za-z0-9_]/.test(source[index])) {
        text += source[index];
        advance(1);
      }
      tokens.push({
        kind: KEYWORDS.has(text) ? 'keyword' : 'identifier',
        text,
        location,
      });
      continue;
    }

    const punctuation = PUNCTUATION.find((candidate) => source.startsWith(candidate, index));
    if (punctuation) {
      advance(punctuation.length);
      tokens.push({ kind: 'punctuation', text: punctuation, location });
      continue;
    }

    throw new FirmwareSyntaxError(`unexpected character '${char}'`, location, file);
  }

  tokens.push({ kind: 'eof', text: '', location: here() });
  return tokens;
}

/** Rebuilds a source offset from a line/column pair for directive capture. */
function locationOffset(source: string, location: SourceLocation): number {
  let offset = 0;
  let line = 1;

  while (line < location.line) {
    const next = source.indexOf('\n', offset);
    if (next < 0) return offset;
    offset = next + 1;
    line++;
  }
  return offset + location.column - 1;
}

// ---------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------

export type Expr =
  | { kind: 'number'; value: number; location: SourceLocation }
  | { kind: 'string'; value: string; location: SourceLocation }
  | { kind: 'boolean'; value: boolean; location: SourceLocation }
  | { kind: 'identifier'; name: string; location: SourceLocation }
  | { kind: 'unary'; operator: string; operand: Expr; location: SourceLocation }
  | { kind: 'binary'; operator: string; left: Expr; right: Expr; location: SourceLocation }
  | { kind: 'assign'; target: Expr; operator: string; value: Expr; location: SourceLocation }
  | { kind: 'ternary'; condition: Expr; whenTrue: Expr; whenFalse: Expr; location: SourceLocation }
  | { kind: 'call'; callee: Expr; args: Expr[]; location: SourceLocation }
  | { kind: 'index'; target: Expr; index: Expr; location: SourceLocation }
  | { kind: 'member'; target: Expr; member: string; location: SourceLocation };

export type Stmt =
  | { kind: 'varDecl'; name: string; init: Expr | null; location: SourceLocation }
  | { kind: 'arrayDecl'; name: string; size: number; init: Expr[] | null; location: SourceLocation }
  | { kind: 'expression'; value: Expr; location: SourceLocation }
  | {
      kind: 'instanceDecl';
      className: string;
      name: string;
      /** Constructor arguments (`Button btn(2)`), empty for default construction. */
      args: Expr[];
      location: SourceLocation;
    }
  | { kind: 'if'; condition: Expr; then: Stmt; otherwise: Stmt | null; location: SourceLocation }  | { kind: 'while'; condition: Expr; body: Stmt; location: SourceLocation }
  | { kind: 'doWhile'; body: Stmt; condition: Expr; location: SourceLocation }
  | { kind: 'for'; init: Stmt | null; condition: Expr | null; update: Expr | null; body: Stmt; location: SourceLocation }
  /**
   * A `switch` with `case` labels and an optional `default`.
   *
   * A null test is `default`; bodies fall through to the next case the way C
   * runs them, and `break` leaves the switch rather than any enclosing loop.
   */
  | { kind: 'switch'; value: Expr; cases: { test: Expr | null; body: Stmt[] }[]; location: SourceLocation }
  | { kind: 'return'; value: Expr | null; location: SourceLocation }
  | { kind: 'break'; location: SourceLocation }
  | { kind: 'continue'; location: SourceLocation }
  | { kind: 'block'; statements: Stmt[]; location: SourceLocation }
  | { kind: 'empty'; location: SourceLocation }
  /**
   * A run of statements that is not a scope.
   *
   * C's braces open a scope and Python's indentation does not -- only `def`
   * does -- so the two grammars need different nodes here. A Python `while` or
   * `if` body that opened a scope would lose every assignment it made, because
   * the name would be bound somewhere the rest of the program cannot see.
   */
  | { kind: 'suite'; statements: Stmt[]; location: SourceLocation };

export interface FunctionDecl {
  readonly name: string;
  readonly returnType: string;
  readonly parameters: ReadonlyArray<{ name: string; type: string; defaultValue?: Expr }>;
  /** Constructor initializer list (`: _pin(pin)`); absent on plain functions. */
  readonly initList?: ReadonlyArray<{ field: string; value: Expr }>;
  readonly body: Stmt;
  readonly location: SourceLocation;
}

export interface ClassDecl {
  readonly name: string;
  readonly fields: { readonly name: string; readonly type: string; readonly init?: Expr }[];
  readonly methods: Map<string, FunctionDecl>;
  readonly location: SourceLocation;
}

export interface Program {
  readonly defines: ReadonlyMap<string, number>;
  /**
   * Expression defines (`#define MINUTE 60 * 1000L`): kept as syntax and
   * evaluated where used, because their value is a computation rather than a
   * literal. The `defines` map still records 0 for the name, so a lookup of
   * the map alone keeps its long-standing answer.
   */
  readonly macros: ReadonlyMap<string, Expr>;
  readonly globals: readonly Stmt[];
  readonly functions: ReadonlyMap<string, FunctionDecl>;
  readonly classes: Map<string, ClassDecl>;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/** Type keywords that may precede a declarator, longest match first. */
/**
 * The type keywords the language accepts in a declaration.
 *
 * `byte` is Arduino's own name for an unsigned 8-bit value, and a sketch
 * reading an I2C register gets one back from `Wire.read` whether it asked for
 * a `byte` or not -- so rejecting the word would reject correct code over a
 * spelling rather than over anything the VM does differently.
 */
const TYPE_KEYWORDS = [
  'unsigned long', 'unsigned', 'signed', 'long long', 'long', 'short',
  'void', 'int', 'float', 'double', 'bool', 'char', 'byte',
  'const', 'static', 'volatile',
  'uint8_t', 'int8_t', 'uint16_t', 'int16_t', 'uint32_t', 'int32_t',
];

class Parser {
  private position = 0;
  private readonly tokens: Token[];
  private readonly file: string;
  /**
   * File-scope enum names seen so far (`AlarmState`): a global or local that
   * names one binds a value rather than building a class instance.
   */
  private readonly enumNames = new Set<string>();

  constructor(tokens: Token[], file = 'main.ino') {
    this.tokens = tokens;
    this.file = file;
  }
  parseProgram(): Program {
    const defines = new Map<string, number>();
    const macros = new Map<string, Expr>();
    const globals: Stmt[] = [];
    const functions = new Map<string, FunctionDecl>();
    const classes = new Map<string, ClassDecl>();

    while (!this.at('eof')) {
      if (this.peek().kind === 'directive') {
        this.consumeDefine(defines, macros);
        continue;
      }

      if (this.atPunctuation(';')) {
        this.next();
        continue;
      }

      /*
       * A file-scope enum (`enum AlarmState { ALARM_OFF, ... };`): each
       * enumerator folds to its number in the defines table, so uses read as
       * ordinary constants. Explicit values (`A = 3`) hold; the rest count up
       * from zero or from the last explicit one, as C numbers them.
       */
      if (this.peek().kind === 'identifier' && this.peek().text === 'enum' && this.peek(1).kind === 'identifier') {
        this.next();
        this.enumNames.add(this.next().text);
        this.expectPunctuation('{');
        let nextValue = 0;
        for (;;) {
          if (this.acceptPunctuation('}')) break;
          const member = this.expectIdentifier().text;
          if (this.acceptPunctuation('=')) {
            const negative = this.acceptPunctuation('-');
            const literal = this.expect('number');
            nextValue = (literal.value ?? 0) * (negative ? -1 : 1);
          }
          defines.set(member, nextValue);
          nextValue++;
          if (!this.acceptPunctuation(',')) {
            this.expectPunctuation('}');
            break;
          }
        }
        this.acceptPunctuation(';');
        continue;
      }

      if (this.peek().kind === 'keyword' && this.peek().text === 'class') {
        const classLocation = this.peek().location;
        this.next();
        const className = this.expectIdentifier().text;
        this.expectPunctuation('{');
        const fields: { name: string; type: string; init?: Expr }[] = [];
        const methods = new Map<string, FunctionDecl>();
        let section = 'private';
        while (!this.atPunctuation('}')) {
          if (this.at('eof')) {
            throw new FirmwareSyntaxError('unclosed class', classLocation, this.file);
          }
          if (this.peek().kind === 'keyword' && (this.peek().text === 'public' || this.peek().text === 'private' || this.peek().text === 'protected')) {
            section = this.next().text;
            this.expectPunctuation(':');
            continue;
          }
          /*
           * Conditional compilation inside a class (`#if USE_RTC` around a
           * member): both branches stay, the way inert directives behave at
           * file scope. The guarded members parse as ordinary declarations;
           * a duplicate name keeps its first field slot and one shared value.
           */
          if (this.peek().kind === 'directive' && CONDITIONAL_DIRECTIVE.test(this.peek().text)) {
            this.next();
            continue;
          }
          const loc = this.peek().location;
          // A constructor names the class and has no return type.
          let returnType = '';
          let memberName: string;
          if (this.peek().kind === 'identifier' && this.peek().text === className && this.tokens[this.position + 1]?.text === '(') {
            memberName = this.next().text;
          } else {
            returnType = this.readType();
            memberName = this.expectIdentifier().text;
          }
          if (this.atPunctuation('(')) {
            this.expectPunctuation('(');
            const parameters: { name: string; type: string; defaultValue?: Expr }[] = [];
            if (!this.atPunctuation(')')) {
              do {
                const ptype = this.readType();
                // Default args (`uint16_t ms = 100`): kept so the runtime can
                // bind them when the call site omits the argument.
                const pname = this.expectIdentifier().text;
                const defaultValue = this.acceptPunctuation('=') ? this.readExpression() : undefined;
                parameters.push({ name: pname, type: ptype, defaultValue });
              } while (this.acceptPunctuation(','));
            }
            this.expectPunctuation(')');
            // Constructor initializer list (`: _pin(pin)`): kept for the
            // runtime; anything else meets `{` or `;` next and reads empty.
            const initList = this.readInitializerList();
            if (this.atPunctuation(';')) {
              this.next();
              methods.set(memberName, { name: memberName, returnType, parameters, initList, body: { kind: 'block', statements: [], location: loc }, location: loc });
              continue;
            }
            this.expectPunctuation('{');
            const body = this.readBlock();
            methods.set(memberName, { name: memberName, returnType, parameters, initList, body, location: loc });
          } else {
            // Field, possibly `static const bool PRESSED = LOW;` — the init
            // is kept so the runtime can seed static consts from it.
            const init = this.acceptPunctuation('=') ? this.readExpression() : undefined;
            // Array field `uint16_t TONES[2];` shape (deduced `[]` tolerated
            // the same way locals are; only the name and type are kept).
            if (this.acceptPunctuation('[')) {
              if (!this.acceptPunctuation(']')) {
                this.expect('number');
                this.expectPunctuation(']');
              }
            }
            this.expectPunctuation(';');
            void section;
            fields.push({ name: memberName, type: returnType, init });
          }
        }
        this.expectPunctuation('}');
        this.acceptPunctuation(';');
        classes.set(className, { name: className, fields, methods, location: classLocation });
        continue;
      }

      // An out-of-line constructor (`Counter::Counter() {...}`) has no return
      // type, so it starts with an identifier where `readType` expects a
      // keyword. Typed definitions (`int Counter::bump()`) go through the
      // normal path below, which folds `::` into the function name.
      if (this.peek().kind === 'identifier' && this.peek(1).text === '::') {
        const qualifier = this.next().text;
        const qualifiedLocation = this.peek().location;
        this.expectPunctuation('::');
        const memberName = this.expectIdentifier().text;
        const qualified = `${qualifier}::${memberName}`;
        this.expectPunctuation('(');
        const parameters: { name: string; type: string; defaultValue?: Expr }[] = [];
        if (!this.atPunctuation(')')) {
          do {
            const ptype = this.readType();
            const pname = this.expectIdentifier().text;
            const defaultValue = this.acceptPunctuation('=') ? this.readExpression() : undefined;
            parameters.push({ name: pname, type: ptype, defaultValue });
          } while (this.acceptPunctuation(','));
        }
        this.expectPunctuation(')');
        const initList = this.readInitializerList();
        if (this.atPunctuation(';')) {
          this.next();
          functions.set(qualified, { name: qualified, returnType: '', parameters, initList, body: { kind: 'block', statements: [], location: qualifiedLocation }, location: qualifiedLocation });
          continue;
        }
        this.expectPunctuation('{');
        const body = this.readBlock();
        functions.set(qualified, { name: qualified, returnType: '', parameters, initList, body, location: qualifiedLocation });
        continue;
      }

      // A class-typed global (`Counter c;`, `Button btn(pin);`): the type is a
      // class name rather than a keyword type, so `readType` cannot read it.
      // The class may live in another tab, so any `Type name` shape is
      // accepted here; an unknown class builds an empty instance at runtime.
      if (this.peek().kind === 'identifier' && this.peek(1).kind === 'identifier') {
        /*
         * An out-of-line definition with an identifier return type
         * (`DateTime Clock::now()`): the `::` after the second name says this
         * is a function, not a global. Keyword return types (`void
         * Clock::begin`) never reach here; they parse through `readType`.
         */
        if (this.peek(2).kind === 'punctuation' && this.peek(2).text === '::') {
          const qualifiedLocation = this.peek().location;
          const returnType = this.next().text;
          const qualifier = this.next().text;
          this.expectPunctuation('::');
          const memberName = this.expectIdentifier().text;
          const qualified = `${qualifier}::${memberName}`;
          this.expectPunctuation('(');
          const parameters: { name: string; type: string }[] = [];
          if (!this.atPunctuation(')')) {
            do {
              const type = this.readType();
              parameters.push({ name: this.expectIdentifier().text, type });
            } while (this.acceptPunctuation(','));
          }
          this.expectPunctuation(')');
          this.expectPunctuation('{');
          const body = this.readBlock();
          functions.set(qualified, { name: qualified, returnType, parameters, body, location: qualifiedLocation });
          continue;
        }
        /*
         * A value-typed global (`DisplayState displayState = DisplayClock;`,
         * `DateTime when = clock.now();`): binds a value like a variable
         * rather than building a class instance.
         */
        if (
          this.peek().text === 'DateTime' || this.peek().text === 'TimeSpan' ||
          this.peek().text === 'auto' || this.enumNames.has(this.peek().text)
        ) {
          globals.push(this.readValueBinding());
          continue;
        }
        const instanceLocation = this.peek().location;
        const className = this.next().text;
        const instanceName = this.expectIdentifier().text;
        const args: Expr[] = [];
        if (this.acceptPunctuation('(')) {
          if (!this.atPunctuation(')')) {
            do {
              args.push(this.readExpression());
            } while (this.acceptPunctuation(','));
          }
          this.expectPunctuation(')');
        }
        this.expectPunctuation(';');
        globals.push({ kind: 'instanceDecl', className, name: instanceName, args, location: instanceLocation });
        continue;
      }

      const location = this.peek().location;
      const returnType = this.readType();
      const name = this.expectIdentifier().text;

      // An out-of-line definition (`int Counter::bump() {...}`): the `::`
      // stays part of the function name here; `fromProject` and the runtime
      // init file it back under its class.
      let functionName = name;
      if (this.acceptPunctuation('::')) {
        functionName = `${name}::${this.expectIdentifier().text}`;
      }

      // A type followed by a name but no parameter list is a global variable,
      // not a function. Sketches declare these constantly -- counters, buffers
      // and configuration structs live at file scope.
      if (!this.atPunctuation('(')) {
        globals.push(...this.readGlobalDeclarators(name, location));
        continue;
      }
      this.expectPunctuation('(');

      const parameters: { name: string; type: string }[] = [];
      if (!this.atPunctuation(')')) {
        do {
          const type = this.readType();
          parameters.push({ name: this.expectIdentifier().text, type });
        } while (this.acceptPunctuation(','));
      }
      this.expectPunctuation(')');
      this.expectPunctuation('{');

      const body = this.readBlock();
      functions.set(functionName, { name: functionName, returnType, parameters, body, location });
    }

    return { defines, macros, globals, functions, classes };
  }

  /**
   * Reads a constructor initializer list (`: _pin(pin), _delay(ms)`).
   *
   * Shared by in-class constructors and out-of-line `Class::Class`
   * definitions: the runtime binds each entry after the parameters, which is
   * what carries the constructor arguments into the fields when the body
   * itself is empty. Anything else meets `{` or `;` next and reads empty.
   */
  private readInitializerList(): Array<{ field: string; value: Expr }> {
    const entries: Array<{ field: string; value: Expr }> = [];
    if (!this.acceptPunctuation(':')) return entries;
    do {
      const field = this.expectIdentifier().text;
      this.expectPunctuation('(');
      const value = this.readExpression();
      this.expectPunctuation(')');
      entries.push({ field, value });
    } while (this.acceptPunctuation(','));
    return entries;
  }

  /**
   * Reads a value binding (`DisplayState s = DisplayClock;`,
   * `DateTime now = clock.now();`, `auto alarm = alarmTime();`).
   *
   * Three shapes, matching what value types need: copy-initialisation with
   * `=`, direct-initialisation with `(args)` (a construction call, except
   * that `auto x(v)` unwraps its single argument), and a bare declaration,
   * which constructs a default `DateTime`/`TimeSpan` and binds zero for
   * anything else. Callers decide where the resulting `varDecl` lives.
   */
  private readValueBinding(): Stmt {
    const location = this.peek().location;
    const typeName = this.next().text;
    const name = this.expectIdentifier().text;
    let init: Expr | null = null;
    if (this.acceptPunctuation('(')) {
      const args: Expr[] = [];
      if (!this.atPunctuation(')')) {
        do {
          args.push(this.readExpression());
        } while (this.acceptPunctuation(','));
      }
      this.expectPunctuation(')');
      const sole = args.length === 1 ? args[0] : undefined;
      init =
        sole !== undefined && typeName === 'auto'
          ? sole
          : { kind: 'call', callee: { kind: 'identifier', name: typeName, location }, args, location };
    } else if (this.acceptPunctuation('=')) {
      init = this.readExpression();
    } else if (typeName === 'DateTime' || typeName === 'TimeSpan') {
      init = { kind: 'call', callee: { kind: 'identifier', name: typeName, location }, args: [], location };
    }
    this.expectPunctuation(';');
    return { kind: 'varDecl', name, init, location };
  }

  /** Reads `int a = 1, b[4] = {1, 2, 3, 4};` into one declaration per name. */
  private readGlobalDeclarators(name: string, location: SourceLocation): Stmt[] {
    const declarations: Stmt[] = [];
    let current = name;

    for (;;) {
      if (this.acceptPunctuation('[')) {
        // A deduced size (`byte digitPins[] = {...}`) takes its length from
        // the braces, the way the SevSeg wiring tables spell it.
        let size = 0;
        let deduced = false;
        if (this.acceptPunctuation(']')) {
          deduced = true;
        } else {
          size = this.expect('number').value ?? 0;
          this.expectPunctuation(']');
        }
        const initialisers: Expr[] | null = [];
        if (this.acceptPunctuation('=')) {
          this.expectPunctuation('{');
          if (!this.atPunctuation('}')) {
            for (;;) {
              initialisers.push(this.readExpression());
              if (!this.acceptPunctuation(',')) break;
              // A trailing comma before the closing brace, the way the
              // library tabs spell their tables.
              if (this.atPunctuation('}')) break;
            }
          }
          this.expectPunctuation('}');
        }
        if (deduced) size = initialisers.length;
        declarations.push({
          kind: 'arrayDecl',
          name: current,
          size,
          init: initialisers,
          location,
        });
      } else {
        const init = this.acceptPunctuation('=') ? this.readExpression() : null;
        declarations.push({ kind: 'varDecl', name: current, init, location });
      }

      // Another declarator follows only if a comma does. Looking for a name
      // unconditionally would run off the end of every single declaration.
      if (!this.acceptPunctuation(',')) break;
      current = this.expectIdentifier().text;
    }

    this.expectPunctuation(';');
    return declarations;
  }
  /**
   * Reads `#define NAME value`.
   *
   * The value goes back through the real lexer rather than a second regex, so
   * a define holds exactly what the same literal would in code. A private
   * number pattern here once accepted only decimals, which meant
   * `#define OLED_ADDR 0x3C` quietly defined nothing -- and the sketch then
   * addressed the display at 0 with no error anywhere.
   *
   * `#include` and everything else stay inert: the VM supplies its own runtime,
   * so there is no header for them to reach into.
   */
  private consumeDefine(defines: Map<string, number>, macros: Map<string, Expr>): void {
    const token = this.next();
    const match = /^#\s*define\s+([A-Za-z_][A-Za-z0-9_]*)\s+(\S.*?)\s*$/.exec(token.text.trim());
    if (!match) return;
    const parts = tokenize(match[2], this.file).filter((part) => part.kind !== 'eof');
    // A lone literal (optionally signed) stays a plain number; anything longer
    // is syntax to evaluate where used rather than a prefix to guess from --
    // `60 * 1000L` starts with a number but means sixty thousand, not sixty.
    const [literal] =
      parts.length === 1
        ? parts
        : parts.length === 2 && parts[0].kind === 'punctuation' && parts[0].text === '-'
          ? [parts[1]]
          : [];
    const negative = parts.length === 2 && literal !== undefined;
    const magnitude = literal?.kind === 'number' ? literal.value : undefined;

    if (magnitude === undefined) {
      /*
       * Anything else -- a call, an expression, a bare name -- is kept as
       * syntax and evaluated where used, so `#define MINUTE 60 * 1000L`
       * reads 60000 and `#define TIMESPAN_DAY TimeSpan(1, 0, 0, 0)` builds a
       * day. Text that is not an expression at all stays inert. Either way
       * the defines map keeps 0 for the name, its long-standing answer for
       * a lookup of the map alone.
       */
      try {
        macros.set(match[1], parseExpression(match[2], this.file));
      } catch {
        // Not an expression either: the name simply resolves to zero.
      }
      defines.set(match[1], 0);
      return;
    }
    if (negative) {
      defines.set(match[1], -magnitude);
      return;
    }
    defines.set(match[1], magnitude);
  }

  private readType(): string {
    const first = this.peek();
    if (first.kind === 'keyword' && TYPE_KEYWORDS.includes(first.text)) {
      this.next();
      // Consume any further type keywords, e.g. `unsigned long x`.
      let type = first.text;
      while (this.peek().kind === 'keyword' && TYPE_KEYWORDS.includes(this.peek().text)) {
        type += ` ${this.next().text}`;
      }
      return type;
    }
    /*
     * An identifier naming a value type (`DisplayState`, `DateTime`,
     * `RTC_DS1307`): accepted only in the `Type name` shape, so an enum
     * parameter, a DateTime method result or an RTC member keeps its spelling
     * instead of erroring on the type. Anything else still reports the
     * expected type error below.
     */
    if (first.kind === 'identifier' && this.peek(1).kind === 'identifier') {
      return this.next().text;
    }
    throw new FirmwareSyntaxError(`expected a type, found '${first.text}'`, first.location, this.file);
  }

  private readBlock(): Stmt {
    const location = this.peek().location;
    const statements: Stmt[] = [];
    while (!this.atPunctuation('}')) {
      if (this.at('eof')) throw new FirmwareSyntaxError('unclosed block', location, this.file);
      statements.push(this.readStatement());
    }
    this.expectPunctuation('}');
    return { kind: 'block', statements, location };
  }

  private readStatement(): Stmt {
    const token = this.peek();

    if (this.atPunctuation('{')) {
      this.next();
      return this.readBlock();
    }
    if (this.acceptPunctuation(';')) return { kind: 'empty', location: token.location };
    /*
     * A conditional line inside a body (`#if USE_RTC`, `#else`, `#endif`):
     * consumed without a statement, so both branches parse and run the way
     * inert directives behave everywhere else.
     */
    if (token.kind === 'directive' && CONDITIONAL_DIRECTIVE.test(token.text)) {
      this.next();
      return { kind: 'empty', location: token.location };
    }

    if (token.kind === 'keyword') {
      switch (token.text) {
        case 'if':
          return this.readIf();
        case 'switch':
          return this.readSwitch();
        case 'while': {
          this.next();
          this.expectPunctuation('(');
          const condition = this.readExpression();
          this.expectPunctuation(')');
          return { kind: 'while', condition, body: this.readStatement(), location: token.location };
        }
        case 'do':
          return this.readDoWhile();
        case 'for':
          return this.readFor();
        case 'return': {
          this.next();
          /*
           * `return;` and `return x;` are both ordinary C, and the semicolon of
           * a bare return has to be consumed exactly once. Peeking for it and
           * then demanding it again made the simplest return statement in the
           * language a syntax error.
           */
          if (this.acceptPunctuation(';')) {
            return { kind: 'return', value: null, location: token.location };
          }
          const value = this.readExpression();
          if (!this.acceptPunctuation(';')) {
            throw new FirmwareSyntaxError("expected ';'", token.location, this.file);
          }
          return { kind: 'return', value, location: token.location };
        }
        case 'break':
          this.next();
          this.expectPunctuation(';');
          return { kind: 'break', location: token.location };
        case 'continue':
          this.next();
          this.expectPunctuation(';');
          return { kind: 'continue', location: token.location };
        default:
          break;
      }
    }

    if (this.startsDeclaration()) return this.readDeclaration();

    /*
     * A value-typed local (`DateTime now = _rtc.now();`,
     * `auto alarm = alarmTime();`): the type is an identifier the class
     * machinery would otherwise misread as a class name, so value types and
     * same-file enums bind here instead.
     */
    if (this.peek().kind === 'identifier' && this.peek(1).kind === 'identifier') {
      const typeName = this.peek().text;
      if (
        typeName === 'auto' || typeName === 'DateTime' || typeName === 'TimeSpan' ||
        this.enumNames.has(typeName)
      ) {
        return this.readValueBinding();
      }
    }

    const value = this.readExpression();
    this.expectPunctuation(';');
    return { kind: 'expression', value, location: token.location };
  }

  private startsDeclaration(): boolean {
    const token = this.peek();
    if (token.kind !== 'keyword') return false;
    if (!TYPE_KEYWORDS.includes(token.text)) return false;
    // `unsigned` alone is a type, but so is the start of `unsigned long`.
    return true;
  }

  private readDeclaration(): Stmt {
    const location = this.peek().location;
    this.readType();

    if (this.peek().kind === 'identifier' && this.tokens[this.position + 1]?.text === '[') {
      const name = this.next().text;
      this.expectPunctuation('[');
      // A deduced size (`byte digitPins[] = {...}`) takes its length from
      // the braces; without braces it sizes zero rather than erroring.
      let size = 0;
      let deduced = false;
      if (this.acceptPunctuation(']')) {
        deduced = true;
      } else {
        size = this.expect('number').value ?? 0;
        this.expectPunctuation(']');
      }

      const initialisers: Expr[] | null = [];
      if (this.acceptPunctuation('=')) {
        this.expectPunctuation('{');
        if (!this.atPunctuation('}')) {
          for (;;) {
            initialisers.push(this.readExpression());
            if (!this.acceptPunctuation(',')) break;
            // A trailing comma before the closing brace.
            if (this.atPunctuation('}')) break;
          }
        }
        this.expectPunctuation('}');
      }
      if (deduced) size = initialisers.length;
      this.expectPunctuation(';');
      return { kind: 'arrayDecl', name, size, init: initialisers, location };
    }

    const name = this.expectIdentifier().text;
    const init = this.acceptPunctuation('=') ? this.readExpression() : null;
    this.expectPunctuation(';');
    return { kind: 'varDecl', name, init, location };
  }

  private readIf(): Stmt {
    const location = this.peek().location;
    this.next();
    this.expectPunctuation('(');
    const condition = this.readExpression();
    this.expectPunctuation(')');

    const then = this.readStatement();
    let otherwise: Stmt | null = null;
    if (this.peek().kind === 'keyword' && this.peek().text === 'else') {
      this.next();
      otherwise = this.readStatement();
    }
    return { kind: 'if', condition, then, otherwise, location };
  }

  /**
   * Reads `switch (value) { case test: ...; default: ...; }`.
   *
   * Labels are full expressions, usually enumerators or numbers; each case
   * holds a run of statements that falls through into the next case unless a
   * `break` or `return` leaves first. A `default` without a match runs from
   * its own position, the way C enters the switch at the label.
   */
  private readSwitch(): Stmt {
    const location = this.peek().location;
    this.next();
    this.expectPunctuation('(');
    const value = this.readExpression();
    this.expectPunctuation(')');
    this.expectPunctuation('{');
    const cases: { test: Expr | null; body: Stmt[] }[] = [];
    while (!this.atPunctuation('}')) {
      if (this.at('eof')) throw new FirmwareSyntaxError('unclosed switch', location, this.file);
      let test: Expr | null = null;
      if (this.peek().kind === 'keyword' && this.peek().text === 'case') {
        this.next();
        test = this.readExpression();
        this.expectPunctuation(':');
      } else if (this.peek().kind === 'keyword' && this.peek().text === 'default') {
        this.next();
        this.expectPunctuation(':');
      } else {
        throw new FirmwareSyntaxError(
          `expected 'case' or 'default', found '${this.peek().text}'`,
          this.peek().location,
          this.file,
        );
      }
      const body: Stmt[] = [];
      while (
        !this.atPunctuation('}') &&
        !(this.peek().kind === 'keyword' && (this.peek().text === 'case' || this.peek().text === 'default'))
      ) {
        if (this.at('eof')) throw new FirmwareSyntaxError('unclosed switch', location, this.file);
        body.push(this.readStatement());
      }
      cases.push({ test, body });
    }
    this.expectPunctuation('}');
    return { kind: 'switch', value, cases, location };
  }

  private readDoWhile(): Stmt {
    const location = this.peek().location;
    this.next();
    const body = this.readStatement();
    if (!(this.peek().kind === 'keyword' && this.peek().text === 'while')) {
      throw new FirmwareSyntaxError("expected 'while'", this.peek().location, this.file);
    }
    this.next();
    this.expectPunctuation('(');
    const condition = this.readExpression();
    this.expectPunctuation(')');
    this.expectPunctuation(';');
    return { kind: 'doWhile', body, condition, location };
  }

  private readFor(): Stmt {
    const location = this.peek().location;
    this.next();
    this.expectPunctuation('(');

    let init: Stmt | null = null;
    if (this.atPunctuation(';')) {
      this.next();
    } else if (this.startsDeclaration()) {
      init = this.readDeclaration();
    } else {
      init = { kind: 'expression', value: this.readExpression(), location };
      this.expectPunctuation(';');
    }

    const condition = this.atPunctuation(';') ? null : this.readExpression();
    this.expectPunctuation(';');

    const update = this.atPunctuation(')') ? null : this.readExpression();
    this.expectPunctuation(')');

    return { kind: 'for', init, condition, update, body: this.readStatement(), location };
  }

  // -- expressions ---------------------------------------------------------
  // Precedence climbing, lowest binding first.

  /**
   * Reads one expression and requires the end of input: the entry point for
   * parsing a `#define` body as syntax rather than lexing a literal from it.
   */
  expression(): Expr {
    const value = this.readExpression();
    if (!this.at('eof')) {
      throw new FirmwareSyntaxError(`unexpected '${this.peek().text}'`, this.peek().location, this.file);
    }
    return value;
  }

  private readExpression(): Expr {
    return this.readAssignment();
  }

  private readAssignment(): Expr {
    const target = this.readTernary();
    const operator = ASSIGN_OPERATORS.find((candidate) => this.atPunctuation(candidate));
    if (!operator) return target;

    this.next();
    const value = this.readAssignment();
    return { kind: 'assign', target, operator, value, location: target.location };
  }

  private readTernary(): Expr {
    const condition = this.readBinary(0);
    if (!this.atPunctuation('?')) return condition;
    this.next();
    const whenTrue = this.readAssignment();
    this.expectPunctuation(':');
    const whenFalse = this.readAssignment();
    return { kind: 'ternary', condition, whenTrue, whenFalse, location: condition.location };
  }

  private readBinary(minimumPrecedence: number): Expr {
    let left = this.readUnary();
    for (;;) {
      const token = this.peek();
      const precedence = BINARY_PRECEDENCE[token.text];
      if (token.kind !== 'punctuation' || precedence === undefined) break;
      if (precedence < minimumPrecedence) break;

      this.next();
      const right = this.readBinary(precedence + 1);
      left = { kind: 'binary', operator: token.text, left, right, location: token.location };
    }
    return left;
  }

  private readUnary(): Expr {
    const token = this.peek();
    if (token.kind === 'punctuation' && ['-', '+', '!', '~', '*', '&'].includes(token.text)) {
      this.next();
      return { kind: 'unary', operator: token.text, operand: this.readUnary(), location: token.location };
    }
    if (token.kind === 'punctuation' && (token.text === '++' || token.text === '--')) {
      this.next();
      const operand = this.readUnary();
      return {
        kind: 'assign',
        target: operand,
        operator: token.text,
        value: { kind: 'number', value: 1, location: token.location },
        location: token.location,
      };
    }
    return this.readPostfix();
  }

  private readPostfix(): Expr {
    let expression = this.readPrimary();
    for (;;) {
      // Call syntax lives here rather than in readPrimary so that arguments
      // parse as full expressions: `pinMode(2, OUTPUT)` and `map(x, 0, 1, 0, 9)`
      // both need that, and every Arduino API call goes through it.
      if (this.atPunctuation('(')) {
        this.next();
        const args: Expr[] = [];
        if (!this.atPunctuation(')')) {
          do {
            args.push(this.readExpression());
          } while (this.acceptPunctuation(','));
        }
        this.expectPunctuation(')');
        expression = { kind: 'call', callee: expression, args, location: expression.location };
        continue;
      }
      if (this.acceptPunctuation('[')) {
        const index = this.readExpression();
        this.expectPunctuation(']');
        expression = { kind: 'index', target: expression, index, location: expression.location };
        continue;
      }
      if (this.acceptPunctuation('.')) {
        const member = this.expectIdentifier().text;
        expression = { kind: 'member', target: expression, member, location: expression.location };
        continue;
      }
      if (this.acceptPunctuation('::')) {
        // `Button::RELEASED`: scope resolution reads like member access; the
        // interpreter resolves class names through the class table.
        const member = this.expectIdentifier().text;
        expression = { kind: 'member', target: expression, member, location: expression.location };
        continue;
      }
      if (this.atPunctuation('++') || this.atPunctuation('--')) {
        const operator = this.next().text;
        expression = {
          kind: 'assign',
          target: expression,
          operator: operator,
          value: { kind: 'number', value: 1, location: expression.location },
          location: expression.location,
        };
        continue;
      }
      return expression;
    }
  }

  private readPrimary(): Expr {
    const token = this.next();

    if (token.kind === 'number') {
      return { kind: 'number', value: token.value ?? 0, location: token.location };
    }
    if (token.kind === 'string') {
      return { kind: 'string', value: token.text, location: token.location };
    }
    if (token.kind === 'keyword') {
      if (token.text === 'true') return { kind: 'boolean', value: true, location: token.location };
      if (token.text === 'false') return { kind: 'boolean', value: false, location: token.location };
      // HIGH, LOW, INPUT, OUTPUT and INPUT_PULLUP lex as keywords but behave
      // exactly like named constants, which is how the interpreter binds them.
      if (token.text === 'HIGH' || token.text === 'LOW' || token.text === 'INPUT' ||
          token.text === 'OUTPUT' || token.text === 'INPUT_PULLUP') {
        return { kind: 'identifier', name: token.text, location: token.location };
      }
    }
    if (token.kind === 'identifier') {
      return { kind: 'identifier', name: token.text, location: token.location };
    }
    if (token.kind === 'punctuation' && token.text === '(') {
      const inner = this.readExpression();
      this.expectPunctuation(')');
      return inner;
    }

    throw new FirmwareSyntaxError(`unexpected '${token.text}'`, token.location, this.file);
  }

  // -- token helpers -------------------------------------------------------

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.position + offset, this.tokens.length - 1)];
  }

  private at(kind: TokenKind): boolean {
    return this.peek().kind === kind;
  }

  private atPunctuation(text: string): boolean {
    const token = this.peek();
    return token.kind === 'punctuation' && token.text === text;
  }

  private next(): Token {
    return this.tokens[Math.min(this.position++, this.tokens.length - 1)];
  }

  private expect(kind: TokenKind): Token {
    const token = this.next();
    if (token.kind !== kind) {
      throw new FirmwareSyntaxError(`expected ${kind}, found '${token.text}'`, token.location, this.file);
    }
    return token;
  }

  private expectIdentifier(): Token {
    return this.expect('identifier');
  }

  private expectPunctuation(text: string): void {
    if (!this.acceptPunctuation(text)) {
      throw new FirmwareSyntaxError(`expected '${text}', found '${this.peek().text}'`, this.peek().location, this.file);
    }
  }

  private acceptPunctuation(text: string): boolean {
    if (!this.atPunctuation(text)) return false;
    this.next();
    return true;
  }
}

const ASSIGN_OPERATORS = ['+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=', '='];

/** Higher binds tighter. `=` is absent on purpose: assignment is handled separately. */
const BINARY_PRECEDENCE: Readonly<Record<string, number>> = {
  '||': 1,
  '&&': 2,
  '|': 3,
  '^': 4,
  '&': 5,
  '==': 6, '!=': 6,
  '<': 7, '>': 7, '<=': 7, '>=': 7,
  '<<': 8, '>>': 8,
  '+': 9, '-': 9,
  '*': 10, '/': 10, '%': 10,
};

export function parseFirmware(source: string, file = 'main.ino'): Program {
  return new Parser(tokenize(source, file), file).parseProgram();
}

/**
 * Parses one expression (`60 * 1000L`, `TimeSpan(1, 0, 0, 0)`): how a
 * `#define` body that is not a single literal is kept for evaluation where
 * it is used. Throws a syntax error when the text is not an expression.
 */
export function parseExpression(source: string, file = 'main.ino'): Expr {
  return new Parser(tokenize(source, file), file).expression();
}

/**
 * Preprocessor conditionals the parser treats as inert rather than as code:
 * both branches stay and run, the way every other directive already behaves.
 * Include guards never reach here (file scope consumes all directives), so
 * this only meets `#if` shapes nested inside classes and function bodies.
 */
const CONDITIONAL_DIRECTIVE = /^#\s*(ifdef|ifndef|elif|else|endif|if)\b/;