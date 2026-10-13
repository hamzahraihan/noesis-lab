/* HARNESS-ONLY / DO NOT SHIP as gate evidence */
import { describe, expect, it } from 'vitest';

describe('slice2 millis parity', () => {
  it('advances millis identically on blink', async () => {
    const { millisParity } = await import('./wasm-core');
    const r = await millisParity(2);
    expect(r.wasm).toBe(r.js);
  });
});
