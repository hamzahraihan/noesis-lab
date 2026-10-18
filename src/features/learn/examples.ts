/**
 * Example sketches, each with the bench it needs.
 *
 * An example that assumes parts nobody has placed teaches the wrong thing twice:
 * once when the sketch silently does nothing, and again when the reader assumes
 * the API is broken. So an example here is the sketch *and* the wiring, and
 * picking one rebuilds the bench to match.
 *
 * The parts sit on the bench beside the breadboard rather than in it, because
 * every one of them is too large for a strip and because a module straddling
 * the board hides the holes the rest of the circuit uses.
 */

import { boardOption, type BoardId } from './boardRegistry';
import type { FirmwareLanguage } from '@/features/simulation';

export interface Example {
  readonly id: string;
  readonly name: string;
  /** What it demonstrates, in the voice the catalogue uses. */
  readonly note: string;
  readonly sketch: string;
}

export const BLINK_SKETCH = `#include <Arduino.h>
#include <Wire.h>

#define LED_PIN 2
#define OLED_ADDR 0x3C

int blinks = 0;

void oledCommand(int c) {
  Wire.beginTransmission(OLED_ADDR);
  Wire.write(0x00);
  Wire.write(c);
  Wire.endTransmission();
}

// A TFT command and its parameters share one chip-select window: the bytes
// after the command count as its parameters only while it is still selected.
void tftCommand(int command, int first, int second) {
  SPI.beginTransaction();
  SPI.transfer(command, 0);
  if (first >= 0) {
    SPI.transfer(first >> 8, 1);
    SPI.transfer(first & 255, 1);
  }
  if (second >= 0) {
    SPI.transfer(second >> 8, 1);
    SPI.transfer(second & 255, 1);
  }
  SPI.end();
}

// One RGB565 pixel, sent while a transfer is already open.
void tftPixel(int colour) {
  SPI.transfer(colour >> 8, 1);
  SPI.transfer(colour & 255, 1);
}

void setup() {
  pinMode(LED_PIN, OUTPUT);
  Serial.begin(115200);
  Serial.println("ESP32 online");

  Wire.begin(21, 22);
  oledCommand(0xAE);
  // Page addressing, so each frame writes where it is told rather than
  // carrying on from wherever the last one stopped.
  oledCommand(0x20); oledCommand(0x02);
  oledCommand(0x21); oledCommand(0x00); oledCommand(0x7F);
  oledCommand(0x22); oledCommand(0x00); oledCommand(0x07);
  oledCommand(0x81); oledCommand(0x9F);
  oledCommand(0xA1); oledCommand(0xA6);
  oledCommand(0xA8); oledCommand(0x3F);
  oledCommand(0xD3); oledCommand(0x00);
  oledCommand(0xD5); oledCommand(0x80);
  oledCommand(0xD9); oledCommand(0x22);
  oledCommand(0xDA); oledCommand(0x12);
  oledCommand(0xDB); oledCommand(0x20);
  oledCommand(0x8D); oledCommand(0x14);
  oledCommand(0xAF);

  // Bring up the TFT. Leaving D/C on the wrong pin turns every one of these
  // commands into pixel data, and the panel fills with noise instead of drawing.
  SPI.begin();
  tftCommand(0x01, -1, -1);
  delay(50);
  tftCommand(0x11, -1, -1);
  delay(120);
  tftCommand(0x3A, 0x0055, -1);
  tftCommand(0x29, -1, -1);
}

void loop() {
  digitalWrite(LED_PIN, HIGH);
  delay(400);
  digitalWrite(LED_PIN, LOW);
  delay(400);

  // A bar along the top of the OLED.
  oledCommand(0xB0); oledCommand(0x00); oledCommand(0x10);
  Wire.beginTransmission(OLED_ADDR);
  Wire.write(0x40);
  for (int i = 0; i < 40; i++) { Wire.write(0xFF); }
  Wire.endTransmission();

  // A bar along the top of the TFT: a 320-pixel window, forty of them lit.
  tftCommand(0x2A, 0x0000, 0x013F);
  tftCommand(0x2B, 0x0000, 0x00EF);
  SPI.beginTransaction();
  SPI.transfer(0x2C, 0);
  for (int i = 0; i < 40; i++) { tftPixel(0x001F); }
  for (int i = 0; i < 280; i++) { tftPixel(0x0000); }
  SPI.end();

  blinks++;
  Serial.print("blink ");
  Serial.println(blinks);
}
`;

