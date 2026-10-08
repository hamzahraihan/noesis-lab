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
import { EXAMPLE_DEVICES, LCD_LINES } from './examples';
import { PART_STEP, PART_X, PART_Y, part } from './exercises/shared';
import type { Simulation } from '@/features/bench';

export interface GalleryBuild {
  readonly board: BoardId;
  /** Places the parts and runs the jumpers on that board's headers. */
  readonly setup: (simulation: Simulation) => void;
  /** The sketch in that board's language (Python on the Pi). */
  readonly sketch: string;
}

export interface GalleryProject {
  readonly id: string;
  readonly title: string;
  readonly blurb: string;
  readonly parts: readonly {
    readonly name: string;
    readonly qty: number;
  }[];
  /** One validated build per board; v1 is Uno throughout. */
  readonly builds: readonly GalleryBuild[];
  /** What you should see when it is working. */
  readonly working: readonly string[];
}

/* ------------------------------------------------------------------ *
 * Alarm Clock with RTC — DS1307 + 4-digit 7-segment + buttons + buzzer
 * ------------------------------------------------------------------ */

const ALARM_CLOCK: GalleryProject = {
  id: 'alarm-clock',
  title: 'Alarm Clock with RTC',
  blurb:
    'A real-time clock chip keeps the time on a 4-digit 7-segment display. Set the alarm with the Hours and Minutes buttons, arm it with Alarm, and the buzzer sounds at the hour.',
  parts: [
    { name: 'DS1307 RTC Module', qty: 1 },
    { name: '4-Digit 7-Segment Display', qty: 1 },
    { name: 'Tactile Button', qty: 3 },
    { name: 'Piezo Buzzer', qty: 1 },
  ],
  builds: [
    {
      board: 'uno',
      sketch: `#include <Arduino.h>
#include <Wire.h>

#define RTC_ADDR 0x68
#define BUZZER_PIN 17
#define HOURS_BTN 14
#define MINS_BTN 15
#define ALARM_BTN 16

byte digitPins[4] = {2, 3, 4, 5};
byte segmentPins[8] = {6, 7, 13, 12, 11, 10, 9, 8};

int alarmH = 7;
int alarmM = 30;
byte alarmOn = 0;
byte setting = 0;
byte currentDigit = 0;
int show0 = 0;
int show1 = 0;
int show2 = 0;
int show3 = 0;
byte lastH = 1;
byte lastM = 1;
byte lastA = 1;

int bcdToInt(byte bcd) {
  return (bcd >> 4) * 10 + (bcd & 15);
}

byte patternFor(int d) {
  if (d == 0) return 0x3F;
  if (d == 1) return 0x06;
  if (d == 2) return 0x5B;
  if (d == 3) return 0x4F;
  if (d == 4) return 0x66;
  if (d == 5) return 0x6D;
  if (d == 6) return 0x7D;
  if (d == 7) return 0x07;
  if (d == 8) return 0x7F;
  if (d == 9) return 0x6F;
  return 0x00;
}

void setSegments(byte pattern) {
  for (int i = 0; i < 8; i++) {
    digitalWrite(segmentPins[i], (pattern & (1 << i)) ? LOW : HIGH);
  }
}

int digitValue(byte which) {
  if (which == 0) return show0;
  if (which == 1) return show1;
  if (which == 2) return show2;
  return show3;
}

void refreshDisplay() {
  for (int i = 0; i < 4; i++) digitalWrite(digitPins[i], LOW);
  byte pattern = patternFor(digitValue(currentDigit));
  setSegments(pattern);
  digitalWrite(digitPins[currentDigit], HIGH);
  currentDigit = (currentDigit + 1) % 4;
}

void setup() {
  for (int i = 0; i < 4; i++) pinMode(digitPins[i], OUTPUT);
  for (int i = 0; i < 8; i++) pinMode(segmentPins[i], OUTPUT);
  pinMode(HOURS_BTN, INPUT_PULLUP);
  pinMode(MINS_BTN, INPUT_PULLUP);
  pinMode(ALARM_BTN, INPUT_PULLUP);
  pinMode(BUZZER_PIN, OUTPUT);
  Serial.begin(115200);
  Wire.begin();
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

  byte h = digitalRead(HOURS_BTN);
  if (h == 0 && lastH == 1 && setting == 1) {
    alarmH = alarmH + 1;
    if (alarmH >= 24) alarmH = 0;
  }
  lastH = h;

  byte m = digitalRead(MINS_BTN);
  if (m == 0 && lastM == 1 && setting == 1) {
    alarmM = alarmM + 1;
    if (alarmM >= 60) alarmM = 0;
  }
  lastM = m;

  byte a = digitalRead(ALARM_BTN);
  if (a == 0 && lastA == 1) {
    if (setting == 1) {
      setting = 0;
      alarmOn = 1;
    } else {
      setting = 1;
    }
    digitalWrite(BUZZER_PIN, LOW);
  }
  lastA = a;

  if (setting == 1) {
    show0 = (alarmH / 10) % 10;
    show1 = alarmH % 10;
    show2 = (alarmM / 10) % 10;
    show3 = alarmM % 10;
  } else {
    show0 = (hours / 10) % 10;
    show1 = hours % 10;
    show2 = (minutes / 10) % 10;
    show3 = minutes % 10;
  }

  byte ringing = 0;
  if (alarmOn == 1 && setting == 0 && hours == alarmH && minutes == alarmM) ringing = 1;
  digitalWrite(BUZZER_PIN, ringing == 1 && seconds % 2 == 0);

  Serial.print("t=");
  Serial.print(hours);
  Serial.print(":");
  Serial.print(minutes);
  Serial.print(":");
  Serial.println(seconds);

  // One full multiplex cycle; the engine latches every digit while its
  // common is asserted, and the last-driven digit stays lit through the
  // delay below, so the glass holds a steady reading.
  for (int i = 0; i < 4; i++) {
    refreshDisplay();
    delayMicroseconds(250);
  }
  delay(200);
}
`,
  setup: (simulation) => {
    simulation.clearExampleParts();
    const supply = simulation.boardTerminal('5V');
    const ground = simulation.boardTerminal('GND');
    if (!supply || !ground) return;

    simulation.placeExampleDevice('ds1307', PART_X, PART_Y, EXAMPLE_DEVICES, LCD_LINES);

    // 4-digit 7-segment display: digit commons D1-D4, then segments A-G, DP.
    const seg = simulation.addPart(part('4-Digit 7-Segment Display'), PART_X, PART_Y + PART_STEP);
    const segWires: Array<[string, string]> = [
      ['DIG1', 'D2'],
      ['DIG2', 'D3'],
      ['DIG3', 'D4'],
      ['DIG4', 'D5'],
      ['A', 'D6'],
      ['B', 'D7'],
      ['DP', 'D8'],
      ['G', 'D9'],
      ['F', 'D10'],
      ['E', 'D11'],
      ['D', 'D12'],
      ['C', 'D13'],
    ];
    for (const [segPin, boardPin] of segWires) {
      const from = simulation.pinAt(seg, segPin);
      const to = simulation.boardTerminal(boardPin);
      if (!from || !to) return;
      simulation.routeWire(from, to);
    }

    // Hours / Minutes / Alarm buttons: one leg to Ax, the other to ground.
    // The sketch uses the internal pull-ups, so a held button reads LOW.
    const buttons: Array<[string, string]> = [
      ['Hours', 'A0'],
      ['Minutes', 'A1'],
      ['Alarm', 'A2'],
    ];
    buttons.forEach(([label, pin], index) => {
      const button = simulation.addPart(part('Tactile Button'), PART_X, PART_Y + (2 + index) * PART_STEP);
      const boardPin = simulation.boardTerminal(pin);
      const legA = simulation.pinAt(button, 'a');
      const legB = simulation.pinAt(button, 'b');
      if (!boardPin || !legA || !legB) return;
      simulation.routeWire(boardPin, legA);
      simulation.routeWire(legB, ground);
      void label;
    });

    const buzzer = simulation.addPart(part('Piezo Buzzer'), PART_X, PART_Y + 5 * PART_STEP);
    const buzzPin = simulation.boardTerminal('A3');
    const positive = simulation.pinAt(buzzer, 'positive');
    const negative = simulation.pinAt(buzzer, 'negative');
    if (!buzzPin || !positive || !negative) return;
    simulation.routeWire(buzzPin, positive);
    simulation.routeWire(negative, ground);
    },
  },
  ],
  working: [
    'The 7-segment display shows HHMM from the RTC, ticking once a minute.',
    'Press Alarm to set the alarm time with Hours and Minutes, press Alarm again to arm it.',
    'The buzzer beeps when the clock reaches the armed alarm time.',
  ],
};

