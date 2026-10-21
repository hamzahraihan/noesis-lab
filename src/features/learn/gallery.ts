/**
 * The project gallery: runnable builds, each with the bench it needs.
 *
 * Same vocabulary as the exercises (`circuit` names the wiring, `sketch` is
 * what runs on it) minus the curriculum fields — a project is a destination,
 * not a lesson, so it has no level, no hints, and no worked solution. The
 * validation tests hold every entry to the same bar as an exercise: the
 * sketch must parse, the circuit must wire real contacts, the parts must
 * exist in the catalogue.
 */

import type { BoardId } from './boardRegistry';
import { CIRCUITS } from './circuits';
import {
  ENTRY_BY_LANGUAGE,
  toSingleFileProject,
  type CircuitDocument,
  type FirmwareLanguage,
  type FirmwareProject,
  type ProjectLibrary,
} from '@/features/simulation';

export interface GalleryBuild {
  readonly board: BoardId;
  /** Build flavor on one board (`'library'`); absent means the default build. */
  readonly variant?: string;
  /** Backend this build needs; default `'interpreter'`. */
  readonly execution?: 'interpreter' | 'avr' | 'rp2040' | 'esp32';
  /**
   * `'live'` when this build's sketch talks to a real host (`net/live-hosts`).
   *
   * Opt-in per build on purpose: a fetch leaves the machine, so it is a
   * decision this repository makes when it publishes a build -- never something
   * a link or a sketch can switch on.
   */
  readonly network?: 'live';
  /** The circuit this build needs, as a document (see `circuits/`). */
  readonly circuit: CircuitDocument;
  /** The entry file's source (`main.ino` on Arduino builds). */
  readonly sketch: string;
  /**
   * Extra tabs merged with the entry as one multi-file project, Wokwi-style
   * (`config.h`, module `.h`/`.cpp`). Names must already be bench-legal
   * (lowercase); the entry keeps the `sketch` content so single-file builds
   * stay exactly as they are.
   */
  readonly files?: readonly { readonly name: string; readonly content: string }[];
  /**
   * Declared Arduino libraries, carried into the bench project. Versions stay
   * unpinned here, so the manifest defaults apply at fetch time.
   */
  readonly libraries?: readonly ProjectLibrary[];
}

