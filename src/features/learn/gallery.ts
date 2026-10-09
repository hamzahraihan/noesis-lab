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
import { part } from './exercises/shared';
import type { Simulation } from '@/features/bench';
import {
  ENTRY_BY_LANGUAGE,
  toSingleFileProject,
  type FirmwareLanguage,
  type FirmwareProject,
} from '@/features/simulation';

export interface GalleryBuild {
  readonly board: BoardId;
  /** Places the parts and runs the jumpers on that board's headers. */
  readonly setup: (simulation: Simulation) => void;
  /** The entry file's source (`main.ino` on Arduino builds). */
  readonly sketch: string;
  /**
   * Extra tabs merged with the entry as one multi-file project, Wokwi-style
   * (`config.h`, module `.h`/`.cpp`). Names must already be bench-legal
   * (lowercase); the entry keeps the `sketch` content so single-file builds
   * stay exactly as they are.
   */
  readonly files?: readonly { readonly name: string; readonly content: string }[];
}

/** The runnable firmware for a build: one multi-file project or one sketch. */
export function firmwareForBuild(build: GalleryBuild, language: FirmwareLanguage): FirmwareProject {
  if (!build.files || build.files.length === 0) return toSingleFileProject(build.sketch, language);
  const entry = ENTRY_BY_LANGUAGE[language];
  return {
    language,
    files: [{ name: entry, content: build.sketch }, ...build.files],
    activeName: entry,
  };
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
#include "config.h"
#include "button.h"
#include "clock.h"
#include "alarmtone.h"

// Alarm Clock with RTC — main tab.
//
// A multi-file port of urish's Wokwi "alarm-clock.ino" project
// (https://wokwi.com/projects/297787059514376717 — see
// docs/wokwi-alarm-clock-reference.md), rewritten for what this bench models:
//
// - No classes or structs: one module per tab as plain functions + globals.
// - No SevSeg library: the raw GPIO multiplex below, on the README pin
//   table (DIG D2-D5, A-G on D6-D12, colon CLN on D13, COM to 5V).
// - No RTClib: raw BCD reads over Wire in clock.cpp (USE_RTC 0 falls back
//   to millis time).
// - No tone(): the siren plays a customizable melody table in alarmtone.cpp.
// - The host owns the RTC time: Hour/Minute retune a persisted offset, and
//   the alarm itself persists in the DS1307 NVRAM bytes.

#define ST_CLOCK 0
#define ST_STATUS 1
#define ST_ALTIME 2
#define ST_RING 3
#define ST_SNOOZE 4

#define STATUS_MS 1000
#define ALTIME_MS 2500
#define SNOOZE_VIEW_MS 500

byte digitPins[4] = {2, 3, 4, 5};
byte segmentPins[7] = {6, 7, 8, 9, 10, 11, 12};
byte colonPin = 13;

int dspShow0 = 0;
int dspShow1 = 0;
int dspShow2 = 0;
int dspShow3 = 0;
byte dspDigit = 0;

byte appState = 0;
long appEntered = 0;
long appLastTick = 0;

// Integer tens without relying on float division.
int dspTens(int v) {
  return (v - (v % 10)) / 10;
}

// Standard 7-segment encoding in A-G bit order, plus the letters the
// status views need: 10 o, 11 n, 12 F, 13 dash, 14 blank.
int dspPatternFor(int d) {
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
  if (d == 10) return 0x5C;
  if (d == 11) return 0x54;
  if (d == 12) return 0x71;
  if (d == 13) return 0x40;
  return 0x00;
}

void dspSetSegments(byte pattern) {
  for (int i = 0; i < 7; i++) {
    digitalWrite(segmentPins[i], (pattern & (1 << i)) ? LOW : HIGH);
  }
}

void dspShow(int a, int b, int c, int d) {
  dspShow0 = a;
  dspShow1 = b;
  dspShow2 = c;
  dspShow3 = d;
}

int dspDigitValue(byte which) {
  if (which == 0) return dspShow0;
  if (which == 1) return dspShow1;
  if (which == 2) return dspShow2;
  return dspShow3;
}

void dspRefresh(int seconds) {
  for (int i = 0; i < 4; i++) digitalWrite(digitPins[i], LOW);
  byte pattern = dspPatternFor(dspDigitValue(dspDigit));
  dspSetSegments(pattern);
  // The colon blink: HHMM rolls once a minute, so the colon ticks every
  // second to prove the glass is alive. Active-low: LOW lights it.
  if (seconds % 2 == 0) {
    digitalWrite(colonPin, LOW);
  } else {
    digitalWrite(colonPin, HIGH);
  }
  digitalWrite(digitPins[dspDigit], HIGH);
  dspDigit = (dspDigit + 1) % 4;
}

void appEnter(byte s) {
  btnClearAll();
  appState = s;
  appEntered = millis();
}

void setup() {
  for (int i = 0; i < 4; i++) pinMode(digitPins[i], OUTPUT);
  for (int i = 0; i < 7; i++) pinMode(segmentPins[i], OUTPUT);
  pinMode(colonPin, OUTPUT);
  digitalWrite(colonPin, HIGH);
  buttonsBegin();
  btnSetRepeat(0, 500, 200);
  btnSetRepeat(1, 500, 200);
  btnSetRepeat(2, 1000, -1);
  toneBegin();
  Serial.begin(115200);
  Wire.begin();
  clkBegin();
  Serial.println("clock up");
  appEnter(ST_CLOCK);
}

void appTick() {
  // The alarm fires on its own, whatever view is showing.
  if (appState != ST_RING && clkDue() == 1) {
    Serial.println("ringing");
    appEnter(ST_RING);
  }

  if (appState == ST_CLOCK) {
    dspShow(dspTens(clkH), clkH % 10, dspTens(clkM), clkM % 10);
    if (btnPressed(0) == 1) clkAdjHour(1);
    if (btnPressed(1) == 1) clkAdjMin(1);
    byte tapClock = btnTap(2);
    if (tapClock == 1) {
      clkToggle();
      Serial.println("alarm toggled");
      appEnter(ST_STATUS);
    }
  } else if (appState == ST_STATUS) {
    if (clkEnabled == 1) {
      dspShow(14, 14, 10, 11);
    } else {
      dspShow(14, 10, 12, 12);
    }
    if (millis() - appEntered >= STATUS_MS) {
      if (clkEnabled == 1) {
        appEnter(ST_ALTIME);
      } else {
        appEnter(ST_CLOCK);
      }
    }
  } else if (appState == ST_ALTIME) {
    dspShow(dspTens(clkAlarmH), clkAlarmH % 10, dspTens(clkAlarmM), clkAlarmM % 10);
    if (btnPressed(0) == 1) {
      clkAlarmH = (clkAlarmH + 1) % 24;
      nvSave();
      appEntered = millis();
    }
    if (btnPressed(1) == 1) {
      clkAlarmM = (clkAlarmM + 1) % 60;
      nvSave();
      appEntered = millis();
    }
    byte tapAlarm = btnTap(2);
    if (tapAlarm == 1) appEnter(ST_CLOCK);
    if (millis() - appEntered >= ALTIME_MS) appEnter(ST_CLOCK);
  } else if (appState == ST_RING) {
    dspShow(dspTens(clkH), clkH % 10, dspTens(clkM), clkM % 10);
    byte tapRing = btnTap(2);
    if (tapRing == 2) {
      toneStop();
      clkStop();
      Serial.println("alarm stopped");
      appEnter(ST_CLOCK);
    } else if (tapRing == 1) {
      toneStop();
      clkSnooze();
      Serial.println("snoozed");
      appEnter(ST_SNOOZE);
    }
  } else if (appState == ST_SNOOZE) {
    dspShow(10, 10, 10, 10);
    if (millis() - appEntered >= SNOOZE_VIEW_MS) appEnter(ST_CLOCK);
  }
}

void loop() {
  // One digit per pass and no long delay anywhere: buttons are sampled every
  // ~20 ms of sim time, so a human tap always overlaps several samples.
  // (A delay(200) here used to blind the firmware for a wall-clock second or
  // more, and no tap could ever register.) Time-based work below runs at
  // 10 Hz; the siren tracks every pass so its steps stay even.
  dspRefresh(clkS);
  btnUpdate();
  if (appState == ST_RING) tonePlay();

  long now = millis();
  if (now - appLastTick >= 100) {
    appLastTick = now;
    clkRead();
    appTick();
    Serial.print("t=");
    Serial.print(clkH);
    Serial.print(":");
    Serial.print(clkM);
    Serial.print(":");
    Serial.println(clkS);
  }
  delay(20);
}
`,
      files: [
        {
          name: 'config.h',
          content: `#include <Arduino.h>
#include <Wire.h>

// Shared wiring and timings (urish's config.h, adapted: no libraries,
// default alarm 9:00, snooze 9 minutes).
#define RTC_ADDR 0x68
#define HOURS_BTN 14
#define MINS_BTN 15
#define ALARM_BTN 16
#define BUZZER_PIN 17

#define USE_RTC 1
#define SNOOZE_MIN 9
#define DEF_ALARM_H 9
#define DEF_ALARM_M 0
`,
        },
        {
          name: 'button.h',
          content: `// Debounced INPUT_PULLUP buttons with auto-repeat and long-press
// (urish's Button.h, as plain functions: this bench has no classes).
// 25 ms settles in about one loop pass, so quick taps register — the same
// figure the safe and reaction builds use.
#define BTN_DEBOUNCE_MS 25
#define BTN_LONG_MS 1000
#define BTN_HOURS 0
#define BTN_MINS 1
#define BTN_ALARM 2
`,
        },
        {
          name: 'button.cpp',
          content: `#include "button.h"
#include "config.h"

// One slot per button: raw and settled levels, when the raw last moved,
// when the hold started, when the next auto-repeat fires, and the repeat
// cadence (gap <= 0 means no repeat: press edge plus release verdict only).
byte btnPins[3] = {HOURS_BTN, MINS_BTN, ALARM_BTN};
byte btnRaw[3] = {1, 1, 1};
byte btnSettled[3] = {1, 1, 1};
long btnChanged[3] = {0, 0, 0};
long btnHoldStart[3] = {0, 0, 0};
long btnRepeatAt[3] = {0, 0, 0};
long btnRepDelay[3] = {500, 500, 1000};
long btnRepGap[3] = {200, 200, -1};
byte btnPressedFlag[3] = {0, 0, 0};
byte btnLongFlag[3] = {0, 0, 0};

void btnSetRepeat(byte w, long dly, long gap) {
  btnRepDelay[w] = dly;
  btnRepGap[w] = gap;
}

void buttonsBegin() {
  for (int i = 0; i < 3; i++) pinMode(btnPins[i], INPUT_PULLUP);
}

void btnUpdate() {
  long now = millis();
  for (int i = 0; i < 3; i++) {
    byte raw = digitalRead(btnPins[i]);
    if (raw != btnRaw[i]) {
      btnRaw[i] = raw;
      btnChanged[i] = now;
    }
    if (raw != btnSettled[i] && now - btnChanged[i] >= BTN_DEBOUNCE_MS) {
      btnSettled[i] = raw;
      if (raw == 0) {
        btnPressedFlag[i] = 1;
        btnHoldStart[i] = now;
        btnRepeatAt[i] = now + btnRepDelay[i];
        btnLongFlag[i] = 0;
      } else {
        if (now - btnHoldStart[i] >= BTN_LONG_MS) btnLongFlag[i] = 1;
      }
    }
    if (btnSettled[i] == 0 && btnRepGap[i] > 0 && now >= btnRepeatAt[i]) {
      btnPressedFlag[i] = 1;
      btnRepeatAt[i] = now + btnRepGap[i];
    }
  }
}

// Consumable press edge, including auto-repeat ticks. Hour/Minute adjust
// on every tick, so a held button runs through the numbers.
byte btnPressed(byte w) {
  if (btnPressedFlag[w] == 1) {
    btnPressedFlag[w] = 0;
    return 1;
  }
  return 0;
}

// Release verdict for the Alarm button: 2 is a long hold, 1 a short tap,
// 0 means still held or idle. Consumes whatever is pending.
byte btnTap(byte w) {
  if (btnLongFlag[w] == 1) {
    btnLongFlag[w] = 0;
    btnPressedFlag[w] = 0;
    return 2;
  }
  if (btnPressedFlag[w] == 1 && btnSettled[w] == 1) {
    btnPressedFlag[w] = 0;
    return 1;
  }
  return 0;
}

void btnClearAll() {
  for (int i = 0; i < 3; i++) {
    btnPressedFlag[i] = 0;
    btnLongFlag[i] = 0;
  }
}
`,
        },
        {
          name: 'clock.h',
          content: `// RTC clock, alarm state and DS1307 NVRAM persist
// (urish's Clock.h, as plain functions: no RTClib/DateTime here).
#define NV_ENABLE 8
#define NV_ALH 9
#define NV_ALM 10
#define NV_OFFLO 11
#define NV_OFFHI 12
#define NV_MAGIC 13
#define NV_MAGIC_VALUE 165
#define CLK_MAX_OFFSET 720
`,
        },
        {
          name: 'clock.cpp',
          content: `#include "clock.h"
#include "config.h"

// Shown time = RTC time + offset. The host owns the RTC registers, so the
// Hour/Minute buttons retune this offset (persisted) instead of rewriting
// time the next solve would take back.
byte clkAlarmH = 9;
byte clkAlarmM = 0;
byte clkEnabled = 0;
int clkOffset = 0;
byte clkH = 0;
byte clkM = 0;
byte clkS = 0;
long clkSnoozeUntil = 0;

int clkBcd(byte bcd) {
  return (bcd >> 4) * 10 + (bcd & 15);
}

void nvWriteByte(int addr, int val) {
  Wire.beginTransmission(RTC_ADDR);
  Wire.write(addr);
  Wire.write(val);
  Wire.endTransmission();
}

int nvReadByte(int addr) {
  Wire.beginTransmission(RTC_ADDR);
  Wire.write(addr);
  Wire.endTransmission();
  Wire.requestFrom(RTC_ADDR, 1);
  if (Wire.available() == 0) return -1;
  return Wire.read();
}

// Enable, alarm HH:MM and offset (biased +720 into two bytes) in NVRAM,
// sealed with a magic byte: a fresh chip reads all zeros, which would
// otherwise validate as a real -720 minute offset.
void nvSave() {
  int biased = clkOffset + CLK_MAX_OFFSET;
  nvWriteByte(NV_ENABLE, clkEnabled);
  nvWriteByte(NV_ALH, clkAlarmH);
  nvWriteByte(NV_ALM, clkAlarmM);
  nvWriteByte(NV_OFFLO, biased % 256);
  nvWriteByte(NV_OFFHI, (biased - (biased % 256)) / 256);
  nvWriteByte(NV_MAGIC, NV_MAGIC_VALUE);
}

void nvDefaults() {
  clkEnabled = 0;
  clkAlarmH = DEF_ALARM_H;
  clkAlarmM = DEF_ALARM_M;
  clkOffset = 0;
}

void nvLoad() {
  int magic = nvReadByte(NV_MAGIC);
  if (magic != NV_MAGIC_VALUE) {
    nvDefaults();
    return;
  }
  int en = nvReadByte(NV_ENABLE);
  int hh = nvReadByte(NV_ALH);
  int mm = nvReadByte(NV_ALM);
  int lo = nvReadByte(NV_OFFLO);
  int hi = nvReadByte(NV_OFFHI);
  if (en < 0 || en > 1 || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    nvDefaults();
    return;
  }
  if (lo < 0 || hi < 0) {
    nvDefaults();
    return;
  }
  int biased = hi * 256 + lo;
  if (biased > 2 * CLK_MAX_OFFSET) {
    nvDefaults();
    return;
  }
  clkEnabled = en;
  clkAlarmH = hh;
  clkAlarmM = mm;
  clkOffset = biased - CLK_MAX_OFFSET;
}

void clkBegin() {
  Wire.begin();
  nvLoad();
}

void clkRead() {
  int h = 0;
  int m = 0;
  int s = 0;
  if (USE_RTC == 1) {
    Wire.beginTransmission(RTC_ADDR);
    Wire.write(0x00);
    Wire.endTransmission();
    Wire.requestFrom(RTC_ADDR, 3);
    if (Wire.available() < 3) return;
    s = clkBcd(Wire.read());
    m = clkBcd(Wire.read());
    h = clkBcd(Wire.read());
  } else {
    long ms = millis();
    long tot = (ms - (ms % 1000)) / 1000;
    s = tot % 60;
    long tm = (tot - (tot % 60)) / 60;
    m = tm % 60;
    h = ((tm - (tm % 60)) / 60) % 24;
  }
  int total = h * 60 + m + clkOffset;
  if (total < 0) total = total + 1440;
  if (total >= 1440) total = total - 1440;
  clkS = s;
  clkM = total % 60;
  clkH = (total - (total % 60)) / 60;
}

void clkAdjHour(int d) {
  clkOffset = clkOffset + d * 60;
  if (clkOffset > CLK_MAX_OFFSET) clkOffset = CLK_MAX_OFFSET;
  if (clkOffset < -CLK_MAX_OFFSET) clkOffset = -CLK_MAX_OFFSET;
  nvSave();
}

void clkAdjMin(int d) {
  clkOffset = clkOffset + d;
  if (clkOffset > CLK_MAX_OFFSET) clkOffset = CLK_MAX_OFFSET;
  if (clkOffset < -CLK_MAX_OFFSET) clkOffset = -CLK_MAX_OFFSET;
  nvSave();
}

void clkToggle() {
  if (clkEnabled == 1) {
    clkEnabled = 0;
  } else {
    clkEnabled = 1;
  }
  nvSave();
}

byte clkDue() {
  if (clkEnabled == 0) return 0;
  if (millis() < clkSnoozeUntil) return 0;
  if (clkH == clkAlarmH && clkM == clkAlarmM) return 1;
  return 0;
}

void clkSnooze() {
  clkSnoozeUntil = millis() + SNOOZE_MIN * 60000;
  nvSave();
}

void clkStop() {
  clkEnabled = 0;
  nvSave();
}
`,
        },
        {
          name: 'alarmtone.h',
          content: `// Non-blocking melody siren (urish's AlarmTone.h: no tone() here, so each
// melody step holds the buzzer for one loop pass instead of 500 ms).
// 1 = sound on: edit the table to customize the alarm, even into melodies.
#define TONE_STEPS 8
`,
        },
        {
          name: 'alarmtone.cpp',
          content: `#include "alarmtone.h"
#include "config.h"

int toneMelody[8] = {1, 1, 0, 0, 1, 1, 0, 0};
int toneStep = 0;

void toneBegin() {
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);
}