/* ------------------------------------------------------------------ *
 * Electronic Safe — three buttons, two LEDs, one buzzer
 *
 * No keypad reads exist in the firmware, so the code is three buttons in
 * order (A, C, B) rather than a 4x4 matrix. Each button gets the Module 1
 * debounce — a level is believed only once it holds still — because a safe
 * that counts bounce counts wrong codes.
 * ------------------------------------------------------------------ */

const SAFE: GalleryProject = {
  id: 'safe',
  title: 'Electronic Safe',
  blurb:
    'Three buttons are the combination dial: enter A, C, B in order to unlock. A wrong digit buzzes and the attempt resets.',
  parts: [
    { name: 'Tactile Button', qty: 3 },
    { name: 'Red LED', qty: 1 },
    { name: 'Green LED', qty: 1 },
    { name: '220 Resistor', qty: 2 },
    { name: 'Piezo Buzzer', qty: 1 },
  ],
  builds: [
    {
      board: 'uno',
      sketch: `#include <Arduino.h>

byte BTN_A = 2;
byte BTN_B = 3;
byte BTN_C = 4;
byte LED_RED = 7;
byte LED_GREEN = 8;
byte BUZZER = 9;

byte FIRST = 2;
byte SECOND = 4;
byte THIRD = 3;

int pos = 0;

byte rawA = HIGH;
byte settledA = HIGH;
unsigned long changedA = 0;
byte rawB = HIGH;
byte settledB = HIGH;
unsigned long changedB = 0;
byte rawC = HIGH;
byte settledC = HIGH;
unsigned long changedC = 0;

unsigned long DEBOUNCE_MS = 25;
unsigned long UNLOCK_MS = 2000;
unsigned long unlockedAt = 0;

byte expected() {
  if (pos == 0) { return FIRST; }
  if (pos == 1) { return SECOND; }
  return THIRD;
}

void buzz() {
  for (int i = 0; i < 3; i++) {
    digitalWrite(BUZZER, HIGH);
    delay(120);
    digitalWrite(BUZZER, LOW);
    delay(120);
  }
}

void unlock() {
  digitalWrite(LED_RED, LOW);
  digitalWrite(LED_GREEN, HIGH);
  unlockedAt = millis();
  Serial.println("unlocked");
}

void press(byte pin) {
  if (unlockedAt != 0) { return; }
  if (pin == expected()) {
    pos = pos + 1;
    Serial.print("digit ok ");
    Serial.println(pos);
    if (pos >= 3) {
      pos = 0;
      unlock();
    }
  } else {
    Serial.println("wrong");
    buzz();
    pos = 0;
  }
}

void setup() {
  pinMode(BTN_A, INPUT_PULLUP);
  pinMode(BTN_B, INPUT_PULLUP);
  pinMode(BTN_C, INPUT_PULLUP);
  pinMode(LED_RED, OUTPUT);
  pinMode(LED_GREEN, OUTPUT);
  pinMode(BUZZER, OUTPUT);
  digitalWrite(LED_RED, HIGH);
  digitalWrite(LED_GREEN, LOW);
  Serial.begin(115200);
  Serial.println("locked");
}

void loop() {
  unsigned long now = millis();

  if (unlockedAt != 0 && now - unlockedAt >= UNLOCK_MS) {
    unlockedAt = 0;
    digitalWrite(LED_RED, HIGH);
    digitalWrite(LED_GREEN, LOW);
    Serial.println("locked");
  }

  byte raw = digitalRead(BTN_A);
  if (raw != rawA) { rawA = raw; changedA = now; }
  if (raw != settledA && now - changedA >= DEBOUNCE_MS) {
    settledA = raw;
    if (settledA == LOW) { press(BTN_A); }
  }

  raw = digitalRead(BTN_B);
  if (raw != rawB) { rawB = raw; changedB = now; }
  if (raw != settledB && now - changedB >= DEBOUNCE_MS) {
    settledB = raw;
    if (settledB == LOW) { press(BTN_B); }
  }

  raw = digitalRead(BTN_C);
  if (raw != rawC) { rawC = raw; changedC = now; }
  if (raw != settledC && now - changedC >= DEBOUNCE_MS) {
    settledC = raw;
    if (settledC == LOW) { press(BTN_C); }
  }
}
`,
  setup: (simulation) => {
    simulation.clearExampleParts();
    const supply = simulation.boardTerminal('5V');
    const ground = simulation.boardTerminal('GND');
    if (!supply || !ground) return;

    // The three code buttons, each: one leg to its pin, one to ground. The
    // sketch uses the internal pull-ups, so a held button reads LOW.
    const codePins = ['D2', 'D3', 'D4'];
    codePins.forEach((pin, index) => {
      const button = simulation.addPart(part('Tactile Button'), PART_X, PART_Y + index * PART_STEP);
      const boardPin = simulation.boardTerminal(pin);
      const legA = simulation.pinAt(button, 'a');
      const legB = simulation.pinAt(button, 'b');
      if (!boardPin || !legA || !legB) return;
      simulation.routeWire(boardPin, legA);
      simulation.routeWire(legB, ground);
    });

    // Locked/unlocked indicators, sink-wired like every exercise LED.
    const aspects = [
      { led: 'Red LED', pin: 'D7' },
      { led: 'Green LED', pin: 'D8' },
    ];
    aspects.forEach(({ led: ledName, pin }, index) => {
      const led = simulation.addPart(part(ledName), PART_X, PART_Y + (3 + index) * PART_STEP);
      const resistor = simulation.addPart(
        part('220 Resistor'),
        PART_X + 62,
        PART_Y + (3 + index) * PART_STEP,
      );
      const boardPin = simulation.boardTerminal(pin);
      const anode = simulation.pinAt(led, 'anode');
      const cathode = simulation.pinAt(led, 'cathode');
      const legA = simulation.pinAt(resistor, 'a');
      const legB = simulation.pinAt(resistor, 'b');
      if (!boardPin || !anode || !cathode || !legA || !legB) return;
      simulation.routeWire(supply, anode);
      simulation.routeWire(cathode, legA);
      simulation.routeWire(legB, boardPin);
    });

    const buzzer = simulation.addPart(part('Piezo Buzzer'), PART_X, PART_Y + 5 * PART_STEP);
    const buzzPin = simulation.boardTerminal('D9');
    const positive = simulation.pinAt(buzzer, 'positive');
    const negative = simulation.pinAt(buzzer, 'negative');
    if (!buzzPin || !positive || !negative) return;
    simulation.routeWire(buzzPin, positive);
    simulation.routeWire(negative, ground);
    },
  },
  ],
  working: [
    'The red LED is lit while locked; nothing else happens until three digits land.',
    'A, then C, then B turns the green LED on for two seconds and prints "unlocked".',
    'Any wrong digit buzzes three times and the attempt starts over.',
  ],
};

