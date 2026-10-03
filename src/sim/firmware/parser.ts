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

  constructor(message: string, location: SourceLocation) {
    super(`${message} (line ${location.line}, column ${location.column})`);
    this.name = 'FirmwareSyntaxError';
    this.location = location;
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
]);

/** Longest-first so that `<=` never lexes as `<` then `=`. */
const PUNCTUATION = [
  '<<=', '>>=', '...',
  '==', '!=', '<=', '>=', '&&', '||', '++', '--', '+=', '-=', '*=', '/=',
  '%=', '&=', '|=', '^=', '<<', '>>', '->', '::',
  '{', '}', '(', ')', '[', ']', ';', ',', '.', '+', '-', '*', '/', '%',
  '=', '<', '>', '!', '~', '&', '|', '^', '?', ':', '#',
];

export function tokenize(source: string): Token[] {
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

      const isHex = /^0[xX]/.test(text);
      let value = Number(text);
      // `f` is a float suffix in C -- but only for decimal literals. Stripping it
      // from a hex one silently turns 0xAF into 0xA and 0xFF into 0xF, which
      // would corrupt every display constant that happens to end in a nibble of
      // F rather than fail loudly.
      if (!isHex && (text.endsWith('f') || text.endsWith('F'))) {
        value = Number(text.slice(0, -1));
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

    throw new FirmwareSyntaxError(`unexpected character '${char}'`, location);
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
  | { kind: 'if'; condition: Expr; then: Stmt; otherwise: Stmt | null; location: SourceLocation }
  | { kind: 'while'; condition: Expr; body: Stmt; location: SourceLocation }
  | { kind: 'doWhile'; body: Stmt; condition: Expr; location: SourceLocation }
  | { kind: 'for'; init: Stmt | null; condition: Expr | null; update: Expr | null; body: Stmt; location: SourceLocation }
  | { kind: 'return'; value: Expr | null; location: SourceLocation }
  | { kind: 'break'; location: SourceLocation }
  | { kind: 'continue'; location: SourceLocation }
  | { kind: 'block'; statements: Stmt[]; location: SourceLocation }
  | { kind: 'empty'; location: SourceLocation };

export interface FunctionDecl {
  readonly name: string;
  readonly returnType: string;
  readonly parameters: ReadonlyArray<{ name: string; type: string }>;
  readonly body: Stmt;
  readonly location: SourceLocation;
}

export interface Program {
  readonly defines: ReadonlyMap<string, number>;
  readonly globals: readonly Stmt[];
  readonly functions: ReadonlyMap<string, FunctionDecl>;
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
];

class Parser {
  private position = 0;
  private readonly tokens: Token[];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }
  parseProgram(): Program {
    const defines = new Map<string, number>();
    const globals: Stmt[] = [];
    const functions = new Map<string, FunctionDecl>();

    while (!this.at('eof')) {
      if (this.peek().kind === 'directive') {
        this.consumeDefine(defines);
        continue;
      }

      if (this.atPunctuation(';')) {
        this.next();
        continue;
      }

      const location = this.peek().location;
      const returnType = this.readType();
      const name = this.expectIdentifier().text;

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
      functions.set(name, { name, returnType, parameters, body, location });
    }

    return { defines, globals, functions };
  }

  /** Reads `int a = 1, b[4] = {1, 2, 3, 4};` into one declaration per name. */
  private readGlobalDeclarators(name: string, location: SourceLocation): Stmt[] {
    const declarations: Stmt[] = [];
    let current = name;

    for (;;) {
      if (this.acceptPunctuation('[')) {
        const sizeToken = this.expect('number');
        this.expectPunctuation(']');
        const initialisers: Expr[] | null = [];
        if (this.acceptPunctuation('=')) {
          this.expectPunctuation('{');
          if (!this.atPunctuation('}')) {
            do {
              initialisers.push(this.readExpression());
            } while (this.acceptPunctuation(','));
          }
          this.expectPunctuation('}');
        }
        declarations.push({
          kind: 'arrayDecl',
          name: current,
          size: sizeToken.value ?? 0,
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
  private consumeDefine(defines: Map<string, number>): void {
    const token = this.next();
    const match = /^#\s*define\s+([A-Za-z_][A-Za-z0-9_]*)\s+(\S.*?)\s*$/.exec(token.text.trim());
    if (!match) return;
    const parts = tokenize(match[2]).filter((part) => part.kind !== 'eof');
    const [sign, literal] =
      parts.length === 2 && parts[0].kind === 'punctuation' ? parts : [null, parts[0]];
    const magnitude = literal?.kind === 'number' ? literal.value : undefined;

    if (magnitude === undefined) {
      // Anything else -- a function call, an expression, a string -- resolves
      // to zero. The VM has no macro expander, and guessing at the first number
      // in `#define X (1 << 3)` would silently invent an 8.
      defines.set(match[1], 0);
      return;
    }
    if (sign?.kind === 'punctuation' && sign.text === '-') {
      defines.set(match[1], -magnitude);
      return;
    }
    defines.set(match[1], magnitude);
  }

  private readType(): string {
    const first = this.peek();
    if (first.kind !== 'keyword' || !TYPE_KEYWORDS.includes(first.text)) {
      throw new FirmwareSyntaxError(`expected a type, found '${first.text}'`, first.location);
    }
    this.next();
    // Consume any further type keywords, e.g. `unsigned long x`.
    let type = first.text;
    while (this.peek().kind === 'keyword' && TYPE_KEYWORDS.includes(this.peek().text)) {
      type += ` ${this.next().text}`;
    }
    return type;
  }

  private readBlock(): Stmt {
    const location = this.peek().location;
    const statements: Stmt[] = [];
    while (!this.atPunctuation('}')) {
      if (this.at('eof')) throw new FirmwareSyntaxError('unclosed block', location);
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

    if (token.kind === 'keyword') {
      switch (token.text) {
        case 'if':
          return this.readIf();
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
          const value = this.acceptPunctuation(';') ? null : this.readExpression();
          if (!this.acceptPunctuation(';')) throw new FirmwareSyntaxError("expected ';'", token.location);
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
      const sizeToken = this.expect('number');
      this.expectPunctuation(']');

      const initialisers: Expr[] | null = [];
      if (this.acceptPunctuation('=')) {
        this.expectPunctuation('{');
        if (!this.atPunctuation('}')) {
          do {
            initialisers.push(this.readExpression());
          } while (this.acceptPunctuation(','));
        }
        this.expectPunctuation('}');
      }
      this.expectPunctuation(';');
      return { kind: 'arrayDecl', name, size: sizeToken.value ?? 0, init: initialisers, location };
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

  private readDoWhile(): Stmt {
    const location = this.peek().location;
    this.next();
    const body = this.readStatement();
    if (!(this.peek().kind === 'keyword' && this.peek().text === 'while')) {
      throw new FirmwareSyntaxError("expected 'while'", this.peek().location);
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

    throw new FirmwareSyntaxError(`unexpected '${token.text}'`, token.location);
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
      throw new FirmwareSyntaxError(`expected ${kind}, found '${token.text}'`, token.location);
    }
    return token;
  }

  private expectIdentifier(): Token {
    return this.expect('identifier');
  }

  private expectPunctuation(text: string): void {
    if (!this.acceptPunctuation(text)) {
      throw new FirmwareSyntaxError(`expected '${text}', found '${this.peek().text}'`, this.peek().location);
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

export function parseFirmware(source: string): Program {
  return new Parser(tokenize(source)).parseProgram();
}