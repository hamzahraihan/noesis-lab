# NeoPixel family sub-project — Design

Date: 2026-10-04. Status: draft, pending user review. Second Tier-3
sub-project; IR remote + dialer and MicroSD remain separate specs.

## 1. Outcome and scope

Adopt the WS2812 family (`wokwi-neopixel`, `wokwi-neopixel-matrix`,
`wokwi-led-ring`) with a pixel-buffer port: sketches set LED colors
through a new `pixels` firmware API and the single NeoPixel shows them
live. The 800 kHz waveform is explicitly not modeled in v1 -- an
acknowledged limit, recorded in code -- and matrix/ring colors stay
stateless artwork because their elements expose no per-pixel color
props from outside. Success is a sketch painting a single pixel's
color; matrix and ring place, wire, and select correctly.

## 2. Single NeoPixel and `pixels` port

New `neopixel` component kind with 4 pins from the element `pinInfo`
(`VDD`, `DOUT`, `VSS`, `DIN`, converted at 96dpi and snapped to the
grid). Size 5.6631x5. New optional `pixels` service port, following
`DhtPort`: a per-part LED array with `setColor(pin, index, r, g, b)`
and `count(pin)`; the interpreter maps `pixels.*` member calls beside
the `dht.*` handler; lookup mirrors `dhtOnPin` on the `DIN` net, and
unwired pins are a no-op. `pushWokwiState` paints the element's `r`,
`g`, `b` props live. Netlist: `DIN` is a high-impedance input with
nothing stamped; `VDD`/`VSS` are topology only. `DOUT`
daisy-chaining is out of scope in v1.

## 3. Matrix and ring, stateless

New `neopixel-matrix` and `led-ring` kinds with their 4-pin
`GND`/`VCC`/`DIN`/`DOUT` rows from each element's `pinInfo` (2.54 mm
pitch). Sizes come from the elements' own render math, verified at
implementation time rather than trusted from the library table, whose
25x25 entries disagree with the matrix width formula (8x8 default).
`DIN` high-Z, supply topology-only, no live colors: matrix renders a
static pattern with internal animation state and the ring takes a
pixel count, neither settable from outside. If a settable color API
turns up during implementation, the section-2 port extends to it
without changing this plan's shape.

## 4. Catalogue, UI wiring, tests

Catalogue `neopixel`, `neopixel-matrix-8x8`, and `led-ring-16` in the
`output` group; matrix and ring marked large (below-bench). `WOKWI_PARTS`
gains all three tags with implementation-verified sizes and
`wokwiPartFor` mappings; `wokwi-library.ts` flips all three to
`placed` with corrected sizes. Selection and preview follow from
`renderedSizeMm`. Tests: definition pins; port set/get through the
interpreter against a stub service; an end-to-end `Simulation` sketch
painting one pixel and asserting the element-facing state; unwired-pin
no-op; floating-`DIN` supply-topology sanity; `renderedSizeMm` and tag
locks for all three.
