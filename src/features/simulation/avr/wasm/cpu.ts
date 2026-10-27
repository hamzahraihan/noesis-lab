// AVR WASM core: executes AVR machine code in WebAssembly.
//
// Flash + registers live in reserved low linear memory (flash bytes
// [0, 1024), regs bytes [1024, 1056)) — never under AS-managed addresses:
// the build passes `--memoryBase 2048` so emitted static segments and the
// heap start above our regions. `flash_base()` returns the flash byte
// pointer the host writes words through. Raw load/store keeps zero imports.
// SREG is an i32 global masked to 8 bits on write (I=7..C=0).
//
// Trap ABI (single-PC): `step(n)` returns -1 when it consumed all `n`
// cycles without trapping. Otherwise it returns the PC of the trapping
// instruction (unported opcode, out-of-bounds flash). The host then handles
// the trap and resumes.
import { alu_add } from './ops-alu';
import { alu_sub } from './ops-alu';

const FLASH_BASE: i32 = 0;
const FLASH_WORDS: i32 = 512;
const REGS_BASE: i32 = 1024;

// SREG bit positions (matching avr8js data[95] layout).
const SREG_C = 0x01;
const SREG_Z = 0x02;
const SREG_N = 0x04;
const SREG_V = 0x08;
const SREG_S = 0x10;
const SREG_H = 0x20;
const SREG_I = 0x80;

let pc: i32 = 0;
let cycles: i32 = 0;
let sreg: i32 = 0;

// Stack pointer (word address in data space; avr8js keeps it in data[93-94]).
let sp: i32 = 0;

// RAMEND: top of data space. On ATmega328P it's 0x8FF (2303 bytes).
// We only model registers + a small stack; SRAM access traps to JS.
const RAMEND: i32 = 0x8ff;

export function flash_base(): i32 {
  return FLASH_BASE;
}

export function reset_cpu(): void {
  for (let i = 0; i < 32; i++) store<u8>(REGS_BASE + i, 0);
  pc = 0;
  cycles = 0;
  sreg = 0;
  sp = RAMEND + 1;
}

export function get_reg(i: i32): i32 {
  return load<u8>(REGS_BASE + (i & 31)) as i32;
}

export function set_reg(i: i32, v: i32): void {
  store<u8>(REGS_BASE + (i & 31), v as u8);
}

export function get_pc(): i32 {
  return pc;
}

export function set_pc(v: i32): void {
  pc = v;
}

export function get_sreg(): i32 {
  return sreg;
}

export function set_sreg(v: i32): void {
  sreg = v & 0xff;
}

export function get_cycles(): i32 {
  return cycles;
}

export function get_sp(): i32 {
  return sp;
}

export function set_sp(v: i32): void {
  sp = v;
}

export function set_cycles(v: i32): void {
  cycles = v;
}

function readFlash(addr: i32): i32 {
  if (addr < 0 || addr >= FLASH_WORDS) return -1;
  return load<u16>(FLASH_BASE + addr * 2) as i32;
}

function readReg(rd: i32): i32 {
  return load<u8>(REGS_BASE + (rd & 31)) as i32;
}

function writeReg(rd: i32, v: i32): void {
  store<u8>(REGS_BASE + (rd & 31), v as u8);
}

// Extract Rd (matches avr8js: (opcode & 0x1f0) >> 4).
function decodeRd(w: i32): i32 {
  return (w & 0x1f0) >> 4;
}

// Extract Rr (matches avr8js: (opcode & 0xf) | ((opcode & 0x200) >> 5)).
function decodeRr(w: i32): i32 {
  return (w & 0x0f) | ((w & 0x200) >> 5);
}

function setFlagsFromAlu(packed: i32): void {
  sreg = (sreg & 0xc0) | ((packed >> 8) & 0x3f);
}

