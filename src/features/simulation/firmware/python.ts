/**
 * A Python front end for the firmware VM.
 *
 * This is a second grammar over the AST in `parser.ts`, not a second virtual
 * machine. Everything below exists only to turn Python source into the same
 * `Program` the C parser produces, so the interpreter, the simulator behind it
 * and every test written against the VM keep working unchanged for both
 * languages. Two front ends and one VM is a great deal less to keep correct than
 * one front end and two runtimes.
 *
 * The subset is the one gpiozero actually uses: `def`, `if`/`elif`/`else`,
 * `while`, `for ... in range(...)`, assignment, the usual expressions, f-strings
 * and calls. It is indentation-sensitive, so the lexer's first job is turning
 * leading whitespace into explicit INDENT and DEDENT tokens -- without them
 * there is no way to know where a suite ends.
 *
 * Python's own spellings are normalised on the way through: `and`/`or`/`not`
 * become `&&`/`||`/`!`, `True`/`False` become boolean literals, and `None`
 * becomes zero. What reaches the VM is ordinary C-shaped AST, which is what
 * lets a single interpreter run both languages without knowing which it has.
 *
 * Classes, `try`, generators, comprehensions and imports are not here. They are
 * all about program structure rather than about wiring a circuit, which is the
 * same line the C grammar draws about pointers and templates.
 */

import {
  FirmwareSyntaxError,
  type ClassDecl,
  type Expr,
  type FunctionDecl,
  type KeywordArgument,
  type Program,
  type SourceLocation,
  type Stmt,
} from './parser';

export type PythonTokenKind =
  | 'number'
  | 'string'
  | 'bytes'
  | 'fstring'
  | 'identifier'
  | 'punctuation'
  | 'keyword'
  | 'newline'
  | 'indent'
  | 'dedent'
  | 'eof';

export interface PythonToken {
  readonly kind: PythonTokenKind;
  readonly text: string;
  readonly value?: number;
  readonly location: SourceLocation;
}

const KEYWORDS: ReadonlySet<string> = new Set([
  'and',
  'as',
  'assert',
  'break',
  'class',
  'continue',
  'def',
  'del',
  'elif',
  'else',
  'except',
  'finally',
  'for',
  'from',
  'global',
  'if',
  'import',
  'in',
  'is',
  'lambda',
  'nonlocal',
  'not',
  'or',
  'pass',
  'raise',
  'return',
  'try',
  'while',
  'with',
  'yield',
  'True',
  'False',
  'None',
]);

/** Longest first, so `<=` never lexes as `<` followed by `=`. */
const PUNCTUATION: ReadonlyArray<string> = [
  '**=',
  '//=',
  '>>=',
  '<<=',
  '**',
  '//',
  '==',
  '!=',
  '<=',
  '>=',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '&=',
  '|=',
  '^=',
  '<<',
  '>>',
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  ',',
  ':',
  '.',
  ';',
  '+',
  '-',
  '*',
  '/',
  '%',
  '=',
  '<',
  '>',
  '!',
  '~',
  '&',
  '|',
  '^',
  '@',
];

/** Higher binds tighter. `=` is absent on purpose: assignment is handled apart. */
const PRECEDENCE: Readonly<Record<string, number>> = {
  or: 1,
  and: 2,
  '|': 3,
  '^': 4,
  '&': 5,
  '==': 6,
  '!=': 6,
  '<': 7,
  '>': 7,
  '<=': 7,
  '>=': 7,
  '<<': 8,
  '>>': 8,
  '+': 9,
  '-': 9,
  '*': 10,
  '/': 10,
  '%': 10,
};

const ASSIGN_OPERATORS: ReadonlyArray<string> = [
  '=',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '&=',
  '|=',
  '^=',
  '<<=',
  '>>=',
];

const COMPARISON: ReadonlySet<string> = new Set(['==', '!=', '<', '>', '<=', '>=']);

/**
 * Python operators with no counterpart in the VM's expression language.
 *
 * `**` is exponentiation and `//` is floor division; the VM has neither, and
 * mapping them onto `^` and `/` would be arithmetic that is wrong in a way a
 * learner could not see. They lex, so the message can name them.
 */
const UNSUPPORTED_OPERATORS: ReadonlySet<string> = new Set(['**', '//', '**=', '//=']);

function numberValue(text: string): number {
  const clean = text.replace(/_/g, '');
  if (/^0[xX]/.test(clean)) return Number.parseInt(clean.slice(2), 16);
  if (/^0[oO]/.test(clean)) return Number.parseInt(clean.slice(2), 8);
  if (/^0[bB]/.test(clean)) return Number.parseInt(clean.slice(2), 2);
  return Number(clean);
}

function unescape(text: string): string {
  return text.replace(/\\x[0-9a-fA-F]{2}|\\(.)/gs, (match, escape: string) => {
    // A byte's own spelling: `\x00` is the byte, not the four characters.
    if (match.startsWith('\\x')) return String.fromCharCode(Number.parseInt(match.slice(2), 16));
    switch (escape) {
      case 'n':
        return '\n';
      case 't':
        return '\t';
      case 'r':
        return '\r';
      default:
        return escape;
    }
  });
}

