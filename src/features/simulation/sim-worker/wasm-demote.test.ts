import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createSimCore } from './core';
import { boardOption } from '@/features/learn/boardRegistry';

// NOTE (brief deviation): the brief's `readFileSync(...).buffer` hands
// WebAssembly.compile pool garbage (Buffer is a pooled view; here byteLength
// 1015 at byteOffset 8 in an 8192-byte pool), so attach always fails. Same fix
// as Task 1's committed wasm-attach.test.ts: slice the exact bytes.
const realBytes = () => {
  const buf = readFileSync('src/features/simulation/avr/wasm/avr-core.wasm');
  return Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
};

function bench() {
  return { parts: [], wires: [], terminals: [], revision: 0 } as never;
}

const firmware = {
  language: 'arduino-cpp',
  activeName: 'main.ino',
  files: [{ name: 'main.ino', content: 'void setup() {}\nvoid loop() {}\n' }],
} as never;

// NOTE (brief deviation): the brief's `flash([0xffff])` cannot fault — avr8js
// treats undecoded opcodes as NOPs and never throws (documented in
// src/features/simulation/avr/wasm-fault.test.ts:11-13; avr8js@0.21.1 has no
// throwing instruction path, and the attached slice catches wasm-side throws
// internally). So the backend fault precondition is established directly by
// injecting the exact `core fault at PC=…` string the backend produces on a
// hook throw (see that same fault test) — the unit under test is SimCore's
// demotion response to `avrBackend.fault`, not fault production itself.
// Private-field casts follow the existing precedent in avr/wasm-fault.test.ts.
function injectBackendFault(core: ReturnType<typeof createSimCore>, fault: string): void {
  const seam = core as unknown as { avrBackend: unknown };
  (seam.avrBackend as unknown as { failed: string | null }).failed = fault;
}

describe('wasm runtime demotion', () => {
  it('prefixes the cause and continues on the interpreter after a fault', async () => {
    const core = createSimCore(boardOption('uno').make());
    core.rebuild(bench(), firmware, 'interpreter', true, realBytes);
    core.flash(new Uint16Array([0x0000, 0x0000]));
    await new Promise((r) => setTimeout(r, 500));
    expect(core.wasmAttached).toBe(true);
    injectBackendFault(core, 'core fault at PC=0 cycles=1: Error: pin boom');
    core.step(5);
    expect(core.wasmAttached).toBe(false);
    expect(String(core.fault).startsWith('wasm ')).toBe(true);
    expect(() => core.step(5)).not.toThrow();
  });

  it('never re-attaches after a demotion', async () => {
    const core = createSimCore(boardOption('uno').make());
    core.rebuild(bench(), firmware, 'interpreter', true, realBytes);
    core.flash(new Uint16Array([0x0000, 0x0000]));
    await new Promise((r) => setTimeout(r, 500));
    expect(core.wasmAttached).toBe(true);
    injectBackendFault(core, 'core fault at PC=0 cycles=1: Error: pin boom');
    core.step(5);
    expect(core.wasmAttached).toBe(false);
    core.flash(new Uint16Array([0x0000]));
    await new Promise((r) => setTimeout(r, 500));
    expect(core.wasmAttached).toBe(false);
  });
});
