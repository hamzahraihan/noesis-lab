import { AVRTimer, CPU, avrInstruction, timer0Config, timer2Config } from 'avr8js';
import type { McuRuntime } from '@/features/simulation/mcu';
import { UNO_CLOCK_HZ, cyclesPerMs, type ExecutionBackend } from './backend';
import type { WasmCore } from './wasm-core';
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

export class AvrBackend implements ExecutionBackend {
  private cpu: CPU;
  private readonly programWords: Uint16Array;
  private readonly hooks: AvrHooks;
  private msCarry = 0;
  private sinceSettle = 0;
  private msCounter = 0;
  clampedMs = 0;
  private failed: string | null = null;
  // Unwired WASM seam (Task 4): no setter exists by design — `loadWasmCore`
  // returns `WebAssembly.Module | null`, not a `WasmCore`, and no adapter
  // instantiates one yet. The `step()` WASM branch below is therefore
  // unreachable until a later task adds the injection point (e.g.
  // `attachWasm(core: WasmCore)`) plus an adapter that syncs CPU state
  // (cycles, msCounter, peripheral bridges — see branch note). Kept as the
  // explicit routing target so the seam is visible, not as live code.
  private wasm: WasmCore | null = null;

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
      // TODO(wasm): unwired stub — reachable only via a future injection point
      // (see field note). Cadence accounting is live (`sinceSettle` accrues the
      // batch with remainder, one `onSettle` per `settleEvery`), but the core
      // itself is NOT advanced here: neither `cpu.cycles`/`msCounter` (the tickMs
      // clock event stays parked) nor the gpio/timer1/usart/twi bridges move, so
      // `cycles`/`millis()` would go stale. Do not enable until the adapter syncs
      // WASM↔CPU state, maps `stepCycles` faults onto the
      // `core fault at PC=… cycles=…` contract (this branch has no try/catch by
      // design — the fault type does not exist yet), and `reset()` clears WASM
      // state alongside the CPU rebuild.
      this.wasm.stepCycles(totalCycles);
      this.sinceSettle += totalCycles;
      while (this.sinceSettle >= settleEvery) {
        this.sinceSettle -= settleEvery;
        this.hooks.onSettle();
      }
    } else {
      for (let i = 0; i < totalCycles; i++) {
        try {
          avrInstruction(this.cpu);
          this.cpu.tick();
        } catch (error) {
          this.failed = `core fault at PC=${this.cpu.pc} cycles=${this.cpu.cycles}: ${String(error)}`;
          return;
        }
        this.sinceSettle += 1;
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
    // Unwired WASM seam: `wasm` has no injection point yet (always null), so
    // there is no WASM state to clear. The wiring task must reset/sync WASM
    // state here alongside the CPU rebuild (see `step()` branch note).
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
