# Embedded Systems Exercise Curriculum

Nine hands-on exercises, arranged as a **five-level ladder**, that take a learner
from "I have never wired anything" to "it counts interrupts". Every exercise is
built twice: once on a real bench, once as a **digital twin** in this repository's
simulator, so the concepts survive without hardware on the desk.

> **Not sure where to start?** Take the placement test in
> [`LEVELS.md`](LEVELS.md) — it takes three minutes and tells you which level to
> begin at. If you have never held a breadboard, the answer is
> [0.1 Your First Circuit](module-0-first-light.md).

Each exercise integrates all three pillars of the track:

| Pillar | What it means on the bench |
| --- | --- |
| Physical wiring & schematic literacy | Terminal names, breadboard rails, pin footprints, pull-up/pull-down networks, current limiting, bus topology |
| Firmware & software control | Non-blocking timing, GPIO/register-level control, state machines, interrupt handling, sensor data processing |
| Embedded systems concepts | Debouncing, ADC resolution, PWM duty cycles, $I^2C$/SPI/UART, voltage dividers, signal integrity |

---

## The bench

**Baseline platform: Arduino Uno R3 (ATmega328P, 16 MHz, 5 V logic, 10-bit ADC).**

That choice is deliberate, not default. The Uno's limits are the lesson:

- **10-bit ADC** — 1024 counts, so every analog exercise has a visible quantisation floor.
- **5 V logic** — forces the 3.3 V/5 V conversations in Modules 3 and 4.
- **Two external interrupts (D2, D3)** — Module 4.1 has to reach for pin-change
  interrupts and Input Capture to get a third channel. On an ESP32 that problem
  does not exist, so the learner has to earn the workaround before seeing it vanish.
- **2 KB of SRAM** — an SSD1306 frame buffer is 1024 bytes. Half the RAM, gone. That
  constraint is the whole point of Exercise 3.1.

**Digital twin:** every exercise has a **Noesis Lab twin** section mapping the circuit
onto parts this repo already models — `Tactile Button`, `10k Potentiometer`,
`Slide Potentiometer`, `Red LED`, `Thermistor (NTC) Module`,
`Photoresistor (LDR) Module`, `Rotary Encoder (KY-040)`,
`Ultrasonic Sensor (HC-SR04)`, `128x64 OLED (SSD1306)` (I²C),
`128x64 OLED (SSD1306 SPI)` and `2.4" TFT (ILI9341)` — driven by the firmware
interpreter (`pinMode`, `digitalRead/Write`, `analogRead/Write`, `millis`,
`micros`, `pulseIn`, `Wire`, `SPI`) and read back on the Multimeter, Scope, Logic
Analyser, and Bus Monitor panels.

Those are the catalogue's display names verbatim, including its refusal to put a
space in an SI prefix: a 10 kΩ resistor is listed as `10k Resistor` and a 100 nF
capacitor as `100nF Capacitor`, not `10 kΩ Resistor`. Prose about real components
keeps normal typography; anything in backticks naming a simulator part is the
string the catalogue actually produces.

Twin parity is **not** claimed where it does not exist. Where the simulator has a
limit — no interrupts, for instance — the twin section says so and gives the learner
the polling sketch, then names what real hardware buys them.

**Twin sketches use a narrower C++ dialect than bench sketches.** The interpreter's
parser covers `void int float double bool char byte long short unsigned signed`,
arrays, and `#define` constants — and deliberately nothing else (`parser.ts:6`).
So: no `struct`, no `enum`, no reference or pointer parameters, no classes, no
`String`, no heap, and no `uint8_t`/`int8_t` (write `byte` and `signed char`).
Bench sketches are not restricted — idiomatic `struct` and `enum` are what a real
programmer writes, and Modules 1 and 4 teach them. Each twin section names the one
construct it had to flatten, which is itself a lesson about why a table-driven
design scales further than a struct does.

### Portability notes (ESP32 DevKit V1, 3.3 V)

| Property | Uno R3 | ESP32 DevKit V1 | Why it breaks a sketch |
| --- | --- | --- | --- |
| Logic high | 5 V | 3.3 V | 5 V into an ESP32 GPIO damages it; only GPIO34–39 are 5 V tolerant, and they are input-only |
| ADC | 10-bit, 5 V AREF | 12-bit by default, ~11 dB non-linearity | Counts are 0–4095, not 0–1023; `analogReadResolution(12)` and a calibration curve |
| ADC2 pins | n/a | Unusable while Wi-Fi is on | Move the sensor to an ADC1 pin |
| PWM | `analogWrite`, ~490 Hz; D3/D11 are Timer2, D5/D6 are Timer0, D9/D10 are Timer1 | `ledcSetup`/`ledcAttachPin`, up to 40 MHz, 10–16 bit | `analogWrite` spans only 0–255 at one fixed frequency, and D5/D6 share Timer0's `TCCR0B` — the same register `millis()` is derived from |
| Interrupts | D2/D3 only (INT0/INT1) | Any GPIO | The PCINT workaround is only needed on AVR |
| I²C | A4/A5, also USB-serial | Any two GPIOs | A4/A5 lose the serial monitor mid-upload on the Uno |

