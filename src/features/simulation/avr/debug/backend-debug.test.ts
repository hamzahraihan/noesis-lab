import { describe, expect, it } from 'vitest';
import { McuRuntime } from '@/features/simulation/mcu';
import { arduinoUnoR3 } from '@/features/parts/boards';
import { AvrBackend } from '../core';
import type { CompiledDebugInfo } from './lines';

/** NOPs; long enough that a slice never reaches the end of flash. */
function nops(count = 64): Uint16Array {
  return new Uint16Array(count);
}

function backend(program: Uint16Array): AvrBackend {
  return new AvrBackend(program, {
    mcu: new McuRuntime(arduinoUnoR3()),
    nowMs: () => 0,
    readPin: () => false,
    onSettle: () => {},
    serial: { serialWrite: () => {} },
    i2c: { writeByte: () => true, readByte: () => 0xff },
  });
}

/** RCALL +1 (pc0 -> pc2), NOP, RET, then NOPs. */
function callProgram(): Uint16Array {
  const words = nops();
  words[0] = 0xd001;
  words[2] = 0x0000;
  words[3] = 0x9508;
  return words;
}

const straightLines: CompiledDebugInfo = {
  lines: [
    { pc: 0, file: 'main.ino', line: 1 },
    { pc: 2, file: 'main.ino', line: 2 },
  ],
  functions: [],
  globals: [],
  types: [],
};

const callLines: CompiledDebugInfo = {
  lines: [
    { pc: 0, file: 'main.ino', line: 1 },
    { pc: 1, file: 'main.ino', line: 4 },
    { pc: 2, file: 'main.ino', line: 2 },
    { pc: 3, file: 'main.ino', line: 3 },
  ],
  functions: [],
  globals: [],
  types: [],
};

/** A block brace and its first statement share one instruction's address. */
const boundaryLines: CompiledDebugInfo = {
  lines: [
    { pc: 0, file: 'main.ino', line: 6 },
    { pc: 0, file: 'main.ino', line: 7 },
    { pc: 2, file: 'main.ino', line: 8 },
  ],
  functions: [],
  globals: [],
  types: [],
};

/** PUSH r16 lowers SP without calling; step-over must not wait for a return. */
const prologueProgram = new Uint16Array([0x930f, 0x0000, ...new Array(62).fill(0)]);
const prologueLines: CompiledDebugInfo = {
  lines: [
    { pc: 0, file: 'main.ino', line: 1 },
    { pc: 1, file: 'main.ino', line: 2 },
  ],
  functions: [],
  globals: [],
  types: [],
};

function stopAt(file: string, line: number): {
  readonly armed: boolean;
  hasBreakpoint(candidate: string, candidateLine: number): boolean;
} {
  return {
    armed: true,
    hasBreakpoint: (candidate, candidateLine) =>
      candidate === file && candidateLine === line,
  };
}

describe('compiled AVR debugging', () => {
  it('stops before a breakpoint line and reports PC and registers', () => {
    const avr = backend(nops());
    avr.attachDebug(straightLines);
    avr.setDebugStops(stopAt('main.ino', 2));

    avr.step(1);

    expect(avr.debugPaused()).toBe(true);
    const frame = avr.debugFrame();
    expect(frame).not.toBeNull();
    expect(frame?.file).toBe('main.ino');
    expect(frame?.line).toBe(2);
    expect(frame?.compiled).toBe(true);
    // CPU PC 2 words is byte address 4, the GDB-facing address.
    expect(frame?.pc).toBe(4);
    const names = frame?.registers?.map((register) => register.name) ?? [];
    expect(names).toContain('r0');
    expect(names).toContain('r31');
    expect(names).toContain('SP');
    expect(names).toContain('SREG');
    expect(names).toContain('PC');
    // The worker deduplicates by reference: the same stop must hand back the
    // same object until it moves.
    expect(avr.debugFrame()).toBe(frame);
  });

  it('does not stop again on the line it resumed from', () => {
    const avr = backend(nops(4096));
    avr.attachDebug(straightLines);
    avr.setDebugStops(stopAt('main.ino', 2));
    avr.step(0.1);
    expect(avr.debugPaused()).toBe(true);

    avr.resumeDebug();
    expect(avr.debugPaused()).toBe(false);
    avr.step(0.1);

    expect(avr.debugPaused()).toBe(false);
  });

  it('steps into the next source line', () => {
    const avr = backend(callProgram());
    avr.attachDebug(callLines);
    avr.setDebugStops(stopAt('main.ino', 1));
    avr.step(1);
    expect(avr.debugFrame()?.line).toBe(1);

    avr.stepDebug('into');
    avr.step(1);

    expect(avr.debugFrame()?.line).toBe(2);
  });

  it('steps over a call and stops after it returns', () => {
    const avr = backend(callProgram());
    avr.attachDebug(callLines);
    avr.setDebugStops(stopAt('main.ino', 1));
    avr.step(1);
    expect(avr.debugFrame()?.line).toBe(1);

    avr.stepDebug('over');
    avr.step(1);

    expect(avr.debugFrame()?.file).toBe('main.ino');
    expect(avr.debugFrame()?.line).toBe(4);
  });

  it('steps over a prologue that lowers SP but calls nothing', () => {
    const avr = backend(prologueProgram);
    avr.attachDebug(prologueLines);
    avr.setDebugStops(stopAt('main.ino', 1));
    avr.step(1);
    expect(avr.debugFrame()?.line).toBe(1);

    avr.stepDebug('over');
    avr.step(1);

    expect(avr.debugFrame()?.line).toBe(2);
  });

  it('keeps the shadow authoritative when Wasm is attached', () => {
    let wasmSteps = 0;
    const avr = backend(nops());
    avr.attachWasm({
      step: () => {
        wasmSteps += 1;
        return -1;
      },
    } as never);
    avr.attachDebug(straightLines);
    avr.setDebugStops(stopAt('main.ino', 2));

    avr.step(1);

    expect(avr.debugFrame()?.line).toBe(2);
    expect(wasmSteps).toBe(0);
  });

  it('stops on either source row that shares a PC', () => {
    const avr = backend(nops());
    avr.attachDebug(boundaryLines);
    avr.setDebugStops(stopAt('main.ino', 7));

    avr.step(1);

    expect(avr.debugPaused()).toBe(true);
    expect(avr.debugFrame()?.line).toBe(7);
  });

  it('does not step onto a sibling row at the paused PC', () => {
    const avr = backend(nops(4096));
    avr.attachDebug(boundaryLines);
    avr.setDebugStops(stopAt('main.ino', 6));
    avr.step(0.1);
    expect(avr.debugFrame()?.line).toBe(6);

    avr.stepDebug('into');
    avr.step(0.1);

    // Line 7 shares PC 0, so it is part of the paused instruction, not the
    // next source line. The step must land on line 8 instead.
    expect(avr.debugPaused()).toBe(true);
    expect(avr.debugFrame()?.line).toBe(8);
  });

  it('runs unchanged when the firmware carries no debug info', () => {
    const avr = backend(nops());
    avr.step(1);
    expect(avr.debugPaused()).toBe(false);
    expect(avr.cycles).toBe(16_000);
  });
});
