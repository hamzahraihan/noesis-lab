/**
 * Parity gate for the firmware lexer: C++ Wasm `vm_tokenize` vs TypeScript `tokenize`.
 *
 * The C++ lexer is a direct port of `tokenize()` from `../firmware/parser.ts`
 * (lines 161–end). This test asserts identical token kinds, text, line, and column
 * for a representative Arduino sketch.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { tokenize as tokenizeTS, parseFirmware } from '@/features/simulation/firmware/parser';
import { FirmwareRunner, type FirmwareServices } from '@/features/simulation/firmware/interpreter';
import { loadWasmFirmware, type WasmFirmware } from './firmware-bridge';

let wasm: WasmFirmware;

beforeAll(async () => {
  wasm = await loadWasmFirmware();
});

/** Creates a TS FirmwareRunner for the blink sketch with stub services. */
function createTSVM(source: string): FirmwareRunner {
  const services: FirmwareServices = {
    spi: { begin: () => {}, transfer: () => 0, end: () => 0 },
    nowMs: () => 0,
    pinMode: () => {},
    digitalWrite: () => {},
    digitalRead: () => 0,
    analogWrite: () => {},
    analogRead: () => 0,
    adcFullScale: 1023,
    serialBegin: () => {},
    serialWrite: () => {},
    wire: {
      begin: () => {},
      beginTransmission: () => {},
      write: () => 0,
      endTransmission: () => 0,
      requestFrom: () => 0,
      read: () => -1,
      available: () => 0,
    },
  };
  return new FirmwareRunner(source, services);
}

describe('firmware lexer parity', () => {
  it('tokenizes a simple int declaration', () => {
    const src = `int x = 1;`;
    const tsTokens = tokenizeTS(src);
    const wasmTokens = wasm.tokenize(src);
    expect(wasmTokens.length).toBe(tsTokens.length);
    for (let i = 0; i < tsTokens.length; i++) {
      expect(wasmTokens[i].kind).toBe(tsTokens[i].kind);
      expect(wasmTokens[i].text).toBe(tsTokens[i].text);
      expect(wasmTokens[i].line).toBe(tsTokens[i].location.line);
      expect(wasmTokens[i].column).toBe(tsTokens[i].location.column);
      if (tsTokens[i].value !== undefined) {
        expect(wasmTokens[i].value).toBe(tsTokens[i].value);
      }
    }
  });

  it('tokenizes a blink sketch identically to TS', () => {
    const src = `void setup() { pinMode(13, OUTPUT); }\nvoid loop() { digitalWrite(13, HIGH); delay(1000); digitalWrite(13, LOW); delay(1000); }\n`;
    const tsTokens = tokenizeTS(src);
    const wasmTokens = wasm.tokenize(src);
    expect(wasmTokens.length).toBe(tsTokens.length);
    for (let i = 0; i < tsTokens.length; i++) {
      expect(wasmTokens[i].kind).toBe(tsTokens[i].kind);
      expect(wasmTokens[i].text).toBe(tsTokens[i].text);
      expect(wasmTokens[i].line).toBe(tsTokens[i].location.line);
      expect(wasmTokens[i].column).toBe(tsTokens[i].location.column);
      if (tsTokens[i].value !== undefined) {
        expect(wasmTokens[i].value).toBe(tsTokens[i].value);
      }
    }
  });

  it('tokenizes keywords, numbers, strings, and punctuation', () => {
    const src = `#define LED 13\nint x = 42;\nfloat y = 3.14;\nconst char* msg = "hello";\nchar c = 'x';\nif (x > 0) { return x; }\n`;
    const tsTokens = tokenizeTS(src);
    const wasmTokens = wasm.tokenize(src);
    expect(wasmTokens.length).toBe(tsTokens.length);
    for (let i = 0; i < tsTokens.length; i++) {
      expect(wasmTokens[i].kind).toBe(tsTokens[i].kind);
      expect(wasmTokens[i].text).toBe(tsTokens[i].text);
      expect(wasmTokens[i].line).toBe(tsTokens[i].location.line);
      expect(wasmTokens[i].column).toBe(tsTokens[i].location.column);
      if (tsTokens[i].value !== undefined) {
        expect(wasmTokens[i].value).toBe(tsTokens[i].value);
      }
    }
  });

  it('tokenizes all punctuation operators longest-first', () => {
    const src = `a <= b >= c == d != e && f || g ++ -- += -= *= /= %= &= |= ^= <<= >>= << >> -> :: ... ? :\n`;
    const tsTokens = tokenizeTS(src);
    const wasmTokens = wasm.tokenize(src);
    expect(wasmTokens.length).toBe(tsTokens.length);
    for (let i = 0; i < tsTokens.length; i++) {
      expect(wasmTokens[i].kind).toBe(tsTokens[i].kind);
      expect(wasmTokens[i].text).toBe(tsTokens[i].text);
      expect(wasmTokens[i].line).toBe(tsTokens[i].location.line);
      expect(wasmTokens[i].column).toBe(tsTokens[i].location.column);
    }
  });

  it('tokenizes hex, scientific notation, and integer suffixes', () => {
    const src = `0xFF 0Xabc 123L 456UL 1.5e-3 2.5E+2 1000ULL\n`;
    const tsTokens = tokenizeTS(src);
    const wasmTokens = wasm.tokenize(src);
    expect(wasmTokens.length).toBe(tsTokens.length);
    for (let i = 0; i < tsTokens.length; i++) {
      expect(wasmTokens[i].kind).toBe(tsTokens[i].kind);
      expect(wasmTokens[i].text).toBe(tsTokens[i].text);
      expect(wasmTokens[i].line).toBe(tsTokens[i].location.line);
      expect(wasmTokens[i].column).toBe(tsTokens[i].location.column);
      if (tsTokens[i].value !== undefined) {
        expect(wasmTokens[i].value).toBe(tsTokens[i].value);
      }
    }
  });

  it('handles comments and whitespace', () => {
    const src = `// line comment\n/* block comment */\nint /* inline */ x = 1;\n`;
    const tsTokens = tokenizeTS(src);
    const wasmTokens = wasm.tokenize(src);
    expect(wasmTokens.length).toBe(tsTokens.length);
    for (let i = 0; i < tsTokens.length; i++) {
      expect(wasmTokens[i].kind).toBe(tsTokens[i].kind);
      expect(wasmTokens[i].text).toBe(tsTokens[i].text);
      expect(wasmTokens[i].line).toBe(tsTokens[i].location.line);
      expect(wasmTokens[i].column).toBe(tsTokens[i].location.column);
    }
  });

  it('reports EOF token at end', () => {
    const src = `int x = 1;`;
    const tsTokens = tokenizeTS(src);
    const wasmTokens = wasm.tokenize(src);
    const tsEof = tsTokens[tsTokens.length - 1];
    const wasmEof = wasmTokens[wasmTokens.length - 1];
    expect(tsEof.kind).toBe('eof');
    expect(wasmEof.kind).toBe('eof');
    expect(wasmEof.text).toBe('');
  });
});