function setSimpleFlags(result: i32): void {
  const z = result === 0;
  const n = (result & 0x80) !== 0;
  // AND/OR/EOR clear V (and S follows N since V=0). H and C are preserved,
  // matching avr8js (it masks with 0xe1 keeping I,T,H,C).
  let flags = sreg & 0xe1; // keep I, T, H, C
  if (z) flags |= SREG_Z;
  if (n) flags |= SREG_N;
  if (n) flags |= SREG_S; // S = N ^ V, V=0 → S=N
  sreg = flags;
}

function setSubFlags(result: i32, val1: i32, val2: i32, borrow: boolean): void {
  const z = result === 0;
  const n = (result & 0x80) !== 0;
  const v = ((val1 ^ val2) & (val1 ^ result) & 0x80) !== 0;
  const s = n !== v;
  const c = borrow || val2 > val1;
  // Half-carry: matches avr8js contract (carry into bit 1, not bit 4).
  const h = (1 & ((~val1 & val2) | (val2 & result) | (result & ~val1))) !== 0 ? SREG_H : 0;
  let flags = sreg & 0xc0;
  if (z) flags |= SREG_Z;
  if (n) flags |= SREG_N;
  if (v) flags |= SREG_V;
  if (s) flags |= SREG_S;
  if (h) flags |= SREG_H;
  if (c) flags |= SREG_C;
  sreg = flags;
}

