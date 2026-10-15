import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createSimCore } from './core';
import { boardOption } from '@/features/learn/boardRegistry';

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

const WORDS = new Uint16Array([0x0000, 0x0000]);

describe('worker wasm attach', () => {
  it('attaches to a flashed backend when the flag is set', async () => {
    const core = createSimCore(boardOption('uno').make());
    core.rebuild(bench(), firmware, 'interpreter', true, realBytes);
    core.flash(WORDS);
    await new Promise((r) => setTimeout(r, 500));
    expect(core.wasmAttached).toBe(true);
    expect(core.fault).toBeNull();
  });

  it('stays detached with the flag off', async () => {
    const core = createSimCore(boardOption('uno').make());
    core.rebuild(bench(), firmware, 'interpreter', false, realBytes);
    core.flash(WORDS);
    await new Promise((r) => setTimeout(r, 500));
    expect(core.wasmAttached).toBe(false);
    expect(core.fault).toBeNull();
  });

  it('never attaches a stale load to a newer backend', async () => {
    let release!: (v: ArrayBuffer) => void;
    const gate = new Promise<ArrayBuffer>((res) => { release = res; });
    const core = createSimCore(boardOption('uno').make());
    core.rebuild(bench(), firmware, 'interpreter', true, () => gate);
    core.flash(WORDS);
    core.rebuild(bench(), firmware, 'interpreter', true, realBytes);
    core.flash(WORDS);
    const buf = readFileSync('src/features/simulation/avr/wasm/avr-core.wasm');
    release(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    await new Promise((r) => setTimeout(r, 800));
    expect(core.wasmAttached).toBe(true);
    expect(core.fault).toBeNull();
  });
});
