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
  **JSON half shipped** (2026-10-18): a part is a `.part.json` over one of the 39
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
  fault reaches the operator as a row of its own in the Problems panel, one per
  part per fault, whichever realm latched it: the page's own runtime, or the
  worker's, which reports its rows over its message channel.
  It was deferred because it needed an ABI over the solver's `Element[]`, a sandbox
  that cannot touch the DOM, worker-safe evaluation, and a story for a user module
  that throws mid-solve; the spec answers those four. A circuit now **carries the
  parts it uses** (`CircuitDocument.definitions`), so a file or a share link
  opens on a machine that never imported anything — which is what a gallery
  example needs. **Worked example shipped** (2026-10-20): the gallery's *Soil
  Moisture Probe* carries its definition inside the circuit document, and its
  knob is the sensor — the sketch reads whatever the script answers on A0.

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
`SPI`, `delay`, `tone`, the maths helpers, the libraries a sketch declares
(`Servo`, `DHT`, `OneWire`, `SD`, `LiquidCrystal`, `HTTPClient`,
`PubSubClient`, `WiFiUdp`)
and the pin constants. It does not offer `attachInterrupt`, because the bench
models no interrupts. An autocomplete that silently suggests a call the
simulator will reject teaches the wrong thing; this one only ever promises
something that works.

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

**Nine boards, each with its own pin numbering and its own buses.** The ESP32
DevKit V1 and the Arduino Uno came first; the Mega 2560, the Nano and the Nano
RP2040 Connect joined them, and the Raspberry Pi Pico and the Pi 4 after
that. They are not interchangeable, and the differences are the point -- A0 is
pin 54 on a Mega and pin 14 on an Uno, the Mega's SPI sits on its own 50-53
block rather than the 10-13 an Uno sketch names, and the RP2040 runs at 3.3 V
where everything else runs at 5. A sketch that moves between boards has to
move with them, which is what a bench is for.

**The ATtiny85 is a chip, not a board, and the bench draws it as one.** The
bare part in its 8-lead PDIP package, with the package's own geometry: the
leads 2.54 mm apart along a row, the two rows 6.35 mm apart, and the body
9.27 mm by 7.87 mm. The Franzininho is the same silicon on a carrier, and the
differences between them are the point too -- five I/O pins against the
carrier's six, no header, a reset pin that shares a lead with PB5, and the
analogue names landing on the chip's four ADC channels, which sit on PB0, PB2,
PB4 and PB3 rather than in pin order. Its leads cannot straddle the
breadboard's centre channel, because the channel is 7.62 mm wide and the
package's rows are 6.35 mm apart, so the chip sits beside the board and is
wired to it.

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

**The plotter answers "what did the program say", and a capture leaves as a
file.** The serial monitor shows the sketch's output as text; the plotter
reads the same output as numbers, and a line that is a number -- or several
numbers, separated by tabs -- is a sample, so a sketch that prints a reading
every second draws a line. The x axis is the sample and not the second: the
bench knows when a reading was taken on a pin, but the serial output carries
no time of its own, and a plot that pretended otherwise would be lying about
the sketch. **A capture leaves as a VCD**, the format PulseView reads, so a
bench that caught a clock edge can be opened in the tool a hardware engineer
already has, and the scope's own capture leaves as a CSV table of the time
and the voltage at every sample.

**The first bus device that answers.** Every part on the bench so far only
listened: a TFT takes bytes, a shift register takes bytes, and the MISO line
was a wire to nowhere -- `SPI.transfer` answered zero to every sketch that
asked, and nothing said so. The MFRC522 card reader is the part that made the
read half of the bus necessary. It is a register file: the first byte of a
transaction is an address with bit 7 saying which way the byte goes, the
second is the data, and a read leaves the chip's address counter walking, the
way the datasheet draws it. It answers with its version (0x92), with a card's
ATQA when one is in its field, and with the timer interrupt when the field is
empty. The card is a knob in the inspector and the drawing shows it lying on
the coil, so a sketch that timed out and one that read a card never look the
same -- and moving the knob repaints the bench there and then, because a part's
drawing is the knob's position and the running loop is not the only thing
allowed to ask for a frame. A transaction is bounded by `SPI.begin()` and
`SPI.end()`, the way every SPI sketch on the bench brackets one, and that
boundary is what tells the chip the next byte is an address again. The
compiled AVR core has no SPI port, so an SPI part is an interpreted-sketch
part; the compiled boards drive I2C.