const I2C_CLOCK_SKETCH = `#include <Arduino.h>
#include <Wire.h>

#define LED_PIN 2
#define RTC_ADDR 0x68

// The DS1307 keeps seconds through minutes, hours and date in BCD, so each
// byte is two digits packed into one. Dividing by 16 is the high digit.
int bcdToInt(byte bcd) {
  return (bcd >> 4) * 10 + (bcd & 15);
}

void setup() {
  pinMode(LED_PIN, OUTPUT);
  Serial.begin(115200);
  Wire.begin(21, 22);
  Serial.println("reading the clock");
}

void loop() {
  /*
   * Reading is two halves: a write points the device at a register, and a
   * requestFrom reads however many bytes from there. There is no read without a
   * pointer to read from, which is why the sketch cannot just ask for the time.
   */
  Wire.beginTransmission(RTC_ADDR);
  Wire.write(0x00);
  Wire.endTransmission();

  Wire.requestFrom(RTC_ADDR, 4);
  int seconds = bcdToInt(Wire.read());
  int minutes = bcdToInt(Wire.read());
  int hours = bcdToInt(Wire.read());

  /*
   * Every byte past what the device holds reads back as its own last byte,
   * because a read that runs off the end has no way to say so. Checking
   * available() first is how a sketch finds out it asked for too much.
   */
  if (Wire.available() != 1) { Serial.println("short read"); }

  Serial.print("clock ");
  Serial.print(hours);
  Serial.print(":");
  Serial.print(minutes);
  Serial.print(":");
  Serial.println(seconds);

  digitalWrite(LED_PIN, seconds % 2 == 0);
  delay(500);
}
`;

const LCD_SKETCH = `#include <Arduino.h>
#include <Wire.h>

#define LED_PIN 2
#define RTC_ADDR 0x68

int bcdToInt(byte bcd) {
  return (bcd >> 4) * 10 + (bcd & 15);
}

void setup() {
  pinMode(LED_PIN, OUTPUT);
  Serial.begin(115200);
  Wire.begin(21, 22);

  /*
   * The size comes first. A panel told the wrong geometry still answers: the
   * rows just land in the wrong place, which is why the second line of a 20x4
   * shows up over the first unless begin() says 20 4 rather than 16 2.
   */
  lcd.begin(16, 2);
  lcd.backlight();
  Serial.println("display up");
}

void loop() {
  Wire.beginTransmission(RTC_ADDR);
  Wire.write(0x00);
  Wire.endTransmission();
  Wire.requestFrom(RTC_ADDR, 3);
  int seconds = bcdToInt(Wire.read());
  int minutes = bcdToInt(Wire.read());
  int hours = bcdToInt(Wire.read());

  lcd.setCursor(0, 1);
  lcd.print("noesis bench");
  lcd.setCursor(0, 0);
  lcd.print(hours);
  lcd.print(":");
  lcd.print(minutes);
  lcd.print(":");
  lcd.print(seconds);

  Serial.print("displaying ");
  Serial.println(seconds);

  digitalWrite(LED_PIN, seconds % 2 == 0);
  delay(500);
}
`;

