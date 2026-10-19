/**
 * A part whose behaviour is a script.
 *
 * The data half of custom parts stopped at values: a file can say *what* an
 * unknown sensor is made of, never *what it does*. This is the other half -- a
 * sensor the host has no model for, whose answer comes from a script running in
 * QuickJS compiled to WebAssembly, inside the simulation worker.
 *
 * Deliberate properties, each with a measurement behind it
 * (`docs/superpowers/specs/2026-10-19-behaviour-parts-design.md`):
 *
 * - **No browser APIs, by construction.** QuickJS has no `fetch`, no DOM, no
 *   `localStorage`. The sandbox is the runtime, not a convention.
 * - **The host owns time and randomness.** `Date.now()`, `new Date()` and
 *   `Math.random()` are installed from the host, so the simulated clock is the
 *   solver's and randomness is a seeded PRNG: the same circuit settles the same
 *   way on every machine.
 * - **A call costs ~11 us and a context ~4 ms** (measured, 2026-10-19), so one
 *   context per part is affordable and calling once per solve step is free
 *   enough that no cadence cache is needed.
 * - **Failure is loud and latched.** A throw, a malformed return or an overrun
 *   is one fault for that part, and the part reads as nothing at all from then
 *   on -- never as a plausible number. A run reloads the firmware and the
 *   script, which is the operator's retry.
 *
 * The WASM module is loaded through `createScriptedRuntime`, not at import: this
 * module is reached from the solver, and 492 KB of WASM should not arrive in the
 * bundle because a file mentions a script.
 */

import variant from '@jitl/quickjs-wasmfile-release-sync';
import {
  newQuickJSWASMModuleFromVariant,
  type QuickJSContext,
  type QuickJSHandle,
  type QuickJSRuntime,
  type QuickJSWASMModule,
} from 'quickjs-emscripten-core';

/** The surfaces a scripted part may expose. I2C is the next slice. */
export type ScriptedBus = 'analog' | 'digital';

export interface ScriptedPart {
  /** The part's id, used for the diagnostic and for its context's lifetime. */
  readonly id: string;
  /** The script: an expression (optionally `export default`) yielding the ABI object. */
  readonly script: string;
  readonly bus: ScriptedBus;
}

export interface ScriptedReading {
  /**
   * The part's answer: 0..1 for an analog part, 0 or 1 for a digital one.
   * Undefined when the part has faulted -- the solver must then read nothing,
   * not a default.
   */
  readonly value: number | undefined;
  /** The one problem that stopped this part, or null while it is healthy. */
  readonly fault: string | null;
}

export interface ScriptedRuntime {
  /**
   * The part's answer at `timeMs`, with the operator's knob values.
   *
   * Once a part has faulted this returns the same fault without calling the
   * script again; `knobs` is read fresh on every healthy call.
   */
  read(
    part: ScriptedPart,
    timeMs: number,
    knobs: Readonly<Record<string, number>>,
  ): ScriptedReading;
  dispose(): void;
}

/** Per-call wall-clock budget. Measured calls take ~11 us; this is ~180x that. */
export const SCRIPT_BUDGET_MS = 2;

const ENTRY: Readonly<Record<ScriptedBus, string>> = {
  analog: 'analog',
  digital: 'digital',
};

interface Compiled {
  /** The source this context was compiled from, so an edited script reloads. */
  readonly script: string;
  readonly context: QuickJSContext;
  /** The ABI function, owned by the context. */
  readonly entry: QuickJSHandle;
  fault: string | null;
}

/** A QuickJS error, as one line a person can act on. */
function describeError(context: QuickJSContext, error: QuickJSHandle): string {
  const dumped: unknown = context.dump(error);
  if (typeof dumped === 'object' && dumped !== null) {
    const named = dumped as { name?: unknown; message?: unknown };
    const name = typeof named.name === 'string' ? named.name : 'Error';
    const message = typeof named.message === 'string' ? named.message : JSON.stringify(dumped);
    return `${name}: ${message}`;
  }
  return String(dumped);
}

/** Mulberry32: small, seeded, and identical on every machine. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * A runtime with one JS context per part.
 *
 * Contexts are created on first use, so a bench with no scripted parts pays
 * nothing but the module load, which the caller does before the first run.
 */