**A sensor that answers.** The MAX6675 is a thermocouple amplifier with a
shift register on the front: the sketch shifts out a dummy byte and the chip
hands back sixteen bits, four of them status and twelve the temperature in
quarter-degree steps. It is the second thing on the bench that answers over
SPI -- the MFRC522 reader was the first, and the bus grew a return path for
it -- and the first that answers with a measurement rather than a register.

The bench models the chip and not the probe. A thermocouple is a junction of
two metals whose voltage depends on the temperature at the hot end, which is
a fact about a wire rather than something a chip can be asked about, so the
probe's temperature is a knob and the chip reads it the way it would read a
probe: in quarter-degree steps, rounded to what the wire can tell it.

**Eight pins out of two.** The PCF8574 is the answer to a board that has run
out of pins: a sketch writes one byte over the I2C bus and eight ports follow
it, the way the shift register's eight outputs follow a byte on the SPI bus.
The expander drives its ports itself, so what it drives them with is stamped
into the solve rather than frozen into the netlist -- the same seam the shift
register and the stepper driver use. The ports are quasi-bidirectional on the
chip, a weak pull-up that the chip can pull down; the bench gives them the
same output impedance it gives the shift register's, and the *input*
register, which reads the wiring rather than the chip, is not modelled.

**The same clock, with a thermometer.** The DS3231 keeps the DS1307's seven
BCD time registers, so a sketch that reads a clock a register at a time reads
this one the same way. What sits above them is the part's own story: two
alarms, a control and status register, an aging register, and a temperature
sensor on the die at `0x11` and `0x12`, in signed quarter-degree counts. The
oscillator-stop flag in the status register says the clock lost power, and a
sketch that sets the time clears it -- writing the time is the act that makes
the clock trustworthy. The interpreter's `RTC_DS3231` handle answers
`temperature()` and `lostPower()` beside `now()` and `adjust()`, and the die
temperature is a knob because a bench has no room to heat.

**Sixteen pins, and a direction register in front of them.** The PCF8574
turns one byte into eight pins; the MCP23017 turns two bytes into sixteen and
adds the thing the older chip does not have: every pin can be an input or an
output. The direction registers power up as all ones, so a fresh chip is
sixteen inputs and a latch written before the direction is cleared moves
nothing. That is the lesson the part carries, and the bench keeps it. The
engine stamps only the pins the sketch made outputs; an input is left alone,
because there is no wiring to report and a driven input would be a lie. Reads
of a port answer the latch, and the interrupt registers are stored but inert.

**Sixteen of one thing, and a frame to put them in.** The PCA9685 is the
expander's opposite: sixteen outputs, each one switching rather than latching.
A channel compares the chip's free-running counter against its own ON and OFF
counts, so the sketch sets a duty and, separately, where in the frame that duty
sits. The count is twelve bits and the clock behind it is 25 MHz through a
prescaler, which is why 50 Hz is a register value rather than a delay: sleep
the oscillator, write `PRESCALE`, wake it, and the chip repeats the frame on
its own. The engine stamps every channel as a switched resistor to the supply
or to ground at the instant the solver asks for, not as an averaged voltage, so
a light on the channel brightens and dims with the waveform. That waveform is also why a
`delay()` can no longer skip the part: the outputs move while the sketch waits.
Servo pulse decoding is deliberately left to the library and the model: the
bench shows the pulse the chip makes, and what reads it is a separate part.

