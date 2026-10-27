import { AVRTimer, CPU, avrInstruction, timer0Config, timer2Config } from 'avr8js';
import type { McuRuntime } from '@/features/simulation/mcu';
import type { DebugFrame, DebugMemory, DebugRegister } from '../firmware/debugger';
import { UNO_CLOCK_HZ, cyclesPerMs, type ExecutionBackend } from './backend';
import type { WasmCore } from './wasm-core';
import type { CompiledDebugInfo, DebugLine } from './debug/lines';
import { readVariables } from './debug/evaluate';
import { SREG_DATA_ADDR, pullWasmState, readShadowState } from './wasm/sync';
import { attachGpioBridge } from './gpio';
import { attachTimer1, bindTimer1Outputs } from './timer1';
import { attachTwiBridge } from './twi';
import { attachUsartBridge } from './usart';

/** The part of `FirmwareDebugger` the compiled core reads while it runs. */
export interface DebugStopSource {
  readonly armed: boolean;
  hasBreakpoint(file: string, line: number): boolean;
}

interface DebugStep {
  readonly mode: 'over' | 'into';
  /** The paused PC; the step cannot stop again until it has moved past it. */
  readonly originPc: number;
}

/** RCALL, CALL, ICALL or EICALL: an instruction that returns to the next PC. */
function isCallOpcode(word: number): boolean {
  return (
    (word & 0xf000) === 0xd000 ||
    (word & 0xfe0e) === 0x940e ||
    word === 0x9509 ||
    word === 0x9519
  );
}

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

