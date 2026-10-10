import { AVRTimer, CPU, avrInstruction, timer0Config, timer2Config } from 'avr8js';
import type { McuRuntime } from '@/features/simulation/mcu';
import { UNO_CLOCK_HZ, cyclesPerMs, type ExecutionBackend } from './backend';
import { attachGpioBridge } from './gpio';
import { attachTwiBridge } from './twi';
import { attachUsartBridge } from './usart';

export interface AvrHooks {
  readonly mcu: McuRuntime;
  readonly nowMs: () => number;
  readonly readPin: (gpio: number) => boolean;
  readonly onSettle: () => void;
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
  }

  private buildCpu(): CPU {
    const cpu = new CPU(new Uint16Array(this.programWords));
    // Timer0 free-runs from the TCCR0B prescaler so stock-core millis() and
    // delay(), which count its overflows, advance instead of hanging.
    new AVRTimer(cpu, timer0Config);
    // Timer2 drives Arduino tone()/noTone() (compare ISR toggles PORT, which
    // the GPIO bridge already syncs); Timer0 keeps millis()/delay().
    new AVRTimer(cpu, timer2Config);
    attachGpioBridge(cpu, this.hooks.mcu, this.hooks.nowMs, this.hooks.readPin);
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
