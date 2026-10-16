import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';

const CORE = 'src/features/simulation/avr/wasm/avr-core.wasm';

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

describe('wasm toolchain', () => {
  it('emits avr-core.wasm from AssemblyScript sources', () => {
    expect(existsSync('src/features/simulation/avr/wasm/cpu.ts')).toBe(true);
    expect(existsSync('src/features/simulation/avr/wasm/avr-core.wasm')).toBe(true);
  });

  it('compiles once: a second run against unchanged sources skips', () => {
    // First call repairs staleness if wasm sources changed (one build). The
    // second call must find sources and artifacts in sync and return without
    // rewriting the artifact — the compile-once contract the wasm leg tests
    // rely on instead of paying a full asc run per test invocation.
    execSync('sh scripts/build-avr-wasm.sh', { encoding: 'utf8' });
    const before = statSync(CORE);
    const hashBefore = sha256(CORE);
    const output = execSync('sh scripts/build-avr-wasm.sh', { encoding: 'utf8' });
    expect(output).toContain('avr-core.wasm up to date');
    expect(output).toContain('skipping rebuild');
    expect(sha256(CORE)).toBe(hashBefore);
    expect(statSync(CORE).mtimeMs).toBe(before.mtimeMs);
  }, 120_000);
});