/** The runnable firmware for a build: one multi-file project or one sketch. */
export function firmwareForBuild(build: GalleryBuild, language: FirmwareLanguage): FirmwareProject {
  if (!build.files || build.files.length === 0) {
    const single = toSingleFileProject(build.sketch, language);
    return build.libraries === undefined ? single : { ...single, libraries: build.libraries };
  }
  const entry = ENTRY_BY_LANGUAGE[language];
  return {
    language,
    files: [{ name: entry, content: build.sketch }, ...build.files],
    activeName: entry,
    ...(build.libraries === undefined ? {} : { libraries: build.libraries }),
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
// (https://wokwi.com/projects/297787059514376717), rewritten for what this
// bench models:
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
      // The lineage of this port: urish's Wokwi original drives the glass
      // through SevSeg and the RTC through RTClib. The sketch above
      // reimplements both raw (GPIO multiplex, BCD over Wire), and these
      // declarations name that reference — versions unpinned, so the manifest
      // defaults apply. The sources hash covers files only, so the committed
      // HEX still applies to the declared build.
      libraries: [
        { name: 'SevSeg', source: 'provided' },
        { name: 'RTClib', source: 'provided' },
      ],
      /*
       * The block is laid out for the initial viewport (x -12..416): RTC and
       * display share the top row below the breadboard, three buttons form a
       * control row under them, and the buzzer closes the block. The display's
       * fan-out and the button/buzzer runs are routed through the clear corridor
       * left of the RTC (see the `bends` in `circuits/alarm-clock.json`).
       */
      circuit: CIRCUITS['alarm-clock'],
    },
    {
      board: 'uno',
      variant: 'library',
      execution: 'avr',
      sketch: `#include <SevSeg.h>
#include "Button.h"
#include "AlarmTone.h"
#include "Clock.h"
#include "config.h"

const int COLON_PIN = 13;
const int SPEAKER_PIN = A3;

Button hourButton(A0);
Button minuteButton(A1);
Button alarmButton(A2);

AlarmTone alarmTone;
Clock clock;
SevSeg sevseg;

enum DisplayState {
  DisplayClock,
  DisplayAlarmStatus,
  DisplayAlarmTime,
  DisplayAlarmActive,
  DisplaySnooze,
};

DisplayState displayState = DisplayClock;
long lastStateChange = 0;

void changeDisplayState(DisplayState newValue) {
  displayState = newValue;
  lastStateChange = millis();
}

long millisSinceStateChange() {
  return millis() - lastStateChange;
}

void setColon(bool value) {
  digitalWrite(COLON_PIN, value ? LOW : HIGH);
}

void displayTime() {
  DateTime now = clock.now();
  bool blinkState = now.second() % 2 == 0;
  sevseg.setNumber(now.hour() * 100 + now.minute());
  setColon(blinkState);
}

void clockState() {
  displayTime();

  if (alarmButton.read() == Button::RELEASED && clock.alarmActive()) {
    // Read alarmButton has_changed() to clear its state
    alarmButton.has_changed();
    changeDisplayState(DisplayAlarmActive);
    return;
  }

  if (hourButton.pressed()) {
    clock.incrementHour();
  }
  if (minuteButton.pressed()) {
    clock.incrementMinute();
  }
  if (alarmButton.pressed()) {
    clock.toggleAlarm();
    changeDisplayState(DisplayAlarmStatus);
  }
}

void alarmStatusState() {
  setColon(false);
  sevseg.setChars(clock.alarmEnabled() ? " on" : " off");
  if (millisSinceStateChange() > ALARM_STATUS_DISPLAY_TIME) {
    changeDisplayState(clock.alarmEnabled() ? DisplayAlarmTime : DisplayClock);
    return;
  }
}

void alarmTimeState() {
  DateTime alarm = clock.alarmTime();
  sevseg.setNumber(alarm.hour() * 100 + alarm.minute(), -1);

  if (millisSinceStateChange() > ALARM_HOUR_DISPLAY_TIME || alarmButton.pressed()) {
    changeDisplayState(DisplayClock);
    return;
  }

  if (hourButton.pressed()) {
    clock.incrementAlarmHour();
    lastStateChange = millis();
  }
  if (minuteButton.pressed()) {
    clock.incrementAlarmMinute();
    lastStateChange = millis();
  }
  if (alarmButton.pressed()) {
    changeDisplayState(DisplayClock);
  }
}

void alarmState() {
  displayTime();

  if (alarmButton.read() == Button::RELEASED) {
    alarmTone.play();
  }
  if (alarmButton.pressed()) {
    alarmTone.stop();
  }
  if (alarmButton.released()) {
    alarmTone.stop();
    bool longPress = alarmButton.repeat_count() > 0;
    if (longPress) {
      clock.stopAlarm();
      changeDisplayState(DisplayClock);
    } else {
      clock.snooze();
      changeDisplayState(DisplaySnooze);
    }
  }
}

void snoozeState() {
  sevseg.setChars("****");
  if (millisSinceStateChange() > SNOOZE_DISPLAY_TIME) {
    changeDisplayState(DisplayClock);
    return;
  }
}

void setup() {
  Serial.begin(115200);

  clock.begin();

  hourButton.begin();
  hourButton.set_repeat(500, 200);

  minuteButton.begin();
  minuteButton.set_repeat(500, 200);

  alarmButton.begin();
  alarmButton.set_repeat(1000, -1);

  alarmTone.begin(SPEAKER_PIN);

  pinMode(COLON_PIN, OUTPUT);

  byte digits = 4;
  byte digitPins[] = {2, 3, 4, 5};
  byte segmentPins[] = {6, 7, 8, 9, 10, 11, 12};
  bool resistorsOnSegments = false;
  bool updateWithDelays = false;
  bool leadingZeros = true;
  bool disableDecPoint = true;
  sevseg.begin(DISPLAY_TYPE, digits, digitPins, segmentPins, resistorsOnSegments,
               updateWithDelays, leadingZeros, disableDecPoint);
  sevseg.setBrightness(90);
}

void loop() {
  sevseg.refreshDisplay();

  switch (displayState) {
    case DisplayClock:
      clockState();
      break;

    case DisplayAlarmStatus:
      alarmStatusState();
      break;

    case DisplayAlarmTime:
      alarmTimeState();
      break;

    case DisplayAlarmActive:
      alarmState();
      break;

    case DisplaySnooze:
      snoozeState();
      break;
  }
}
`,
      files: [
        {
          name: 'config.h',
          content: `/**
   Arduino Digital Alarm Clock

   Copyright (C) 2020, Uri Shaked.
   Released under the MIT License.

   Clock Configuration File.
*/

#ifndef __CONFIG_H__
#define __CONFIG_H__

/**
   Change to 0 for running without an external RTC (Real time clock)
*/
#define USE_RTC 1

/**
   Your 7-Segment display type: COMMON_ANODE or COMMON_CATHODE
*/
#define DISPLAY_TYPE COMMON_ANODE

/**
   For how long should we show the alarm status (on/off)?
*/
const int ALARM_STATUS_DISPLAY_TIME = 1000; /* ms */

/**
   For how long should we show the alarm hour?
*/
const int ALARM_HOUR_DISPLAY_TIME = 2500; /* ms */

/**
   For how long should we display the snooze screen?
*/
const int SNOOZE_DISPLAY_TIME = 500; /* ms */

/**
   How many minutes to snooze the alarm for?
*/
const int SNOOZE_TIME = 9; /* minutes */

/**
   The default Alarm hour (for non-RTC mode)
*/
const int DEFAULT_ALARM_HOUR = 9;

#endif /* __CONFIG_H__ */`,
        },
        {
          name: 'button.h',
          content: `/*
	Button - a small library for Arduino to handle button debouncing

	MIT licensed.
*/

#ifndef Button_h
#define Button_h
#include "Arduino.h"

class Button
{
	public:
		Button(uint8_t pin, uint16_t debounce_ms = 100);
		void begin();
		bool read();
		bool toggled();
		bool pressed();
		bool released();
		bool has_changed();
		uint16_t repeat_count();
		void set_repeat(int16_t delay_ms, int16_t repeat_ms);

		const static bool PRESSED = LOW;
		const static bool RELEASED = HIGH;

	private:
		uint16_t repeats_since_press();

		uint8_t  _pin;
		uint16_t _delay;
		bool     _state;
		uint32_t _ignore_until;
		bool     _has_changed;
		uint16_t _reported_repeats;
		int16_t  _repeat_delay_ms;
		int16_t  _repeat_ms;
};

#endif`,
        },
        {
          name: 'clock.h',
          content: `#ifndef __CLOCK_H__
#define __CLOCK_H__

#include <RTClib.h>
#include "config.h"

enum AlarmState {
  ALARM_DISABLED,
  ALARM_OFF,
  ALARM_ACTIVE,
  ALARM_SNOOZED,
  ALARM_STOPPED,
};

class Clock {
public:
  Clock();
  void begin();

  /* Clock management */
  DateTime now();
  void incrementMinute();
  void incrementHour();

  /* Alarm Management */
  bool alarmEnabled();
  DateTime alarmTime();
  bool alarmActive();
  void toggleAlarm();
  void snooze();
  void stopAlarm();
  void incrementAlarmHour();
  void incrementAlarmMinute();

protected:
  bool _isAlarmDueTime();

  #if USE_RTC
    RTC_DS1307 _rtc;
  #else /* USE_RTC */
    RTC_Millis _rtc;
  #endif /* USE_RTC */

  byte _alarm_hour;
  byte _alarm_minute;
  AlarmState _alarm_state;
  unsigned long _alarm_snooze_time;
};

#endif /* __CLOCK_H__ */`,
        },
        {
          name: 'alarmtone.h',
          content: `#ifndef __ALARM_TONE_H__
#define __ALARM_TONE_H__

class AlarmTone {
  public:
    AlarmTone();
    void begin(uint8_t pin);
    void play();
    void stop();

  private:
    uint8_t _pin;
    bool _playing;
    uint8_t _tone_index;
    unsigned long _last_tone_time;
};

#endif /* __ALARM_TONE_H */`,
        },
        {
          name: 'button.cpp',
          content: `/*
	Button - a small library for Arduino to handle button debouncing

	MIT licensed.
*/

#include "Button.h"
#include <Arduino.h>

Button::Button(uint8_t pin, uint16_t debounce_ms)
:  _pin(pin)
,  _delay(debounce_ms)
,  _state(HIGH)
,  _ignore_until(0)
,  _has_changed(false)
,  _reported_repeats(0)
,  _repeat_delay_ms(-1)
,  _repeat_ms(-1)
{
}

void Button::begin()
{
	pinMode(_pin, INPUT_PULLUP);
}

//
// public methods
//

bool Button::read()
{
	// ignore pin changes until after this delay time
	if (_ignore_until > millis())
	{
		// ignore any changes during this period
	}

	// pin has changed
	else if (digitalRead(_pin) != _state)
	{
		_state = !_state;

		if (_state == RELEASED)
		{
			_reported_repeats = repeats_since_press();
		}

		else
		{
			_reported_repeats = 0;
		}

		_ignore_until = millis() + _delay;
		_has_changed = true;
	}

	return _state;
}

// has the button been toggled from on -> off, or vice versa
bool Button::toggled()
{
	read();
	return has_changed();
}

// mostly internal, tells you if a button has changed after calling the read() function
bool Button::has_changed()
{
	if (_has_changed)
	{
		_has_changed = false;
		return true;
	}
	return false;
}

// how many repeated press events occured since the button was pressed
uint16_t Button::repeat_count()
{
	return _state == PRESSED ? repeats_since_press() : _reported_repeats;
}

// has the button gone from off -> on or pressed repeatedly
bool Button::pressed()
{
	if (read() == PRESSED)
	{
		uint16_t old_repeats = _reported_repeats;
		_reported_repeats = repeats_since_press();
		return (has_changed() || old_repeats != _reported_repeats);
	}
	else
	{
		return false;
	}
}

// has the button gone from on -> off
bool Button::released()
{
	return (read() == RELEASED && has_changed());
}

void Button::set_repeat(int16_t delay_ms, int16_t repeat_ms)
{
	_repeat_delay_ms = delay_ms > _delay ? delay_ms - _delay : 0;
	_repeat_ms = repeat_ms;
}

uint16_t Button::repeats_since_press()
{
 	if (_repeat_delay_ms == -1 || millis() < _ignore_until + _repeat_delay_ms)
	{
		return 0;
	}

	if (_repeat_ms <= 0)
	{
		return 1;
	}

	uint32_t press_time = millis() - _ignore_until;
	return 1 + (press_time - _repeat_delay_ms) / _repeat_ms;
}`,
        },
        {
          name: 'clock.cpp',
          content: `#include <Arduino.h>
#include "Clock.h"

#define MINUTE 60 * 1000L /* ms */
#define TIMESPAN_DAY TimeSpan(1, 0, 0, 0)

#define NVRAM_ADDR_ALARM_ENABLED 0
#define NVRAM_ADDR_ALARM_HOUR    1
#define NVRAM_ADDR_ALARM_MINUTE  2


Clock::Clock()
  : _alarm_state(ALARM_OFF)
  , _alarm_snooze_time(0)
  , _alarm_hour(DEFAULT_ALARM_HOUR)
  , _alarm_minute(0) {
}

void Clock::begin() {
# if USE_RTC
  if (!_rtc.begin()) {
    Serial.println("Couldn't find RTC");
    abort();
  }
  _alarm_state = _rtc.readnvram(NVRAM_ADDR_ALARM_ENABLED) ? ALARM_OFF : ALARM_DISABLED;
  _alarm_hour = _rtc.readnvram(NVRAM_ADDR_ALARM_HOUR) % 24;
  _alarm_minute = _rtc.readnvram(NVRAM_ADDR_ALARM_MINUTE) % 60;
# else /* USE_RTC */
  DateTime zeroTime;
  _rtc.begin(zeroTime);
# endif
}

/***** Clock management *****/

DateTime Clock::now() {
  return _rtc.now();
}

void Clock::incrementMinute() {
  DateTime now = _rtc.now();
  DateTime newTime = DateTime(now.year(), now.month(), now.day(), now.hour(),
                              (now.minute() + 1) % 60);
  _rtc.adjust(newTime);
}

void Clock::incrementHour() {
  DateTime now = _rtc.now();
  DateTime newTime = DateTime(now.year(), now.month(), now.day(),
                              (now.hour() + 1) % 24, now.minute());
  _rtc.adjust(newTime);
}

/***** Alarm management *****/
bool Clock::_isAlarmDueTime() {
  auto currentTime = now();
  auto alarm = alarmTime();
  return ((currentTime.hour() == alarm.hour())
          && (currentTime.minute() == alarm.minute()));
}

bool Clock::alarmEnabled() {
  return _alarm_state != ALARM_DISABLED;
}

bool Clock::alarmActive() {
  switch (_alarm_state) {
    case ALARM_DISABLED:
      return false;

    case ALARM_OFF:
      if (_isAlarmDueTime()) {
        _alarm_state = ALARM_ACTIVE;
        return true;
      }
      return false;

    case ALARM_ACTIVE:
      return true;

    case ALARM_SNOOZED:
      if (millis() >= _alarm_snooze_time) {
        _alarm_state = ALARM_ACTIVE;
        return true;
      }
      return false;

    case ALARM_STOPPED:
      if (!_isAlarmDueTime()) {
        _alarm_state = ALARM_OFF;
      }
      return false;

    default:
      return false;
  }
}


void Clock::toggleAlarm() {
  bool enabled = !alarmEnabled();
  _alarm_state = enabled ? ALARM_OFF : ALARM_DISABLED;
# if USE_RTC
  _rtc.writenvram(NVRAM_ADDR_ALARM_ENABLED, enabled);
# endif
}

DateTime Clock::alarmTime() {
  DateTime now = _rtc.now();
  DateTime alarm = DateTime(now.year(), now.month(), now.day(), _alarm_hour, _alarm_minute);
  return alarm >= now ? alarm : alarm + TIMESPAN_DAY;
}

void Clock::snooze() {
  _alarm_state = ALARM_SNOOZED;
  _alarm_snooze_time = millis() + SNOOZE_TIME * MINUTE;
}

void Clock::stopAlarm() {
  _alarm_state = ALARM_STOPPED;
}

void Clock::incrementAlarmHour() {
  _alarm_hour = (_alarm_hour + 1) % 24;
  _alarm_state = ALARM_OFF;
# if USE_RTC
  _rtc.writenvram(NVRAM_ADDR_ALARM_HOUR, _alarm_hour);
# endif
}

void Clock::incrementAlarmMinute() {
  _alarm_minute = (_alarm_minute + 1) % 60;
  _alarm_state = ALARM_OFF;
# if USE_RTC
  _rtc.writenvram(NVRAM_ADDR_ALARM_MINUTE, _alarm_minute);
# endif
}`,
        },
        {
          name: 'alarmtone.cpp',
          content: `#include <Arduino.h>
#include "AlarmTone.h"

#define TONE_TIME 500 /* ms */
#define TONE_SPACING 100 /* ms */

static const uint16_t TONES[] = {
  500,
  800,
};
const uint16_t NUM_TONES = sizeof(TONES) / sizeof(TONES[0]);

AlarmTone::AlarmTone()
: _playing(false)
, _tone_index(0)
, _last_tone_time(0) {
}

void AlarmTone::begin(uint8_t pin) {
  _pin = pin;
  pinMode(_pin, OUTPUT);
}

void AlarmTone::play() {
  if (!_playing || _last_tone_time + TONE_TIME + TONE_SPACING < millis()) {
    tone(_pin, TONES[_tone_index], TONE_TIME);
    _tone_index = (_tone_index + 1) % NUM_TONES;
    _last_tone_time = millis();
  }
  _playing = true;
}

void AlarmTone::stop() {
  noTone(_pin);
  _tone_index = 0;
  _playing = false;
}`,
        },
      ],
      libraries: [
        { name: 'SevSeg', source: 'provided' },
        { name: 'RTClib', source: 'provided' },
      ],
      // Same circuit as the first build; only the flavor of the sketch differs.
      circuit: CIRCUITS['alarm-clock'],
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
      libraries: [],
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
      circuit: CIRCUITS['safe'],
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
      libraries: [],
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
      circuit: CIRCUITS['dashboard'],
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
      libraries: [],
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
      circuit: CIRCUITS['parking'],
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
      libraries: [],
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
      circuit: CIRCUITS['weather'],
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
      libraries: [],
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
      circuit: CIRCUITS['reaction'],
    },
  ],
  working: [
    'Press once to arm; the light comes on two to five seconds later.',
    'The serial monitor reports your latency in milliseconds on a clean run.',
    'Pressing early prints "false start" and the round restarts.',
  ],
};

