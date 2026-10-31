/**
 * Differential test harness for the C++ parts module vs TypeScript oracle.
 *
 * Loads the committed parts.wasm, instantiates both probes for each fixture,
 * applies the same stimuli, and compares observations.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadPartsModule, type PartsModule } from './parts-module';
import { WasmPartProbe, TsDeviceProbe, ADAPTERS, type Stimulus } from './probe';
import { FIXTURES, FIXTURE_LIST, type Fixture } from './fixtures';

let module: PartsModule;

beforeAll(async () => {
  const wasmPath = join(__dirname, 'parts.wasm');
  const buffer = readFileSync(wasmPath);
  const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  module = await loadPartsModule(async () => bytes);
  
  // Initialize bus state before any part creation
  module.bus_reset();
  module.i2c_bus_init(0, 0);
  module.spi_bus_init(0, 0, 0, 0);
});

function runFixture(fixture: Fixture): void {
  const adapter = ADAPTERS[fixture.part];
  if (!adapter) throw new Error(`No adapter for part: ${fixture.part}`);

  const wasmProbe = new WasmPartProbe(fixture.part, fixture.factoryArgs, module, ADAPTERS);
  const tsProbe = new TsDeviceProbe(adapter, fixture.factoryArgs);

  for (const stimulus of fixture.stimuli) {
    wasmProbe.apply(stimulus);
    tsProbe.apply(stimulus);
  }

  const wasmObs = wasmProbe.observe();
  const tsObs = tsProbe.observe();

  expect(wasmObs.labels).toEqual(fixture.labels);
  expect(tsObs.labels).toEqual(fixture.labels);
  expect(wasmObs.values.length).toBe(fixture.labels.length);
  expect(tsObs.values.length).toBe(fixture.labels.length);

  for (let i = 0; i < fixture.labels.length; i++) {
    const label = fixture.labels[i];
    const wasmVal = wasmObs.values[i];
    const tsVal = tsObs.values[i];
    expect(wasmVal, `${fixture.part}: scalar[${i}] ${label} differs (wasm ${wasmVal}, ts ${tsVal})`)
      .toBe(tsVal);
  }

  wasmProbe.reset();
  tsProbe.reset();
}

describe('Parts differential harness', () => {
  // Loader test: verify wasm loads with all expected exports
  it('loads parts.wasm with all exports and memory', () => {
    expect(module.part_create_i2c_expander).toBeTypeOf('function');
    expect(module.part_get_scalars).toBeTypeOf('function');
    expect(module.bus_reset).toBeTypeOf('function');
    expect(module.memory).toBeInstanceOf(WebAssembly.Memory);
    // Spot-check a few more exports
    expect(module.part_create_adc).toBeTypeOf('function');
    expect(module.part_create_shift_register).toBeTypeOf('function');
    expect(module.i2c_bus_write).toBeTypeOf('function');
    expect(module.spi_bus_transfer).toBeTypeOf('function');
  });

  // Differ test: a deliberately wrong fixture must fail
  it('rejects a mismatched observation (meta-test)', () => {
    const adapter = ADAPTERS.pcf8574;
    const wasmProbe = new WasmPartProbe('pcf8574', [1, 32], module, ADAPTERS);
    // Create a mock TS probe that returns zeros (wrong)
    const mockTsProbe: { apply: (s: Stimulus) => void; observe: () => { labels: string[]; values: number[] } } = {
      apply: () => {},
      observe: () => ({ labels: ['output_reg', 'input_reg'], values: [0, 0] }),
    };

    wasmProbe.apply({ kind: 'i2c-write', address: 32, bytes: [] }); // triggers reset state
    const wasmObs = wasmProbe.observe();
    const tsObs = mockTsProbe.observe();

    let threw = false;
    try {
      for (let i = 0; i < 2; i++) {
        expect(wasmObs.values[i], `meta-test differ at scalar[${i}]`).toBe(tsObs.values[i]);
      }
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  // One test per fixture
  it('pcf8574 matches TS oracle', () => runFixture(FIXTURES.pcf8574));
  it('mcp23017 matches TS oracle', () => runFixture(FIXTURES.mcp23017));
  it('ads1115 matches TS oracle', () => runFixture(FIXTURES.ads1115));
  it('shift595 matches TS oracle', () => runFixture(FIXTURES.shift595));
});