**A voltage the bench makes.** The bench could measure an analog level --
the ADS1115 counts one, the barometer reports one -- and it had nothing that
could *make* one. The MCP4725 is that: the sketch writes twelve bits over the
I2C bus and the chip holds a voltage on its output, somewhere between the
ground and the supply, in four thousand and ninety-five steps. It is the one
part on the bench that drives a pin at a level of its own choosing: everything
else that drives a pin drives it high or low. The converter's output is a
source, and the solver carries it like any other.

**A memory is not a register file.** Every other part on the bench is one:
the sketch writes a register and reads it back. The 24LC256 is a pointer --
the sketch writes an *address* and then the bytes at it -- which is the
shape almost every memory on the planet has, and the shape the bench's SD
card has at a higher level. The address is sixteen bits, so it takes two
bytes on the bus, and a write is bounded by the page: the chip wraps inside
its sixty-four byte page rather than running on into the next one.

**The memory is part of the model, so what a sketch wrote is still there
after the bench is rebuilt.** That is not the same as surviving a power
cycle, and the bench does not model one.

**A second voltage.** The Uno's own supply is five volts, and that is
enough for a sketch and not enough for a motor: a stepper driver wants the
motor's own supply, and a bench where the only voltage is the board's cannot
show a motor turning at the voltage it really has. So the supply is a part
with two terminals and a knob -- the knob says what the terminals are at,
and the solver carries that voltage like any other source.

**It is the one part the operator sets.** Everything else on the bench either
follows the sketch or follows a probe; the supply is the only one whose
voltage a person chooses, and that is what makes it a bench rather than a
board.

**A display behind two wires.** The TM1637 module is a display driver with a
register file behind it: a sketch writes the segment patterns into the
registers and the chip scans the digits itself, so the glass shows what was
written without the sketch multiplexing anything. The wire is CLK and DIO, and
DIO is bidirectional -- the chip pulls it low to acknowledge every byte it
takes, and answers a key scan on the same line -- so the interface is neither
I2C nor SPI, and the bench had no bus to hang it on. What it has instead is a
port: the module is found by the pair of pins the sketch named, and both of
them have to land, because a module with no clock is a module that cannot
answer.

**The framing is the chip's own, and it is the part worth knowing.** The first
byte of a transaction is a command -- an address, or the display control that
says whether the glass is lit and how bright -- and the bytes after it are
data. Only the position tells them apart, because a segment pattern can look
like a command: the decimal point on its own is `0x80`, which is the display
control's shape. A sketch that wrote the bytes one at a time would have the
bench guessing, so the bench hands the module whole transactions and the
call's shape is the framing: `display.write(0xC0, 0x3f)` is an address command
and one byte of display data, and `display.print("12:34")` is the convenience
on top of it. The colon on this module is the decimal point of the second
digit, which is the only colon it has.

**A driver that works out the phase sequence for you.** The A4988 is a
stepper driver with a translator behind it: a pulse on STEP moves the motor
one step and DIR says which way, so the sketch never writes a phase table --
and that is the whole reason for buying one. The bench models the chip's
full-step excitation: four states, each with one winding driven forward and
the other driven back, and the states walk the Gray cycle the bench's motor
already follows. The driver drives its four outputs itself, the way the shift
register drives its eight, so what it drives them with is stamped into the
solve rather than frozen into the netlist. A sketch needs no new firmware
API for it at all: the step line is an ordinary pin, and the driver is what
turns a pulse into a phase.

**Microstepping is the same translator at a finer resolution.** The MS pins
select full, 1/2, 1/4, 1/8 or 1/16 step. The datasheet defines five
combinations; the undefined ones fall back to full step rather than guessing
at a mode the chip does not promise. The mode is sampled on the STEP rising
edge, and the translator keeps a fine position in sixteenths, so a 1/16 pulse
is 5.625 electrical degrees. At home the two winding currents are the
full-step anchor, and sixteen fine pulses walk the vector through the next
full-step state.

