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
  **JSON half shipped** (2026-10-18): a part is a `.part.json` over one of the 35
  component kinds the simulator implements — geometry, parameters, pins, knobs and
  colours, validated at import and resolvable by the compiler like any shipped
  part. **Scripting half shipped** (2026-10-19, spec
  `docs/superpowers/specs/2026-10-19-behaviour-parts-design.md`): a `scripted`
  component kind whose answer comes from a script running in QuickJS compiled to
  WebAssembly -- one context per part, the host's simulated clock and a seeded
  PRNG, a per-call budget, and a latched safe state with a diagnostic rather than
  a silent value (spec §5). It speaks three buses: an analog fraction, a digital
  level, or an I2C slave answering register reads and writes at the address its
  file declares. The runtime loads lazily — 492 KB of WASM behind a dynamic
  import, fetched the first time a bench holds a part that has a script — and a
  fault reaches the operator as one line in the console per part per fault.
  It was deferred because it needed an ABI over the solver's `Element[]`, a sandbox
  that cannot touch the DOM, worker-safe evaluation, and a story for a user module
  that throws mid-solve; the spec answers those four. A circuit now **carries the
  parts it uses** (`CircuitDocument.definitions`), so a file or a share link
  opens on a machine that never imported anything — which is what a gallery
  example needs. **Worked example shipped** (2026-10-20): the gallery's *Soil
  Moisture Probe* carries its definition inside the circuit document, and its
  knob is the sensor — the sketch reads whatever the script answers on A0. Still
  open from that spec: the Problems panel row a fault should own (today's line is
  the console).

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

2. **`pinInfo` is in CSS pixels at 96 per inch.** The library says nothing about
   the unit, but it is the same one for every element: `px * 25.4 / 96` puts the
   Uno's and the ESP32's pins on the holes their artwork draws. Per-part
   constants, derived before that was noticed, disagreed by as much as 3.5x.
   What still needs saying is the *grid*: Wokwi's own header positions sit within
   a fraction of a millimetre of the real thing but are not exactly on the 2.54 mm
   pitch, so each part's header is snapped to the offset nearest the artwork. A
   part whose pins fall between breadboard holes cannot be wired the way the
   board in front of it works.

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

**Adopted beyond the two boards and the discrete parts.** The library carries
fifty-odd elements; these are the ones this bench can also *solve*, because each
is a circuit the existing solver vocabulary already has:

| part | element | modelled as |
| --- | --- | --- |
| Photoresistor (LDR) module | `wokwi-photoresistor-sensor` | GL5528 over a fixed 10 k, plus the on-board comparator as an open-drain output behind a trimmer |
| NTC thermistor module | `wokwi-ntc-temperature-sensor` | 10 k at 25 C, B = 3950, over a fixed 10 k |
| Tilt switch module | `wokwi-tilt-switch` | a contact to ground with the board's pull-up |
| Slide switch (SPDT) | `wokwi-slide-switch` | a common leg thrown to one end or the other |
| Analog joystick | `wokwi-analog-joystick` | two 10 k axes and a momentary select, all of which the potentiometer and button models already were |
| RGB LED (5 mm) | `wokwi-rgb-led` | three diodes on one common cathode, so `analogWrite` on each channel mixes the colour |
| Piezo buzzer | `wokwi-buzzer` | a capacitor, which is what a piezo disc is: it passes the edge that starts it and draws nothing after |

**Every part declares its own controls.** A wiper, a light level, a temperature, a
switch thrown one way or the other and a momentary contact are all the same thing
to the bench -- a knob with a range, a unit and a default -- so the part is the
only thing that has to know what it can be turned to. The netlist reads a knob to
work out its resistance, the artwork reads the same knob to move, and the
inspector reads the specs to know what to draw.

**Not adopted, and why.** The parts Wokwi ships that need a bus protocol this
firmware does not implement -- the DHT22's single wire, the DS1307's registers,
the MPU6050, the SD card, the keypad matrix -- would be parts a sketch could not
read. Adding them means adding the API first, and an artwork-only version of one
is a picture of a part that does nothing.

**State is pushed by property, not attribute.** Several element properties are
booleans where the attribute string `"false"` is truthy. `LED.brightness` takes
the forward bias the solver reports, `ILI9341.canvas` is painted directly from
the controller's framebuffer, and every Arduino board's L lamp follows digital
13 wherever its element draws one.


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

### 6.4 Boards, panels and what else is on the bench

**Five boards, each with its own pin numbering and its own buses.** The ESP32
DevKit V1 and the Arduino Uno came first; the Mega 2560, the Nano and the Nano
RP2040 Connect joined them. They are not interchangeable, and the differences
are the point -- A0 is pin 54 on a Mega and pin 14 on an Uno, the Mega's SPI
sits on its own 50-53 block rather than the 10-13 an Uno sketch names, and the
RP2040 runs at 3.3 V where everything else runs at 5. A sketch that moves
between boards has to move with them, which is what a bench is for.

