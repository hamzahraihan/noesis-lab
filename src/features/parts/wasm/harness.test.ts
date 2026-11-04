/**
 * Differential test harness for the C++ parts module vs TypeScript oracle.
 *
 * Loads the committed parts.wasm, instantiates both probes for each fixture,
 * applies the same stimuli, and compares observations.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadPartsModule,
  readBusStateSnapshot,
  BUS_STATE_SNAPSHOT_SIZE,
  type BusStateSnapshot,
  type PartsModule,
} from './parts-module';
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
    expect(module.part_get_state).toBeTypeOf('function');
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

  // One test per registered fixture: the list is the source, so a fixture that
  // is registered but has no hardcoded `it()` still runs.
  for (const fixture of FIXTURE_LIST) {
    it(`${fixture.part} matches TS oracle`, () => runFixture(fixture));
  }

  it('every adapter has a fixture and every fixture has an adapter', () => {
    const adapterKinds = Object.keys(ADAPTERS).sort();
    const fixtureKinds = Object.keys(FIXTURES).sort();
    expect(fixtureKinds).toEqual(adapterKinds);
    expect(FIXTURES).toEqual(
      Object.fromEntries(FIXTURE_LIST.map((f) => [f.part, f])),
    );
  });
});

/**
 * `bus_reset()` is the seam between two simulation cycles: a caller tears the
 * bus down and builds the next circuit on top of the same module instance. Any
 * counter or pointer that survives the reset makes cycle two depend on cycle
 * one, so these tests drive a whole cycle, reset, and drive it again.
 */
describe('bus_reset clears bus state between cycles', () => {
  const SHIFT595 = FIXTURES.shift595;
  const spiTransfers = SHIFT595.stimuli.filter(
    (s): s is Extract<Stimulus, { kind: 'spi-transfer' }> => s.kind === 'spi-transfer',
  );

  /** Reads bus_get_state() through the C ABI, the same view a caller has. */
  function readBusState(): BusStateSnapshot {
    const ptr = module.wasmMemory.allocBytes(BUS_STATE_SNAPSHOT_SIZE);
    module.bus_get_state(ptr);
    return readBusStateSnapshot(module.wasmMemory, ptr);
  }

  /** One full simulation cycle: create the part, apply every stimulus, observe. */
  function runCycle(): { values: number[]; bus: BusStateSnapshot } {
    const probe = new WasmPartProbe(SHIFT595.part, SHIFT595.factoryArgs, module, ADAPTERS);
    for (const stimulus of SHIFT595.stimuli) probe.apply(stimulus);
    return { values: probe.observe().values, bus: readBusState() };
  }

  // Leave the module the way beforeAll found it, so a reordering of the suites
  // above cannot turn this one into cross-test state.
  afterEach(() => {
    module.bus_reset();
    module.i2c_bus_init(0, 0);
    module.spi_bus_init(0, 0, 0, 0);
  });

  it('counts each clocked SPI byte', () => {
    module.spi_bus_init(0, 0, 0, 0);
    module.spi_bus_begin();
    module.spi_bus_transfer(0x5a, 1, 1);

    const bus = readBusState();
    expect(bus.spi_selected).toBe(true);
    expect(bus.spi_payload_len).toBe(1);
    expect(bus.spi_payload[0]).toEqual({ value: 0x5a, data_select: true });
    expect(bus.spi_transfers_count).toBe(1);
  });

  it('does not count a transfer while the bus is deselected', () => {
    // No spi_bus_begin(): spi_bus_transfer returns early without clocking.
    module.spi_bus_init(0, 0, 0, 0);
    module.spi_bus_transfer(0x42, 0, 1);

    expect(readBusState().spi_transfers_count).toBe(0);
  });

  it('reports the cycle transfer count, then zero after bus_reset', () => {
    const cycle = runCycle();
    // The fixture, not the implementation, says how many bytes go out.
    expect(cycle.bus.spi_transfers_count).toBe(spiTransfers.length);

    module.bus_reset();
    expect(readBusState().spi_transfers_count).toBe(0);
  });

  it('a second cycle after bus_reset behaves like a fresh one', () => {
    const first = runCycle();

    module.bus_reset();
    const second = runCycle();

    // Same part state, and the same transfer count rather than 2x the first
    // cycle: nothing accumulated across the reset.
    expect(second.values).toEqual(first.values);
    expect(second.bus.spi_transfers_count).toBe(spiTransfers.length);

    // Anchored to the TypeScript oracle, not just to cycle one, so a reset that
    // reproduces a stale cycle deterministically still fails.
    const tsProbe = new TsDeviceProbe(ADAPTERS[SHIFT595.part], SHIFT595.factoryArgs);
    for (const stimulus of SHIFT595.stimuli) tsProbe.apply(stimulus);
    expect(second.values).toEqual(tsProbe.observe().values);
  });
});