import { describe, expect, it } from 'vitest';
import { McuRuntime } from '@/features/simulation/mcu';
import { arduinoUnoR3 } from '@/features/parts/boards';
import { AvrBackend } from '../core';
import { GdbRemoteProtocol } from './gdb';

function backend(): AvrBackend {
  return new AvrBackend(new Uint16Array([]), {
    mcu: new McuRuntime(arduinoUnoR3()),
    nowMs: () => 0,
    readPin: () => false,
    onSettle: () => {},
    serial: { serialWrite: () => {} },
    i2c: { writeByte: () => true, readByte: () => 0xff },
  });
}

describe('GdbRemoteProtocol', () => {
  it('frames and parses packets', () => {
    const framed = GdbRemoteProtocol.frame('OK');
    expect(framed).toMatch(/^\$OK#[0-9a-f]{2}$/);
    expect(GdbRemoteProtocol.parse(framed)).toBe('OK');
    // Bad checksum returns null.
    expect(GdbRemoteProtocol.parse('$OK#00')).toBeNull();
    // Malformed returns null.
    expect(GdbRemoteProtocol.parse('OK')).toBeNull();
  });

  it('answers the stop reason', () => {
    const gdb = new GdbRemoteProtocol(backend());
    expect(gdb.handlePacket('?')).toBe('S05');
    expect(gdb.isStopped).toBe(true);
  });

  it('reports supported features', () => {
    const gdb = new GdbRemoteProtocol(backend());
    const resp = gdb.handlePacket('qSupported');
    expect(resp).toContain('PacketSize=');
    expect(resp).toContain('qXfer:memory-map:read+');
  });

  it('reads memory as hex bytes', () => {
    const avr = backend();
    const gdb = new GdbRemoteProtocol(avr);
    // Registers are all zero initially.
    const resp = gdb.handlePacket('m0,4');
    expect(resp).toBe('00000000');
    // Out-of-range returns E01.
    expect(gdb.handlePacket('mffff,4')).toBe('E01');
  });

  it('sets and removes SW breakpoints', () => {
    const gdb = new GdbRemoteProtocol(backend());
    expect(gdb.handlePacket('Z0,100,2')).toBe('OK');
    expect(gdb.breakpointSet.has(0x100)).toBe(true);
    expect(gdb.handlePacket('z0,100,2')).toBe('OK');
    expect(gdb.breakpointSet.has(0x100)).toBe(false);
  });

  it('handles continue and step', () => {
    const gdb = new GdbRemoteProtocol(backend());
    expect(gdb.handlePacket('c')).toBe('OK');
    expect(gdb.isStopped).toBe(false);
    expect(gdb.handlePacket('s')).toBe('S05');
  });

  it('returns empty for unknown packets', () => {
    const gdb = new GdbRemoteProtocol(backend());
    expect(gdb.handlePacket('foo')).toBe('');
  });

  it('provides a memory map', () => {
    const gdb = new GdbRemoteProtocol(backend());
    const resp = gdb.handlePacket('qXfer:memory-map:read::0,1000');
    expect(resp).toContain('memory-map');
    expect(resp).toContain('flash');
    expect(resp).toContain('ram');
  });
});