/* ------------------------------------------------------------------ *
 * Servo Dashboard — slide pot, hobby servo, three-LED bar
 * ------------------------------------------------------------------ */

const DASHBOARD: GalleryProject = {
  id: 'dashboard',
  title: 'Servo Dashboard',
  blurb:
    'A slide potentiometer becomes a steering wheel: the servo horn follows the knob and three LEDs show which third of the travel it is in.',
  parts: [
    { name: 'Slide Potentiometer', qty: 1 },
    { name: 'Hobby Servo', qty: 1 },
    { name: 'Green LED', qty: 1 },
    { name: 'Yellow LED', qty: 1 },
    { name: 'Red LED', qty: 1 },
    { name: '220 Resistor', qty: 3 },
  ],
  builds: [
    {
      board: 'uno',
      sketch: `#include <Arduino.h>

byte KNOB_PIN = 14;
byte HORN_PIN = 19;
byte LED_LOW = 6;
byte LED_MID = 7;
byte LED_HIGH = 8;

void setup() {
  servo.attach(HORN_PIN);
  servo.write(HORN_PIN, 90);
  pinMode(LED_LOW, OUTPUT);
  pinMode(LED_MID, OUTPUT);
  pinMode(LED_HIGH, OUTPUT);
  Serial.begin(115200);
  Serial.println("dashboard up");
}

void loop() {
  int raw = analogRead(KNOB_PIN);
  int angle = map(raw, 0, 1023, 10, 170);
  servo.write(HORN_PIN, angle);

  digitalWrite(LED_LOW, raw < 341);
  digitalWrite(LED_MID, raw >= 341 && raw < 682);
  digitalWrite(LED_HIGH, raw >= 682);

  Serial.print("knob ");
  Serial.print(raw);
  Serial.print(" horn ");
  Serial.println(servo.read(HORN_PIN));
  delay(200);
}
`,
  setup: (simulation) => {
    simulation.clearExampleParts();
    const supply = simulation.boardTerminal('5V');
    const ground = simulation.boardTerminal('GND');
    if (!supply || !ground) return;

    simulation.placeExampleDevice('servo', PART_X, PART_Y, EXAMPLE_DEVICES, LCD_LINES);

    const pot = simulation.addPart(part('Slide Potentiometer'), PART_X, PART_Y + PART_STEP);
    const knob = simulation.boardTerminal('A0');
    const endA = simulation.pinAt(pot, 'endA');
    const wiper = simulation.pinAt(pot, 'wiper');
    const endB = simulation.pinAt(pot, 'endB');
    if (!knob || !endA || !wiper || !endB) return;
    simulation.routeWire(supply, endA);
    simulation.routeWire(endB, ground);
    simulation.routeWire(wiper, knob);

    const aspects = [
      { led: 'Green LED', pin: 'D6' },
      { led: 'Yellow LED', pin: 'D7' },
      { led: 'Red LED', pin: 'D8' },
    ];
    aspects.forEach(({ led: ledName, pin }, index) => {
      const led = simulation.addPart(part(ledName), PART_X, PART_Y + (2 + index) * PART_STEP);
      const resistor = simulation.addPart(
        part('220 Resistor'),
        PART_X + 62,
        PART_Y + (2 + index) * PART_STEP,
      );
      const boardPin = simulation.boardTerminal(pin);
      const anode = simulation.pinAt(led, 'anode');
      const cathode = simulation.pinAt(led, 'cathode');
      const legA = simulation.pinAt(resistor, 'a');
      const legB = simulation.pinAt(resistor, 'b');
      if (!boardPin || !anode || !cathode || !legA || !legB) return;
      simulation.routeWire(supply, anode);
      simulation.routeWire(cathode, legA);
      simulation.routeWire(legB, boardPin);
    });
    },
  },
  ],
  working: [
    'The horn tracks the knob from end stop to end stop, never asked past 10–170.',
    'Exactly one of the three LEDs is lit, marking the third of the travel.',
    'The serial monitor reports both numbers: the knob reading and the horn angle.',
  ],
};

