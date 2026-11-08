# Design: ESP32 machine code via esp32-emu

## Problem

The ESP32 execution path runs MicroPython on an emulated chip (`simulation/esp32/`). A C++ sketch for the ESP32 is refused with a reason shown (`bench/simulations/avr-mode.ts`). The scorecard (pillar 1, gap #6) flags ESP32 machine code as "the largest lift with the least certain payoff" and says to treat it as a spike.

A maintained Xtensa core now exists: `esp32-emu@1.2.0` (MIT, published 2026-10-05) provides a WASM-compiled Xtensa LX6 core with native peripherals, runnable from Node.js and web workers. It also ships a `GDBSession` class for GDB remote protocol.

## Goal

Replace the interpreted ESP32 path with real Xtensa machine code for C++ sketches, matching how AVR runs real compiled machine code via `avr-gcc-wasm`. Python sketches continue to run MicroPython on the emulated chip.

## Approach

### Option A: Full replacement (recommended)

Replace the existing ESP32 backend (`simulation/esp32/`) with `esp32-emu`. The new backend:
- Boots the Xtensa core with a flashed firmware image
- Runs compiled Xtensa machine code
- Bridges GPIO/I2C/SPI/serial through the existing `Esp32Hooks` interface
- Provides source-level debugging via the package's `GDBSession`

### Option B: Side-by-side (lower risk)

Keep the existing ESP32 backend for MicroPython. Add a new execution path `'esp32-machine'` that uses `esp32-emu` for compiled C++ sketches. The board picker chooses based on sketch language.

### Option C: Spike first (lowest risk)

Install `esp32-emu`, create a minimal proof-of-concept that boots the emulator and runs a blink sketch. Evaluate feasibility before committing to full integration.

## Recommended: Option C → Option A

Start with a spike (Option C) to validate that `esp32-emu` works in our build pipeline (Vite, COOP/COEP headers, SharedArrayBuffer). If it works, proceed to full replacement (Option A).

## Architecture changes

### New files
- `src/features/simulation/esp32-machine/backend.ts` — backend class wrapping `esp32-emu`'s `SimulatorWorker`
- `src/features/simulation/esp32-machine/assets.ts` — fetch and cache the WASM/ROM assets
- `src/features/simulation/esp32-machine/core.ts` — integration with the sim-worker's step/settle model

### Modified files
- `src/features/simulation/sim-worker/core.ts` — add `'esp32-machine'` execution path
- `src/features/simulation/sim-worker/worker.ts` — add execution type, async attach
- `src/features/parts/boards.ts` — ESP32 board gets `execution: 'esp32-machine'` for C++ sketches
- `src/features/bench/simulations/avr-mode.ts` — allow C++ sketches on ESP32 (no longer refused)
- `vite.config.ts` — add COOP/COEP headers for SharedArrayBuffer

### Firmware compilation
- ESP32 C++ sketches need an Xtensa toolchain (`xtensa-esp32-elf-gcc`)
- This is a new toolchain dependency, similar to `avr-gcc-wasm` for AVR
- The bench would need to compile sketches to Xtensa ELF and flash them

### Cross-origin isolation
- `esp32-emu` requires `SharedArrayBuffer`, which needs COOP/COEP headers
- The bench already sets COEP `require-corp` (per network.ts comments)
- Need to add COOP `same-origin` header

## Feasibility concerns

1. **Firmware compilation**: The bench currently compiles AVR sketches via `avr-gcc-wasm`. ESP32 would need `xtensa-esp32-elf-gcc`, which is a much larger toolchain (~100MB). This may not be feasible in-browser.
2. **Asset size**: `esp32-emu` ships 3.8MB of WASM + ROM. This adds to the initial load time.
3. **SharedArrayBuffer**: Requires cross-origin isolation, which may break existing features (map tiles, live hosts).
4. **MicroPython coexistence**: The existing ESP32 backend runs MicroPython. Replacing it means Python sketches need a different path (interpreter or MicroPython on the new emulator).

## Spike plan (Option C)

1. Install `esp32-emu` as a dev dependency
2. Create a minimal test that boots the emulator in a browser (Vite + COOP/COEP)
3. Run a simple blink sketch (compiled Xtensa ELF)
4. Evaluate: boot time, step performance, pin bridging feasibility
5. Report findings as a recommendation

## Scorecard impact

If successful, this would move:
- Pillar 1 (Firmware execution): 65 → ~80 (ESP32 runs real machine code)
- Pillar 4 (Architectures): 46 → ~60 (ESP32 family gains real CPU)
- Gap #6 (ESP32 machine code): closed

## Open questions

1. Can `esp32-emu` run a compiled ESP-IDF or Arduino sketch? (Needs Xtensa ELF, not just MicroPython)
2. How does pin bridging work? (GPIO → McuRuntime)
3. Can the emulator run in the existing sim-worker (which already uses SharedArrayBuffer)?
4. What's the memory footprint? (3.8MB WASM + ROM)
5. Does cross-origin isolation break existing features?

## Spike findings (2026-11-08)

**Confirmed working:**
- `esp32-emu@1.2.0` loads and boots in Node.js (tested)
- `ESP32` class: `loadROM()`, `loadWasm()`, `reset()`, `step(n)` work
- PC starts at `0x40000000` (boot ROM entry), advances on `chip.step(n)`
- `chip.cycles` increments correctly
- `core.PC` (uppercase) exposes the program counter
- `chip.step()` is on the `ESP32` instance, not on the core
- Memory regions (flash, IRAM, PSRAM) accessible via `chip.memory` (SharedArrayBuffer)
- Two cores available via `chip.cores[0]` and `chip.cores[1]` (XtensaCore instances)
- `XtensaCore` properties: `PC`, `running`, `stopped`, registers, etc.
- No `core.step()` — stepping is on the `ESP32` instance
- UART debug output shows full peripheral initialization (UART, I2C, SPI, GPIO, etc.)

**Build requirements:**
- Vite bundler for browser (COOP/COEP headers required for SharedArrayBuffer)
- Cross-origin isolation headers: `COOP: same-origin`, `COEP: require-corp`
- Assets: 3.8MB WASM + ROM + boot ROM (loaded at runtime)
- Worker thread entry: `dist/sab/worker-entry.js` (needs Vite worker config)

**Firmware compilation challenge:**
- Needs `xtensa-esp32-elf-gcc` toolchain (not in-browser currently)
- Would need to compile Arduino/ESP-IDF sketches to Xtensa ELF
- Could use existing `avr-gcc-wasm` pattern but for Xtensa (much larger toolchain)
- Alternative: pre-compiled firmware blobs for example projects
