import { describe, expect, it } from 'vitest';

describe('measured gate', () => {
  it('reads real glass and serial with a measured trap rate', async () => {
    const { cpuGateMeasured } = await import('./wasm-core');
    const r = await cpuGateMeasured();
    expect(typeof r.trapRate).toBe('number');
    expect(typeof r.glass).toBe('string');
    expect(typeof r.serialEqual).toBe('boolean');
    expect(r.glass.length).toBeGreaterThan(0);
  }, 90000);
});