**The chopper is modelled by its average.** A fine mode does not switch an
output to a rail for the whole solve; it drives a bridge at a duty. The bench
stamps each output as the Thevenin divider the bridge presents over one
period: a resistor of `R / duty` to VMOT and `R / (1 - duty)` to ground,
where `R` is the 0.32 ohm output stage. At duty 0 or 1 that reduces exactly
to the full-step stamp. The high-frequency ripple, the decay modes and the
VREF current limit are outside the linear solver; the average is the model.

**The motor follows the vector.** A direct-wired stepper still reads winding
polarity edges. A motor matched to an A4988's outputs by net reads the signed
voltage across each winding, takes `atan2` of the pair, and advances the
shaft by the shortest angle over 90 electrical degrees. That is what lets the
shaft stop between full steps instead of rounding to the next polarity. The
gallery's `microstep` project wires MS1, MS2 and MS3 high and sends sixteen
pulses forward and back, so the rotor turns one full step and returns.

**Four firmware APIs, and what each one was missing.** The bench had no
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
3. **Servos.** `servo.attach` / `write` / `read` by pin, or the Arduino way --
   `myServo.attach(pin)` and then `myServo.write(angle)`. The angle clamps at
   the real end stops, 10 and 170 degrees, because that is where a servo's are
   and a sketch asking for more gets the stop.
4. **A library a sketch declares the Arduino way.** `Servo myServo;` is the
   spelling every real library sketch uses, and the bench now answers it: the
   object remembers the pin it was given and the call carries it on, because
   the bench's ports address a part by the pin it is on. `DHT dht(2, DHT22);`,
   `SD card;` and `LiquidCrystal display;` are the same. **The bench's own
   shape still works** -- `servo.write(pin, angle)` and `servo.write(angle)`
   are told apart by how many arguments they carry -- so a sketch written for
   this bench keeps running and a sketch copied from the internet runs too.
   The libraries whose pin the sketch never binds -- the NeoPixel strip, the
   IR receiver, the dialer -- still take the bench's own names, because their
   pin has nowhere else to come from. **The network's libraries are the same
   case**: `HTTPClient http;`, `PubSubClient mqtt;` and `WiFiUdp udp;` are the
   three a sketch that talks to a server declares. The HTTP client blocks the
   way a real request blocks, because the answer arrives on the bench's own
   clock; the MQTT client talks to the bench's sensor and its broker; and the
   time client reads the clock the network keeps. The bench's own `net` port
   stays as it was, because it is a *port* and these are libraries over it.
   The broker is on the bench's network, so a client that has not joined has
   no broker to reach -- and `connect` says so rather than agreeing.

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

**An instrument that answers on the bus needs no firmware of its own.** The
bus is already there -- `Wire` moves the bytes and `requestFrom` reads them
back -- so a new chip on the I2C bus is a model and a drawing, and the
*protocol* is the exercise. The bench carries six of them now: a clock, an
accelerometer, a load-cell amplifier, a barometer, a current monitor and a
sixteen-bit converter. The first three answer with the register map their
datasheet prints. The barometer answers with raw counts and the eleven
calibration coefficients in its E2PROM, and the compensation the datasheet
prints is the arithmetic that turns them into pascals -- so it is in the
sketch and not in a library, because the arithmetic *is* the part. The current
monitor's current register is only as good as the calibration the sketch
wrote, and its shunt saturates when the current passes the range its gain
setting gives it. The converter is told which channel to look at and how much
of the range to give it, and answers in counts.

**What the world is doing is the operator's to set.** The pressure the
barometer sits in, the current through the monitor's shunt, the voltage on the
converter's channels: each is a knob, which is the convention the load cell's
load and the soil probe's moisture already follow. The chip's registers are
recomputed from the knob rather than from a number the operator typed in, so
what a sketch reads back is what the operator dialled in.

