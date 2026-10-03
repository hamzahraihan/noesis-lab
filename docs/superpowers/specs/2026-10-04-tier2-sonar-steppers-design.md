# Tier-2 Wokwi adds: HC-SR04 sonar, stepper, biaxial stepper — Design

Date: 2026-10-04. Status: draft, pending user review.

## 1. Outcome and scope

Adopt three Tier-2 items from `@wokwi/elements` with honest simulation:
an HC-SR04 ultrasonic ranger driven through a new `pulseIn` firmware
call, a 4-wire stepper whose shaft follows raw coil sequencing, and a
biaxial stepper as two independent steppers in one package. Success is
a sketch triggering the sonar and reading centimeters back, and a sketch
bit-banging four coil pins and watching the shaft turn, all with wiring
that lands in holes and selection outlines that fit the artwork. New
firmware API is limited to `pulseIn`; steppers need none.

## 2. HC-SR04 sonar and `pulseIn`

New `sonar` component kind with pins `VCC`, `TRIG`, `ECHO`, `GND` from
the element `pinInfo` (x 71.3/81.3/91.3/101.3 px → ~18.86/21.5/24.15/
26.8 mm; y 94.5 px → 25 mm, a bottom-edge row snapped to the grid per
`modules.ts` precedent). Size 45x25. Controls: `distance` knob in cm
(min 2, max 400, step 1, default 100, the sensor's real range).
Firmware: new `pulseIn(pin, level)` global evaluated in the interpreter
beside `digitalRead`. The service finds the sonar part wired to that
MCU pin's net, computes echo microseconds as distance times 58,
honors the timeout (returns 0 past it), yields the wait the way
`delayMicroseconds` does, and returns the width. `TRIG` is a plain
digital input in v1 (the sketch's 10 us pulse is the trigger by
convention). `ECHO` rests low and is stamped high only while measuring,
from engine sonar state in the relay `pumpRelays` pattern.

## 3. Stepper (raw coil sequencing)

New `stepper` component kind with 4 pins `A-`, `A+`, `B+`, `B-` in a
row on 2.54 mm pitch from the element's default-size positions.
Size 42x42. Windings stamped as two resistors (`A+`–`A-`, `B+`–`B-`,
50 ohm class), so coils draw real current through pin output impedance.
No knobs: position is pure coil history. The engine keeps per-part
previous coil levels plus shaft angle; each solve, a valid full-step
Gray transition steps the shaft by 7.5 degrees, and invalid or jitter
transitions hold. Angle is exposed for the renderer in the `Servo.angle`
pattern and is readable in tests.

## 4. Biaxial stepper

New `biaxial-stepper` component kind: the section-3 model twice in one
package. Eight pins `A1-`, `A1+`, `B1+`, `B1-`, `A2-`, `A2+`, `B2+`,
`B2-` down one column from the element `pinXY` (x 45 px → 11.9 mm;
y 28.9 + i * 2.54 mm). Size 56x67.5. Two independent winding pairs and
two independent angle states in the engine map; either axis sequences
without disturbing the other. Artwork `wokwi-biaxial-stepper`.

## 5. Catalogue, UI wiring, tests

Catalogue (`src/sim/catalogue.ts`): `sonar-hcsr04`, `stepper-motor`,
and `biaxial-stepper` entries; biaxial marked large (drops below the
bench), the other two strip-placeable. `WOKWI_PARTS` gains all three
tags and sizes with `wokwiPartFor` mappings; `wokwi-library.ts`
converts the three `needs-api` entries to `placed`. `pushWokwiState`
sets sonar distance and stepper angles only where the elements expose
matching props, otherwise stateless artwork in v1. `PartPreview` and
selection follow from `renderedSizeMm`. Tests: sonar echo math
(2 cm → ~116 us, 100 cm → ~5800 us) plus timeout plus `pulseIn`
through the interpreter; stepper full-step walk both directions plus
jitter hold plus winding resistance; biaxial axis independence;
`renderedSizeMm` locks for all three; an engine actuation test that
sequences coils through a real MCU pin and asserts the shaft moves,
mirroring the relay firmware test.
