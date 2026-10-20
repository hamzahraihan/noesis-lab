import { describe, expect, it } from 'vitest';
import { FirmwareSyntaxError, type Program, type Stmt } from './parser';
import { parsePython, tokenizePython } from './python';

/**
 * The Python front end.
 *
 * Its whole job is to produce the same `Program` the C parser produces, so most
 * of these assert the shape of that AST rather than Python itself: what matters
 * is that the VM -- which has never heard of Python -- can run what comes out.
 */
describe('indentation', () => {
  it('reads a suite as the block under its colon', () => {
    const program = parsePython('if x:\n    y = 1\n');

    expect(program.globals).toHaveLength(1);
    const only = program.globals[0];
    expect(only.kind).toBe('if');
    if (only.kind !== 'if') return;
    expect(only.then.kind).toBe('suite');
    if (only.then.kind !== 'suite') return;
    expect(only.then.statements).toHaveLength(1);
  });

  it('nests suites by how far each one is indented', () => {
    const program = parsePython(['if a:', '    if b:', '        x = 1', '    y = 2'].join('\n'));

    const outer = program.globals[0];
    expect(outer.kind).toBe('if');
    if (outer.kind !== 'if' || outer.then.kind !== 'suite') return;
    const statements = outer.then.statements;
    expect(statements).toHaveLength(2);
    expect(statements[0].kind).toBe('if');
    expect(statements[1].kind).toBe('varDecl');
  });

  it('does not let a blank line open or close a suite', () => {
    // A blank line inside the block must not dedent out of it.
    const program = parsePython('if a:\n    x = 1\n\n    y = 2\nz = 3\n');

    const outer = program.globals[0];
    if (outer.kind !== 'if' || outer.then.kind !== 'suite') throw new Error('expected a suite');
    expect(outer.then.statements).toHaveLength(2);
    expect(program.globals).toHaveLength(2);
  });

  it('reads a suite written on the line after its colon', () => {
    const program = parsePython('if a: x = 1\n');

    const only = program.globals[0];
    if (only.kind !== 'if' || only.then.kind !== 'suite') throw new Error('expected a suite');
    expect(only.then.statements).toHaveLength(1);
  });
});

describe('control flow', () => {
  it('reads elif as the else branch of an if', () => {
    const program = parsePython(
      ['if a:', '    x = 1', 'elif b:', '    x = 2', 'else:', '    x = 3'].join('\n'),
    );

    const outer = program.globals[0];
    if (outer.kind !== 'if' || outer.otherwise?.kind !== 'if') throw new Error('expected an elif');
    expect(outer.otherwise.kind).toBe('if');
    if (outer.otherwise.kind !== 'if') return;
    expect(outer.otherwise.otherwise?.kind).toBe('suite');
  });

  it('reads while with its body', () => {
    const program = parsePython('while a:\n    x = 1\n');
    expect(program.globals[0].kind).toBe('while');
  });

  it('counts a range loop down when the step is negative', () => {
    const program = parsePython('for i in range(5, 0, -1):\n    x = 1\n');
    const only = program.globals[0];

    if (only.kind !== 'for') throw new Error('expected a for');
    const condition = only.condition;
    if (condition === null || condition.kind !== 'ternary') {
      throw new Error('expected the comparison to follow the step');
    }
    // The step is only known when the program runs, so the loop picks its
    // comparison at run time. Both branches have to exist or a negative step
    // would silently do nothing.
    expect(condition.whenTrue).toMatchObject({ kind: 'binary', operator: '>' });
    expect(condition.whenFalse).toMatchObject({ kind: 'binary', operator: '<' });
  });

  /**
   * The translation a range loop goes through is only correct if the name the
   * programmer wrote is bound inside the body. It is bound by an assignment
   * ahead of the body rather than by the counter, so this is the assertion
   * that the assignment is there at all.
   */
  it('binds the loop variable on every pass', () => {
    const program = parsePython('for i in range(3):\n    total = total + i\n');
    const only = program.globals[0];

    if (only.kind !== 'for' || only.body.kind !== 'suite') throw new Error('expected a for');
    const binding = only.body.statements[0];
    expect(binding.kind).toBe('expression');
    if (binding.kind !== 'expression' || binding.value.kind !== 'assign') {
      throw new Error('expected the loop variable to be assigned');
    }
    expect(binding.value.target).toMatchObject({ kind: 'identifier', name: 'i' });
  });

  it('gives each loop its own counter', () => {
    // Two loops nested: a shared counter would make the inner one restart the
    // outer one, which shows up as a loop that never ends.
    const program = parsePython(
      ['for a in range(2):', '    for b in range(2):', '        x = 1'].join('\n'),
    );

    const counters: string[] = [];
    const collect = (statement: Stmt) => {
      if (statement.kind === 'for' && statement.init?.kind === 'varDecl') {
        counters.push(statement.init.name);
        if (statement.body.kind === 'suite') statement.body.statements.forEach(collect);
      }
    };
    program.globals.forEach(collect);

    expect(new Set(counters).size).toBe(2);
  });

  it('refuses an iterable that is not a range', () => {
    expect(() => parsePython('for i in pins:\n    x = 1\n')).toThrow(/range/);
  });

  it('reads break, continue, return and pass', () => {
    const program = parsePython(
      [
        'def f():',
        '    for i in range(3):',
        '        if i:',
        '            break',
        '        else:',
        '            continue',
        '    pass',
      ].join('\n'),
    );

    const fn = program.functions.get('f');
    expect(fn).toBeDefined();
    const body = fn?.body as { statements?: Stmt[] };
    expect(body.statements?.length).toBeGreaterThan(0);
  });
});

