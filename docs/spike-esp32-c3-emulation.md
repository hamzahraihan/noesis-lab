# Spike: ESP32-C3 (and S3) emulation core

Status: **Phase 1 — feasibility confirmed, integration not yet started.**
Branch: `spike/esp32-c3-emulation`

## Findings

1. **A suitable emulator already exists.** `esp32sim` (https://github.com/mikroverk/esp32sim, MIT) is a
   single Rust → WASM module covering **ESP32 (classic), ESP32-S3, ESP32-C3 and ESP32-C6**. It boots the
   real mask ROM, bootloader and an unmodified application image, and exposes a C ABI. The classic ESP32
   path in this repo already uses it (`src/features/simulation/esp32/emulator.ts`).
   - C3 is "draft" status upstream: console only, no display boards, but ROM → bootloader → FreeRTOS → app
     boots and the decoder is validated (161 k instructions vs objdump, 0 mismatches).
   - The WASM build is published at `https://mikroverk.github.io/esp32sim/web/wasm/esp32sim.wasm` and as
     GitHub releases.

2. **Chip selection is a constructor argument.** `esp32sim_new(board, …)` takes a board name string;
   `esp32c3` / `esp32s3` build the RISC-V / S3 machine instead of the classic one. `esp32sim_cpu_hz`
   reports 160 MHz (C3) vs 240 MHz (classic/S3), so pacing must be parameterised.

3. **The seam exports are shared.** The GPIO/I2C/SPI host seams the bench relies on
   (`esp32sim_gpio_out`, `esp32sim_gpio_oe`, `esp32sim_gpio_set_input`, `esp32sim_i2c_attach_host`,
   `esp32sim_spi_attach_host`) are part of the common module ABI, so the same host code transfers. The
   classic-ESP32 local patches (GPIO/I2C/SPI seams) may already be upstream now; this must be verified
   against the pinned build before relying on it.

4. **MicroPython images exist for both targets.** MicroPython ships `ESP32_GENERIC_C3` and
   `ESP32_GENERIC_S3` (v1.29.0, matching the classic pin). Mask ROMs come from `espressif/esp-rom-elfs`.

5. **No STM32F103 emulator is available in this ecosystem.** esp32sim does not cover STM32. A separate
   core (QEMU-arm-in-WASM or a Rust ARM crate) plus a full peripheral model would be required. Given the
   scorecard's own ceiling statement (static hosting, no server), STM32 emulation is out of reach without
   a backend; recommend keeping STM32 on the interpreter unless a concrete curriculum need appears.

## What the integration requires (not done in this spike)

The execution path is not a registry — it is scattered conditionals. Adding an `esp32c3` backend means
touching (per the codebase map in `src/features/bench/simulations`):

- `run-session.ts` — extend the `backend` union.
- `avr-mode.ts` — `esp32AvailableFor` (or a new `esp32c3AvailableFor`), `resolveBackendSelection`.
- `worker-client.ts` — `compileAndRun` gating.
- `Bench.tsx` — `handleRun` dispatch branch + `workerClient.setExecution`.
- `Simulation` (in-page) — guards mirroring `tryFlashAvr`.
- `sim-worker/core.ts` — `attachEsp32Async`-style `attachEsp32C3Async`, `pending` flag, `step()` dispatch.
- `sim-worker/worker.ts`, `gallery.ts` — union propagation.
- `esp32/emulator.ts`, `core.ts`, `backend.ts`, `assets.ts` — parameterise by variant (board name,
  clock Hz, flash size, I2C/SPI bus numbers, ROM + MicroPython image URLs/hashes).
- New firmware artefacts under `src/features/simulation/esp32/firmware/` (or a sibling
  `esp32c3/` directory): mask ROM ELF + MicroPython image + manifest + NOTICE.

Estimated cost: ~4–6 weeks per family for seams + tests + wiring, after a 1–2 week spike.

## Recommended next step

Phase 2 (if funded): parameterise the `esp32/` module into an `esp32-family/` module keyed by a variant
enum (`classic | s3 | c3`), with per-variant assets, and wire `esp32c3` into the execution union behind
the same MicroPython-only policy as the classic ESP32. Start with C3 (simplest ISA, console-only
peripherals match the bench's GPIO/UART needs for a first blink). Defer S3 until C3 boots, and defer
STM32 indefinitely.

## Decision needed

- Confirm C3 as the first target (vs S3).
- Confirm willingness to host ~2.5 MB of new firmware artefacts (ROM + MicroPython image) per variant.
- Confirm the seam exports are present in the pinned upstream build before committing to the integration.
