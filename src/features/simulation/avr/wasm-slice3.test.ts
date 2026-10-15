/* HARNESS-ONLY / DO NOT SHIP as gate evidence */
import { describe, expect, it } from 'vitest';

describe('slice3 gate', () => {
  it('logs trap rate and wall time for the alarm library', async () => {
    const { slice3Gate } = await import('./wasm-core');
    const r = await slice3Gate();
    expect(r.trapRate).toBeLessThan(0.01);
    expect(r.glass).toBe('1500');
  }, 60000);
});
