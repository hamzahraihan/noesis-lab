/**
 * Minimal GDB remote serial protocol handler for the compiled AVR core.
 *
 * Wokwi debugs compiled firmware over GDB; this is the bounded version of
 * that: a small state machine that turns GDB packets into AvrBackend calls and
 * back. It does not run a TCP server or a serial bridge — it is the pure
 * protocol layer, testable on its own, and a future integration step wires
 * it to the bench's serial channel.
 *
 * Packet format: `$<payload>#<checksum>` where checksum is two hex digits
 * (sum of payload bytes mod 256). Responses are the same shape.
 *
 * Handled packets:
 *   ?              stop reason (S05 = SIGTRAP)
 *   g              read all 32 registers + SREG + SP + PC
 *   m<addr>,<len>  read memory (hex bytes)
 *   M<addr>,<len>:<hex>  write memory
 *   c              continue
 *   s              single step
 *   Z0,<addr>,<kind>  set SW breakpoint
 *   z0,<addr>,<kind>  remove SW breakpoint
 *   qSupported     supported features
 *   qXfer:memory-map:read::<off>,<len>  memory map XML
 *
 * Anything else gets an empty response (GDB treats that as "not supported").
 */
import type { AvrBackend } from '../core';

/** One GDB packet after framing is stripped. */
export interface GdbPacket {
  readonly payload: string;
}

/** A memory region for the memory map. */
export interface MemoryRegion {
  readonly start: number;
  readonly length: number;
  readonly type: 'ram' | 'flash' | 'io';
}

export class GdbRemoteProtocol {
  private readonly backend: AvrBackend;
  /** SW breakpoints GDB has set, by address. */
  private readonly breakpoints: Set<number> = new Set();
  /** Whether the target is currently stopped. */
  private stopped = true;

  constructor(backend: AvrBackend) {
    this.backend = backend;
  }

  /** Whether the target is stopped (vs running). */
  get isStopped(): boolean {
    return this.stopped;
  }

  /**
   * Handles one GDB packet payload (framing already stripped) and returns the
   * response payload (framing added by the caller).
   */
  handlePacket(payload: string): string {
    if (payload === '?') {
      // Stop reason: SIGTRAP (5).
      return 'S05';
    }

    if (payload === 'g') {
      return this.readRegisters();
    }

    if (payload.startsWith('m')) {
      return this.readMemory(payload.slice(1));
    }

    if (payload.startsWith('M')) {
      return this.writeMemory(payload.slice(1));
    }

    if (payload === 'c') {
      this.stopped = false;
      // In a real integration, this would resume the sim loop. Here we
      // just flip the flag; the caller drives stepping.
      return 'OK';
    }

    if (payload === 's') {
      // Single step: the caller is expected to call backend.step() once.
      this.stopped = false;
      return 'S05';
    }

    if (payload.startsWith('Z0,')) {
      const addr = parseInt(payload.slice(3).split(',')[0]!, 16);
      if (Number.isFinite(addr)) {
        this.breakpoints.add(addr);
        return 'OK';
      }
      return '';
    }

    if (payload.startsWith('z0,')) {
      const addr = parseInt(payload.slice(3).split(',')[0]!, 16);
      if (Number.isFinite(addr)) {
        this.breakpoints.delete(addr);
        return 'OK';
      }
      return '';
    }

    if (payload === 'qSupported') {
      return 'PacketSize=4096;qXfer:memory-map:read+';
    }

    if (payload.startsWith('qXfer:memory-map:read::')) {
      return this.memoryMap(payload.slice('qXfer:memory-map:read::'.length));
    }

    // Unknown packet: empty response means "not supported".
    return '';
  }

  /** Frames a payload for transmission: `$<payload>#<checksum>`. */
  static frame(payload: string): string {
    let sum = 0;
    for (let i = 0; i < payload.length; i++) {
      sum = (sum + payload.charCodeAt(i)) & 0xff;
    }
    return `$${payload}#${sum.toString(16).padStart(2, '0')}`;
  }

