import { describe, expect, it } from 'vitest';
import { pumpShadowClock } from './wasm-core';

describe('clock pump', () => {
  it('invokes the tick callback exactly cycles times', () => {
    let calls = 0;
    pumpShadowClock(() => {
      calls += 1;
    }, 16000);
    expect(calls).toBe(16000);
    const t0 = performance.now();
    pumpShadowClock(() => {}, 16000);
    console.log(`pump16000 wallMs=${(performance.now() - t0).toFixed(1)}`);
  });
});
