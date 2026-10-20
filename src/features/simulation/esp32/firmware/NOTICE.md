# Third-party notices

The artefacts in this directory are pinned, unmodified, and each keeps its own
licence. The manifest beside them records the source, the version and the
SHA-256 of every file.

| File                                 | What it is                                                                                                                                                                                                    | Licence    | Copyright                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------- |
| `esp32sim.wasm` | The WebAssembly build of [esp32sim](https://github.com/mikroverk/esp32sim), an instruction-level ESP32 emulator: it boots the chip's own mask ROM, the second-stage bootloader and an unmodified application. This copy is built from upstream commit `964c26c` with the local patch in `../patches/`, which adds the three exports a bench needs to read what the chip drives and to drive what it reads; `scripts/build-esp32-wasm.mjs` rebuilds it. | MIT | Joakim Eriksson, Alice, Mattia Fiumara and the esp32sim contributors. |
| `esp32_rev300_rom.elf`               | The ESP32 rev 3.0 mask ROM, from [espressif/esp-rom-elfs](https://github.com/espressif/esp-rom-elfs) (release `20260528`).                                                                                    | Apache-2.0 | Espressif Systems.                                                    |
| `ESP32_GENERIC-20260824-v1.29.0.bin` | The official MicroPython image for the `ESP32_GENERIC` variant, from [micropython.org](https://micropython.org/download/ESP32_GENERIC/).                                                                      | MIT        | The MicroPython contributors.                                         |

The esp32sim module also carries Espressif's ADC calibration coefficients
(Apache-2.0, `esp-periph/LICENSE-ADC` upstream), and the MicroPython image
links Espressif's Wi-Fi and PHY libraries, as the upstream
`tdisplay-NOTICE.txt` records.

esp32sim is unofficial and not affiliated with Espressif Systems.
