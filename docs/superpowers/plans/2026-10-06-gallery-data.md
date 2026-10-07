# Project Gallery Data Implementation Plan (Plan 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Five runnable gallery projects as validated data — each with a parser-clean sketch, a working wiring setup, and a previewable bench.

**Architecture:** New `src/ui/gallery.ts` holding the five projects in the exercises' vocabulary (`setup(sim)` + `sketch`), validated by a `gallery.test.ts` harness mirroring `exercises.test.ts`; then `exercise-preview-data.ts` generalizes to `previewBench(board, setup, cacheKey)` with `previewFor` kept as a wrapper, so Plan 2 (pages, routes, bench plumbing) builds on tested ground.

**Tech Stack:** React 19 / TypeScript (data only — no JSX in this plan), Tailwind untouched, vitest, the firmware interpreter subset (see constraints).

**Spec:** `docs/superpowers/specs/2026-10-06-project-gallery-design.md` (data-model, five-projects, and previews sections; pages/routes/bench/homepage belong to Plan 2).

## Global Constraints

- Sketch dialect (the interpreter subset — violated constructs fail the parse test, which is the point): `void int float double bool char byte long short unsigned signed`, arrays, `#define`. No `struct`, no `enum`, no pointers, no classes, no `String`, no `uint8_t`, no `const` at file scope (use `#define` or plain globals; `const` inside functions is fine).
- Proven sketch APIs only: `pinMode` (+`INPUT_PULLUP`), `digitalRead/Write`, `analogRead(n)` with the raw number (`14` is A0), `analogWrite`, `delay`, `delayMicroseconds`, `millis`, `Serial`, `Wire.begin()` (zero-arg on Uno), `Wire.beginTransmission/write/endTransmission/requestFrom/read/available`, `lcd.begin/setCursor/print/backlight`, `dht.begin/temperature/humidity`, `servo.attach/write/read`, `pulseIn(pin, HIGH, timeoutUs)`, `map()`. No `tone()`, no keypad reads, no new firmware APIs, no new simulator parts.
- All five v1 projects are Uno-only (`boards: ['uno']`); setups use Uno silkscreen names (`D2`, `A0`, `5V`, `GND`).
- Part names are the catalogue's own (`part()` from `./exercises/shared` resolves them; a renamed part fails the suite, not the learner).
- If a project's sketch or setup cannot be made to validate, cut the project (remove its entry and its entry test) rather than weakening the harness — the spec minimum is three.
- `npm run typecheck` clean, `npm run lint` with 0 warnings and 0 errors, full `npm test` green.

## Review Focus

- A sketch reaching outside the interpreter subset (e.g. `String`, file-scope `const`, `tone()`) must fail the suite, not the bench — pinned by every task's parse test running the real parser via `loadFirmware`.
- A setup wiring to a pin name the board lacks (e.g. a misspelled `A0`) must fail the suite — pinned by every task's island test asserting each wire joins real part contacts.
- A future project naming a catalogue part that was renamed must fail the suite — pinned by Task 1's parts-name test resolving every name against `PART_CATALOGUE`.
- Two projects sharing an id would make one unreachable by `galleryById` — pinned by Task 1's uniqueness test.
- A project whose parts land nowhere previewable (empty frame) must fail the suite — pinned by Task 6's preview assertions over every project.

---

### Task 1: Gallery interface, validation harness, and the Alarm Clock

**Files:**
- Create: `src/ui/gallery.ts`
- Create: `src/ui/gallery.test.ts`

**Interfaces:**
- Consumes: `BoardId` from `./boardRegistry`; `part`, `PART_X`, `PART_Y`, `PART_STEP` from `./exercises/shared`; `Simulation` from `./simulation`; `boardOption` from `./boardRegistry`; `breadboardDefinition` from `../sim/breadboard`; `PART_CATALOGUE` from `../sim/catalogue`.
- Produces: `GalleryProject`, `GALLERY`, `galleryById(id: string): GalleryProject | null` for Tasks 2–6 and Plan 2.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { PART_CATALOGUE } from '../sim/catalogue';
import { breadboardDefinition } from '../sim/breadboard';
import { boardOption } from './boardRegistry';
import { GALLERY, galleryById } from './gallery';
import { Simulation } from './simulation';

const CATALOGUE_NAMES = new Set(PART_CATALOGUE.map((entry) => entry.make().name));

