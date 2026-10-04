# MicroSD card sub-project — Design

Date: 2026-10-04. Status: draft, pending user review. Last Tier-3
sub-project; Tier-3 is complete with it.

## 1. Outcome and scope

Adopt the MicroSD breakout (`wokwi-microsd-card`) as a flat-file card:
sketches create, read, check, and delete named text files through a new
`sd` firmware port, backed by a per-part in-memory store. FAT, the SPI
command protocol, and binary files are explicitly not modeled in
v1 -- acknowledged limits, recorded in code. Success is a datalogger
sketch whose file survives a reflash.

## 2. Card part

New `microsd` component kind with 7 pins down one column from
`pinInfo` (x 76.734 px → 20.3 mm; y 9.37/18.86/28.46/38.18/47.63/
57.46/66.91 px → ~2.48/4.99/7.53/10.10/12.60/15.20/17.70 mm, snapped
to the grid). Order `CD`/`DO`/`GND`/`SCK`/`VCC`/`DI`/`CS`, with `GND`
on the internal ground net. Size 21.6x20.4. No knobs, not momentary.
Artwork stateless. Netlist: ground topology only, everything else
unstamped -- files live in the engine store, not the circuit.

## 3. `sd` port and engine store

New optional `SdPort`, following `DhtPort`: `begin(pin)` → 1/0,
`write(pin, name, text)` → bytes written (0 past the cap or unwired),
`read(pin, name)` → text ("" missing/unwired), `exists(pin, name)` →
1/0, `remove(pin, name)` → 1/0. Text files only in v1. The interpreter
maps `sd.*` member calls; lookup mirrors `dhtOnPin` on the `CS` net
and fails closed without a part. The engine owns
`Map<partId, Map<name, text>>` capped at 1 MB per card, created lazily
on first write and pruned only when the part leaves the bench -- files
survive reloads and rebuilds like a real card. `CD` is topology-only
in v1 (always inserted while placed).

## 4. Catalogue, UI wiring, tests

Catalogue `microsd-card` in the `input` group with a note covering
the flat-file API and the lifetime rule; strip-placeable.
`WOKWI_PARTS.microsd` at 21.6x20.4 with a `wokwiPartFor` mapping;
`wokwi-library.ts` flips `wokwi-microsd-card` to `placed`.
`pushWokwiState` sets nothing. Selection and preview follow from
`renderedSizeMm`. Tests: definition pins; port round-trip through the
interpreter against a stub service; an end-to-end `Simulation`
datalogger sketch that writes, reflashes, and reads back; unwired-pin
closed failures; over-cap write returns 0; removal clears the store;
`renderedSizeMm` and tag locks.