interface StringLiteral {
  readonly body: string;
  readonly fstring: boolean;
  /** Index just past the closing quote. */
  readonly end: number;
}

/**
 * Reads one string literal starting at `start`, which must hold the quote.
 *
 * Triple-quoted strings are read whole. A single-quoted scan would stop at the
 * second quote of the run and then choke on the third, which is why the opener
 * is measured before anything is searched for.
 */
function readStringLiteral(source: string, start: number): StringLiteral {
  // An `f` prefix sits immediately before the opening quote. Only then is it a
  // prefix; in `af"x"` the `f` belongs to an identifier and this is a plain
  // string. Everything below measures from `start`, not from the prefix, so the
  // body does not come back including the quote it just consumed.
  const before = source[start - 1];
  const fstring =
    (before === 'f' || before === 'F') && !/[A-Za-z0-9_]/.test(source[start - 2] ?? '');

  const quote = source[start];
  const opener = source.startsWith(quote.repeat(3), start) ? quote.repeat(3) : quote;
  const contentStart = start + opener.length;
  /*
   * The closing quote is looked for one character at a time, because an
   * escaped quote is part of the string: `'it\\'s'` ends at the last quote,
   * and a plain `indexOf` would have ended it at the escaped one.
   */
  let end = contentStart;
  while (end < source.length) {
    if (source[end] === '\\') {
      end += 2;
      continue;
    }
    if (source.startsWith(opener, end)) break;
    end += 1;
  }
  if (end > source.length) end = source.length;

  return { body: unescape(source.slice(contentStart, end)), fstring, end: end + opener.length };
}

export function tokenizePython(source: string, file = 'main.py'): PythonToken[] {
  const tokens: PythonToken[] = [];
  /** The column each open suite starts at, innermost last. */
  const indents: number[] = [0];
  let index = 0;
  let line = 1;
  let column = 1;
  let atLineStart = true;
  /** How many brackets are open, which is what makes a newline continuation. */
  let depth = 0;

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

  const emit = (kind: PythonTokenKind, text: string, location: SourceLocation, value?: number) => {
    tokens.push({ kind, text, location, value });
  };

  const applyIndentation = (width: number, location: SourceLocation) => {
    while (width < indents[indents.length - 1]) {
      indents.pop();
      emit('dedent', '', location);
    }
    if (width > indents[indents.length - 1]) {
      indents.push(width);
      emit('indent', '', location);
    }
  };

  while (index < source.length) {
    if (atLineStart) {
      let width = 0;
      while (source[index] === ' ' || source[index] === '\t') {
        // A tab advances to the next multiple of eight, which is what makes a
        // file mixing tabs and spaces behave the way its author expected.
        width += source[index] === '\t' ? 8 - (width % 8) : 1;
        index++;
        column++;
      }

      // A blank or comment-only line carries no indentation and no statement,
      // so it must not open or close a suite. The two cases are handled apart:
      // skipping to the newline works for a comment, but on a blank line the
      // newline is the character being looked at, so it would step nowhere and
      // the lexer would spin on it forever.
      if (source[index] === '#') {
        while (source[index] !== '\n' && source[index] !== undefined) advance(1);
        continue;
      }
      if (source[index] === '\n' || source[index] === '\r') {
        advance(1);
        continue;
      }
      if (source[index] === undefined) break;

      applyIndentation(width, here());
      atLineStart = false;
      continue;
    }

    const char = source[index];

    if (char === '\r') {
      advance(1);
      continue;
    }

    if (char === '\n') {
      if (depth > 0) {
        advance(1);
        continue;
      }
      advance(1);
      emit('newline', '', here());
      atLineStart = true;
      continue;
    }

    if (char === ' ' || char === '\t') {
      advance(1);
      continue;
    }

    if (char === '#') {
      while (source[index] !== '\n' && source[index] !== undefined) advance(1);
      continue;
    }

    const location = here();

    // Checked before the identifier rule, which would otherwise take the `f`
    // for a name and leave the quote to start a string of its own.
    if (
      (char === 'f' || char === 'F') &&
      (source[index + 1] === '"' || source[index + 1] === "'")
    ) {
      const literal = readStringLiteral(source, index + 1);
      advance(literal.end - index);
      emit('fstring', literal.body, location);
      continue;
    }

    // Checked before the identifier rule, which would otherwise take the `b`
    // for a name and leave the quote to start a string of its own.
    if (
      (char === 'b' || char === 'B') &&
      (source[index + 1] === '"' || source[index + 1] === "'")
    ) {
      const literal = readStringLiteral(source, index + 1);
      advance(literal.end - index);
      emit('bytes', literal.body, location);
      continue;
    }

    if (char === '"' || char === "'") {
      const literal = readStringLiteral(source, index);
      advance(literal.end - index);
      emit(literal.fstring ? 'fstring' : 'string', literal.body, location);
      continue;
    }

    const number =
      /^(?:0[xX][0-9a-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|(?:\d[\d_]*)?\.?\d[\d_]*(?:[eE][+-]?\d+)?)/.exec(
        source.slice(index),
      );
    if (number && /\d/.test(number[0])) {
      advance(number[0].length);
      emit('number', number[0], location, numberValue(number[0]));
      continue;
    }

    const identifier = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(index));
    if (identifier) {
      advance(identifier[0].length);
      emit(KEYWORDS.has(identifier[0]) ? 'keyword' : 'identifier', identifier[0], location);
      continue;
    }

    const operator = PUNCTUATION.find((candidate) => source.startsWith(candidate, index));
    if (operator) {
      advance(operator.length);
      if (operator === '(' || operator === '[' || operator === '{') depth++;
      else if (operator === ')' || operator === ']' || operator === '}') depth--;
      emit('punctuation', operator, location);
      continue;
    }

    throw new FirmwareSyntaxError(`unexpected '${char}'`, location, file);
  }

  if (tokens.length > 0 && tokens[tokens.length - 1].kind !== 'newline') {
    emit('newline', '', here());
  }
  while (indents.length > 1) {
    indents.pop();
    emit('dedent', '', here());
  }
  emit('eof', '', here());
  return tokens;
}