---

## Shared rules

These hold for every exercise in the track.

1. **Every LED gets a current-limiting resistor.** Compute it: $I = \frac{V_{CC} - V_f}{R}$.
   At 5 V with a red LED ($V_f \approx 1.9$ V), 220 Ω gives 14.1 mA. Per-pin DC output
   on the ATmega328P is 40 mA absolute maximum, 20 mA recommended; the board's total
   VCC + GND budget is 200 mA.
2. **No digital input floats.** Every input has a pull-up or pull-down, external
   where the exercise says external. The internal pull-up is 20–50 kΩ and is disabled
   during reset — including while a sketch is being uploaded over USB.
3. **`delay()` is permitted at Level 1 and banned from Level 2 onward** (Exercise
   1.1 onwards). At Level 1 the program genuinely has nothing else to do, so
   `delay()` is the correct tool. From 1.1 on, your program *does* have other work,
   and a program that stops to wait cannot do it. The reason is taught in the
   exercise that withdraws it, not asserted here. Time is acquired with
   `millis()`/`micros()` and unsigned subtraction so the comparison survives the
   49.7-day `millis()` wrap:
   `if (now - last >= INTERVAL) { last = now; ... }`
4. **Every exercise ends with a broken circuit.** The learner is told the symptom and
   must find the cause; the answer is in the text for the self-study reader.
5. **Do the twin second.** Building the circuit in the simulator after it works on the
   bench confirms the mental model; building it first spoils the debugging.

---

## The level ladder

Levels are cumulative and each one adds at most three new concepts. Full
descriptions, entry tests and exit checks are in [`LEVELS.md`](LEVELS.md).

| Level | Theme | New concepts | Exercises |
| --- | --- | --- | --- |
| **1** | First contact | A pin is a switch · a resistor sets a current · `HIGH` is 5 V | [0.1](module-0-first-light.md) |
| **2** | Reading the world | `digitalRead` · pull-ups and active-LOW · non-blocking time | [1.1](module-1-gpio.md) · [1.2](module-1-gpio.md) |
| **3** | Signals that are not on or off | ADC resolution · PWM duty · voltage dividers | [2.1](module-2-analog.md) · [2.2](module-2-analog.md) |
| **4** | Talking to other chips | open-drain and addressing · chip-select framing · the RAM budget | [3.1](module-3-bus-protocols.md) · [3.2](module-3-bus-protocols.md) |
| **5** | Faster than the loop | interrupts and `volatile` · atomic reads · microsecond timing | [4.1](module-4-interrupts.md) · [4.2](module-4-interrupts.md) |

---

## The exercise template

Every exercise uses the same seven sections, in this order. To write a new one,
copy [`TEMPLATE.md`](TEMPLATE.md) — it encodes which sections may be pre-filled at
each level, plus the pre-submission checklist.

### [Exercise ID]: [Exercise Name]
**Difficulty Level:** [Beginner / Intermediate / Advanced]
**Level:** [1–5]
**Estimated Completion Time:** [e.g. 30–45 mins]

#### 1. Real-World Scenario
#### 2. Hardware Inventory & Pinout Map      (component list + Board Pin ↔ Terminal ↔ Rail table)
#### 3. Circuit Schematics & Wiring Guide     (ASCII schematic + gotchas & safety rules)
#### 4. Embedded Concept Deep-Dive            (the theory the exercise actually applies)
#### 5. Firmware Challenge & Code Template    (starter scaffold + functional requirements + constraints)
#### 6. Verification Checklist & Debugging Tasks (steps to pass + a simulated hardware fault)
#### 7. Noesis Lab Twin                       (where the simulator can carry the exercise)

---

## Curriculum map

| ID | Level | Exercise | Difficulty | Time | Pillars | Twin parts |
| --- | --- | --- | --- | --- | --- | --- |
| [0.1](module-0-first-light.md) | 1 | Your First Circuit | Beginner | 45–60 mins | Pins, rails, current limiting, `pinMode`/`digitalWrite` | `led`, `220 Resistor`, breadboard |
| [1.1](module-1-gpio.md) | 2 | Industrial Push-Button & Mechanical Debouncing | Beginner | 45–60 mins | GPIO, pull-ups, RC filter, debouncing | `Tactile Button`, resistors, LED, Multimeter |
| [1.2](module-1-gpio.md) | 2 | Traffic Signal State Machine | Beginner | 60–75 mins | `millis()`, FSM, non-blocking blink | LEDs, `Tactile Button`, Serial monitor |
| [2.1](module-2-analog.md) | 3 | Precision Light Dimmer & Potentiometer Sampling | Intermediate | 45–60 mins | ADC resolution, `map`, PWM duty, gamma | `Slide Potentiometer`, LED, Scope |
| [2.2](module-2-analog.md) | 3 | Analog Sensor Calibration & Voltage Dividers | Intermediate | 75–90 mins | Divider maths, NTC β, moving average | `Thermistor (NTC) Module`, `Photoresistor (LDR) Module`, Serial |
| [3.1](module-3-bus-protocols.md) | 4 | $I^2C$ Environmental Monitor with OLED & Sensor | Intermediate | 75–90 mins | Open-drain bus, pull-ups, addressing, frame buffer | `128x64 OLED (SSD1306)`, Bus Monitor |
| [3.2](module-3-bus-protocols.md) | 4 | SPI High-Speed Display Control | Intermediate | 75–90 mins | CPOL/CPHA, latch discipline, 595 sink budget | `128x64 OLED SPI module (SSD1306)`, `2.4" TFT (ILI9341)`, Bus Monitor |
| [4.1](module-4-interrupts.md) | 5 | High-Speed Rotary Encoder & Optical Tachometer | Advanced | 90–120 mins | `attachInterrupt`, Gray-code x4, `volatile`, ISR budget | `Rotary Encoder (KY-040)`, polling-only twin |
| [4.2](module-4-interrupts.md) | 5 | Distance Radar with Ultrasonic Sensor (HC-SR04) | Advanced | 60–75 mins | `micros()`, round-trip propagation, timing window | `Ultrasonic Sensor (HC-SR04)`, `pulseIn`, Scope |