export async function createScriptedRuntime(
  options: {
    readonly seed?: number;
  } = {},
): Promise<ScriptedRuntime> {
  const module: QuickJSWASMModule = await newQuickJSWASMModuleFromVariant(variant);
  const runtime: QuickJSRuntime = module.newRuntime();
  const random = seededRandom(options.seed ?? 1);
  const compiled = new Map<string, Compiled>();
  /** The simulated time the context's `Date` answers, set before every call. */
  let nowMs = 0;

  /**
   * The host's `Date` and `Math.random`, installed before the part's script runs.
   *
   * `Date` is replaced rather than patched: `new Date()` with no arguments is
   * the one form that reads the real clock, so the constructor is the thing to
   * shadow. The statics the language expects are carried over.
   */
  function installHost(context: QuickJSContext): void {
    const now = context.newFunction('__now', () => context.newNumber(nowMs));
    const rand = context.newFunction('__random', () => context.newNumber(random()));
    context.setProp(context.global, '__now', now);
    context.setProp(context.global, '__random', rand);
    now.dispose();
    rand.dispose();

    const prelude = context.evalCode(`
      (() => {
        const RealDate = Date;
        function HostDate(...args) {
          return new RealDate(...(args.length === 0 ? [__now()] : args));
        }
        HostDate.now = () => __now();
        HostDate.parse = RealDate.parse;
        HostDate.UTC = RealDate.UTC;
        HostDate.prototype = RealDate.prototype;
        globalThis.Date = HostDate;
        Math.random = () => __random();
        Object.freeze(Math);
        return true;
      })()
    `);
    if (prelude.error) {
      throw new Error(
        `scripted runtime: the host prelude did not load (${context.dump(prelude.error)})`,
      );
    }
  }

  /** Compiles a part's script into its own context, or records why it could not. */
  function compile(part: ScriptedPart): Compiled {
    const context = runtime.newContext();
    installHost(context);
    const source = part.script
      .trim()
      .replace(/^export\s+default\s+/, '')
      .replace(/;+\s*$/, '');
    const result = context.evalCode(
      `(() => { const module = (${source}); return Object.freeze(module); })()`,
      `${part.id}.js`,
    );
    if (result.error) {
      const fault = `the script did not load: ${describeError(context, result.error)}`;
      result.error.dispose();
      return { script: part.script, context, entry: context.undefined, fault };
    }
    const entry = context.getProp(result.value, ENTRY[part.bus]);
    result.value.dispose();
    const type = context.typeof(entry);
    if (type !== 'function') {
      const fault = `the script has no ${ENTRY[part.bus]} function for a ${part.bus} part`;
      entry.dispose();
      return { script: part.script, context, entry: context.undefined, fault };
    }
    return { script: part.script, context, entry, fault: null };
  }

  return {
    read(part, timeMs, knobs) {
      let state = compiled.get(part.id);
      if (state !== undefined && state.script !== part.script) {
        // A run may have edited the script; the context is the old program.
        state.entry.dispose();
        state.context.dispose();
        state = undefined;
        compiled.delete(part.id);
      }
      if (state === undefined) {
        state = compile(part);
        compiled.set(part.id, state);
      }
      if (state.fault !== null) return { value: undefined, fault: state.fault };

      const context = state.context;
      nowMs = timeMs;

      // One interrupt handler for the call, because the runtime is shared: a
      // script that spins must not take the bench's solver with it.
      const started = performance.now();
      let overran = false;
      runtime.setInterruptHandler(() => {
        if (performance.now() - started <= SCRIPT_BUDGET_MS) return false;
        overran = true;
        return true;
      });

      const arg = context.newObject();
      const knobHandle = context.newObject();
      try {
        context.setProp(arg, 'timeMs', context.newNumber(timeMs));
        for (const [id, value] of Object.entries(knobs)) {
          context.setProp(knobHandle, id, context.newNumber(value));
        }
        context.setProp(arg, 'knobs', knobHandle);

        const result = context.callFunction(state.entry, context.undefined, arg);
        if (result.error) {
          state.fault = overran
            ? `the script overran its ${SCRIPT_BUDGET_MS} ms budget`
            : describeError(context, result.error);
          result.error.dispose();
          return { value: undefined, fault: state.fault };
        }
        const value = context.getNumber(result.value);
        result.value.dispose();
        const valid =
          Number.isFinite(value) &&
          (part.bus === 'analog' ? value >= 0 && value <= 1 : value === 0 || value === 1);
        if (!valid) {
          state.fault =
            part.bus === 'analog'
              ? `analog must return a number from 0 to 1, not ${String(value)}`
              : `digital must return 0 or 1, not ${String(value)}`;
          return { value: undefined, fault: state.fault };
        }
        return { value, fault: null };
      } finally {
        runtime.removeInterruptHandler();
        knobHandle.dispose();
        arg.dispose();
      }
    },

    dispose() {
      for (const state of compiled.values()) {
        state.entry.dispose();
        state.context.dispose();
      }
      compiled.clear();
      runtime.dispose();
    },
  };
}