**A board's own header aliases carry no pin number.** The Uno and the Mega both
silkscreen an SDA and SCL beside the numbered 4/5 and 20/21 they duplicate.
`McuRuntime` resolves a pin number to exactly one board pin, so a second pin
claiming that number would overwrite the first in the map and quietly take its
terminal with it. The alias holes are drawn and can be wired to; firmware
reaches those pins through the numbers the datasheet gives them.

**The bus pins are a table, not a rule.** Which nets carry I2C and SPI is
per-board, so it is declared per-board in `mcu.ts` rather than inferred. A bus
pin that names no header hole would make every display on that bus dark for a
reason that looks like a wiring mistake and is not one.

**The logic analyser answers "what level", the scope answers "what voltage".**
Both read the same probe deck, so adding the analyser cost a panel and not a
second capture path: pick up to eight pins, get a lane each, drawn as the
square wave the solver actually produced rather than as the samples between
edges. **The bus monitor** answers the question neither of them can -- what
wrote what, to which device, and whether anything acknowledged. It reads the
transactions the bus models already report, so it shows the byte sequence a
sketch sends even when the device on the other end is unwired and every write
goes nowhere.

**Three firmware APIs, and what each one was missing.** The bench had no
device drivers at all: the starter sketch drives the OLED by writing SSD1306
command bytes over `Wire` by hand, and `WirePort` had no read half at all. So
"which parts can be on the bench" was really "which parts can a sketch talk to",
and the answer for eighteen of them was none.

1. **`Wire.requestFrom` and `Wire.read`.** The half of Arduino's Wire library
   that was missing, and the highest-leverage thing in this list: it is not an
   invented API, it is the API every I2C sketch already uses. Adding it let the
   DS1307, the MPU-6050 and the HX711 onto the bench without a single new piece
   of syntax -- a sketch points at a register with a write and reads it back,
   exactly as it would on hardware.
2. **A character LCD.** `lcd.begin()`, `setCursor`, `print`, `createChar`, and
   the six-wire header a library drives rather than two. The panel model is the
   HD44780's own protocol and the *library* is the host's half, which is where
   that split belongs: a display wired to the wrong pins stays blank, because the
   engine decodes RS, D4-D7 and E back off the nets rather than being told what
   the library meant.
3. **Servos.** `servo.attach` / `write` / `read` by pin. The angle clamps at the
   real end stops, 10 and 170 degrees, because that is where a servo's are and a
   sketch asking for more gets the stop.

The row addresses of a 20x4 are the panel's business, not the library's: the
glass knows that its second half sits *above* the first, and a driver that
guesses gets a correctly wired display showing one line.

**An example is a sketch and the bench it expects.** Picking one from the
editor rebuilds both, because a sketch that talks to a clock nobody wired reads
nothing and looks exactly like a broken API -- which is the mistake worth
spending a day on when you are the one who wrote it. The parts are placed beside
the breadboard rather than in it, since every one of them is too large for a
strip and a module straddling the board hides the holes the rest of the circuit
uses.

The character LCD found the limits of a static netlist fastest. It is a four-bit
part: a byte goes out as two nibbles, the controller shifts the halves together,
and the panel latches on the rising edge of enable. Every one of those is a
decision about *when* a value changes, which is exactly what a netlist rebuilt
from geometry cannot say. What the bench does is settle the circuit with the
data lines written and enable still low, then again with enable high -- so the
edge is observed rather than written, and the bytes arriving are the ones the
pins actually carried. A display wired to the wrong header stays blank, which is
the point.

**Every element the library ships is browsable, not only the adopted ones.** The
component browser carries a "Full library" tab: all fifty tags, each drawn by
its own element, marked with whether it is on the bench, waiting on a firmware
API, or a different part from the one this bench drives. A part you can see but
cannot place -- with the reason on it -- is more use than one you cannot see,
and it is the honest answer to "why is there no servo here".

**The parts a bench carries are the parts the firmware can read.** Wokwi ships
fifty-odd elements; the ones adopted here are the ones whose circuit the
solver can solve with what it already has. A keypad matrix, an SD card or a
stepper motor would each need a firmware API first, and an artwork-only
version of one is a picture of a part that does nothing. The keypad is the
exception that proves the rule: it is a matrix of switches and nothing else,
so a sketch scans it the way real code does, and no API was invented for it.

**The comparator sensor family is one part, not five.** A PIR, a sound, a
heart-rate, a gas and a flame board are all the same LM393 with a trimmer
across a sensor and a pull-up on the output, so they share a component kind, a
model and the threshold knob; the variant chooses the element, the header and
the stimulus. Two of the five bring no analogue tap out at all -- the PIR and
the heart board are three-pin modules -- and those are declared three-pin,
because a pin with no hole drawn is a terminal a jumper can reach but can never
see.

