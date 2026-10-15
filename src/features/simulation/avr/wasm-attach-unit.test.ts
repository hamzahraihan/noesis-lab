import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadWasmModule, WASM_DEFAULT, resolveWasmFlag } from './wasm-core';

const realBytes = () => {
  const buf = readFileSync('src/features/simulation/avr/wasm/avr-core.wasm');
  return Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
};
const emptyModuleBytes = () => Promise.resolve(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]).buffer as ArrayBuffer);

describe('loadWasmModule', () => {
  it('loads the committed module with capped flash and zeroed reset', async () => {
    const r = await loadWasmModule(realBytes);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    r.module.flashWords(new Uint16Array(600).fill(0x0000));
    expect(r.module.core.getPc()).toBe(0);
    expect(r.module.core.step(600)).toBe(512);
    expect(r.module.core.getPc()).toBe(512);
  });

  it('refuses a version-skewed module with a wasm cause', async () => {
    const r = await loadWasmModule(emptyModuleBytes);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.cause.startsWith('wasm ')).toBe(true);
  });

  it('reports fetch failure with a wasm cause', async () => {
    const r = await loadWasmModule(() => Promise.reject(new Error('offline')));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.cause).toBe('wasm fetch failed: offline');
  });
});

describe('rollout default', () => {
  it('defaults off until the gates pass', () => {
    expect(WASM_DEFAULT).toBe(false);
  });

  it('explicit choice always wins over the default', () => {
    expect(resolveWasmFlag(true)).toBe(true);
    expect(resolveWasmFlag(false)).toBe(false);
    expect(resolveWasmFlag(undefined)).toBe(WASM_DEFAULT);
  });
});
