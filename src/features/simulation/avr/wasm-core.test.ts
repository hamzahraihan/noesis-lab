import { describe, expect, it } from 'vitest';
import { loadWasmCore } from './wasm-core';

describe('wasm-core seam', () => {
  it('returns null (fallback) when no module built yet', async () => {
    await expect(loadWasmCore()).resolves.toBeNull();
  });
});
