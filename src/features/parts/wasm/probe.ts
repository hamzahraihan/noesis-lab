/**
 * Differential probe interface and implementations.
 *
 * A probe wraps either the C++ wasm module (WasmPartProbe) or the TypeScript
 * oracle (TsDeviceProbe) and presents a uniform stimulus/observation API.
 */

import type { PartsModule } from './parts-module';

/** A single stimulus applied to a part. */
export type Stimulus =
  | { kind: 'i2c-write'; address: number; bytes: number[] }
  | { kind: 'i2c-read'; address: number; count: number }
  | { kind: 'spi-transfer'; byte: number; dc: boolean; cs: boolean }
  | { kind: 'pin'; index: number; high: boolean }
  | { kind: 'knob'; name: string; value: number };

/** An observation: labeled scalar values. */
export type Observation = { labels: string[]; values: number[] };

/** Adapter interface: translates between probe stimuli and the underlying oracle. */
export interface PartAdapter {
  /** Unique kind identifier (e.g., 'pcf8574', 'mcp23017'). */
  readonly kind: string;
  /** Labels for each scalar in the observation, in order. */
  readonly labels: string[];
  /** Creates the oracle instance (TS device or wasm handle). */
  create(factoryArgs: unknown[], module?: PartsModule): unknown;
  /** Applies a stimulus to the oracle instance. */
  apply(instance: unknown, stimulus: Stimulus, module?: PartsModule): void;
  /** Reads the current scalar state from the oracle instance. */
  readScalars(instance: unknown, module?: PartsModule): number[];
  /** Resets the oracle to initial state (called between fixtures). */
  reset?(instance: unknown, module?: PartsModule): void;
}

/** Uniform probe interface. */
export interface PartProbe {
  /** Applies a stimulus. */
  apply(stimulus: Stimulus): void;
  /** Returns the current observation. */
  observe(): Observation;
  /** Resets the probe to initial state. */
  reset(): void;
}

/** Probe that drives the C++ wasm module. */
export class WasmPartProbe implements PartProbe {
  private handle: number;
  private adapter: PartAdapter;

  constructor(
    kind: string,
    factoryArgs: unknown[],
    private module: PartsModule,
    adapters: Record<string, PartAdapter>
  ) {
    const adapter = adapters[kind];
    if (!adapter) throw new Error(`No adapter for part kind: ${kind}`);
    this.adapter = adapter;
    this.handle = adapter.create(factoryArgs, module) as number;
  }

  apply(stimulus: Stimulus): void {
    this.adapter.apply(this.handle, stimulus, this.module);
  }

  observe(): Observation {
    const values = this.adapter.readScalars(this.handle, this.module);
    return { labels: this.adapter.labels, values };
  }

  reset(): void {
    this.module.bus_reset();
    this.adapter.reset?.(this.handle, this.module);
  }
}

/** Probe that drives a TypeScript oracle device. */
export class TsDeviceProbe implements PartProbe {
  private instance: unknown;

  constructor(
    private adapter: PartAdapter,
    factoryArgs: unknown[]
  ) {
    this.instance = adapter.create(factoryArgs);
  }

  apply(stimulus: Stimulus): void {
    this.adapter.apply(this.instance, stimulus);
  }

  observe(): Observation {
    const values = this.adapter.readScalars(this.instance);
    return { labels: this.adapter.labels, values };
  }

  reset(): void {
    this.adapter.reset?.(this.instance);
  }
}

import { ADAPTERS } from './adapters';

/** Re-export the adapter registry for convenience. */
export { ADAPTERS };