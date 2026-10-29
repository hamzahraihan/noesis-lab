import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createSimCore } from './core';
import { boardOption } from '@/features/learn/boardRegistry';
import { parseIntelHex } from '@/features/simulation/avr/hex';

const realBytes = () => {
  const buf = readFileSync('src/features/simulation/avr/wasm/avr-core.wasm');
  return Promise.resolve(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
  );
};

function bench() {
  return { parts: [], wires: [], terminals: [], revision: 0 } as never;
}

const firmware = {
  language: 'arduino-cpp',
  activeName: 'main.ino',
  files: [{ name: 'main.ino', content: 'void setup() {}\nvoid loop() {}\n' }],
} as never;

/**
 * The alarm-clock library build is ~16 KB of AVR flash. While the wasm flash
 * region was 512 words, every instruction past the first 1 KB trapped to the
 * JS shadow one at a time, and a 16 ms slice spent ~2.6 billion iterations
 * doing it: the worker stopped answering and the bench looked frozen.
 */
describe('wasm runs firmware larger than its old flash cap', () => {
  it('completes a frame in bounded time with the alarm library image', async () => {
    const words = parseIntelHex(
      readFileSync('src/features/simulation/avr/hex/alarm-clock-lib-uno.hex', 'utf8'),
    );
    // The regression only exists above the old 512-word cap.
    expect(words.length).toBeGreaterThan(1024);

    const core = createSimCore(boardOption('uno').make());
    core.rebuild(bench(), firmware, 'interpreter', true, realBytes);
    core.flash(words);
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(core.wasmAttached).toBe(true);
    expect(core.fault).toBeNull();

    const startedAt = core.timeMs;
    const t0 = performance.now();
    core.step(16);
    const wallMs = performance.now() - t0;

    // Before the fix this single frame ran for minutes (effectively forever).
    expect(wallMs).toBeLessThan(1000);
    expect(core.timeMs).toBeGreaterThan(startedAt);
    expect(core.fault).toBeNull();
  });
});