/**
 * The three arguments of a `range`, as expressions rather than numbers.
 *
 * `range(times)` with a count held in a variable is ordinary Python, so the
 * bounds have to be able to be whatever the caller wrote.
 */
interface RangeBounds {
  readonly start: Expr;
  readonly stop: Expr;
  readonly step: Expr;
}

class PythonParser {
  private position = 0;
  private loopCounter = 0;

  private readonly tokens: PythonToken[];
  private readonly file: string;

  constructor(tokens: PythonToken[], file = 'main.py') {
    this.tokens = tokens;
    this.file = file;
  }

  readExpression(): Expr {
    return this.readTernary();
  }

  parseModule(): Program {
    const defines = new Map<string, number>();
    const globals: Stmt[] = [];
    const functions = new Map<string, FunctionDecl>();
    const classes = new Map<string, ClassDecl>();

    this.skipBlank();
    while (!this.at('eof')) {
      if (this.atKeyword('def')) {
        const declaration = this.readDef();
        functions.set(declaration.name, declaration);
        continue;
      }
      if (this.atKeyword('class')) {
        const declaration = this.readClass(this.peek().location);
        classes.set(declaration.name, declaration);
        continue;
      }
      if (this.atKeyword('import') || this.atKeyword('from')) {
        this.readImport();
        continue;
      }
      const statement = this.readStatement();
      globals.push(...this.flatten(statement));
    }

    return { defines, macros: new Map(), globals, functions, classes };
  }

  // -- statements ----------------------------------------------------------

  /**
   * A class: a name, a colon, and a body of methods.
   *
   * The body may only hold methods, because that is all the VM's class
   * machinery knows: a field is a name the object holds, and a Python object
   * holds one the moment it is written to.
   */
  private readClass(location: SourceLocation): ClassDecl {
    this.expectKeyword('class');
    const name = this.expectIdentifier().text;
    this.expectPunctuation(':');
    this.expectNewline();
    this.expect('indent');
    const methods = new Map<string, FunctionDecl>();
    for (;;) {
      this.skipBlank();
      if (this.at('dedent')) {
        this.next();
        break;
      }
      if (this.at('eof')) break;
      if (!this.atKeyword('def')) {
        throw new FirmwareSyntaxError(
          'a class body may only hold methods',
          this.peek().location,
          this.file,
        );
      }
      const method = this.readDef();
      methods.set(method.name, method);
    }
    return { name, fields: [], methods, location };
  }

  private readDef(): FunctionDecl {
    const location = this.expectKeyword('def').location;
    const name = this.expectIdentifier().text;
    this.expectPunctuation('(');

    const parameters: { name: string; type: string; defaultValue?: Expr }[] = [];
    let varargs: string | null = null;
    if (!this.atPunctuation(')')) {
      do {
        if (this.acceptPunctuation('*')) {
          /*
           * `*args`: the arguments the caller passed beyond the named ones,
           * collected into a list. A helper that forwards a buffer of bytes
           * is written this way.
           */
          varargs = this.expectIdentifier().text;
          parameters.push({ name: varargs, type: '' });
          continue;
        }
        const parameter = this.expectIdentifier().text;
        // A default is kept: an argument the caller leaves out takes it, and a
        // keyword argument of the same name takes its place.
        let defaultValue: Expr | undefined;
        if (this.acceptPunctuation('=')) defaultValue = this.readExpression();
        parameters.push({ name: parameter, type: '', ...(defaultValue ? { defaultValue } : {}) });
      } while (this.acceptPunctuation(','));
    }
    this.expectPunctuation(')');
    this.expectPunctuation(':');

    return {
      name,
      returnType: '',
      parameters,
      ...(varargs ? { varargs } : {}),
      body: this.readSuite(location),
      location,
    };
  }

