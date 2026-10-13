import { describe, expect, it } from 'vitest';
import { AvrBackend } from './core';
import { McuRuntime } from '@/features/simulation/mcu';
import { arduinoUnoR3 } from '@/features/parts';

describe('slice2 millis parity', () => {
  it('advances millis identically on blink', async () => {
    const { millisParity } = await import('./wasm-core');
    const r = await millisParity(2);
    expect(r.wasm).toBe(r.js);
  });
});
