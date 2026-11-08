import { AVRTimer, CPU, avrInstruction, timer0Config, timer2Config } from 'avr8js';
import type { McuRuntime } from '@/features/simulation/mcu';
import type { DebugFrame, DebugMemory, DebugRegister } from '../firmware/debugger';
import { UNO_CLOCK_HZ, cyclesPerMs, type ExecutionBackend } from './backend';
import type { WasmAvrCpu } from '@/features/simulation/engine-wasm/cpu';
import type { CompiledDebugInfo, DebugLine } from './debug/lines';
import { readVariables } from './debug/evaluate';
import { pullWasmState, readShadowState } from './wasm/sync';
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
  private failed: string | null = null;
  clampedMs = 0;
  // WASM seam: `attachWasm` injects the C++ AVR core (phase 3). `attachWasmReset`
  // fires alongside the JS rebuild. The JS default path (`wasm` null) is unchanged.
  private wasm: WasmAvrCpu | null = null;
  private wasmReset: (() => void) | null = null;
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

  /**
   * Data watchpoints: address + size pairs the core checks after each
   * instruction in the debug-active path. A write that changes any byte
   * in the range stops the program, the way a real debugger's watchpoint
   * does. Read watchpoints are not implemented (they need instruction-level
   * load tracing), so this is write-only.
   */
  private watchpoints: Map<number, { address: number; size: number }> = new Map();
  private watchpointIdCounter = 0;

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

  /**
   * Adds a write watchpoint on `[address, address + size)` in the AVR data
   * space. Returns the watchpoint's id, or -1 when the address is out of
   * range.
   */
  addWatchpoint(address: number, size: number): number {
    if (address < 0 || address >= this.cpu.data.length || size <= 0) return -1;
    const id = ++this.watchpointIdCounter;
    this.watchpoints.set(id, { address, size: Math.min(size, this.cpu.data.length - address) });
    return id;
  }

  /** Removes a watchpoint by id. Returns true when it existed. */
  removeWatchpoint(id: number): boolean {
    return this.watchpoints.delete(id);
  }

  /** The number of active watchpoints. */
  get watchpointCount(): number {
    return this.watchpoints.size;
  }

  /**
   * Reads `length` bytes from the AVR data space starting at `address`.
   *
   * The data space is one flat array: registers at 0x00-0x1F, I/O at 0x20-0x5F,
   * SRAM at 0x60 and up. This is the "reads memory" half of the debugging
   * gap: a sketch stopped on a line can be asked what lives at any address,
   * not just the 2 KB snapshot the stop frame carries.
   *
   * Out-of-range addresses or lengths are clamped rather than throwing, so a
   * panel that asks for a region past RAMEND gets what is there and nothing
   * more.
   */
  readMemory(address: number, length: number): number[] {
    if (length <= 0 || address >= this.cpu.data.length) return [];
    const start = Math.max(0, address | 0);
    const count = Math.min(length | 0, this.cpu.data.length - start);
    return Array.from(this.cpu.data.subarray(start, start + count));
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

  attachWasm(core: WasmAvrCpu | null): void {
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
   * Attached dispatch: the JS shadow stays authoritative.
   *
   * The host owns the whole data space — registers, I/O, SRAM, stack, pins —
   * and therefore owns every side effect. Wasm runs the ported,
   * side-effect-free prefix of the slice; when it traps, the shadow replays
   * from its own PC up to the trap site and then executes the trapped
   * instruction itself, so each instruction's effects are applied exactly
   * once. Wasm is re-primed from the shadow and resumes.
   *
   * State is never pulled back out of Wasm: a ported op that diverges would
   * silently corrupt the shadow, and the acceptance legs (blink/alarm/timer1)
   * pin the shadow as truth. A core without cycle tracking is handled by the
   * same loop — `step` plus the three sync writers are all it needs.
   */
  private runWasmSlice(totalCycles: number, settleEvery: number): void {
    const wasm = this.wasm as unknown as {
      step(n: number): number;
      setReg(i: number, v: number): void;
      setPc(v: number): void;
      setSreg(v: number): void;
      setSp?(v: number): void;
    } | null;
    if (wasm === null || typeof wasm.step !== 'function') {
      // Degenerate attach: fall back to the JS shadow for the whole slice.
      for (let i = 0; i < totalCycles; i++) {
        if (!this.stepShadowInstruction(settleEvery)) return;
      }
      return;
    }

    /** Push avr8js CPU state into Wasm before stepping (only methods that exist). */
    const syncShadowToWasm = (): void => {
      const w = wasm as unknown as {
        setReg(i: number, v: number): void;
        setPc(v: number): void;
        setSreg(v: number): void;
        setSp?(v: number): void;
      };
      if (
        typeof w.setReg !== 'function' ||
        typeof w.setPc !== 'function' ||
        typeof w.setSreg !== 'function'
      ) {
        return;
      }
      pullWasmState(w, readShadowState(this.cpu));
    };

    // Settle cadence is owned by `stepShadowInstruction`: the attached path
    // steps the shadow one instruction at a time too, so the settle counter
    // and the JS-only path stay on the same schedule. Accounting for settles
    // again here would fire every `settleEvery` twice.
    const stepShadow = (): boolean => this.stepShadowInstruction(settleEvery);

    // Prime Wasm from the shadow so a mid-run attach resumes correctly.
    syncShadowToWasm();

    let remaining = totalCycles;
    while (remaining > 0) {
      if (this.failed) return;
      let trappedPc: number;
      try {
        trappedPc = wasm.step(remaining);
      } catch {
        // Wasm-side failure: finish the slice on the JS shadow.
        for (let i = 0; i < remaining; i++) {
          if (!stepShadow()) return;
        }
        syncShadowToWasm();
        return;
      }
      if (trappedPc === -1) {
        // The module consumed the rest of the slice's instruction budget
        // cleanly; the shadow still owes the slice its own execution.
        for (let i = 0; i < remaining; i++) {
          if (!stepShadow()) return;
        }
        syncShadowToWasm();
        return;
      }
      if (!Number.isInteger(trappedPc) || trappedPc < 0) {
        // Malformed trap: finish the slice on the JS shadow.
        for (let i = 0; i < Math.max(0, remaining); i++) {
          if (!stepShadow()) return;
        }
        syncShadowToWasm();
        return;
      }

      // Shadow catches up to the trap PC, then executes the trapped op.
      //
      // The catch-up is capped by the slice budget, never by a wall-clock
      // guard. A trap PC that the shadow's own path never reaches (wasm
      // diverged and reported a PC behind, or off, the shadow's execution) is
      // indistinguishable from a long forward jump until the budget runs out:
      // stepping past `remaining` here would over-run the slice and hand the
      // bench more simulated time than it asked for, which shows up as extra
      // edges. When the cap is hit the slice is simply over — every
      // instruction it owed has run on the shadow's true path — and Wasm is
      // re-primed from the shadow for the next one.
      let steps = 0;
      while (this.cpu.pc !== trappedPc && steps < remaining) {
        if (!stepShadow()) return;
        steps += 1;
      }
      if (this.cpu.pc === trappedPc && steps < remaining) {
        // The trapped op itself, executed once by the shadow.
        if (!stepShadow()) return;
        steps += 1;
      }
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
        // Snapshot watched addresses before the instruction executes, so a
        // write that changes any byte in the range is detected afterwards.
        const snapshots = new Map<number, number[]>();
        for (const [id, wp] of this.watchpoints) {
          snapshots.set(id, Array.from(this.cpu.data.subarray(wp.address, wp.address + wp.size)));
        }
        if (!this.stepShadowInstruction(settleEvery)) return;
        // Check whether any watchpoint fired.
        let firedId: number | null = null;
        for (const [id, wp] of this.watchpoints) {
          const before = snapshots.get(id)!;
          const after = this.cpu.data.subarray(wp.address, wp.address + wp.size);
          if (!before.every((byte, index) => byte === after[index])) {
            firedId = id;
            break;
          }
        }
        if (firedId !== null) {
          // Find a source row for the current PC, or synthesize one.
          const rows = this.debugRows.get(this.cpu.pc);
          const row = rows?.[0] ?? { pc: this.cpu.pc, file: 'watchpoint', line: 0 };
          this.pausedLine = null;
          this.pausedFrame = this.frameFor(row);
          this.msCarry = 0;
          return;
        }
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
    this.watchpoints.clear();
    this.watchpointIdCounter = 0;
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