/* ------------------------------------------------------------------ *
 * Parking Sensor — sonar, buzzer, three-LED distance bar
 * ------------------------------------------------------------------ */

const PARKING: GalleryProject = {
  id: 'parking',
  title: 'Parking Sensor',
  blurb:
    'An ultrasonic ranger watches the bench: LEDs mark far, near, and too close, and the buzzer complains inside 30 cm. Turn the distance knob to drive closer.',
  parts: [
    { name: 'Ultrasonic Sensor (HC-SR04)', qty: 1 },
    { name: 'Piezo Buzzer', qty: 1 },
    { name: 'Green LED', qty: 1 },
    { name: 'Yellow LED', qty: 1 },
    { name: 'Red LED', qty: 1 },
    { name: '220 Resistor', qty: 3 },
  ],
  builds: [
    {
      board: 'uno',
      sketch: `#include <Arduino.h>

byte PIN_TRIG = 6;
byte PIN_ECHO = 7;
byte BUZZER = 9;
byte LED_FAR = 10;
byte LED_MID = 11;
byte LED_NEAR = 12;

long ECHO_TIMEOUT_US = 25000;

void setup() {
  pinMode(PIN_TRIG, OUTPUT);
  digitalWrite(PIN_TRIG, LOW);
  pinMode(PIN_ECHO, INPUT);
  pinMode(BUZZER, OUTPUT);
  pinMode(LED_FAR, OUTPUT);
  pinMode(LED_MID, OUTPUT);
  pinMode(LED_NEAR, OUTPUT);
  Serial.begin(115200);
  Serial.println("parking up");
}

void loop() {
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);

  long us = pulseIn(PIN_ECHO, HIGH, ECHO_TIMEOUT_US);
  long cm = us / 58;

  Serial.print("cm ");
  Serial.println(cm);

  digitalWrite(LED_FAR, us != 0);
  digitalWrite(LED_MID, us != 0 && cm < 100);
  digitalWrite(LED_NEAR, us != 0 && cm < 30);

  if (us != 0 && cm < 30) {
    digitalWrite(BUZZER, HIGH);
    delay(120);
    digitalWrite(BUZZER, LOW);
    delay(120);
  } else {
    delay(240);
  }
}
`,
  setup: (simulation) => {
    simulation.clearExampleParts();
    const supply = simulation.boardTerminal('5V');
    const ground = simulation.boardTerminal('GND');
    if (!supply || !ground) return;

    const sonar = simulation.addPart(part('Ultrasonic Sensor (HC-SR04)'), PART_X, PART_Y);
    const sonarVcc = simulation.pinAt(sonar, 'VCC');
    const sonarTrig = simulation.pinAt(sonar, 'TRIG');
    const sonarEcho = simulation.pinAt(sonar, 'ECHO');
    const sonarGnd = simulation.pinAt(sonar, 'GND');
    const trig = simulation.boardTerminal('D6');
    const echo = simulation.boardTerminal('D7');
    if (!sonarVcc || !sonarTrig || !sonarEcho || !sonarGnd || !trig || !echo) return;
    simulation.routeWire(supply, sonarVcc);
    simulation.routeWire(ground, sonarGnd);
    simulation.routeWire(trig, sonarTrig);
    simulation.routeWire(echo, sonarEcho);

    const buzzer = simulation.addPart(part('Piezo Buzzer'), PART_X, PART_Y + PART_STEP);
    const buzzPin = simulation.boardTerminal('D9');
    const positive = simulation.pinAt(buzzer, 'positive');
    const negative = simulation.pinAt(buzzer, 'negative');
    if (!buzzPin || !positive || !negative) return;
    simulation.routeWire(buzzPin, positive);
    simulation.routeWire(negative, ground);

    const aspects = [
      { led: 'Green LED', pin: 'D10' },
      { led: 'Yellow LED', pin: 'D11' },
      { led: 'Red LED', pin: 'D12' },
    ];
    aspects.forEach(({ led: ledName, pin }, index) => {
      const led = simulation.addPart(part(ledName), PART_X, PART_Y + (2 + index) * PART_STEP);
      const resistor = simulation.addPart(
        part('220 Resistor'),
        PART_X + 62,
        PART_Y + (2 + index) * PART_STEP,
      );
      const boardPin = simulation.boardTerminal(pin);
      const anode = simulation.pinAt(led, 'anode');
      const cathode = simulation.pinAt(led, 'cathode');
      const legA = simulation.pinAt(resistor, 'a');
      const legB = simulation.pinAt(resistor, 'b');
      if (!boardPin || !anode || !cathode || !legA || !legB) return;
      simulation.routeWire(supply, anode);
      simulation.routeWire(cathode, legA);
      simulation.routeWire(legB, boardPin);
    });
    },
  },
  ],
  working: [
    'The serial monitor reports centimetres that follow the distance knob.',
    'Green means something is out there, yellow inside a metre, red inside 30 cm.',
    'Inside 30 cm the buzzer beeps twice a second; a timed-out echo reads 0 and lights nothing.',
  ],
};

