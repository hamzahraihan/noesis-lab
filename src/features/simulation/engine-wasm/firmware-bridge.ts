/**
 * WebAssembly bridge for the firmware lexer (vm_tokenize).
 *
 * The C++ core in `firmware.cpp` exports `vm_tokenize` which writes tokens
 * into a caller-allocated buffer. This module packs the source string into
 * wasm linear memory, calls the exported function, and unpacks the tokens
 * back into TypeScript objects.
 *
 * The token layout mirrors firmware.h:
 *   struct Token {
 *     uint8_t kind;     // TokenKind enum
 *     uint32_t text;    // offset into wasm linear memory
 *     double value;     // for NUMBER tokens
 *     int32_t line;
 *     int32_t column;
 *     uint32_t file;    // offset into wasm linear memory
 *   };
 */
import { readFileSync } from 'node:fs';
import { instantiateEngine, type EngineExports } from './engine';

const TOKEN_KIND = {
  NUMBER: 0,
  STRING: 1,
  CHAR: 2,
  IDENTIFIER: 3,
  PUNCTUATION: 4,
  KEYWORD: 5,
  DIRECTIVE: 6,
  EOF_: 7,
} as const;

const KIND_TO_STRING: Record<number, string> = {
  0: 'number',
  1: 'string',
  2: 'char',
  3: 'identifier',
  4: 'punctuation',
  5: 'keyword',
  6: 'directive',
  7: 'eof',
};

export interface WasmToken {
  kind: string;
  text: string;
  value?: number;
  line: number;
  column: number;
}

export interface WasmFirmware {
  tokenize(source: string): WasmToken[];
}

let firmwareExports: EngineExports & {
  vm_tokenize(
    source: number,
    source_len: number,
    out: number,
    out_capacity: number,
    file: number,
    file_len: number
  ): number;
} | null = null;

const TOKEN_SIZE = 32; // 1 + 3(pad) + 4 + 8 + 4 + 4 + 4 = 32 bytes (aligned)

export async function loadWasmFirmware(): Promise<WasmFirmware> {
  if (firmwareExports === null) {
    const buffer = readFileSync('src/features/simulation/engine-wasm/solver.wasm');
    const bytes = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer;
    const exports = await instantiateEngine(async () => bytes);
    // vm_tokenize will be added to the wasm exports when firmware.cpp is compiled
    firmwareExports = exports as typeof firmwareExports;
  }
  return new WasmFirmwareImpl(firmwareExports);
}

class WasmFirmwareImpl implements WasmFirmware {
  private tokenPtr = 0;
  private tokenCapacity = 0;
  private sourcePtr = 0;
  private sourceCapacity = 0;
  private filePtr = 0;
  private fileCapacity = 0;

  constructor(
    private readonly exports: EngineExports & {
      vm_tokenize(
        source: number,
        source_len: number,
        out: number,
        out_capacity: number,
        file: number,
        file_len: number
      ): number;
      vm_debug_source(source: number, source_len: number, n: number): number;
      vm_debug_tokenize(source: number, source_len: number, file: number, file_len: number): number;
    }
  ) {}

  tokenize(source: string): WasmToken[] {
    // Upload source string
    const sourceBytes = new TextEncoder().encode(source);
    const sourceAllocation = this.allocateSource(sourceBytes);
    const fileName = 'main.ino';
    const fileBytes = new TextEncoder().encode(fileName);
    const fileAllocation = this.allocateFile(fileBytes);

    // Estimate token count (rough heuristic: 1 token per ~3 chars + some margin)
    const estimatedTokens = Math.max(32, Math.ceil(source.length / 3) + 16);
    const tokenAllocation = this.allocateTokens(estimatedTokens);

    const count = this.exports.vm_tokenize(
      sourceAllocation.ptr,
      sourceBytes.length,
      tokenAllocation.ptr,
      estimatedTokens,
      fileAllocation.ptr,
      fileBytes.length
    );

    if (count < 0) {
      throw new Error(`vm_tokenize failed with error code ${count}`);
    }

    const tokens: WasmToken[] = [];
    const view = new DataView(this.exports.memory.buffer);

    for (let i = 0; i < count; i++) {
      const base = tokenAllocation.ptr + i * TOKEN_SIZE;
      const kind = view.getUint8(base);
      const textOffset = view.getUint32(base + 4, true);
      const value = view.getFloat64(base + 8, true);
      const line = view.getInt32(base + 16, true);
      const column = view.getInt32(base + 20, true);
      // file offset at base + 24 (we don't use it for now)

      const text = this.readString(textOffset);
      const kindStr = KIND_TO_STRING[kind] ?? 'unknown';

      const token: WasmToken = {
        kind: kindStr,
        text,
        line,
        column,
      };

      if (kind === TOKEN_KIND.NUMBER) {
        token.value = value;
      }

      tokens.push(token);
    }

    return tokens;
  }

  private allocateSource(bytes: Uint8Array): { ptr: number; capacity: number } {
    const allocation = this.allocate(this.sourcePtr, this.sourceCapacity, bytes.length + 1);
    this.sourcePtr = allocation.ptr;
    this.sourceCapacity = allocation.capacity;

    const memory = new Uint8Array(this.exports.memory.buffer, this.sourcePtr, bytes.length + 1);
    memory.set(bytes);
    memory[bytes.length] = 0; // null terminator

    return { ptr: this.sourcePtr, capacity: this.sourceCapacity };
  }

  private allocateFile(bytes: Uint8Array): { ptr: number; capacity: number } {
    const allocation = this.allocate(this.filePtr, this.fileCapacity, bytes.length + 1);
    this.filePtr = allocation.ptr;
    this.fileCapacity = allocation.capacity;

    const memory = new Uint8Array(this.exports.memory.buffer, this.filePtr, bytes.length + 1);
    memory.set(bytes);
    memory[bytes.length] = 0; // null terminator

    return { ptr: this.filePtr, capacity: this.fileCapacity };
  }

  private allocateTokens(count: number): { ptr: number; capacity: number } {
    const bytes = count * TOKEN_SIZE;
    const allocation = this.allocate(this.tokenPtr, this.tokenCapacity, bytes);
    this.tokenPtr = allocation.ptr;
    this.tokenCapacity = allocation.capacity;
    return { ptr: this.tokenPtr, capacity: this.tokenCapacity };
  }

  private allocate(
    ptr: number,
    capacity: number,
    bytes: number
  ): { ptr: number; capacity: number } {
    if (bytes <= capacity) return { ptr, capacity };
    const next = this.exports.wasm_alloc(bytes);
    if (next === 0) throw new Error('firmware.wasm: out of memory');
    return { ptr: next, capacity: bytes };
  }

  private readString(offset: number): string {
    if (offset === 0) return '';
    const memory = new Uint8Array(this.exports.memory.buffer);
    let len = 0;
    while (offset + len < memory.length && memory[offset + len] !== 0) {
      len++;
    }
    return new TextDecoder().decode(memory.subarray(offset, offset + len));
  }
}