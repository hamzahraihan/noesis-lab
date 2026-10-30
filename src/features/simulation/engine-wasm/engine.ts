/**
 * One wasm instance for the C++ simulation core.
 *
 * The module carries the solver and the netlist builder; both bridges
 * (`solver.ts`, `netlist.ts`) share this loader so the profile table and the
 * heap are one. The TypeScript engine remains the default until the final
 * cutover, so this loader is only reached by the parity tests and later phases.
 *
 * The only imports are `js_exp`, `js_log1p` and `js_pow`, which are the exact
 * V8 functions the TypeScript oracle calls.
 */

export interface EngineExports {
  readonly memory: WebAssembly.Memory;
  wasm_alloc(bytes: number): number;
  set_profiles(values: number, count: number): number;

  solve(
    elements: number,
    elementCount: number,
    nodeCount: number,
    dt: number,
    previous: number,
    previousCount: number,
    maxIterations: number,
    tolerance: number,
  ): number;
  result_voltages(): number;
  result_source_currents(): number;
  result_iterations(): number;
  element_current(
    index: number,
    elements: number,
    elementCount: number,
    volts: number,
    nodeCount: number,
  ): number;

  build_netlist(
    terminals: number,
    terminalCount: number,
    parts: number,
    partCount: number,
    pins: number,
    pinCount: number,
    knobs: number,
    knobCount: number,
    wires: number,
    wireCount: number,
    groundTerminals: number,
    groundCount: number,
    keyLabels: number,
    keyLabelCount: number,
    strings: number,
    stringsBytes: number,
    irTransmitting: number,
    redProfile: number,
    greenProfile: number,
    blueProfile: number,
  ): number;
  netlist_node_of_terminal(): number;
  netlist_node_count(): number;
  netlist_elements(): number;
  netlist_element_count(): number;
  netlist_labels(): number;

  // AVR CPU core (issue #20, phase 3), exposed from the same module.
  cpu_step(budgetCycles: number): number;
  cpu_get_pc(): number;
  cpu_set_pc(v: number): void;
  cpu_get_reg(i: number): number;
  cpu_set_reg(i: number, v: number): void;
  cpu_get_sreg(): number;
  cpu_set_sreg(v: number): void;
  cpu_get_sp(): number;
  cpu_set_sp(v: number): void;
  cpu_get_cycles(): number;
  cpu_set_cycles(v: number): void;
  cpu_get_instructions(): number;
  cpu_get_flash_capacity(): number;
  cpu_reset(): void;
  cpu_write_pin(gpio: number, high: number): void;
  cpu_pin_level(gpio: number): number;
  cpu_flash_base(): number;
}

/** Loads the committed wasm artifact. `loadBytes` is the test seam. */
export async function instantiateEngine(
  loadBytes: () => Promise<ArrayBuffer> = defaultLoadBytes,
): Promise<EngineExports> {
  const module = await WebAssembly.compile(await loadBytes());
  const instance = await WebAssembly.instantiate(module, {
    env: { js_exp: Math.exp, js_log1p: Math.log1p, js_pow: Math.pow },
  });
  const exports = instance.exports as unknown as EngineExports;
  if (typeof exports.solve !== 'function' || typeof exports.build_netlist !== 'function') {
    throw new Error('solver.wasm: missing engine exports (rebuild with npm run build:engine)');
  }
  return exports;
}

async function defaultLoadBytes(): Promise<ArrayBuffer> {
  const response = await fetch(new URL('./solver.wasm', import.meta.url));
  if (!response.ok) throw new Error(`solver.wasm: HTTP ${response.status}`);
  return response.arrayBuffer();
}