**A one-wire sensor is a knob and a library, and the waveform between them is
not modelled.** The DS18B20 answers through the `OneWire` library, the way the
DHT answers through `DHT`: the part carries the temperature and the library
carries the pin. The library's own `getTemp(float *t)` cannot be spelled in the
bench's subset, which has no pointers, so the bench's own shape answers the
temperature outright -- and the object still takes its pin in the constructor,
the way Arduino's library takes it, so `OneWire ow(2);` is the spelling a
sketch writes.

**Seven of the instruments are the bench's own drawings.** The Wokwi library
has no element for a barometer, a current monitor, a converter, a one-wire
sensor, a shift register, a matrix or a Nokia panel, so their artwork is drawn
here, on the same 2.54 mm grid as the modules the library does draw -- which is
what makes the header a jumper can reach.

**The SPI bus is a bus now, and a shift register is on it.** It used to reach
panels and nothing else: the engine delivered a byte to the displays, and a
device that was not a display never heard it. The 74HC595 is the first thing
that is neither, and it needed three things the panels had not needed. Its
clock and data in are the bus's own wires, so the engine checks the two pins
land on the SPI nets before it hands over a byte. Its latch is a plain output
the sketch drives, because on the chip the latch and the data are separate
wires, and the outputs take the byte the moment the line is high. And its
outputs are not in the netlist: the chip drives them, from the byte it holds,
so the engine stamps them around the netlist the way it stamps a servo's load.

The bit order is the chip's and not the bus's: the shift register moves
toward Q7, so the first bit to arrive ends up there and the last on Q0. A
sketch that sends a byte most significant bit first therefore lights Q7 with
the byte's highest bit -- the gotcha every sketch that lights a chain in order
has to know, and the reason the bench says so on the part.

**An 8x8 matrix, and a latch that belongs to the bus.** The MAX7219 is the
first part whose frame is sixteen bits rather than one byte, and it found a gap
in the SPI model: `SpiBus.end()` raised chip-select and told nobody, so a device
that latches on the rise had no way to hear it. The bus now says when a
transaction has ended, and the matrix latches there -- which is also the honest
reading of the chip, whose shift register is exactly sixteen bits wide, so a
transaction that sends four frames without a rise between them leaves only the
last. The registers are the glass: DIGIT1..DIGIT8 are the columns with bit 0
the top row, and shutdown, intensity, scan limit and display test change what
those columns show. A sketch that never writes the intensity register therefore
draws at the chip's power-up current, which is its dimmest, and the bench draws
it that way rather than at a brightness the hardware would not give.

**A panel whose command byte means two things.** The Nokia 5110 is the first
controller with two instruction sets. The basic one addresses memory and
switches the display; the extended one takes the contrast voltage and the bias,
and while it is selected the address commands are not decoded at all -- so a
driver has to leave it before it draws, and a sketch that writes contrast and
then keeps drawing writes into whatever column the counter was left on. The
bench models the halves as the chip does rather than merging them. The panel's
memory is also banks rather than pages, six of them, and a data write walks
across the columns and wraps down a bank or walks down the banks and wraps
across a column depending on one bit of the function set.

One convention belongs to the bench and not to Arduino: the data/command state
travels with the byte, so a command goes out as `SPI.transfer(value, 0)` and a
byte of memory as `SPI.transfer(value)`. The interpreter's SPI port is where
the firmware's control line is read, and the port has no pin of its own to ask.

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

**A generator takes a value back as readily as it hands one over.** `send`
is the other half of `yield`: `x = yield 1` binds whatever was sent, which
is what makes a generator a coroutine -- a sketch can hand it a command and
read what comes back. `next(gen)` is the other spelling of the same
advance, and a second argument to it is the value to answer with rather
than raising. A generator that has run out raises `StopIteration`, the way
Python does, so a sketch can catch it; one that has not started refuses a
value, because there is no `yield` for it to reach -- though nothing at
all, which is None here, starts it as it does in Python.

