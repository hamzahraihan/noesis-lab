import { AVRTimer, CPU, avrInstruction, timer0Config, timer2Config } from 'avr8js';
import type { McuRuntime } from '@/features/simulation/mcu';
import { UNO_CLOCK_HZ, cyclesPerMs, type ExecutionBackend } from './backend';
import type { AttachedWasm, WasmCore } from './wasm-core';
import { SREG_DATA_ADDR, pullWasmState, readShadowState } from './wasm/sync';
import { attachGpioBridge } from './gpio';
import { attachTimer1, bindTimer1Outputs } from './timer1';
import { attachTwiBridge } from './twi';
import { attachUsartBridge } from './usart';

export interface AvrHooks {
  readonly mcu: McuRuntime;
  readonly nowMs: () => number;
  readonly readPin: (gpio: number) => boolean;
  /**
   * Non-settling pin observation for the Timer1 per-tick sampler. Defaults
   * to `readPin`. Production passes the engine's raw digital read: sampling
   * the settling reader per instruction turned every pin-intent revision
   * into a full solve (see timer1.ts).
   */
  readonly readPinRaw?: (gpio: number) => boolean;
  readonly onSettle: () => void;
  /**
   * Cycle-stamped driven-pin transitions with explicit level, for the engine's
   * servo pulse pump. Absent (unit tests driving the bridge directly) records
   * nothing.
   */
  readonly onEdge?: (gpio: number, cycles: number, high: boolean) => void;
  /**
   * Whether a probe is watching: watched nets must be sampled every
   * millisecond or the scope aliases. Unwatched, settling every 4 ms still
   * samples the fastest firmware strobe on the bench (a 20 ms multiplexed
   * digit) five times over, at a quarter of the solves. Absent (tests)
   * keeps the legacy every-ms cadence.
   */
  readonly isProbed?: () => boolean;
  readonly serial: { serialWrite(text: string): void };
  readonly i2c: {
    writeByte(address: number, byte: number, isFirst: boolean): boolean;
    readByte(address: number, index: number): number;
    writeEnd?(): void;
  };
}

/** Single step clamp, mirroring MAX_FRAME_MS in bench/simulation.ts. */
export const MAX_STEP_MS = 40;

// SREG I/O address (0x5f) lives in the cycle-free sync leaf
// (wasm/sync.ts, mirroring the layout in wasm/io.ts); imported here so the
// address stays single-sourced. Any address change lands in the leaf.

export class AvrBackend implements ExecutionBackend {
  private cpu: CPU;
  private readonly programWords: Uint16Array;
  private readonly hooks: AvrHooks;
  private msCarry = 0;
  private sinceSettle = 0;
  private msCounter = 0;
  clampedMs = 0;
  private failed: string | null = null;
  // WASM seam: `attachWasm`/`attachWasmReset` inject the attached core.
  // `step()` routes to `runAttachedSlice` when non-null (tests only); the
  // JS default path (`wasm` null) is unchanged.
  private wasm: WasmCore | null = null;
  private wasmReset: (() => void) | null = null;

  attachWasm(core: WasmCore | null): void {
    this.wasm = core;
  }

  attachWasmReset(fn: (() => void) | null): void {
    this.wasmReset = fn;
  }

  stepShadowOnce(): boolean {
    if (this.failed) return false;
    try {
      avrInstruction(this.cpu);
      this.cpu.tick();
      return true;
    } catch (error) {
      this.failed = `core fault at PC=${this.cpu.pc} cycles=${this.cpu.cycles}: ${String(error)}`;
      return false;
    }
  }

  private stepShadowInstruction(settleEvery: number): boolean {
    // Delegates to the single-step core so the fault string stays identical
    // on both paths; settle accounting is the only addition.
    if (!this.stepShadowOnce()) return false;
    this.sinceSettle += 1;
    if (this.sinceSettle >= settleEvery) {
      this.sinceSettle = 0;
      this.hooks.onSettle();
    }
    return true;
  }

  /**
   * Runs `count` shadow instructions behind one try/catch.
   *
   * The JS loop batches its per-instruction accounting into settle-sized
   * chunks: the single-step path paid two method calls plus a try/catch per
   * instruction, which profiling priced above the cost of `avrInstruction`
   * itself. Fault reporting (message, PC, cycles) and settle cadence are
   * identical to the single-step walk — chunks stop exactly at `settleEvery`
   * boundaries, and the catch reads the same live CPU state the
   * per-instruction catch read.
   */
  private runShadowChunk(count: number): boolean {
    const cpu = this.cpu;
    try {
      for (let i = 0; i < count; i++) {
        avrInstruction(cpu);
        cpu.tick();
      }
      return true;
    } catch (error) {
      this.failed = `core fault at PC=${cpu.pc} cycles=${cpu.cycles}: ${String(error)}`;
      return false;
    }
  }

