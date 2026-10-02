# 🛠️ Brief: Web-Based Embedded Systems & Hardware Wiring Simulator (React.js)

## 📌 Project Overview

Build an interactive, web-based **Embedded Engineering & Hardware Wiring Simulator** in React.js. The application provides a realistic virtual workbench where users can practice **breadboarding, wire routing, electrical debugging, and firmware programming** for microcontrollers like the **ESP32** and **Arduino**. The app would be called "Noesis"

Unlike simple code-runners, this simulator emphasizes **hardware literacy**: managing pin footprints, understanding signal paths (VCC/GND/I2C/SPI), preventing short circuits, reading display framebuffers, and completing hands-on wiring tutorials without physical hardware risks.

---

## 🎯 Primary Learning Objectives

1. **Physical Wiring & Breadboarding:** Mastery of standard breadboard rails, pin pitch, jumper wire colors, signal routing, and avoiding common physical assembly mistakes (e.g., floating pins, missing pull-ups, shorting rails).
2. **Embedded Systems Protocols:** Practical application of **GPIO**, **ADC/DAC**, **PWM**, **I2C**, **SPI**, and **UART/Serial** interfaces.
3. **Firmware & Display Graphics:** Writing real C++/Arduino code to drive displays (ST7789/ILI9341 TFT, SSD1306 OLED, 16x2 LCD) and processing sensor telemetry in real time.

---

## 🎨 1. Photorealistic Hardware Assets & Visual Design Specs

Every component must be drawn as a **1:1 scale modular vector SVG** matching real-world pin footprints, silkscreen markings, chip packages, and interactive feedback states.

### A. Microcontroller Boards

- **ESP32 DevKit v1 (30-pin DIP):**
- **Visuals:** Matte dark grey/black PCB, metallic Wi-Fi/BT antenna, CP2102 USB bridge, micro-USB port, EN/BOOT tactile buttons.
- **Silkscreen:** Precise white pin labels (`3V3`, `GND`, `EN`, `VP`, `VN`, `GPIO2`, `TX2`, `RX2`, `SDA`, `SCL`, `MOSI`, `MISO`, `CLK`).
- **Active Indicators:** Onboard Red Power LED, Blue `GPIO2` status LED (blinks/dims on PWM).

- **Arduino Uno R3:**
- **Visuals:** Classic blue PCB, ATmega328P DIP chip, USB-B port, barrel jack, ICSP headers, power/TX/RX/L LEDs.

### B. Display Modules

- **TFT Display Panel (ILI9341 / ST7789 — 320x240):**
- **Visuals:** Red or blue carrier PCB, glass bezel, 8-pin SPI header (`VCC`, `GND`, `CS`, `RESET`, `DC`, `SDI/MOSI`, `SCK`, `LED`).
- RenderingHere is an improved, comprehensive project brief expanded to emphasize realistic hardware asset simulation, physical wiring mechanics, and broader embedded systems concepts beyond basic Arduino programming.

---

# Project Brief: Hardware & Embedded Systems Simulation Platform

## 1. Executive Summary

An interactive simulation platform designed to bridge the gap between software code and physical hardware engineering. The app allows users to learn, practice, and prototype **Arduino development, electrical wiring dynamics, and core embedded systems concepts** inside a physics-backed 2D/3D environment featuring photorealistic, interactive hardware assets.

---

## 2. Core Pillars & Value Proposition

- **Realistic Hardware Assets:** High-fidelity, interactable models of microcontrollers, sensors, actuators, passive components, and diagnostic tools (multimeters, oscilloscopes) with true-to-life pins, breadboards, and physical tolerances.
- **Physics-Based Wiring Engine:** Go beyond logical connection lines—simulate real wire management, pin tension, breadboard rails, pull-up/pull-down resistor needs, short circuits, floating pins, and voltage drops.
- **Multi-Ecosystem Embedded Systems:** Support for Arduino boards (Uno, Nano, Mega) alongside broader embedded architectures (ESP32, STM32, Raspberry Pi Pico) to teach real-world embedded practices (bare-metal registers, interrupts, low-power modes, protocol buses).
- **Safe Risk-Free Experimentation:** Real-time feedback for hardware failures, such as blown LEDs from missing resistors, fried ICs from reversed polarity, or signal distortion from loose floating connections.

