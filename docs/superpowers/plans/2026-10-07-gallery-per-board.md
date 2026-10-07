# Gallery Per-Board Builds, Uno Batch — Implementation Plan (v1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve the gallery data model to per-board builds, migrate the five Uno projects, and add the Reaction Timer as Uno's 6th validated project.

**Architecture:** `GalleryProject` trades its single `setup`/`sketch`/`boards` for `builds: [{board, setup, sketch}]`; the validation harness loops builds with per-board benches and per-board language parsing; the preview test loops builds with board-namespaced cache keys. Follow-up board batches then only append builds.

**Tech Stack:** TypeScript (data only — no JSX in this plan), vitest, the firmware interpreter subset (see constraints).

**Spec:** `docs/superpowers/specs/2026-10-07-gallery-per-board-design.md` (data-model, validation, and v1 sections; batches and display belong to later work).

## Global Constraints

- Sketch dialect (the interpreter subset): `void int float double bool char byte long short unsigned signed`, arrays, `#define`. No `struct`, no `enum`, no pointers, no classes, no `String`, no `uint8_t`, no `const` at file scope. Proven APIs only (`pinMode`+`INPUT_PULLUP`, `digitalRead/Write`, `delay`, `millis`, `Serial`, `%`, `&&`; see existing entries for the rest).
- Migration moves the five sketches and setups byte-identical into `builds[0]` — no edits while moving; edits are separate commits with their own failing test.
- All v1 builds are Uno (`board: 'uno'`); part names are the catalogue's definition names (the `LCD 16x2 (HD44780)` lesson stands).
- Work happens on branch `gallery-per-board`, created from `gallery-data` (which holds `gallery.ts`, `gallery.test.ts`, and `previewBench`).
- `npm run typecheck` clean, `npm run lint` with 0 warnings and 0 errors, full `npm test` green.

## Review Focus

- A migrated project with an empty `builds` array would vanish from every board silently — pinned by Task 1's test asserting every project has at least one build.
- `buildFor` returning a build for a board that has none (e.g. Mega today) would load Uno wiring onto the wrong bench — pinned by Task 1's test asserting `buildFor(project, 'mega')` is null for all five (batches update this tripwire as they add builds).
- A future Python sketch parsed as C++ would fail confusingly — pinned by Task 1's harness resolving the parse language per build via `boardOption(board).language` (all `arduino-cpp` today).
- `galleryById` inventing projects for unknown ids would render phantom cards — pinned by the existing unknown-id test (kept in Task 1).
- Two boards colliding on one preview cache key would serve the wrong bench image — pinned by Task 3's board-namespaced keys (`gallery:<board>:<id>`) asserted across every build.

---

### Task 1: Per-board data model and harness migration

**Files:**
- Modify: `src/ui/gallery.ts` (interface + migrate 5 entries + `buildFor`/`boardsFor`)
- Modify: `src/ui/gallery.test.ts` (loop builds, per-board benches + language)

**Interfaces:**
- Consumes: `BoardId`, `boardOption` from `./boardRegistry`; `Simulation`, `breadboardDefinition`, `PART_CATALOGUE` (unchanged patterns).
- Produces: `GalleryBuild`, `GalleryProject` (with `builds`), `GALLERY`, `galleryById(id: string)`, `buildFor(project, board): GalleryBuild | null`, `boardsFor(project): readonly BoardId[]` for Tasks 2–4 and later batches.

- [ ] **Step 1: Create the working branch**

```bash
git checkout -b gallery-per-board gallery-data
git log --oneline -1 -- src/ui/gallery.ts
```

Expected: branch created; the log line shows the gallery-data commit touching `gallery.ts` (the five projects are present). If `gallery-data` no longer exists (merged), rule on `main` instead and ledger it.

- [ ] **Step 2: Write the failing migration tests**

Replace the whole `src/ui/gallery.test.ts` with exactly this content (harness now loops builds; entry tests from Tasks 2+ of the gallery-data plan are kept and extended with a builds assertion each — shown here for the clock, the pattern repeats):