  /** Skips an import whole. The VM binds its own runtime names. */
  private readImport(): void {
    while (!this.at('newline') && !this.at('eof')) this.next();
    this.acceptNewline();
  }

  private readStatement(): Stmt | null {
    const token = this.peek();
    if (this.atKeyword('if')) return this.readIf();
    if (this.atKeyword('while')) return this.readWhile();
    if (this.atKeyword('for')) return this.readFor();
    if (this.atKeyword('try')) return this.readTry();
    if (this.atKeyword('raise')) return this.readRaise();
    if (this.atKeyword('return')) {
      this.next();
      const value = this.at('newline') ? null : this.readExpression();
      this.endStatement();
      return { kind: 'return', value, location: token.location };
    }
    if (this.atKeyword('break')) {
      this.next();
      this.endStatement();
      return { kind: 'break', location: token.location };
    }
    if (this.atKeyword('continue')) {
      this.next();
      this.endStatement();
      return { kind: 'continue', location: token.location };
    }
    if (this.atKeyword('pass')) {
      this.next();
      this.endStatement();
      return { kind: 'empty', location: token.location };
    }
    if (this.atKeyword('def')) {
      // The VM has no nested functions. Reporting that beats hoisting the
      // definition to file scope where it would quietly become visible.
      throw new FirmwareSyntaxError(
        'functions must be defined at the top level',
        token.location,
        this.file,
      );
    }
    if (token.kind === 'keyword') {
      // A `yield` is an expression, so it is read as one: whether it means
      // anything is the VM's business, not the parser's.
      if (token.text === 'yield') return this.readSimpleStatement();
      throw new FirmwareSyntaxError(`'${token.text}' is not supported`, token.location, this.file);
    }
    return this.readSimpleStatement();
  }

  private readIf(): Stmt {
    const location = this.expectKeyword('if').location;
    const condition = this.readExpression();
    this.expectPunctuation(':');
    const then = this.readSuite(location);
    const otherwise = this.readBranch(location);
    return { kind: 'if', condition, then, otherwise, location };
  }

  /** The `elif`/`else` tail of an `if`, which is another `if` when it is elif. */
  private readBranch(location: SourceLocation): Stmt | null {
    if (this.atKeyword('elif')) {
      this.next();
      const condition = this.readExpression();
      this.expectPunctuation(':');
      const then = this.readSuite(location);
      return { kind: 'if', condition, then, otherwise: this.readBranch(location), location };
    }
    if (this.atKeyword('else')) {
      this.next();
      this.expectPunctuation(':');
      return this.readSuite(location);
    }
    return null;
  }

  private readWhile(): Stmt {
    const location = this.expectKeyword('while').location;
    const condition = this.readExpression();
    this.expectPunctuation(':');
    return { kind: 'while', condition, body: this.readSuite(location), location };
  }

  /**
   * `try:` with its `except` handlers, an optional `else` and an optional
   * `finally`.
   *
   * The clauses come in the order Python allows them: the handlers first,
   * then `else`, then `finally`. A handler with no type catches everything,
   * and a handler may name several types in brackets, which is how a sketch
   * guards a read that can fail two ways.
   */
  private readTry(): Stmt {
    const location = this.expectKeyword('try').location;
    this.expectPunctuation(':');
    const body = this.readSuite(location);
    const handlers: { types: string[]; name: string | null; body: Stmt }[] = [];
    let otherwise: Stmt | null = null;
    let final: Stmt | null = null;

    for (;;) {
      if (this.atKeyword('except')) {
        this.next();
        const types: string[] = [];
        let name: string | null = null;
        if (this.atPunctuation('(')) {
          this.next();
          do {
            types.push(this.expectIdentifier().text);
          } while (this.acceptPunctuation(','));
          this.expectPunctuation(')');
        } else if (!this.atPunctuation(':')) {
          types.push(this.expectIdentifier().text);
        }
        if (this.atKeyword('as')) {
          this.next();
          name = this.expectIdentifier().text;
        }
        this.expectPunctuation(':');
        handlers.push({ types, name, body: this.readSuite(location) });
        continue;
      }
      if (this.atKeyword('else')) {
        this.next();
        this.expectPunctuation(':');
        otherwise = this.readSuite(location);
        continue;
      }
      if (this.atKeyword('finally')) {
        this.next();
        this.expectPunctuation(':');
        final = this.readSuite(location);
        continue;
      }
      break;
    }

    return { kind: 'try', body, handlers, otherwise, final, location };
  }

  /** `raise`, with or without a value. */
  private readRaise(): Stmt {
    const location = this.expectKeyword('raise').location;
    const error = this.at('newline') || this.at('eof') ? null : this.readExpression();
    this.endStatement();
    return { kind: 'raise', error, location };
  }

