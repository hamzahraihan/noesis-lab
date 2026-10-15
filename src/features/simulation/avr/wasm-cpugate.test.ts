import { describe, expect, it } from 'vitest';

describe('cpu gate', () => {
  it('runs the alarm library with 0% traps and 1500 glass', async () => {
    const { cpuGate } = await import('./wasm-core');
    const r = await cpuGate();
    expect(r.trapRate).toBe(0);
    expect(r.glass).toBe('1500');
    expect(r.placeholder).toBe(true);
  }, 90000);
});
