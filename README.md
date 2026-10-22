# Noesis

**Wire it. Run it. Watch it move.**

Noesis is an embedded-systems workbench in the browser. You wire a board onto a
breadboard at true millimetre scale, write the firmware that drives it, and
watch the voltage move while it runs — no hardware, no damage, no bill.

The point is not that the code compiles. It is that a shorted LED, a missing
pull-up, a floating input and a wrong I²C address are all *physical* mistakes
here, and the bench shows each one instead of hiding it.

Everything runs in the page. The bench is static files; there is no server
runtime, and once the toolchain has been fetched once it works offline.

## What is on the bench

**Eight boards**, each with its own pin numbering, its own buses and its own
traps: Arduino Uno R3, ESP32 DevKit V1, Arduino Nano, Arduino Mega 2560, Nano
RP2040 Connect, Raspberry Pi Pico, Franzininho, Raspberry Pi 4.

**Firmware that really runs.** Four paths, chosen per run from the backend
selector, which refuses a mode the board or the sketch cannot use and says
why:

| Backend | Boards | What actually executes |
| --- | --- | --- |
| AVR | Uno | Real compiled machine code — an in-browser AVR toolchain and a home-built Wasm CPU core, cross-checked against the `avr8js` reference path |
| RP2040 | Nano RP2040 Connect, Pico | The pinned MicroPython build, booted on `rp2040js`, with the project's files mounted as a littlefs image |
| ESP32 chip | ESP32 | An emulated Xtensa chip running its own MicroPython, with GPIO, I²C and SPI seams into the bench |
| Interpreter | all of them | A C++/Python front end over a generator-based VM — the fallback for boards with no machine-code core |

**Sixty-eight parts** over forty-four component kinds, drawn at 1:1 on
2.54 mm pitch: LEDs and matrices, 7-segment and LCD and OLED and TFT panels,
servos, steppers, a stepper driver, relays, a keypad, a rotary encoder,
potentiometers, buttons, sensors over I²C and one-wire, an I/O expander, a
card reader over SPI, a four-digit display behind two wires, and a breadboard
whose holes are the ones the wires actually land in.

**Instruments** — an oscilloscope, an 8-channel logic analyser, a multimeter, a
bus monitor, a serial monitor and a serial plotter. The analyser draws the
square wave the solver produced, not the samples between edges, and a capture
leaves as a VCD that PulseView reads.

**A debugger.** Set a stop in the editor's margin and the sketch stops there:
the panel says where it is, what it can see from there, and carries on, steps
over the call, or steps into it.

**Twelve exercises**, from a first LED to interrupts, each runnable on the
bench it describes, with long-form worksheets, hints and worked solutions.

**A circuit that travels.** The document is the source of truth: it autosaves
per board, rides in a share link, and reads and writes as a `.json` file. A
custom part's definition travels inside it, so a link opens on a machine that
imported nothing.

## Getting started

Requires **Node 24** and npm.

```bash
npm install
npm run dev
```

Then open the printed URL. The bench opens on the Uno with a starter circuit
wired and a sketch loaded.

## The checks

```bash
npm run check          # typecheck + lint + boundary gate + the whole suite
```

or individually:

| Command | What it does |
| --- | --- |
| `npm run dev` | The dev server, with the worker path's isolation headers already set |
| `npm run build` | Typecheck and a production bundle into `dist/` |
| `npm run preview` | Serve the built bundle the way a static host would |
| `npm test` | The full Vitest suite — 217 files, 1,807 tests |
| `npm run test:watch` | The same, in watch mode |
| `npm run typecheck` | `tsc -b` |
| `npm run lint` | oxlint |
| `npm run format` | oxfmt over `src` and `scripts` |
| `npm run check:boundaries` | The architectural gate — features may not reach across each other |
| `npm run build:wasm` | Rebuild the AVR Wasm core from `simulation/avr/wasm/` |

The boundary gate is worth knowing about: it fails the build if one feature
reaches into another's internals, so the seams stay seams.

## Hosting it

The app is static files with a `HashRouter`, so any host that can serve files
will do. One exception: the **simulation worker** offload needs the page to be
cross-origin isolated, which means two response headers on every response:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Without them the bench still runs — the engine falls back to simulating in the
page — but the worker path stays dark. `docs/static-hosting.md` has the details
per host.

## Where things live

```
src/
  features/
    bench/         the workbench: canvas, wiring, editor, panels, stores
    simulation/    the engine — solver, netlist, firmware, backends, worker
    parts/         board and part definitions, and the custom-part registry
    instruments/   scope, logic analyser, multimeter, bus monitor, editor
    learn/         exercises, gallery, projects, glossary, references
  routes/          one file per route
docs/
  PLAN.md          the brief and the decisions taken along the way
  exercises/       long-form worksheets, module 0 to module 5
  parity-scorecard.md   how the bench compares to Wokwi and Velxio
```

Two conventions worth knowing before you read the code:

- **The circuit is data.** `simulation/circuit-doc.ts` defines the document;
  the canvas edits it, the bench is a projection of it, and undo is a stack of
  documents rather than a stack of inverse operations.
- **Nothing claims a capability the simulator does not have.** The editor's
  autocomplete offers exactly the subset the interpreter implements. A call
  the bench cannot make raises, with a name, rather than answering zero.

## Status

In development, and honest about where it stands: `docs/parity-scorecard.md`
scores the bench against Wokwi and Velxio pillar by pillar, names the file
behind every score, and lists the gaps that are still open.

Two things are deliberately *not* settled yet, and both are recorded rather
than assumed:

- **No licence has been chosen.** The package is private and the repository
  carries no `LICENSE` file, so no terms are committed. Anyone who wants to
  reuse or extend this should raise it first.
- **No accessibility standard is named.** Keyboard operability, reduced-motion
  handling and screen-reader-friendly readouts are implemented, but no WCAG
  level has been audited or claimed.

## Credits

Component artwork is **[@wokwi/elements](https://github.com/wokwi/wokwi-elements)**,
MIT — Wokwi's own published library, integrated at true millimetre scale so a
part's pins and its picture agree. The breadboard, the capacitor and the
four-pin I²C OLED are hand-authored, because Wokwi ships no breadboard and its
OLED is a different part — eight pins and SPI, where this bench drives the
breakout a sketch actually talks to.