// One melody step per loop pass: with the ~20 ms loop this beats roughly
// twice a second, alternating sound and silence through the table above.
void tonePlay() {
  byte level = toneMelody[toneStep % TONE_STEPS];
  toneStep = toneStep + 1;
  digitalWrite(BUZZER_PIN, level);
}

void toneStop() {
  digitalWrite(BUZZER_PIN, LOW);
}
`,
        },
      ],
  setup: (simulation) => {
    simulation.clearExampleParts();
    const supply = simulation.boardTerminal('5V');
    const ground = simulation.boardTerminal('GND');
    if (!supply || !ground) return;

    // One compact clock block, fully inside the initial viewport
    // (x -12..416): RTC + display share a top row below the breadboard,
    // three buttons form one control row beneath, buzzer closes the block.
    const BLOCK_X = 100;
    const BLOCK_Y = 70;
    simulation.placeExampleDevice('ds1307', BLOCK_X, BLOCK_Y, EXAMPLE_DEVICES, LCD_LINES);

    // 4-digit 7-segment display on the pin table: digit commons DIG1-DIG4
    // (device pins 14/11/10/6) on D2-D5, segments A-G (13/9/4/2/1/12/5) on
    // D6-D12, colon CLN (pin 8) on D13, COM (pin 7) to 5V. RTC on A4/A5,
    // buttons on A0-A2, buzzer on A3.
    const seg = simulation.addPart(part('4-Digit 7-Segment Display'), BLOCK_X + 35, BLOCK_Y);
    const segWires: Array<[string, string]> = [
      ['DIG1', 'D2'],
      ['DIG2', 'D3'],
      ['DIG3', 'D4'],
      ['DIG4', 'D5'],
      ['A', 'D6'],
      ['B', 'D7'],
      ['C', 'D8'],
      ['D', 'D9'],
      ['E', 'D10'],
      ['F', 'D11'],
      ['G', 'D12'],
      ['CLN', 'D13'],
    ];
    for (const [segPin, boardPin] of segWires) {
      const from = simulation.pinAt(seg, segPin);
      const to = simulation.boardTerminal(boardPin);
      if (!from || !to) return;
      simulation.routeWire(from, to);
    }
    {
      const com = simulation.pinAt(seg, 'COM');
      if (!com || !supply) return;
      simulation.routeWire(com, supply);
    }

    // Hours / Minutes / Alarm buttons: one leg to Ax, the other to ground.
    // The sketch uses the internal pull-ups, so a held button reads LOW.
    // One control row under the clock pair, 14mm pitch for 6mm bodies.
    const buttons: Array<[string, string]> = [
      ['Hours', 'A0'],
      ['Minutes', 'A1'],
      ['Alarm', 'A2'],
    ];
    buttons.forEach(([label, pin], index) => {
      const button = simulation.addPart(part('Tactile Button'), BLOCK_X + index * 14, BLOCK_Y + 30);
      const boardPin = simulation.boardTerminal(pin);
      const legA = simulation.pinAt(button, 'a');
      const legB = simulation.pinAt(button, 'b');
      if (!boardPin || !legA || !legB) return;
      simulation.routeWire(boardPin, legA);
      simulation.routeWire(legB, ground);
      void label;
    });

    const buzzer = simulation.addPart(part('Piezo Buzzer'), BLOCK_X, BLOCK_Y + 46);
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
    'The 7-segment display shows HHMM from the RTC, with the colon blinking once a second.',
    'Hour and Minute retune the shown time; Alarm arms or disarms, then shows " on"/" off" and the alarm time.',
    'At the alarm hour the siren sounds: a short Alarm press snoozes 9 minutes (four circles), a long hold stops it.',
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

    // One compact combination block: three code buttons in a row, the two
    // indicator pairs beside each other under them, buzzer closing the block.
    const BLOCK_X = 100;
    const BLOCK_Y = 70;
    const codePins = ['D2', 'D3', 'D4'];
    codePins.forEach((pin, index) => {
      const button = simulation.addPart(part('Tactile Button'), BLOCK_X + index * 14, BLOCK_Y);
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
      const led = simulation.addPart(part(ledName), BLOCK_X + index * 32, BLOCK_Y + 16);
      const resistor = simulation.addPart(
        part('220 Resistor'),
        BLOCK_X + 14 + index * 32,
        BLOCK_Y + 16,
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

    const buzzer = simulation.addPart(part('Piezo Buzzer'), BLOCK_X, BLOCK_Y + 38);
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

    // One compact dash block: servo top, slide pot under it, the three
    // indicator pairs in a row beneath.
    const BLOCK_X = 100;
    const BLOCK_Y = 70;
    simulation.placeExampleDevice('servo', BLOCK_X, BLOCK_Y, EXAMPLE_DEVICES, LCD_LINES);

    const pot = simulation.addPart(part('Slide Potentiometer'), BLOCK_X, BLOCK_Y + 38);
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
      const led = simulation.addPart(part(ledName), BLOCK_X + index * 30, BLOCK_Y + 74);
      const resistor = simulation.addPart(
        part('220 Resistor'),
        BLOCK_X + 14 + index * 30,
        BLOCK_Y + 74,
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

    // One compact ranger block: sonar and buzzer share the top row, the
    // three distance LEDs sit in a row beneath.
    const BLOCK_X = 100;
    const BLOCK_Y = 70;
    const sonar = simulation.addPart(part('Ultrasonic Sensor (HC-SR04)'), BLOCK_X, BLOCK_Y);
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

    const buzzer = simulation.addPart(part('Piezo Buzzer'), BLOCK_X + 52, BLOCK_Y);
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
      const led = simulation.addPart(part(ledName), BLOCK_X + index * 30, BLOCK_Y + 32);
      const resistor = simulation.addPart(
        part('220 Resistor'),
        BLOCK_X + 14 + index * 30,
        BLOCK_Y + 32,
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

    // One compact station block: the LCD on top, the sensor tucked under it.
    const BLOCK_X = 100;
    const BLOCK_Y = 70;
    simulation.placeExampleDevice('lcd1602', BLOCK_X, BLOCK_Y, EXAMPLE_DEVICES, LCD_LINES);

    const sensor = simulation.addPart(part('DHT22 Temp/Humidity'), BLOCK_X, BLOCK_Y + 42);
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

        // One compact timer block: button, LED and resistor side by side.
        const BLOCK_X = 100;
        const BLOCK_Y = 70;
        const button = simulation.addPart(part('Tactile Button'), BLOCK_X, BLOCK_Y);
        const boardPin = simulation.boardTerminal('D2');
        const legA = simulation.pinAt(button, 'a');
        const legB = simulation.pinAt(button, 'b');
        if (!boardPin || !legA || !legB) return;
        simulation.routeWire(boardPin, legA);
        simulation.routeWire(legB, ground);

        const led = simulation.addPart(part('Red LED'), BLOCK_X + 12, BLOCK_Y);
        const resistor = simulation.addPart(part('220 Resistor'), BLOCK_X + 26, BLOCK_Y);
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