**Both panels light on the emulated ESP32, in the browser.** The colour TFT
and the OLED are on the starter ESP32 bench, and a MicroPython sketch on the
emulated chip drives each of them: the TFT over the chip's SPI master, the
OLED over the chip's I2C controller, and both through the worker's own
transport into the page. Checked on the canvas, not only in a test -- an
earlier pass reported the panels dark, and the reason was that the bench had
no sketch driving them: the starter sketch blinks an LED and says nothing to
a display.

### 6.5 The Python front end, and what it still cannot say

The interpreter runs one virtual machine; the Python front end is a second
grammar over the same AST. That is why every Python feature is a decision
about *spelling*, and the bench's own rule applies: a sketch written the way
its documentation writes it has to run, and a sketch that cannot say something
has to say so rather than do nothing.

**Shipped (2026-10-20).** A guarded block (`try:` with `except`, `else` and
`finally`, and `raise`), a `machine.I2C` that honours the pins a sketch names,
a starred parameter (`def cmd(*bytes)`), a generator (`yield`), and the two
bugs that made the ordinary `for` loop useless: `range(n)` was read as a
*start* rather than a *stop*, so the loop never ran, and the loop body was
given a scope of its own, so the names it bound were lost when the loop ended.

**A guarded block needs something to guard.** `raise` is the sketch's own
error, and the bench's own failure is the one a guard is for: a read from a
device that is not wired raises `OSError`, the way a controller that was not
acknowledged raises on real hardware. The error the sketch does not catch
stops the sketch and says why, in the Problems panel, rather than escaping
into the page.

**The pins a sketch names are the bus it talks on.** `machine.I2C(0,
sda=21, scl=22)` gets the bus on those two pins, so a panel wired to another
pair is not answered -- the same silence a wire to the wrong hole gives. A
sketch that names no pins keeps the board's own bus, which is what the
MicroPython examples that write `I2C(0)` mean. This is the one place where
the interpreter and the emulated chip had disagreed: the chip honours its
pins, so a sketch that named the wrong pair talked to nothing there and to
everything here.

**A generator is lazy, and that is the whole of it.** A function that yields
hands its values over one at a time, and *nothing runs until the first value
is asked for* -- which is what lets a sketch write `while True: yield
sensor.read()` without the bench running out of values to wait for. The
driver is handed a number of milliseconds to wait; a generator hands over a
value; the two travel apart, and a wait inside a generator is still the
bench's own time to spend. A loop over anything that cannot be walked says
so (`TypeError`) rather than doing nothing quietly. `yield from` hands over
another generator's values in turn -- or a list's -- and its last value
becomes the expression's value, which is what lets one generator finish
another's work.

**The clock a sketch reads is the bench's clock.** `time.ticks_ms()` and
`ticks_diff` are how a MicroPython sketch measures an interval without
blocking, and `sleep_ms`/`sleep_us` say their unit in their own names. They
used to be one thing: every `time` member was read as a wait in *seconds*,
so `sleep_ms(50)` slept fifty seconds and `ticks_ms()` -- the idiom every
non-blocking sketch uses -- answered zero. `i2c.scan()` lists the addresses
the bench answers at, so an empty scan means an empty bus rather than a bus
nobody asked.

**A call the bench cannot make says so.** It used to answer `0`, which is the
worst answer there is: `len(data)` and `d.get('a')` read as zero, and the
learner believes the data was zero rather than the bench missing the call. A
function the sketch has never heard of raises `NameError`, a member a value
does not have raises `AttributeError`, a value called as a function raises
`TypeError`, and the C++ front end says the same in its own words. `len` was
the worst of them: it looked its argument up as a *name*, so it measured
nothing at all; it measures a string, a list and a dictionary now.

**A device can be named by a constant.** `MOVE = 4`, then `Button(MOVE)`: the
pin a constructor names is read through the scope, so the pocket-map lesson's
button binds to a pin rather than quietly doing nothing. It had been doing
nothing: the binding wanted a literal, so the lesson's button was never on
the bench at all.

**A read the bench cannot make says so too.** A name the sketch has never
heard of raises `NameError` -- and the C++ front end says the name was never
declared, the way a compiler would -- a member a value does not have raises
`AttributeError`, a key a dictionary does not hold raises `KeyError`, and an
index past the end of a list raises `IndexError`. A name that holds
something the sketch cannot read as a number -- a device, an object, a
function, a class -- says what it holds rather than claiming the name was
unknown.

**Still open.** A generator cannot be sent values back (`send`). And in the
C++ front end a field that was never set still reads as zero: the
interpreter cannot tell a field nobody assigned from a field nobody wrote,
and zero is what C++ gives a field it knows about.