---

## 3. Key Feature Modules

### A. Realistic Component Library & Visual Workbench

- **Microcontrollers:** Arduino (Uno, Nano, Mega), ESP32 (Wi-Fi/BT scenarios), STM32, Raspberry Pi Pico.
- **Peripherals & Sensors:** Ultrasonic sensors, IMUs (MPU6050), OLED/LCD screens, relays, servos, stepper motors, push buttons, potentiometers, and ambient sensors.
- **Passive & Discrete Components:** Resistors, capacitors, transistors (BJT/MOSFET), diodes, LEDs, relays, and breadboards with interactive rail connections.
- **Realistic Diagnostic Equipment:**
- **Interactive Multimeter:** Measure voltage, current, and resistance across arbitrary nodes on the circuit.
- **Logic Analyzer / Oscilloscope:** Visualize PWM signals, serial waveforms (UART, SPI, $I^2C$), and signal noise.

### B. Interactive Wiring & Physical Mechanics Engine

- **Color-Coded & Gauge-Aware Cabling:** Custom wire routes with customizable gauge, insulation colors, and length-based resistance calculations.
- **Pin & Terminal Behavior:** Interactive breadboards with internal bus rail logic, terminal blocks, screw terminals, and soldered headers.
- **Circuit Diagnostics & Fault Simulation:**
- **Floating Input Simulation:** Demonstrates why unpulled GPIO pins read erratic values.
- **Overcurrent & Polarity Protection:** Visual cues (smoke/blown icon) when components exceed maximum thermal/current constraints.
- **Debounce Dynamics:** Simulates physical tactile button mechanical chatter for learning digital debouncing.

### C. Embedded Code Editor & Hardware Debugger

- **Dual-Mode Editor:** C/C++ code editor with syntax highlighting, autocomplete, and optional block-based coding for beginners.
- **Hardware-Level Debugging:**
- Step-through execution with real-time register and GPIO state monitoring.
- Live serial monitor and plotter for sensor visualization.
- Breakpoints triggered by code lines OR hardware pin state changes (e.g., interrupt lines).

---

## 4. Target Audience & Educational Value

| Audience                         | Primary Value Delivered                                                                                                                 |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Students & Hobbyists**         | Learn circuit safety, schematic-to-breadboard translation, and code logic without buying costly physical components.                    |
| **Educators & STEM Instructors** | Pre-build lab assignments with hidden wiring bugs or failing code for students to diagnose and fix.                                     |
| **Embedded Developers**          | Prototype complex multi-protocol sensor networks ($I^2C$, SPI, UART) and verify circuit logic prior to PCB layout or physical assembly. |

---

## 5. Technical Requirements & Architecture Considerations

- **Simulation Engine:** SPICE-like fast transient circuit simulation combined with cycle-accurate micro-controller emulation (e.g., AVR/ARM instruction execution).
- **Asset Rendering:** Low-poly 3D / high-DPI Vector 2D models using WebGL/Canvas to ensure smooth web/desktop rendering while preserving component labels and pin pitch detail.
- **Extensibility:** Moddable component framework allowing users to define custom sensor behavior using JS/Lua scripting or JSON specs.

---

## 6. Implementation Decisions

Decisions taken during implementation, with the reasoning that settled them.

### 6.1 Firmware editor: Monaco

The code pane uses **Monaco Editor** (`monaco-editor` + `@monaco-editor/react`, both MIT)
rather than a plain textarea.

**Why:** bracket matching, line numbers, folding, find/replace and undo history are
what make a multi-function sketch writable rather than typeable, and every one of
them is free here. The editor is bundled rather than loaded from a CDN so the bench
works with no network, which matters for something that is otherwise entirely local.

**Language support is deliberately narrower than real Arduino.** Monaco registers an
`arduino-cpp` language whose completion list is *exactly* the set the firmware
interpreter implements -- `pinMode`, `digitalWrite`, `analogWrite`, `Serial`, `Wire`,
`SPI`, `delay`, the maths helpers and the pin constants. It does not offer
`attachInterrupt` or `tone`, because those do not run here. An autocomplete that
silently suggests a call the simulator will reject teaches the wrong thing; this
one only ever promises something that works.

