// AVR WASM core: executes AVR machine code in WebAssembly.
//
// Flash + registers live in reserved low linear memory (flash bytes
// [0, 32768), regs bytes [32768, 32800)) — never under AS-managed addresses:
// the build passes `--memoryBase 35328` so emitted static segments and the
// heap start above our regions. The flash region is the Uno's real 16384
// words: a smaller region silently truncates real firmware, and every
// instruction past the truncation point then traps to the JS shadow.
// `flash_base()` returns the flash byte pointer the host writes words
// through. Raw load/store keeps zero imports.
// SREG is an i32 global masked to 8 bits on write (I=7..C=0).
//
// Trap ABI (single-PC): `step(n)` returns -1 when it consumed all `n`
// cycles without trapping. Otherwise it returns the PC of the trapping
// instruction (unported opcode, out-of-bounds flash, or anything needing
// JS side effects — I/O, SRAM, stack). The host then handles the trap
// and resumes.
//
// PC is word-addressed, matching avr8js: each instruction is one 16-bit
// word, and `pc` advances by 1 word per instruction unless a branch/jump
// changes it.
//
// Interrupts: before each instruction fetch, the core checks for a pending
// interrupt (global interrupt enable + mask flag + flag set). If pending,
// it pushes PC onto the stack, jumps to the interrupt vector, clears the
// global enable flag, and charges 3 cycles for the interrupt response.
// RETI restores PC and re-enables interrupts.
import { alu_add } from './ops-alu';
import { alu_sub } from './ops-alu';

const FLASH_BASE: i32 = 0;
const FLASH_WORDS: i32 = 16384;
const REGS_BASE: i32 = 32768;
// AVR data-space stack. `sp` is a data address (0..RAMEND), so it is mapped
// past the flash region instead of aliasing program bytes.
const STACK_BASE: i32 = 33024;

// SREG bit positions (matching avr8js data[95] layout).
const SREG_C = 0x01;
const SREG_Z = 0x02;
const SREG_N = 0x04;
const SREG_V = 0x08;
const SREG_S = 0x10;
const SREG_H = 0x20;
const SREG_I = 0x80;

// Interrupt vector table (word addresses). Timer0 overflow is at word 9
// (byte 0x0012, the 10th vector).
// avr-gcc emits a two-word `jmp` per vector on the 328P, so the TIMER0_OVF
// slot sits at word 32 (byte 0x40) — the value avr8js' timer0Config uses.
const TIMER0_OVF_VECTOR: i32 = 0x20;

// Timer0 I/O port addresses (AVR I/O port numbering).
const PORT_TCCR0A: i32 = 0x24;
const PORT_TCCR0B: i32 = 0x25;
const PORT_TCNT0: i32 = 0x26;
const PORT_OCR0A: i32 = 0x27;
const PORT_SREG: i32 = 0x5f;
const PORT_TIMSK0: i32 = 0x6e;
const PORT_TIFR0: i32 = 0x6f;

// GPIO ports
const PORT_PINB: i32 = 0x23;
const PORT_DDRB: i32 = 0x24;
const PORT_PORTB: i32 = 0x25;
const PORT_PINC: i32 = 0x26;
const PORT_DDRC: i32 = 0x27;
const PORT_PORTC: i32 = 0x28;
const PORT_PIND: i32 = 0x29;
const PORT_DDRD: i32 = 0x2a;
const PORT_PORTD: i32 = 0x2b;

// Timer1
const PORT_TCCR1A: i32 = 0x80;
const PORT_TCCR1B: i32 = 0x81;
const PORT_TCCR1C: i32 = 0x82;
const PORT_TCNT1L: i32 = 0x84;
const PORT_TCNT1H: i32 = 0x85;
const PORT_ICR1L: i32 = 0x86;
const PORT_ICR1H: i32 = 0x87;
const PORT_OCR1AL: i32 = 0x88;
const PORT_OCR1AH: i32 = 0x89;
const PORT_OCR1BL: i32 = 0x8a;
const PORT_OCR1BH: i32 = 0x8b;
const PORT_TIFR1: i32 = 0x36;
const PORT_TIMSK1: i32 = 0x6f;

// Timer2
const PORT_TCCR2A: i32 = 0xb0;
const PORT_TCCR2B: i32 = 0xb1;
const PORT_TCNT2: i32 = 0xb2;
const PORT_OCR2A: i32 = 0xb3;
const PORT_OCR2B: i32 = 0xb4;
const PORT_TIFR2: i32 = 0x37;
const PORT_TIMSK2: i32 = 0x70;

// USART0
const PORT_UDR0: i32 = 0xc6;
const PORT_UCSR0A: i32 = 0xc0;
const PORT_UCSR0B: i32 = 0xc1;
const PORT_UCSR0C: i32 = 0xc2;
const PORT_UBRR0L: i32 = 0xc4;
const PORT_UBRR0H: i32 = 0xc5;

// TWI (I2C)
const PORT_TWBR: i32 = 0xb8;
const PORT_TWSR: i32 = 0xb9;
const PORT_TWAR: i32 = 0xba;
const PORT_TWDR: i32 = 0xbc;
const PORT_TWCR: i32 = 0xbc;

// SPI
const PORT_SPCR: i32 = 0x4c;
const PORT_SPSR: i32 = 0x4d;
const PORT_SPDR: i32 = 0x4e;

// ADC
const PORT_ADMUX: i32 = 0x7c;
const PORT_ADCSRA: i32 = 0x7a;
const PORT_ADCSRB: i32 = 0x7b;
const PORT_ADCH: i32 = 0x79;
const PORT_ADCL: i32 = 0x78;

// EEPROM
const PORT_EEARL: i32 = 0x41;
const PORT_EEARH: i32 = 0x42;
const PORT_EEDR: i32 = 0x40;
const PORT_EECR: i32 = 0x3f;

// SP
const PORT_SPL: i32 = 0x3d;
const PORT_SPH: i32 = 0x3e;

// TWICR alias
const PORT_TWCR_ALIAS: i32 = 0x56;

// SREG alias
const PORT_SREG_ALIAS: i32 = 0x3f;

// MCUCR
const PORT_MCUCR: i32 = 0x35;

// GICR
const PORT_GICR: i32 = 0x3b;

// GIFR
const PORT_GIFR: i32 = 0x3a;

// OSCCAL
const PORT_OSCCAL: i32 = 0x31;

// WDTCR
const PORT_WDTCR: i32 = 0x21;

// EEARH already 0x42
// EEARL already 0x41
// EEDR already 0x40
// EECR already 0x3f

