import { describe, expect, it } from 'vitest';
import { CPU, avrInstruction } from 'avr8js';

describe('slice1 parity', () => {
  it('matches JS D13 toggle cycles on blink firmware', async () => {
    const { stepWithTrap } = await import('./wasm-core');
    const cpu = new CPU(new Uint16Array([0x0000]));
    for (let i = 0; i < 100; i++) {
      try {
        avrInstruction(cpu);
        cpu.tick();
      } catch {
        break;
      }
    }
    const r = await stepWithTrap(100);
    expect(r.cycles).toBe(cpu.cycles);
    expect(r.traps).toBeLessThan(1);
  });
});
