import { describe, expect, it } from 'vitest';
import { Simulation } from './simulation';
import { toSingleFileProject } from '@/features/simulation';
import { arduinoUnoR3 } from '@/features/parts';
import {
  avrAvailableFor,
  esp32AvailableFor,
  resolveBackendSelection,
  rp2040AvailableFor,
  type BackendAvailability,
} from './avr-mode';

describe('avr mode availability', () => {
  it('is available on the Uno', () => {
    expect(avrAvailableFor('uno')).toEqual({ ok: true });
  });

  it('is refused elsewhere with a reason', () => {
    expect(avrAvailableFor('mega')).toEqual({ ok: false, reason: expect.any(String) });
  });
});

describe('rp2040 mode availability', () => {
  it('is available on the Nano RP2040 Connect while the worker is there', () => {
    expect(rp2040AvailableFor('rp2040', true)).toEqual({ ok: true });
  });

  it('is refused on another board', () => {
    expect(rp2040AvailableFor('uno', true)).toEqual({ ok: false, reason: expect.any(String) });
  });

  it('is refused without the simulation worker, because the engine lives there', () => {
    expect(rp2040AvailableFor('rp2040', false)).toEqual({
      ok: false,
      reason: 'RP2040 mode needs the simulation worker',
    });
  });
});

describe('esp32 mode availability', () => {
  it('is available on the ESP32 while the worker is there', () => {
    expect(esp32AvailableFor('esp32', true)).toEqual({ ok: true });
  });

  it('is refused on another board', () => {
    expect(esp32AvailableFor('uno', true)).toEqual({ ok: false, reason: expect.any(String) });
  });

  it('is refused without the simulation worker, because the emulator lives there', () => {
    expect(esp32AvailableFor('esp32', false)).toEqual({
      ok: false,
      reason: 'ESP32 mode needs the simulation worker',
    });
  });

  it('is refused for a C++ sketch, because the chip runs MicroPython', () => {
    expect(esp32AvailableFor('esp32', true, 'arduino-cpp')).toEqual({
      ok: false,
      reason: expect.stringContaining('MicroPython'),
    });
  });
});

const AVAILABLE: BackendAvailability = { ok: true };

/** The selector's inputs, with only the fields under test overridden. */
function select(overrides: Partial<Parameters<typeof resolveBackendSelection>[0]>) {
  return resolveBackendSelection({
    execution: undefined,
    avr: AVAILABLE,
    rp2040: AVAILABLE,
    esp32: AVAILABLE,
    avrMode: false,
    rp2040Mode: false,
    esp32Mode: false,
    ...overrides,
  });
}

describe('backend selection', () => {
  it('pins an AVR-only build to AVR with the interpreter disabled', () => {
    expect(select({ execution: 'avr' })).toEqual({
      value: 'avr',
      interpreterDisabled: true,
      interpreterTitle: 'This build runs on AVR only',
    });
  });

  it('pins an RP2040-only build to RP2040 with the interpreter disabled', () => {
    expect(select({ execution: 'rp2040' })).toEqual({
      value: 'rp2040',
      interpreterDisabled: true,
      interpreterTitle: 'This build runs on RP2040 only',
    });
  });

  it('honours the rp2040 mode when the board and the worker allow it', () => {
    expect(select({ rp2040Mode: true }).value).toBe('rp2040');
  });

  it('falls back to the interpreter when the rp2040 mode is unavailable', () => {
    expect(select({ rp2040Mode: true, rp2040: { ok: false, reason: 'no worker' } }).value).toBe(
      'interpreter',
    );
  });

  it('leaves free builds on the current choice', () => {
    expect(select({ avrMode: true }).value).toBe('avr');
    expect(select({}).value).toBe('interpreter');
    expect(
      select({ avr: { ok: false, reason: 'AVR mode needs an Uno board' } }).interpreterDisabled,
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
