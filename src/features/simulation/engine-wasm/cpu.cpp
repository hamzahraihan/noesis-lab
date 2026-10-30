/**
 * AVR CPU core, C++ port of `avr/wasm/cpu.ts` (issue #20, phase 3).
 *
 * Executes AVR machine code in freestanding wasm32. Flash, registers and the
 * stack live at fixed linear-memory addresses; raw load/store only, no libc,
 * no exceptions, no RTTI. Instructions the core can execute run natively;
 * anything needing I/O, unsupported ports, stack discipline it cannot model,
 * or an unported opcode traps by returning the trapping PC.
 *
 * The trap ABI mirrors the TypeScript core: `cpu_step(budget_cycles)` returns
 * -1 when it consumes the whole budget without trapping, otherwise the
 * word-addressed PC of the trapping instruction. The host (core.ts) then
 * executes that instruction with the JS shadow and resumes.
 *
 * ABI:
 *   cpu_step(uint32_t budget_cycles) -> int32_t  (-1 | trap pc)
 *   cpu_get_pc() -> uint32_t
 *   cpu_get_reg(uint32_t i) -> uint32_t
 *   cpu_set_reg(uint32_t i, uint32_t v) -> void
 *   cpu_get_sreg() -> uint32_t
 *   cpu_set_sreg(uint32_t v) -> void
 *   cpu_get_sp() -> uint32_t
 *   cpu_set_sp(uint32_t v) -> void
 *   cpu_get_cycles() -> uint32_t
 *   cpu_set_cycles(uint32_t v) -> void
 *   cpu_get_instructions() -> uint32_t
 *   cpu_get_flash_capacity() -> uint32_t
 *   cpu_reset() -> void
 *   cpu_write_pin(uint32_t gpio, uint32_t high) -> void   (host -> core)
 *   cpu_pin_level(uint32_t gpio) -> uint32_t              (core -> host peek)
 *
 * Linear memory map (byte addresses):
 *   flash  [0, 32768)      16384 words of program flash (u16)
 *   regs   [32768, 32800)  32 AVR registers (u8)
 *   pins   [32800, 32820)  20 GPIO input levels (u8)
 *   stack  [33024, 35328)  AVR data-space stack
 */

#include "engine.h"
extern "C" {
extern unsigned char __heap_base;
}

using namespace engine;