```ts
import { describe, expect, it } from 'vitest';
import { PART_CATALOGUE } from '../sim/catalogue';
import { breadboardDefinition } from '../sim/breadboard';
import { boardOption, type BoardId } from './boardRegistry';
import { GALLERY, boardsFor, buildFor, galleryById } from './gallery';
import { previewBench } from './exercise-preview-data';
import { Simulation } from './simulation';

const CATALOGUE_NAMES = new Set(PART_CATALOGUE.map((entry) => entry.make().name));

function freshBench(board: BoardId) {
  const definition = boardOption(board).make();
  const simulation = new Simulation(definition);
  simulation.addPart(definition, 0, 0);
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
  it('numbers every project uniquely and builds each at least once', () => {
    const ids = GALLERY.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of GALLERY) {
      expect(entry.builds.length, `${entry.id} builds`).toBeGreaterThan(0);
      expect(galleryById(entry.id)?.id).toBe(entry.id);
      for (const build of entry.builds) {
        expect(boardOption(build.board).id).toBe(build.board);
      }
    }
    expect(galleryById('nope')).toBeNull();
  });

  it('resolves builds per board and none where none exist', () => {
    for (const entry of GALLERY) {
      expect(boardsFor(entry)).toEqual(entry.builds.map((build) => build.board));
      for (const board of boardsFor(entry)) {
        expect(buildFor(entry, board)?.board).toBe(board);
      }
      expect(buildFor(entry, 'mega')).toBeNull();
    }
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

  it('parses every build sketch in its board language', () => {
    for (const entry of GALLERY) {
      for (const build of entry.builds) {
        const simulation = freshBench(build.board);
        simulation.loadFirmware(build.sketch, boardOption(build.board).language);
        expect(simulation.firmwareError, `${entry.id}/${build.board}: ${simulation.firmwareError}`).toBeNull();
      }
    }
  });

  it('wires every build onto its board bench without throwing', () => {
    const wireFloors: Record<string, number> = {
      'alarm-clock': 16,
      safe: 14,
      dashboard: 14,
      parking: 15,
      weather: 12,
    };
    for (const entry of GALLERY) {
      for (const build of entry.builds) {
        const key = `${entry.id}/${build.board}`;
        const simulation = freshBench(build.board);
        expect(() => build.setup(simulation), `${key} setup`).not.toThrow();
        expect(simulation.bench.wires.length, `${key} wires`).toBeGreaterThanOrEqual(
          wireFloors[entry.id] ?? 1,
        );
        const real = partTerminals(simulation);
        const touched = new Set<number>();
        for (const wire of simulation.bench.wires) {
          expect(real.has(wire.from), `${key} wire from`).toBe(true);
          expect(real.has(wire.to), `${key} wire to`).toBe(true);
          touched.add(wire.from);
          touched.add(wire.to);
        }
        for (const part of entry.parts) {
          const placed = simulation.bench.parts.filter((p) => p.definition.name === part.name).length;
          expect(placed, `${key} "${part.name}" qty`).toBeGreaterThanOrEqual(part.qty);
        }
        for (const part of simulation.bench.parts) {
          const kind = part.definition.component.kind;
          if (kind === 'mcu' || kind === 'breadboard') continue;
          const wired = Object.values(part.terminals).some((id) => touched.has(id));
          expect(wired, `${key} "${part.definition.name}" wired`).toBe(true);
        }
      }
    }
  });

  it('frames every project preview on real content', () => {
    for (const entry of GALLERY) {
      for (const build of entry.builds) {
        const preview = previewBench(build.board, build.setup, `gallery:${build.board}:${entry.id}`);
        expect(preview.parts.length, `${entry.id} parts`).toBeGreaterThan(0);
        expect(preview.paths.length, `${entry.id} paths`).toBeGreaterThan(0);
      }
    }
  });

  it('opens with the alarm clock', () => {
    expect(galleryById('alarm-clock')?.title).toBe('Alarm Clock with RTC');
  });

  it('locks digits behind the safe', () => {
    expect(galleryById('safe')?.title).toBe('Electronic Safe');
  });

  it('sweeps the dashboard horn', () => {
    expect(galleryById('dashboard')?.title).toBe('Servo Dashboard');
  });

  it('beeps at the parking sensor', () => {
    expect(galleryById('parking')?.title).toBe('Parking Sensor');
  });

  it('logs the weather station', () => {
    expect(galleryById('weather')?.title).toBe('Weather Station');
  });
});
```