  /**
   * Attached dispatch (tests only): Wasm runs each slice until it traps;
   * the shadow then catches up from its slice-start pc up to and including
   * the trapped pc (executing the prefix with side effects exactly once —
   * Wasm prefix execution is side-effect-free by invariant), syncs state
   * into Wasm, and the slice resumes. `remaining` counts shadow
   * instructions so the shadow always executes exactly `totalCycles`
   * instructions — the same count as the JS loop — keeping cycles,
   * msCarry, msCounter, and settles shadow-authoritative. The `wasm.step`
   * budget is an acceleration hint in Wasm units; correctness never depends
   * on it. SREG rides along
   * opaquely via setSreg (no flag-reading op is ported yet).
   */
  private runAttachedSlice(totalCycles: number, settleEvery: number): void {
    // AttachedWasm is type-only (erased at compile), so this keeps the
    // core<->wasm-core seam free of a runtime import cycle. Partial because
    // a degenerate attach may lack every method; each use guards with
    // `typeof ... === 'function'`.
    const wasm = this.wasm as unknown as Partial<AttachedWasm> | null;
    if (wasm === null) return;
    // Degenerate attach without a step function (test placeholder): the
    // shadow runs the whole slice, preserving settle cadence and fault
    // contract exactly.
    if (typeof wasm.step !== 'function') {
      for (let i = 0; i < totalCycles; i++) {
        if (!this.stepShadowInstruction(settleEvery)) return;
      }
      return;
    }
    const syncShadowToWasm = (): void => {
      if (
        typeof wasm.setReg !== 'function' ||
        typeof wasm.setPc !== 'function' ||
        typeof wasm.setSreg !== 'function'
      ) {
        return;
      }
      // SREG address coupling stays explicit via the shared leaf constant
      // (state itself flows through the leaf helpers).
      void SREG_DATA_ADDR;
      pullWasmState(
        wasm as unknown as { setReg(i: number, v: number): void; setPc(v: number): void; setSreg(v: number): void },
        readShadowState(this.cpu),
      );
    };
    // Prime Wasm from the shadow so a mid-run attach resumes correctly.
    syncShadowToWasm();
    let remaining = totalCycles;
    while (remaining > 0) {
      if (this.failed) return;
      let trappedPc: number;
      try {
        trappedPc = wasm.step(remaining);
      } catch {
        // Wasm-side failure: the shadow stays authoritative and runs the
        // rest of the slice on its own.
        for (let i = 0; i < remaining; i++) {
          if (!this.stepShadowInstruction(settleEvery)) return;
        }
        syncShadowToWasm();
        return;
      }
      if (trappedPc === -1) {
        for (let i = 0; i < remaining; i++) {
          if (!this.stepShadowInstruction(settleEvery)) return;
        }
        syncShadowToWasm();
        return;
      }
      if (!Number.isInteger(trappedPc) || trappedPc < 0) {
        // Malformed trap channel: same fallback as a Wasm-side failure.
        for (let i = 0; i < remaining; i++) {
          if (!this.stepShadowInstruction(settleEvery)) return;
        }
        syncShadowToWasm();
        return;
      }
      // Trap at trappedPc: the shadow catches up from its current pc up to
      // and including the trapped op.
      let steps = 0;
      let guard = totalCycles + 1024;
      while (this.cpu.pc !== trappedPc) {
        if (!this.stepShadowInstruction(settleEvery)) return;
        steps += 1;
        guard -= 1;
        if (guard <= 0) {
          // Wasm and shadow disagree about control flow; keep the shadow
          // authoritative by running out the slice from the shadow pc
          // (the same instructions the JS path runs from here).
          const owed = Math.max(0, remaining - steps);
          for (let i = 0; i < owed; i++) {
            if (!this.stepShadowInstruction(settleEvery)) return;
          }
          syncShadowToWasm();
          return;
        }
      }
      if (!this.stepShadowInstruction(settleEvery)) return;
      steps += 1;
      syncShadowToWasm();
      remaining -= steps;
    }
  }

  constructor(programWords: Uint16Array, hooks: AvrHooks) {
    this.programWords = programWords;
    this.hooks = hooks;
    this.cpu = this.buildCpu();
  }

