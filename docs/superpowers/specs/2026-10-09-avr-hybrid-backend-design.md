# Hybrid AVR Backend — Design Spec

Date: 2026-10-09
Status: approved sections §1–§5, pending spec review
Spike basis: `G:/Temp/avr-spike/spike.cjs` (throwaway, not in repo) — avr8js@0.21.1
executes AVR machine code in Node; Uno D13 (PB5) toggles observed at exact
cycle counts via `AVRIOPort` listener. PASS.

## Intent

Run bundled Arduino Uno sketches (first: the alarm-clock gallery build) on a
real AVR CPU core (avr8js, MIT) instead of the source interpreter, while
reusing every existing peripheral and circuit model. The interpreter remains
the default; the AVR core is an opt-in alternate backend.

Success: the two live alarm-clock gallery tests pass unmodified under both
backends — `0000` at midnight, `0001` a minute later, colon blinking once a
second, `t=H:M:S` serial ticking, alarm-toggle tap working.

Non-goals (milestone one): in-browser compilation, non-Uno boards, user
sketches on the core, cycle-accurate USART/TWI hardware.

## §1 — Architecture

New module `src/features/simulation/avr/`. `AvrBackend` exposes the same
`FirmwareServices` surface `Simulation.services()` already provides, so
`Simulation`, `Engine`, `McuRuntime`, and all device models are untouched.

- `GpioBridge`: PORTx/DDRx edges → `mcu.setDirection`/`writeDigital`
  (Uno map: PORTD→gpio 0–7, PORTB→8–13, PORTC→14–19); PINx reads settle then
  sample `engine.readDigital`.
- `MmioTrap`: reserved SRAM addresses targeted by the shim core for Serial
  bytes and Wire packets; forwards to the serial buffer and
  `engine.writeI2C`/`requestI2C` against the existing `Ds1307` model.
- Timing: core advances 16,000 cycles per simulated ms, timesliced with
  `engine.settle()` at ≤1ms boundaries. Each multiplex digit holds 20ms, so
  every digit strobe is captured by the existing latch.

## §2 — Components

All new, inside `src/features/simulation/avr/`:

- `AvrBackend`: owns `CPU`, port/timer instances, cycle budget. `step(ms)`.
  Single owner of core state so timing cannot drift between bridges.
- `GpioBridge`: `AVRIOPort` listeners on B/C/D; DDR=0+PORT=1 means
  `inputPullUp`, matching AVR convention.
- `MmioTrap`: read/write hooks on two reserved addresses; encode documented
  in code. No USART/TWI hardware emulation.
- `ShimCore` (compile-time): minimal Arduino-API surface the alarm sketch
  needs (`digitalWrite/Read`, `pinMode`, `millis`/`delay` via timer0,
  `Serial`, `Wire`), real registers except Serial/Wire MMIO traps. Checked
  in as `avr/shim/` plus an offline `arduino-cli` build script; HEX assets
  under `avr/hex/`.
- `BackendSelect`: `Simulation` flag `execution: 'interpreter' | 'avr'`,
  default `'interpreter'`; avr allowed only for Uno with a bundled HEX
  present. Interpreter path unchanged byte-for-byte.

## §3 — Data flow

One 20ms alarm-loop pass:

1. `Simulation.tick` → `AvrBackend.step(budgetMs)` instead of
   `FirmwareRunner.step`.
2. Core runs ~320k cycles; GPIO edges update `McuRuntime` intent only
   (no per-write settle — same batching rationale as today's pin writes).
3. Each ≤1ms slice boundary: `engine.settle()`; `SevenSegment` latch
   captures the asserted digit; colon level and serial bytes flush.
4. Core reads (PINx): bridge settles first, returns solved level
   (≤3 extra settles per pass).
5. MMIO Wire packet: synchronous forward to `Ds1307`; response bytes staged
   for the shim's `Wire.read()`. Serial bytes append to the same lines
   buffer the interpreter feeds, keeping assertions backend-agnostic.

## §4 — Error handling

- No HEX / non-Uno board: refuse avr mode, fall back to interpreter with a
  logged reason. Never a hard error.
- Core fault (illegal opcode, PC runaway, watchdog): halt avr mode for the
  session, set `firmwareError` with PC + cycle count, fall back on next load.
- MMIO violation: trap ignores and counts; 3+ per pass escalates to a core
  fault. The `Ds1307` model is never exposed to malformed packets.
- Cycle overrun: clamp per-tick cycles, carry remainder (mirrors
  `MAX_SLICES_PER_FRAME`). Wall-clock never stalls.
- Determinism: registers, SRAM, and cycle count snapshot with the bench for
  undo. Exact reproduction in tests.

## §5 — Testing

- Parity: the two live alarm-clock gallery tests parameterized over both
  backends with identical assertions.
- Bridge unit tests (`avr/*.test.ts`): full Uno gpio bit map, pull-up
  convention, MMIO codec, budget clamp. No engine needed.
- Fault tests: corrupt HEX refused; illegal opcode → fallback +
  `firmwareError`; MMIO counter trips.
- Perf guard: existing 60s timeouts hold; per-tick budget asserted.
- No-touch rule: all 638 current tests stay green on the default backend.

## Open items (for the plan, not the design)

- Exact MMIO addresses and packet encoding.
- Offline HEX build/verify procedure and asset naming.
- Shim `millis`/`delay` timer0 prescaler wiring.
