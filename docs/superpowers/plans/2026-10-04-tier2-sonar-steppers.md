# Tier-2 Sonar + Steppers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an HC-SR04 sonar readable through a new `pulseIn` firmware call plus coil-sequenced stepper and biaxial stepper parts.

**Architecture:** New `sonar`, `stepper`, `biaxial-stepper` component kinds with focused sim files; `pulseIn` added to the interpreter beside `digitalRead` with begin/end services on the optional-service pattern; ECHO line and stepper shaft tracked in engine pump maps following the relay `relayEnergized` precedent; Wokwi artwork wired through `WOKWI_PARTS`.

**Tech Stack:** TypeScript, Vitest, existing solver stamps (resistor contacts, pull-ups), `@wokwi/elements` artwork.

**Spec:** `docs/superpowers/specs/2026-10-04-tier2-sonar-steppers-design.md`

## Global Constraints

- Pin sizes in millimetres; element `pinInfo` px convert at 25.4/96.
- Sonar echo is distance_cm * 58 microseconds; `distance` knob is min 2, max 400, step 1, default 100.
- `pulseIn` timeout defaults to 1000000 microseconds and returns 0 past it.
- Stepper full step is 7.5 degrees; invalid or jitter coil transitions hold position.
- No Stepper library API in this plan; sketches bit-bang coils.

## Review Focus

- `pulseIn` on a pin with no sonar wired returns 0 instead of hanging the sketch.
- `pulseIn` with the wrong level waits for timeout rather than returning aSonar echo immediately.
- Stepper coils driven to identical levels on both ends of a winding hold position instead of stepping.
- A sketch that powers the sonar from the wrong rail still gets an echo (VCC is topology only in v1).
- ECHO reads low again after `pulseIn` returns instead of sticking high into later reads.

---

### Task 1: Sonar part and echo math

**Files:**
- Create: `src/sim/sonar.ts`
- Modify: `src/sim/catalog.ts` (add `sonar` kind)
- Test: `src/sim/sonar.test.ts` (create)

**Interfaces:**
- Consumes: `PartDefinition`, `KnobSpec`.
- Produces: `sonarDefinition()`, `DISTANCE_KNOB` (min 2, max 400, step 1, defaultValue 100), `echoMicroseconds(distanceCm: number): number` (rounds cm * 58).

Pin geometry (mm, artwork-true from element `pinInfo` at 96dpi): `VCC` x 18.86, `TRIG` x 21.5, `ECHO` x 24.15, `GND` x 26.8, all y 25.0 (bottom-edge row, snapped to grid: 25.0 is within 0.04 of row pitch from the 18.86 origin, record the snap in code). Width 45, height 25. `GND` pin carries `net: 'GND'`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { DISTANCE_KNOB, echoMicroseconds, sonarDefinition } from './sonar';

describe('sonar definition', () => {
  it('exposes VCC/TRIG/ECHO/GND with a distance knob', () => {
    const def = sonarDefinition();
    expect(def.pins.map((p) => p.id)).toEqual(['VCC', 'TRIG', 'ECHO', 'GND']);
    expect([DISTANCE_KNOB.min, DISTANCE_KNOB.max, DISTANCE_KNOB.step, DISTANCE_KNOB.defaultValue]).toEqual([2, 400, 1, 100]);
  });
});