**The clock a sketch reads is the bench's clock.** `time.ticks_ms()` and
`ticks_diff` are how a MicroPython sketch measures an interval without
blocking, and `sleep_ms`/`sleep_us` say their unit in their own names. They
used to be one thing: every `time` member was read as a wait in *seconds*,
so `sleep_ms(50)` slept fifty seconds and `ticks_ms()` -- the idiom every
non-blocking sketch uses -- answered zero. `i2c.scan()` lists the addresses
the bench answers at, so an empty scan means an empty bus rather than a bus
nobody asked.

**An import names a library or a tab, and the bench knows which.** `import
helpers` means `helpers.py` and that tab has to be there; `import gc` means
the interpreter itself and there is no file to look for. The loader used to
treat both as tabs, so a sketch that opened with `import gc` or `from
micropython import const` -- two lines a great many MicroPython sketches open
with -- failed to load at all, and the error never reached the serial because
it was a problem with the *project* rather than the program. `gc.collect()`
does nothing (there is nothing to collect) and `const(x)` is `x`; `utime` is
`time` under its older name. A PWM channel remembers what it was told, so
`freq()` and `duty_u16()` read back -- the duty quantised to the eight bits
it really has, so `duty_u16(32768)` reads as 32896 rather than the number
that was asked for.

**The `machine` vocabulary is the one a sketch's first lines use.** A board's
`UART(0, 9600)` writes to the port the monitor draws, because a board's REPL
and its first UART are one wire; `SoftI2C` is `I2C` bit-banged on the pins it
names, and the bench answers whichever pins a sketch points it at;
`ADC.atten` sets the range a sketch expects to read and changes nothing it can
see, because the bench reads a fraction of the reference it knows. `Pin.OUT`
and `ADC.ATTN_11DB` are values now: the constructors had always read them
straight off the syntax, so a sketch that kept one in a name, or passed one to
a method, was told `'Pin' is a device, not a value`.

**`String` is a value the bench already had.** Arduino's message type is how
a tutorial joins a reading onto a label, and it was the one line that stopped
a sketch compiling at all: `String msg = "T=" + t;` was a syntax error,
because the statement parser only took a bare identifier as a type for the
value types it already knew. It knows `String` now -- a declaration binds
text, `+` and `+=` join, a number keeps the library's two places (`T=21.50`,
not `T=21.5`), and the mutators (`toUpperCase`, `toLowerCase`, `trim`,
`replace`) change the string the sketch named rather than answering a new one
nobody stores. `String(n, HEX)` is `FF`, because the base constants are names
a sketch can say. The pair a random sketch always writes together --
`randomSeed(analogRead(0))` and then `random(...)` -- run too: the seed has
nothing to seed here, but a sketch that stopped on it never reached the value
it wanted. `bitRead` takes a number apart, which is what a register tutorial
does with it.

**A character literal is a number, and a printed number has the field the
call names.** `'A'` did not lex at all, so the first line of every
serial-command sketch -- read a byte, compare it to a letter -- was a syntax
error. A single-quoted literal is the character's code in C and a string in
Python, which is why the tokenizer keeps the text and each front end decides.
The serial monitor also writes what the library would: a whole number in the
base a second argument names (`print(255, HEX)` is `FF`), a fraction to the
places it asks for (`print(3.14159, 4)` is `3.1416`). Both used to read the
field as decimal places, so `HEX` printed `255.0000000000000000` -- in the one
panel a learner is reading carefully. A Python string with an escaped quote
(`'it\'s'`) ended at the escaped quote; it ends at the closing one now.

**A lesson's stated limit is a claim, and it gets checked too.** Module 4
teaches interrupts by teaching why polling fails, and its sketches told the
learner why: no `volatile`, `const byte` rejected at file scope, and an
`attachInterrupt` call that "would load, run, and quietly decode nothing".
The last of those was the silent zero, which is gone; the first two had
already stopped being true. A sketch that calls `attachInterrupt` now stops
*before its handler is read* -- evaluating it first would fail on "'isr' is a
function, not a value", which blames the sketch for a limit of the bench --
and says the thing the module teaches. `digitalPinToInterrupt` still maps a
pin to its number, and a critical section around nothing is the code inside
it.

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