function lineKey(line: DebugLine): string {
  return `${line.file}:${line.line}`;
}

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
  // Compiled source-line debugging. `debugRows` is the PC-indexed half of
  // `debugInfo`, so the instruction loop pays one Map lookup only while a
  // stop is armed or a step is in flight. A PC can name several source rows
  // (a block's opening brace and its first statement share an address).
  private debugInfo: CompiledDebugInfo | null = null;
  private debugRows: ReadonlyMap<number, readonly DebugLine[]> = new Map();
  private debugStops: DebugStopSource | null = null;
  private debugStep: DebugStep | null = null;
  /**
   * SP immediately before the call a step-over is currently inside.
   *
   * Set when the call instruction executes, not when the line is scanned: a
   * prologue can lower SP before a call and must not look like one.
   */
  private debugReturnSp: number | null = null;
  private pausedLine: DebugLine | null = null;
  private pausedFrame: DebugFrame | null = null;
  /** The source row last entered, so a stop fires once per visit. */
  private lastDebugLineKey: string | null = null;
  /** PC of the stop just released; it must run one instruction before re-arming. */
  private debugSkipPc: number | null = null;

  /** Attaches (or clears) the source map a compiled sketch was built with. */
  attachDebug(info: CompiledDebugInfo | null): void {
    const lines = info?.lines ?? [];
    this.debugInfo = lines.length > 0 ? info : null;
    const rows = new Map<number, DebugLine[]>();
    for (const line of lines) {
      const at = rows.get(line.pc);
      if (at === undefined) rows.set(line.pc, [line]);
      else at.push(line);
    }
    this.debugRows = rows;
    this.debugStep = null;
    this.debugReturnSp = null;
    this.pausedLine = null;
    this.pausedFrame = null;
    this.lastDebugLineKey = null;
    this.debugSkipPc = null;
    this.msCarry = 0;
  }

  /** Sets where the compiled core may stop, or clears the stop source. */
  setDebugStops(source: DebugStopSource | null): void {
    this.debugStops = source;
  }

  /** Whether this core carries a source map worth watching. */
  get hasDebugInfo(): boolean {
    return this.debugInfo !== null;
  }

  debugPaused(): boolean {
    return this.pausedFrame !== null;
  }

  /** The held frame, by reference until the program moves. */
  debugFrame(): DebugFrame | null {
    return this.pausedFrame;
  }

  /** Carries on from the held line; it will not stop there again. */
  resumeDebug(): void {
    if (this.pausedFrame === null) return;
    this.lastDebugLineKey = this.pausedLine === null ? null : lineKey(this.pausedLine);
    this.debugSkipPc = this.pausedLine?.pc ?? null;
    this.debugStep = null;
    this.debugReturnSp = null;
    this.pausedLine = null;
    this.pausedFrame = null;
    this.msCarry = 0;
  }

  /** Spends the held stop, running to the next distinct source line. */
  stepDebug(mode: 'over' | 'into'): void {
    if (this.pausedFrame === null || this.pausedLine === null) return;
    const key = lineKey(this.pausedLine);
    this.debugStep = {
      mode,
      originPc: this.pausedLine.pc,
    };
    this.debugReturnSp = null;
    this.lastDebugLineKey = key;
    this.debugSkipPc = this.pausedLine.pc;
    this.pausedLine = null;
    this.pausedFrame = null;
    this.msCarry = 0;
  }

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
   * WASM-authoritative dispatch: Wasm owns PC, registers, SREG, SP, and cycle
   * count during execution. The JS shadow (avr8js CPU) only runs instructions
   * that Wasm traps on (I/O, SRAM, stack, unported opcodes). After each Wasm
   * step, state is synced Wasm→JS; after a JS-handled trap, state is synced
   * JS→Wasm before resuming.
   */
  private runWasmSlice(totalCycles: number, settleEvery: number): void {
    const wasm = this.wasm as unknown as {
      step(n: number): number;
      getInstructions(): number;
      getCycles(): number;
      setCycles(v: number): void;
      get_pc(): number;
      get_reg(i: number): number;
      get_sreg(): number;
      get_sp(): number;
      set_reg(i: number, v: number): void;
      set_pc(v: number): void;
      set_sreg(v: number): void;
      set_sp(v: number): void;
    } | null;
    if (wasm === null || typeof wasm.step !== 'function') {
      // Degenerate attach: fall back to the JS shadow for the whole slice.
      for (let i = 0; i < totalCycles; i++) {
        if (!this.stepShadowInstruction(settleEvery)) return;
      }
      return;
    }

    const hasCycleTracking = typeof wasm.getCycles === 'function';

    // Without cycle tracking we cannot know how many cycles Wasm consumed
    // before a trap, so fall back to the catch-up dispatch: Wasm runs, the
    // shadow catches up from its PC to the trap PC instruction by instruction.
    if (!hasCycleTracking) {
      const syncShadowToWasm = (): void => {
        const w = wasm as unknown as {
          setReg(i: number, v: number): void;
          setPc(v: number): void;
          setSreg(v: number): void;
        };
        if (typeof w.setReg !== 'function' || typeof w.setPc !== 'function' || typeof w.setSreg !== 'function') {
          return;
        }
        pullWasmState(
          w,
          readShadowState(this.cpu),
        );
      };
      // Prime Wasm from the shadow.
      syncShadowToWasm();
      let remaining = totalCycles;
      while (remaining > 0) {
        if (this.failed) return;
        let trappedPc: number;
        try {
          trappedPc = wasm.step(remaining);
        } catch {
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
          const owed = Math.max(0, remaining);
          for (let i = 0; i < owed; i++) {
            if (!this.stepShadowInstruction(settleEvery)) return;
          }
          syncShadowToWasm();
          return;
        }
        // Shadow catches up to the trap PC.
        let steps = 0;
        let guard = totalCycles + 1024;
        while (this.cpu.pc !== trappedPc) {
          if (!this.stepShadowInstruction(settleEvery)) return;
          steps += 1;
          guard -= 1;
          if (guard <= 0) {
            for (let i = 0; i < remaining - steps; i++) {
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
      return;
    }

    /** Push avr8js CPU state into Wasm before stepping (only methods that exist). */
    const syncJsToWasm = (): void => {
      if (typeof wasm.set_pc === 'function') wasm.set_pc(this.cpu.pc);
      if (typeof wasm.set_sreg === 'function')
        wasm.set_sreg(this.cpu.data[SREG_DATA_ADDR]);
      if (typeof wasm.set_reg === 'function') {
        for (let i = 0; i < 32; i++) wasm.set_reg(i, this.cpu.data[i]);
      }
      if (typeof wasm.set_sp === 'function') {
        const sp = (this.cpu.data[94] << 8) | this.cpu.data[93];
        wasm.set_sp(sp);
      }
      if (typeof wasm.setCycles === 'function') wasm.setCycles(this.cpu.cycles);
    };

    /** Pull Wasm state back into the avr8js CPU after stepping (only methods that exist). */
    const syncWasmToJs = (): void => {
      if (typeof wasm.get_pc === 'function') this.cpu.pc = wasm.get_pc();
      if (typeof wasm.get_sreg === 'function')
        this.cpu.data[SREG_DATA_ADDR] = wasm.get_sreg();
      if (typeof wasm.get_reg === 'function') {
        for (let i = 0; i < 32; i++) this.cpu.data[i] = wasm.get_reg(i);
      }
      if (typeof wasm.get_sp === 'function') {
        const sp = wasm.get_sp();
        this.cpu.data[93] = sp & 0xff;
        this.cpu.data[94] = (sp >> 8) & 0xff;
      }
      if (typeof wasm.getCycles === 'function') this.cpu.cycles = wasm.getCycles();
    };

    // Prime Wasm from the shadow so a mid-run attach resumes correctly.
    syncJsToWasm();

    let remaining = totalCycles * 10000;
    let settledCycles = 0;
    while (remaining > 0) {
      if (this.failed) return;

      // Give Wasm a very large budget per call so it can execute through
      // delay loops and reach GPIO writes. remaining only counts shadow
      // instructions (1 per trap), so Wasm can execute far more
      // instructions per call without exhausting the frame budget.
      const wasmBudget = 0x7fffffff;
      const instructionsBefore = wasm.getInstructions();
      let trappedPc: number;
      try {
        trappedPc = wasm.step(wasmBudget);
      } catch {
        // Wasm-side failure: fall back to the JS shadow for the rest of the
        // slice, preserving settle cadence and fault contract.
        for (let i = 0; i < remaining; i++) {
          if (!this.stepShadowInstruction(settleEvery)) return;
        }
        syncWasmToJs();
        return;
      }

      // Don't count Wasm instructions against remaining — only shadow
      // instructions (1 per trap) count against the per-frame budget. This
      // lets Wasm execute millions of instructions in delay loops between
      // GPIO-write traps.
      settledCycles += wasm.getInstructions() - instructionsBefore;

      // Pull Wasm state back into JS so msCounter, onSettle cadence, and any
      // trap handling see consistent state.
      syncWasmToJs();

      // Call onSettle at settle boundaries.
      while (settledCycles >= settleEvery) {
        settledCycles -= settleEvery;
        this.hooks.onSettle();
      }

      if (trappedPc === -1) {
        // All remaining instructions consumed cleanly by Wasm.
        break;
      }

      // Trap at trappedPc: Wasm could not execute this instruction (I/O,
      // SRAM, stack, or unported opcode). Handle it with the JS shadow: one
      // instruction, then sync back to Wasm and resume.
      if (!Number.isInteger(trappedPc) || trappedPc < 0) {
        // Malformed trap: fall back to JS for the rest of the slice.
        for (let i = 0; i < remaining; i++) {
          if (!this.stepShadowInstruction(settleEvery)) return;
        }
        syncWasmToJs();
        return;
      }

      // Execute one shadow instruction at the trapped PC.
      if (this.cpu.pc !== trappedPc) {
        // Wasm's PC should already be at the trap site, but align defensively.
        this.cpu.pc = trappedPc;
      }
      const shadowCyclesBefore = this.cpu.cycles;
      if (!this.stepShadowInstruction(settleEvery)) return;
      const shadowCycles = this.cpu.cycles - shadowCyclesBefore;
      settledCycles += shadowCycles;
      while (settledCycles >= settleEvery) {
        settledCycles -= settleEvery;
        this.hooks.onSettle();
      }
      remaining -= shadowCycles;

      // Sync the JS-updated state back to Wasm before resuming.
      syncJsToWasm();
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
    // A held program does not run, and owes no simulated time: the bench clock
    // keeps moving beside it, but the core must not try to catch up on resume.
    if (this.pausedFrame !== null) return;
    const clamped = Math.min(Math.max(budgetMs, 0), MAX_STEP_MS);
    if (budgetMs > MAX_STEP_MS) this.clampedMs += budgetMs - MAX_STEP_MS;
    const perMs = cyclesPerMs(UNO_CLOCK_HZ);
    const ms = this.msCarry + clamped;
    const settleEvery = (this.hooks.isProbed?.() ?? true) ? perMs : perMs * 4;
    const totalCycles = Math.floor(ms * perMs);
    const debugActive =
      this.debugInfo !== null &&
      (this.debugStep !== null || this.debugStops?.armed === true);
    if (this.wasm !== null && !debugActive) {
      // Wasm-authoritative dispatch: Wasm runs each slice until it traps;
      // the JS shadow handles trapped opcodes (I/O, SRAM, stack). Cycles,
      // msCarry, msCounter, and settles stay Wasm-authoritative.
      this.runWasmSlice(totalCycles, settleEvery);
      // Fault path: the JS loop returns early without advancing msCarry, so
      // a partial attached slice must too — otherwise the next step would
      // under-budget and diverge from the JS cadence.
      if (this.failed) return;
      const consumedMs = totalCycles / perMs;
      this.msCarry = ms - consumedMs;
      // avr8js's Timer0 clock event (which advances msCounter) does not run
      // under Wasm execution, so track milliseconds here from consumed cycles.
      this.msCounter += Math.floor(consumedMs);
      return;
    } else if (debugActive) {
      /*
       * The JS shadow is authoritative while a stop is armed, even if Wasm is
       * attached: the accelerator's trap ABI knows nothing about breakpoints,
       * and extending it for a debugger that exists to observe the shadow
       * would buy nothing. One instruction at a time lets the stop land before
       * the statement runs, exactly like the interpreter's statement hook.
       */
      let remaining = totalCycles;
      while (remaining > 0) {
        if (this.checkDebugStop(this.cpu.pc)) return;
        this.noteStepCall(this.cpu.pc);
        if (!this.stepShadowInstruction(settleEvery)) return;
        remaining -= 1;
      }
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

  /**
   * Records the return level when a step-over reaches a call.
   *
   * The call itself is about to run, so SP is still at the caller's level.
   * Waiting for that value comes back skips the callee; a prologue's push has
   * no such call and therefore cannot trap the step in the current frame.
   */
  private noteStepCall(pc: number): void {
    if (this.debugStep?.mode !== 'over' || this.debugReturnSp !== null) return;
    if (isCallOpcode(this.programWords[pc] ?? 0)) this.debugReturnSp = this.cpu.SP;
  }

  /**
   * Decides whether the instruction at `pc` stops the program before it runs.
   *
   * A step answers first: it lands on the next distinct source line, and a
   * step over a call waits until the stack pointer is back at the level it
   * left. A stop answers second and fires once per line visit, matching the
   * interpreter's once-per-line rule.
   */
  private checkDebugStop(pc: number): boolean {
    const rows = this.debugRows.get(pc);
    if (rows === undefined || rows.length === 0) return false;

    // A released stop sits on the instruction that was about to run. Let it
    // execute once: a second source row on the same PC would otherwise re-stop
    // the program before it makes any progress.
    if (this.debugSkipPc !== null) {
      const skip = this.debugSkipPc;
      this.debugSkipPc = null;
      if (pc === skip) return false;
    }

    const step = this.debugStep;
    if (step !== null) {
      if (pc === step.originPc) return false;
      const next = rows.find((row) => lineKey(row) !== this.lastDebugLineKey);
      if (next === undefined) return false;
      if (
        step.mode === 'over' &&
        this.debugReturnSp !== null &&
        this.cpu.SP < this.debugReturnSp
      ) {
        return false;
      }
      this.lastDebugLineKey = lineKey(next);
      this.debugStep = null;
      this.debugReturnSp = null;
      this.pauseAt(next);
      return true;
    }

    const canonical = rows[rows.length - 1]!;
    if (this.debugStops?.armed === true) {
      const hit = rows.find((row) => this.debugStops!.hasBreakpoint(row.file, row.line));
      if (hit !== undefined && lineKey(hit) !== this.lastDebugLineKey) {
        this.lastDebugLineKey = lineKey(hit);
        this.pauseAt(hit);
        return true;
      }
    }
    this.lastDebugLineKey = lineKey(canonical);
    return false;
  }

  private pauseAt(row: DebugLine): void {
    this.pausedLine = row;
    this.pausedFrame = this.frameFor(row);
    this.msCarry = 0;
  }

  /** The held frame: a stable object, so the worker can deduplicate pushes. */
  private frameFor(row: DebugLine): DebugFrame {
    const cpu = this.cpu;
    const registers: DebugRegister[] = [];
    const registerBytes: number[] = [];
    for (let index = 0; index < 32; index += 1) {
      const byte = cpu.data[index] ?? 0;
      registerBytes.push(byte);
      registers.push({
        name: `r${index}`,
        value: `0x${byte.toString(16).padStart(2, '0')}`,
      });
    }
    registers.push({ name: 'SP', value: `0x${cpu.SP.toString(16)}` });
    registers.push({ name: 'SREG', value: `0x${cpu.SREG.toString(16).padStart(2, '0')}` });
    registers.push({ name: 'PC', value: `0x${(cpu.pc * 2).toString(16)}` });
    const variables =
      this.debugInfo === null
        ? []
        : readVariables(this.debugInfo, {
            pc: cpu.pc * 2,
            registers: registerBytes,
            sp: cpu.SP,
            data: cpu.data,
          });
    const memoryStart = 0x100;
    const memoryEnd = Math.min(cpu.data.length, 0x900);
    const memory: DebugMemory = {
      start: memoryStart,
      bytes: Array.from(cpu.data.subarray(memoryStart, memoryEnd)),
    };
    return {
      file: row.file,
      line: row.line,
      column: 0,
      depth: 0,
      variables,
      pc: cpu.pc * 2,
      registers,
      memory,
      compiled: true,
    };
  }

  reset(): void {
    this.cpu = this.buildCpu();
    this.msCarry = 0;
    this.sinceSettle = 0;
    this.msCounter = 0;
    this.clampedMs = 0;
    this.failed = null;
    this.debugStep = null;
    this.debugReturnSp = null;
    this.pausedLine = null;
    this.pausedFrame = null;
    this.lastDebugLineKey = null;
    this.debugSkipPc = null;
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
    attachTimer1(
      cpu,
      this.hooks.mcu,
      this.hooks.nowMs,
      this.hooks.readPin,
      this.hooks.readPinRaw ?? this.hooks.readPin,
    );
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