describe('firmware parser parity', () => {
  it('parses a ternary expression in variable initializer', () => {
    const src = `int x = a > b ? 1 : 2;`;
    const tsAST = parseFirmware(src);
    const wasmAST = wasm.parse(src);
    // Compare globals array (C++ parser only produces globals)
    expect(wasmAST.globals).toEqual(tsAST.globals);
  });

  it('parses a function declaration with if/else in body (C++ parser)', () => {
    const src = `void setup() { if (a > b) { x = 1; } else { x = 2; } }`;
    const wasmAST = wasm.parse(src);
    expect(wasmAST.globals).toHaveLength(1);
    const func = wasmAST.globals[0];
    expect(func.kind).toBe('functionDecl');
    expect(func.name).toBe('setup');
    expect(func.params).toEqual([]);
    expect(func.body.kind).toBe('block');
    const ifStmt = func.body.statements[0];
    expect(ifStmt.kind).toBe('if');
    expect(ifStmt.condition.kind).toBe('binary');
    expect(ifStmt.condition.operator).toBe('>');
  });

  it('parses if without else in block statement (C++ parser produces expected AST)', () => {
    const src = `{ if (x > 0) { y = 1; } }`;
    const wasmAST = wasm.parse(src);
    expect(wasmAST.globals).toHaveLength(1);
    const block = wasmAST.globals[0];
    expect(block.kind).toBe('block');
    const ifStmt = block.statements[0];
    expect(ifStmt.kind).toBe('if');
    expect(ifStmt.condition.kind).toBe('binary');
    expect(ifStmt.then.kind).toBe('block');
    expect(ifStmt.otherwise).toBeNull();
  });

  it('parses binary expressions with correct precedence', () => {
    const src = `int x = a + b * c;`;
    const tsAST = parseFirmware(src);
    const wasmAST = wasm.parse(src);
    expect(wasmAST.globals).toEqual(tsAST.globals);
  });

  it('parses function calls', () => {
    const src = `int x = foo(1, 2, 3);`;
    const tsAST = parseFirmware(src);
    const wasmAST = wasm.parse(src);
    expect(wasmAST.globals).toEqual(tsAST.globals);
  });

  it('parses member access', () => {
    const src = `int x = obj.field;`;
    const tsAST = parseFirmware(src);
    const wasmAST = wasm.parse(src);
    expect(wasmAST.globals).toEqual(tsAST.globals);
  });

  it('parses array index', () => {
    const src = `int x = arr[5];`;
    const tsAST = parseFirmware(src);
    const wasmAST = wasm.parse(src);
    expect(wasmAST.globals).toEqual(tsAST.globals);
  });

  it('parses unary operators', () => {
    const src = `int x = -a + !b;`;
    const tsAST = parseFirmware(src);
    const wasmAST = wasm.parse(src);
    expect(wasmAST.globals).toEqual(tsAST.globals);
  });

  it('parses multiple global declarations', () => {
    const src = `int a = 1; int b = 2; int c = a + b;`;
    const tsAST = parseFirmware(src);
    const wasmAST = wasm.parse(src);
    expect(wasmAST.globals).toEqual(tsAST.globals);
  });

  it('parses array declaration with initializer', () => {
    const src = `int arr[3] = {1, 2, 3};`;
    const tsAST = parseFirmware(src);
    const wasmAST = wasm.parse(src);
    expect(wasmAST.globals).toEqual(tsAST.globals);
  });

  it('parses string and character literals', () => {
    const src = `char s[] = {'h', 'e', 'l', 'l', 'o'}; char c = 'x';`;
    const tsAST = parseFirmware(src);
    const wasmAST = wasm.parse(src);
    expect(wasmAST.globals).toEqual(tsAST.globals);
  });

  it('parses boolean literals', () => {
    const src = `bool t = true; bool f = false;`;
    const tsAST = parseFirmware(src);
    const wasmAST = wasm.parse(src);
    expect(wasmAST.globals).toEqual(tsAST.globals);
  });

  it('parses hex literals', () => {
    const src = `int h = 0xFF;`;
    const tsAST = parseFirmware(src);
    const wasmAST = wasm.parse(src);
    expect(wasmAST.globals).toEqual(tsAST.globals);
  });

  it('parses compound assignment in declaration', () => {
    const src = `int x = 1; int y = (x += 2);`;
    const tsAST = parseFirmware(src);
    const wasmAST = wasm.parse(src);
    expect(wasmAST.globals).toEqual(tsAST.globals);
  });
});

