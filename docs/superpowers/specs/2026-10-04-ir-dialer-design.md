# IR remote + dialer sub-project — Design

Date: 2026-10-04. Status: draft, pending user review. Third Tier-3
sub-project; MicroSD remains a separate spec.

## 1. Outcome and scope

Adopt the IR remote (`wokwi-ir-remote`) and the rotary dialer
(`wokwi-rotary-dialer`) with honest behavior: a held remote key pulls
`DAT` low on bench receivers with its NEC code readable through a new
`ir` port, and a dialed digit latches readable through a new `dialer`
port. Carrier bursts and pulse trains are explicitly not modeled in
v1 -- acknowledged limits, recorded in code.

## 2. Remote and air-link

New `ir-remote` kind with no pins (handheld, battery -- the first
pinless part; `pins: []`, netlist contributes nothing). Size
40x83.653. Controls: a `key` knob indexing the element's 20-key NEC
table (default 0) plus `momentary: true`, so press-and-hold transmits
and release ends it through the existing `isPressed` mechanism. The
engine holds `irTransmitting: { code, untilMs } | null`: set while any
remote is pressed (lowest part order wins), released 200 ms after
release for the decode window. Artwork stateless.

## 3. Receiver link and `ir` port

The receiver keeps its `IR_CODE_KNOB` behavior, OR-ed with the
air-link: `DAT` pulls low when the knob is on or a transmission is
live. New optional `IrPort` with `readCode(pin): number`, following
`DhtPort`; the interpreter maps `ir.*` member calls; lookup mirrors
`dhtOnPin` on the receiver's `DAT` net and returns the live NEC code
or 0. The service sets the transmission flag and settles before
returning, the way `pulseInBegin` arms ECHO -- no re-solve loop is
needed because nothing downstream feeds back into the same solve.

## 4. Dialer and `dialer` port

New `rotary-dialer` kind with 3 pins `GND`/`DIAL`/`PULSE` from
`pinInfo` (x ~32.29/34.83/37.36 mm, y ~75.67 mm bottom-edge row,
snapped). Size 70.4x75.6. Controls: a `digit` knob (0-9, default 0)
plus `momentary: true` dial action. The engine keeps `dialedDigit`
per part (relay-map pattern, pruned on rebuild): while held it tracks
the digit knob. New optional `DialerPort` with `read(pin): number`
returning it, -1 before the first dial. `pushWokwiState` sets the
element's own `digit` prop live with no new plumbing. `PULSE` stays
topology-only in v1.

## 5. Catalogue, UI wiring, tests

Catalogue `ir-remote` and `rotary-dialer` in the `input` group, both
marked large (below-bench: the remote is pinless, the dialer is
70 mm wide). `WOKWI_PARTS` gains both tags with verified sizes and
`wokwiPartFor` mappings; `wokwi-library.ts` flips both to `placed`.
Selection and preview follow from `renderedSizeMm`. Tests: the
20-code key table; end-to-end transmission (DAT low + right code,
release returns high + 0); receiver-knob behavior untouched; dialer
latch, -1-before-dial, and `digit` state; unwired-pin ports return
0/-1; `renderedSizeMm` and tag locks for both.