  /**
   * `for name in range(...)`, turned into the counter loop the VM already has.
   *
   * The VM's `for` is C's -- an initialiser, a condition and an update -- so a
   * Python range loop becomes exactly that, under a name of this parser's
   * choosing. A learner reading the source sees the `for ... in range` they
   * wrote; the AST underneath is the only place the translation shows.
   */
  private readFor(): Stmt {
    const location = this.expectKeyword('for').location;
    const name = this.expectIdentifier().text;
    this.expectKeyword('in');
    /*
     * A range is a counter loop the VM already has, so it keeps that shape.
     * Anything else -- a list, a generator -- is iterated by the loop that
     * asks for one item at a time.
     */
    const callee = this.peek();
    if (callee.kind !== 'identifier' || callee.text !== 'range') {
      const iterable = this.readExpression();
      this.expectPunctuation(':');
      return { kind: 'forEach', variable: name, iterable, body: this.readSuite(location), location };
    }
    const bounds = this.readRangeBounds(location);
    this.expectPunctuation(':');

    const counter = `_py_loop_${this.loopCounter++}`;
    const counterAt = (): Expr => ({ kind: 'identifier', name: counter, location });
    const against = (operator: string): Expr => ({
      kind: 'binary',
      operator,
      left: counterAt(),
      right: bounds.stop,
      location,
    });
    const init: Stmt = {
      kind: 'varDecl',
      name: counter,
      init: bounds.start,
      location,
    };
    /*
     * A negative step counts down, so the comparison has to follow its sign --
     * and the sign is only known once the program runs, because the step may
     * be a variable. Choosing the comparison by testing the step is what keeps
     * `for i in range(5, 0, -1)` from silently doing nothing.
     */
    const condition: Expr = {
      kind: 'ternary',
      condition: {
        kind: 'binary',
        operator: '<',
        left: bounds.step,
        right: { kind: 'number', value: 0, location },
        location,
      },
      whenTrue: against('>'),
      whenFalse: against('<'),
      location,
    };
    const update: Expr = {
      kind: 'assign',
      target: counterAt(),
      operator: '+=',
      value: bounds.step,
      location,
    };

    // The counter is the loop's own; the name the programmer wrote has to be
    // bound from it on every pass, or the body would read a stale or absent
    // variable instead of the iteration it is inside.
    const bind: Stmt = {
      kind: 'expression',
      value: {
        kind: 'assign',
        target: { kind: 'identifier', name, location },
        operator: '=',
        value: counterAt(),
        location,
      },
      location,
    };
    const suite = this.readSuite(location);

    return {
      kind: 'for',
      init,
      condition,
      update,
      body:
        suite.kind === 'suite'
          ? { ...suite, statements: [bind, ...suite.statements] }
          : { kind: 'suite', statements: [bind, suite], location },
      location,
    };
  }

  private readRangeBounds(location: SourceLocation): RangeBounds {
    const callee = this.peek();
    if (callee.kind !== 'identifier' || callee.text !== 'range') {
      throw new FirmwareSyntaxError(
        "only 'for ... in range(...)' is supported",
        callee.location,
        this.file,
      );
    }
    this.next();
    this.expectPunctuation('(');

    const bounds: Expr[] = [];
    if (!this.atPunctuation(')')) {
      do {
        bounds.push(this.readExpression());
      } while (this.acceptPunctuation(','));
    }
    this.expectPunctuation(')');

    if (bounds.length === 0 || bounds.length > 3) {
      throw new FirmwareSyntaxError('range() takes one to three arguments', location, this.file);
    }
    /*
     * Python's three spellings: `range(stop)`, `range(start, stop)` and
     * `range(start, stop, step)`.
     *
     * Reading the first bound as the start made `range(4)` count from four
     * to nothing, so the loop never ran at all -- a sketch's most ordinary
     * loop did nothing, silently. The VM's own `range` value has always read
     * the one-argument form as a stop, and this is the same reading.
     */
    const first = bounds[0] as Expr;
    if (bounds.length === 1) {
      return {
        start: { kind: 'number', value: 0, location },
        stop: first,
        step: { kind: 'number', value: 1, location },
      };
    }
    return {
      start: first,
      stop: bounds[1] ?? { kind: 'number', value: 0, location },
      step: bounds[2] ?? { kind: 'number', value: 1, location },
    };
  }

  /**
   * The statements on one logical line.
   *
   * `x = 1; y = 2` is one line and two statements, so this returns a block when
   * there is more than one. Parsing the first and dropping the rest would run
   * a program whose text does not say what it does, which is the one thing a
   * parser must never do.
   */
  private readSimpleStatement(): Stmt | null {
    const location = this.peek().location;
    if (this.at('newline') || this.at('eof') || this.at('dedent')) return null;
    if (this.acceptPunctuation(';')) return { kind: 'empty', location };

    const statements: Stmt[] = [];
    for (;;) {
      const statement = this.readOneStatement();
      statements.push(...this.flatten(statement));
      if (!this.acceptPunctuation(';') || this.at('newline')) break;
    }

    this.endStatement();
    return statements.length === 1 ? statements[0] : { kind: 'block', statements, location };
  }

