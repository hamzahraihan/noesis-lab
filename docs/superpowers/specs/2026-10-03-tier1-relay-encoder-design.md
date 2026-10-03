# Tier-1 Wokwi adds: Mega entry, 2-pole relay, KY-040 encoder — Design

Date: 2026-10-03. Status: draft, pending user review.

## 1. Outcome and scope

Adopt three Tier-1 items from `@wokwi/elements` with honest simulation:
missing `wokwi-arduino-mega` library entry, a 2-pole relay
(`wokwi-ks2e-m-dc5`), and a KY-040 rotary encoder (`wokwi-ky-040`).
Success is a sketch driving the relay coil with `digitalWrite` and
reading encoder `CLK`/`DT`/`SW` with `digitalRead`, with wiring landing
in holes and selection outlines fitting the artwork. No
firmware-interpreter changes; both new parts work over existing
digital APIs. Out of scope: Tier-2/3 parts (HC-SR04, steppers, DHT22,
NeoPixel, MicroSD, IR remote, dialer).

## 2. Mega library entry

One-line change in `src/ui/wokwi-library.ts`: add
`{ tag: 'wokwi-arduino-mega', sizeMm: { w: 102.66, h: 50.8 },
status: 'placed' }`. Board model, pins, and `WOKWI_PARTS.mega` already
exist (`src/sim/boards.ts`, `src/ui/wokwi.ts`). Test: assert the tag is
listed as `placed`.

## 3. Relay (both poles as wired)

New `relay` component kind with 8 pins from the element `pinInfo`
(px to mm at 96dpi): row 1 at y ~1.35 (`NO2`, `NC2`, `P2`, `COIL2`),
row 2 at y ~8.65 (`NO1`, `NC1`, `P1`, `COIL1`); x ~1.46 / 6.61 /
11.91 / 19.58. Keep artwork-true positions without grid snapping:
spacing is irregular, so snapping would pull holes off pads; record
the deviation in code per the gas-board precedent. Netlist: each coil
is a 70 ohm resistive load (~70mA at 5V); per pole, energized coil closes
`P`–`NO`, otherwise `P`–`NC`; poles independent. Rendering:
`wokwi-ks2e-m-dc5` at 21x10 via `WOKWI_PARTS` and `wokwiPartFor`;
artwork is stateless in v1, state is visible through nets/solver.
Small part, breadboard-placeable (not in `LARGE_PARTS`).

## 4. KY-040 encoder (knob turns detents)

New `rotary-encoder` kind with 5 pins from `pinInfo` (x 116px → ~30.69mm
column; y 7.9 / 17.4 / 27 / 36.3 / 45.5px → ~2.09 / 4.60 / 7.14 /
9.60 / 12.04mm for `CLK` / `DT` / `SW` / `VCC` / `GND`), column
snapped to the 2.54mm grid per `modules.ts` precedent. Controls:
`detent` knob (integer steps, min -1000, max 1000, step 1, default 0) plus momentary `SW` press.
Model: on-board pull-ups hold `CLK`/`DT` high; detent index walks a
4-state Gray cycle so `digitalRead` observes valid quadrature; `SW`
shorts to `GND` while held. Rendering: `wokwi-ky-040` at 30.815x18.63;
small part.

## 5. Catalogue, UI wiring, tests

Catalogue (`src/sim/catalogue.ts`): `relay-dpdt` and `rotary-encoder`
entries in the `input` group with wiring notes; neither added to
`LARGE_PARTS`. `WOKWI_PARTS` gains `relay` (21x10) and `rotary-encoder`
(30.815x18.63); `wokwiPartFor` maps the new kinds; `pushWokwiState`
needs no new props in v1. `PartPreview` and selection follow from
`renderedSizeMm` with no extra work. Tests: relay pole independence
plus energized (`P`–`NO`) vs resting (`P`–`NC`) continuity; encoder
quadrature walk plus `SW`-to-ground; `renderedSizeMm` equals the
definition box for both; Mega placed-entry assertion.
