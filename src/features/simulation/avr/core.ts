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
  // WASM seam: the `attachWasm`/`attachWasmReset` setters exist, but no
  // adapter instantiates a `WasmCore` or syncs real Wasm state/reset yet.
  // The `step()` non-null branch below throws by design until the adapter
  // lands. JS default path is unchanged.
  private wasm: WasmCore | null = null;
  private wasmReset: (() => void) | null = null;

  attachWasm(core: WasmCore | null): void {
    this.wasm = core;
  }

  attachWasmReset(fn: (() => void) | null): void {
    this.wasmReset = fn;
  }

  stepShadowOnce(): boolean {
    try {
      avrInstruction(this.cpu);
      this.cpu.tick();
      return true;
    } catch (error) {
      this.failed = `core fault at PC=${this.cpu.pc} cycles=${this.cpu.cycles}: ${String(error)}`;
      return false;
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
      // WASM seam: the setter exists but the adapter (WASM↔CPU state sync,
      // fault mapping, reset sync) is still missing, so the non-null path
      // throws by design instead of partially stepping.
      throw new Error('wasm seam unwired');
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
    // Attached Wasm reset hook fires alongside the JS rebuild (spec: reset
    // clears both), but no adapter wires real Wasm state/reset sync yet.
    this.wasmReset?.();
    // WASM seam: non-null `step()` path throws by design until the step
    // adapter lands; the hook above is the only Wasm reset cleared here.
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
