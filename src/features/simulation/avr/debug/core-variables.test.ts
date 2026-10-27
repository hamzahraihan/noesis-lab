import { describe, expect, it } from 'vitest';
import { McuRuntime } from '@/features/simulation/mcu';
import { arduinoUnoR3 } from '@/features/parts/boards';
import { AvrBackend } from '../core';
import type { CompiledDebugInfo } from './lines';

function backend(): AvrBackend {
  return new AvrBackend(new Uint16Array(64), {
    mcu: new McuRuntime(arduinoUnoR3()),
    nowMs: () => 0,
    readPin: () => false,
    onSettle: () => {},
    serial: { serialWrite: () => {} },
    i2c: { writeByte: () => true, readByte: () => 0xff },
  });
}

const info: CompiledDebugInfo = {
  lines: [{ pc: 0, file: 'main.ino', line: 1 }],
  functions: [
    {
      lowPc: 0,
      highPc: 2,
      variables: [
        {
          name: 'g',
          type: 0,
          scope: 'local',
          location: { kind: 'expr', bytes: [0x03, 0x00, 0x01, 0x80, 0x00] },
        },
      ],
    },
  ],
  globals: [],
  types: [{ kind: 'base', name: 'int', byteSize: 2, encoding: 5 }],
};

describe('compiled debug frame variables', () => {
  it('reports a variable and an SRAM snapshot at a stop', () => {
    const avr = backend();
    avr.attachDebug(info);
    avr.setDebugStops({
      armed: true,
      hasBreakpoint: (file, line) => file === 'main.ino' && line === 1,
    });
    const cpu = (avr as unknown as { cpu: { data: Uint8Array } }).cpu;
    cpu.data[0x100] = 7;
    avr.step(1);
    const frame = avr.debugFrame();
    expect(frame?.variables).toMatchObject([{ name: 'g', value: '7', scope: 'local' }]);
    expect(frame?.memory?.start).toBe(0x100);
    expect(frame?.memory?.bytes).toHaveLength(0x800);
    expect(frame?.memory?.bytes[0]).toBe(7);
  });
});