/* ------------------------------------------------------------------ *
 * Network Clock — the bench's network, read onto the TFT
 * ------------------------------------------------------------------ */

/*
 * The first project whose data does not come from the board.
 *
 * The network here is the bench's, not the internet's: the gateway, the name
 * and the answer all live in the simulator, which is what lets it work offline
 * and lets a test know exactly what the answer will be. What is real is the
 * *shape* of the code -- join, poll until connected, ask, poll until the answer
 * arrives -- because that shape is what a board with a radio has, whether the
 * radio is real or not.
 */
const NET_CLOCK_SKETCH = `#include <WiFi.h>

#define BLACK 0x0000
#define WHITE 0xFFFF
#define GREEN 0x07E0
#define SKY   0x867D

/*
 * The board keeps time only as well as it can count milliseconds, and that
 * counter starts at zero every time it resets. A clock that says 4,000 ms is
 * not telling the time; it is telling you how long it has been running. So the
 * time comes from the network, and the sketch's job is to ask for it.
 */
void setup() {
  Serial.begin(115200);
  tft.begin();
  tft.setRotation(1);
  tft.clear();
  tft.print("NOESIS BENCH NETWORK", 20, 20, SKY);

  /*
   * Joining is not instant, and it is not guaranteed: a real board spends
   * seconds here and a wrong password spends them for nothing. Polling the
   * status is the loop every ESP32 sketch in the world starts with.
   */
  WiFi.begin("noesis-bench", "benchwifi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(50);
  }

  Serial.print("joined ");
  Serial.println(WiFi.localIP());
  tft.print("ip", 20, 60, SKY);
  tft.print(WiFi.localIP(), 90, 60, WHITE);
}

void loop() {
  /*
   * One request at a time, and none of them instant.
   *
   * net.get() says whether the answer has arrived; it does not wait for it,
   * because the firmware cannot wait for anything without stopping the rest of
   * the sketch. This loop is the difference between code that uses a network
   * and code that draws a picture, and it is the same loop the map lesson
   * teaches.
   */
  net.reset();
  while (net.get("http://api.noesis/time") == 0) {
    delay(20);
  }

  tft.fillRect(20, 120, 440, 40, BLACK);
  if (net.failed()) {
    Serial.println("network failed");
    tft.print("no answer from the network", 20, 120, 0xF800);
  } else {
    Serial.println(net.read());
    tft.print(net.read(), 20, 120, GREEN);
  }
  delay(1000);
}
`;

