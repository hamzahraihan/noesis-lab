import { describe, expect, it } from 'vitest';
import { CPU } from 'avr8js';

describe('batch1 differential', () => {
  it('matches JS register file after lds/sts/in/out sequence', async () => {
    const { batch1Parity } = await import('./wasm-core');
    const r = await batch1Parity();
    expect(r.equal).toBe(true);
  });
});