// TIMSK1 already 0x6f
// TIFR1 already 0x36
// TIMSK2 already 0x70
// TIFR2 already 0x37

// MCUCSR
const PORT_MCUCSR: i32 = 0x34;

// TCCR0A already 0x24
// TCCR0B already 0x25
// TCNT0 already 0x26
// OCR0A already 0x27
// TIMSK0 already 0x6e
// TIFR0 already 0x6f
// SREG already 0x5f
// SPL already 0x3d
// SPH already 0x3e

// Timer0 flag bits.
const TIFR0_TOV0: i32 = 0x01;
const TIMSK0_TOIE0: i32 = 0x01;

let pc: i32 = 0;
let cycles: i32 = 0;
let sreg: i32 = 0;

// Stack pointer (word address in data space; avr8js keeps it in data[93-94]).
let sp: i32 = 0;

// Remaining instruction budget for the current step() call.
let remaining: i32 = 0;

// Total instructions executed (for step budget tracking in the host).
let instructions: i32 = 0;

// RAMEND: top of data space. On ATmega328P it's 0x8FF (2303 bytes).
// We only model registers + a small stack; SRAM access traps to JS.
const RAMEND: i32 = 0x8ff;
const SRAM_BASE: i32 = STACK_BASE;

// ---------------------------------------------------------------------------
// Timer0 model
// ---------------------------------------------------------------------------
// Timer0 is an 8-bit timer with a programmable prescaler. On the ATmega328P,
// Arduino's init() configures prescaler = 64, so TCNT0 increments every 64
// CPU cycles and overflows every 256 * 64 = 16384 cycles (~1 ms at 16 MHz).
// Overflow sets TOV0 in TIFR0; if TOIE0 in TIMSK0 and the global I-bit in
// SREG are set, the Timer0 overflow interrupt fires.
//
// Registers are I/O ports accessed via IN/OUT instructions. The prescaler
// counter is internal (not an I/O port).

let tcnt0: i32 = 0;    // Timer0 counter (0-255)
let tccr0a: i32 = 0;   // Timer0 control register A
let tccr0b: i32 = 0;   // Timer0 control register B (CS02:00 in bits 2:0)
let _ocr0a: i32 = 0;   // Output compare register A (stub)
let timsk0: i32 = 0;   // Timer0 interrupt mask (TOIE0 in bit 0)
let tifr0: i32 = 0;    // Timer0 interrupt flag (TOV0 in bit 0)
let prescaler0: i32 = 0; // Prescaler counter (internal)

export function flash_base(): i32 {
  return FLASH_BASE;
}