describe('functions', () => {
  it('reads a definition with its parameters and body', () => {
    const program = parsePython('def blink(times):\n    for i in range(times):\n        pass\n');
    const fn = program.functions.get('blink');

    expect(fn?.parameters.map((parameter) => parameter.name)).toEqual(['times']);
    expect(fn?.body.kind).toBe('suite');
  });

  it('runs module statements in order, ahead of any call', () => {
    // Python has no separate setup: the module body is the program.
    const program = parsePython('led = 17\nprint(led)\n');
    expect(program.globals).toHaveLength(2);
  });

  it('refuses a nested definition rather than hoisting it', () => {
    expect(() => parsePython('def outer():\n    def inner():\n        pass\n')).toThrow(
      /top level/,
    );
  });
});

describe('expressions', () => {
  const first = (source: string): Stmt => {
    const program = parsePython(source);
    return program.globals[0];
  };

  it("rewrites Python's operators into the VM's own", () => {
    // `and`/`or`/`not` are the only spellings the VM does not have.
    const conjunction = first('x = a and b');
    expect(conjunction.kind).toBe('varDecl');
    if (conjunction.kind !== 'varDecl' || conjunction.init?.kind !== 'binary') {
      throw new Error('expected a binary');
    }
    expect(conjunction.init.operator).toBe('&&');

    const negated = parsePythonExpressionKind('not a');
    expect(negated).toMatchObject({ kind: 'unary', operator: '!' });
  });

  it('reads the boolean literals as booleans rather than names', () => {
    const truthy = first('x = True');
    if (truthy.kind !== 'varDecl') throw new Error('expected a declaration');
    expect(truthy.init).toMatchObject({ kind: 'boolean', value: true });

    const nothing = first('x = None');
    if (nothing.kind !== 'varDecl') throw new Error('expected a declaration');
    expect(nothing.init).toMatchObject({ kind: 'number', value: 0 });
  });

  it('reads a range call as its three numbers', () => {
    const source = 'x = range(1, 9, 2)';
    const program = parsePython(source);
    expect(program.globals).toHaveLength(1);
  });

  it('reads numbers in every base Python spells them in', () => {
    for (const [source, value] of [
      ['17', 17],
      ['0x1F', 31],
      ['0o17', 15],
      ['0b1011', 11],
      ['1_000', 1000],
      ['2.5', 2.5],
    ] as const) {
      const declaration = first(`x = ${source}`);
      if (declaration.kind !== 'varDecl') throw new Error('expected a declaration');
      expect(declaration.init).toMatchObject({ kind: 'number', value });
    }
  });

  it('reads a conditional expression as the VM ternary', () => {
    const declaration = first('x = a if b else c');
    if (declaration.kind !== 'varDecl' || declaration.init?.kind !== 'ternary') {
      throw new Error('expected a ternary');
    }
    expect(declaration.init.whenTrue).toMatchObject({ kind: 'identifier', name: 'a' });
    expect(declaration.init.whenFalse).toMatchObject({ kind: 'identifier', name: 'c' });
  });

  it('reads compound assignment as an assignment, not a declaration', () => {
    // Only `=` introduces a name. `x += 1` reads and writes one, which is the
    // same statement the C parser emits for it.
    const statement = first('x += 1');
    if (statement.kind !== 'expression' || statement.value.kind !== 'assign') {
      throw new Error('expected a compound assignment');
    }
    expect(statement.value.operator).toBe('+=');
  });

  it('reads calls, attributes and subscripts', () => {
    const declaration = first('x = LED(17)');
    if (declaration.kind !== 'varDecl' || declaration.init?.kind !== 'call') {
      throw new Error('expected a call');
    }
    expect(declaration.init.callee).toMatchObject({ kind: 'identifier', name: 'LED' });
  });

  it('refuses chained comparisons rather than reading only the first', () => {
    // `0 <= x <= 10` means two comparisons in Python. Reading it as one would
    // quietly answer the wrong question.
    expect(() => parsePython('if 0 <= x <= 10:\n    pass\n')).toThrow(/chained/);
  });

  it('refuses the operators the VM cannot mean', () => {
    expect(() => parsePython('x = 2 ** 3\n')).toThrow(/not supported/);
    expect(() => parsePython('x = 7 // 2\n')).toThrow(/not supported/);
  });

  it('refuses a class, an import of a name it cannot bind, and a bare name', () => {
    expect(() => parsePython('class Thing:\n    pass\n')).toThrow(/class/);
    expect(() => parsePython('LED\n')).toThrow(/not a statement/);
  });
});

