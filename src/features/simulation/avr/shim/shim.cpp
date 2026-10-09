// Shim core implementation. See shim.h for the link model and contracts.
//
// GPIO goes to the real Uno registers so the emulator's port bridge observes
// genuine DDR/PORT edges. Timing and Serial/Wire go to the reserved SRAM trap
// map (0x1F0/0x1F1/0x1F5/0x1F9): under the emulator each access fires the
// host trap; on bare hardware these would be ordinary RAM writes.

#include "shim.h"

#include <avr/io.h>

// Digital pin to port resolution for the Uno: 0-7 -> PORTD, 8-13 -> PORTB,
// 14-19 -> PORTC. Out-of-range pins are ignored, matching the bench, which
// has no contact there to drive.
namespace {
struct GpioRegs {
  volatile uint8_t *ddr;
  volatile uint8_t *port;
  volatile uint8_t *pin;
  uint8_t bit;
};

bool resolvePin(uint8_t pin, GpioRegs *out) {
  if (pin <= 7) {
    out->ddr = &DDRD;
    out->port = &PORTD;
    out->pin = &PIND;
    out->bit = pin;
    return true;
  }
  if (pin <= 13) {
    out->ddr = &DDRB;
    out->port = &PORTB;
    out->pin = &PINB;
    out->bit = static_cast<uint8_t>(pin - 8);
    return true;
  }
  if (pin <= 19) {
    out->ddr = &DDRC;
    out->port = &PORTC;
    out->pin = &PINC;
    out->bit = static_cast<uint8_t>(pin - 14);
    return true;
  }
  return false;
}
}  // namespace

// First declared (via <Arduino.h>) with C linkage, so these plain
// definitions keep that linkage and shadow the core archive at link time.
void pinMode(uint8_t pin, uint8_t mode) {
  GpioRegs regs;
  if (!resolvePin(pin, &regs)) return;
  const uint8_t mask = static_cast<uint8_t>(1U << regs.bit);
  if (mode == OUTPUT) {
    *regs.ddr |= mask;
  } else {
    *regs.ddr &= static_cast<uint8_t>(~mask);
    if (mode == INPUT_PULLUP) {
      *regs.port |= mask;
    } else {
      *regs.port &= static_cast<uint8_t>(~mask);
    }
  }
}

void digitalWrite(uint8_t pin, uint8_t val) {
  GpioRegs regs;
  if (!resolvePin(pin, &regs)) return;
  const uint8_t mask = static_cast<uint8_t>(1U << regs.bit);
  if (val) {
    *regs.port |= mask;
  } else {
    *regs.port &= static_cast<uint8_t>(~mask);
  }
}

int digitalRead(uint8_t pin) {
  GpioRegs regs;
  if (!resolvePin(pin, &regs)) return LOW;
  return ((*regs.pin >> regs.bit) & 1U) ? HIGH : LOW;
}

// One 32-bit little-endian sample of the host millisecond counter.
static unsigned long readMillisOnce() {
  volatile const uint8_t *base = NOESIS_SHIM_MILLIS_BYTES;
  const unsigned long b0 = base[0];
  const unsigned long b1 = base[1];
  const unsigned long b2 = base[2];
  const unsigned long b3 = base[3];
  return (b3 << 24) | (b2 << 16) | (b1 << 8) | b0;
}

unsigned long millis() {
  // The host serves each byte from the live counter, so a tick landing
  // mid-sample could tear the value. Sample until two consecutive reads
  // agree; a sample costs a handful of cycles against 16000 per millisecond,
  // so this settles on the first retry in practice (bounded retries guard
  // against a pathological ever-advancing clock).
  unsigned long first = readMillisOnce();
  for (uint8_t attempt = 0; attempt < 4; ++attempt) {
    const unsigned long second = readMillisOnce();
    if (second == first) return first;
    first = second;
  }
  return first;
}

void delay(unsigned long ms) {
  // Busy-wait on the trap counter, exact under the host ms clock events:
  // unsigned subtraction stays correct across the 32-bit wrap.
  const unsigned long start = millis();
  while ((millis() - start) < ms) {
  }
}

// Serial: one trap write per character. Baud is accepted and ignored; there
// is no UART on the emulator side, only the trap.
void ShimSerialClass::begin(unsigned long baud) { (void)baud; }