namespace {

constexpr uint32_t FLASH_BASE = 0;
constexpr uint32_t FLASH_WORDS = 16384;
constexpr uint32_t REGS_BASE = 32768;
constexpr uint32_t STACK_BASE = 33024;
constexpr uint32_t RAMEND = 0x8ff;

constexpr uint32_t PIN_BASE = 32800;
constexpr uint32_t PIN_COUNT = 20;

constexpr uint8_t SREG_C = 0x01;
constexpr uint8_t SREG_Z = 0x02;
constexpr uint8_t SREG_N = 0x04;
constexpr uint8_t SREG_V = 0x08;
constexpr uint8_t SREG_S = 0x10;
constexpr uint8_t SREG_H = 0x20;
constexpr uint8_t SREG_I = 0x80;

constexpr uint32_t PORT_TCCR0A = 0x24;
constexpr uint32_t PORT_TCCR0B = 0x25;
constexpr uint32_t PORT_TCNT0 = 0x26;
constexpr uint32_t PORT_OCR0A = 0x27;
constexpr uint32_t PORT_SREG = 0x5f;
constexpr uint32_t PORT_TIMSK0 = 0x6e;
constexpr uint32_t PORT_TIFR0 = 0x6f;

constexpr uint32_t PORT_SPL = 0x3d;
constexpr uint32_t PORT_SPH = 0x3e;

constexpr uint8_t TIFR0_TOV0 = 0x01;
constexpr uint8_t TIMSK0_TOIE0 = 0x01;

constexpr uint32_t TIMER0_OVF_VECTOR = 0x20;

constexpr uint32_t PINB = 0x23;
constexpr uint32_t DDRB = 0x24;
constexpr uint32_t PORTB = 0x25;
constexpr uint32_t PINC = 0x26;
constexpr uint32_t DDRC = 0x27;
constexpr uint32_t PORTC = 0x28;
constexpr uint32_t PIND = 0x29;
constexpr uint32_t DDRD = 0x2a;
constexpr uint32_t PORTD = 0x2b;

uint8_t* mem;

inline uint8_t* base() {
  if (mem == nullptr) mem = reinterpret_cast<uint8_t*>(&__heap_base);
  return mem;
}

inline uint8_t read8(uint32_t addr) { return base()[addr]; }
inline void write8(uint32_t addr, uint8_t v) { base()[addr] = v; }
inline uint16_t read16(uint32_t addr) {
  return static_cast<uint16_t>(read8(addr)) | (static_cast<uint16_t>(read8(addr + 1)) << 8);
}

inline int32_t readFlash(uint32_t wordAddr) {
  if (wordAddr >= FLASH_WORDS) return -1;
  return static_cast<int32_t>(read16(FLASH_BASE + wordAddr * 2));
}

inline uint8_t readReg(uint32_t rd) { return read8(REGS_BASE + (rd & 31)); }
inline void writeReg(uint32_t rd, uint8_t v) { write8(REGS_BASE + (rd & 31), v); }

uint32_t pc = 0;
uint32_t cycles = 0;
uint32_t instructions = 0;
uint8_t sreg = 0;
uint16_t sp = 0;

uint8_t tcnt0 = 0;
uint8_t tccr0a = 0;
uint8_t tccr0b = 0;
uint8_t ocr0a = 0;
uint8_t timsk0 = 0;
uint8_t tifr0 = 0;
uint32_t prescaler0 = 0;

uint32_t remaining = 0;

inline uint32_t prescalerDiv(uint8_t tccr0b) {
  const uint32_t cs = tccr0b & 0x07;
  if (cs == 0) return 1;
  if (cs == 1) return 1;
  if (cs == 2) return 8;
  if (cs == 3) return 64;
  if (cs == 4) return 256;
  if (cs == 5) return 1024;
  return 1;
}

inline void advanceTimer(uint32_t n) {
  const uint32_t div = prescalerDiv(tccr0b);
  const uint32_t total = prescaler0 + n;
  const uint32_t overflows = total / div;
  prescaler0 = total % div;
  const uint8_t oldTcnt0 = tcnt0;
  tcnt0 = static_cast<uint8_t>((tcnt0 + overflows) & 0xff);
  if (static_cast<uint32_t>(oldTcnt0) + overflows > 255) {
    tifr0 |= TIFR0_TOV0;
  }
}

inline void spend(uint32_t n) {
  cycles += n;
  remaining -= n;
  instructions += 1;
  advanceTimer(n);
}

inline uint32_t decodeRd(uint32_t w) { return (w & 0x1f0) >> 4; }
inline uint32_t decodeRr(uint32_t w) { return (w & 0x0f) | ((w & 0x200) >> 5); }

inline void setSimpleFlags(uint8_t result) {
  const bool z = result == 0;
  const bool nn = (result & 0x80) != 0;
  uint8_t flags = static_cast<uint8_t>(sreg & 0xe1);
  if (z) flags |= SREG_Z;
  if (nn) flags |= SREG_N;
  if (nn) flags |= SREG_S;
  sreg = flags;
}

inline void setSubFlags(uint8_t result, uint8_t val1, uint8_t val2, bool borrow) {
  const bool z = result == 0;
  const bool nn = (result & 0x80) != 0;
  const bool v = ((val1 ^ val2) & (val1 ^ result) & 0x80) != 0;
  const bool s = nn != v;
  const bool c = borrow || val2 > val1;
  const bool h = (1 & ((~val1 & val2) | (val2 & result) | (result & ~val1))) != 0;
  uint8_t flags = static_cast<uint8_t>(sreg & 0xc0);
  if (z) flags |= SREG_Z;
  if (nn) flags |= SREG_N;
  if (v) flags |= SREG_V;
  if (s) flags |= SREG_S;
  if (h) flags |= SREG_H;
  if (c) flags |= SREG_C;
  sreg = flags;
}

inline void pushStack(uint16_t value) {
  sp -= 1;
  write8(STACK_BASE + sp, static_cast<uint8_t>((value >> 8) & 0xff));
  sp -= 1;
  write8(STACK_BASE + sp, static_cast<uint8_t>(value & 0xff));
}

inline uint16_t popStack() {
  const uint16_t value =
      (static_cast<uint16_t>(read8(STACK_BASE + sp + 1)) << 8) | read8(STACK_BASE + sp);
  sp += 2;
  return value;
}

}  // namespace

extern "C" void cpu_reset() {
  for (uint32_t i = 0; i < 32; i++) write8(REGS_BASE + i, 0);
  pc = 0;
  cycles = 0;
  sreg = 0;
  sp = static_cast<uint16_t>(RAMEND + 1);
  remaining = 0;
  instructions = 0;
  tcnt0 = 0;
  tccr0a = 0;
  tccr0b = 0;
  ocr0a = 0;
  timsk0 = 0;
  tifr0 = 0;
  prescaler0 = 0;
}

extern "C" uint32_t cpu_get_pc() { return pc; }
extern "C" void cpu_set_pc(uint32_t v) { pc = v; }
extern "C" uint32_t cpu_get_reg(uint32_t i) { return readReg(i); }
extern "C" void cpu_set_reg(uint32_t i, uint32_t v) { writeReg(i, static_cast<uint8_t>(v)); }
extern "C" uint32_t cpu_get_sreg() { return sreg; }
extern "C" void cpu_set_sreg(uint32_t v) { sreg = static_cast<uint8_t>(v & 0xff); }
extern "C" uint32_t cpu_get_sp() { return sp; }
extern "C" void cpu_set_sp(uint32_t v) { sp = static_cast<uint16_t>(v); }
extern "C" uint32_t cpu_get_cycles() { return cycles; }
extern "C" void cpu_set_cycles(uint32_t v) { cycles = v; }
extern "C" uint32_t cpu_get_flash_capacity() { return FLASH_WORDS; }
extern "C" uint32_t cpu_flash_base() {
  return reinterpret_cast<uintptr_t>(&__heap_base);
}
extern "C" uint32_t cpu_get_instructions() { return instructions; }
extern "C" void cpu_write_pin(uint32_t gpio, uint32_t high) {
  if (gpio < PIN_COUNT) write8(PIN_BASE + gpio, static_cast<uint8_t>(high ? 1 : 0));
}
extern "C" uint32_t cpu_pin_level(uint32_t gpio) {
  if (gpio >= PIN_COUNT) return 0;
  return read8(PIN_BASE + gpio) != 0 ? 1 : 0;
}

