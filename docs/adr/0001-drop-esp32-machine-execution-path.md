# ADR-0001: Drop the esp32-machine execution path

Status: Accepted
Date: 2026-11-10

## Context

The `esp32-machine` execution arm came from a spike. It was never selectable: no
gallery project, board or build set `execution: 'esp32-machine'`, and
`gallery-projects.schema.json` never allowed the value. Its backend stubbed
`readPin()` to false, no-op'd `onEdge` and `onSettle`, and fetched asset URLs that
do not exist in the repo layout.

The real blocker is the toolchain. Compiled C++ for ESP32 needs an Xtensa
toolchain. None exists on this machine — no `arduino-cli`, no
`xtensa-esp32-elf-gcc`, no ESP-IDF — and none exists in-browser. The project is
static-hosted by rule, so there is no compile server either. A user's ESP32 C++
sketch therefore can never be compiled at runtime.

We measured the one alternative, `esp32-emu@1.2.0`. It does boot this repo's
pinned MicroPython v1.29.0 image on a real Xtensa LX6 core; verified in Node:
init 518 ms, REPL at 14.4 s, `sys.implementation.version` = `(1,29,0,'')`. But
its REPL boot is about 6x slower than the current path
(`src/features/simulation/esp32/boot.test.ts` runs two full
boot-ROM-to-MicroPython boots in 5.04 s, about 2.5 s each). It also spawns a
nested Worker from its own package dist inside our existing sim-worker, and it
adds no C++ capability.

The path already in the repo is real. `src/features/simulation/esp32/` boots the
chip's own mask ROM, the second-stage bootloader and unmodified MicroPython on
`esp32sim.wasm`, with GPIO, I2C and SPI seams into the bench. Boot, sketch, I2C
and SPI tests cover it. That is real Xtensa machine code already.

## Decision

Remove the `esp32-machine` execution type from the worker, bench and learn
unions. Delete `src/features/simulation/esp32-machine/`. Drop the `esp32-emu`
dependency. Refuse ESP32 C++ sketches with a reason that names the missing
toolchain.

## Consequences

ESP32 C++ sketches stay refused, now with an accurate reason instead of a
half-built backend. ESP32 Python keeps running on the emulated chip. The
execution type union no longer advertises a backend nobody can reach.

## Revival triggers

- A maintained in-browser or host Xtensa toolchain that can produce an ESP32
  image at runtime without a server.
- An emulator that can boot a compiled image in under about 5 s without a nested
  worker.
- An accepted server-side compile backend, which would overturn the
  static-hosting rule.

## References

- `src/features/simulation/esp32/` — the live emulated-chip path.
- `src/features/simulation/esp32/boot.test.ts` — boot timing measurement.
- `src/features/simulation/esp32-machine/` (deleted) — the spike backend this ADR
  removes.
- `src/features/learn/gallery-projects.schema.json` — never allowed
  `esp32-machine`.
