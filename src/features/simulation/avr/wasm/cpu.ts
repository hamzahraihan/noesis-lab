// Task 1 real wiring: register file, PC, and cycle counter with a 3-op
// step loop (NOP/RJMP/LDI). Everything else traps by returning the pc.
//
// Flash + registers live in reserved low linear memory (flash bytes
// [0, 1024), regs bytes [1024, 1056)) — never under AS-managed addresses:
// the build passes `--memoryBase 2048` so emitted static segments and the
// heap start above our regions. `flash_base()` returns the flash byte
// pointer the host writes words through. A managed `Uint16Array` was
// rejected: any `new` pulls the AS runtime's `env.abort` import into the
// module, breaking `{}` instantiation; raw load/store keeps zero imports.
// SREG is an i32 global masked to 8 bits on write (I=7..C=0).
import { alu_add } from './ops-alu';
const FLASH_BASE: i32 = 0;
const FLASH_WORDS: i32 = 512;
const REGS_BASE: i32 = 1024;

let pc: i32 = 0;
let cycles: i32 = 0;
let sreg: i32 = 0;

export function flash_base(): i32 {
  return FLASH_BASE;
}

export function reset_cpu(): void {
  for (let i = 0; i < 32; i++) store<u8>(REGS_BASE + i, 0);
  pc = 0;
  cycles = 0;
  sreg = 0;
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

function readFlash(addr: i32): i32 {
  if (addr < 0 || addr >= FLASH_WORDS) return -1;
  return load<u16>(FLASH_BASE + addr * 2) as i32;
}

export function step(n: i32): i32 {
  // Trap ABI (single-PC): a trap surfaces as the returned PC — out-of-bounds
  // fetch and unported opcodes share this channel. A future `trapKind`
  // getter will distinguish them; `-1` always means "no trap this call".
  let remaining = n;
  while (remaining > 0) {
    const w = readFlash(pc);
    if (w < 0) {
      return pc;
    } else if (w === 0x0000) {
      pc += 1;
      cycles += 1;
      remaining -= 1;
    } else if ((w & 0xf000) === 0xc000) {
      // Overshoot guard: RJMP costs 2 cycles — with fewer than 2 remaining,
      // return -1 WITHOUT advancing pc/cycles (no partial execution).
      if (remaining < 2) return -1;
      let k = w & 0x0fff;
      if ((k & 0x0800) !== 0) k -= 0x1000;
      pc = pc + 1 + k;
      cycles += 2;
      remaining -= 2;
    } else if ((w & 0xf000) === 0xe000) {
      const rd = 16 + ((w >> 4) & 0x0f);
      const k = ((w >> 8) & 0x0f) * 16 + (w & 0x0f);
      store<u8>(REGS_BASE + rd, k as u8);
      pc += 1;
      cycles += 1;
      remaining -= 1;
    } else if ((w & 0xfc00) === 0x0c00) {
      // ADD Rd,Rr: only flag writer ported so far (carryIn is always 0 —
      // no flag reading yet, so the attached driver's side-effect-free
      // prefix invariant holds). I/T bits survive; HSVNZC are replaced.
      const rd = (((w >> 8) & 1) << 4) | ((w >> 4) & 0x0f);
      const rr = (((w >> 9) & 1) << 4) | (w & 0x0f);
      const packed = alu_add(load<u8>(REGS_BASE + rd) as i32, load<u8>(REGS_BASE + rr) as i32, 0);
      store<u8>(REGS_BASE + rd, (packed & 0xff) as u8);
      sreg = (sreg & 0xc0) | ((packed >> 8) & 0x3f);
      pc += 1;
      cycles += 1;
      remaining -= 1;
    } else {
      return pc;
    }
  }
  return -1;
}