  /**
   * One assignment, annotation or bare expression.
   */
  private readOneStatement(): Stmt {
    const location = this.peek().location;
    const first = this.readExpression();
    const operator = ASSIGN_OPERATORS.find((candidate) => this.atPunctuation(candidate));
    let value = first;
    if (operator) {
      this.next();
      value = {
        kind: 'assign',
        target: first,
        operator,
        value: this.readExpression(),
        location,
      };
    }

    // `x: int = 3` and a bare annotation both mean the same thing here.
    if (this.acceptPunctuation(':')) this.readExpression();

    if (value.kind === 'assign' && value.target.kind === 'identifier' && value.operator === '=') {
      return { kind: 'varDecl', name: value.target.name, init: value.value, location };
    }
    if (value.kind === 'identifier') {
      // Two names on the left, as in `a, b = 1, 2`, which this VM has no way to
      // bind. Saying so beats dropping the second value without a word.
      throw new FirmwareSyntaxError(
        `'${value.name}' on its own is not a statement`,
        location,
        this.file,
      );
    }
    return { kind: 'expression', value, location };
  }

  /**
   * The statements of a line, with a semicolon group spliced apart.
   *
   * `readSimpleStatement` answers with one node, so several statements on one
   * line arrive here as a block. This is where that block goes back to being
   * the statements it stands for, because a semicolon is not a scope in Python:
   * `x = 1; y = 2` binds exactly the names two lines would, and letting the
   * block through would put them somewhere the rest of the program cannot see.
   */
  private flatten(statement: Stmt | null): Stmt[] {
    if (statement === null) return [];
    return statement.kind === 'block' ? statement.statements : [statement];
  }

  /** Consumes the end of a logical line. */
  private endStatement(): void {
    if (!this.acceptNewline() && !this.at('eof') && !this.at('dedent')) {
      throw new FirmwareSyntaxError(
        `expected end of statement, found '${this.peek().text}'`,
        this.peek().location,
        this.file,
      );
    }
  }

  /**
   * The statements under a colon.
   *
   * Both shapes Python allows are here: a suite on the following indented
   * lines, and the one-line form beside the colon. The one-line form has to
   * build its block by hand, because there is no INDENT to announce it.
   */
  private readSuite(location: SourceLocation): Stmt {
    if (this.acceptPunctuation(';') || !this.at('newline')) {
      const only = this.at('newline') ? null : this.readSimpleStatement();
      return { kind: 'suite', statements: only ? [only] : [], location };
    }

    this.expectNewline();
    this.expect('indent');
    const statements: Stmt[] = [];
    for (;;) {
      this.skipBlank();
      if (this.at('dedent')) {
        this.next();
        break;
      }
      if (this.at('eof')) break;
      const statement = this.readStatement();
      statements.push(...this.flatten(statement));
    }
    return { kind: 'suite', statements, location };
  }

  // -- expressions ---------------------------------------------------------

  /** Python's `a if condition else b`, which is the VM's ternary. */
  private readTernary(): Expr {
    const value = this.readBinary(0);
    if (!this.atKeyword('if')) return value;
    const location = this.expectKeyword('if').location;
    const condition = this.readBinary(0);
    this.expectKeyword('else');
    return {
      kind: 'ternary',
      condition,
      whenTrue: value,
      whenFalse: this.readExpression(),
      location,
    };
  }

  private readBinary(minimumPrecedence: number): Expr {
    let left = this.readUnary();
    for (;;) {
      const token = this.peek();

      // `and` and `or` are Python's spellings of `&&` and `||`; rewriting them
      // here is what lets one interpreter run both languages.
      if (token.kind === 'keyword' && (token.text === 'and' || token.text === 'or')) {
        const precedence = PRECEDENCE[token.text];
        if (precedence < minimumPrecedence) break;
        this.next();
        const right = this.readBinary(precedence + 1);
        left = {
          kind: 'binary',
          operator: token.text === 'and' ? '&&' : '||',
          left,
          right,
          location: token.location,
        };
        continue;
      }

      if (UNSUPPORTED_OPERATORS.has(token.text)) {
        throw new FirmwareSyntaxError(
          `'${token.text}' is not supported`,
          token.location,
          this.file,
        );
      }

      const precedence = token.kind === 'punctuation' ? PRECEDENCE[token.text] : undefined;
      if (precedence === undefined || precedence < minimumPrecedence) break;

      /*
       * Python's `0 <= x <= 10` is two comparisons, and it evaluates the
       * middle once. Nothing in this AST can hold that without a temporary, so
       * it is refused rather than quietly read as `(0 <= x) <= 10`, which
       * answers a question nobody asked.
       *
       * The tell is on the left, not the right: reaching a second comparison
       * with a comparison already built is exactly what a chain looks like
       * once the shared operand has been consumed.
       */
      if (COMPARISON.has(token.text) && left.kind === 'binary' && COMPARISON.has(left.operator)) {
        throw new FirmwareSyntaxError(
          'chained comparisons are not supported; use `and` between them',
          token.location,
          this.file,
        );
      }

      this.next();
      const right = this.readBinary(precedence + 1);
      left = { kind: 'binary', operator: token.text, left, right, location: token.location };
    }
    return left;
  }

