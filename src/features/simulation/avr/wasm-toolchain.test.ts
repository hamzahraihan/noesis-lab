import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';

describe('wasm toolchain', () => {
  it('emits avr-core.wasm from AssemblyScript sources', () => {
    expect(existsSync('src/features/simulation/avr/wasm/cpu.ts')).toBe(true);
    expect(existsSync('src/features/simulation/avr/wasm/avr-core.wasm')).toBe(true);
  });
});