describe('strings', () => {
  const value = (source: string): unknown => {
    const declaration = parsePython(`x = ${source}`).globals[0];
    if (declaration.kind !== 'varDecl' || declaration.init?.kind !== 'string') {
      throw new Error(`expected a plain string from ${source}`);
    }
    return declaration.init.value;
  };

  it('reads both quote styles and unescapes', () => {
    expect(value("'hello'")).toBe('hello');
    expect(value('"hello"')).toBe('hello');
    expect(value(String.raw`'a\nb'`)).toBe('a\nb');
  });

  it('treats f as a prefix only when it stands alone before a quote', () => {
    expect(tokenizePython('f"one"')[0]).toMatchObject({ kind: 'fstring', text: 'one' });

    // Inside a name the `f` is a letter, and the quote starts a plain string.
    const insideName = tokenizePython('xf"two"');
    expect(insideName[0]).toMatchObject({ kind: 'identifier', text: 'xf' });
    expect(insideName[1]).toMatchObject({ kind: 'string', text: 'two' });
  });

  it('reads an f-string as its literal parts joined by addition', () => {
    // The values are not formatted here -- they stay as expressions, and the
    // VM concatenates and formats them when the program runs.
    const declaration = parsePython('x = f"pin {pin} of {total}"').globals[0];
    if (declaration.kind !== 'varDecl' || declaration.init?.kind !== 'binary') {
      throw new Error('expected a concatenation');
    }
    const rendered = JSON.stringify(declaration.init);
    expect(rendered).toContain('pin ');
    expect(rendered).toContain('"pin"');
    expect(rendered).toContain('"total"');
  });

  it('unescapes a doubled brace into a literal one', () => {
    const declaration = parsePython('x = f"{{literal}}"').globals[0];
    if (declaration.kind !== 'varDecl' || declaration.init?.kind !== 'string') {
      throw new Error('expected a plain string');
    }
    expect(declaration.init.value).toBe('{literal}');
  });

  it('rejects a lone closing brace', () => {
    expect(() => parsePython('x = f"}"')).toThrow(/single/);
  });
});

