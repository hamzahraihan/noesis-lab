/* HARNESS-ONLY / DO NOT SHIP as gate evidence */
import { describe, expect, it } from 'vitest';
import { CPU } from 'avr8js';
import { arduinoUnoR3 } from '@/features/parts';
import { McuRuntime } from '@/features/simulation/mcu';
import { attachGpioBridge } from '@/features/simulation/avr/gpio';

// Task 4 wires these into a real blink-firmware parity check; referenced so
// noUnusedLocals stays green until then. Test body below is verbatim brief.
void [CPU, arduinoUnoR3, McuRuntime, attachGpioBridge];

describe('wasm parity', () => {
  it('matches JS D13 cycle count for blink', async () => {
    const { stepParity } = await import('./wasm-core');
    const r = await stepParity(16000);
    expect(r.wasmCycles).toBe(r.jsCycles);
  });
});