describe('echo math', () => {
  it('converts distance to echo microseconds at 58 per cm', () => {
    expect(echoMicroseconds(2)).toBe(116);
    expect(echoMicroseconds(100)).toBe(5800);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/sonar.test.ts`
Expected: FAIL (file/kind missing, no tests collected).

- [ ] **Step 3: Write minimal implementation**

Create `src/sim/sonar.ts` with `DISTANCE_KNOB`, `echoMicroseconds`, `sonarDefinition()` per interfaces above; add `| { readonly kind: 'sonar' }` to `ComponentSpec` in `src/sim/catalog.ts`. Netlist coverage comes in Task 2 (add a `case 'sonar'` stub returning `[]` in `src/sim/netlist.ts` now only if `tsc -b` demands exhaustiveness).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/sim/sonar.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/sonar.ts src/sim/sonar.test.ts src/sim/catalog.ts src/sim/netlist.ts
git commit -m "feat: add HC-SR04 sonar part and echo math"
```

### Task 2: `pulseIn` firmware call and ECHO line

**Files:**
- Modify: `src/sim/firmware/interpreter.ts` (new `pulseIn` global beside `digitalRead`)
- Modify: `src/sim/catalog.ts` (no change; consumes Task 1 kind)
- Modify: `src/sim/netlist.ts` (`case 'sonar'`: ECHO open-drain + pull-up driven by measuring map)
- Modify: `src/sim/engine.ts` (sonar measuring map + pump, following `pumpRelays`)
- Modify: `src/ui/simulation.ts` (`pulseInBegin`/`pulseInEnd` services, sonar lookup mirroring `servoOnPin`)
- Test: `src/sim/firmware/pulsein.test.ts` (create), extend `src/sim/sonar.test.ts` with netlist + engine tests

**Interfaces:**
- Consumes: `sonarDefinition()`, `DISTANCE_KNOB`, `echoMicroseconds` from Task 1; `evaluateCall` switch at `interpreter.ts:282-323`; optional-service pattern (`lcd?`, `servo?` at `interpreter.ts:51-52`); `servoOnPin` lookup at `simulation.ts:721-731`.
- Produces: `FirmwareServices.pulseInBegin?(pin, level, timeoutUs): number` (echo micros, 0 on timeout/absent), `pulseInEnd?(): void`; engine `sonarMeasuring` map threaded as an optional `buildNetlist` param defaulting to empty (same shape as `relayEnergized`).

Netlist `case 'sonar'`: `TRIG` contributes nothing (high-Z input); `ECHO` is open-drain to `GND` (closed unless measuring) with a 10k pull-up to `VCC`, exactly the joystick `SEL` shape at `netlist.ts:418-431`. Engine pump reads each sonar part's distance knob from `DynamicState`? No: measuring flag only; distance is read by the service at `pulseInBegin` time from `this.controls.knob(part.id, DISTANCE_KNOB)`.

Interpreter `case 'pulseIn'` (generator, beside `digitalRead`): `const micros = services.pulseInBegin?.(pin, level, timeout) ?? 0; if (micros <= 0) return 0; yield micros / 1000; services.pulseInEnd?.(); return micros;` Timeout arg defaults to 1000000 when absent. Services stay optional so existing `FirmwareServices` test stubs keep compiling.

Simulation services: `pulseInBegin` finds the sonar part whose `ECHO` pin shares the calling MCU pin's net (mirror `servoOnPin`, match `part.id:ECHO` in `engine.currentNetlist.pinNode`), returns 0 when none; reads the distance knob, sets `engine` measuring true for that part, settles, returns `echoMicroseconds(distance)` unless it exceeds the timeout (return 0, leave line low). `pulseInEnd` clears the flag and settles.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { Interpreter } from './interpreter';

function stubServices(overrides = {}) {
  return {
    nowMs: () => 0,
    pinMode: () => {},
    digitalWrite: () => {},
    digitalRead: () => 0,
    analogWrite: () => {},
    analogRead: () => 0,
    serialBegin: () => {},
    serialWrite: () => {},
    wire: { begin: () => {}, beginTransmission: () => {}, write: () => 0, endTransmission: () => 0, requestFrom: () => 0, read: () => -1, available: () => 0 },
    spi: { begin: () => {}, transfer: () => 0, end: () => 0 },
    ...overrides,
  };
}

describe('pulseIn', () => {
  it('returns the service echo width', () => {
    const interpreter = new Interpreter('void setup() { int d = pulseIn(2, HIGH); }');
    // drive the interpreter to completion against stub services with pulseInBegin: () => 5800
  });
});
```

Shape the test on the existing `Wire` coverage in `firmware.test.ts:85-97` (stub services + run to completion); assert the sketch variable sees 5800. Assert a second sketch with no `pulseInBegin` service sees 0 (absent-service fallback).

Engine/netlist tests in `sonar.test.ts` (stripBench without breadboard, direct terminal wires per the encoder-test precedent): ECHO reads low at rest; with the part flagged measuring, ECHO reads high; after clearing, low again. Plus: `pulseInBegin` on a pin with no sonar wired returns 0; a call with the wrong level returns 0 after the timeout rather than an echo; VCC wired to the 5V rail still yields the knob echo.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/sim/firmware/pulsein.test.ts src/sim/sonar.test.ts`
Expected: FAIL (`pulseIn` unknown global evaluates to 0; measuring flag does nothing).

- [ ] **Step 3: Write minimal implementation**

Implement interpreter case, `FirmwareServices` optional methods, netlist `case 'sonar'`, engine map + pump + optional `buildNetlist` param, simulation services per interfaces above.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/sim/firmware/pulsein.test.ts src/sim/sonar.test.ts src/sim/engine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/firmware/interpreter.ts src/sim/netlist.ts src/sim/engine.ts src/ui/simulation.ts src/sim/firmware/pulsein.test.ts src/sim/sonar.test.ts
git commit -m "feat: add pulseIn firmware call and sonar echo line"
```

### Task 3: Stepper part with coil-tracked shaft

**Files:**
- Create: `src/sim/stepper.ts`
- Modify: `src/sim/catalog.ts` (add `stepper` kind)
- Modify: `src/sim/netlist.ts` (`case 'stepper'`: two winding resistors)
- Modify: `src/sim/engine.ts` (per-part coil levels + angle, pump per solve)
- Test: `src/sim/stepper.test.ts` (create)

**Interfaces:**
- Consumes: `PartDefinition`; engine pump pattern from Task 2 (`pumpRelays`); `SWITCH_CLOSED_OHMS` not needed (windings are plain resistors).
- Produces: `stepperDefinition()`, `STEP_DEGREES = 7.5`, `WINDING_OHMS = 50`, `stepTransition(prevA, prevB, nextA, nextB): -1 | 0 | 1` (pure Gray-cycle helper, 0 for invalid/jitter), engine `stepperAngle(partId): number`.

Pin geometry: `A-` x 0, `A+` x 2.54, `B+` x 5.08, `B-` x 7.62, y 40.0 (bottom-edge row of the 42x42 frame, snapped; record in code). Width 42, height 42. Netlist: resistors `A+`–`A-` and `B+`–`B-` at 50 ohms. Engine: per-part `{ aPlus, aMinus, bPlus, bMinus }` previous booleans (threshold logicVolts/2 via `voltageOfNet`) plus angle; each solve, polarities `pA = sign(V(A+)-V(A-))`, `pB = sign(V(B+)-V(B-))` with a 0.2V dead band holding on near-zero; on change, `angle += stepTransition(...) * 7.5`. Prune state for removed parts in `rebuild()` like `relayEnergized`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { STEP_DEGREES, stepperDefinition, stepTransition } from './stepper';

describe('stepper definition', () => {
  it('exposes four coil pins in a row', () => {
    const def = stepperDefinition();
    expect(def.pins.map((p) => p.id)).toEqual(['A-', 'A+', 'B+', 'B-']);
    expect([def.widthMm, def.heightMm]).toEqual([42, 42]);
  });
});

describe('step transition', () => {
  it('steps forward round the Gray cycle', () => {
    expect(stepTransition([1, 1], [-1, 1])).toBe(1);
  });
  it('holds on jitter', () => {
    expect(stepTransition([1, 1], [1, 1])).toBe(0);
    expect(stepTransition([1, 1], [-1, -1])).toBe(0);
  });
});
```

Gray order (pA, pB): (+,+), (-,+), (-,-), (+,-); forward follows it, reverse steps -1, diagonal or no-change is 0.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/stepper.test.ts`
Expected: FAIL (file/kind missing).

- [ ] **Step 3: Write minimal implementation**

Create `src/sim/stepper.ts`; add kind; netlist case; engine state + pump + `stepperAngle()` + prune. Renderer: check the element for a rotor-angle prop at implementation time; set it in `pushWokwiState` only if one exists, else leave stateless (relay precedent) and note it in code.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/sim/stepper.test.ts src/sim/engine.test.ts src/sim/netlist.test.ts`
Expected: PASS, including an engine test that drives the four coils through real MCU pins in full-step order and asserts the angle advances 4 x 7.5 degrees, plus a jitter test that holds, plus a same-level test (both ends of one winding driven identically) that holds position.

- [ ] **Step 5: Commit**

```bash
git add src/sim/stepper.ts src/sim/stepper.test.ts src/sim/catalog.ts src/sim/netlist.ts src/sim/engine.ts src/ui/wokwi.ts
git commit -m "feat: add stepper part with coil-tracked shaft"
```

### Task 4: Biaxial stepper (two axes, one package)

**Files:**
- Modify: `src/sim/stepper.ts` (add `biaxialStepperDefinition()`)
- Modify: `src/sim/catalog.ts` (add `biaxial-stepper` kind)
- Modify: `src/sim/netlist.ts` (`case 'biaxial-stepper'`: four winding resistors)
- Modify: `src/sim/engine.ts` (second axis state per part)
- Test: extend `src/sim/stepper.test.ts`

**Interfaces:**
- Consumes: `stepTransition`, `STEP_DEGREES`, `WINDING_OHMS` from Task 3.
- Produces: `biaxialStepperDefinition()`; engine `stepperAngle(partId, axis?: 1 | 2)` — default axis 1 so Task 3 callers keep compiling.

Pin geometry (mm, from element `pinXY`): column x 11.9; `A1-` y 28.9, `A1+` y 31.44, `B1+` y 33.98, `B1-` y 36.52, `A2-` y 39.06, `A2+` y 41.6, `B2+` y 44.14, `B2-` y 46.68. Width 56, height 67.5. Engine tracks axis 1 (`A1/B1`) and axis 2 (`A2/B2`) independently with separate previous levels and angles.

- [ ] **Step 1: Write the failing tests**

```ts
it('exposes eight pins for two axes', () => {
  const def = biaxialStepperDefinition();
  expect(def.pins.map((p) => p.id)).toEqual(['A1-', 'A1+', 'B1+', 'B1-', 'A2-', 'A2+', 'B2+', 'B2-']);
  expect([def.widthMm, def.heightMm]).toEqual([56, 67.5]);
});
```

Plus an engine test: sequence axis 1 coils while axis 2 stays put; assert axis 1 moves and axis 2 reads 0.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/sim/stepper.test.ts`
Expected: FAIL (definition/kind missing).

- [ ] **Step 3: Write minimal implementation**

Implement per interfaces above.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/sim/stepper.test.ts src/sim/engine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/stepper.ts src/sim/stepper.test.ts src/sim/catalog.ts src/sim/netlist.ts src/sim/engine.ts
git commit -m "feat: add biaxial stepper with independent axes"
```

### Task 5: Artwork, catalogue, and selection wiring

**Files:**
- Modify: `src/ui/wokwi.ts` (`WOKWI_PARTS` + `wokwiPartFor` for `sonar`, `stepper`, `biaxial-stepper`)
- Modify: `src/ui/wokwi-library.ts` (convert `wokwi-hc-sr04`, `wokwi-stepper-motor`, `wokwi-biaxial-stepper` from `needs-api` to `placed`)
- Modify: `src/sim/catalogue.ts` (entries `sonar-hcsr04`, `stepper-motor`, `biaxial-stepper`; biaxial in `LARGE_PARTS`)
- Test: extend `src/sim/sonar.test.ts` + `src/sim/stepper.test.ts` with `renderedSizeMm` + tag locks

**Interfaces:**
- Consumes: `sonarDefinition()`, `stepperDefinition()`, `biaxialStepperDefinition()`.
- Produces: placeable catalogue entries; `renderedSizeMm` equals 45x25 sonar, 42x42 stepper, 56x67.5 biaxial (this sizes the selection outline and hit area, per the Tier-1 selection fix).

- [ ] **Step 1: Write the failing tests**

```ts
// in sonar.test.ts
import { renderedSizeMm, wokwiPartFor } from '../ui/wokwi';
it('selection box matches the sonar artwork', () => {
  const drawn = renderedSizeMm(sonarDefinition());
  expect(drawn.widthMm).toBe(45);
  expect(drawn.heightMm).toBe(25);
  expect(wokwiPartFor(sonarDefinition())?.tag).toBe('wokwi-hc-sr04');
});
```

Mirror for stepper (`wokwi-stepper-motor`, 42x42) and biaxial (`wokwi-biaxial-stepper`, 56x67.5).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/sim/sonar.test.ts src/sim/stepper.test.ts`
Expected: FAIL on the tag assertions (`wokwiPartFor` returns null).

- [ ] **Step 3: Write minimal implementation**

`src/ui/wokwi.ts`: add `sonar: { tag: 'wokwi-hc-sr04', sizeMm: { w: 45, h: 25 } }`, `stepper: { tag: 'wokwi-stepper-motor', sizeMm: { w: 42, h: 42 } }`, `'biaxial-stepper': { tag: 'wokwi-biaxial-stepper', sizeMm: { w: 56, h: 67.5 } }` plus `case` mappings. `pushWokwiState`: set nothing new unless the elements expose matching rotor/distance props (check at implementation time; relay precedent is stateless). `wokwi-library.ts`: flip the three entries to `placed` (drop their `needs-api` notes). `catalogue.ts`: three entries with wiring notes; add `biaxial-stepper` to `LARGE_PARTS`.

- [ ] **Step 4: Run full verification**

Run: `npm run typecheck && npm run lint && npx vitest run src/sim/sonar.test.ts src/sim/stepper.test.ts src/ui/wokwi-library.test.ts`
Expected: PASS, zero type/lint errors. Then `npm test` for the whole suite.

- [ ] **Step 5: Commit**

```bash
git add src/ui/wokwi.ts src/ui/wokwi-library.ts src/sim/catalogue.ts src/sim/sonar.test.ts src/sim/stepper.test.ts
git commit -m "feat: wire sonar and stepper artwork, catalogue, selection"
```