  get fault(): string | null {
    return this.failed;
  }

  get cycles(): number {
    return this.cpu.cycles;
  }

  millis(): number {
    return this.msCounter;
  }

  step(budgetMs: number): void {
    if (this.failed) return;
    const clamped = Math.min(Math.max(budgetMs, 0), MAX_STEP_MS);
    if (budgetMs > MAX_STEP_MS) this.clampedMs += budgetMs - MAX_STEP_MS;
    const perMs = cyclesPerMs(UNO_CLOCK_HZ);
    const ms = this.msCarry + clamped;
    const settleEvery = (this.hooks.isProbed?.() ?? true) ? perMs : perMs * 4;
    const totalCycles = Math.floor(ms * perMs);
    if (this.wasm !== null) {
      // Attached dispatch (tests only): Wasm runs each slice until it traps;
      // the shadow then catches up from the slice start (executing the prefix
      // with side effects exactly once — Wasm prefix execution is
      // side-effect-free by invariant) plus the trapped op, syncs state into
      // Wasm, and the slice resumes. Cycles, msCarry, msCounter, and settles
      // stay shadow-authoritative. SREG rides along opaquely via set_sreg
      // (no flag-reading op is ported yet).
      this.runAttachedSlice(totalCycles, settleEvery);
      // Fault path: the JS loop returns early without advancing msCarry, so
      // a partial attached slice must too — otherwise the next step would
      // under-budget and diverge from the JS cadence.
      if (this.failed) return;
      const consumedMs = totalCycles / perMs;
      this.msCarry = ms - consumedMs;
      return;
    } else {
      let remaining = totalCycles;
      while (remaining > 0) {
        const chunk = Math.min(remaining, settleEvery - this.sinceSettle);
        if (!this.runShadowChunk(chunk)) return;
        remaining -= chunk;
        this.sinceSettle += chunk;
        if (this.sinceSettle >= settleEvery) {
          this.sinceSettle = 0;
          this.hooks.onSettle();
        }
      }
    }
    const consumedMs = totalCycles / perMs;
    this.msCarry = ms - consumedMs;
  }

  reset(): void {
    this.cpu = this.buildCpu();
    this.msCarry = 0;
    this.sinceSettle = 0;
    this.msCounter = 0;
    this.clampedMs = 0;
    this.failed = null;
    // Attached Wasm reset hook fires alongside the JS rebuild (spec: reset
    // clears both).
    this.wasmReset?.();
  }

  private buildCpu(): CPU {
    const cpu = new CPU(new Uint16Array(this.programWords));
    // Timer0 free-runs from the TCCR0B prescaler so stock-core millis() and
    // delay(), which count its overflows, advance instead of hanging.
    new AVRTimer(cpu, timer0Config);
    // Timer2 drives Arduino tone()/noTone() (compare ISR toggles PORT, which
    // the GPIO bridge already syncs); Timer0 keeps millis()/delay().
    new AVRTimer(cpu, timer2Config);
    attachGpioBridge(cpu, this.hooks.mcu, this.hooks.nowMs, this.hooks.readPin, this.hooks.onEdge);
    // Timer1 (Task 2): counter plus OC-to-PWM bridge beside the two AVRTimer
    // lines; this shared constructor serves the in-page and worker paths. The
    // bridge chains onto the DDRB/PORTB/PINB hooks, so it must bind after the
    // GPIO bridge; both lines are load-bearing (counter alone never stamps
    // duty). Attach once: a second attachTimer1 would double-wrap cpu.tick.
    attachTimer1(cpu, this.hooks.mcu, this.hooks.nowMs, this.hooks.readPin, this.hooks.readPinRaw ?? this.hooks.readPin);
    bindTimer1Outputs(cpu, this.hooks.mcu, this.hooks.nowMs);
    attachUsartBridge(cpu, this.hooks.serial);
    attachTwiBridge(cpu, {
      writeByte: (address, byte, isFirst) => this.hooks.i2c.writeByte(address, byte, isFirst),
      readByte: (address, index) => this.hooks.i2c.readByte(address, index),
      writeEnd: () => this.hooks.i2c.writeEnd?.(),
    });
    const perMs = cyclesPerMs(UNO_CLOCK_HZ);
    const tickMs = (): void => {
      this.msCounter += 1;
      cpu.addClockEvent(tickMs, perMs);
    };
    cpu.addClockEvent(tickMs, perMs);
    return cpu;
  }
}
