# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: students and hobbyists learning embedded systems by wiring real circuits and writing firmware on a simulated bench, without physical hardware. They arrive with little or no prior electronics experience and progress through a guided ladder from a first LED to interrupts.

Secondary audiences, implied by the product's stated success goals: educators and STEM instructors who build and assign labs (including planted faults for students to diagnose); embedded developers who prototype multi-protocol sensor networks before PCB layout or fabrication.

## Product Purpose

Noesis is a web-based embedded systems and hardware wiring simulator. It lets a user wire a circuit on a real microcontroller's footprint, write the firmware that drives it, and watch voltages and signals move while it runs — all inside the browser, with no physical hardware and no risk of damage.

Success means a beginner can travel the full exercise ladder (first LED through interrupts) using only the simulator; educators adopt it for coursework; developers use it to verify circuits and firmware before fabrication; and the open-source community keeps extending boards, parts, and exercises.

## Positioning

A neighboring product could not truthfully copy these together:

- Physics-based wiring on real footprints: every part is solved as a resistive network each frame, on true 2.54 mm pitch boards. Wiring mistakes are physical (floating pins, missing pull-ups, shorted rails), not logical connection lines.
- Firmware that actually runs: real Arduino (and Python, where supported) sketches execute against the simulated hardware, including GPIO, ADC, PWM, I2C, SPI, UART, and interrupts.
- Safe, risk-free experimentation: blown LEDs, reverse polarity, overcurrent, and short circuits are shown with visual feedback instead of destroyed hardware.
- Curriculum tied to the simulator: guided exercises from first LED to interrupts, all runnable on the bench, with wiring tables, sketches, hints, references, and worked solutions.

## Operating Context

- Runs entirely in the browser as static files; hosted anywhere that can serve static assets. HashRouter (no server rewrites). Dev and preview servers are Vite.
- Optional worker path offloads the simulation engine to a Web Worker over a SharedArrayBuffer snapshot; requires cross-origin isolation (COOP/COEP headers) on the host. Falls back silently to in-page simulation without it.
- Firmware is compiled in-browser via an AVR toolchain fetched from a CDN (requires `cross-origin-resource-policy`); works offline for everything except that compile step once cached.
- Seven boards: Arduino Uno R3, ESP32 DevKit V1, Arduino Nano, Arduino Mega 2560, Nano RP2040 Connect, Franzininho, Raspberry Pi 4. Seven boards, each with its own pin numbering and buses.
- Editor is Monaco (bundled, no CDN) with an `arduino-cpp` language whose completions are exactly the interpreter's supported subset.
- Component artwork is `@wokwi/elements` (MIT, 50+ SVG parts) integrated at true millimetre scale, plus hand-authored breadboard, capacitor, and I2C OLED.
- Instruments on the bench: multimeter, oscilloscope, logic analyser, bus monitor, serial terminal.

## Capabilities and Constraints

Confirmed capabilities:
- Resistive-network circuit solver per frame; pin-level voltage/current readout.
- Firmware interpreter for a deliberately small C++ subset (void/int/float/double/bool/char/byte/long/short/unsigned/signed, arrays, #define; no struct/enum/pointers/classes/String/uint8_t).
- Real-firmware backends alongside the interpreter: the Uno runs compiled AVR machine code (in-browser toolchain, Wasm core), and the Nano RP2040 Connect boots the pinned MicroPython UF2 on `rp2040js`, mounting the project's files as a littlefs image. Run re-mounts the current code and starts a fresh machine; Reset is the same clean boot. Selected per run from the backend selector.
- Arduino APIs the interpreter implements: pinMode, digitalWrite, analogWrite, Serial, Wire (including requestFrom/read), SPI, delay, millis, and board-specific interrupts; character LCD (HD44780), servos, and a `tft` convenience layer.
- A bench-local network: `WiFi.begin`/`status`/`localIP` with Arduino's `WL_*` codes, and a poll-based `net` port — `get`/`read` for HTTP and `subscribe`/`available`/`message` for a sensor that publishes. It is simulated, so it is deterministic and needs no internet; the answer arrives on simulated time, which is why a sketch polls for it.
- Guided exercise ladder: 11 exercises (0.1 first circuit; 1.1–1.2 GPIO; 2.1–2.2 analog; 3.1–3.2 bus protocols; 4.1–4.2 interrupts; 5.1 maps; 5.2 single-board computers).
- Project gallery per board; glossary; references page; diagnostics harness.
- Real 1:1 scale parts on 2.54 mm pitch; pin coordinates in millimetres.

Durable constraints future work must preserve:
- Offline-capable: the bench works with no network; assets bundled locally.
- Static hosting only: no server runtime; HashRouter + static files; COOP/COEP headers for the worker path.
- Real millimetre-scale parts: 1:1 components on 2.54 mm pitch; artwork must agree with pin coordinates.
- Existing interpreter subset: no invented APIs; completions only promise what runs.
- No fabrication of evidence: no invented testimonials, customers, benchmarks, pricing, licensing, or deployment claims.

Explicitly undecided:
- Accessibility standard: keyboard operability, reduced motion (prefers-reduced-motion), and screen-reader readouts are committed in code, but no formal WCAG level or audit target is named. Record a level only when confirmed.

## Brand Commitments

- Name: Noesis (also shown as "Noesis Lab" in the UI heading).
- Assets: Wokwi component library (MIT), board definitions for seven boards, the exercise ladder (0.1–5.2), long-form worksheets in docs/exercises/, project gallery data.
- No voice, personality, or visual identity is formally committed here. Visual world, palette, typography, and components belong in DESIGN.md and are owned by new-work/document, not init.
- References the user explicitly made binding: none beyond the above.

## Evidence on Hand

Real content, data, and assets (with paths):
- docs/PLAN.md — project brief and implementation decisions (Monaco, Wokwi parts, jumper routing, boards).
- docs/exercises/ — long-form worksheets for every module (module-0 through module-5).
- src/features/learn/exercises/ — the app-facing exercise data (0.1–5.2).
- src/features/learn/boardRegistry.ts — board list and editorial lines.
- src/features/parts/ — board and part definitions with pin tables.
- src/features/simulation/mcu.ts — per-board bus/pin tables.
- src/index.css — incumbent visual system (instrument-console tokens).
- public/ and src/assets/ — favicons, hero image, SVGs.

Absences future work must not fabricate:
- No real testimonials, named customers, case studies, or press.
- No benchmarks, performance claims, or measured metrics beyond what tests assert.
- No pricing, licensing terms, or commercial offering.
- No production deployment URL or hosting claim (static-hosting doc describes requirements only).

## Product Principles

1. Hardware literacy over code-running: wiring and physical mistakes are the lesson, not an obstacle to skip.
2. Truth in simulation: every number on a card or readout comes from the same definition the bench runs; the UI cannot advertise what the simulator does not do.
3. Safe failure teaches: blown parts and bad wiring are shown, not hidden, and cost nothing.
4. Curriculum and bench are one product: exercises run on the simulator they describe.
5. Offline-first and static-hostable: no server runtime, no required network for the bench itself.

## Accessibility & Inclusion

Keyboard operability for the bench, respect for prefers-reduced-motion, and screen-reader-friendly numeric readouts are committed in code (focus-visible rings, reduced-motion animation disabling, tabular-nums readouts). No formal standard (e.g. WCAG level) or audit target is named yet; record one only when confirmed. No product-specific user needs beyond general web best practice are established.