describe('firmware VM parity', () => {
  it('executes a simple delay and pin write (WASM VM)', () => {
    // Simple sketch: write HIGH, delay 10ms, write LOW
    const src = `pinMode(13, OUTPUT); digitalWrite(13, HIGH); delay(10); digitalWrite(13, LOW);`;
    
    // Load sketch into WASM VM
    const programPtr = wasm.parseProgram(src);
    expect(programPtr).not.toBe(0);
    
    const vmPtr = wasm.vm_create();
    expect(vmPtr).not.toBe(0);
    
    const loadResult = wasm.vm_load_sketch(vmPtr, programPtr);
    expect(loadResult).toBe(0); // 0 = success
    
    // Initial state: pin is LOW
    expect(wasm.vm_pin_level(vmPtr, 13)).toBe(0);
    
    // Run 5ms: should execute pinMode, digitalWrite HIGH, start delay
    let result = wasm.vm_run(vmPtr, 5);
    expect(result).toBeLessThan(0); // Yield pending (delay)
    expect(wasm.vm_pin_level(vmPtr, 13)).toBe(1); // HIGH
    
    // Run 10ms: should complete delay AND execute digitalWrite LOW (vm_run continues after yield)
    result = wasm.vm_run(vmPtr, 10);
    expect(result).toBeGreaterThan(0);
    expect(wasm.vm_pin_level(vmPtr, 13)).toBe(0); // LOW (digitalWrite LOW executed after delay)
    
    // VM should be halted now (program finished)
    expect(wasm.vm_run(vmPtr, 10)).toBe(0);
    
    wasm.vm_destroy(vmPtr);
    wasm.vm_free_program(programPtr);
  });

});