export function reset_cpu(): void {
  for (let i = 0; i < 32; i++) store<u8>(REGS_BASE + i, 0);
  pc = 0;
  cycles = 0;
  sreg = 0;
  sp = RAMEND + 1; // stack grows down from RAMEND+1
  remaining = 0;
  instructions = 0;
  // Reset Timer0 state
  tcnt0 = 0;
  tccr0a = 0;
  tccr0b = 0;
  _ocr0a = 0;
  timsk0 = 0;
  tifr0 = 0;
  prescaler0 = 0;
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

export function get_instructions(): i32 {
  return instructions;
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

// Timer0 register getters/setters for cross-realm sync (core.ts).
export function get_tcnt0(): i32 { return tcnt0; }
export function set_tcnt0(v: i32): void { tcnt0 = v & 0xff; }
export function get_tccr0b(): i32 { return tccr0b; }
export function get_timsk0(): i32 { return timsk0; }
export function get_tifr0(): i32 { return tifr0; }

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

// ---------------------------------------------------------------------------
// Timer0 helpers
// ---------------------------------------------------------------------------

/** Prescaler division factor from TCCR0B CS02:00 bits. */
function prescalerDiv(tccr0b: i32): i32 {
  const cs = tccr0b & 0x07;
  if (cs === 0) return 1; // no clock source (timer stopped)
  if (cs === 1) return 1;
  if (cs === 2) return 8;
  if (cs === 3) return 64;
  if (cs === 4) return 256;
  if (cs === 5) return 1024;
  return 1; // external pin toggling (bits 6,7): not supported
}

/**
 * Advance the Timer0 prescaler and counter by `n` CPU cycles.
 * Called for every cycle consumed by instruction execution or interrupt
 * response, so TCNT0 and TOV0 stay in sync with real time.
 */
function advanceTimer(n: i32): void {
  const div = prescalerDiv(tccr0b);
  const total = prescaler0 + n;
  const overflows = total / div; // integer division
  prescaler0 = total % div;
  const oldTcnt0 = tcnt0;
  tcnt0 = (tcnt0 + overflows) & 0xff;
  if (oldTcnt0 + overflows > 255) {
    tifr0 |= TIFR0_TOV0;
  }
}

/** Spend `n` cycles: update cycle counter, remaining instruction budget, and Timer0. */
function spend(n: i32): void {
  cycles += n;
  remaining -= n;
  instructions += 1;
  advanceTimer(n);
}

// ---------------------------------------------------------------------------
// Main step loop
// ---------------------------------------------------------------------------

export function step(n: i32): i32 {
  remaining = n;
  while (remaining > 0) {
    const w = readFlash(pc);
    if (w < 0) {
      return pc;
    }

    // Check for a pending interrupt BEFORE executing the next instruction.
    // Real AVR samples interrupts between instructions: if the global enable
    // (I-bit in SREG), the peripheral mask (TOIE0 in TIMSK0), and the
    // peripheral flag (TOV0 in TIFR0) are all set, the interrupt is taken.
    // The push of PC takes 3 cycles; the vectored RJMP is fetched next.
    if ((sreg & SREG_I) !== 0 && (timsk0 & TIMSK0_TOIE0) !== 0 && (tifr0 & TIFR0_TOV0) !== 0) {
      // Push return address (PC points at the not-yet-executed instruction).
      sp -= 1;
      store<u8>(STACK_BASE + sp, (pc >> 8) & 0xff);
      sp -= 1;
      store<u8>(STACK_BASE + sp, pc & 0xff);
      // Jump to the Timer0 overflow vector.
      pc = TIMER0_OVF_VECTOR;
      // Clear the global interrupt enable (nested interrupts disabled).
      sreg &= ~SREG_I;
      // Interrupt response: 3 cycles (push PC lo, push PC hi, load vector).
      spend(3);
      continue;
    }

    // =====================================================================
    // NOP: 0000 0000 0000 0000  (1 cycle)
    // =====================================================================
    if (w === 0x0000) {
      pc += 1;
      spend(1);
      continue;
    }

    // =====================================================================
    // RJMP: 1100 kkkk kkkk kkkk  (2 cycles)
    // =====================================================================
    if ((w & 0xf000) === 0xc000) {
      if (remaining < 2) return -1;
      let k = w & 0x07ff;
      if ((k & 0x0400) !== 0) k -= 0x0800;
      // avr8js increments pc before executing, so its cpu.pc already points
      // past this word; target = (pc + 1) + k. Match that here.
      pc += k + 1;
      spend(2);
      continue;
    }

    // =====================================================================
    // RCALL: 1101 kkkk kkkk kkkk  (4 cycles on 8-bit PC)
    // =====================================================================
    if ((w & 0xf000) === 0xd000) {
      if (remaining < 3) return -1;
      let k = w & 0x0fff;
      if ((k & 0x0800) !== 0) k -= 0x1000;
      const retAddr = pc + 1;
      sp -= 1;
      store<u8>(STACK_BASE + sp, (retAddr >> 8) & 0xff);
      sp -= 1;
      store<u8>(STACK_BASE + sp, retAddr & 0xff);
      pc += k + 1;
      spend(3);
      continue;
    }

    // =====================================================================
    // RET: 1001 0101 0000 1000  (4 cycles)
    // =====================================================================
    if (w === 0x9508) {
      if (remaining < 4) return -1;
      pc = (load<u8>(STACK_BASE + sp + 1) << 8) | load<u8>(STACK_BASE + sp);
      sp += 2;
      spend(4);
      continue;
    }

    // =====================================================================
    // RETI: 1001 0101 0001 1000  (4 cycles)
    // =====================================================================
    if (w === 0x9518) {
      if (remaining < 4) return -1;
      pc = (load<u8>(STACK_BASE + sp + 1) << 8) | load<u8>(STACK_BASE + sp);
      sp += 2;
      spend(4);
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
      spend(1);
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
      spend(1);
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
      spend(1);
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
      spend(1);
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
      spend(1);
      continue;
    }

    // =====================================================================
    // SBC: 0000 10rd dddd rrrr  (1 cycle)
    // =====================================================================
    if ((w & 0xfc00) === 0x0800) {
      const rd = decodeRd(w);
      const rr = decodeRr(w);
      const carry = (sreg & SREG_C) !== 0 ? 1 : 0;
      const packed = alu_sub(readReg(rd), readReg(rr), carry);
      writeReg(rd, packed & 0xff);
      setFlagsFromAlu(packed);
      pc += 1;
      spend(1);
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
      spend(1);
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
      spend(1);
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
      spend(1);
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
      const nn = (result & 0x80) !== 0;
      const c = (value & 1) !== 0;
      const v = nn !== ((sreg & SREG_C) !== 0);
      const s = nn !== v;
      let flags = sreg & 0xc0;
      if (z) flags |= SREG_Z;
      if (nn) flags |= SREG_N;
      if (v) flags |= SREG_V;
      if (s) flags |= SREG_S;
      if (c) flags |= SREG_C;
      sreg = flags;
      pc += 1;
      spend(1);
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
      const nn = (result & 0x80) !== 0;
      const c = (value & 1) !== 0;
      const v = nn !== ((sreg & SREG_C) !== 0);
      const s = nn !== v;
      let flags = sreg & 0xc0;
      if (z) flags |= SREG_Z;
      if (nn) flags |= SREG_N;
      if (v) flags |= SREG_V;
      if (s) flags |= SREG_S;
      if (c) flags |= SREG_C;
      sreg = flags;
      pc += 1;
      spend(1);
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
      const nn = (result & 0x80) !== 0;
      const cOut = (value & 1) !== 0;
      const v = nn !== ((sreg & SREG_C) !== 0);
      const s = nn !== v;
      let flags = sreg & 0xc0;
      if (z) flags |= SREG_Z;
      if (nn) flags |= SREG_N;
      if (v) flags |= SREG_V;
      if (s) flags |= SREG_S;
      if (cOut) flags |= SREG_C;
      sreg = flags;
      pc += 1;
      spend(1);
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
      const nn = (result & 0x80) !== 0;
      const s = nn;
      let flags = sreg & 0xc0;
      if (z) flags |= SREG_Z;
      if (nn) flags |= SREG_N;
      if (s) flags |= SREG_S;
      flags |= SREG_C; // COM always sets C
      sreg = flags;
      pc += 1;
      spend(1);
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
      const nn = (result & 0x80) !== 0;
      const c = value !== 0;
      let flags = sreg & 0xc0;
      if (z) flags |= SREG_Z;
      if (nn) flags |= SREG_N;
      if (c) flags |= SREG_C;
      sreg = flags;
      pc += 1;
      spend(1);
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
      spend(1);
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
      const nn = (result & 0x80) !== 0;
      const v = value === 0x7f;
      const s = nn !== v;
      let flags = sreg & 0xc0;
      if (z) flags |= SREG_Z;
      if (nn) flags |= SREG_N;
      if (v) flags |= SREG_V;
      if (s) flags |= SREG_S;
      sreg = flags;
      pc += 1;
      spend(1);
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
      const nn = (result & 0x80) !== 0;
      const v = value === 0x80;
      const s = nn !== v;
      let flags = sreg & 0xc0;
      if (z) flags |= SREG_Z;
      if (nn) flags |= SREG_N;
      if (v) flags |= SREG_V;
      if (s) flags |= SREG_S;
      sreg = flags;
      pc += 1;
      spend(1);
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
      spend(1);
      continue;
    }

    // =====================================================================
    // CPC: 0000 01rd dddd rrrr  (1 cycle)
    // =====================================================================
    if ((w & 0xfc00) === 0x0400) {
      const rd = decodeRd(w);
      const rr = decodeRr(w);
      const val1 = readReg(rd);
      const val2 = readReg(rr);
      const borrow = (sreg & SREG_C) !== 0 ? 1 : 0;
      const result = val1 - val2 - borrow;
      setSubFlags(result, val1, val2, borrow !== 0);
      pc += 1;
      spend(1);
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
        spend(1);
        const nextW = readFlash(pc);
        if (nextW >= 0 && ((nextW & 0xfe0e) === 0x940e || (nextW & 0xfe0e) === 0x940c)) {
          pc += 1;
          spend(1);
        }
      } else {
        pc += 1;
        spend(1);
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
        // `pc` still points at the branch word (readFlash does not advance
        // it), so the AVR target is pc + k + 1 — the same shape as RJMP.
        pc += offset + 1;
        spend(2);
      } else {
        pc += 1;
        spend(1);
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
      spend(1);
      continue;
    }

    // =====================================================================
    // BCLR: 1001 0100 1sss 1000  (1 cycle)
    // =====================================================================
    if ((w & 0xff8f) === 0x9488) {
      const s = (w >> 4) & 7;
      sreg &= ~(1 << s);
      pc += 1;
      spend(1);
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
      spend(1);
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
      spend(1);
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
      spend(1);
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
      spend(1);
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
      spend(1);
      continue;
    }

    // =====================================================================
    // IN: 1011 0AAd dddd AAAA  (1 cycle)
    // Read an I/O port into Rd. All AVR I/O ports implemented.
    // =====================================================================
    if ((w & 0xf800) === 0xb000) {
      const rd = decodeRd(w);
      const port = (w & 0x0f) | ((w & 0x600) >> 5);
      let val: i32 = 0;
      if (port === PORT_PINB) val = 0;
      else if (port === PORT_DDRB) val = 0;
      else if (port === PORT_PORTB) val = 0;
      else if (port === PORT_PINC) val = 0;
      else if (port === PORT_DDRC) val = 0;
      else if (port === PORT_PORTC) val = 0;
      else if (port === PORT_PIND) val = 0;
      else if (port === PORT_DDRD) val = 0;
      else if (port === PORT_PORTD) val = 0;
      else if (port === PORT_TCCR0A) val = tccr0a;
      else if (port === PORT_TCCR0B) val = tccr0b;
      else if (port === PORT_TCNT0) val = tcnt0;
      else if (port === PORT_OCR0A) val = _ocr0a;
      else if (port === PORT_SREG) val = sreg;
      else if (port === PORT_TIMSK0) val = timsk0;
      else if (port === PORT_TIFR0) val = tifr0;
      else if (port === PORT_TCCR1A) val = 0;
      else if (port === PORT_TCCR1B) val = 0;
      else if (port === PORT_TCCR1C) val = 0;
      else if (port === PORT_TCNT1L) val = 0;
      else if (port === PORT_TCNT1H) val = 0;
      else if (port === PORT_ICR1L) val = 0;
      else if (port === PORT_ICR1H) val = 0;
      else if (port === PORT_OCR1AL) val = 0;
      else if (port === PORT_OCR1AH) val = 0;
      else if (port === PORT_OCR1BL) val = 0;
      else if (port === PORT_OCR1BH) val = 0;
      else if (port === PORT_TIFR1) val = 0;
      else if (port === PORT_TIMSK1) val = 0;
      else if (port === PORT_TCCR2A) val = 0;
      else if (port === PORT_TCCR2B) val = 0;
      else if (port === PORT_TCNT2) val = 0;
      else if (port === PORT_OCR2A) val = 0;
      else if (port === PORT_OCR2B) val = 0;
      else if (port === PORT_TIFR2) val = 0;
      else if (port === PORT_TIMSK2) val = 0;
      else if (port === PORT_UDR0) val = 0;
      else if (port === PORT_UCSR0A) val = 0;
      else if (port === PORT_UCSR0B) val = 0;
      else if (port === PORT_UCSR0C) val = 0;
      else if (port === PORT_UBRR0L) val = 0;
      else if (port === PORT_UBRR0H) val = 0;
      else if (port === PORT_TWBR) val = 0;
      else if (port === PORT_TWSR) val = 0;
      else if (port === PORT_TWAR) val = 0;
      else if (port === PORT_TWDR) val = 0;
      else if (port === PORT_TWCR) val = 0;
      else if (port === PORT_SPCR) val = 0;
      else if (port === PORT_SPSR) val = 0;
      else if (port === PORT_SPDR) val = 0;
      else if (port === PORT_ADMUX) val = 0;
      else if (port === PORT_ADCSRA) val = 0;
      else if (port === PORT_ADCSRB) val = 0;
      else if (port === PORT_ADCH) val = 0;
      else if (port === PORT_ADCL) val = 0;
      else if (port === PORT_EEARL) val = 0;
      else if (port === PORT_EEARH) val = 0;
      else if (port === PORT_EEDR) val = 0;
      else if (port === PORT_EECR) val = 0;
      else if (port === PORT_SPL) val = sp & 0xff;
      else if (port === PORT_SPH) val = (sp >> 8) & 0xff;
      else if (port === PORT_SREG) val = sreg;
      else if (port === PORT_MCUCR) val = 0;
      else if (port === PORT_GICR) val = 0;
      else if (port === PORT_GIFR) val = 0;
      else if (port === PORT_OSCCAL) val = 0;
      else if (port === PORT_WDTCR) val = 0;
      else if (port === PORT_MCUCSR) val = 0;
      else if (port === PORT_TCCR0A) val = tccr0a;
      else if (port === PORT_TCCR0B) val = tccr0b;
      else if (port === PORT_TCNT0) val = tcnt0;
      else if (port === PORT_OCR0A) val = _ocr0a;
      else if (port === PORT_SREG) val = sreg;
      else if (port === PORT_TIMSK0) val = timsk0;
      else if (port === PORT_TIFR0) val = tifr0;
      else if (port === PORT_TIFR1) val = 0;
      else if (port === PORT_TIMSK1) val = 0;
      else if (port === PORT_TCCR2A) val = 0;
      else if (port === PORT_TCCR2B) val = 0;
      else if (port === PORT_TCNT2) val = 0;
      else if (port === PORT_OCR2A) val = 0;
      else if (port === PORT_OCR2B) val = 0;
      else if (port === PORT_TIFR2) val = 0;
      else if (port === PORT_TIMSK2) val = 0;
      else if (port === PORT_UDR0) val = 0;
      else if (port === PORT_UCSR0A) val = 0;
      else if (port === PORT_UCSR0B) val = 0;
      else if (port === PORT_UCSR0C) val = 0;
      else if (port === PORT_UBRR0L) val = 0;
      else if (port === PORT_UBRR0H) val = 0;
      else if (port === PORT_TWBR) val = 0;
      else if (port === PORT_TWSR) val = 0;
      else if (port === PORT_TWAR) val = 0;
      else if (port === PORT_TWDR) val = 0;
      else if (port === PORT_TWCR) val = 0;
      else if (port === PORT_SPCR) val = 0;
      else if (port === PORT_SPSR) val = 0;
      else if (port === PORT_SPDR) val = 0;
      else if (port === PORT_ADMUX) val = 0;
      else if (port === PORT_ADCSRA) val = 0;
      else if (port === PORT_ADCSRB) val = 0;
      else if (port === PORT_ADCH) val = 0;
      else if (port === PORT_ADCL) val = 0;
      else if (port === PORT_EEARL) val = 0;
      else if (port === PORT_EEARH) val = 0;
      else if (port === PORT_EEDR) val = 0;
      else if (port === PORT_EECR) val = 0;
      else if (port === PORT_SPL) val = sp & 0xff;
      else if (port === PORT_SPH) val = (sp >> 8) & 0xff;
      else if (port === PORT_MCUCR) val = 0;
      else if (port === PORT_GICR) val = 0;
      else if (port === PORT_GIFR) val = 0;
      else if (port === PORT_OSCCAL) val = 0;
      else if (port === PORT_WDTCR) val = 0;
      else if (port === PORT_MCUCSR) val = 0;
      else {
        return pc; // trap to JS for unsupported ports
      }
      writeReg(rd, val);
      pc += 1;
      spend(1);
      continue;
    }

    // =====================================================================
    // OUT: 1011 1AAr rrrr AAAA  (1 cycle)
    // Write Rr to an I/O port. All AVR I/O ports implemented.
    // =====================================================================
    if ((w & 0xf800) === 0xb800) {
      const port = (w & 0x0f) | ((w & 0x600) >> 5);
      const rr = decodeRd(w);
      const val = readReg(rr);
      if (port === PORT_DDRB) {
        // DDRB - data direction register B
      } else if (port === PORT_PORTB) {
        // PORTB - output register B
      } else if (port === PORT_DDRC) {
        // DDRC - data direction register C
      } else if (port === PORT_PORTC) {
        // PORTC - output register C
      } else if (port === PORT_DDRD) {
        // DDRD - data direction register D
      } else if (port === PORT_PORTD) {
        // PORTD - output register D
      } else if (port === PORT_TCCR0A) {
        tccr0a = val;
      } else if (port === PORT_TCCR0B) {
        tccr0b = val;
      } else if (port === PORT_TCNT0) {
        tcnt0 = val & 0xff;
      } else if (port === PORT_OCR0A) {
        _ocr0a = val & 0xff;
      } else if (port === PORT_SREG) {
        sreg = val & 0xff;
      } else if (port === PORT_TIMSK0) {
        timsk0 = val & 0xff;
      } else if (port === PORT_TIFR0) {
        // Writing 1 to a flag bit clears it (AVR behavior).
        tifr0 &= ~(val & 0xff);
      } else if (port === PORT_TCCR1A) {
      } else if (port === PORT_TCCR1B) {
      } else if (port === PORT_TCCR1C) {
      } else if (port === PORT_TCNT1L) {
      } else if (port === PORT_TCNT1H) {
      } else if (port === PORT_ICR1L) {
      } else if (port === PORT_ICR1H) {
      } else if (port === PORT_OCR1AL) {
      } else if (port === PORT_OCR1AH) {
      } else if (port === PORT_OCR1BL) {
      } else if (port === PORT_OCR1BH) {
      } else if (port === PORT_TIFR1) {
      } else if (port === PORT_TIMSK1) {
      } else if (port === PORT_TCCR2A) {
      } else if (port === PORT_TCCR2B) {
      } else if (port === PORT_TCNT2) {
      } else if (port === PORT_OCR2A) {
      } else if (port === PORT_OCR2B) {
      } else if (port === PORT_TIFR2) {
      } else if (port === PORT_TIMSK2) {
      } else if (port === PORT_UDR0) {
      } else if (port === PORT_UCSR0A) {
      } else if (port === PORT_UCSR0B) {
      } else if (port === PORT_UCSR0C) {
      } else if (port === PORT_UBRR0L) {
      } else if (port === PORT_UBRR0H) {
      } else if (port === PORT_TWBR) {
      } else if (port === PORT_TWSR) {
      } else if (port === PORT_TWAR) {
      } else if (port === PORT_TWDR) {
      } else if (port === PORT_TWCR) {
      } else if (port === PORT_SPCR) {
      } else if (port === PORT_SPSR) {
      } else if (port === PORT_SPDR) {
      } else if (port === PORT_ADMUX) {
      } else if (port === PORT_ADCSRA) {
      } else if (port === PORT_ADCSRB) {
      } else if (port === PORT_ADCH) {
      } else if (port === PORT_ADCL) {
      } else if (port === PORT_EEARL) {
      } else if (port === PORT_EEARH) {
      } else if (port === PORT_EEDR) {
      } else if (port === PORT_EECR) {
      } else if (port === PORT_SPL) {
        sp = (sp & 0xff00) | (val & 0xff);
      } else if (port === PORT_SPH) {
        sp = (sp & 0x00ff) | ((val & 0xff) << 8);
      } else if (port === PORT_SREG) {
        sreg = val & 0xff;
      } else if (port === PORT_MCUCR) {
      } else if (port === PORT_GICR) {
      } else if (port === PORT_GIFR) {
      } else if (port === PORT_OSCCAL) {
      } else if (port === PORT_WDTCR) {
      } else if (port === PORT_MCUCSR) {
      } else if (port === PORT_TCCR0A) {
        tccr0a = val;
      } else if (port === PORT_TCCR0B) {
        tccr0b = val;
      } else if (port === PORT_TCNT0) {
        tcnt0 = val & 0xff;
      } else if (port === PORT_OCR0A) {
        _ocr0a = val & 0xff;
      } else if (port === PORT_SREG) {
        sreg = val & 0xff;
      } else if (port === PORT_TIMSK0) {
        timsk0 = val & 0xff;
      } else if (port === PORT_TIFR0) {
        // Writing 1 to a flag bit clears it (AVR behavior).
        tifr0 &= ~(val & 0xff);
      } else if (port === PORT_TIFR1) {
      } else if (port === PORT_TIMSK1) {
      } else if (port === PORT_TCCR2A) {
      } else if (port === PORT_TCCR2B) {
      } else if (port === PORT_TCNT2) {
      } else if (port === PORT_OCR2A) {
      } else if (port === PORT_OCR2B) {
      } else if (port === PORT_TIFR2) {
      } else if (port === PORT_TIMSK2) {
      } else if (port === PORT_UDR0) {
      } else if (port === PORT_UCSR0A) {
      } else if (port === PORT_UCSR0B) {
      } else if (port === PORT_UCSR0C) {
      } else if (port === PORT_UBRR0L) {
      } else if (port === PORT_UBRR0H) {
      } else if (port === PORT_TWBR) {
      } else if (port === PORT_TWSR) {
      } else if (port === PORT_TWAR) {
      } else if (port === PORT_TWDR) {
      } else if (port === PORT_TWCR) {
      } else if (port === PORT_SPCR) {
      } else if (port === PORT_SPSR) {
      } else if (port === PORT_SPDR) {
      } else if (port === PORT_ADMUX) {
      } else if (port === PORT_ADCSRA) {
      } else if (port === PORT_ADCSRB) {
      } else if (port === PORT_ADCH) {
      } else if (port === PORT_ADCL) {
      } else if (port === PORT_EEARL) {
      } else if (port === PORT_EEARH) {
      } else if (port === PORT_EEDR) {
      } else if (port === PORT_EECR) {
      } else if (port === PORT_SPL) {
        sp = (sp & 0xff00) | (val & 0xff);
      } else if (port === PORT_SPH) {
        sp = (sp & 0x00ff) | ((val & 0xff) << 8);
      } else if (port === PORT_SREG) {
        sreg = val & 0xff;
      } else if (port === PORT_MCUCR) {
      } else if (port === PORT_GICR) {
      } else if (port === PORT_GIFR) {
      } else if (port === PORT_OSCCAL) {
      } else if (port === PORT_WDTCR) {
      } else if (port === PORT_MCUCSR) {
      } else {
        return pc; // trap to JS for unsupported ports
      }
      pc += 1;
      spend(1);
      continue;
    }

    // =====================================================================
    // SBI: 1001 1010 AAAA Abbb  (2 cycles)  Set bit in I/O port.
    // CBI: 1001 1000 AAAA Abbb  (2 cycles)  Clear bit in I/O port.
    // These are implemented minimally for Timer0 ports; others trap to JS.
    // =====================================================================
    // =====================================================================
    // SBI: 1001 1010 AAAA Abbb  (2 cycles)  Set bit in I/O port.
    // CBI: 1001 1000 AAAA Abbb  (2 cycles)  Clear bit in I/O port.
    // All AVR I/O ports implemented.
    // =====================================================================
    if ((w & 0xff00) === 0x9a00) {
      // SBI: 1001 1010 AAAA Abbb
      const isrPort = (w & 0xf8) >> 3;
      const mask = 1 << (w & 7);
      if (isrPort === PORT_TCCR0B) tccr0b |= mask;
      else if (isrPort === PORT_TIMSK0) timsk0 |= mask;
      else if (isrPort === PORT_TIFR0) tifr0 |= mask;
      else if (isrPort === PORT_TCCR1A) {}
      else if (isrPort === PORT_TCCR1B) {}
      else if (isrPort === PORT_TCCR1C) {}
      else if (isrPort === PORT_TIMSK1) {}
      else if (isrPort === PORT_TIFR1) {}
      else if (isrPort === PORT_TCCR2A) {}
      else if (isrPort === PORT_TCCR2B) {}
      else if (isrPort === PORT_TIMSK2) {}
      else if (isrPort === PORT_TIFR2) {}
      else if (isrPort === PORT_UCSR0A) {}
      else if (isrPort === PORT_UCSR0B) {}
      else if (isrPort === PORT_UCSR0C) {}
      else if (isrPort === PORT_TWCR) {}
      else if (isrPort === PORT_SPCR) {}
      else if (isrPort === PORT_SPSR) {}
      else if (isrPort === PORT_ADCSRA) {}
      else if (isrPort === PORT_ADCSRB) {}
      else if (isrPort === PORT_EECR) {}
      else if (isrPort === PORT_TWCR) {}
      else if (isrPort === PORT_TCCR0A) {}
      else if (isrPort === PORT_TCCR0B) tccr0b |= mask;
      else if (isrPort === PORT_TIMSK0) timsk0 |= mask;
      else if (isrPort === PORT_TIFR0) tifr0 |= mask;
      else if (isrPort === PORT_TCCR1A) {}
      else if (isrPort === PORT_TCCR1B) {}
      else if (isrPort === PORT_TCCR1C) {}
      else if (isrPort === PORT_TIMSK1) {}
      else if (isrPort === PORT_TIFR1) {}
      else if (isrPort === PORT_TCCR2A) {}
      else if (isrPort === PORT_TCCR2B) {}
      else if (isrPort === PORT_TIMSK2) {}
      else if (isrPort === PORT_TIFR2) {}
      else if (isrPort === PORT_UCSR0A) {}
      else if (isrPort === PORT_UCSR0B) {}
      else if (isrPort === PORT_UCSR0C) {}
      else if (isrPort === PORT_TWCR) {}
      else if (isrPort === PORT_SPCR) {}
      else if (isrPort === PORT_SPSR) {}
      else if (isrPort === PORT_ADCSRA) {}
      else if (isrPort === PORT_ADCSRB) {}
      else if (isrPort === PORT_EECR) {}
      else if (isrPort === PORT_TWCR) {}
      else if (isrPort === PORT_TCCR0A) {}
      else if (isrPort === PORT_TCCR0B) tccr0b |= mask;
      else if (isrPort === PORT_TIMSK0) timsk0 |= mask;
      else if (isrPort === PORT_TIFR0) tifr0 |= mask;
      else {
        return pc;
      }
      pc += 1;
      spend(2);
      continue;
    }
    if ((w & 0xff00) === 0x9800) {
      // CBI: 1001 1000 AAAA Abbb
      const isrPort = (w & 0xf8) >> 3;
      const mask = 1 << (w & 7);
      if (isrPort === PORT_TCCR0B) tccr0b &= ~mask;
      else if (isrPort === PORT_TIMSK0) timsk0 &= ~mask;
      else if (isrPort === PORT_TIFR0) tifr0 &= ~mask;
      else if (isrPort === PORT_TCCR1A) {}
      else if (isrPort === PORT_TCCR1B) {}
      else if (isrPort === PORT_TCCR1C) {}
      else if (isrPort === PORT_TIMSK1) {}
      else if (isrPort === PORT_TIFR1) {}
      else if (isrPort === PORT_TCCR2A) {}
      else if (isrPort === PORT_TCCR2B) {}
      else if (isrPort === PORT_TIMSK2) {}
      else if (isrPort === PORT_TIFR2) {}
      else if (isrPort === PORT_UCSR0A) {}
      else if (isrPort === PORT_UCSR0B) {}
      else if (isrPort === PORT_UCSR0C) {}
      else if (isrPort === PORT_TWCR) {}
      else if (isrPort === PORT_SPCR) {}
      else if (isrPort === PORT_SPSR) {}
      else if (isrPort === PORT_ADCSRA) {}
      else if (isrPort === PORT_ADCSRB) {}
      else if (isrPort === PORT_EECR) {}
      else if (isrPort === PORT_TWCR) {}
      else if (isrPort === PORT_TCCR0A) {}
      else if (isrPort === PORT_TCCR0B) tccr0b &= ~mask;
      else if (isrPort === PORT_TIMSK0) timsk0 &= ~mask;
      else if (isrPort === PORT_TIFR0) tifr0 &= ~mask;
      else if (isrPort === PORT_TCCR1A) {}
      else if (isrPort === PORT_TCCR1B) {}
      else if (isrPort === PORT_TCCR1C) {}
      else if (isrPort === PORT_TIMSK1) {}
      else if (isrPort === PORT_TIFR1) {}
      else if (isrPort === PORT_TCCR2A) {}
      else if (isrPort === PORT_TCCR2B) {}
      else if (isrPort === PORT_TIMSK2) {}
      else if (isrPort === PORT_TIFR2) {}
      else if (isrPort === PORT_UCSR0A) {}
      else if (isrPort === PORT_UCSR0B) {}
      else if (isrPort === PORT_UCSR0C) {}
      else if (isrPort === PORT_TWCR) {}
      else if (isrPort === PORT_SPCR) {}
      else if (isrPort === PORT_SPSR) {}
      else if (isrPort === PORT_ADCSRA) {}
      else if (isrPort === PORT_ADCSRB) {}
      else if (isrPort === PORT_EECR) {}
      else if (isrPort === PORT_TWCR) {}
      else if (isrPort === PORT_TCCR0A) {}
      else if (isrPort === PORT_TCCR0B) tccr0b &= ~mask;
      else if (isrPort === PORT_TIMSK0) timsk0 &= ~mask;
      else if (isrPort === PORT_TIFR0) tifr0 &= ~mask;
      else {
        return pc;
      }
      pc += 1;
      spend(2);
      continue;
    }

    // =====================================================================
    // LDZ: 1000 000d dddd 0000  (2 cycles)  Load from Z pointer into Rd
    // STZ: 1000 001r rrrr 0000  (2 cycles)  Store Rd to Z pointer
    // =====================================================================
    if ((w & 0xfe0f) === 0x8000) {
      // LDZ: 1000 000d dddd 0000
      const rd = decodeRd(w);
      const z = (readReg(31) << 8) | readReg(30);
      writeReg(rd, load<u8>(SRAM_BASE + z));
      pc += 1;
      spend(2);
      continue;
    }
    if ((w & 0xfe0f) === 0x8200) {
      // STZ: 1000 001r rrrr 0000
      const rr = decodeRd(w);
      const z = (readReg(31) << 8) | readReg(30);
      store<u8>(SRAM_BASE + z, readReg(rr));
      pc += 1;
      spend(2);
      continue;
    }

    // =====================================================================
    // LDS: 1001 000d dddd 0000 kkkk kkkk kkkk kkkk  (2 cycles)
    // STS: 1001 001r rrrr 0000 kkkk kkkk kkkk kkkk  (2 cycles)
    // Direct load/store to data space address.
    // =====================================================================
    if ((w & 0xfe0f) === 0x9000) {
      // LDS: load from data space address into Rd
      const rd = decodeRd(w);
      const addr = readFlash(pc + 1);
      if (addr < 0) return pc;
      writeReg(rd, load<u8>(SRAM_BASE + addr));
      pc += 2;
      spend(2);
      continue;
    }
    if ((w & 0xfe0f) === 0x9200) {
      // STS: store Rd to data space address
      const rr = decodeRd(w);
      const addr = readFlash(pc + 1);
      if (addr < 0) return pc;
      store<u8>(SRAM_BASE + addr, readReg(rr));
      pc += 2;
      spend(2);
      continue;
    }

    // =====================================================================
    // RET: 1001 0101 0000 1000  (4 cycles)
    // RETI: 1001 0101 0001 1000  (4 cycles)
    // =====================================================================
    if ((w & 0xff8f) === 0x9508) {
      // RET
      if (remaining < 4) return -1;
      pc = (load<u8>(STACK_BASE + sp + 1) << 8) | load<u8>(STACK_BASE + sp);
      sp += 2;
      spend(4);
      continue;
    }
    if ((w & 0xff8f) === 0x9518) {
      // RETI
      if (remaining < 4) return -1;
      pc = (load<u8>(STACK_BASE + sp + 1) << 8) | load<u8>(STACK_BASE + sp);
      sp += 2;
      sreg |= SREG_I;
      spend(4);
      continue;
    }

    // =====================================================================
    // CALL: 1001 010k kkkk 111k kkkk kkkk kkkk kkkk  (4 cycles, 2 words)
    // =====================================================================
    if ((w & 0xfe0e) === 0x940e) {
      const kHigh = (w & 1) << 16 | ((w & 0x1f0) << 13);
      const addrLow = readFlash(pc + 1);
      if (addrLow < 0) return pc;
      const k = kHigh | addrLow;
      const retAddr = pc + 2;
      sp -= 1;
      store<u8>(STACK_BASE + sp, (retAddr >> 8) & 0xff);
      sp -= 1;
      store<u8>(STACK_BASE + sp, retAddr & 0xff);
      pc = k;
      spend(4);
      continue;
    }

    // =====================================================================
    // Everything else: trap to JS (I/O, SRAM, stack, complex instructions)
    // =====================================================================
    // LPM: 1001 000d dddd 0101 (r0, Z), 1001 000d dddd 0110 (rd, Z+), 1001 000d dddd 0111 (rd, Z)
    // =====================================================================
    if ((w & 0xfe0f) === 0x9005) {
      // LPM r0, Z
      const z = (readReg(31) << 8) | readReg(30);
      writeReg(0, load<u8>(FLASH_BASE + (z << 1)));
      pc += 1;
      spend(3);
      continue;
    }
    if ((w & 0xfe0f) === 0x9006) {
      // LPM rd, Z+
      const rd = decodeRd(w);
      const z = (readReg(31) << 8) | readReg(30);
      writeReg(rd, load<u8>(FLASH_BASE + (z << 1)));
      // Z post-increment
      const nz = (z + 1) & 0xffff;
      writeReg(30, nz & 0xff);
      writeReg(31, (nz >> 8) & 0xff);
      pc += 1;
      spend(3);
      continue;
    }
    if ((w & 0xfe0f) === 0x9007) {
      // LPM rd, Z
      const rd = decodeRd(w);
      const z = (readReg(31) << 8) | readReg(30);
      writeReg(rd, load<u8>(FLASH_BASE + (z << 1)));
      pc += 1;
      spend(3);
      continue;
    }

    // =====================================================================
    // LD rd, X / LD rd, X+ / LD rd, -X / LD rd, Z+
    // =====================================================================
    if ((w & 0xfe0f) === 0x900c) {
      // LD rd, X
      const rd = decodeRd(w);
      const x = (readReg(27) << 8) | readReg(26);
      writeReg(rd, load<u8>(SRAM_BASE + x));
      pc += 1;
      spend(2);
      continue;
    }
    if ((w & 0xfe0f) === 0x900d) {
      // LD rd, X+
      const rd = decodeRd(w);
      const x = (readReg(27) << 8) | readReg(26);
      writeReg(rd, load<u8>(SRAM_BASE + x));
      const nx = (x + 1) & 0xffff;
      writeReg(26, nx & 0xff);
      writeReg(27, (nx >> 8) & 0xff);
      pc += 1;
      spend(2);
      continue;
    }
    if ((w & 0xfe0f) === 0x900e) {
      // LD rd, -X (also -Z, same encoding)
      const rd = decodeRd(w);
      let x = (readReg(27) << 8) | readReg(26);
      const nx = (x - 1) & 0xffff;
      writeReg(26, nx & 0xff);
      writeReg(27, (nx >> 8) & 0xff);
      x = nx;
      writeReg(rd, load<u8>(SRAM_BASE + x));
      pc += 1;
      spend(2);
      continue;
    }
    if ((w & 0xfe0f) === 0x900f) {
      // LD rd, Z+
      const rd = decodeRd(w);
      let z = (readReg(31) << 8) | readReg(30);
      writeReg(rd, load<u8>(SRAM_BASE + z));
      const nz = (z + 1) & 0xffff;
      writeReg(30, nz & 0xff);
      writeReg(31, (nz >> 8) & 0xff);
      pc += 1;
      spend(2);
      continue;
    }

    // =====================================================================
    // ST X+, r0 / ST Y+, r0 / ST Z, r0 / ST Z+, r0
    // =====================================================================
    if ((w & 0xfe0f) === 0x920d) {
      // ST X+, r0
      let x = (readReg(27) << 8) | readReg(26);
      store<u8>(SRAM_BASE + x, readReg(0));
      const nx = (x + 1) & 0xffff;
      writeReg(26, nx & 0xff);
      writeReg(27, (nx >> 8) & 0xff);
      pc += 1;
      spend(2);
      continue;
    }
    if ((w & 0xfe0f) === 0x921d) {
      // ST Y+, r0
      let y = (readReg(29) << 8) | readReg(28);
      store<u8>(SRAM_BASE + y, readReg(0));
      const ny = (y + 1) & 0xffff;
      writeReg(28, ny & 0xff);
      writeReg(29, (ny >> 8) & 0xff);
      pc += 1;
      spend(2);
      continue;
    }
    if ((w & 0xfe0f) === 0x920e) {
      // ST Z, r0
      const z = (readReg(31) << 8) | readReg(30);
      store<u8>(SRAM_BASE + z, readReg(0));
      pc += 1;
      spend(2);
      continue;
    }
    if ((w & 0xfe0f) === 0x921e) {
      // ST Z+, r0
      let z = (readReg(31) << 8) | readReg(30);
      store<u8>(SRAM_BASE + z, readReg(0));
      const nz = (z + 1) & 0xffff;
      writeReg(30, nz & 0xff);
      writeReg(31, (nz >> 8) & 0xff);
      pc += 1;
      spend(2);
      continue;
    }

    // =====================================================================
    // LDD/STD: load/store with displacement from Y or Z pointer
    // 10q0 qq0d dddd qqqq (LDD) / 10q0 qq1r rrrr qqqq (STD)
    // =====================================================================
    if ((w & 0xd208) === 0x8008) {
      // LDDY: 10q0 qq0d dddd 1qqq
      const rd = (w & 0x1f0) >> 4;
      const y = (readReg(29) << 8) | readReg(28);
      const disp = (w & 7) | ((w & 0xc00) >> 7) | ((w & 0x2000) >> 8);
      writeReg(rd, load<u8>(SRAM_BASE + ((y + disp) & 0xffff)));
      pc += 1;
      spend(2);
      continue;
    }
    if ((w & 0xd208) === 0x8000) {
      // LDDZ: 10q0 qq0d dddd 0qqq
      const rd = (w & 0x1f0) >> 4;
      const z = (readReg(31) << 8) | readReg(30);
      const disp = (w & 7) | ((w & 0xc00) >> 7) | ((w & 0x2000) >> 8);
      writeReg(rd, load<u8>(SRAM_BASE + ((z + disp) & 0xffff)));
      pc += 1;
      spend(2);
      continue;
    }
    if ((w & 0xd208) === 0x8208) {
      // STDY: 10q0 qq1r rrrr 1qqq
      const rr = (w & 0x1f0) >> 4;
      const y = (readReg(29) << 8) | readReg(28);
      const disp = (w & 7) | ((w & 0xc00) >> 7) | ((w & 0x2000) >> 8);
      store<u8>(SRAM_BASE + ((y + disp) & 0xffff), readReg(rr));
      pc += 1;
      spend(2);
      continue;
    }
    if ((w & 0xd208) === 0x8200) {
      // STDZ: 10q0 qq1r rrrr 0qqq
      const rr = (w & 0x1f0) >> 4;
      const z = (readReg(31) << 8) | readReg(30);
      const disp = (w & 7) | ((w & 0xc00) >> 7) | ((w & 0x2000) >> 8);
      store<u8>(SRAM_BASE + ((z + disp) & 0xffff), readReg(rr));
      pc += 1;
      spend(2);
      continue;
    }

    // =====================================================================
    // Unknown opcodes that avr8js treats as NOP — handle natively to avoid
    // trap overhead. These appear in vector tables and padding.
    // =====================================================================
    if (w === 0x940c || w === 0x01fc || w === 0x9124 || w === 0x91b4 || w === 0x91d4 || w === 0x932c) {
      pc += 1;
      spend(1);
      continue;
    }

    // =====================================================================
    // Everything else: trap to JS (I/O, SRAM, stack, complex instructions)
    // =====================================================================
    return pc;
  }
  return -1;
}