  /** Parses a framed packet, returning the payload or null if malformed. */
  static parse(frame: string): string | null {
    const match = /^\$(.*)#([0-9a-fA-F]{2})$/.exec(frame);
    if (!match) return null;
    const payload = match[1]!;
    const expected = parseInt(match[2]!, 16);
    let sum = 0;
    for (let i = 0; i < payload.length; i++) {
      sum = (sum + payload.charCodeAt(i)) & 0xff;
    }
    if (sum !== expected) return null;
    return payload;
  }

  /** Reads all 32 registers + SREG + SP + PC as a hex string. */
  private readRegisters(): string {
    const frame = this.backend.debugFrame();
    if (!frame) return '';
    // GDB AVR register order: r0-r31, SREG, SP (2 bytes), PC (4 bytes, in bytes).
    const regs: string[] = [];
    for (let i = 0; i < 32; i++) {
      const reg = frame.registers.find((r) => r.name === `r${i}`);
      const val = reg ? parseInt(reg.value, 16) : 0;
      regs.push(val.toString(16).padStart(2, '0'));
    }
    // SREG
    const sreg = frame.registers.find((r) => r.name === 'SREG');
    regs.push((sreg ? parseInt(sreg.value, 16) : 0).toString(16).padStart(2, '0'));
    // SP (2 bytes, little-endian)
    const sp = frame.registers.find((r) => r.name === 'SP');
    const spVal = sp ? parseInt(sp.value, 16) : 0;
    regs.push((spVal & 0xff).toString(16).padStart(2, '0'));
    regs.push(((spVal >> 8) & 0xff).toString(16).padStart(2, '0'));
    // PC (4 bytes, in bytes, little-endian)
    const pcVal = frame.pc;
    for (let i = 0; i < 4; i++) {
      regs.push(((pcVal >> (i * 8)) & 0xff).toString(16).padStart(2, '0'));
    }
    return regs.join('');
  }

  /** Reads memory: `m<addr>,<len>` → hex bytes. */
  private readMemory(payload: string): string {
    const parts = payload.split(',');
    if (parts.length < 2) return 'E01';
    const addr = parseInt(parts[0]!, 16);
    const len = parseInt(parts[1]!, 16);
    if (!Number.isFinite(addr) || !Number.isFinite(len) || len < 0) return 'E01';
    const bytes = this.backend.readMemory(addr, len);
    if (bytes.length === 0 && len > 0) return 'E01';
    return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /** Writes memory: `M<addr>,<len>:<hex>` → OK or E01. */
  private writeMemory(payload: string): string {
    const colon = payload.indexOf(':');
    if (colon < 0) return 'E01';
    const header = payload.slice(0, colon);
    const hex = payload.slice(colon + 1);
    const parts = header.split(',');
    if (parts.length < 2) return 'E01';
    const addr = parseInt(parts[0]!, 16);
    const len = parseInt(parts[1]!, 16);
    if (!Number.isFinite(addr) || !Number.isFinite(len) || len < 0) return 'E01';
    if (hex.length !== len * 2) return 'E01';
    // Write bytes to the data space via readMemory's backing store.
    // The AvrBackend doesn't expose a writeMemory yet, so we return E01
    // (not supported) until that lands. This keeps the protocol honest.
    return 'E01';
  }

  /** Memory map XML response. */
  private memoryMap(_query: string): string {
    // Simple memory map: flash (0x0000-0x7FFF) and SRAM (0x0100-0x08FF).
    const xml = `<memory-map><memory type="flash" start="0" length="0x8000"/><memory type="ram" start="0x100" length="0x800"/></memory-map>`;
    // GDB expects the response in chunks; for simplicity, return the whole thing.
    return `l${xml}`;
  }

  /** The set of SW breakpoint addresses. */
  get breakpointSet(): ReadonlySet<number> {
    return this.breakpoints;
  }
}