const NET_CLOCK: GalleryProject = {
  id: 'net-clock',
  title: 'Network Clock',
  blurb:
    'The board has no clock of its own, so it asks the network for the time and puts the answer on the screen. Join, ask, wait, read: the waiting is the part that makes it a network program.',
  parts: [{ name: '3.2" TFT (ILI9341)', qty: 1 }],
  builds: [
    {
      board: 'esp32',
      circuit: CIRCUITS['esp32-tft'],
      sketch: NET_CLOCK_SKETCH,
    },
  ],
  working: [
    'The serial monitor reports the address the bench network handed out.',
    'The panel shows that address, then the time it fetched, once a second.',
    'Stop the network and the loop reports "network failed" rather than freezing.',
  ],
};

/* ------------------------------------------------------------------ *
 * Sensor Feed — the network's sensor, received rather than fetched
 * ------------------------------------------------------------------ */

/*
 * The other half of a network program.
 *
 * The clock asks for something and waits; this one does not wait at all. The
 * sensor publishes once a second whether or not anyone is listening, and the
 * loop asks `available()` and carries on in between -- which is what a program
 * with more than one job has to look like. `message()` reads the same value as
 * often as the turn needs it, because a sketch here has no string variable to
 * hold a payload in.
 */
const SENSOR_FEED_SKETCH = `#include <WiFi.h>

#define BLACK 0x0000
#define WHITE 0xFFFF
#define GREEN 0x07E0
#define SKY   0x867D

void setup() {
  Serial.begin(115200);
  tft.begin();
  tft.setRotation(1);
  tft.clear();
  tft.print("SENSOR FEED", 20, 20, SKY);

  WiFi.begin("noesis-bench", "benchwifi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(50);
  }
  Serial.print("joined ");
  Serial.println(WiFi.localIP());

  /*
   * A subscription is to a name, not to a device: the sensor keeps publishing
   * whether or not this sketch is listening, and the broker hands over the
   * latest reading straight away (it is retained).
   */
  Serial.print("subscribed ");
  Serial.println(net.subscribe("readings/temp"));

  /*
   * A network program is usually both directions: this one listens for the
   * feed, and tells the sensor how often it wants it. Publishing has no
   * audience on a bench with one board, so the network's own sensor takes the
   * order -- ask for two seconds and the feed slows to one reading every two.
   */
  Serial.print("asked for 2s ");
  Serial.println(net.publish("commands/interval", "2"));
}

void loop() {
  /*
   * No waiting: asking whether there is news and carrying on is what lets a
   * program do two things at once. The clock's loop could afford to block
   * because it had one job; this one has a screen to keep alive.
   */
  if (net.available()) {
    tft.fillRect(20, 100, 440, 60, BLACK);
    tft.print(net.message(), 20, 100, GREEN);
    Serial.print("temp ");
    Serial.println(net.message());
  }
  delay(100);
}
`;

