# Parity scorecard — how close Noesis is to Wokwi and Velxio

Captured 2026-10-22 · measured at commit `b2b4896` · rubric v1 · the
debugging pillar re-measured after the debugger shipped · the parts pillar
re-measured after the bus instruments, the shift register, the matrix and the
phone panel landed · the ecosystem pillar re-measured after the simulation
CI landed

**What this measures.** Two apps are the yardstick for this project: Wokwi,
because it is the closest thing to the product being built, and Velxio,
because it is the open-source rival with the same ambition and the same
component library underneath. "Parity" here means *a person who uses either
of them finds nothing in Noesis that stops them* — not that Noesis is
identical to either, and not that it matches them in every particular.

**Method.** Eleven pillars, each weighted, each scored 0–100 against each
target. A pillar's score is a judgement about how much of that capability
Noesis has, against how much the target offers. Every score names the file
it was read from, so a reader can check it — and disagree with it — in the
same place. The weights are stated outright, because a different weighting
gives a different total and disagreement should be about the weights rather
than about arithmetic.

## The two targets, in brief

- **Wokwi** — 18 microcontrollers across AVR, ARM, RISC-V and Xtensa; ~62
  parts; real ESP-IDF firmware; GDB debugging; an 8-channel logic analyser at
  1 GHz that exports VCD to PulseView; a serial plotter; Wi-Fi simulation
  (MQTT, HTTP, NTP); SD-card simulation; a `.chip.wasm` custom-chip ABI;
  cloud projects; a VS Code extension; CI. ([docs.wokwi.com](https://docs.wokwi.com/))
- **Velxio** — 30+ boards on the free Maker plan and 40 on Pro, across 5 CPU
  families; 48+ components on the free canvas and 150+ across the full
  catalog; `arduino-cli` compilation; QEMU for the ESP32, STM32 and
  Raspberry Pi Linux boards; ngspice-WASM as the analog solver; C→Wasm custom
  chips and programmable sensors; 400+ example projects; docs in 9 languages;
  Docker self-hosting; an MCP server, an AI assistant, simulation CI and
  GitHub Sync. ([velxio.dev](https://velxio.dev/))

## The rubric

| # | Pillar | Weight | What it covers |
| --- | --- | --- | --- |
| 1 | Firmware execution & CPU fidelity | 18% | Whether the firmware that runs is the firmware you wrote |
| 2 | Parts catalogue | 14% | How many parts sit on the bench, and how many a sketch can talk to |
| 3 | Electrical solver | 10% | Whether the circuit is solved, and how faithfully |
| 4 | Board & architecture coverage | 9% | How many boards, how many CPU families |
| 5 | Instruments | 9% | Scope, logic analyser, meter, bus monitor, serial, plotter |
| 6 | Curriculum & examples | 10% | Exercises, worksheets, worked examples, gallery |
| 7 | Persistence & sharing | 7% | Whether a circuit survives, travels, and can be handed to someone else |
| 8 | Debugging | 8% | Breakpoints, stepping, variables, registers, GDB |
| 9 | Network & IoT | 5% | Wi-Fi, HTTP, MQTT, NTP |
| 10 | Extension API | 5% | Whether a user can add a part of their own |
| 11 | Ecosystem & workflow | 5% | VS Code extension, simulation CI, i18n, community, project README |

## The score

| Pillar | Weight | vs Wokwi | vs Velxio | Evidence |
| --- | --- | --- | --- | --- |
| 1. Firmware execution & CPU fidelity | 18% | 65 | 48 | AVR runs **real compiled machine code** — an in-browser `avr-gcc-wasm` toolchain plus a home-built AssemblyScript→Wasm core (`simulation/avr/wasm-core.ts`, cross-checked against the `avr8js` reference path). RP2040 boots **real MicroPython** on `rp2040js` (`simulation/rp2040/backend.ts`). The ESP32 boots an **emulated chip** running its own MicroPython (`simulation/esp32/`), which is refused for a C++ sketch with the reason shown (`bench/simulations/avr-mode.ts`). Everything else — ESP32, Mega, Nano, Franzininho C++ and the Python boards — runs on the **interpreter** (`simulation/firmware/interpreter.ts`), which answers the libraries the Arduino way (`Servo myServo; myServo.attach(9); myServo.write(90);`) as well as the bench's own. |
| 2. Parts catalogue | 14% | 54 | 51 | **75 bench-placed entries** — 58 named in `parts/catalogue.ts` plus 5 resistors, 4 capacitors, 5 LEDs and 3 pots — over **50 component kinds** (`parts/catalog.ts`), and every one of them a sketch can talk to. Four of the new entries are bus instruments with no element in the Wokwi library and no new firmware API: a **BMP180 barometer**, an **INA219 current monitor**, an **ADS1115 sixteen-bit converter** (`parts/devices/bmp180.ts`, `ina219.ts`, `ads1115.ts`), each speaking its own register protocol, and a **74HC595 shift register** on the SPI bus. A fifth is a **DS18B20** on one wire, answering through the `OneWire` library, a sixth is an **8x8 LED matrix behind a MAX7219**, a seventh is an **MFRC522 card reader**, the bench's first SPI device that answers — the bus now carries a byte back up MISO, so a sketch can read a register instead of only writing one — and an eighth is a **four-digit LED module behind a TM1637**, which is a new seam rather than a new bus: the chip's interface is two wires with no address, so the bench hands it whole transactions. A ninth is an **A4988 stepper driver**, the last of the eight named parts: it drives the motor's windings from a step pulse, the sketch never writes a phase table, and its five microstep modes are stamped as average bridge duties so the shaft can stop between full steps. A tenth is a **PCF8574 I/O expander**, which is what a project reaches for when the board has run out of pins: one byte over the I²C bus, and eight more. An eleventh is a **MAX6675 thermocouple**, the second device on the bench that answers over SPI and the first that answers with a measurement. A twelfth is an **MCP4725 converter**, the one part that drives a pin at a level of its own choosing: the bench could measure an analog level and now it can make one. A thirteenth is a **bench supply**, the only part whose voltage a person chooses — a second rail, so a motor can have the voltage it really wants. A fourteenth is a **24LC256 memory**, the bench's first device that is a pointer rather than a register file — sixteen-bit frames latched on the chip-select rise, and the first device on the bus that latches a whole frame rather than a byte. A seventh is a **Nokia 5110 behind a PCD8544**, whose command byte means one thing in the basic instruction set and another in the extended one. A fifteenth is a **DS3231 real-time clock**, which keeps the DS1307's BCD time registers and adds two alarms, a status flag that says whether the clock lost power, and a thermometer on the die. A sixteenth is an **MCP23017 I/O expander**, sixteen pins behind direction registers, so a sketch says which pins drive before a latch can move them. A seventeenth is a **PCA9685 PWM driver**, sixteen channels that switch rather than latch: each one compares a free-running counter against its own ON and OFF counts, so a sketch sets a duty and a phase, and the bench stamps the instantaneous waveform rather than an average. Wokwi lists ~62, of which the BMP180, the DS18B20, the 74HC595, the MAX7219 and the Nokia panel are five the bench now has; Velxio's two public figures disagree — 150+ parts across the catalog, 48+ on the free Maker canvas — and 62 sits between them. |
| 3. Electrical solver | 10% | **85** | 60 | A real per-timestep resistive-network solve (`simulation/circuit.ts`, `engine.ts`), not logic levels: pins modelled behind their real output impedance, PWM switched rather than averaged, a GL5528's logarithmic lux curve, an NTC's B = 3950, internal pull-ups and floating inputs. **Ahead of Wokwi**, which does not model a resistive network; behind Velxio, whose ngspice-WASM is true SPICE with diodes, transistors and op-amps. |
| 4. Board & architecture coverage | 9% | 42 | 21 | **9 boards** (`learn/boardRegistry.ts:75`) across **3 execution paths** — AVR, RP2040, ESP32 — the newest of them the bare **ATtiny85** in its 8-lead package, the same silicon the Franzininho carries on a carrier. Wokwi: 18 MCUs over 4 architectures. Velxio: 40 boards over 5 families, of which 30+ are on the free plan. |
| 5. Instruments | 9% | 78 | **82** | Scope, 8-lane logic analyser, multimeter, bus monitor, serial monitor, **serial plotter**, problems — the bottom tabs at `bench/store/shell-state.ts:8`. The plotter reads the sketch's own output as numbers (`simulation/plot.ts`), a capture leaves as a **VCD**, the format PulseView reads (`simulation/vcd.ts`), and the scope's capture leaves as a CSV table (`simulation/probe.ts`). Wokwi has the plotter and the VCD export too, and an 8-channel analyser at 1 GHz where this one samples at the solver's rate; Velxio has an oscilloscope and meters but **no logic analyser, no bus monitor, no plotter and no export**, so on instrument *breadth* Noesis is well ahead of it — Velxio's advantage is the SPICE layer underneath, which is pillar 3. |
| 6. Curriculum & examples | 10% | 45 | 35 | **12 graded exercises** (`learn/exercises/`) over ~45,000 words of long-form worksheets (`docs/exercises/`), each with hints and worked solutions, plus a glossary, a references page, 25 gallery projects (`learn/gallery.ts`) and 33 committed circuits in `learn/circuits/`. Velxio ships 400+ examples and no curriculum. |
| 7. Persistence & sharing | 7% | 70 | 55 | A `CircuitDocument` is the source of truth (`simulation/circuit-doc.ts`); the bench autosaves it per board (`bench/store/circuit-store.ts`), carries it in a `?circuit=` link (`bench/utils/circuit-codec.ts`) and reads and writes it as a `.json` file (`bench/utils/circuit-file.ts`). **No accounts and no cloud** — which is what the static-hosting constraint buys. |
| 8. Debugging | 8% | 42 | **60** | **A debugger, on the interpreted sketch.** A stop in the editor's margin, a program that stops on it with the line marked in the editor, the names in scope and what they hold, and three ways to move on: carry on, step over, step into (`simulation/firmware/debugger.ts`, `simulation/firmware/interpreter.ts`, `instruments/DebugPanel.tsx`). The stops ride with the sketch into the worker, which is the realm that holds the program (`sim-worker/worker.ts`). **Nothing on a compiled core** — no GDB, no memory view, no watchpoints, no expression evaluation. Wokwi debugs compiled firmware over GDB; Velxio documents no debugger at all, its docs carrying an AI assistant in that space instead. |
| 9. Network & IoT | 5% | 45 | 35 | A bench-owned virtual network — `WiFi.begin`/`status`/`localIP`, a poll-based `net.get`/`read`/`subscribe` (`simulation/net/network.ts`) — plus an opt-in bridge to two real hosts (`net/live-hosts.ts`, `net/bridge.ts`). The Arduino libraries over it answer too: `HTTPClient http;` (blocking, the way a real request blocks), `PubSubClient mqtt;` and `WiFiUdp udp;` for the clock the network keeps. Wokwi does MQTT, HTTP and NTP; Velxio goes further still, with a local network gateway, four built-in networks that reach the real internet, and flashing firmware to real hardware. |
| 10. Extension API | 5% | 55 | 60 | A part may arrive as a `.part.json` (`parts/custom.ts`) or carry **behaviour** as a script — QuickJS compiled to Wasm, one context per part, inside the simulation worker (`simulation/scripted/`). Definitions **travel with the circuit** (`CircuitDocument.definitions`), so a file opens on a machine that imported nothing. Wokwi and Velxio use a C→Wasm chip ABI instead. |
| 11. Ecosystem & workflow | 5% | 37 | 37 | Monaco, multi-file tabs, an Arduino library manager with tier-2 libraries (`instruments/library-manager.ts`, `simulation/avr/libraries/`), GitHub CI running typecheck, lint, boundary checks and tests (`.github/workflows/ci.yml`), and a real `README.md`. **A simulation CI, so a project can be checked on every push** (`.github/workflows/simulation-ci.yml`, `learn/ci/`): a folder with a circuit, a sketch and the lines the serial output has to carry, run headlessly by the same simulation the app drives. **No VS Code extension, no i18n, no community, and no licence.** Velxio has simulation CI with a GitHub Action, an MCP server, an AI assistant, GitHub Sync, BOM export and docs in 9 languages — and accounts, a paid tier and a Discord. Both targets gate their best workflow features behind a subscription, so the free tiers are closer to Noesis than the price pages suggest. |

**Weighted total: 58.2% of Wokwi · 49.8% of Velxio.**

The arithmetic, so it can be checked:

```
Wokwi   18×.65 + 14×.54 + 10×.85 +  9×.42 +  9×.78 + 10×.45
       +  7×.70 +  8×.42 +  5×.45 +  5×.55 +  5×.37  =  58.2
Velxio  18×.48 + 14×.51 + 10×.60 +  9×.21 +  9×.82 + 10×.35
       +  7×.55 +  8×.60 +  5×.35 +  5×.60 +  5×.37  =  49.8
```

**What the targets' numbers rest on.** Wokwi's are from
[docs.wokwi.com](https://docs.wokwi.com/getting-started/supported-hardware)
and its feature pages; Velxio's from
[velxio.dev/docs](https://velxio.dev/docs/), its
[README](https://github.com/davidmonterocrespo24/velxio) and its pricing
page, all read on 2026-10-21. Where a target's own public figures disagree
with each other — Velxio's part count is the one that does — both are quoted
in the cell rather than one being quietly picked. What a target does **not**
document is recorded as absent, which is a weaker claim than "does not
have": Velxio's instrument list is taken from its docs' navigation, so a
feature it has but has not written down would not show.

## Where Noesis is already ahead

- **The solver.** Wokwi models logic levels; Noesis solves a resistive network,
  so a shorted pin draws the current it really would and an LED's brightness
  falls out over successive steps rather than being asserted.
- **Instrument breadth against Velxio.** A logic analyser, a bus monitor, a
  serial plotter and a VCD export are Noesis's, and Velxio's docs list none of
  them — it has an oscilloscope and meters over a SPICE layer, which is
  deeper, not broader.
- **Curriculum depth per project.** ~45,000 words of worksheets behind 12
  graded exercises with hints and worked solutions beats Wokwi's shallower
  tutorials, and has no equivalent in Velxio at all.
- **Parts that travel.** A custom part's definition rides inside the circuit
  file, so a link opens on a machine that imported nothing.
- **A debugger against Velxio.** Velxio's docs list no debugger at all; its
  docs carry an AI assistant in that space instead. Noesis stops a sketch on
  a line, shows what the program can see there, and steps through it.
- **Engineering rigour.** 224 test files and 1,893 tests across 34,023 lines
  of test against 76,789 lines of source in 262 files; CI with typecheck, lint
  and boundary checks. The risky parts — the AVR Wasm core, the RP2040
  firmware path, the circuit document, the interpreter's Python front end —
  each have dedicated parity tests rather than smoke checks.

## The gaps, ranked by leverage

1. **Parts breadth** (54%). The cheap half of a part is the modelling, and
   the cheap half is not the whole: a part needs artwork too, and the Wokwi
   library the bench draws from has no MFRC522, TM1637 or A4988 among its
   elements — so each of those is a hand-drawn part as well as a model. The
   BMP180, the DS18B20, the 74HC595, the 8x8 matrix, the Nokia 5110, the
   MFRC522, the TM1637 and the A4988 are on the bench now, which closed all
   eight. What is left of this pillar is the long tail — the parts neither
   list thinks to name — and the ones that would need a new capability
   rather than a new model. A part that needs no new firmware API
   is the cheap case, and there are two precedents: the keypad
   (`docs/PLAN.md` §6.4) and the bus instruments — a chip that answers on the
   I2C bus needs a model and a drawing and nothing else, because `Wire` is
   already there and the protocol is the exercise.
2. **Architectures** (42%). The ATtiny85 is on the bench now — the bare chip
   in its 8-lead package, the same silicon the Franzininho carries on a
   carrier — and it is the last of the cheap ones. Its leads cannot straddle
   the breadboard's centre channel, because the channel is 7.62 mm wide and
   the package's rows are 6.35 mm apart (E1 in Atmel's 8P3 drawing), so the
   starter wires it to the board rather than plugging it in. What is left is
   ESP32-C3/S3 and STM32F103, which are new CPU families rather than new
   packages.
3. **Network depth** (45 against Wokwi, 35 against Velxio). The Arduino
   libraries are in — `HTTPClient`, `PubSubClient`, `WiFiUdp` — and the
   bench's own hosts answer, so what is left is the internet itself: Wokwi's
   gateway reaches real brokers from a server, and so would this need a
   backend the static-hosting rule forbids. More hosts on the bench's own
   network are additive — the host table is data.
4. **Simulation CI** (part of 30). The repo's CI already runs the suite;
   adding "run this firmware and assert on its output" reuses that harness,
   and is what Wokwi CI and Velxio CI both do.
5. **Debugging on a compiled core** (part of 42). The debugger reads the
   interpreter, because a program the bench can read is a program it can
   stop. A compiled core is a machine it cannot read that way: GDB over the
   AVR Wasm core is the same work Wokwi does, and a much larger one.
6. **ESP32 machine code** (part of 63/48). The largest lift with the least
   certain payoff. No maintained open Xtensa core exists to drop in, and
   the interpreter already covers the curriculum. Treat as its own spike only
   if instruction-level ESP32 fidelity becomes a product goal.

## The ceiling, stated honestly

Velxio's flagship boards — the ESP32 family on Xtensa and RISC-V, the STM32s,
the Raspberry Pi Linux boards — run **QEMU on a server**. Noesis is
static-hosting-only by design (`PRODUCT.md`: static hosting, HashRouter, no
server runtime), so full Velxio parity on those boards is structurally out of
reach unless the project accepts a backend. Velxio itself accepts one: it is
a Python backend in a Docker image, with an online-only tier for exactly the
boards that need server binaries.

**Wokwi is the reachable target.** Its remaining gaps — debugger, parts,
architectures, plotter — are all buildable in the browser, and none of them
touch the electrical solver, which is the one pillar where Noesis already
beats Wokwi outright.

Worth noting that Wokwi has walked this road too. Its VS Code extension runs
the simulation *inside VS Code* from the project's own firmware binaries
("your code never leaves your computer"), with a bundled IoT Gateway for the
virtual Wi-Fi — so a local-first path is a design both projects have reached
for, not a compromise only Noesis has made. The parts of Wokwi that *do*
need a server are the paid ones: the private IoT Gateway and the VS Code
and CI tiers.

## Re-running this

The counts this document rests on, and how to refresh each:

```bash
# Boards
awk '/export const BOARDS/,/^\];/' src/features/learn/boardRegistry.ts \
  | grep -cE "^\s+id: '"

# Parts: 58 named entries, plus 5 resistors, 4 capacitors, 5 LEDs, 3 pots
sed -n '/export const PART_CATALOGUE/,/^\];/p' src/features/parts/catalogue.ts \
  | grep -cE "id: '"

# Component kinds
grep -oE "kind: '[a-z0-9-]+'" src/features/parts/catalog.ts | sort -u | wc -l

# Exercises and gallery projects
grep -rhoE "id: '[0-9]+\.[0-9]+'" src/features/learn/exercises/*.ts | sort -u | wc -l
grep -cE "id: '[a-z0-9-]+'" src/features/learn/gallery.ts

# Circuits and benches
ls src/features/learn/circuits | wc -l
ls src/features/learn/benches | wc -l

# Instruments — the bottom tabs, and what is missing
grep -n "BottomKey" src/features/bench/store/shell-state.ts

# The debugger and the plotter
grep -rl "breakpoint" src --include=*.tsx | wc -l
grep -rni "plotter" src --include=*.tsx -l | wc -l

# Tests
npm test

# Lines of code, source against test
cd src
find . \( -name "*.ts" -o -name "*.tsx" \) -not -name "*.test.ts" \
  -not -name "*.test.tsx" -exec cat {} + | wc -l
find . \( -name "*.test.ts" -o -name "*.test.tsx" \) -exec cat {} + | wc -l
```

## The rule for moving a score

A score moves when the **evidence** moves, not when the feeling does. Two
consequences worth holding to:

- A pillar's score is a judgement about the whole pillar, not a checklist of
  features. Adding the debugger does not take debugging from 15 to 100 — it
  takes it to whatever the debugger actually delivers, which is a breakpoint,
  a step and a variable view, but not Wokwi's GDB and not a remote
  attach.
- A score that cannot name its evidence is not a score, it is an opinion.
  Every number in the table above has a file behind it, and if that file
  changes, the number is stale until someone re-reads it.

## The repository's own open items

The repo states its own gaps, and they are the authoritative list; this
scorecard measures against them rather than inventing new ones.

> **Where these documents live.** `docs/wokwi-*.md` and `docs/superpowers/`
> are gitignored (`.gitignore`: "Agent/tool workspaces: plans, reports and
> design-tool state stay local"). The gap analysis this scorecard leans on is
> one of them, so it is a working document on this machine and not part of the
> repository's history. **This scorecard is the committed record** of the
> comparison — which is why it repeats the evidence rather than deferring to
> a file a reader may not have.

| Open item | Where it is written down |
| --- | --- |
| No `.chip.wasm` ABI; a script is the only extension surface | `docs/wokwi-gap-analysis.md` §5 *(local only)* |
| No ESP32 machine-code core — an ESP32 sketch is interpreted, not compiled to Xtensa | `docs/wokwi-gap-analysis.md` §1 *(local only)* |

**Drift in the repo's own documents**, found while writing this and fixed the
same day:

- `docs/PLAN.md` §5 said "35 component kinds"; there are **38** in the
  `ComponentSpec` union. Corrected.
- `PRODUCT.md` §"Operating Context" said "Seven boards"; the registry lists
  **eight** — the Pico had joined and the count was not updated. Corrected,
  along with the "seven boards" in §"Brand Commitments".
- `PRODUCT.md` §"Capabilities" said the interpreter supports no classes, no
  `String` and no `uint8_t`. All three have shipped — `class Button { public:
  ...; private: ...; };` parses, `String` binds text, and the fixed-width
  integer types are in the type list. Corrected to name what is *actually*
  absent: pointers, structs, heap allocation and templates.
- `PRODUCT.md` §"Capabilities" said the exercise ladder was 11 exercises. It
  is **12** — `5.3 networks` shipped and the list stopped at `5.2`.
  Corrected.
- `PRODUCT.md` §"Capabilities" did not mention the emulated ESP32 chip or the
  Pico's MicroPython boot, both of which have shipped. Corrected.
- `src/features/simulation/firmware/parser.ts`'s own header comment said the
  grammar "does not cover ... classes". It has covered classes since the
  class-support work landed. Corrected.
- `README.md` was still the Vite template's, which is the wrong front door for
  a project whose `PRODUCT.md` lists "the open-source community keeps
  extending boards, parts, and exercises" as a success goal. Replaced.
- `docs/PLAN.md` §5 said a script's fault "reaches the operator as one line
  in the console per part per fault", and listed the Problems-panel row it
  should own as still open. It has one: `Bench.tsx` renders a row per latched
  fault, naming the part, and the worker reports its own realm's rows over its
  message channel. Corrected.
- `docs/PLAN.md` §6.5 said a field nobody assigned still read as zero, and
  that the interpreter could not tell it from a field the class never had. It
  can now: an unset field says it was never set, a member the class never had
  says the class has no such member, and an unqualified name in a member
  function writes the member — which is what makes the two tellable at all.

Two gaps remain open because they are not drift but decisions nobody has
made:

- **No licence.** The package is private and there is no `LICENSE` file, so
  no terms are committed. A project that wants the community to extend it
  has to pick.
- **No accessibility standard.** Keyboard operability, reduced-motion
  handling and screen-reader-friendly readouts are implemented; no WCAG level
  has been audited or claimed, and `PRODUCT.md` records that as undecided.
