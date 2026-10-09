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
second, `t=H:M:S` serial ticking, alarm-toggle tap working. User sketches
compile in-browser to HEX and run on the core.

Non-goals (milestone one): non-Uno boards, cycle-accurate USART/TWI
hardware (Serial/Wire stay paravirtualized per §1).

## §1 — Architecture (revised)

New module `src/features/simulation/avr/`, organized around one new seam:

- `ExecutionBackend` interface — `step(budgetMs)`, `reset()`, readonly
  `fault`. `Simulation` programs to this. The interpreter gets a thin
  adapter wrapping `FirmwareRunner`; `AvrBackend` implements it natively.
  What the backends share is not a call surface but the device seams:
  `McuRuntime` intent, `engine.settle()`, the serial buffer,
  `engine.writeI2C`/`requestI2C`, and the `Ds1307` model.
- `AvrBackend` owns `CPU` + port/timer instances + cycle budget.
  `GpioBridge` pushes PORTx/DDRx edges into `McuRuntime` (Uno map:
  PORTD→gpio 0–7, PORTB→8–13, PORTC→14–19) and serves PINx reads via
  settle-then-sample. `MmioTrap` forwards Serial/Wire to the shared seams.
- Timing: cycles/ms derived from the board clock (Uno 16MHz → 16,000), not
  a constant. Timeslice settles at ≤1ms boundaries bound button latency and
  keep `delay(20)` accurate to ~5%; display capture is independent of this
  rate because the digit latch reads `McuRuntime` intent, which persists
  between solves. Timer0 (`millis`) advances via avr8js clock events inside
  the same `avrInstruction`+`tick` loop the spike proved — no separate timer
  thread.
- `Toolchain` (in-browser compilation): WASM-packaged AVR GCC + avr-libc +
  Arduino core running in a worker. Sketch + shim headers in, HEX out;
  compiled cores cached in IndexedDB. If the toolchain is unavailable or a
  build fails, bundled precompiled HEX (built offline, checked in) keeps the
  gallery running — compilation degrades, execution does not.

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
  default `'interpreter'`; avr allowed only for Uno with HEX available
  (bundled or just compiled). Interpreter path unchanged byte-for-byte.
- `Toolchain` (worker): accepts sketch sources + board id, returns HEX bytes
  or structured errors mapped to source lines where possible. Compiled
  Arduino core + bundled libraries cached; per-sketch builds link against
  the cache. Runs off the UI thread; progress + cancellation surfaced.

## §3 — Data flow

Edit → compile → flash → run:

1. `loadFirmware` with `execution: 'avr'`: `Toolchain.compile(sources)`
   (worker, cached core) → HEX → `AvrBackend.flash(hex)` (loads progMem,
   resets CPU). Bundled gallery builds may skip to flash with checked-in HEX.
2. `Simulation.tick` → `AvrBackend.step(budgetMs)` instead of
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
- Toolchain tests: compile a Blink fixture → byte-identical HEX to the
  checked-in reference; error fixture (missing `setup`) → structured error
  with source line; core cache hit avoids recompiling the core on a second
  build.
- No-touch rule: all 638 current tests stay green on the default backend.

## Open items (for the plan, not the design)

- Exact MMIO addresses and packet encoding.
- WASM toolchain packaging choice (avr-gcc build vs. prebuilt bundle) and
  IndexedDB cache schema.
- Shim `millis`/`delay` timer0 prescaler wiring.