const SENSOR_FEED: GalleryProject = {
  id: 'sensor-feed',
  title: 'Sensor Feed',
  blurb:
    'A sensor on the network publishes a temperature. The board subscribes, reads it without ever blocking, and tells the sensor how often it wants the next one — both directions of a network program.',
  parts: [{ name: '3.2" TFT (ILI9341)', qty: 1 }],
  builds: [
    {
      board: 'esp32',
      circuit: CIRCUITS['esp32-tft'],
      sketch: SENSOR_FEED_SKETCH,
    },
  ],
  working: [
    'The serial monitor reports the subscription and the order it placed with the sensor.',
    'Then it logs a temperature every two seconds — the cadence the board asked for.',
    'The panel shows the latest reading as it arrives, and the bench stays responsive: the loop never waits.',
  ],
};

/* ------------------------------------------------------------------ *
 * Live Weather — the one build that reaches a real host
 * ------------------------------------------------------------------ */

/*
 * The network slice's exception, and what `simulation/net/live-hosts.ts` is for.
 *
 * Every other project here talks to the bench's own network: names the bench
 * knows, answers on simulated time, the same on every machine. This one asks a
 * *real* host -- open-meteo, keyless and CORS-clean -- and the bench bridges the
 * request because this build says so (`network: 'live'`). The sketch itself is
 * unchanged in shape, which is the point: `net.get` on a bridged name is still a
 * poll, still reports failures through `net.failed()`, and would not know the
 * difference except by what came back.
 *
 * What a reader has to know, and the panel and the serial both say: the request
 * leaves this machine. It is a GET, it carries no credentials and no headers,
 * and it goes to one endpoint this repository chose. Weather is the honest
 * lesson for it -- a value nobody can know without asking someone who does.
 */

