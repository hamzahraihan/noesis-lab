import { CPU, avrInstruction } from 'avr8js';
import type { McuRuntime } from '@/features/simulation/mcu';
import { UNO_CLOCK_HZ, cyclesPerMs, type ExecutionBackend } from './backend';
import { attachGpioBridge } from './gpio';

export interface AvrHooks {
  readonly mcu: McuRuntime;
  readonly nowMs: () => number;
  readonly readPin: (gpio: number) => boolean;
  readonly onSettle: () => void;
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
    const settleEvery = perMs;
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
    attachGpioBridge(cpu, this.hooks.mcu, this.hooks.nowMs, this.hooks.readPin);
    const perMs = cyclesPerMs(UNO_CLOCK_HZ);
    const tickMs = (): void => {
      this.msCounter += 1;
      cpu.addClockEvent(tickMs, perMs);
    };
    cpu.addClockEvent(tickMs, perMs);
    return cpu;
  }
}
