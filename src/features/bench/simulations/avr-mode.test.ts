import { describe, expect, it } from 'vitest';
import { Simulation } from './simulation';
import { toSingleFileProject } from '@/features/simulation';
import { arduinoUnoR3 } from '@/features/parts';
import { avrAvailableFor, resolveBackendSelection, rp2040AvailableFor } from './avr-mode';

describe('avr mode availability', () => {
  it('is available on the Uno', () => {
    expect(avrAvailableFor('uno')).toEqual({ ok: true });
  });

  it('is refused elsewhere with a reason', () => {
    expect(avrAvailableFor('mega')).toEqual({ ok: false, reason: expect.any(String) });
  });
});

describe('rp2040 mode availability', () => {
  it('is available on the Nano RP2040 Connect', () => {
    expect(rp2040AvailableFor('rp2040')).toEqual({ ok: true });
  });

  it('is refused elsewhere with a reason', () => {
    expect(rp2040AvailableFor('uno')).toEqual({ ok: false, reason: expect.any(String) });
  });
});

describe('backend selection', () => {
  it('pins an AVR-only build to AVR with interpreter disabled', () => {
    expect(resolveBackendSelection({ execution: 'avr', avr: { ok: true }, avrMode: false })).toEqual({
      value: 'avr',
      interpreterDisabled: true,
      interpreterTitle: 'This build runs on AVR only',
    });
  });

  it('pins the deep link before avrMode catches up', () => {
    const selection = resolveBackendSelection({
      execution: 'avr',
      avr: { ok: true },
      avrMode: false,
    });
    expect(selection.value).toBe('avr');
    expect(selection.interpreterDisabled).toBe(true);
  });

  it('leaves free builds on the current choice', () => {
    expect(
      resolveBackendSelection({ execution: undefined, avr: { ok: true }, avrMode: true }).value,
    ).toBe('avr');
    expect(
      resolveBackendSelection({ execution: undefined, avr: { ok: true }, avrMode: false }).value,
    ).toBe('interpreter');
    expect(
      resolveBackendSelection({
        execution: undefined,
        avr: { ok: false, reason: 'AVR mode needs an Uno board' },
        avrMode: false,
      }).interpreterDisabled,
    ).toBe(false);
  });
});

describe('avr compile failure landing', () => {
  it('reports library file:line from worker failures', async () => {
    const simulation = new Simulation(arduinoUnoR3(), {
      avrCompile: async () => {
        throw { message: 'boom', tab: 'MyLib.cpp', line: 3 };
      },
    });
    await simulation.compileAndRun(
      toSingleFileProject('void setup() {}\nvoid loop() {}\n', 'arduino-cpp'),
    );
    expect(simulation.firmwareError).toContain('MyLib.cpp:3');
  });
});