  private readUnary(): Expr {
    const token = this.peek();
    if (token.kind === 'keyword' && token.text === 'not') {
      this.next();
      return { kind: 'unary', operator: '!', operand: this.readUnary(), location: token.location };
    }
    if (token.kind === 'punctuation' && ['-', '+', '~'].includes(token.text)) {
      this.next();
      return {
        kind: 'unary',
        operator: token.text,
        operand: this.readUnary(),
        location: token.location,
      };
    }
    if (token.kind === 'keyword' && token.text === 'lambda') {
      throw new FirmwareSyntaxError(`'${token.text}' is not supported`, token.location, this.file);
    }
    /*
     * `yield`: the value a generator hands over. A bare `yield` hands over
     * nothing, and the value after it is the whole of the rest of the
     * expression -- so `yield a + b` hands over the sum, not the `a`.
     */
    if (token.kind === 'keyword' && token.text === 'yield') {
      this.next();
      /*
       * `yield from`: hand over whatever another generator (or list) hands
       * over, in turn. Its own last value becomes the value of the
       * expression, which is what lets one generator finish another's work.
       */
      if (this.atKeyword('from')) {
        this.next();
        return { kind: 'yieldFrom', value: this.readExpression(), location: token.location };
      }
      const value =
        this.at('newline') || this.at('eof') || this.atPunctuation(')') || this.atPunctuation('}')
          ? null
          : this.readExpression();
      return { kind: 'yield', value, location: token.location };
    }
    return this.readPostfix();
  }