### 6.2 Component artwork: Wokwi's, at true millimetre scale

Parts are drawn with **`@wokwi/elements`** -- Wokwi's own published component
library, MIT, 50+ parts as real SVG with live state properties -- integrated so
that they sit on the bench at 1:1 alongside the breadboard.

**The 1:1 requirement is load-bearing rather than aesthetic.** Holes sit on a real
2.54 mm pitch and terminals merge within 0.4 mm of each other, so every part's pin
coordinates are millimetres on that same grid -- which is what makes a lead
dropped into a hole actually connect. Artwork that disagrees with its definition's
pin coordinates gives parts that look right and wire wrongly.

**Three things make the integration work, and each was found the hard way.**

1. **The elements are HTML, not SVG.** A custom element cannot be a child of an
   `<svg>`, so each part is rendered inside a `<foreignObject>`. CSS pixels
   inside one map one-to-one onto the view box's user units, which means an
   element's own millimetre size drops into the bench's coordinate system with no
   conversion at all.

2. **`pinInfo` is in an undocumented per-element unit.** Measured across eight
   elements it is ~3.5x the view box for an Uno, 1x for an ESP32, 3.8x for a
   resistor and 3.7x for a pushbutton -- there is no global mapping to derive.
   Each adopted part therefore carries its own `mmPerPinUnit`, chosen so its pins
   land where the real hardware's pins are, and asserted against the part's own
   definition at render time so a mis-calibrated part falls back to the
   hand-authored renderer instead of drawing a jumper onto the wrong hole.

3. **The library exposes no way to find where its pins were actually drawn.**
   The Uno declares 31 pins and renders 3 circles; the LED declares 2 and renders
   none. So the calibration cannot be measured from the DOM and has to be stated.

**Where a Wokwi part is not the same part as this bench's, it is not adopted.**

- **The breadboard stays hand-authored.** Wokwi ships no breadboard element, so
  there is nothing to replace it with -- and it is the simulation's coordinate
  system besides, so swapping its artwork would mean re-basing every snap
  distance along with it.
- **The capacitor stays hand-authored.** No Wokwi equivalent.
- **The 128x64 OLED stays hand-authored.** Wokwi's is an eight-pin *SPI* module;
  this bench drives the four-pin *I2C* breakout its sketches talk to. Two
  different parts, and the pin count alone rules out the swap.

**State is pushed by property, not attribute.** Several element properties are
booleans where the attribute string `"false"` is truthy. `LED.brightness` takes
the forward bias the solver reports, `ILI9341.canvas` is painted directly from
the controller's framebuffer, and the Uno's L lamp follows digital 13.

### 6.2b Rejected: freesvg.org

CC0 public domain, but a general clip-art library aimed at Cricut cutting
machines, not an electronics component library. Its `electronics` tag is
dominated by iPods, phones, speakers and monitors; its `capacitor` tag is mostly
circuit-diagram *symbols* rather than physical parts; and there is no breadboard,
microcontroller board, seven-segment module or shift register to be found.
Individual items are CC0 and some are decent -- the electrolytic capacitor
artwork is good -- but the files carry no pin metadata and are authored at
arbitrary canvas sizes (one declares `width="210mm"`), so every pin position would
be hand-specified and every part rescaled by eye.

Worth knowing: Wokwi took the freesvg.org potentiometer and heavily modified it
rather than using it directly. The source is a starting point, not a library.

### 6.3 Jumper routing: orthogonal, on purpose

Jumpers are drawn as polylines of horizontal and vertical runs with a rounded
corner at each turn, routed along whichever axis dominates the connection and
offset onto a lane so parallel wires do not overlap.

**Why:** a bench reads as a bench because its wires turn at right angles. A
diagonal jumper from a header pin to a breadboard hole looks like a scratch on the
screen; the same jumper routed across and down, with the corner eased off, looks
like wire. This is the single largest visual difference between a plausible bench
and a convincing one, and it costs about a hundred lines rather than a dependency.
