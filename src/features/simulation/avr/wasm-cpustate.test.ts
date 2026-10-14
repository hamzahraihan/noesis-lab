import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

async function instantiate(): Promise<WebAssembly.Instance> {
  execSync('sh scripts/build-avr-wasm.sh', { stdio: 'pipe' });
  const bytes = readFileSync('src/features/simulation/avr/wasm/avr-core.wasm');
  return await WebAssembly.instantiate(await WebAssembly.compile(bytes), {});
}

type CpuExports = {
  reset_cpu(): void;
  get_pc(): number;
  set_pc(v: number): void;
  get_sreg(): number;
  set_sreg(v: number): void;
  step(n: number): number;
  memory: WebAssembly.Memory;
};

describe('wasm cpu state', () => {
  it('round-trips pc and sreg', async () => {
    const instance = await instantiate();
    const exports = instance.exports as unknown as CpuExports;
    exports.reset_cpu();
    exports.set_pc(41);
    expect(exports.get_pc()).toBe(41);
    exports.set_sreg(0xaa);
    expect(exports.get_sreg()).toBe(0xaa);
    exports.reset_cpu();
    expect(exports.get_pc()).toBe(0);
    expect(exports.get_sreg()).toBe(0);
  }, 120000);

  it('allows backwards set_pc', async () => {
    const instance = await instantiate();
    const exports = instance.exports as unknown as CpuExports;
    exports.reset_cpu();
    exports.set_pc(41);
    exports.set_pc(0);
    expect(exports.get_pc()).toBe(0);
  }, 120000);
});
