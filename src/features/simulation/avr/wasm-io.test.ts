import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

async function ioExports(): Promise<
  Record<string, CallableFunction> & { memory: WebAssembly.Memory }
> {
  execSync('sh scripts/build-avr-wasm.sh', { stdio: 'pipe' });
  const bytes = readFileSync('src/features/simulation/avr/wasm/avr-core.wasm');
  const instance = await WebAssembly.instantiate(await WebAssembly.compile(bytes), {});
  return instance.exports as never;
}

describe('wasm io', () => {
  it('round-trips pin levels written from JS', async () => {
    const exports = await ioExports();
    const view = new Uint8Array(exports.memory.buffer);
    const base = (exports.pin_base as () => number)();
    view[base + 13] = 1;
    view[base + 12] = 0;
    const pinLevel = exports.pin_level as (g: number) => number;
    // Note: wasm i32 results arrive as JS numbers (1/0), never JS booleans —
    // coerce at the boundary; the AS-side type stays `boolean` per interface.
    expect(Boolean(pinLevel(13))).toBe(true);
    expect(Boolean(pinLevel(12))).toBe(false);
  }, 120000);

  it('queues port events in order across wrap', async () => {
    const exports = await ioExports();
    (exports.event_clear as () => void)();
    const push = exports.event_push as (g: number, h: number) => void;
    for (let i = 0; i < 70; i++) push(i % 20, i % 2);
    expect((exports.event_count as () => number)()).toBe(64);
    // Oldest-kept entry is index 6 (70 pushes keep 6..69): slot (6 % 64),
    // gpio 6 % 20 = 6, high 6 % 2 = 0.
    const ebase = (exports.event_base as () => number)();
    const view = new Uint8Array(exports.memory.buffer);
    expect(view[ebase + (6 % 64) * 2]).toBe(6);
    expect(view[ebase + (6 % 64) * 2 + 1]).toBe(0);
  }, 120000);
});