  private readPostfix(): Expr {
    let expression = this.readPrimary();
    for (;;) {
      if (this.acceptPunctuation('(')) {
        const args: Expr[] = [];
        const keywords: KeywordArgument[] = [];
        if (!this.atPunctuation(')')) {
          do {
            /*
             * A keyword argument is a name and an `=`. Python binds those by
             * name, so a sketch can spell a call the way its documentation
             * does and the callee decides which names it knows.
             */
            if (
              this.peek().kind === 'identifier' &&
              this.peek(1).kind === 'punctuation' &&
              this.peek(1).text === '='
            ) {
              const name = this.next().text;
              this.next();
              keywords.push({ name, value: this.readExpression() });
            } else {
              args.push(this.readExpression());
            }
          } while (this.acceptPunctuation(','));
        }
        this.expectPunctuation(')');
        expression = {
          kind: 'call',
          callee: expression,
          args,
          ...(keywords.length > 0 ? { keywords } : {}),
          location: expression.location,
        };
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
    if (token.kind === 'bytes') {
      /*
       * A bytes literal is a list of byte values. The bench's buffers are
       * arrays, so that is what it is: `b'\x00\xaf'` is two bytes, not four
       * characters.
       */
      const items = Array.from(token.text, (character) => ({
        kind: 'number' as const,
        value: character.charCodeAt(0),
        location: token.location,
      }));
      return { kind: 'list', items, location: token.location };
    }
    if (token.kind === 'punctuation' && token.text === '[') {
      const first = this.readExpression();
      /*
       * A comprehension: `[element for name in iterable]`. The `for` is what
       * tells the two apart, and it comes straight after the element.
       */
      if (this.atKeyword('for')) {
        this.next();
        const variable = this.expectIdentifier().text;
        this.expectKeyword('in');
        const iterable = this.readExpression();
        this.expectPunctuation(']');
        return {
          kind: 'comprehension',
          element: first,
          variable,
          iterable,
          location: token.location,
        };
      }
      const items: Expr[] = [first];
      while (this.acceptPunctuation(',')) {
        items.push(this.readExpression());
      }
      this.expectPunctuation(']');
      return { kind: 'list', items, location: token.location };
    }
    if (token.kind === 'punctuation' && token.text === '{') {
      const entries: { key: Expr; value: Expr }[] = [];
      if (!this.atPunctuation('}')) {
        do {
          const key = this.readExpression();
          this.expectPunctuation(':');
          entries.push({ key, value: this.readExpression() });
        } while (this.acceptPunctuation(','));
      }
      this.expectPunctuation('}');
      return { kind: 'dict', entries, location: token.location };
    }
    if (token.kind === 'fstring') {
      return readFstring(token, this.file);
    }
    if (token.kind === 'identifier') {
      return { kind: 'identifier', name: token.text, location: token.location };
    }
    if (token.kind === 'keyword') {
      if (token.text === 'True') return { kind: 'boolean', value: true, location: token.location };
      if (token.text === 'False')
        return { kind: 'boolean', value: false, location: token.location };
      // `None` means "nothing", which is exactly what zero already is here.
      if (token.text === 'None') return { kind: 'number', value: 0, location: token.location };
    }
    if (token.kind === 'punctuation' && token.text === '(') {
      const inner = this.readExpression();
      this.expectPunctuation(')');
      return inner;
    }

    throw new FirmwareSyntaxError(`unexpected '${token.text}'`, token.location, this.file);
  }

  // -- token helpers -------------------------------------------------------

  private peek(offset = 0): PythonToken {
    return this.tokens[Math.min(this.position + offset, this.tokens.length - 1)];
  }

  private at(kind: PythonTokenKind): boolean {
    return this.peek().kind === kind;
  }

  private atKeyword(text: string): boolean {
    const token = this.peek();
    return token.kind === 'keyword' && token.text === text;
  }

  private atPunctuation(text: string): boolean {
    const token = this.peek();
    return token.kind === 'punctuation' && token.text === text;
  }

  private next(): PythonToken {
    return this.tokens[Math.min(this.position++, this.tokens.length - 1)];
  }

  private expect(kind: PythonTokenKind): PythonToken {
    const token = this.next();
    if (token.kind !== kind) {
      throw new FirmwareSyntaxError(
        `expected ${kind}, found '${token.text}'`,
        token.location,
        this.file,
      );
    }
    return token;
  }

  private expectIdentifier(): PythonToken {
    return this.expect('identifier');
  }

  private expectKeyword(text: string): PythonToken {
    const token = this.peek();
    if (!this.atKeyword(text)) {
      throw new FirmwareSyntaxError(
        `expected '${text}', found '${token.text}'`,
        token.location,
        this.file,
      );
    }
    return this.next();
  }

  private expectPunctuation(text: string): void {
    if (!this.acceptPunctuation(text)) {
      throw new FirmwareSyntaxError(
        `expected '${text}', found '${this.peek().text}'`,
        this.peek().location,
        this.file,
      );
    }
  }

  private acceptPunctuation(text: string): boolean {
    if (!this.atPunctuation(text)) return false;
    this.next();
    return true;
  }

  private acceptNewline(): boolean {
    if (!this.at('newline')) return false;
    this.next();
    return true;
  }

  private expectNewline(): void {
    if (!this.acceptNewline() && !this.at('eof')) {
      throw new FirmwareSyntaxError(
        `expected end of line, found '${this.peek().text}'`,
        this.peek().location,
        this.file,
      );
    }
  }

  /** Steps over the blank lines that sit between statements. */
  private skipBlank(): void {
    while (this.at('newline')) this.next();
  }
}

/**
 * `f"on {pin} of {total}"`, turned into the string it would produce.
 *
 * An f-string is syntax, not a value: literal fragments around expressions. It
 * becomes a `+` chain the VM already evaluates, with string concatenation
 * added on that side -- so the values are still formatted when the program
 * runs, not when it is parsed.
 */
function readFstring(token: PythonToken, file = 'main.py'): Expr {
  const parts: Expr[] = [];
  let literal = '';
  let index = 0;

  const flush = () => {
    if (literal) {
      parts.push({ kind: 'string', value: unescape(literal), location: token.location });
      literal = '';
    }
  };

  while (index < token.text.length) {
    const char = token.text[index];
    if (char === '{' && token.text[index + 1] === '{') {
      literal += '{';
      index += 2;
      continue;
    }
    if (char === '}' && token.text[index + 1] === '}') {
      literal += '}';
      index += 2;
      continue;
    }
    if (char === '}') {
      throw new FirmwareSyntaxError(
        "single '}' is not allowed in an f-string",
        token.location,
        file,
      );
    }
    if (char !== '{') {
      literal += char;
      index++;
      continue;
    }

    flush();
    const close = findClosingBrace(token.text, index + 1, token.location, file);
    // A format spec would be a second, different answer to how a number prints.
    // The VM formats numbers one way, so the spec is dropped rather than faked.
    parts.push(parsePythonExpression(token.text.slice(index + 1, close).split(':')[0], file));
    index = close + 1;
  }

  flush();
  if (parts.length === 0) return { kind: 'string', value: '', location: token.location };
  return parts.reduce((left, right) => ({
    kind: 'binary',
    operator: '+',
    left,
    right,
    location: token.location,
  }));
}

/** The index of the `}` closing the replacement field that starts at `from`. */
function findClosingBrace(
  body: string,
  from: number,
  location: SourceLocation,
  file = 'main.py',
): number {
  let depth = 0;
  let quote: string | null = null;
  for (let index = from; index < body.length; index++) {
    const char = body[index];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '{') depth++;
    else if (char === '}' && depth-- === 0) return index;
  }
  throw new FirmwareSyntaxError("f-string is missing its closing '}'", location, file);
}

export function parsePython(source: string, file = 'main.py'): Program {
  return new PythonParser(tokenizePython(source, file), file).parseModule();
}

/** One Python expression, for the f-string fields that need their own parse. */
export function parsePythonExpression(source: string, file = 'main.py'): Expr {
  return new PythonParser(tokenizePython(source, file), file).readExpression();
}
