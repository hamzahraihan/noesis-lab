export interface WasmCore {
  stepCycles(n: number): void;
  getCycles(): number;
  getPc(): number;
}

export async function loadWasmCore(): Promise<WebAssembly.Module | null> {
  return null;
}
