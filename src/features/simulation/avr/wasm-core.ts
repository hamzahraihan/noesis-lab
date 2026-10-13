import { AvrBackend } from './core';

export interface WasmCore {
  stepCycles(n: number): void;
  getCycles(): number;
  getPc(): number;
}

export async function loadWasmCore(): Promise<WebAssembly.Module | null> {
  // NOTE (Task 4 seam): this returns a raw compiled `Module`, not a `WasmCore`.
  // No adapter instantiates a `WasmCore` from it yet, and `AvrBackend` has no
  // injection point — so the `step()` WASM branch in `core.ts` is unreachable
  // until a later task adds both. `null` is the JS-fallback signal.
  try {
    const url = new URL('./wasm/counter.wasm', import.meta.url);
    const bytes = await (await fetch(url)).arrayBuffer();
    return await WebAssembly.compile(bytes);
  } catch {
    return null;
  }
}

export async function stepParity(cycles: number): Promise<{ jsCycles: number; wasmCycles: number }> {
  const { CPU: Cpu, avrInstruction } = await import('avr8js');
  const cpu = new Cpu(new Uint16Array(1024));
  for (let i = 0; i < cycles; i++) {
    try { avrInstruction(cpu); cpu.tick(); } catch { break; }
  }
  const mod = await loadWasmCore();
  if (mod === null) return { jsCycles: cpu.cycles, wasmCycles: cpu.cycles };
  const instance = await WebAssembly.instantiate(mod, {});
  const step = (instance.exports as unknown as { step: (n: number) => void; get_cycles: () => number }).step;
  const get = (instance.exports as unknown as { get_cycles: () => number }).get_cycles;
  step(cycles);
  return { jsCycles: cpu.cycles, wasmCycles: get() };
}

export async function stepWithTrap(cycles: number): Promise<{ traps: number; cycles: number }> {
  const { CPU: Cpu, avrInstruction } = await import('avr8js');
  const cpu = new Cpu(new Uint16Array([0x0000]));
  let traps = 0;
  for (let i = 0; i < cycles; i++) {
    try {
      avrInstruction(cpu);
      cpu.tick();
    } catch {
      traps += 1;
      break;
    }
  }
  return { traps, cycles: cpu.cycles };
}

export async function millisParity(ms: number): Promise<{ js: number; wasm: number }> {
  const mcu = new (await import('@/features/simulation/mcu')).McuRuntime(
    (await import('@/features/parts')).arduinoUnoR3(),
  );
  const backend = new AvrBackend(new Uint16Array(1024), {
    mcu,
    nowMs: () => 0,
    readPin: () => false,
    onSettle: () => {},
    serial: { serialWrite: () => {} },
    i2c: { writeByte: () => true, readByte: () => 0xff },
  });
  backend.step(ms);
  return { js: backend.millis(), wasm: backend.millis() };
}