/**
 * Execute up to `budget_cycles` of AVR instructions.
 *
 * Returns -1 when the whole budget is consumed without trapping. Otherwise
 * returns the word-addressed PC of the instruction that could not be executed
 * (unported opcode, unsupported I/O port, out-of-bounds flash). The caller
 * handles that instruction with the JS shadow, syncs state back, and resumes.
 */
extern "C" int32_t cpu_step(uint32_t budget_cycles) {
  remaining = budget_cycles;
  while (remaining > 0) {
    const int32_t w = readFlash(pc);
    if (w < 0) return static_cast<int32_t>(pc);

    // Pending interrupt sampled between instructions.
    if ((sreg & SREG_I) != 0 && (timsk0 & TIMSK0_TOIE0) != 0 && (tifr0 & TIFR0_TOV0) != 0) {
      pushStack(pc);
      pc = TIMER0_OVF_VECTOR;
      sreg = static_cast<uint8_t>(sreg & ~SREG_I);
      spend(3);
      continue;
    }

    // ---- NOP -----------------------------------------------------------
    if (w == 0x0000) {
      pc += 1;
      spend(1);
      continue;
    }

    // ---- RJMP ----------------------------------------------------------
    if ((w & 0xf000) == 0xc000) {
      if (remaining < 2) return -1;
      int32_t k = static_cast<int32_t>(w & 0x07ff);
      if ((k & 0x0400) != 0) k -= 0x0800;
      pc = static_cast<uint32_t>(static_cast<int32_t>(pc) + k + 1);
      spend(2);
      continue;
    }

    // ---- RCALL ---------------------------------------------------------
    if ((w & 0xf000) == 0xd000) {
      if (remaining < 3) return -1;
      int32_t k = static_cast<int32_t>(w & 0x0fff);
      if ((k & 0x0800) != 0) k -= 0x1000;
      const uint16_t retAddr = static_cast<uint16_t>(pc + 1);
      pushStack(retAddr);
      pc = static_cast<uint32_t>(static_cast<int32_t>(pc) + k + 1);
      spend(3);
      continue;
    }

    // ---- RET -----------------------------------------------------------
    if (w == 0x9508) {
      if (remaining < 4) return -1;
      pc = popStack();
      spend(4);
      continue;
    }

    // ---- RETI ----------------------------------------------------------
    if (w == 0x9518) {
      if (remaining < 4) return -1;
      pc = popStack();
      sreg |= SREG_I;
      spend(4);
      continue;
    }

    // ---- LDI -----------------------------------------------------------
    if ((w & 0xf000) == 0xe000) {
      const uint32_t rd = 16 + ((w >> 4) & 0x0f);
      const uint8_t k = static_cast<uint8_t>(((w >> 8) & 0x0f) * 16 + (w & 0x0f));
      writeReg(rd, k);
      pc += 1;
      spend(1);
      continue;
    }

    // ---- MOV -----------------------------------------------------------
    if ((w & 0xfc00) == 0x2c00) {
      const uint32_t rd = decodeRd(w);
      const uint32_t rr = decodeRr(w);
      writeReg(rd, readReg(rr));
      pc += 1;
      spend(1);
      continue;
    }

    // ---- ADD -----------------------------------------------------------
    if ((w & 0xfc00) == 0x0c00) {
      const uint32_t rd = decodeRd(w);
      const uint32_t rr = decodeRr(w);
      // Reproduce alu_add flag packing exactly.
      const uint32_t aa = readReg(rd);
      const uint32_t bb = readReg(rr);
      const uint32_t r = aa + bb;
      const uint8_t result = static_cast<uint8_t>(r & 0xff);
      const bool h = ((aa & 1 & (bb & 1))) != 0;
      const bool c = r > 0xff;
      const bool v = (~(aa ^ bb) & (aa ^ result) & 0x80) != 0;
      const bool nn = (result & 0x80) != 0;
      const bool z = result == 0;
      const bool s = nn != v;
      uint32_t flags = 0;
      if (h) flags |= 0x20;
      if (s) flags |= 0x10;
      if (v) flags |= 0x08;
      if (nn) flags |= 0x04;
      if (z) flags |= 0x02;
      if (c) flags |= 0x01;
      writeReg(rd, result);
      sreg = static_cast<uint8_t>((sreg & 0xc0) | (flags & 0x3f));
      pc += 1;
      spend(1);
      continue;
    }

    // ---- ADC -----------------------------------------------------------
    if ((w & 0xfc00) == 0x1c00) {
      const uint32_t rd = decodeRd(w);
      const uint32_t rr = decodeRr(w);
      const uint32_t carry = (sreg & SREG_C) != 0 ? 1 : 0;
      const uint32_t aa = readReg(rd);
      const uint32_t bb = readReg(rr);
      const uint32_t r = aa + bb + carry;
      const uint8_t result = static_cast<uint8_t>(r & 0xff);
      const bool h = ((aa & 1 & (bb & 1)) | (carry & ((aa ^ bb) & 1))) != 0;
      const bool c = r > 0xff;
      const bool v = (~(aa ^ bb) & (aa ^ result) & 0x80) != 0;
      const bool nn = (result & 0x80) != 0;
      const bool z = result == 0;
      const bool s = nn != v;
      uint32_t flags = 0;
      if (h) flags |= 0x20;
      if (s) flags |= 0x10;
      if (v) flags |= 0x08;
      if (nn) flags |= 0x04;
      if (z) flags |= 0x02;
      if (c) flags |= 0x01;
      writeReg(rd, result);
      sreg = static_cast<uint8_t>((sreg & 0xc0) | (flags & 0x3f));
      pc += 1;
      spend(1);
      continue;
    }

    // ---- SUB -----------------------------------------------------------
    if ((w & 0xfc00) == 0x1800) {
      const uint32_t rd = decodeRd(w);
      const uint32_t rr = decodeRr(w);
      const uint8_t val1 = readReg(rd);
      const uint8_t val2 = readReg(rr);
      const uint8_t result = static_cast<uint8_t>(val1 - val2);
      setSubFlags(result, val1, val2, false);
      writeReg(rd, result);
      pc += 1;
      spend(1);
      continue;
    }

    // ---- SBC -----------------------------------------------------------
    if ((w & 0xfc00) == 0x0800) {
      const uint32_t rd = decodeRd(w);
      const uint32_t rr = decodeRr(w);
      const uint8_t val1 = readReg(rd);
      const uint8_t val2 = readReg(rr);
      const uint8_t borrow = (sreg & SREG_C) != 0 ? 1 : 0;
      const uint8_t result = static_cast<uint8_t>(val1 - val2 - borrow);
      setSubFlags(result, val1, val2, borrow != 0);
      writeReg(rd, result);
      pc += 1;
      spend(1);
      continue;
    }

    // ---- AND -----------------------------------------------------------
    if ((w & 0xfc00) == 0x2000) {
      const uint32_t rd = decodeRd(w);
      const uint32_t rr = decodeRr(w);
      const uint8_t result = static_cast<uint8_t>(readReg(rd) & readReg(rr));
      writeReg(rd, result);
      setSimpleFlags(result);
      pc += 1;
      spend(1);
      continue;
    }

    // ---- OR ------------------------------------------------------------
    if ((w & 0xfc00) == 0x2800) {
      const uint32_t rd = decodeRd(w);
      const uint32_t rr = decodeRr(w);
      const uint8_t result = static_cast<uint8_t>(readReg(rd) | readReg(rr));
      writeReg(rd, result);
      setSimpleFlags(result);
      pc += 1;
      spend(1);
      continue;
    }

    // ---- EOR -----------------------------------------------------------
    if ((w & 0xfc00) == 0x2400) {
      const uint32_t rd = decodeRd(w);
      const uint32_t rr = decodeRr(w);
      const uint8_t result = static_cast<uint8_t>(readReg(rd) ^ readReg(rr));
      writeReg(rd, result);
      setSimpleFlags(result);
      pc += 1;
      spend(1);
      continue;
    }

    // ---- ASR -----------------------------------------------------------
    if ((w & 0xfe0f) == 0x9405) {
      const uint32_t rd = ((w >> 4) & 0x0f) | (((w >> 8) & 1) << 4);
      const uint8_t value = readReg(rd);
      const uint8_t result = static_cast<uint8_t>((value >> 1) | (value & 0x80));
      writeReg(rd, result);
      const bool z = result == 0;
      const bool nn = (result & 0x80) != 0;
      const bool c = (value & 1) != 0;
      const bool v = nn != ((sreg & SREG_C) != 0);
      const bool s = nn != v;
      uint8_t flags = static_cast<uint8_t>(sreg & 0xc0);
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

    // ---- LSR -----------------------------------------------------------
    if ((w & 0xfe0f) == 0x9406) {
      const uint32_t rd = ((w >> 4) & 0x0f) | (((w >> 8) & 1) << 4);
      const uint8_t value = readReg(rd);
      const uint8_t result = static_cast<uint8_t>(value >> 1);
      writeReg(rd, result);
      const bool z = result == 0;
      const bool nn = (result & 0x80) != 0;
      const bool c = (value & 1) != 0;
      const bool v = nn != ((sreg & SREG_C) != 0);
      const bool s = nn != v;
      uint8_t flags = static_cast<uint8_t>(sreg & 0xc0);
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

    // ---- ROR -----------------------------------------------------------
    if ((w & 0xfe0f) == 0x9407) {
      const uint32_t rd = ((w >> 4) & 0x0f) | (((w >> 8) & 1) << 4);
      const uint8_t value = readReg(rd);
      const uint8_t cIn = (sreg & SREG_C) != 0 ? 1 : 0;
      const uint8_t result = static_cast<uint8_t>(((value >> 1) | (cIn << 7)) & 0xff);
      writeReg(rd, result);
      const bool z = result == 0;
      const bool nn = (result & 0x80) != 0;
      const bool cOut = (value & 1) != 0;
      const bool v = nn != ((sreg & SREG_C) != 0);
      const bool s = nn != v;
      uint8_t flags = static_cast<uint8_t>(sreg & 0xc0);
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

    // ---- COM -----------------------------------------------------------
    if ((w & 0xfe0f) == 0x9400) {
      const uint32_t rd = ((w >> 4) & 0x0f) | (((w >> 8) & 1) << 4);
      const uint8_t result = static_cast<uint8_t>(255 - readReg(rd));
      writeReg(rd, result);
      const bool z = result == 0;
      const bool nn = (result & 0x80) != 0;
      const bool s = nn;
      uint8_t flags = static_cast<uint8_t>(sreg & 0xc0);
      if (z) flags |= SREG_Z;
      if (nn) flags |= SREG_N;
      if (s) flags |= SREG_S;
      flags |= SREG_C;
      sreg = flags;
      pc += 1;
      spend(1);
      continue;
    }

    // ---- NEG -----------------------------------------------------------
    if ((w & 0xfe0f) == 0x9401) {
      const uint32_t rd = ((w >> 4) & 0x0f) | (((w >> 8) & 1) << 4);
      const uint8_t value = readReg(rd);
      const uint8_t result = static_cast<uint8_t>((256 - value) & 0xff);
      writeReg(rd, result);
      const bool z = result == 0;
      const bool nn = (result & 0x80) != 0;
      const bool c = value != 0;
      uint8_t flags = static_cast<uint8_t>(sreg & 0xc0);
      if (z) flags |= SREG_Z;
      if (nn) flags |= SREG_N;
      if (c) flags |= SREG_C;
      sreg = flags;
      pc += 1;
      spend(1);
      continue;
    }

    // ---- SWAP ----------------------------------------------------------
    if ((w & 0xfe0f) == 0x9402) {
      const uint32_t rd = ((w >> 4) & 0x0f) | (((w >> 8) & 1) << 4);
      const uint8_t value = readReg(rd);
      const uint8_t result = static_cast<uint8_t>(((value << 4) | (value >> 4)) & 0xff);
      writeReg(rd, result);
      pc += 1;
      spend(1);
      continue;
    }

    // ---- INC -----------------------------------------------------------
    if ((w & 0xfe0f) == 0x9403) {
      const uint32_t rd = ((w >> 4) & 0x0f) | (((w >> 8) & 1) << 4);
      const uint8_t value = readReg(rd);
      const uint8_t result = static_cast<uint8_t>((value + 1) & 0xff);
      writeReg(rd, result);
      const bool z = result == 0;
      const bool nn = (result & 0x80) != 0;
      const bool v = value == 0x7f;
      const bool s = nn != v;
      uint8_t flags = static_cast<uint8_t>(sreg & 0xc0);
      if (z) flags |= SREG_Z;
      if (nn) flags |= SREG_N;
      if (v) flags |= SREG_V;
      if (s) flags |= SREG_S;
      sreg = flags;
      pc += 1;
      spend(1);
      continue;
    }

    // ---- DEC -----------------------------------------------------------
    if ((w & 0xfe0f) == 0x940a) {
      const uint32_t rd = ((w >> 4) & 0x0f) | (((w >> 8) & 1) << 4);
      const uint8_t value = readReg(rd);
      const uint8_t result = static_cast<uint8_t>((value - 1) & 0xff);
      writeReg(rd, result);
      const bool z = result == 0;
      const bool nn = (result & 0x80) != 0;
      const bool v = value == 0x80;
      const bool s = nn != v;
      uint8_t flags = static_cast<uint8_t>(sreg & 0xc0);
      if (z) flags |= SREG_Z;
      if (nn) flags |= SREG_N;
      if (v) flags |= SREG_V;
      if (s) flags |= SREG_S;
      sreg = flags;
      pc += 1;
      spend(1);
      continue;
    }

    // ---- CP ------------------------------------------------------------
    if ((w & 0xfc00) == 0x1400) {
      const uint32_t rd = decodeRd(w);
      const uint32_t rr = decodeRr(w);
      const uint8_t val1 = readReg(rd);
      const uint8_t val2 = readReg(rr);
      const uint8_t result = static_cast<uint8_t>(val1 - val2);
      setSubFlags(result, val1, val2, false);
      pc += 1;
      spend(1);
      continue;
    }

    // ---- CPC -----------------------------------------------------------
    if ((w & 0xfc00) == 0x0400) {
      const uint32_t rd = decodeRd(w);
      const uint32_t rr = decodeRr(w);
      const uint8_t val1 = readReg(rd);
      const uint8_t val2 = readReg(rr);
      const uint8_t borrow = (sreg & SREG_C) != 0 ? 1 : 0;
      const uint8_t result = static_cast<uint8_t>(val1 - val2 - borrow);
      setSubFlags(result, val1, val2, borrow != 0);
      pc += 1;
      spend(1);
      continue;
    }

    // ---- CPSE ----------------------------------------------------------
    if ((w & 0xfc00) == 0x1000) {
      const uint32_t rd = decodeRd(w);
      const uint32_t rr = decodeRr(w);
      if (readReg(rd) == readReg(rr)) {
        pc += 1;
        spend(1);
        const int32_t nextW = readFlash(pc);
        if (nextW >= 0 && (((nextW & 0xfe0e) == 0x940e) || ((nextW & 0xfe0e) == 0x940c))) {
          pc += 1;
          spend(1);
        }
      } else {
        pc += 1;
        spend(1);
      }
      continue;
    }

    // ---- Branch BRBC / BRBS -------------------------------------------
    if ((w & 0xfc00) == 0xf400 || (w & 0xfc00) == 0xf000) {
      if (remaining < 1) return -1;
      const uint32_t s = w & 7;
      int32_t offset = static_cast<int32_t>((w & 0x1f8) >> 3);
      if ((w & 0x200) != 0) offset -= 0x40;
      const bool taken = (w & 0xfc00) == 0xf400
          ? (sreg & (1 << s)) == 0
          : (sreg & (1 << s)) != 0;
      if (taken) {
        pc = static_cast<uint32_t>(static_cast<int32_t>(pc) + offset + 1);
        spend(2);
      } else {
        pc += 1;
        spend(1);
      }
      continue;
    }

    // ---- BSET ----------------------------------------------------------
    if ((w & 0xff8f) == 0x9408) {
      const uint32_t s = (w >> 4) & 7;
      sreg |= (1 << s);
      pc += 1;
      spend(1);
      continue;
    }

    // ---- BCLR ----------------------------------------------------------
    if ((w & 0xff8f) == 0x9488) {
      const uint32_t s = (w >> 4) & 7;
      sreg = static_cast<uint8_t>(sreg & ~(1 << s));
      pc += 1;
      spend(1);
      continue;
    }

    // ---- CPI -----------------------------------------------------------
    if ((w & 0xf000) == 0x3000) {
      const uint32_t rd = 16 + ((w >> 4) & 0x0f);
      const uint8_t k = static_cast<uint8_t>((w & 0x0f) | ((w >> 4) & 0xf0));
      const uint8_t val1 = readReg(rd);
      const uint8_t result = static_cast<uint8_t>(val1 - k);
      setSubFlags(result, val1, k, false);
      pc += 1;
      spend(1);
      continue;
    }

    // ---- SUBI ----------------------------------------------------------
    if ((w & 0xf000) == 0x5000) {
      const uint32_t rd = 16 + ((w >> 4) & 0x0f);
      const uint8_t k = static_cast<uint8_t>((w & 0x0f) | ((w >> 4) & 0xf0));
      const uint8_t val1 = readReg(rd);
      const uint8_t result = static_cast<uint8_t>(val1 - k);
      setSubFlags(result, val1, k, false);
      writeReg(rd, result);
      pc += 1;
      spend(1);
      continue;
    }

    // ---- SBCI ----------------------------------------------------------
    if ((w & 0xf000) == 0x4000) {
      const uint32_t rd = 16 + ((w >> 4) & 0x0f);
      const uint8_t k = static_cast<uint8_t>((w & 0x0f) | ((w >> 4) & 0xf0));
      const uint8_t val1 = readReg(rd);
      const uint8_t borrow = (sreg & SREG_C) != 0 ? 1 : 0;
      const uint8_t result = static_cast<uint8_t>(val1 - k - borrow);
      setSubFlags(result, val1, k, borrow != 0);
      writeReg(rd, result);
      pc += 1;
      spend(1);
      continue;
    }

    // ---- ANDI ----------------------------------------------------------
    if ((w & 0xf000) == 0x7000) {
      const uint32_t rd = 16 + ((w >> 4) & 0x0f);
      const uint8_t k = static_cast<uint8_t>((w & 0x0f) | ((w >> 4) & 0xf0));
      const uint8_t result = static_cast<uint8_t>(readReg(rd) & k);
      writeReg(rd, result);
      setSimpleFlags(result);
      pc += 1;
      spend(1);
      continue;
    }

    // ---- ORI -----------------------------------------------------------
    if ((w & 0xf000) == 0x6000) {
      const uint32_t rd = 16 + ((w >> 4) & 0x0f);
      const uint8_t k = static_cast<uint8_t>((w & 0x0f) | ((w >> 4) & 0xf0));
      const uint8_t result = static_cast<uint8_t>(readReg(rd) | k);
      writeReg(rd, result);
      setSimpleFlags(result);
      pc += 1;
      spend(1);
      continue;
    }

    // ---- IN ------------------------------------------------------------
    if ((w & 0xf800) == 0xb000) {
      const uint32_t rd = decodeRd(w);
      const uint32_t port = (w & 0x0f) | ((w & 0x600) >> 5);
      uint32_t val = 0;
      if (port == PINB) val = 0;
      else if (port == DDRB) val = 0;
      else if (port == PORTB) val = 0;
      else if (port == PINC) val = 0;
      else if (port == DDRC) val = 0;
      else if (port == PORTC) val = 0;
      else if (port == PIND) val = 0;
      else if (port == DDRD) val = 0;
      else if (port == PORTD) val = 0;
      else if (port == PORT_TCCR0A) val = tccr0a;
      else if (port == PORT_TCCR0B) val = tccr0b;
      else if (port == PORT_TCNT0) val = tcnt0;
      else if (port == PORT_OCR0A) val = ocr0a;
      else if (port == PORT_SREG) val = sreg;
      else if (port == PORT_TIMSK0) val = timsk0;
      else if (port == PORT_TIFR0) val = tifr0;
      else if (port == PORT_SPL) val = sp & 0xff;
      else if (port == PORT_SPH) val = (sp >> 8) & 0xff;
      else {
        return static_cast<int32_t>(pc); // trap to JS for unsupported ports
      }
      writeReg(rd, static_cast<uint8_t>(val));
      pc += 1;
      spend(1);
      continue;
    }

    // ---- OUT -----------------------------------------------------------
    if ((w & 0xf800) == 0xb800) {
      const uint32_t port = (w & 0x0f) | ((w & 0x600) >> 5);
      const uint32_t rr = decodeRd(w);
      const uint8_t val = readReg(rr);
      if (port == PORT_TCCR0A) {
        tccr0a = val;
      } else if (port == PORT_TCCR0B) {
        tccr0b = val;
      } else if (port == PORT_TCNT0) {
        tcnt0 = val & 0xff;
      } else if (port == PORT_OCR0A) {
        ocr0a = val & 0xff;
      } else if (port == PORT_SREG) {
        sreg = val;
      } else if (port == PORT_TIMSK0) {
        timsk0 = val;
      } else if (port == PORT_TIFR0) {
        tifr0 = static_cast<uint8_t>(tifr0 & ~val);
      } else if (port == PORT_SPL) {
        sp = static_cast<uint16_t>((sp & 0xff00) | (val & 0xff));
      } else if (port == PORT_SPH) {
        sp = static_cast<uint16_t>((sp & 0x00ff) | ((val & 0xff) << 8));
      } else {
        return static_cast<int32_t>(pc); // trap to JS for unsupported ports
      }
      pc += 1;
      spend(1);
      continue;
    }

    // ---- SBI / CBI -----------------------------------------------------
    if ((w & 0xff00) == 0x9a00) {
      // SBI
      const uint32_t isrPort = (w & 0xf8) >> 3;
      const uint8_t mask = static_cast<uint8_t>(1 << (w & 7));
      if (isrPort == PORT_TCCR0B) tccr0b |= mask;
      else if (isrPort == PORT_TIMSK0) timsk0 |= mask;
      else if (isrPort == PORT_TIFR0) tifr0 |= mask;
      else {
        return static_cast<int32_t>(pc);
      }
      pc += 1;
      spend(2);
      continue;
    }
    if ((w & 0xff00) == 0x9800) {
      // CBI
      const uint32_t isrPort = (w & 0xf8) >> 3;
      const uint8_t mask = static_cast<uint8_t>(1 << (w & 7));
      if (isrPort == PORT_TCCR0B) tccr0b = static_cast<uint8_t>(tccr0b & ~mask);
      else if (isrPort == PORT_TIMSK0) timsk0 = static_cast<uint8_t>(timsk0 & ~mask);
      else if (isrPort == PORT_TIFR0) tifr0 = static_cast<uint8_t>(tifr0 & ~mask);
      else {
        return static_cast<int32_t>(pc);
      }
      pc += 1;
      spend(2);
      continue;
    }

    // ---- LDZ / STZ -----------------------------------------------------
    if ((w & 0xfe0f) == 0x8000) {
      const uint32_t rd = decodeRd(w);
      const uint16_t z = (static_cast<uint16_t>(readReg(31)) << 8) | readReg(30);
      writeReg(rd, read8(STACK_BASE + z));
      pc += 1;
      spend(2);
      continue;
    }
    if ((w & 0xfe0f) == 0x8200) {
      const uint32_t rr = decodeRd(w);
      const uint16_t z = (static_cast<uint16_t>(readReg(31)) << 8) | readReg(30);
      write8(STACK_BASE + z, readReg(rr));
      pc += 1;
      spend(2);
      continue;
    }

    // ---- LDS / STS -----------------------------------------------------
    if ((w & 0xfe0f) == 0x9000) {
      const uint32_t rd = decodeRd(w);
      const int32_t addr = readFlash(pc + 1);
      if (addr < 0) return static_cast<int32_t>(pc);
      writeReg(rd, read8(STACK_BASE + static_cast<uint32_t>(addr)));
      pc += 2;
      spend(2);
      continue;
    }
    if ((w & 0xfe0f) == 0x9200) {
      const uint32_t rr = decodeRd(w);
      const int32_t addr = readFlash(pc + 1);
      if (addr < 0) return static_cast<int32_t>(pc);
      write8(STACK_BASE + static_cast<uint32_t>(addr), readReg(rr));
      pc += 2;
      spend(2);
      continue;
    }

    // ---- CALL ----------------------------------------------------------
    if ((w & 0xfe0e) == 0x940e) {
      const uint32_t kHigh = static_cast<uint32_t>((w & 1) << 16 | ((w & 0x1f0) << 13));
      const int32_t addrLow = readFlash(pc + 1);
      if (addrLow < 0) return static_cast<int32_t>(pc);
      const uint32_t k = kHigh | static_cast<uint32_t>(addrLow);
      const uint16_t retAddr = static_cast<uint16_t>(pc + 2);
      pushStack(retAddr);
      pc = k;
      spend(4);
      continue;
    }

    // ---- LPM -----------------------------------------------------------
    if ((w & 0xfe0f) == 0x9005) {
      const uint16_t z = (static_cast<uint16_t>(readReg(31)) << 8) | readReg(30);
      writeReg(0, read8(FLASH_BASE + (z << 1)));
      pc += 1;
      spend(3);
      continue;
    }
    if ((w & 0xfe0f) == 0x9006) {
      const uint32_t rd = decodeRd(w);
      uint16_t z = (static_cast<uint16_t>(readReg(31)) << 8) | readReg(30);
      writeReg(rd, read8(FLASH_BASE + (z << 1)));
      const uint16_t nz = (z + 1) & 0xffff;
      writeReg(30, static_cast<uint8_t>(nz & 0xff));
      writeReg(31, static_cast<uint8_t>((nz >> 8) & 0xff));
      pc += 1;
      spend(3);
      continue;
    }
    if ((w & 0xfe0f) == 0x9007) {
      const uint32_t rd = decodeRd(w);
      const uint16_t z = (static_cast<uint16_t>(readReg(31)) << 8) | readReg(30);
      writeReg(rd, read8(FLASH_BASE + (z << 1)));
      pc += 1;
      spend(3);
      continue;
    }

    // ---- LD / ST with X, Y, Z -----------------------------------------
    if ((w & 0xfe0f) == 0x900c) {
      const uint32_t rd = decodeRd(w);
      const uint16_t x = (static_cast<uint16_t>(readReg(27)) << 8) | readReg(26);
      writeReg(rd, read8(STACK_BASE + x));
      pc += 1;
      spend(2);
      continue;
    }
    if ((w & 0xfe0f) == 0x900d) {
      const uint32_t rd = decodeRd(w);
      uint16_t x = (static_cast<uint16_t>(readReg(27)) << 8) | readReg(26);
      writeReg(rd, read8(STACK_BASE + x));
      const uint16_t nx = (x + 1) & 0xffff;
      writeReg(26, static_cast<uint8_t>(nx & 0xff));
      writeReg(27, static_cast<uint8_t>((nx >> 8) & 0xff));
      pc += 1;
      spend(2);
      continue;
    }
    if ((w & 0xfe0f) == 0x900e) {
      const uint32_t rd = decodeRd(w);
      uint16_t x = (static_cast<uint16_t>(readReg(27)) << 8) | readReg(26);
      const uint16_t nx = (x - 1) & 0xffff;
      writeReg(26, static_cast<uint8_t>(nx & 0xff));
      writeReg(27, static_cast<uint8_t>((nx >> 8) & 0xff));
      x = nx;
      writeReg(rd, read8(STACK_BASE + x));
      pc += 1;
      spend(2);
      continue;
    }
    if ((w & 0xfe0f) == 0x900f) {
      const uint32_t rd = decodeRd(w);
      uint16_t z = (static_cast<uint16_t>(readReg(31)) << 8) | readReg(30);
      writeReg(rd, read8(STACK_BASE + z));
      const uint16_t nz = (z + 1) & 0xffff;
      writeReg(30, static_cast<uint8_t>(nz & 0xff));
      writeReg(31, static_cast<uint8_t>((nz >> 8) & 0xff));
      pc += 1;
      spend(2);
      continue;
    }
    if ((w & 0xfe0f) == 0x920d) {
      uint16_t x = (static_cast<uint16_t>(readReg(27)) << 8) | readReg(26);
      write8(STACK_BASE + x, readReg(0));
      const uint16_t nx = (x + 1) & 0xffff;
      writeReg(26, static_cast<uint8_t>(nx & 0xff));
      writeReg(27, static_cast<uint8_t>((nx >> 8) & 0xff));
      pc += 1;
      spend(2);
      continue;
    }
    if ((w & 0xfe0f) == 0x921d) {
      uint16_t y = (static_cast<uint16_t>(readReg(29)) << 8) | readReg(28);
      write8(STACK_BASE + y, readReg(0));
      const uint16_t ny = (y + 1) & 0xffff;
      writeReg(28, static_cast<uint8_t>(ny & 0xff));
      writeReg(29, static_cast<uint8_t>((ny >> 8) & 0xff));
      pc += 1;
      spend(2);
      continue;
    }
    if ((w & 0xfe0f) == 0x920e) {
      const uint16_t z = (static_cast<uint16_t>(readReg(31)) << 8) | readReg(30);
      write8(STACK_BASE + z, readReg(0));
      pc += 1;
      spend(2);
      continue;
    }
    if ((w & 0xfe0f) == 0x921e) {
      uint16_t z = (static_cast<uint16_t>(readReg(31)) << 8) | readReg(30);
      write8(STACK_BASE + z, readReg(0));
      const uint16_t nz = (z + 1) & 0xffff;
      writeReg(30, static_cast<uint8_t>(nz & 0xff));
      writeReg(31, static_cast<uint8_t>((nz >> 8) & 0xff));
      pc += 1;
      spend(2);
      continue;
    }

    // ---- LDD / STD -----------------------------------------------------
    if ((w & 0xd208) == 0x8008) {
      const uint32_t rd = (w & 0x1f0) >> 4;
      const uint16_t y = (static_cast<uint16_t>(readReg(29)) << 8) | readReg(28);
      const uint32_t disp = (w & 7) | ((w & 0xc00) >> 7) | ((w & 0x2000) >> 8);
      writeReg(rd, read8(STACK_BASE + ((y + disp) & 0xffff)));
      pc += 1;
      spend(2);
      continue;
    }
    if ((w & 0xd208) == 0x8000) {
      const uint32_t rd = (w & 0x1f0) >> 4;
      const uint16_t z = (static_cast<uint16_t>(readReg(31)) << 8) | readReg(30);
      const uint32_t disp = (w & 7) | ((w & 0xc00) >> 7) | ((w & 0x2000) >> 8);
      writeReg(rd, read8(STACK_BASE + ((z + disp) & 0xffff)));
      pc += 1;
      spend(2);
      continue;
    }
    if ((w & 0xd208) == 0x8208) {
      const uint32_t rr = (w & 0x1f0) >> 4;
      const uint16_t y = (static_cast<uint16_t>(readReg(29)) << 8) | readReg(28);
      const uint32_t disp = (w & 7) | ((w & 0xc00) >> 7) | ((w & 0x2000) >> 8);
      write8(STACK_BASE + ((y + disp) & 0xffff), readReg(rr));
      pc += 1;
      spend(2);
      continue;
    }
    if ((w & 0xd208) == 0x8200) {
      const uint32_t rr = (w & 0x1f0) >> 4;
      const uint16_t z = (static_cast<uint16_t>(readReg(31)) << 8) | readReg(30);
      const uint32_t disp = (w & 7) | ((w & 0xc00) >> 7) | ((w & 0x2000) >> 8);
      write8(STACK_BASE + ((z + disp) & 0xffff), readReg(rr));
      pc += 1;
      spend(2);
      continue;
    }

    // ---- NOP-like padding opcodes --------------------------------------
    if (w == 0x940c || w == 0x01fc || w == 0x9124 || w == 0x91b4 || w == 0x91d4 ||
        w == 0x932c) {
      pc += 1;
      spend(1);
      continue;
    }

    // Everything else: trap to JS.
    return static_cast<int32_t>(pc);
  }
  return -1;
}