const LIVE_WEATHER_SKETCH = `
#define BLACK 0x0000
#define WHITE 0xFFFF
#define GREEN 0x07E0
#define SKY   0x867D

void setup() {
  Serial.begin(115200);
  tft.begin();
  tft.setRotation(1);

  /*
   * Joining is not instant, and it is not guaranteed. The bench network takes
   * the same simulated latency it always does; the real request after this is
   * the part that takes as long as it takes.
   */
  WiFi.begin("noesis-bench", "benchwifi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(50);
  }

  Serial.print("joined ");
  Serial.println(WiFi.localIP());
  tft.print("live weather, Berlin", 20, 40, WHITE);
  tft.print("real request: api.open-meteo.com", 20, 60, SKY);
}

void loop() {
  /*
   * The same poll the bench hosts get. A real request is pending until the
   * host answers, and a host that never answers is reported the same way an
   * unknown name is -- which is the lesson this project exists to show.
   */
  while (net.get("http://weather.noesis/v1/forecast?latitude=52.52&longitude=13.41&current=temperature_2m") == 0) {
    delay(20);
  }

  tft.fillRect(20, 90, 440, 40, BLACK);
  if (net.failed()) {
    Serial.println("live network failed");
    tft.print("no answer: check your connection", 20, 90, 0xF800);
  } else {
    Serial.println(net.read());
    tft.print(net.read(), 20, 90, GREEN);
  }
  /* Two seconds between requests: a real host is somebody else's server. */
  delay(2000);
}
`;

const LIVE_WEATHER: GalleryProject = {
  id: 'live-weather',
  title: 'Live Weather',
  blurb:
    'The same poll loop, pointed at a real host: open-meteo, keyless and CORS-clean, reached because this build opted into the live network. The request leaves your machine — a GET, no credentials — and it fails like any other host when the network or the server is not there.',
  parts: [{ name: '3.2" TFT (ILI9341)', qty: 1 }],
  builds: [
    {
      board: 'esp32',
      circuit: CIRCUITS['esp32-tft'],
      sketch: LIVE_WEATHER_SKETCH,
      network: 'live',
    },
  ],
  working: [
    'The panel names the endpoint before the first request: this one leaves the machine.',
    'The serial prints the JSON open-meteo answered, and the panel draws it — a temperature nobody could know without asking.',
    'Pull the network cable, and the loop reports "no answer" instead of freezing: a real host fails like a bench host.',
  ],
};

/* ------------------------------------------------------------------ *
 * Soil Moisture Probe — a sensor the bench has no model for
 * ------------------------------------------------------------------ */