/* ------------------------------------------------------------------ *
 * Weather Station — DHT22 + LCD1602
 * ------------------------------------------------------------------ */

const WEATHER: GalleryProject = {
  id: 'weather',
  title: 'Weather Station',
  blurb:
    'A temperature-humidity sensor reports to a character LCD and the serial log. Turn the knobs on the part — or warm it with a fingertip on the bench — and watch both numbers move.',
  parts: [
    { name: 'DHT22 Temp/Humidity', qty: 1 },
    { name: 'LCD 16x2 (HD44780)', qty: 1 },
  ],
  builds: [
    {
      board: 'uno',
      sketch: `#include <Arduino.h>

byte SENSOR_PIN = 10;

void setup() {
  Serial.begin(115200);
  dht.begin(SENSOR_PIN);
  lcd.begin(16, 2);
  lcd.backlight();
  Serial.println("weather up");
}

void loop() {
  float temperature = dht.temperature(SENSOR_PIN);
  float humidity = dht.humidity(SENSOR_PIN);

  int percent = humidity;
  if (percent < 0) { percent = 0; }
  if (percent > 100) { percent = 100; }

  lcd.setCursor(0, 0);
  lcd.print("t ");
  lcd.print(temperature);
  lcd.print("C");
  lcd.setCursor(0, 1);
  lcd.print("rh ");
  lcd.print(percent);
  lcd.print("%");

  Serial.print("t ");
  Serial.print(temperature);
  Serial.print(" C rh ");
  Serial.print(percent);
  Serial.println(" %");
  delay(2000);
}
`,
  setup: (simulation) => {
    simulation.clearExampleParts();
    const supply = simulation.boardTerminal('5V');
    const ground = simulation.boardTerminal('GND');
    if (!supply || !ground) return;

    simulation.placeExampleDevice('lcd1602', PART_X, PART_Y, EXAMPLE_DEVICES, LCD_LINES);

    const sensor = simulation.addPart(part('DHT22 Temp/Humidity'), PART_X, PART_Y + PART_STEP);
    const data = simulation.boardTerminal('D10');
    const vcc = simulation.pinAt(sensor, 'VCC');
    const sda = simulation.pinAt(sensor, 'SDA');
    const gnd = simulation.pinAt(sensor, 'GND');
    if (!data || !vcc || !sda || !gnd) return;
    simulation.routeWire(supply, vcc);
    simulation.routeWire(ground, gnd);
    simulation.routeWire(data, sda);
    },
  },
  ],
  working: [
    'The LCD shows temperature on line one and humidity on line two.',
    'Turning the part knobs moves both numbers within a couple of seconds.',
    'The serial monitor logs one line per reading, never a scroll of repeats.',
  ],
};