const SERVO_SKETCH = `#include <Arduino.h>

#define LED_PIN 2
#define HORN_PIN 19

void setup() {
  pinMode(LED_PIN, OUTPUT);
  Serial.begin(115200);
  servo.attach(HORN_PIN);
  servo.write(HORN_PIN, 90);
  Serial.println("horn centred");
}

void loop() {
  /*
   * A sweep between the stops rather than the full 0-180: a hobby servo cannot
   * reach either end, and asking for more drives it hard against the stop
   * without moving it any further. This sketch never asks.
   */
  int angles[4] = { 10, 90, 170, 90 };
  for (int step = 0; step < 4; step++) {
    servo.write(HORN_PIN, angles[step]);
    Serial.print("horn ");
    Serial.println(servo.read(HORN_PIN));
    digitalWrite(LED_PIN, step % 2 == 0);
    delay(600);
  }
}
`;

export const BLINK_EXAMPLE: Example = {
  id: 'blink',
  name: 'Blink, OLED and TFT',
  note: 'A blinking LED and a bar on each display, with every bus driven by hand.',
  sketch: BLINK_SKETCH,
};

export const I2C_CLOCK_EXAMPLE: Example = {
  id: 'i2c-clock',
  name: 'I2C read',
  note: 'Reads a real-time clock register by register, the way the datasheet says to.',
  sketch: I2C_CLOCK_SKETCH,
};

export const LCD_EXAMPLE: Example = {
  id: 'character-lcd',
  name: 'Character LCD',
  note: 'A clock on a character display. Six wires, not two, and the glass only lights if all six land.',
  sketch: LCD_SKETCH,
};

export const SERVO_EXAMPLE: Example = {
  id: 'servo',
  name: 'Servo sweep',
  note: 'Sweeps a horn between its end stops, which is not the same as 0 and 180.',
  sketch: SERVO_SKETCH,
};

export const EXAMPLES: readonly Example[] = [
  BLINK_EXAMPLE,
  I2C_CLOCK_EXAMPLE,
  LCD_EXAMPLE,
  SERVO_EXAMPLE,
];

/**
 * The sketch a Raspberry Pi bench opens on.
 *
 * A Pi runs Linux rather than a sketch, so the C++ that ships for every other
 * board cannot be what its bench starts with -- it would fail on the first line
 * for a reason that has nothing to do with the wiring. This is the gpiozero
 * version of the same blink: the same circuit, in the language the board
 * actually speaks.
 *
 * The LED is on GPIO 17 rather than GPIO 2. On every microcontroller here the
 * starter LED answers to pin 2, but a Pi's GPIO2 is the I2C data line, and the
 * starter bench already has a display on that bus.
 */
export const PI_BLINK_SKETCH = `from gpiozero import LED
import time

# GPIO 17, not GPIO 2: on this board pin 2 is the I2C data line.
led = LED(17)

while True:
    led.on()
    time.sleep(0.5)
    led.off()
    time.sleep(0.5)
`;

/**
 * The Nano RP2040 Connect's starter, in the language its firmware speaks.
 *
 * The engine boots the pinned MicroPython, so the library is `machine` and the
 * mounted entry is `main.py` -- gpiozero is a Raspberry Pi OS module and does
 * not exist on this firmware. The LED is GPIO 2, the pin `STARTER_WIRING` wires
 * to the starter LED for this board, and the print is the boot's proof in the
 * serial monitor: a console program shows its work there, not on the glass.
 */
export const PICO_BLINK_SKETCH = `from machine import Pin
import time

led = Pin(2, Pin.OUT)
print('pico online')

while True:
    led.value(1)
    time.sleep(0.5)
    led.value(0)
    time.sleep(0.5)
`;

/**
 * The sketch a bench opens with: the board's own language and idiom.
 *
 * One rule for the three places that seed a project -- mount, board switch and
 * language switch -- because a board that speaks MicroPython and a board that
 * speaks gpiozero both answer to `python`, and handing either the other's
 * sketch fails on the first line for a reason that has nothing to do with the
 * wiring.
 */
export function starterSketchFor(
  boardId: BoardId,
  language: FirmwareLanguage = boardOption(boardId).language,
): string {
  if (language !== 'python') return BLINK_SKETCH;
  return boardId === 'rp2040' ? PICO_BLINK_SKETCH : PI_BLINK_SKETCH;
}
