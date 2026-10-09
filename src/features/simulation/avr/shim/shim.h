// Shim core for the offline AVR build of the alarm-clock gallery sketch.
//
// What this is: the minimal Arduino-API surface the alarm sketch calls,
// implemented against the real Uno registers for GPIO and against the
// reserved SRAM trap addresses for everything the emulator cannot see as
// hardware. Serial bytes and Wire frames are written to the trap map below;
// the host (src/features/simulation/avr/trap.ts) forwards them to the serial
// buffer and the I2C bus. The trap addresses and the TX/RX framing are
// mirrored exactly from trap.ts — change one side and the other must follow.
//
// Link model: this header is included AFTER <Arduino.h>/<Wire.h> (directly,
// or for every translation unit at once via `-include shim.h`, which needs no
// source edits). The free functions keep the declarations <Arduino.h> gives
// them; the matching definitions in shim.cpp shadow the Arduino core archive
// at link time, the same way user sketches override weak core symbols. The
// Serial/Wire names are preprocessor-mapped to the trap classes below so no
// translation unit can bind the core HardwareSerial/TwoWire objects by
// accident: those drive real USART/TWI registers the emulator does not run,
// while the classes here drive the traps.
//
// Newline contract: println() terminates with '\n', NOT Arduino's '\r\n'.
// The bench serial sink (and the interpreter backend) splits lines on '\n',
// so the shim matches the interpreter byte for byte. Keep it that way.

#ifndef NOESIS_AVR_SHIM_H
#define NOESIS_AVR_SHIM_H

#include <Arduino.h>
#include <Wire.h>

#include <stddef.h>
#include <stdint.h>

// Reserved SRAM trap map. ATmega328P SRAM starts at 0x100, so these never
// collide with registers or IO space. They sit above the alarm firmware's
// .data/.bss (about 150 bytes of globals); keep firmware globals small or
// reserve this window in the link if the sketch grows.
//   0x1F0      Serial TX: one STS per character.
//   0x1F1-0x1F4 millis counter, little-endian 32-bit, read-only.
//   0x1F5      Wire TX framer: STS address, then count N, then N bytes.
//   0x1F9      Wire RX: STS address, then count; then one LDS per byte.
#define NOESIS_SHIM_SERIAL_TX_ADDR 0x1F0
#define NOESIS_SHIM_MILLIS_ADDR 0x1F1
#define NOESIS_SHIM_WIRE_TX_ADDR 0x1F5
#define NOESIS_SHIM_WIRE_RX_ADDR 0x1F9

#define NOESIS_SHIM_SERIAL_TX (*(volatile uint8_t *)NOESIS_SHIM_SERIAL_TX_ADDR)
#define NOESIS_SHIM_MILLIS_BYTES ((volatile const uint8_t *)NOESIS_SHIM_MILLIS_ADDR)
#define NOESIS_SHIM_WIRE_TX (*(volatile uint8_t *)NOESIS_SHIM_WIRE_TX_ADDR)
#define NOESIS_SHIM_WIRE_RX (*(volatile uint8_t *)NOESIS_SHIM_WIRE_RX_ADDR)

// Free-function subset. Declared by <Arduino.h>; defined in shim.cpp against
// real DDR/PORT/PIN registers (digital) and the trap map (timing). Listed
// here so the surface is reviewable in one place:
//   pinMode, digitalWrite, digitalRead, millis, delay.

#ifdef __cplusplus

// Serial replacement. Method set is exactly what the alarm sketch calls:
// begin/print/println. Numbers print decimal like the interpreter backend;
// println appends '\n' (see contract above).
class ShimSerialClass {
 public:
  void begin(unsigned long baud);
  size_t print(const char *value);
  size_t print(char value);
  size_t print(int value);
  size_t print(unsigned int value);
  size_t print(long value);
  size_t print(unsigned long value);
  size_t println();
  size_t println(const char *value);
  size_t println(char value);
  size_t println(int value);
  size_t println(unsigned int value);
  size_t println(long value);
  size_t println(unsigned long value);

 private:
  void putch(char c);
  size_t printSigned(long value);
  size_t printUnsigned(unsigned long value);
};

extern ShimSerialClass ShimSerial;
#define Serial ShimSerial

// Wire replacement. Method set is exactly what the alarm sketch calls:
// begin/beginTransmission/write/endTransmission/requestFrom/available/read.
// endTransmission emits one framed transaction (address, count, bytes) on
// the TX trap; requestFrom stages the response eagerly so available/read
// serve it from RAM, matching the trap's stage-then-pop protocol.
class ShimWireClass {
 public:
  void begin();
  void beginTransmission(uint8_t address);
  void beginTransmission(int address);
  size_t write(uint8_t value);
  size_t write(int value);
  uint8_t endTransmission();
  uint8_t requestFrom(uint8_t address, uint8_t count);
  uint8_t requestFrom(int address, int count);
  int available();
  int read();

 private:
  static const uint8_t kBufferLength = 32;
  uint8_t txAddress_;
  uint8_t txBuffer_[kBufferLength];
  uint8_t txLength_;
  uint8_t rxBuffer_[kBufferLength];
  uint8_t rxLength_;
  uint8_t rxIndex_;
};

extern ShimWireClass ShimWire;
#define Wire ShimWire

// Alarm firmware forward declarations. The gallery tab headers carry only
// wiring constants, so without these the main tab's calls into the module
// tabs would not resolve when arduino-cli compiles each tab separately.
// Declaring them here (force-included into every unit) keeps the staged
// gallery sources byte-identical while letting the multi-file build link.
// Globals live in their module tabs; the main tab only reads them.
void buttonsBegin();
void btnSetRepeat(byte w, long dly, long gap);
void btnUpdate();
byte btnPressed(byte w);
byte btnTap(byte w);
void btnClearAll();

void nvSave();
void nvLoad();
void clkBegin();
void clkRead();
void clkAdjHour(int d);
void clkAdjMin(int d);
void clkToggle();
byte clkDue();
void clkSnooze();
void clkStop();
extern byte clkAlarmH;
extern byte clkAlarmM;
extern byte clkEnabled;
extern int clkOffset;
extern byte clkH;
extern byte clkM;
extern byte clkS;
extern long clkSnoozeUntil;

void toneBegin();
void tonePlay();
void toneStop();

#endif // __cplusplus

#endif // NOESIS_AVR_SHIM_H