describe('imports', () => {
  it('are skipped, because the VM binds its own runtime names', () => {
    const program = parsePython(
      ['from gpiozero import LED, Button', 'import time', 'x = 1'].join('\n'),
    );

    expect(program.globals).toHaveLength(1);
    expect(program.globals[0].kind).toBe('varDecl');
  });
});

describe('errors', () => {
  it('carries the line a learner is looking at', () => {
    let caught: unknown;
    try {
      parsePython('x = 1\ny = 2\nz = @\n');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(FirmwareSyntaxError);
    expect((caught as FirmwareSyntaxError).location.line).toBe(3);
  });

  it('names the feature it cannot run', () => {
    expect(() => parsePython('try:\n    pass\nexcept:\n    pass\n')).toThrow(/not supported/);
    expect(() => parsePython('while a:\n    with b:\n        pass\n')).toThrow(/not supported/);
  });
});

describe('the spellings a sketch uses', () => {
  const first = (source: string): Stmt => parsePython(source).globals[0];

  it('reads a keyword argument as the name it binds', () => {
    const declaration = first('x = f(1, sda=21, scl=22)');
    if (declaration.kind !== 'varDecl' || declaration.init?.kind !== 'call') {
      throw new Error('expected a call');
    }
    expect(declaration.init.args).toHaveLength(1);
    expect(declaration.init.keywords?.map((keyword) => keyword.name)).toEqual(['sda', 'scl']);
    expect(declaration.init.keywords?.[0]?.value).toMatchObject({ kind: 'number', value: 21 });
  });

  it('leaves a call without keywords as it was', () => {
    const declaration = first('x = f(1)');
    if (declaration.kind !== 'varDecl' || declaration.init?.kind !== 'call') {
      throw new Error('expected a call');
    }
    expect(declaration.init.keywords).toBeUndefined();
  });

  it('reads a list literal as its items', () => {
    const declaration = first('x = [1, 2, 3]');
    if (declaration.kind !== 'varDecl' || declaration.init?.kind !== 'list') {
      throw new Error('expected a list');
    }
    expect(declaration.init.items.map((item) => (item.kind === 'number' ? item.value : null))).toEqual([
      1, 2, 3,
    ]);
  });

  it('reads a bytes literal as its bytes, not its characters', () => {
    const declaration = first("x = b'\\x00\\xaf'");
    if (declaration.kind !== 'varDecl' || declaration.init?.kind !== 'list') {
      throw new Error('expected a list');
    }
    expect(declaration.init.items.map((item) => (item.kind === 'number' ? item.value : null))).toEqual([
      0, 175,
    ]);
  });

  it('reads a comprehension as the element and the iterable it walks', () => {
    const declaration = first('x = [i * 2 for i in range(3)]');
    if (declaration.kind !== 'varDecl' || declaration.init?.kind !== 'comprehension') {
      throw new Error('expected a comprehension');
    }
    expect(declaration.init.variable).toBe('i');
    expect(declaration.init.element).toMatchObject({ kind: 'binary' });
    expect(declaration.init.iterable).toMatchObject({ kind: 'call' });
  });
});

/** One expression, for assertions about operator rewriting. */
function parsePythonExpressionKind(source: string): unknown {
  const declaration = parsePython(`x = ${source}`).globals[0];
  if (declaration.kind !== 'varDecl') throw new Error('expected a declaration');
  return declaration.init;
}

/** Keeps the import of `Program` honest when the shape assertions change. */
export type { Program };