---

## Shared parts bin

Buy once, use across the track.

| Part | Value | Exercises | Note |
| --- | --- | --- | --- |
| Arduino Uno R3 | — | all | ATmega328P |
| Breadboard | full-size, 830 tie points | all | Split the rails, and note the centre channel break |
| Resistors | 220 Ω | 1.1, 1.2, 2.1, 3.2, 4.2 | LED current limit |
| Resistors | 330 Ω | — | Standard blink resistor; 9.4 mA with red |
| Resistors | 1 kΩ | 2.1, 3.2, 4.2 | Series/filter, ECHO divider, LED sink limit |
| Resistors | 2 kΩ | 4.2 | ECHO divider bottom leg |
| Resistors | 10 kΩ | 1.1, 2.2, 3.1, 4.1, 4.2 | Pull-ups and divider legs |
| Resistors | 4.7 kΩ | 3.1 | $I^2C$ pull-ups (most OLED modules already have them) |
| Capacitors | 100 nF | 1.1, 2.1, 2.2, 3.1, 4.1, 3.2 | Filtering and 74HC595 decoupling |
| Capacitors | 10 nF | 4.1 | Encoder edge filter (τ = 10 µs) |
| LEDs | 5 mm red/green/blue | 1.1, 1.2, 2.1, 3.2, 4.2 | $V_f$: red ≈ 1.9 V, blue ≈ 3.0 V |
| Tactile buttons | 6 mm | 1.1, 1.2 | Momentary, normally open |
| Potentiometer | 10 kΩ linear | 2.1 | 3-terminal |
| Thermistor | 10 kΩ NTC, β = 3950 | 2.2 | B-value determines the curve |
| LDR | GL5528 | 2.2 | ≈ 3.5 kΩ bright, ≈ 50 kΩ dark |
| OLED | SSD1306 128×64, I²C | 3.1 | 0x3C, 1024-byte buffer |
| OLED | SSD1306 128×64, SPI | 3.2 | 8-wire module |
| Shift register | 74HC595 ×3 | 3.2 | 24 outputs for the LED bar |
| Rotary encoder | KY-040 | 4.1 | 20 detents/rev, on-board pull-ups |
| Ultrasonic | HC-SR04 | 4.2 | 5 V module, 2–400 cm |
| IR reflective sensor | TCRT5000 + slotted disc | 4.1 | For the optical tachometer |

---

## Files

0. **[Module 0 — First Contact](module-0-first-light.md)** *(Level 1)*: 0.1 Your First Circuit
1. **[Module 1 — GPIO & Physical Input Dynamics](module-1-gpio.md)** *(Level 2)*: 1.1 Industrial Push-Button & Mechanical Debouncing · 1.2 Traffic Signal State Machine
2. **[Module 2 — Analog Interfaces & Signals](module-2-analog.md)** *(Level 3)*: 2.1 Precision Light Dimmer & Potentiometer Sampling · 2.2 Analog Sensor Calibration & Voltage Dividers
3. **[Module 3 — Serial Protocols & Hardware Bus Communication](module-3-bus-protocols.md)** *(Level 4)*: 3.1 $I^2C$ Environmental Monitor with OLED & Sensor · 3.2 SPI High-Speed Display Control
4. **[Module 4 — Hardware Interrupts & Low-Level Control](module-4-interrupts.md)** *(Level 5)*: 4.1 High-Speed Rotary Encoder & Optical Tachometer · 4.2 Distance Radar with Ultrasonic Sensor (HC-SR04)

Also: **[LEVELS.md](LEVELS.md)** — the ladder, placement test and exit checks ·
**[TEMPLATE.md](TEMPLATE.md)** — how to write a new exercise at any level.

Work the levels in order. 1.2's sub-second state machine is the same pattern 4.2's
ping-pong loop needs; 2.2's moving average is the filter 3.1's sensor stream needs.