void ShimSerialClass::putch(char c) {
  NOESIS_SHIM_SERIAL_TX = static_cast<uint8_t>(c);
}

size_t ShimSerialClass::print(const char *value) {
  size_t count = 0;
  if (value == 0) return 0;
  while (*value) {
    putch(*value++);
    ++count;
  }
  return count;
}

size_t ShimSerialClass::print(char value) {
  putch(value);
  return 1;
}

size_t ShimSerialClass::printUnsigned(unsigned long value) {
  char digits[11];
  uint8_t len = 0;
  if (value == 0) {
    putch('0');
    return 1;
  }
  while (value > 0) {
    digits[len++] = static_cast<char>('0' + (value % 10));
    value /= 10;
  }
  for (uint8_t i = len; i > 0; --i) putch(digits[i - 1]);
  return len;
}

size_t ShimSerialClass::printSigned(long value) {
  if (value < 0) {
    putch('-');
    // Negate in unsigned space so LONG_MIN stays exact.
    return printUnsigned(static_cast<unsigned long>(-(value + 1)) + 1UL) + 1;
  }
  return printUnsigned(static_cast<unsigned long>(value));
}

size_t ShimSerialClass::print(int value) { return printSigned(value); }
size_t ShimSerialClass::print(unsigned int value) { return printUnsigned(value); }
size_t ShimSerialClass::print(long value) { return printSigned(value); }
size_t ShimSerialClass::print(unsigned long value) { return printUnsigned(value); }

size_t ShimSerialClass::println() {
  putch('\n');
  return 1;
}

size_t ShimSerialClass::println(const char *value) { return print(value) + println(); }
size_t ShimSerialClass::println(char value) { return print(value) + println(); }
size_t ShimSerialClass::println(int value) { return print(value) + println(); }
size_t ShimSerialClass::println(unsigned int value) { return print(value) + println(); }
size_t ShimSerialClass::println(long value) { return print(value) + println(); }
size_t ShimSerialClass::println(unsigned long value) { return print(value) + println(); }

ShimSerialClass ShimSerial;

// Wire: frames transactions exactly as the host trap expects. TX buffers
// until endTransmission, then emits address, count, and bytes as consecutive
// trap writes (one host i2cWrite call). RX writes address and count, then
// drains the staged reply into RAM so available/read serve it locally.
void ShimWireClass::begin() {
  txAddress_ = 0;
  txLength_ = 0;
  rxLength_ = 0;
  rxIndex_ = 0;
}

void ShimWireClass::beginTransmission(uint8_t address) {
  txAddress_ = address;
  txLength_ = 0;
}

void ShimWireClass::beginTransmission(int address) {
  beginTransmission(static_cast<uint8_t>(address));
}

size_t ShimWireClass::write(uint8_t value) {
  if (txLength_ >= kBufferLength) return 0;
  txBuffer_[txLength_++] = value;
  return 1;
}

size_t ShimWireClass::write(int value) { return write(static_cast<uint8_t>(value)); }

uint8_t ShimWireClass::endTransmission() {
  NOESIS_SHIM_WIRE_TX = txAddress_;
  NOESIS_SHIM_WIRE_TX = txLength_;
  for (uint8_t i = 0; i < txLength_; ++i) NOESIS_SHIM_WIRE_TX = txBuffer_[i];
  txLength_ = 0;
  return 0;
}

uint8_t ShimWireClass::requestFrom(uint8_t address, uint8_t count) {
  if (count > kBufferLength) count = kBufferLength;
  NOESIS_SHIM_WIRE_RX = address;
  NOESIS_SHIM_WIRE_RX = count;
  rxLength_ = count;
  rxIndex_ = 0;
  for (uint8_t i = 0; i < count; ++i) rxBuffer_[i] = NOESIS_SHIM_WIRE_RX;
  return count;
}

uint8_t ShimWireClass::requestFrom(int address, int count) {
  if (count < 0) count = 0;
  return requestFrom(static_cast<uint8_t>(address), static_cast<uint8_t>(count));
}

int ShimWireClass::available() { return static_cast<int>(rxLength_) - static_cast<int>(rxIndex_); }

int ShimWireClass::read() {
  if (rxIndex_ >= rxLength_) return -1;
  return rxBuffer_[rxIndex_++];
}

ShimWireClass ShimWire;