/*
 * The worked example for behaviour parts (`docs/superpowers/specs/
 * 2026-10-19-behaviour-parts-design.md` §8). The part is not in the
 * catalogue: its definition travels inside the circuit document, so the file
 * opens on a machine that never imported anything. The behaviour is the
 * script, and the knob is its input -- turn it and the ADC follows.
 */
const SOIL_PROBE_SKETCH = `#include <Arduino.h>

#define PROBE A0

void setup() {
  Serial.begin(9600);
}

void loop() {
  int reading = analogRead(PROBE);
  /*
   * idiv, because the VM's division is true division: the sketch wants a whole
   * percentage to print, not 39.98.
   */
  int percent = idiv(reading * 100, 1023);
  Serial.print("moisture ");
  Serial.print(percent);
  Serial.println("%");
  delay(500);
}
`;

const SOIL_PROBE: GalleryProject = {
  id: 'soil-probe',
  title: 'Soil Moisture Probe',
  blurb:
    'A sensor the bench has no model for, written as a script and carried in the circuit file itself: turn the Moisture knob and the Uno reads it on A0 — the script is the sensor.',
  parts: [{ name: 'Soil moisture probe', qty: 1 }],
  builds: [
    {
      board: 'uno',
      circuit: CIRCUITS['soil-probe'],
      sketch: SOIL_PROBE_SKETCH,
    },
  ],
  working: [
    'The serial prints a moisture percentage twice a second, and the inspector shows the probe with its knob.',
    'Turn Moisture down and the reading follows: the script reads the knob, the netlist holds the divider, and the ADC reads it back.',
    'It is a part from the circuit file, not the catalogue — the bench never had a soil probe built in.',
  ],
};

/* ------------------------------------------------------------------ *
 * Instrument Bench — barometer, current monitor and converter on one bus
 * ------------------------------------------------------------------ */

const INSTRUMENT_BENCH_SKETCH = `#include <Arduino.h>
#include <Wire.h>

// An instrument bench: a barometer, a current monitor and a sixteen-bit
// converter, all three answering on the same two wires.
//
// The barometer speaks the register protocol rather than a library, so the
// compensation the datasheet prints is here in the sketch: the raw counts
// come off the chip, and the eleven coefficients in its E2PROM are what turn
// them into pascals and degrees.

byte BAROMETER = 0x77;
byte MONITOR = 0x40;
byte CONVERTER = 0x48;

// The chip's own calibration, read out of its E2PROM at startup.
int words[11];
int ac1, ac2, ac3, ac4, ac5, ac6, b1, b2, mb, mc, md;

// A register that holds two bytes, most significant first.
int readWord(int address, int register) {
  Wire.beginTransmission(address);
  Wire.write(register);
  Wire.endTransmission();
  Wire.requestFrom(address, 2);
  int high = Wire.read();
  int low = Wire.read();
  return (high << 8) | low;
}

// A signed register: the current and the shunt voltage can both be negative.
int readSignedWord(int address, int register) {
  int word = readWord(address, register);
  if (word > 32767) { word = word - 65536; }
  return word;
}

void readCalibration() {
  Wire.beginTransmission(BAROMETER);
  Wire.write(0xAA);
  Wire.endTransmission();
  Wire.requestFrom(BAROMETER, 22);
  for (int index = 0; index < 11; index++) {
    int high = Wire.read();
    int low = Wire.read();
    int word = (high << 8) | low;
    if (word > 32767) { word = word - 65536; }
    words[index] = word;
  }
  ac1 = words[0]; ac2 = words[1]; ac3 = words[2]; ac4 = words[3];
  ac5 = words[4]; ac6 = words[5]; b1 = words[6]; b2 = words[7];
  mb = words[8]; mc = words[9]; md = words[10];
}

// The raw temperature count: start a measurement, then read the two bytes it
// lands in.
int temperatureCounts() {
  Wire.beginTransmission(BAROMETER);
  Wire.write(0xF4);
  Wire.write(0x2E);
  Wire.endTransmission();
  Wire.beginTransmission(BAROMETER);
  Wire.write(0xF6);
  Wire.endTransmission();
  Wire.requestFrom(BAROMETER, 2);
  int high = Wire.read();
  int low = Wire.read();
  return (high << 8) | low;
}

// The raw pressure count: three bytes, left-aligned.
int pressureCounts() {
  Wire.beginTransmission(BAROMETER);
  Wire.write(0xF4);
  Wire.write(0x34);
  Wire.endTransmission();
  Wire.beginTransmission(BAROMETER);
  Wire.write(0xF6);
  Wire.endTransmission();
  Wire.requestFrom(BAROMETER, 3);
  int msb = Wire.read();
  int lsb = Wire.read();
  int xlsb = Wire.read();
  return ((msb << 16) | (lsb << 8) | xlsb) >> 8;
}

// The datasheet's temperature compensation, in tenths of a degree.
int compensateTemperature(int ut) {
  int x1 = ((ut - ac6) * ac5) >> 15;
  int x2 = idiv(mc << 11, x1 + md);
  int b5 = x1 + x2;
  return (b5 + 8) >> 4;
}

// The datasheet's pressure compensation, in pascals.
int compensatePressure(int up, int ut) {
  int x1 = ((ut - ac6) * ac5) >> 15;
  int x2 = idiv(mc << 11, x1 + md);
  int b6 = x1 + x2 - 4000;

  int bx1 = (b2 * ((b6 * b6) >> 12)) >> 11;
  int bx2 = (ac2 * b6) >> 11;
  int b3 = ((ac1 * 4 + bx1 + bx2) + 2) >> 2;
  int by1 = (ac3 * b6) >> 13;
  int by2 = (b1 * ((b6 * b6) >> 12)) >> 16;
  int b4 = (ac4 * (((by1 + by2 + 2) >> 2) + 32768)) >> 15;

  int b7 = (up - b3) * 50000;
  int p = idiv(b7 * 2, b4);
  int px1 = (((p >> 8) * (p >> 8)) * 3038) >> 16;
  int px2 = (-7357 * p) >> 16;
  return p + ((px1 + px2 + 3791) >> 4);
}

void setup() {
  Serial.begin(115200);
  Wire.begin();
  readCalibration();
  /*
   * The current register is only as good as the calibration the sketch
   * writes: 4096 is the datasheet's own worked example, a hundred
   * microamps a bit.
   */
  Wire.beginTransmission(MONITOR);
  Wire.write(0x05);
  Wire.write(0x10);
  Wire.write(0x00);
  Wire.endTransmission();
  Serial.println("instrument bench up");
}

void loop() {
  int ut = temperatureCounts();
  int up = pressureCounts();
  int tenths = compensateTemperature(ut);
  int pascals = compensatePressure(up, ut);

  int shunt = readSignedWord(MONITOR, 0x01);
  int busMillivolts = (readWord(MONITOR, 0x02) >> 3) * 4;
  int current = readSignedWord(MONITOR, 0x04);
  int power = readWord(MONITOR, 0x03);

  /*
   * The converter: tell it which channel to look at and how much of the
   * range to give it, then read the counts back.
   */
  Wire.beginTransmission(CONVERTER);
  Wire.write(0x01);
  Wire.write(0xC2);
  Wire.write(0x02);
  Wire.endTransmission();
  int counts = readSignedWord(CONVERTER, 0x00);

  int whole = idiv(tenths, 10);
  int fraction = tenths - whole * 10;
  if (fraction < 0) { fraction = 0 - fraction; }

  Serial.print("barometer ");
  Serial.print(idiv(pascals, 100));
  Serial.print(" hPa  temperature ");
  Serial.print(whole);
  Serial.print(".");
  Serial.print(fraction);
  Serial.println(" C");

  Serial.print("monitor ");
  Serial.print(idiv(current * 100, 1000));
  Serial.print(" mA  shunt ");
  Serial.print(idiv(shunt * 10, 1000));
  Serial.print(" mV  bus ");
  Serial.print(idiv(busMillivolts, 1000));
  Serial.print(" V  power ");
  Serial.print(power * 2);
  Serial.print(" mW  converter ");
  Serial.print(counts);
  Serial.println(" counts");

  delay(1000);
}
`;

