# Tier-1 Wokwi adds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Mega library entry, a 2-pole relay, and a KY-040 encoder as honest native parts.

**Architecture:** New `relay` and `rotary-encoder` component kinds with definitions in focused sim files, netlist emission with existing resistor/contact stamps, Wokwi artwork wiring through `WOKWI_PARTS`, and catalogue entries. No firmware-interpreter changes.

**Tech Stack:** TypeScript, Vitest, `@wokwi/elements` artwork, existing solver stamps (`resistor` contacts, pull-ups).

**Spec:** `docs/superpowers/specs/2026-10-03-tier1-relay-encoder-design.md`

## Global Constraints

- Pin sizes in millimetres; `pinInfo` px convert at 25.4/96.
- Relay coil is 70 ohm; contacts use existing closed/open constants.
- Encoder detent knob is min -1000, max 1000, step 1, default 0.
- No firmware-interpreter changes in this plan.

## Review Focus

- Relay coil driven at 3.3V as well as 5V still pulls in (threshold must suit both logic families).
- Encoder detent at knob extremes still yields valid quadrature (no dead step at min/max).
- Relay with floating coil rests on NC, never shorts NO to NC.
- Encoder with floating VCC still reads sane (pull-ups need supply; document floating behavior).
- A sketch reading CLK/DT with `digitalRead` sees full-swing levels, not mid-rail.

---

### Task 1: Mega library entry

**Files:**
- Modify: `src/ui/wokwi-library.ts:39-45`
- Test: `src/ui/wokwi-library.test.ts` (create) — or extend an existing ui test if the implementer finds one; default to the new file.

