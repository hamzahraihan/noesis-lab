import { describe, expect, it } from 'vitest';
import type { ScriptedI2cSlave } from './device';
import { ScriptedI2cDevice } from './scripted';

/**
 * The device's own contract: what the bus's bytes mean to the script.
 *
 * The engine-level legs (`simulation/scripted/i2c.test.ts`) prove the whole
 * chain; these pin the one translation in the middle, including the cases the
 * bus cannot express by itself -- a slave that refuses a byte, a short answer,
 * and a slave that is not there at all.
 */
function device(slave: Partial<ScriptedI2cSlave> = {}): {
  device: ScriptedI2cDevice;
  asked: { read: [number, number][]; write: [number, readonly number[]][] };
} {
  const asked = { read: [] as [number, number][], write: [] as [number, readonly number[]][] };
  const stub: ScriptedI2cSlave = {
    read: (register, count) => {
      asked.read.push([register, count]);
      return slave.read === undefined ? [0] : slave.read(register, count);
    },
    write: (register, bytes) => {
      asked.write.push([register, bytes]);
      return slave.write?.(register, bytes) ?? true;
    },
  };
  return { device: new ScriptedI2cDevice(0x50, stub), asked };
}

describe('a scripted I2C device', () => {
  it('takes the first byte of a transaction as the register pointer', () => {
    const { device: slave, asked } = device({ read: () => [0x11] });
    expect(slave.receive(0x02, true)).toBe(true);
    expect(slave.read(1)).toEqual([0x11]);
    expect(asked.read).toEqual([[0x02, 1]]);
  });

  it('hands each data byte to the script under that register, one at a time', () => {
    const { device: slave, asked } = device();
    slave.receive(0x02, true);
    expect(slave.receive(0x5a, false)).toBe(true);
    expect(slave.receive(0x5b, false)).toBe(true);
    expect(asked.write).toEqual([
      [0x02, [0x5a]],
      [0x02, [0x5b]],
    ]);
  });

  it('NACKs a byte the script refuses', () => {
    const { device: slave } = device({ write: () => false });
    slave.receive(0x02, true);
    expect(slave.receive(0x5a, false)).toBe(false);
  });

  it('repeats a short answer rather than running off the end', () => {
    const { device: slave } = device({ read: () => [0x7f] });
    slave.receive(0x00, true);
    expect(slave.read(3)).toEqual([0x7f, 0x7f, 0x7f]);
  });

  it('answers nothing at all when the slave has no answer, which is a NACK', () => {
    const { device: slave } = device({ read: () => null });
    slave.receive(0x00, true);
    expect(slave.read(2)).toEqual([]);
  });
});
