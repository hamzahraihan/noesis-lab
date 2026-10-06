/**
 * The project gallery: runnable builds, each with the bench it needs.
 *
 * Same vocabulary as the exercises (`setup` wires the circuit, `sketch` is
 * what runs on it) minus the curriculum fields — a project is a destination,
 * not a lesson, so it has no level, no hints, and no worked solution. The
 * validation tests hold every entry to the same bar as an exercise: the
 * sketch must parse, the setup must wire real contacts, the parts must
 * exist in the catalogue.
 */

import type { BoardId } from './boardRegistry';
import { PART_STEP, PART_X, PART_Y, part } from './exercises/shared';
import type { Simulation } from './simulation';

export interface GalleryProject {
  readonly id: string;
  readonly title: string;
  readonly blurb: string;
  /** Boards this project runs on; v1 is Uno throughout. */
  readonly boards: readonly BoardId[];
  readonly parts: readonly {
    readonly name: string;
    readonly qty: number;
  }[];
  /** Places the parts and runs the jumpers this project needs. */
  readonly setup: (simulation: Simulation) => void;
  /** The sketch the bench runs. */
  readonly sketch: string;
  /** What you should see when it is working. */
  readonly working: readonly string[];
}

/* ------------------------------------------------------------------ *
 * Alarm Clock with RTC — DS1307 + LCD1602 + heartbeat LED
 * ------------------------------------------------------------------ */

const ALARM_CLOCK: GalleryProject = {
  id: 'alarm-clock',
  title: 'Alarm Clock with RTC',
  blurb:
    'A real-time clock chip keeps the time and a character LCD shows it, ticking once a second while an LED beats along.',
  boards: ['uno'],
  parts: [
    { name: 'DS1307 RTC Module', qty: 1 },
    { name: 'LCD 16x2 (HD44780)', qty: 1 },
    { name: 'Red LED', qty: 1 },
    { name: '220 Resistor', qty: 1 },
  ],
  sketch: `#include <Arduino.h>
#include <Wire.h>

#define LED_PIN 2
#define RTC_ADDR 0x68

int bcdToInt(byte bcd) {
  return (bcd >> 4) * 10 + (bcd & 15);
}

void setup() {
  pinMode(LED_PIN, OUTPUT);
  Serial.begin(115200);
  Wire.begin();
  lcd.begin(16, 2);
  lcd.backlight();
  Serial.println("clock up");
}

void loop() {
  Wire.beginTransmission(RTC_ADDR);
  Wire.write(0x00);
  Wire.endTransmission();
  Wire.requestFrom(RTC_ADDR, 3);
  int seconds = bcdToInt(Wire.read());
  int minutes = bcdToInt(Wire.read());
  int hours = bcdToInt(Wire.read());

  lcd.setCursor(0, 0);
  lcd.print(hours);
  lcd.print(":");
  lcd.print(minutes);
  lcd.print(":");
  lcd.print(seconds);
  lcd.setCursor(0, 1);
  lcd.print("alarm 07:30");

  digitalWrite(LED_PIN, seconds % 2 == 0);
  delay(500);
}
`,
  working: [
    'The LCD counts seconds on its top line with "alarm 07:30" below.',
    'The LED flips with every even second.',
    'The serial monitor logs "clock up" once, then stays quiet — the glass is the output here.',
  ],
  setup: (simulation) => {
    simulation.clearExampleParts();
    const supply = simulation.boardTerminal('5V');
    const ground = simulation.boardTerminal('GND');
    if (!supply || !ground) return;

    simulation.placeExampleDevice('ds1307', PART_X, PART_Y);
    simulation.placeExampleDevice('lcd1602', PART_X, PART_Y + PART_STEP);

    const led = simulation.addPart(part('Red LED'), PART_X, PART_Y + 2 * PART_STEP);
    const resistor = simulation.addPart(part('220 Resistor'), PART_X + 62, PART_Y + 2 * PART_STEP);
    const board = simulation.boardTerminal('D2');
    const anode = simulation.pinAt(led, 'anode');
    const cathode = simulation.pinAt(led, 'cathode');
    const legA = simulation.pinAt(resistor, 'a');
    const legB = simulation.pinAt(resistor, 'b');
    if (!board || !anode || !cathode || !legA || !legB) return;

    simulation.routeWire(supply, anode);
    simulation.routeWire(cathode, legA);
    simulation.routeWire(legB, board);
  },
};

export const GALLERY: readonly GalleryProject[] = [ALARM_CLOCK];

export function galleryById(id: string): GalleryProject | null {
  return GALLERY.find((entry) => entry.id === id) ?? null;
}