const INSTRUMENT_BENCH: GalleryProject = {
  id: 'instrument-bench',
  title: 'Instrument Bench',
  blurb:
    'Three instruments on one pair of wires: a barometer for the weather, a current monitor for the supply, and a sixteen-bit converter for whatever analogue signal you have. The barometer speaks the register protocol, so the compensation the datasheet prints is in the sketch.',
  parts: [
    { name: 'BMP180 Barometer', qty: 1 },
    { name: 'INA219 Current Monitor', qty: 1 },
    { name: 'ADS1115 16-bit ADC', qty: 1 },
  ],
  builds: [
    {
      board: 'uno',
      libraries: [],
      sketch: INSTRUMENT_BENCH_SKETCH,
      circuit: CIRCUITS['instrument-bench'],
    },
  ],
  working: [
    'The serial log prints one line a reading: the pressure and temperature off the barometer, the current and the power off the monitor, and the converter counts.',
    'Turn the Pressure and Temperature knobs on the barometer and both numbers move: the chip reports raw counts and the sketch does the arithmetic.',
    'Turn the Current knob on the monitor and the current and the power move together, because the power is the current times the bus voltage.',
  ],
};

export const GALLERY: readonly GalleryProject[] = [
  ALARM_CLOCK,
  SAFE,
  DASHBOARD,
  PARKING,
  WEATHER,
  REACTION,
  NET_CLOCK,
  SENSOR_FEED,
  LIVE_WEATHER,
  SOIL_PROBE,
  INSTRUMENT_BENCH,
];

export function galleryById(id: string): GalleryProject | null {
  return GALLERY.find((entry) => entry.id === id) ?? null;
}

export function buildFor(
  project: GalleryProject,
  board: BoardId,
  variant?: string,
): GalleryBuild | null {
  const onBoard = project.builds.filter((build) => build.board === board);
  if (variant === undefined) return onBoard[0] ?? null;
  return onBoard.find((build) => build.variant === variant) ?? onBoard[0] ?? null;
}

export function boardsFor(project: GalleryProject): readonly BoardId[] {
  return [...new Set(project.builds.map((build) => build.board))];
}