export function step(n: i32): i32 {
  let remaining = n;
  while (remaining > 0) {
    const w = readFlash(pc);
    if (w < 0) {
      return pc;
    }

    // =====================================================================
    // NOP: 0000 0000 0000 0000
    // =====================================================================
    if (w === 0x0000) {
      pc += 1;
      cycles += 1;
      remaining -= 1;
      continue;
    }

    // =====================================================================
    // RJMP: 1100 kkkk kkkk kkkk  (2 cycles)
    // =====================================================================
    if ((w & 0xf000) === 0xc000) {
      if (remaining < 2) return -1;
      let k = w & 0x0fff;
      if ((k & 0x0800) !== 0) k -= 0x1000;
      pc += k + 1;
      cycles += 2;
      remaining -= 2;
      continue;
    }

    // =====================================================================
    // RCALL: 1101 kkkk kkkk kkkk  (3 cycles)
    // =====================================================================
    if ((w & 0xf000) === 0xd000) {
      if (remaining < 3) return -1;
      let k = w & 0x0fff;
      if ((k & 0x0800) !== 0) k -= 0x1000;
      const retAddr = pc + 1;
      sp -= 1;
      store<u8>(sp, (retAddr >> 8) & 0xff);
      sp -= 1;
      store<u8>(sp, retAddr & 0xff);
      pc += k + 1;
      cycles += 3;
      remaining -= 3;
      continue;
    }

    // =====================================================================
    // RET: 1001 0101 0000 1000  (4 cycles)
    // =====================================================================
    if (w === 0x9508) {
      if (remaining < 4) return -1;
      pc = (load<u8>(sp + 1) << 8) | load<u8>(sp);
      sp += 2;
      cycles += 4;
      remaining -= 4;
      continue;
    }

    // =====================================================================
    // RETI: 1001 0101 0001 1000  (4 cycles)
    // =====================================================================
    if (w === 0x9518) {
      if (remaining < 4) return -1;
      pc = (load<u8>(sp + 1) << 8) | load<u8>(sp);
      sp += 2;
      cycles += 4;
      remaining -= 4;
      sreg |= SREG_I;
      continue;
    }

    // =====================================================================
    // LDI: 1110 KKKK dddd KKKK  (1 cycle)
    // =====================================================================
    if ((w & 0xf000) === 0xe000) {
      const rd = 16 + ((w >> 4) & 0x0f);
      const k = ((w >> 8) & 0x0f) * 16 + (w & 0x0f);
      writeReg(rd, k);
      pc += 1;
      cycles += 1;
      remaining -= 1;
      continue;
    }

    // =====================================================================
    // MOV: 0010 11rd dddd rrrr  (1 cycle)
    // =====================================================================
    if ((w & 0xfc00) === 0x2c00) {
      const rd = decodeRd(w);
      const rr = decodeRr(w);
      writeReg(rd, readReg(rr));
      pc += 1;
      cycles += 1;
      remaining -= 1;
      continue;
    }

    // =====================================================================
    // ADD: 0000 11rd dddd rrrr  (1 cycle)
    // =====================================================================
    if ((w & 0xfc00) === 0x0c00) {
      const rd = decodeRd(w);
      const rr = decodeRr(w);
      const packed = alu_add(readReg(rd), readReg(rr), 0);
      writeReg(rd, packed & 0xff);
      setFlagsFromAlu(packed);
      pc += 1;
      cycles += 1;
      remaining -= 1;
      continue;
    }

    // =====================================================================
    // ADC: 0001 11rd dddd rrrr  (1 cycle)
    // =====================================================================
    if ((w & 0xfc00) === 0x1c00) {
      const rd = decodeRd(w);
      const rr = decodeRr(w);
      const carry = (sreg & SREG_C) !== 0 ? 1 : 0;
      const packed = alu_add(readReg(rd), readReg(rr), carry);
      writeReg(rd, packed & 0xff);
      setFlagsFromAlu(packed);
      pc += 1;
      cycles += 1;
      remaining -= 1;
      continue;
    }

    // =====================================================================
    // SUB: 0001 10rd dddd rrrr  (1 cycle)
    // =====================================================================
    if ((w & 0xfc00) === 0x1800) {
      const rd = decodeRd(w);
      const rr = decodeRr(w);
      const packed = alu_sub(readReg(rd), readReg(rr), 0);
      writeReg(rd, packed & 0xff);
      setFlagsFromAlu(packed);
      pc += 1;
      cycles += 1;
      remaining -= 1;
      continue;
    }

    // =====================================================================
    // SBC: 0000 10rd dddd rrrr  (1 cycle)
    // =====================================================================
    if ((w & 0xfc00) === 0x0400) {
      const rd = decodeRd(w);
      const rr = decodeRr(w);
      const carry = (sreg & SREG_C) !== 0 ? 1 : 0;
      const packed = alu_sub(readReg(rd), readReg(rr), carry);
      writeReg(rd, packed & 0xff);
      setFlagsFromAlu(packed);
      pc += 1;
      cycles += 1;
      remaining -= 1;
      continue;
    }

    // =====================================================================
    // AND: 0010 00rd dddd rrrr  (1 cycle)
    // =====================================================================
    if ((w & 0xfc00) === 0x2000) {
      const rd = decodeRd(w);
      const rr = decodeRr(w);
      const result = readReg(rd) & readReg(rr);
      writeReg(rd, result);
      setSimpleFlags(result);
      pc += 1;
      cycles += 1;
      remaining -= 1;
      continue;
    }

    // =====================================================================
    // OR: 0010 01rd dddd rrrr  (1 cycle)
    // =====================================================================
    if ((w & 0xfc00) === 0x2800) {
      const rd = decodeRd(w);
      const rr = decodeRr(w);
      const result = readReg(rd) | readReg(rr);
      writeReg(rd, result);
      setSimpleFlags(result);
      pc += 1;
      cycles += 1;
      remaining -= 1;
      continue;
    }

    // =====================================================================
    // EOR: 0010 01rd dddd rrrr  (1 cycle)
    // =====================================================================
    if ((w & 0xfc00) === 0x2400) {
      const rd = decodeRd(w);
      const rr = decodeRr(w);
      const result = readReg(rd) ^ readReg(rr);
      writeReg(rd, result);
      setSimpleFlags(result);
      pc += 1;
      cycles += 1;
      remaining -= 1;
      continue;
    }

    // =====================================================================
    // ASR: 1001 010d dddd 0101  (1 cycle)
    // =====================================================================
    if ((w & 0xfe0f) === 0x9405) {
      const rd = ((w >> 4) & 0x0f) | (((w >> 8) & 1) << 4);
      const value = readReg(rd);
      const result = (value >>> 1) | (value & 0x80);
      writeReg(rd, result);
      const z = result === 0;
      const n = (result & 0x80) !== 0;
      const c = (value & 1) !== 0;
      const v = n !== ((sreg & SREG_C) !== 0);
      const s = n !== v;
      let flags = sreg & 0xc0;
      if (z) flags |= SREG_Z;
      if (n) flags |= SREG_N;
      if (v) flags |= SREG_V;
      if (s) flags |= SREG_S;
      if (c) flags |= SREG_C;
      sreg = flags;
      pc += 1;
      cycles += 1;
      remaining -= 1;
      continue;
    }

    // =====================================================================
    // LSR: 1001 010d dddd 0110  (1 cycle)
    // =====================================================================
    if ((w & 0xfe0f) === 0x9406) {
      const rd = ((w >> 4) & 0x0f) | (((w >> 8) & 1) << 4);
      const value = readReg(rd);
      const result = value >>> 1;
      writeReg(rd, result);
      const z = result === 0;
      const n = (result & 0x80) !== 0;
      const c = (value & 1) !== 0;
      const v = n !== ((sreg & SREG_C) !== 0);
      const s = n !== v;
      let flags = sreg & 0xc0;
      if (z) flags |= SREG_Z;
      if (n) flags |= SREG_N;
      if (v) flags |= SREG_V;
      if (s) flags |= SREG_S;
      if (c) flags |= SREG_C;
      sreg = flags;
      pc += 1;
      cycles += 1;
      remaining -= 1;
      continue;
    }

    // =====================================================================
    // ROR: 1001 010d dddd 0111  (1 cycle)
    // =====================================================================
    if ((w & 0xfe0f) === 0x9407) {
      const rd = ((w >> 4) & 0x0f) | (((w >> 8) & 1) << 4);
      const value = readReg(rd);
      const cIn = (sreg & SREG_C) !== 0 ? 1 : 0;
      const result = ((value >>> 1) | (cIn << 7)) & 0xff;
      writeReg(rd, result);
      const z = result === 0;
      const n = (result & 0x80) !== 0;
      const cOut = (value & 1) !== 0;
      const v = n !== ((sreg & SREG_C) !== 0);
      const s = n !== v;
      let flags = sreg & 0xc0;
      if (z) flags |= SREG_Z;
      if (n) flags |= SREG_N;
      if (v) flags |= SREG_V;
      if (s) flags |= SREG_S;
      if (cOut) flags |= SREG_C;
      sreg = flags;
      pc += 1;
      cycles += 1;
      remaining -= 1;
      continue;
    }

    // =====================================================================
    // COM: 1001 010d dddd 0000  (1 cycle)
    // =====================================================================
    if ((w & 0xfe0f) === 0x9400) {
      const rd = ((w >> 4) & 0x0f) | (((w >> 8) & 1) << 4);
      const result = 255 - readReg(rd);
      writeReg(rd, result);
      const z = result === 0;
      const n = (result & 0x80) !== 0;
      const s = n;
      let flags = sreg & 0xc0;
      if (z) flags |= SREG_Z;
      if (n) flags |= SREG_N;
      if (s) flags |= SREG_S;
      flags |= SREG_C; // COM always sets C
      sreg = flags;
      pc += 1;
      cycles += 1;
      remaining -= 1;
      continue;
    }

    // =====================================================================
    // NEG: 1001 010d dddd 0001  (1 cycle)
    // =====================================================================
    if ((w & 0xfe0f) === 0x9401) {
      const rd = ((w >> 4) & 0x0f) | (((w >> 8) & 1) << 4);
      const value = readReg(rd);
      const result = (256 - value) & 0xff;
      writeReg(rd, result);
      const z = result === 0;
      const n = (result & 0x80) !== 0;
      const c = value !== 0;
      let flags = sreg & 0xc0;
      if (z) flags |= SREG_Z;
      if (n) flags |= SREG_N;
      if (c) flags |= SREG_C;
      sreg = flags;
      pc += 1;
      cycles += 1;
      remaining -= 1;
      continue;
    }

    // =====================================================================
    // SWAP: 1001 010d dddd 0010  (1 cycle)
    // =====================================================================
    if ((w & 0xfe0f) === 0x9402) {
      const rd = ((w >> 4) & 0x0f) | (((w >> 8) & 1) << 4);
      const value = readReg(rd);
      const result = ((value << 4) | (value >> 4)) & 0xff;
      writeReg(rd, result);
      pc += 1;
      cycles += 1;
      remaining -= 1;
      continue;
    }

    // =====================================================================
    // INC: 1001 010d dddd 0011  (1 cycle)
    // =====================================================================
    if ((w & 0xfe0f) === 0x9403) {
      const rd = ((w >> 4) & 0x0f) | (((w >> 8) & 1) << 4);
      const value = readReg(rd);
      const result = (value + 1) & 0xff;
      writeReg(rd, result);
      const z = result === 0;
      const n = (result & 0x80) !== 0;
      const v = value === 0x7f;
      const s = n !== v;
      let flags = sreg & 0xc0;
      if (z) flags |= SREG_Z;
      if (n) flags |= SREG_N;
      if (v) flags |= SREG_V;
      if (s) flags |= SREG_S;
      sreg = flags;
      pc += 1;
      cycles += 1;
      remaining -= 1;
      continue;
    }

    // =====================================================================
    // DEC: 1001 010d dddd 1010  (1 cycle)
    // =====================================================================
    if ((w & 0xfe0f) === 0x940a) {
      const rd = ((w >> 4) & 0x0f) | (((w >> 8) & 1) << 4);
      const value = readReg(rd);
      const result = (value - 1) & 0xff;
      writeReg(rd, result);
      const z = result === 0;
      const n = (result & 0x80) !== 0;
      const v = value === 0x80;
      const s = n !== v;
      let flags = sreg & 0xc0;
      if (z) flags |= SREG_Z;
      if (n) flags |= SREG_N;
      if (v) flags |= SREG_V;
      if (s) flags |= SREG_S;
      sreg = flags;
      pc += 1;
      cycles += 1;
      remaining -= 1;
      continue;
    }

    // =====================================================================
    // CP: 0001 01rd dddd rrrr  (1 cycle)
    // =====================================================================
    if ((w & 0xfc00) === 0x1400) {
      const rd = decodeRd(w);
      const rr = decodeRr(w);
      const val1 = readReg(rd);
      const val2 = readReg(rr);
      const result = val1 - val2;
      setSubFlags(result, val1, val2, false);
      pc += 1;
      cycles += 1;
      remaining -= 1;
      continue;
    }

    // =====================================================================
    // CPC: 0000 01rd dddd rrrr  (1 cycle)
    // =====================================================================
    if ((w & 0xfc00) === 0x0800) {
      const rd = decodeRd(w);
      const rr = decodeRr(w);
      const val1 = readReg(rd);
      const val2 = readReg(rr);
      const borrow = (sreg & SREG_C) !== 0 ? 1 : 0;
      const result = val1 - val2 - borrow;
      setSubFlags(result, val1, val2, borrow !== 0);
      pc += 1;
      cycles += 1;
      remaining -= 1;
      continue;
    }

    // =====================================================================
    // CPSE: 0001 00rd dddd rrrr  (1-3 cycles)
    // =====================================================================
    if ((w & 0xfc00) === 0x1000) {
      const rd = decodeRd(w);
      const rr = decodeRr(w);
      if (readReg(rd) === readReg(rr)) {
        pc += 1;
        cycles += 1;
        remaining -= 1;
        const nextW = readFlash(pc);
        if (nextW >= 0 && ((nextW & 0xfe0e) === 0x940e || (nextW & 0xfe0e) === 0x940c)) {
          pc += 1;
          cycles += 1;
          remaining -= 1;
        }
      } else {
        pc += 1;
        cycles += 1;
        remaining -= 1;
      }
      continue;
    }

    // =====================================================================
    // Branch: 1111 0kkk kkkk ksss (BRBC) / 1111 00kk kkkk ksss (BRBS)
    // =====================================================================
    if ((w & 0xfc00) === 0xf400 || (w & 0xfc00) === 0xf000) {
      if (remaining < 1) return -1;
      const s = w & 7;
      const offset = ((w & 0x1f8) >> 3) - ((w & 0x200) !== 0 ? 0x40 : 0);
      const taken = (w & 0xfc00) === 0xf400
        ? (sreg & (1 << s)) === 0  // BRBC: branch if bit clear
        : (sreg & (1 << s)) !== 0; // BRBS: branch if bit set
      if (taken) {
        pc += offset + 1;
        cycles += 2;
        remaining -= 2;
      } else {
        pc += 1;
        cycles += 1;
        remaining -= 1;
      }
      continue;
    }

    // =====================================================================
    // BSET: 1001 0100 0sss 1000  (1 cycle)
    // =====================================================================
    if ((w & 0xff8f) === 0x9408) {
      const s = (w >> 4) & 7;
      sreg |= (1 << s);
      pc += 1;
      cycles += 1;
      remaining -= 1;
      continue;
    }

    // =====================================================================
    // BCLR: 1001 0100 1sss 1000  (1 cycle)
    // =====================================================================
    if ((w & 0xff8f) === 0x9488) {
      const s = (w >> 4) & 7;
      sreg &= ~(1 << s);
      pc += 1;
      cycles += 1;
      remaining -= 1;
      continue;
    }

    // =====================================================================
    // CPI: 0011 KKKK dddd KKKK  (1 cycle)
    // =====================================================================
    if ((w & 0xf000) === 0x3000) {
      const rd = 16 + ((w >> 4) & 0x0f);
      const k = (w & 0x0f) | ((w >> 4) & 0xf0);
      const val1 = readReg(rd);
      const result = val1 - k;
      setSubFlags(result, val1, k, false);
      pc += 1;
      cycles += 1;
      remaining -= 1;
      continue;
    }

    // =====================================================================
    // SUBI: 0101 KKKK dddd KKKK  (1 cycle)
    // =====================================================================
    if ((w & 0xf000) === 0x5000) {
      const rd = 16 + ((w >> 4) & 0x0f);
      const k = (w & 0x0f) | ((w >> 4) & 0xf0);
      const val1 = readReg(rd);
      const result = val1 - k;
      setSubFlags(result, val1, k, false);
      writeReg(rd, result & 0xff);
      pc += 1;
      cycles += 1;
      remaining -= 1;
      continue;
    }

    // =====================================================================
    // SBCI: 0100 KKKK dddd KKKK  (1 cycle)
    // =====================================================================
    if ((w & 0xf000) === 0x4000) {
      const rd = 16 + ((w >> 4) & 0x0f);
      const k = (w & 0x0f) | ((w >> 4) & 0xf0);
      const val1 = readReg(rd);
      const borrow = (sreg & SREG_C) !== 0 ? 1 : 0;
      const result = val1 - k - borrow;
      setSubFlags(result, val1, k, borrow !== 0);
      writeReg(rd, result & 0xff);
      pc += 1;
      cycles += 1;
      remaining -= 1;
      continue;
    }

    // =====================================================================
    // ANDI: 0111 KKKK dddd KKKK  (1 cycle)
    // =====================================================================
    if ((w & 0xf000) === 0x7000) {
      const rd = 16 + ((w >> 4) & 0x0f);
      const k = (w & 0x0f) | ((w >> 4) & 0xf0);
      const result = readReg(rd) & k;
      writeReg(rd, result);
      setSimpleFlags(result);
      pc += 1;
      cycles += 1;
      remaining -= 1;
      continue;
    }

    // =====================================================================
    // ORI: 0110 KKKK dddd KKKK  (1 cycle)
    // =====================================================================
    if ((w & 0xf000) === 0x6000) {
      const rd = 16 + ((w >> 4) & 0x0f);
      const k = (w & 0x0f) | ((w >> 4) & 0xf0);
      const result = readReg(rd) | k;
      writeReg(rd, result);
      setSimpleFlags(result);
      pc += 1;
      cycles += 1;
      remaining -= 1;
      continue;
    }

    // =====================================================================
    // Everything else: trap to JS (I/O, SRAM, stack, complex instructions)
    // =====================================================================
    return pc;
  }
  return -1;
}
