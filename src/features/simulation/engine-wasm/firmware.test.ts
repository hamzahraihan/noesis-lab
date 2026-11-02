/**
 * Parity gate for the firmware lexer: C++ Wasm `vm_tokenize` vs TypeScript `tokenize`.
 *
 * The C++ lexer is a direct port of `tokenize()` from `../firmware/parser.ts`
 * (lines 161–end). This test asserts identical token kinds, text, line, and column
 * for a representative Arduino sketch.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { tokenize as tokenizeTS } from '@/features/simulation/firmware/parser';
import { loadWasmFirmware, type WasmFirmware } from './firmware-bridge';

let wasm: WasmFirmware;

beforeAll(async () => {
  wasm = await loadWasmFirmware();
});

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