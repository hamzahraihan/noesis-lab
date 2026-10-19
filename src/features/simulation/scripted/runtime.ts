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

/** The surfaces a scripted part may expose. */
export type ScriptedBus = 'analog' | 'digital' | 'i2c';

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

export interface ScriptedBytes {
  /** What the device answered; empty when it faulted, which the bus reads as a NACK. */
  readonly bytes: readonly number[];
  /** The one problem that stopped this part, or null while it is healthy. */
  readonly fault: string | null;
}

export interface ScriptedWrite {
  /**
   * False when the device did not take the write.
   *
   * A script's `write` returning `false` is how a device says "not that": the
   * bus answers NACK and the firmware sees a device that refused, which is a
   * real thing a sketch has to cope with. A fault is a NACK too.
   */
  readonly ok: boolean;
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
  /**
   * The bytes a slave at the part's address answers, starting at `register`.
   *
   * The register comes from the bus, because that is where I2C keeps it: the
   * first byte a master writes is the pointer, and everything after is data.
   * `count` is what the firmware asked for; a slave may answer fewer bytes,
   * which the bus repeats rather than refusing (see `repeatLast`).
   */
  readI2c(
    part: ScriptedPart,
    register: number,
    count: number,
    timeMs: number,
    knobs: Readonly<Record<string, number>>,
  ): ScriptedBytes;
  /** Hands one write to the slave; false when it refused, which the bus NACKs. */
  writeI2c(
    part: ScriptedPart,
    register: number,
    bytes: readonly number[],
    timeMs: number,
    knobs: Readonly<Record<string, number>>,
  ): ScriptedWrite;
  dispose(): void;
}

/** Per-call wall-clock budget. Measured calls take ~11 us; this is ~180x that. */
export const SCRIPT_BUDGET_MS = 2;

const ENTRY: Readonly<Record<'analog' | 'digital', string>> = {
  analog: 'analog',
  digital: 'digital',
};

interface Compiled {
  /** The source this context was compiled from, so an edited script reloads. */
  readonly script: string;
  readonly context: QuickJSContext;
  /** Function buses: the entry point. Null for i2c, whose entry is an object. */
  readonly entry: QuickJSHandle | null;
  /** i2c: the slave's two halves. `read` is required, `write` may be absent. */
  readonly readEntry: QuickJSHandle | null;
  readonly writeEntry: QuickJSHandle | null;
  fault: string | null;
}