**A field the class declares is not a zero until somebody sets it.** The
bench can now tell three cases apart, where it answered zero for all three:
a field the constructor set reads its value, a field nobody set says it was
never set, and a member the class never had says the class has no such
member. A typo'd field used to read as data, and a field the sketch forgot
used to read as a zero, and both of those are the worst answers there are.
The one zero left in this corner is a member of a class the bench has never
seen -- a library's own class, whose members it does not know.

**An unqualified name in a member function is the member.** `n = 41` in a
constructor writes the field and not a local, which is what C++ means by it,
and it is what makes the rule above possible: a field that was never set is
in no scope at all, so without this the write would land in the method's own
frame and the field would stay unset. A local of the same name is the
programmer's own and stays theirs.

**A free function sees the program, not the caller.** C++ says a name in a
free function is the function's own or the program's, and nothing else: a
caller's local is not visible, and neither is the member of an object whose
method made the call. The bench used to chain a free function's frame to
whoever called it, so a helper could reach into the caller's frame and write
its locals -- and through them, the fields of the object that had called it.
A compiler would have refused the whole sketch. The chain runs the other way
now, to the globals, and a name a free function cannot see is said so rather
than quietly resolved to the caller's. The one place the bench is more
forgiving than a compiler is a name a free function *writes* and never
declares: it becomes its own local, where C++ would refuse the sketch.

### 6.6 The debugger, and what it can stop at

**A stop is a line, and the program stops there.** The margin of the editor
carries one: a click sets it, a click takes it off, and the sketch stops the
next time it runs a statement on that line. The panel under the bench says
where the program is and what it can see there -- the names in scope and what
each of them holds -- and offers the three things a person can ask of a
stopped program: carry on, step over the call it is in, or step into it. The
line itself is marked in the editor, because the editor is where the person is
looking and the panel is where the detail is.

**The interpreter is where the stops are.** A stop needs a place to stop, and
the interpreter is a program the bench can read: it asks itself, at every
statement, whether it should stop there. A compiled core is a machine the
bench cannot read that way, so a run on one has no stops in it -- and the
panel says so rather than pretending otherwise.

**The stops travel with the sketch, not with the run.** The bench's sketch
may be running in a worker, and the worker is the realm that holds the
program: so the stops ride with the sketch when it is loaded, and the frame
the program stopped on comes back as a message. A stop that arrived after
the sketch had started would be a stop the sketch had already passed.

**A line can hold more than one statement.** `int a = 1; int b = 2;` is two
statements on one line, and a stop is on the line rather than on the
statement: it fires when the program reaches the line, and not again while
it is still on it. A block is not a statement of its own -- it carries the
line of the first statement inside it -- so it is never where a stop lands.



### 6.7 Simulation CI: the same simulation, without a page

**A project is three files, and a CI run is a Node process.** The bench is a
page, but the simulation underneath it is plain TypeScript -- a circuit, a
sketch and a clock -- so a project can be run without a browser and checked
on every push. The project is the circuit document the bench already saves,
the sketch, and what the run should see: the lines the serial output has to
carry, in order.

**The runner is a test, because that is what Node can run here.** The bench's
modules are TypeScript with a path alias, and vitest is what resolves them,
so the entry point the workflow runs is a test that skips itself when no
project is named. The repository ships a reusable workflow, and a project
calls it with the path of its folder: a user's repository gets a pass or a
fail, with the simulation's own serial output in the log.

**It checks the serial output, and it says so.** The serial output is the
one observable every project has -- a sketch that prints nothing has nothing
to say -- and the glass, the LEDs and the shaft are not read. The sketch runs
on the interpreter, because that is the path a machine without a browser can
run: the compiled path needs a HEX built by a toolchain the workflow would
have to fetch, and a project that wants its firmware compiled should build
it in its own workflow and check the HEX there.