Add the import at the top with the others: `import { previewBench } from './exercise-preview-data';`

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/ui/gallery.test.ts`
Expected: FAIL — `buildFor`, `boardsFor`, and `previewBench` are not exported / `entry.builds` does not exist (multiple red errors; any of them proves the model is missing).

- [ ] **Step 4: Migrate the interface and the five entries**

In `src/ui/gallery.ts`:
1. Replace the interface block with:

```ts
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
```

2. For each of the five entries, move `sketch:` and `setup:` byte-identical into `builds: [{ board: 'uno', sketch: <same>, setup: <same> }]` and delete the `boards: ['uno']` line. The resulting entry shape (alarm clock shown; same transform for safe, dashboard, parking, weather):

```ts
const ALARM_CLOCK: GalleryProject = {
  id: 'alarm-clock',
  title: 'Alarm Clock with RTC',
  blurb: '...', // unchanged
  parts: [ ... ], // unchanged
  builds: [
    {
      board: 'uno',
      sketch: `...`, // byte-identical to the current sketch
      setup: (simulation) => { ... }, // byte-identical to the current setup
    },
  ],
  working: [ ... ], // unchanged
};
```

3. Replace `galleryById` tail with:

```ts
export function galleryById(id: string): GalleryProject | null {
  return GALLERY.find((entry) => entry.id === id) ?? null;
}

export function buildFor(project: GalleryProject, board: BoardId): GalleryBuild | null {
  return project.builds.find((build) => build.board === board) ?? null;
}

export function boardsFor(project: GalleryProject): readonly BoardId[] {
  return project.builds.map((build) => build.board);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/ui/gallery.test.ts src/ui/exercisePreview.test.ts`
Expected: PASS — gallery suite now 10 tests (entry tests + per-build loops), exercise previews unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/ui/gallery.ts src/ui/gallery.test.ts
git commit -m "Migrate gallery to per-board builds"
```

### Task 2: Reaction Timer — Uno's 6th project

**Files:**
- Modify: `src/ui/gallery.ts` (append `REACTION` + register)
- Modify: `src/ui/gallery.test.ts` (one entry test)

**Interfaces:**
- Consumes: `GALLERY`, `galleryById` from Task 1.
- Produces: `galleryById('reaction')` with a Uno build for later UI work.

One button (D2, pullup), one LED + resistor (D8). Press to arm (after release), wait a press-derived delay, LED lights, press again for the latency; pressing early is a false start. Single-button debounce copied from the safe's proven pattern.

- [ ] **Step 1: Write the failing entry test**

```ts
  it('times the reaction game', () => {
    expect(galleryById('reaction')?.title).toBe('Reaction Timer');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/ui/gallery.test.ts`
Expected: FAIL with "expected undefined to be 'Reaction Timer'".

- [ ] **Step 3: Add the entry**

```ts
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
```

Register: append `, REACTION` to the `GALLERY` array.

Extend the harness `wireFloors` table in the same edit with `reaction: 5` — the button contributes 2 jumpers, the LED channel 3.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/ui/gallery.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/ui/gallery.ts src/ui/gallery.test.ts
git commit -m "Add reaction timer to the gallery"
```

### Task 3: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Run the whole suite**

Run: `npm test`
Expected: all files pass, including `src/ui/gallery.test.ts`.

- [ ] **Step 2: Run lint, typecheck, build, and the design detector**

Run: `npm run typecheck`
Expected: clean.

Run: `npm run lint`
Expected: 0 warnings, 0 errors.

Run: `npm run build`
Expected: `✓ built in …` with no errors.

Run: `node C:\Users\Asep Saepuloh\.config\opencode\skills\impeccable\scripts/detect.mjs --json src/ui/gallery.ts`
Expected: `[]`.

- [ ] **Step 3: Manual pass**

Confirm the migrated sketches are byte-identical to the gallery-data branch versions (`git diff gallery-data -- src/ui/gallery.ts` shows only structural moves: interface, builds wrapping, registration — no sketch/setup body changes). Confirm Uno's set reads as six finished projects.
