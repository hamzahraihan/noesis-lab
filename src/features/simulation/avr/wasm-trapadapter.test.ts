import { describe, expect, it } from 'vitest';

describe('trap adapter', () => {
  it('resumes past traps until cycles are consumed', async () => {
    const { runSlice } = await import('./wasm-core');
    let calls = 0;
    const shadow = {
      stepOnce: () => {
        calls += 1;
        return calls < 3;
      },
    };
    const fake = { step: () => 0, get_cycles: () => calls };
    const r = await runSlice(fake as never, shadow, 10);
    expect(r.traps).toBe(3);
    expect(calls).toBe(3);
  });
});
