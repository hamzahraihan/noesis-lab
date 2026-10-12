// Timer1 PWM acceptance: a worker-compiled analogWrite sketch fades D9.
//
// Gated twice like the gallery Tier-2 fixture (toolchain presence, then
// Tier-2 fetch reachability): without either, the test SKIPs with a reason
// instead of failing. With both, the sketch compiles through the worker
// project path with no extra libraries, flashes onto an AvrBackend over the
// alarm wiring family (Uno + breadboard), and steps; D9 must sit at ~0.5
// duty while the Timer0 path (gpio 5/6) stays digital.
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { boardOption } from '@/features/learn/boardRegistry';
import { firmwareForBuild, galleryById } from '@/features/learn/gallery';
import { breadboardDefinition } from '@/features/parts';
import { Simulation } from '@/features/bench/simulations/simulation';
import { TIER2_MANIFEST } from '@/features/simulation';
import type { AvrBackend } from './core';

/**
 * Whether the Tier-2 fetch path answers at all. Same shape as the gallery
 * fixture gate: any HTTP answer counts as reachable; only a network failure
 * or timeout skips.
 */
async function tier2Reachable(): Promise<boolean> {
  try {
    const response = await fetch(TIER2_MANIFEST[0].url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000),
    });
    return response.status > 0;
  } catch {
    return false;
  }
}

describe('timer1 PWM acceptance', () => {
  it('fades D9 under a worker-compiled analogWrite sketch', async () => {
    let pkg: string | null = null;
    try {
      pkg = createRequire(import.meta.url).resolve('@horang-corp/avr-gcc-wasm/package.json');
    } catch { /* fall through to skip */ }
    if (!pkg) {
      console.warn('SKIP fade: toolchain absent');
      return;
    }
    if (!(await tier2Reachable())) {
      console.warn('SKIP fade: Tier-2 fetch unreachable');
      return;
    }
    const sketch = `#include <Arduino.h>\nvoid setup() {}\nvoid loop() { analogWrite(9, 128); }\n`;
    // Alarm wiring family: Uno + breadboard + the alarm project's setup, so
    // the bench around the core matches the gallery legs.
    const alarmSetup = galleryById('alarm-clock')!.builds[0]!.setup;
    const board = boardOption('uno').make();
    const simulation = new Simulation(board);
    simulation.execution = 'avr';
    simulation.addPart(board, 0, 0);
    simulation.addPart(breadboardDefinition(), 230, 0);
    alarmSetup(simulation);
    // Compile via the worker project path with no extra libraries.
    await simulation.compileAndRun(
      firmwareForBuild({ board: 'uno', setup: alarmSetup, sketch }, 'arduino-cpp'),
    );
    expect(simulation.compileState, 'fade sketch compiles').toBe('ready');
    expect(simulation.firmwareError, 'fade sketch firmware').toBeNull();
    const backend = (simulation as unknown as { avrBackend: AvrBackend | null }).avrBackend;
    expect(backend, 'fresh HEX flashes onto a live core').not.toBeNull();
    // Step 50 ms frames on the AvrBackend; analogWrite re-stamps the duty
    // every loop iteration, so the mcu intent converges to the PWM level.
    for (let frame = 0; frame < 3; frame++) backend!.step(50);
    expect(backend!.fault, 'no core fault surfaces').toBeNull();
    const duty9 = simulation.mcu.configurationOf(simulation.mcu.pinIdForGpio(9)!).duty;
    expect(duty9, 'D9 duty ~0.5').toBeGreaterThan(0.48);
    expect(duty9, 'D9 duty ~0.5').toBeLessThan(0.52);
    // Timer0 path untouched: gpio 5/6 stay digital at 0.
    for (const gpio of [5, 6]) {
      const configuration = simulation.mcu.configurationOf(simulation.mcu.pinIdForGpio(gpio)!);
      expect(configuration.pwm, `gpio ${gpio} stays digital`).toBe(false);
      expect(configuration.duty, `gpio ${gpio} stays 0`).toBe(0);
    }
    // Budget: a cold single-TU build compiles the Arduino core plus the
    // sketch TU through the wasm toolchain (measured in minutes, not
    // seconds); the browser reuses its versioned cache across sessions,
    // Node rebuilds every run.
  }, 1_500_000);
});