**Interfaces:**
- Consumes: existing `WOKWI_LIBRARY` array.
- Produces: `wokwi-arduino-mega` listed as `placed` (consumed by `WokwiLibrary.tsx`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { WOKWI_LIBRARY } from './wokwi-library';

describe('wokwi library mega entry', () => {
  it('lists the Mega element as placed', () => {
    const entry = WOKWI_LIBRARY.find((e) => e.tag === 'wokwi-arduino-mega');
    expect(entry?.status).toBe('placed');
    expect(entry?.sizeMm).toEqual({ w: 102.66, h: 50.8 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/wokwi-library.test.ts`
Expected: FAIL with "expected undefined to be 'placed'" (entry missing).

- [ ] **Step 3: Write minimal implementation**

In `src/ui/wokwi-library.ts`, add alongside the other boards:

```ts
{ tag: 'wokwi-arduino-mega', name: 'Arduino Mega 2560', sizeMm: { w: 102.66, h: 50.8 }, status: 'placed' },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/ui/wokwi-library.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/wokwi-library.ts src/ui/wokwi-library.test.ts
git commit -m "feat: list Arduino Mega element as placed"
```

### Task 2: Relay part (DPDT, single coil, both poles ganged)

**Files:**
- Create: `src/sim/relay.ts`
- Modify: `src/sim/catalog.ts` (add `relay` to `ComponentSpec`)
- Modify: `src/sim/netlist.ts` (emit coil load + 2x SPDT contacts)
- Test: `src/sim/relay.test.ts` (create)

**Interfaces:**
- Consumes: `PartDefinition`, `DynamicState`, existing `SWITCH_CLOSED_OHMS` / `SWITCH_OPEN_OHMS` stamps.
- Produces: `relayDefinition()` with pins `P1/NO1/NC1/P2/NO2/NC2/COIL+/COIL-` (exact ids below), `RELAY_COIL_OHMS = 70`.

Pin geometry (mm, artwork-true from element `pinInfo` at 96dpi, recorded as deviation in code): row 1 y 1.35 (`NO2` x 1.46, `NC2` x 6.61, `P2` x 11.91, coil `COIL-` x 19.58), row 2 y 8.65 (`NO1` x 1.46, `NC1` x 6.61, `P1` x 11.91, coil `COIL+` x 19.58). Width 21, height 10. Coil is ONE coil across `COIL+`/`COIL-`; both poles switch together (this satisfies "both poles as wired").

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { relayDefinition } from './relay';

describe('relay definition', () => {
  it('exposes two poles and one coil across eight pins', () => {
    const def = relayDefinition();
    expect(def.pins.map((p) => p.id)).toEqual(['NO2', 'NC2', 'P2', 'COIL-', 'NO1', 'NC1', 'P1', 'COIL+']);
    expect(def.widthMm).toBe(21);
    expect(def.heightMm).toBe(10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/relay.test.ts`
Expected: FAIL with "relay.ts not found / relayDefinition not defined".

- [ ] **Step 3: Write minimal implementation**

Create `src/sim/relay.ts`:

```ts
import type { PartDefinition } from './catalog';

export const RELAY_COIL_OHMS = 70;

export function relayDefinition(): PartDefinition {
  return {
    id: 'relay-dpdt',
    name: 'Relay (DPDT)',
    category: 'input',
    widthMm: 21,
    heightMm: 10,
    component: { kind: 'relay' },
    pins: [
      { id: 'NO2', label: 'NO2', x: 1.46, y: 1.35 },
      { id: 'NC2', label: 'NC2', x: 6.61, y: 1.35 },
      { id: 'P2', label: 'P2', x: 11.91, y: 1.35 },
      { id: 'COIL-', label: 'COIL-', x: 19.58, y: 1.35 },
      { id: 'NO1', label: 'NO1', x: 1.46, y: 8.65 },
      { id: 'NC1', label: 'NC1', x: 6.61, y: 8.65 },
      { id: 'P1', label: 'P1', x: 11.91, y: 8.65 },
      { id: 'COIL+', label: 'COIL+', x: 19.58, y: 8.65 },
    ],
    bodyColour: '#f7b93c',
    legendColour: '#1b1d21',
  };
}
```

Add to `ComponentSpec` in `src/sim/catalog.ts`:

```ts
| { readonly kind: 'relay' }
```

Emit in `src/sim/netlist.ts` (follow the `slide-switch` case at `netlist.ts:386-406`, using `nodeAt`, `SWITCH_CLOSED_OHMS`, `SWITCH_OPEN_OHMS`): coil is a 70 ohm resistor between `COIL+` and `COIL-`; energized when coil volts > 2.5 (suits 3.3V and 5V logic); per pole, energized closes `P`–`NO` and opens `P`–`NC`, resting closes `P`–`NC`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/sim/relay.test.ts src/sim/netlist.test.ts src/sim/modules.test.ts`
Expected: PASS. Extend `relay.test.ts` with netlist tests through the existing `stripBench`/`solveBench` helpers (see `modules.test.ts:208-229`): resting `P1` follows `NC1`; driven coil flips `P1` to `NO1`; poles independent; coil at 3.3V still pulls in (threshold suits both logic families); floating coil rests on `NC` with `NO` open (never shorted).

- [ ] **Step 5: Commit**

```bash
git add src/sim/relay.ts src/sim/relay.test.ts src/sim/catalog.ts src/sim/netlist.ts
git commit -m "feat: add DPDT relay part and netlist model"
```

### Task 3: KY-040 encoder part (detent knob + SW)

**Files:**
- Create: `src/sim/encoder.ts`
- Modify: `src/sim/catalog.ts` (add `rotary-encoder` kind)
- Modify: `src/sim/netlist.ts` (quadrature + SW emission)
- Test: `src/sim/encoder.test.ts` (create)

**Interfaces:**
- Consumes: `PartDefinition`, `KnobSpec`, `DynamicState`, `MODULE_PULLUP_OHMS`.
- Produces: `encoderDefinition()`, `DETENT_KNOB` (min -1000, max 1000, step 1, default 0); pins `CLK/DT/SW/VCC/GND`.

Pin geometry (mm, column snapped to grid per `modules.ts`): column x 30.48; `CLK` y 2.09, `DT` y 4.60, `SW` y 7.14, `VCC` y 9.60, `GND` y 12.04. Width 30.815, height 18.63. Quadrature table indexed by `detent mod 4`: state 0 `CLK=1,DT=1`, 1 `CLK=0,DT=1`, 2 `CLK=0,DT=0`, 3 `CLK=1,DT=0`; emit each of `CLK`/`DT` as open-drain to `GND` (closed when the table says 0) with a 10k pull-up to `VCC`; `SW` shorts to `GND` while pressed, pull-up to `VCC` otherwise (same shape as joystick `SEL` at `netlist.ts:418-431`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { DETENT_KNOB, encoderDefinition } from './encoder';

describe('encoder definition', () => {
  it('exposes CLK/DT/SW/VCC/GND with a detent knob', () => {
    const def = encoderDefinition();
    expect(def.pins.map((p) => p.id)).toEqual(['CLK', 'DT', 'SW', 'VCC', 'GND']);
    expect(DETENT_KNOB.step).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/encoder.test.ts`
Expected: FAIL (file/kind missing).

- [ ] **Step 3: Write minimal implementation**

Create `src/sim/encoder.ts` with `DETENT_KNOB` and `encoderDefinition()` per interfaces above; add `| { readonly kind: 'rotary-encoder' }` to `ComponentSpec`; emit quadrature + SW in `netlist.ts` following the joystick `SEL` open-drain pattern.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/sim/encoder.test.ts src/sim/netlist.test.ts`
Expected: PASS, including a solve test: stepping detent through 0..3 walks the Gray table and `SW` reads low only while pressed; detent clamped at min/max still yields a valid table state; `CLK`/`DT` read full-swing levels via `digitalRead`-equivalent node volts.

- [ ] **Step 5: Commit**

```bash
git add src/sim/encoder.ts src/sim/encoder.test.ts src/sim/catalog.ts src/sim/netlist.ts
git commit -m "feat: add KY-040 encoder part and quadrature model"
```

### Task 4: Artwork, catalogue, and selection wiring

**Files:**
- Modify: `src/ui/wokwi.ts` (`WOKWI_PARTS` + `wokwiPartFor`)
- Modify: `src/ui/wokwi-library.ts` (add `wokwi-ks2e-m-dc5` and `wokwi-ky-040` as `placed`)
- Modify: `src/sim/catalogue.ts` (entries `relay-dpdt`, `rotary-encoder`)
- Test: extend `src/sim/relay.test.ts` + `src/sim/encoder.test.ts` with `renderedSizeMm` assertions; reuse Task 1 library test for new tags.

**Interfaces:**
- Consumes: `relayDefinition()`, `encoderDefinition()`.
- Produces: placeable catalogue entries; `renderedSizeMm(def) == { widthMm: 21, heightMm: 10 }` for relay and `{ widthMm: 30.815, heightMm: 18.63 }` for encoder (this is what sizes the selection outline and hit area).

- [ ] **Step 1: Write the failing tests**

```ts
// in relay.test.ts
import { renderedSizeMm } from '../ui/wokwi';
it('selection box matches the relay artwork', () => {
  expect(renderedSizeMm(relayDefinition())).toEqual({ widthMm: 21, heightMm: 10 });
});
```

```ts
// in encoder.test.ts
import { renderedSizeMm } from '../ui/wokwi';
it('selection box matches the encoder artwork', () => {
  expect(renderedSizeMm(encoderDefinition())).toEqual({ widthMm: 30.815, heightMm: 18.63 });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/sim/relay.test.ts src/sim/encoder.test.ts`
Expected: FAIL (`wokwiPartFor` returns null → falls back to definition... note: relay/encoder definitions already carry these exact sizes, so if this passes early, keep the test as a lock and continue).

- [ ] **Step 3: Write minimal implementation**

`src/ui/wokwi.ts`: add `relay: { tag: 'wokwi-ks2e-m-dc5', sizeMm: { w: 21, h: 10 } }` and `'rotary-encoder': { tag: 'wokwi-ky-040', sizeMm: { w: 30.815, h: 18.63 } }`; map `case 'relay'` and `case 'rotary-encoder'`. No `pushWokwiState` props (stateless artwork v1). `src/ui/wokwi-library.ts`: add both tags as `placed`. `src/sim/catalogue.ts`: add entries (neither in `LARGE_PARTS`).

- [ ] **Step 4: Run full verification**

Run: `npm run typecheck && npm run lint && npx vitest run src/sim/relay.test.ts src/sim/encoder.test.ts src/ui/wokwi-library.test.ts`
Expected: PASS, zero type/lint errors.

- [ ] **Step 5: Commit**

```bash
git add src/ui/wokwi.ts src/ui/wokwi-library.ts src/sim/catalogue.ts src/sim/relay.test.ts src/sim/encoder.test.ts
git commit -m "feat: wire relay and encoder artwork, catalogue, selection"
```