/* ------------------------------------------------------------------ *
 * Reaction Timer — one button, one LED, one latency number
 * ------------------------------------------------------------------ */

const REACTION: GalleryProject = {
  id: 'reaction',
  title: 'Reaction Timer',
  blurb:
    'Press to arm, wait for the light, then press as fast as you can: the serial monitor reports your latency in milliseconds. Jump the gun and it calls the false start.',
  parts: [
    { name: 'Tactile Button', qty: 1 },
    { name: 'Red LED', qty: 1 },
    { name: '220 Resistor', qty: 1 },
  ],
  builds: [
    {
      board: 'uno',
      sketch: `#include <Arduino.h>

byte BTN = 2;
byte LED = 8;

byte raw = HIGH;
byte settled = HIGH;
unsigned long changedAt = 0;

unsigned long DEBOUNCE_MS = 25;

byte state = 0;
unsigned long t0 = 0;
unsigned long waitMs = 0;

void setup() {
  pinMode(BTN, INPUT_PULLUP);
  pinMode(LED, OUTPUT);
  Serial.begin(115200);
  Serial.println("press to arm");
}

void loop() {
  unsigned long now = millis();

  byte level = digitalRead(BTN);
  if (level != raw) { raw = level; changedAt = now; }
  if (level != settled && now - changedAt >= DEBOUNCE_MS) {
    settled = level;
    if (settled == LOW) {
      if (state == 0) {
        state = 1;
      } else if (state == 2) {
        Serial.println("false start");
        digitalWrite(LED, LOW);
        state = 0;
        Serial.println("press to arm");
      } else if (state == 3) {
        Serial.print("latency ");
        Serial.print(now - t0);
        Serial.println(" ms");
        digitalWrite(LED, LOW);
        state = 4;
      }
    } else {
      if (state == 1) {
        state = 2;
        t0 = now;
        waitMs = 2000 + (now % 3000);
      } else if (state == 4) {
        state = 0;
        Serial.println("press to arm");
      }
    }
  }

  if (state == 2 && now - t0 >= waitMs) {
    state = 3;
    t0 = now;
    digitalWrite(LED, HIGH);
  }
}
`,
      setup: (simulation) => {
        simulation.clearExampleParts();
        const supply = simulation.boardTerminal('5V');
        const ground = simulation.boardTerminal('GND');
        if (!supply || !ground) return;

        const button = simulation.addPart(part('Tactile Button'), PART_X, PART_Y);
        const boardPin = simulation.boardTerminal('D2');
        const legA = simulation.pinAt(button, 'a');
        const legB = simulation.pinAt(button, 'b');
        if (!boardPin || !legA || !legB) return;
        simulation.routeWire(boardPin, legA);
        simulation.routeWire(legB, ground);

        const led = simulation.addPart(part('Red LED'), PART_X, PART_Y + PART_STEP);
        const resistor = simulation.addPart(part('220 Resistor'), PART_X + 62, PART_Y + PART_STEP);
        const ledPin = simulation.boardTerminal('D8');
        const anode = simulation.pinAt(led, 'anode');
        const cathode = simulation.pinAt(led, 'cathode');
        const resA = simulation.pinAt(resistor, 'a');
        const resB = simulation.pinAt(resistor, 'b');
        if (!ledPin || !anode || !cathode || !resA || !resB) return;
        simulation.routeWire(supply, anode);
        simulation.routeWire(cathode, resA);
        simulation.routeWire(resB, ledPin);
      },
    },
  ],
  working: [
    'Press once to arm; the light comes on two to five seconds later.',
    'The serial monitor reports your latency in milliseconds on a clean run.',
    'Pressing early prints "false start" and the round restarts.',
  ],
};

export const GALLERY: readonly GalleryProject[] = [ALARM_CLOCK, SAFE, DASHBOARD, PARKING, WEATHER, REACTION];

export function galleryById(id: string): GalleryProject | null {
  return GALLERY.find((entry) => entry.id === id) ?? null;
}

export function buildFor(project: GalleryProject, board: BoardId): GalleryBuild | null {
  return project.builds.find((build) => build.board === board) ?? null;
}

export function boardsFor(project: GalleryProject): readonly BoardId[] {
  return project.builds.map((build) => build.board);
}