function freshBench() {
  const board = boardOption('uno').make();
  const simulation = new Simulation(board);
  simulation.addPart(board, 0, 0);
  simulation.addPart(breadboardDefinition(), 230, 0);
  return simulation;
}

function partTerminals(simulation: Simulation): Set<number> {
  const ids = new Set<number>();
  for (const part of simulation.bench.parts) {
    for (const id of Object.values(part.terminals)) ids.add(id);
  }
  return ids;
}

describe('the project gallery', () => {
  it('numbers every project uniquely and tags real boards', () => {
    const ids = GALLERY.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of GALLERY) {
      expect(entry.boards.length).toBeGreaterThan(0);
      for (const board of entry.boards) {
        expect(boardOption(board).id).toBe(board);
      }
      expect(galleryById(entry.id)?.id).toBe(entry.id);
    }
    expect(galleryById('nope')).toBeNull();
  });

  it('names only parts the catalogue stocks and says what running shows', () => {
    for (const entry of GALLERY) {
      for (const part of entry.parts) {
        expect(CATALOGUE_NAMES.has(part.name), `${entry.id} part "${part.name}"`).toBe(true);
        expect(part.qty).toBeGreaterThan(0);
      }
      expect(entry.working.length, `${entry.id} working`).toBeGreaterThan(0);
      expect(entry.blurb.length, `${entry.id} blurb`).toBeGreaterThan(0);
    }
  });

  it('parses every sketch through the real parser', () => {
    for (const entry of GALLERY) {
      const simulation = freshBench();
      simulation.loadFirmware(entry.sketch, 'arduino-cpp');
      expect(simulation.firmwareError, `${entry.id} sketch: ${simulation.firmwareError}`).toBeNull();
    }
  });

  it('wires each project onto the bench without throwing', () => {
    for (const entry of GALLERY) {
      const simulation = freshBench();
      expect(() => entry.setup(simulation), `${entry.id} setup`).not.toThrow();
      expect(simulation.bench.wires.length, `${entry.id} wires`).toBeGreaterThan(0);
      const real = partTerminals(simulation);
      for (const wire of simulation.bench.wires) {
        expect(real.has(wire.from), `${entry.id} wire from`).toBe(true);
        expect(real.has(wire.to), `${entry.id} wire to`).toBe(true);
      }
    }
  });

  it('opens with the alarm clock', () => {
    expect(galleryById('alarm-clock')?.title).toBe('Alarm Clock with RTC');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/ui/gallery.test.ts`
Expected: FAIL with "Cannot find module './gallery'" (file does not exist yet).

- [ ] **Step 3: Write the interface and the Alarm Clock**

Create `src/ui/gallery.ts` with exactly this content:

```ts
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
    { name: 'LCD1602, 16x2', qty: 1 },
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/ui/gallery.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/ui/gallery.ts src/ui/gallery.test.ts
git commit -m "Add project gallery with alarm clock"
```

### Task 2: Electronic Safe (button code lock)

**Files:**
- Modify: `src/ui/gallery.ts` (append `SAFE` entry + register in `GALLERY`)
- Modify: `src/ui/gallery.test.ts` (one entry test)

**Interfaces:**
- Consumes: `GALLERY`, `galleryById` from Task 1.
- Produces: `galleryById('safe')` for Plan 2; the harness tests in Task 1 validate the entry.

No keypad reads exist in the firmware, so this is the button fallback the spec mandates: three buttons, red/green LEDs, piezo buzzer. Code A-C-B (pins 2-4-3).

- [ ] **Step 1: Write the failing entry test**

Append to the `describe` block in `src/ui/gallery.test.ts`:

```ts
  it('locks digits behind the safe', () => {
    expect(galleryById('safe')?.title).toBe('Electronic Safe');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/ui/gallery.test.ts`
Expected: FAIL with "expected undefined to be 'Electronic Safe'" (`galleryById('safe')` is null).

- [ ] **Step 3: Add the entry**

Append to `src/ui/gallery.ts` (before `export const GALLERY`), and register it:

```ts
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
  boards: ['uno'],
  parts: [
    { name: 'Tactile Button', qty: 3 },
    { name: 'Red LED', qty: 1 },
    { name: 'Green LED', qty: 1 },
    { name: '220 Resistor', qty: 2 },
    { name: 'Piezo Buzzer', qty: 1 },
  ],
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
  working: [
    'The red LED is lit while locked; nothing else happens until three digits land.',
    'A, then C, then B turns the green LED on for two seconds and prints "unlocked".',
    'Any wrong digit buzzes three times and the attempt starts over.',
  ],
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
};

export const GALLERY: readonly GalleryProject[] = [ALARM_CLOCK, SAFE];
```

That last line replaces the Task 1 `export const GALLERY` line (`[ALARM_CLOCK]` → `[ALARM_CLOCK, SAFE]`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/ui/gallery.test.ts`
Expected: PASS, 6 tests (the harness loops validate the new entry's sketch, wiring, and parts).

- [ ] **Step 5: Commit**

```bash
git add src/ui/gallery.ts src/ui/gallery.test.ts
git commit -m "Add electronic safe to the gallery"
```

### Task 3: Servo Dashboard (potentiometer + servo + LED bar)

**Files:**
- Modify: `src/ui/gallery.ts` (append `DASHBOARD` + register)
- Modify: `src/ui/gallery.test.ts` (one entry test)

**Interfaces:**
- Consumes: `GALLERY`, `galleryById` from Tasks 1–2.
- Produces: `galleryById('dashboard')` for Plan 2.

Knob on A0 (pin 14, the Module 2 convention); servo on 19 via `placeExampleDevice`; three LEDs show which third of the travel the knob is in.

- [ ] **Step 1: Write the failing entry test**

```ts
  it('sweeps the dashboard horn', () => {
    expect(galleryById('dashboard')?.title).toBe('Servo Dashboard');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/ui/gallery.test.ts`
Expected: FAIL with "expected undefined to be 'Servo Dashboard'".

- [ ] **Step 3: Add the entry**

```ts
/* ------------------------------------------------------------------ *
 * Servo Dashboard — slide pot, hobby servo, three-LED bar
 * ------------------------------------------------------------------ */

const DASHBOARD: GalleryProject = {
  id: 'dashboard',
  title: 'Servo Dashboard',
  blurb:
    'A slide potentiometer becomes a steering wheel: the servo horn follows the knob and three LEDs show which third of the travel it is in.',
  boards: ['uno'],
  parts: [
    { name: 'Slide Potentiometer', qty: 1 },
    { name: 'Hobby Servo', qty: 1 },
    { name: 'Green LED', qty: 1 },
    { name: 'Yellow LED', qty: 1 },
    { name: 'Red LED', qty: 1 },
    { name: '220 Resistor', qty: 3 },
  ],
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
  working: [
    'The horn tracks the knob from end stop to end stop, never asked past 10–170.',
    'Exactly one of the three LEDs is lit, marking the third of the travel.',
    'The serial monitor reports both numbers: the knob reading and the horn angle.',
  ],
  setup: (simulation) => {
    simulation.clearExampleParts();
    const supply = simulation.boardTerminal('5V');
    const ground = simulation.boardTerminal('GND');
    if (!supply || !ground) return;

    simulation.placeExampleDevice('servo', PART_X, PART_Y);

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
};
```

Register: `export const GALLERY: readonly GalleryProject[] = [ALARM_CLOCK, SAFE, DASHBOARD];`

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/ui/gallery.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/ui/gallery.ts src/ui/gallery.test.ts
git commit -m "Add servo dashboard to the gallery"
```

### Task 4: Parking Sensor (sonar + buzzer + LED bar)

**Files:**
- Modify: `src/ui/gallery.ts` (append `PARKING` + register)
- Modify: `src/ui/gallery.test.ts` (one entry test)

**Interfaces:**
- Consumes: `GALLERY`, `galleryById` from Tasks 1–3.
- Produces: `galleryById('parking')` for Plan 2.

TRIG on D6, ECHO on D7 (the Module 4 convention); distance is `pulseIn / 58`, the sensor model's own scale, so the display round-trips honestly.

- [ ] **Step 1: Write the failing entry test**

```ts
  it('beeps at the parking sensor', () => {
    expect(galleryById('parking')?.title).toBe('Parking Sensor');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/ui/gallery.test.ts`
Expected: FAIL with "expected undefined to be 'Parking Sensor'".

- [ ] **Step 3: Add the entry**

```ts
/* ------------------------------------------------------------------ *
 * Parking Sensor — sonar, buzzer, three-LED distance bar
 * ------------------------------------------------------------------ */

const PARKING: GalleryProject = {
  id: 'parking',
  title: 'Parking Sensor',
  blurb:
    'An ultrasonic ranger watches the bench: LEDs mark far, near, and too close, and the buzzer complains inside 30 cm. Turn the distance knob to drive closer.',
  boards: ['uno'],
  parts: [
    { name: 'Ultrasonic Sensor (HC-SR04)', qty: 1 },
    { name: 'Piezo Buzzer', qty: 1 },
    { name: 'Green LED', qty: 1 },
    { name: 'Yellow LED', qty: 1 },
    { name: 'Red LED', qty: 1 },
    { name: '220 Resistor', qty: 3 },
  ],
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
  working: [
    'The serial monitor reports centimetres that follow the distance knob.',
    'Green means something is out there, yellow inside a metre, red inside 30 cm.',
    'Inside 30 cm the buzzer beeps twice a second; a timed-out echo reads 0 and lights nothing.',
  ],
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
};
```

Register: `export const GALLERY: readonly GalleryProject[] = [ALARM_CLOCK, SAFE, DASHBOARD, PARKING];`

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/ui/gallery.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/ui/gallery.ts src/ui/gallery.test.ts
git commit -m "Add parking sensor to the gallery"
```

### Task 5: Weather Station (DHT22 + LCD)

**Files:**
- Modify: `src/ui/gallery.ts` (append `WEATHER` + register)
- Modify: `src/ui/gallery.test.ts` (one entry test)

**Interfaces:**
- Consumes: `GALLERY`, `galleryById` from Tasks 1–4.
- Produces: `galleryById('weather')` for Plan 2; the gallery of five is complete.

DHT22 data on D2 (the Module 3 convention: VCC→5 V, GND→ground, SDA terminal→D2); LCD via `placeExampleDevice`; reads every 2 s because the sensor needs it.

- [ ] **Step 1: Write the failing entry test**

```ts
  it('logs the weather station', () => {
    expect(galleryById('weather')?.title).toBe('Weather Station');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/ui/gallery.test.ts`
Expected: FAIL with "expected undefined to be 'Weather Station'".

- [ ] **Step 3: Add the entry**

```ts
/* ------------------------------------------------------------------ *
 * Weather Station — DHT22 + LCD1602
 * ------------------------------------------------------------------ */

const WEATHER: GalleryProject = {
  id: 'weather',
  title: 'Weather Station',
  blurb:
    'A temperature-humidity sensor reports to a character LCD and the serial log. Turn the knobs on the part — or warm it with a fingertip on the bench — and watch both numbers move.',
  boards: ['uno'],
  parts: [
    { name: 'DHT22 Temp/Humidity', qty: 1 },
    { name: 'LCD1602, 16x2', qty: 1 },
  ],
  sketch: `#include <Arduino.h>

byte SENSOR_PIN = 2;

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
  working: [
    'The LCD shows temperature on line one and humidity on line two.',
    'Turning the part knobs moves both numbers within a couple of seconds.',
    'The serial monitor logs one line per reading, never a scroll of repeats.',
  ],
  setup: (simulation) => {
    simulation.clearExampleParts();
    const supply = simulation.boardTerminal('5V');
    const ground = simulation.boardTerminal('GND');
    if (!supply || !ground) return;

    simulation.placeExampleDevice('lcd1602', PART_X, PART_Y);

    const sensor = simulation.addPart(part('DHT22 Temp/Humidity'), PART_X, PART_Y + PART_STEP);
    const data = simulation.boardTerminal('D2');
    const vcc = simulation.pinAt(sensor, 'VCC');
    const sda = simulation.pinAt(sensor, 'SDA');
    const gnd = simulation.pinAt(sensor, 'GND');
    if (!data || !vcc || !sda || !gnd) return;
    simulation.routeWire(supply, vcc);
    simulation.routeWire(ground, gnd);
    simulation.routeWire(data, sda);
  },
};
```

Register: `export const GALLERY: readonly GalleryProject[] = [ALARM_CLOCK, SAFE, DASHBOARD, PARKING, WEATHER];`

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/ui/gallery.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/ui/gallery.ts src/ui/gallery.test.ts
git commit -m "Add weather station to the gallery"
```

### Task 6: Generalize the preview builder

**Files:**
- Modify: `src/ui/exercise-preview-data.ts` (extract `previewBench`, keep `previewFor` as a wrapper)
- Modify: `src/ui/gallery.test.ts` (preview assertions over every project)

**Interfaces:**
- Consumes: `GalleryProject.setup`, `boards` from Tasks 1–5; `Exercise`, `exerciseBoard` from `./exercises`.
- Produces: `previewBench(board, setup, cacheKey): ExercisePreviewData` for Plan 2's gallery thumbnails; unchanged `previewFor(exercise)` for existing callers.

The cache keeps one map; keys are namespaced (`exercise:<id>`, `gallery:<id>`) so the two domains never collide.

- [ ] **Step 1: Write the failing preview test**

Append to the `describe` block in `src/ui/gallery.test.ts`:

```ts
  it('frames every project preview on real content', () => {
    for (const entry of GALLERY) {
      const preview = previewBench(entry.boards[0], entry.setup, `gallery:${entry.id}`);
      expect(preview.parts.length, `${entry.id} parts`).toBeGreaterThan(0);
      expect(preview.frame.width, `${entry.id} width`).toBeGreaterThan(0);
      expect(preview.frame.height, `${entry.id} height`).toBeGreaterThan(0);
      expect(preview.paths.length, `${entry.id} paths`).toBeGreaterThan(0);
    }
  });
```

Add the import: `import { previewBench } from './exercise-preview-data';`

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/ui/gallery.test.ts`
Expected: FAIL with an error naming `previewBench` — the module exists but does not export it yet.

- [ ] **Step 3: Extract the generic builder**

In `src/ui/exercise-preview-data.ts`, refactor `previewFor` into:

```ts
export function previewBench(
  board: BoardId,
  setup: (simulation: Simulation) => void,
  cacheKey: string,
): ExercisePreviewData {
  const cached = previewCache.get(cacheKey);
  if (cached) return cached;

  const definition = boardOption(board).make();
  const simulation = new Simulation(definition);
  simulation.addPart(definition, 0, 0);
  simulation.addPart(breadboardDefinition(), BREADBOARD_ORIGIN_X, 0);
  setup(simulation);

  ... (the existing body, unchanged: parts filter, state, lanes, paths, frame, then cache under cacheKey)
}

export function previewFor(exercise: Exercise): ExercisePreviewData {
  return previewBench(exerciseBoard(exercise), exercise.setup, `exercise:${exercise.id}`);
}
```

Concretely: change the `previewFor(exercise: Exercise)` signature and its first lines (board resolution + `exercise.setup(simulation)` call + `previewCache.get/set(exercise.id)`) to take `(board, setup, cacheKey)` and use those throughout; then re-add `previewFor` as the three-line wrapper above. Add `import type { BoardId } from './boardRegistry';` (boardOption is already imported; add `exerciseBoard` stays for the wrapper). Nothing else in the file changes — same parts filter, same state, same lanes, same frame.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/ui/gallery.test.ts src/ui/exercisePreview.test.ts`
Expected: PASS — gallery suite now 10 tests, and the existing exercise preview suite still passes unchanged (the wrapper preserves behaviour; the cache keys changed, which only re-builds).

- [ ] **Step 5: Commit**

```bash
git add src/ui/exercise-preview-data.ts src/ui/gallery.test.ts
git commit -m "Generalize preview builder for gallery projects"
```

### Task 7: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Run the whole suite**

Run: `npm test`
Expected: all files pass, including `src/ui/gallery.test.ts`.

- [ ] **Step 2: Run lint, build, and the design detector**

Run: `npm run typecheck`
Expected: clean.

Run: `npm run lint`
Expected: 0 warnings, 0 errors.

Run: `npm run build`
Expected: `✓ built in …` with no errors.

Run: `node C:\Users\Asep Saepuloh\.config\opencode\skills\impeccable\scripts/detect.mjs --json src/ui/gallery.ts src/ui/exercise-preview-data.ts`
Expected: `[]`.

- [ ] **Step 3: Manual pass**

Open each project's bench by hand once (load its setup + sketch via a scratch harness or the dev bench) and confirm the preview image matches the wired bench. Confirm keyboard focus is visible on gallery-adjacent links when Plan 2 lands; nothing clickable ships in this plan.