/** Frees a compiled part's handles and its context, in that order. */
function release(state: Compiled): void {
  state.entry?.dispose();
  state.readEntry?.dispose();
  state.writeEntry?.dispose();
  state.context.dispose();
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
    const shell: Compiled = {
      script: part.script,
      context,
      entry: null,
      readEntry: null,
      writeEntry: null,
      fault: null,
    };
    if (result.error) {
      const fault = `the script did not load: ${describeError(context, result.error)}`;
      result.error.dispose();
      return { ...shell, fault };
    }
    const module = result.value;
    /*
     * An i2c part's entry is the slave object rather than a function: `read` is
     * what a master asks for, `write` is what it hands over. A device that never
     * answers is not a device, so `read` is required; an output-only device is a
     * real thing, so `write` is not.
     */
    if (part.bus === 'i2c') {
      const slave = context.getProp(module, 'i2c');
      module.dispose();
      if (context.typeof(slave) !== 'object') {
        slave.dispose();
        return { ...shell, fault: 'the script has no i2c object for an i2c part' };
      }
      const readEntry = context.getProp(slave, 'read');
      const writeProp = context.getProp(slave, 'write');
      slave.dispose();
      if (context.typeof(readEntry) !== 'function') {
        readEntry.dispose();
        writeProp.dispose();
        return { ...shell, fault: 'the script has no i2c read function for an i2c part' };
      }
      const writeEntry = context.typeof(writeProp) === 'function' ? writeProp : null;
      if (writeEntry === null) writeProp.dispose();
      return { ...shell, readEntry, writeEntry, fault: null };
    }
    const entry = context.getProp(module, ENTRY[part.bus]);
    module.dispose();
    if (context.typeof(entry) !== 'function') {
      entry.dispose();
      return {
        ...shell,
        fault: `the script has no ${ENTRY[part.bus]} function for a ${part.bus} part`,
      };
    }
    return { ...shell, entry, fault: null };
  }

  /** A part's compiled state: an edited script reloads, a new part compiles. */
  function stateFor(part: ScriptedPart): Compiled {
    let state = compiled.get(part.id);
    if (state !== undefined && state.script !== part.script) {
      // A run may have edited the script; the context is the old program.
      release(state);
      compiled.delete(part.id);
      state = undefined;
    }
    if (state === undefined) {
      state = compile(part);
      compiled.set(part.id, state);
    }
    return state;
  }

  /**
   * Calls one of a part's entry points, with the host's clock, the operator's
   * knobs and whatever the bus adds.
   *
   * Everything the call needs to clean up is cleaned up here, the fault path
   * included: a leaked handle aborts the whole runtime when it is freed, so the
   * one place that creates handles is the one place that disposes them.
   */
  function invoke(
    state: Compiled,
    entry: QuickJSHandle,
    timeMs: number,
    knobs: Readonly<Record<string, number>>,
    extra?: (arg: QuickJSHandle) => void,
  ): { handle: QuickJSHandle } | { fault: string } {
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
      extra?.(arg);

      const result = context.callFunction(entry, context.undefined, arg);
      if (result.error) {
        state.fault = overran
          ? `the script overran its ${SCRIPT_BUDGET_MS} ms budget`
          : describeError(context, result.error);
        result.error.dispose();
        return { fault: state.fault };
      }
      return { handle: result.value };
    } finally {
      runtime.removeInterruptHandler();
      knobHandle.dispose();
      arg.dispose();
    }
  }

  return {
    read(part, timeMs, knobs) {
      const state = stateFor(part);
      if (state.fault !== null || state.entry === null) {
        return { value: undefined, fault: state.fault };
      }
      const called = invoke(state, state.entry, timeMs, knobs);
      if ('fault' in called) return { value: undefined, fault: called.fault };

      const value = state.context.getNumber(called.handle);
      called.handle.dispose();
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
    },

    readI2c(part, register, count, timeMs, knobs) {
      const state = stateFor(part);
      if (state.fault !== null || state.readEntry === null) {
        return { bytes: [], fault: state.fault };
      }
      const context = state.context;
      const called = invoke(state, state.readEntry, timeMs, knobs, (arg) => {
        context.setProp(arg, 'register', context.newNumber(register));
        context.setProp(arg, 'count', context.newNumber(count));
      });
      if ('fault' in called) return { bytes: [], fault: called.fault };

      const answer: unknown = context.dump(called.handle);
      called.handle.dispose();
      if (!Array.isArray(answer) || answer.some((byte) => !isByte(byte))) {
        state.fault = `an i2c read must answer bytes, not ${JSON.stringify(answer)}`;
        return { bytes: [], fault: state.fault };
      }
      return { bytes: answer as number[], fault: null };
    },

    writeI2c(part, register, bytes, timeMs, knobs) {
      const state = stateFor(part);
      if (state.fault !== null) return { ok: false, fault: state.fault };
      // No `write` is a device that only answers: the bus NACKs the write, which
      // is what a real slave without the register does.
      if (state.writeEntry === null) return { ok: false, fault: null };
      const context = state.context;
      const called = invoke(state, state.writeEntry, timeMs, knobs, (arg) => {
        context.setProp(arg, 'register', context.newNumber(register));
        const array = context.newArray();
        try {
          for (const [index, byte] of bytes.entries()) {
            context.setProp(array, index, context.newNumber(byte));
          }
          context.setProp(arg, 'bytes', array);
        } finally {
          // `setProp` does not take ownership, and an undisposed object handle
          // makes `JS_FreeRuntime` abort when the runtime is freed. Number
          // handles are static and need none of this; an array is not.
          array.dispose();
        }
      });
      if ('fault' in called) return { ok: false, fault: called.fault };

      const answer: unknown = context.dump(called.handle);
      called.handle.dispose();
      return { ok: answer !== false, fault: null };
    },

    dispose() {
      for (const state of compiled.values()) release(state);
      compiled.clear();
      runtime.dispose();
    },
  };
}

/** Whether a script's answer byte is one a bus can carry. */
function isByte(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255;
}
