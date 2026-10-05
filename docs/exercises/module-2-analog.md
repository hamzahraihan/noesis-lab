# Module 2 — Analog Interfaces & Signals

The Uno's six analog inputs are where a microcontroller stops reading switches and starts reading the world. This module covers what sits between a resistive sensor and a number: divider maths, the ADC's real resolution, PWM duty, and the response curve that turns a mechanical knob into something a human can operate.

| ID | Exercise | Difficulty | Time |
| --- | --- | --- | --- |
| 2.1 | Precision Light Dimmer & Potentiometer Sampling | Intermediate | 45–60 mins |
| 2.2 | Analog Sensor Calibration & Voltage Dividers | Intermediate | 75–90 mins |

### 2.1: Precision Light Dimmer & Potentiometer Sampling
**Difficulty Level:** Intermediate
**Level:** 3
**Estimated Completion Time:** 45–60 mins

#### 1. Real-World Scenario

A studio-light dimmer on a video rig. A 10 kΩ linear potentiometer rides the camera rail, three 5 mm LEDs stand in for an RGB strip, and the operator pushes the rail slowly while talking. The demand is not brightness proportional to current — it is a fade that *looks* even, so the knob's travel is remapped before it ever reaches the PWM.

#### 2. Hardware Inventory & Pinout Map

| Board Pin | Component Terminal | Connects To | Value / Notes |
| --- | --- | --- | --- |
| 5 V | Pot terminal 1 (top) | 5 V rail | Top of the divider |
| GND | Pot terminal 3 (bottom) | GND rail | Bottom of the divider |
| A0 (ADC0) | Pot terminal 2 (wiper) | — | 10-bit channel, 1024 counts over a 5 V AREF |
| A0 | 100 nF cap lead `+` | A0 node | Reservoir; τ = 0.5 ms at mid-travel (100 nF × 5 kΩ) |
| GND | 100 nF cap lead `−` | GND rail | Never leave this pin unwired |
| 5 V | Red, green, blue LED anodes | 5 V rail | Common-anode legs, one rail jumper |
| D3 (OC2A) | 220 Ω → red LED cathode | — | $I = (5 - 1.9)/220 = 14.1$ mA |
| D5 (OC0A) | 220 Ω → green LED cathode | — | $I = (5 - 2.1)/220 = 13.2$ mA |
| D11 (OC2B) | 220 Ω → blue LED cathode | — | $I = (5 - 3.0)/220 = 9.1$ mA |

**Bill of materials:** Arduino Uno R3; 10 kΩ linear 3-terminal potentiometer; 100 nF ceramic (`104`); red, green and blue 5 mm LEDs ($V_f \approx 1.9 / 2.1 / 3.0$ V); 3× 220 Ω ¼ W resistors; full-size breadboard and jumpers.

#### 3. Circuit Schematics & Wiring Guide

```text
  ANALOGUE INPUT                    PWM OUTPUTS (anodes on the 5 V rail)

   +5V --+---------+                 +5V --+---------+---------+---------+
         |         |                       |         |         |
      [10k pot] [100nF]               [LED red] [LED grn] [LED blu]
      [  .  ]  [  .  ]                [ anode ] [ anode ] [ anode ]
      [  .  ]     |                   +--+------+--+------+--+
         |        |  A0                  |         |         |
        (w)-------+-----                 |         |         |
         |        |                  [220 ]    [220 ]    [220 ]
   -----+--------+-- GND               [  .  ]   [  .  ]   [  .  ]
                                      D3 (OC2A) D5 (OC0A) D11 (OC2B)
                                        Timer2     Timer0     Timer2
```

**Wiring procedure**

1. Split the breadboard rails, and confirm the centre channel really breaks between halves.
2. Pot terminal 1 → 5 V, terminal 3 → GND, terminal 2 (the middle leg, the wiper) → A0.
3. 100 nF from the A0 node to GND. Fit it after the pot so you can meter the wiper with the cap in place.
4. All three LED anodes → 5 V rail; red cathode → 220 Ω → D3, green → D5, blue → D11.
5. Meter check before power-on: wiper to GND sweeps 0 → 10 kΩ in resistance mode.
6. Upload, open the Serial monitor at 9600 baud.

**Hardware Gotchas & Safety Rules:**

- **The ADC input is a switched capacitor.** The sample-and-hold charges an internal capacitor from the pin, and for a few microseconds afterwards the pin is effectively disconnected. A 10 kΩ pot presents 5 kΩ at mid-travel and 10 kΩ at the ends, right at the rule of thumb $Z_{source} < 10$ kΩ — keep under it, or fit the 100 nF and stop worrying. A 100 kΩ pot is 25 kΩ at mid-travel, which is why substituting one in the fault hunt makes things worse rather than better.
- **The first conversion after configuring the ADC is allowed 114 µs, not the usual 104 µs**, and may read a few counts low. Discard it.
- **Never leave the wiper unconnected.** A floating ADC input settles wherever its leakage lets it, then drifts.
- **Every LED gets its resistor.** 14.1 / 13.2 / 9.1 mA is inside the ATmega328P's 40 mA absolute DC per pin and 20 mA recommended limits; 36.4 mA total is well inside the board's 200 mA VCC + GND budget.
- **3.3 V boards.** On an ESP32 DevKit V1, top the pot to 3.3 V — 5 V into an ADC pin destroys it. Only GPIO34–39 are 5 V tolerant and they are input-only, so they cannot drive an LED at all.

#### 4. Embedded Concept Deep-Dive

**Ten bits over five volts.** `analogRead()` returns an integer 0–1023 across a 5 V AREF, so one count is $V_{LSB} = 5000\ \text{mV}/1024 = 4.883$ mV. The ATmega328P datasheet guarantees ±2 LSB of ADC accuracy — ±9.77 mV, ±0.20 % of knob travel — which is why a healthy pot sitting perfectly still still jitters by a couple of counts. Firmware can average that down (a 4-sample average cuts the random part by $\sqrt{4} = 2$, to ±0.10 %) but it cannot average it away. Convert counts to volts with `/1023.0`, not `/1024.0`, if you want the top code to mean exactly 5 V.

**`map()` truncates.** It is `(x - inMin) * (outMax - outMin) / (inMax - inMin) + outMin` in integer arithmetic, rounding toward zero at the destination step. Mapping 0–1023 onto 0–255 yields 255 only at exactly 1023 — which is why a real pot is calibrated to a usable range instead of the full code range.

**PWM is an average.** `analogWrite(pin, d)` holds the pin at $V_{CC}$ for $d/256$ of each period and at 0 V for the rest, so $V_{avg} = \frac{d}{256} V_{CC}$. LED brightness follows average *current*, so this is the right knob to turn.

**490 Hz, and why you hear it.** $31250/64 = 488.3$ Hz, rounded to "490". That is inside the band of hearing, so at low duty each flash is a discrete pulse the eye resolves as flicker and the ear, with the board near a microphone, resolves as a faint whine. A rolling camera shutter turns the same flicker into bright bands. And the channels are not all on one timer — D3/D11 are OC2A/OC2B on Timer2, D5/D6 are OC0A/OC0B on Timer0, D9/D10 are Timer1. **D5 and D6 share Timer0's single prescaler register `TCCR0B`**: touch D6 and D5 changes frequency, which is the well-known "using D6 broke D5" bug. The same register drives `millis()`, so writing `TCCR0B` yourself to escape 490 Hz also makes the clock run fast or slow. The escape hatches are `TCCR0B` directly (accept that `millis()` follows) or moving one channel to Timer1 on D9/D10 (accept that `Servo` claims Timer1 and you lose servos).

**Eight-bit depth.** 256 steps is 0.39 % of current per step, which is why a long slow fade bands visibly on a large diffuser even though each step alone is below threshold on a small indicator.

**Perception, and the divider's noise floor.** Human brightness response is roughly the 2.2 power of radiant flux, so a linear duty sweep reads as a fade that lurches at one end and crawls at the other. Correct it before writing:

$$d = \text{round}\!\left(\left(\frac{k - 30}{995 - 30}\right)^{2.2} \times 255\right)$$

| Knob $k$ | Raw counts | Raw duty | Gamma duty | $V_{avg}$ |
| --- | --- | --- | --- | --- |
| 0.10 | 126 | 25 (9.8 %) | 2 (0.8 %) | 0.039 V |
| 0.50 | 512 | 127 (49.8 %) | 55 (21.6 %) | 1.074 V |
| 1.00 | 995 | 255 (100 %) | 255 (100 %) | 4.980 V |

Half the knob travel now gives a quarter of the light, which is what the hand expects. The smallest step you can ask for is set by the converter's own floor: ±2 LSB is ±0.20 % of travel before filtering, ±0.10 % after a 4-sample average.

#### 5. Firmware Challenge & Code Template

**Starter Code Scaffold**

```cpp
/* 2.1 Precision Light Dimmer & Potentiometer Sampling -- Uno R3 starter. */

const uint8_t  KNOB_PIN = A0, RED_PIN = 3, GRN_PIN = 5, BLU_PIN = 11;
const uint8_t  SAMPLE_INTERVAL_MS = 10;   // 100 Hz; one conversion is 104 us
const uint16_t REPORT_INTERVAL_MS = 200, FAULT_HOLD_MS = 1000;
const uint8_t  WINDOW = 4;
const uint16_t CAL_MIN_COUNTS = 30, CAL_MAX_COUNTS = 995;  // measured ends
const float    GAMMA = 2.2;

uint16_t raw = 0, filtered = 0, window[WINDOW], windowSum = 0;
uint8_t  level = 0, windowIndex = 0;
bool     knobFault = false;
unsigned long lastSampleMs = 0, lastReportMs = 0, stuckSinceMs = 0;

/* Supplied complete: the mean of the last WINDOW samples. */
uint16_t average() {
  return windowSum / WINDOW;
}

void setup() {
  Serial.begin(9600);
  pinMode(RED_PIN, OUTPUT);  pinMode(GRN_PIN, OUTPUT);  pinMode(BLU_PIN, OUTPUT);
  analogWrite(RED_PIN, 0);   analogWrite(GRN_PIN, 0);   analogWrite(BLU_PIN, 0);
  /*
   * The first conversion after the ADC is enabled is allowed 114 us rather
   * than 104 us and can read a few counts low: prime the window with real
   * throwaway conversions rather than with zero. */
  windowSum = 0;
  for (uint8_t i = 0; i < WINDOW; i++) { window[i] = analogRead(KNOB_PIN); windowSum += window[i]; }
}

void loop() {
  unsigned long now = millis();

  if (now - lastSampleMs >= SAMPLE_INTERVAL_MS) {
    lastSampleMs = now;

    /* TODO 1: read KNOB_PIN into `raw`, push it into window[windowIndex], and
       keep windowSum right by adding it and subtracting what it displaces. */

    filtered = average();

    /* TODO 2: wiper fault. `raw` pinned at 0 or 1023 for longer than
       FAULT_HOLD_MS is a detached or dead wiper, not a dim setting. Latch
       knobFault, force level to 0, and clear it when a sample lands back
       inside the calibrated range. Compare wrap-safely via stuckSinceMs. */

    /* TODO 3: scale filtered across CAL_MIN_COUNTS..CAL_MAX_COUNTS onto 0..255
       with map(), clamp, then apply gamma before the writes:
         level = (uint8_t)(pow(knob01, GAMMA) * 255.0 + 0.5);
       map() truncates, so only CAL_MAX_COUNTS exactly reaches 255. */

    analogWrite(RED_PIN, level);
    analogWrite(GRN_PIN, level);
    analogWrite(BLU_PIN, level);
  }

  if (now - lastReportMs >= REPORT_INTERVAL_MS) {
    lastReportMs = now;
    Serial.print(raw);      Serial.print('\t');
    Serial.print(filtered); Serial.print('\t');
    Serial.print(level);    Serial.print('\t');
    Serial.println(knobFault ? "KNOB FAULT" : "ok");
  }
}
```

**Functional Requirements**

- Sample A0 every 10 ms and keep the last `WINDOW` samples in the running average.
- Map `filtered` across the calibrated range onto 0–255 so the extremes are reachable, then apply gamma before any `analogWrite`.
- Report raw, averaged and duty values five times a second on the serial monitor.
- Raise a wiper fault when the raw count sits at 0 or 1023 for more than 1 s, and report it instead of pretending the knob is at an end stop.

**Constraints**

- No `delay()` or `delayMicroseconds()`, in `setup()` or `loop()`.
- At most 100 `analogRead()` calls per second. One conversion is 13 ADC clocks at the core's ÷128 prescaler — 104 µs — so 100 Hz costs about 1 % of the loop against a ceiling of roughly 9.6 kSPS.
- Every interval test is `now - last >= INTERVAL` in unsigned arithmetic, so the 49.7-day `millis()` wrap changes nothing.
- One `pow()` per update and no other floating point in the hot path. The ATmega328P has no FPU and avr-libc's `pow()` costs on the order of a millisecond at 16 MHz: compute `level` **once** and write the same byte to all three pins.

#### 6. Verification Checklist & Debugging Tasks

1. The serial monitor shows three columns and a status field, 200 ms apart.
2. At the bottom of travel the raw count sits near 30 and the LEDs are dark; at the top, near 995 and full.
3. Watch `raw` against `filtered` with the knob still: `raw` jitters by a couple of counts, `filtered` by a fraction of one.
4. Sweep slowly by hand. The visible change is evenly paced; without the gamma it lurches at one end.
5. Lift the wiper off A0 entirely — the fault appears within a second and the LEDs go dark.
6. On the Scope, probe D3 and confirm a 488 Hz square wave whose average tracks the duty: at `level = 55` the measured average is about 1.07 V.

**Simulated Hardware Fault:**

- **Symptom:** the LEDs sit at roughly half brightness with the pot at minimum, and the brightness jumps when a finger touches the wiring.
- **Diagnosis:** (1) Pull the 100 nF and watch the `raw` column — the jitter roughly doubles and the reading droops while the ADC's sample capacitor recharges; that is source impedance, not the pot. (2) Substitute a `100k Resistor` for the pot's legs (a 100 kΩ pot on the bench): the Thévenin impedance goes to 25 kΩ at mid-travel, past the 10 kΩ rule of thumb, and the reading gets worse, not better. (3) Disconnect the wiper from A0 completely: noise across the whole range means the pin is floating, and the meter confirms it — an ADC pin with nothing attached wanders across a fraction of a volt. (4) If the minimum is not zero, print the raw minimum and maximum over one full sweep and put those numbers into `CAL_MIN_COUNTS` / `CAL_MAX_COUNTS`. 30 and 995 are a starting point from a typical pot, not a law.
- **Fix:** refit the 100 nF, return to a 10 kΩ pot, and set the calibration range to your measured endpoints. Item (3) is separately a symptom of `analogWrite` on D6 re-prescaling Timer0 out from under D5 — move the green channel to D9 if you ever need two different frequencies.

#### 7. Noesis Lab Twin

Uno R3, a `10k Potentiometer` (or a `Slide Potentiometer`) across the rails with the wiper on A0, a `100nF Capacitor` from A0 to GND, and `Red LED` / `Green LED` / `Blue LED` with anodes on the 5 V rail and a `220 Resistor` each to D3, D5 and D11. The simulator models the pot as a resistive divider and the LED as a diode whose output is weighted by the PWM duty, so the twin reproduces the mapping and the gamma curve exactly as written.

```cpp
/* 2.1 twin: pot on A0, three LEDs on D3/D5/D11. The interpreter has no
   casts, no i++, no log, no A0..A5 aliases, and its `/` truncates. */
#define A0_PIN 14          /* A0 on the ATmega328P is GPIO 14; A1..A5 are 15..19 */
#define SAMPLE_MS 10
#define REPORT_MS 200
#define CAL_MIN 30
#define CAL_MAX 995
#define FAULT_MS 1000

int window[4], sum = 0, windex = 0, raw = 0, stuckSince = 0;
float duty = 0;
bool fault = false;
unsigned long lastSample = 0, lastReport = 0;

void setup() {
  Serial.begin(9600);
  pinMode(3, OUTPUT);  pinMode(5, OUTPUT);  pinMode(11, OUTPUT);
  analogWrite(3, 0);   analogWrite(5, 0);   analogWrite(11, 0);
  raw = analogRead(A0_PIN);
  for (int i = 0; i < 4; i = i + 1) window[i] = raw;
  sum = raw * 4;
}

void loop() {
  unsigned long now = millis();

  if (now - lastSample >= SAMPLE_MS) {
    lastSample = now;
    raw = analogRead(A0_PIN);
    sum = sum + raw - window[windex];
    window[windex] = raw;
    windex = (windex + 1) % 4;
  }

  if (now - lastReport >= REPORT_MS) {
    lastReport = now;
    if (raw <= 2 || raw >= 1021) {
      if (stuckSince == 0) stuckSince = now;
      if (now - stuckSince >= FAULT_MS) fault = true;
    } else { stuckSince = 0; fault = false; }
    if (fault) duty = 0;
    else {
      /* 1/255 written as a reciprocal, because the interpreter's `/` truncates. */
      float knob = map(sum / 4, CAL_MIN, CAL_MAX, 0, 255) * 0.00392157;
      duty = pow(knob, 2.2) * 255.0 + 0.5;
    }
    analogWrite(3, duty);  analogWrite(5, duty);  analogWrite(11, duty);
    Serial.print(raw);           Serial.print("\t");
    Serial.print(sum / 4);       Serial.print("\t");
    Serial.print(duty, 0);       Serial.print("\t");
    Serial.println(fault ? "KNOB FAULT" : "ok");
  }
}
```

**Twin limits, stated plainly.** The simulator's `analogRead` rounds the settled net voltage into the board's integer ADC count, so the 1024-bucket floor is visible — but it adds **no noise, no source-impedance droop and no first-read settling error**, because there is no sample-and-hold capacitor to model. The ±2 LSB accuracy lesson and the 100 nF lesson are bench-only; neither is observable here. A genuinely floating input *does* drift in the simulator, so the wiper-lifted step in the fault above still works.

The firmware interpreter has a short vocabulary, and an unknown identifier silently evaluates to **0** rather than failing — the most dangerous of its gaps. There are no `A0`–`A5` aliases, so `analogRead(A0)` reads pin 0; both twins name the ATmega328P GPIO numbers (14 and 15) instead. There is no `log` or `exp`, no C-style cast, no `i++`, no bare `return;`, no `String` and no structs, `const int` is not a type it parses, `/` always truncates toward zero even on floats (multiply by a reciprocal instead), and `int a = 1, b = 2;` parses at file scope but not inside a function body. Constants therefore go in as `#define NAME <number literal>` — and a `#define` holding an *expression* silently becomes zero.

---

### 2.2: Analog Sensor Calibration & Voltage Dividers
**Difficulty Level:** Intermediate
**Level:** 3
**Estimated Completion Time:** 75–90 mins

#### 1. Real-World Scenario

A greenhouse climate logger. An NTC thermistor in a radiation shield reads air temperature, a GL5528 photoresistor on the roof reads canopy light, and a colleague wants a CSV they can plot. Both channels sample every 10 ms, filtered hard enough to survive a relay click and a fan start, and calibrated at boot — because the real question is not "what does the ADC say" but "how wrong can this reading be".

#### 2. Hardware Inventory & Pinout Map

| Board Pin | Component Terminal | Connects To | Value / Notes |
| --- | --- | --- | --- |
| 5 V | NTC lead 1 | 5 V rail | Sensor on **top**, so node T rises with temperature |
| Node T | NTC lead 2, and 10 kΩ top | — | $R_s$ = 10 kΩ NTC, β = 3950; $R_f$ = 10 kΩ fixed |
| Node T | A0 (ADC0) | — | 10-bit channel |
| GND | 10 kΩ fixed, bottom | GND rail | |
| Node T | 100 nF lead `+`; GND its `−` | GND rail | Same source-impedance argument as 2.1 |
| 5 V | LDR lead 1 | 5 V rail | Sensor on top; R falls as light rises |
| Node L | LDR lead 2, and 10 kΩ top | — | GL5528, ≈ 3.5 kΩ bright, ≈ 50 kΩ dark |
| Node L | A1 (ADC1) | — | 10-bit channel |
| GND | 10 kΩ fixed, bottom | GND rail | |
| Node L | 100 nF lead `+`; GND its `−` | GND rail | |

**Bill of materials:** Arduino Uno R3; 10 kΩ NTC thermistor, β = 3950, bead type; GL5528 photoresistor; 2× 10 kΩ 1 % fixed resistors; 2× 100 nF ceramic capacitors; full-size breadboard and jumpers.

#### 3. Circuit Schematics & Wiring Guide

```text
  TEMPERATURE CHANNEL                    LIGHT CHANNEL

   +5V --+---------+                       +5V --+---------+
         |         |                             |         |
      [ NTC  ]  [100nF]                     [ LDR  ]  [100nF]
      [ 10kΩ ]  [  .  ]                     [ GL   ]  [  .  ]
      [  .  ]     |                          [  .  ]     |
         |        |  A0                         |        |  A1
        (T)-------+-----                      (L)-------+-----
         |        |                             |        |
      [ 10 k ]    |                          [ 10 k ]    |
      [  .  ]     |                          [  .  ]     |
         |        |                             |        |
   -----+--------+-- GND                  -----+--------+-- GND
```

**Wiring procedure**

1. Build both dividers with the sensor leg on **top**: the node voltage then rises with the quantity you care about, so the whole log sits in the upper two thirds of the ADC's range instead of being squeezed into its bottom decile.
2. NTC lead 1 → 5 V, lead 2 → node T, node T → 10 kΩ → GND, node T → A0.
3. LDR lead 1 → 5 V, lead 2 → node L, node L → 10 kΩ → GND, node L → A1.
4. 100 nF across each node to GND. Ceramic is non-polarised; if it is polarised, `+` to the node.
5. Meter check before power-on: at 25 °C node T must read almost exactly 2.5 V, because $R_s = R_f$. Node L should sit between 0.83 V (50 kΩ, dark) and 3.70 V (3.5 kΩ, bright).
6. Cover the LDR and watch node L climb; breathe on the NTC and watch node T climb.

**Hardware Gotchas & Safety Rules:**

- **Orientation is not cosmetic.** NTC on top: 5 °C sits at 1.39 V and 45 °C at 3.49 V, so 0–80 °C spans counts 235–908. Flipped, the same range spans 115–738 and the whole cold end collapses into the bottom 11 % of the code range, where quantisation is coarsest.
- **The divider is not free.** Each channel draws $I = 5/(10\text{k} + 10\text{k}) = 250\ \mu A$ permanently; two channels is 0.5 mA of the board's shared budget.
- **Self-heating is real.** $P = I^2R = (250\ \mu A)^2 \times 10\text{k} = 0.625$ mW in the thermistor. A bead 10 kΩ NTC's dissipation constant is 1–2 mW/°C, so that is 0.3–0.6 °C of error, always in the same direction.
- **Both nodes need their capacitor.** The far leg is 10 kΩ too, so the Thévenin impedance is 5 kΩ at mid-travel with nothing to spare.
- **A relay click is an edge, not a glitch.** Anything inductive on the rail couples into both nodes; the 100 nF plus the median in §5 is the answer, not more filtering.

#### 4. Embedded Concept Deep-Dive

**The divider, forwards and backwards.** Sensor on top, $R_f$ below: $V = V_{CC}\cdot\frac{R_f}{R_f + R_s}$, so the node falls as the sensor's resistance rises. Inverting gives it back:

$$R_s = R_f\left(\frac{V_{CC}}{V} - 1\right)$$

At 25 °C, where $R_s = R_f = 10$ kΩ, the node sits at exactly $V = 5 \times \frac{1}{2} = 2.5$ V — 512 counts. That single point is the whole calibration check: if the sketch says 25 °C and the meter says anything but 2.5 V, the divider is wrong.

**The NTC curve.** $\beta$ relates resistance to temperature by

$$T = \left(\frac{1}{T_0} + \frac{\ln(R/R_0)}{\beta}\right)^{-1} - 273.15, \qquad T_0 = 298.15\ \text{K},\ R_0 = 10\text{k}\Omega$$

Two checks: $R = 10$ kΩ gives exactly 25.0 °C (the anchor, since $\ln 1 = 0$), and $R = 15.8$ kΩ — the datasheet's figure for 15 °C at β = 3950 — gives 15.0 °C. Get it wrong in the obvious way and $R = 14.8$ kΩ returns 16.4 °C, which is why the check value is worth computing rather than assuming.

**The error budget — the point of the exercise.** Notice where the money is not:

| Term | Magnitude at 25 °C | Notes |
| --- | --- | --- |
| ADC accuracy | ±2 LSB = ±9.77 mV | 0.125 mV/Ω, so ±78 Ω: **±0.18 °C** |
| Divider current | 250 µA, 0.625 mW | **+0.3 to +0.6 °C**, always positive |
| Fixed resistor 5 % | **±1.1 °C** | at 10.5 kΩ the reading runs 1.1 °C warm, at 9.5 kΩ it runs 1.2 °C cold |
| NTC $R_0$ ±1 % | 0 at 25 °C, ±0.21 °C at 15 °C, ±0.28 °C at 60 °C | 25 °C *is* the anchor, so it cancels |
| β ±1 % | ±0.10 °C at 15 °C, ±0.39 °C at 60 °C | a no-name bead sold as ±5 % β is worth ±2.0 °C at 60 °C |

The converter is not the limit; the tolerance of a 5 % resistor is roughly six times worse, and self-heating adds half a degree that no amount of averaging removes. Calibration cannot rescue a 5 % resistor either, because one reference point recovers only an offset. Gain needs two — an ice-water slurry at 0 °C, then boiling water at 100 °C — which is how you recover gain and offset separately and stop needing the datasheet's β at all.

**Filtering.** A moving average of $N$ samples has a group lag of about $N/2$ samples and smears a single spike across all $N$ without ever removing it. A median of $N$ kills single-sample outliers outright while adding no lag to a real step — the right trade when the disturbances are impulses. Median-of-5 then average-of-8 does both: the median throws away relay clicks, the average takes the remaining quantisation noise down by $\sqrt{8} = 2.83$, and the residual lag is about 1.5 samples at 100 Hz — 15 ms, invisible beside the thermal time constant of the air being measured.

#### 5. Firmware Challenge & Code Template

**Starter Code Scaffold**

```cpp
/* 2.2 Analog Sensor Calibration & Voltage Dividers -- Uno R3 starter. */

const uint8_t  TEMP_PIN = A0, LIGHT_PIN = A1;
const uint8_t  SAMPLE_INTERVAL_MS = 10;
const uint16_t REPORT_INTERVAL_MS = 500;    // 2 Hz CSV
const uint8_t  MEDIAN_N = 5, MEAN_N = 8, BOOT_SAMPLES = 32;
const uint16_t BOOT_WINDOW_MS = 500;
const float    TEMP_MIN_C = 0.0, TEMP_MAX_C = 80.0;
const float R_SERIES_OHMS = 10000.0, NTC_OHMS_AT_25C = 10000.0;
const float NTC_BETA_K = 3950.0, KELVIN_AT_25C = 298.15;

uint16_t tempWindow[MEDIAN_N], rawTemp = 0, rawLight = 0;
uint8_t  tempIndex = 0, meanIndex = 0, bootCount = 0;
float    meanBuf[MEAN_N], scratch[MEDIAN_N], tempOffsetC = 0.0;
bool     bootDone = false, sensorFault = false;
unsigned long bootSum = 0, lastSampleMs = 0, lastReportMs = 0;

void setup() {
  Serial.begin(9600);
  Serial.println("ms,temp_c,lux_raw,light_pct");
  for (uint8_t i = 0; i < MEDIAN_N; i++) tempWindow[i] = 512;
  for (uint8_t i = 0; i < MEAN_N; i++) meanBuf[i] = 25.0;
}

/* Supplied complete: an ADC count at node T back to ohms. */
float thermistorOhms(uint16_t counts) {
  if (counts == 0) return 1e9;                    // node shorted to ground
  float volts = counts * 5.0 / 1023.0;
  return R_SERIES_OHMS * ((5.0 / volts) - 1.0);
}

void loop() {
  unsigned long now = millis();

  if (now - lastSampleMs >= SAMPLE_INTERVAL_MS) {
    lastSampleMs = now;

    /* TODO A: one analogRead each of TEMP_PIN and LIGHT_PIN into rawTemp and
       rawLight. Never read the same pin twice inside one window. */

    /* TODO B: the beta conversion, from the supplied thermistorOhms():
         T = (1/KELVIN_AT_25C + log(R / NTC_OHMS_AT_25C) / NTC_BETA_K)^-1
             - 273.15;   Guard R <= 0 before the log. */

    /* TODO C: median-of-MEDIAN_N over a copy of tempWindow (selection sort
       into scratch[]), push the median into meanBuf, take the mean of
       MEAN_N. Print nothing in here. */

    /* TODO D: boot calibration. While bootCount < BOOT_SAMPLES accumulate
       rawTemp, then set tempOffsetC to the mean and subtract it from every
       later reading. A real calibration would put the sensor in an ice-water
       slurry (0 C) and then in boiling water (100 C) and solve for gain and
       offset separately -- one reference point recovers only the offset. */

    /* TODO E: sensor fault. Outside TEMP_MIN_C..TEMP_MAX_C, latch
       sensorFault and print the transition once; clear and print it again
       when the reading returns. Never print it every sample. */
  }

  if (now - lastReportMs >= REPORT_INTERVAL_MS) {
    lastReportMs = now;

    /* TODO F: one CSV row -- now, temperature to one decimal place, the raw
       light count, and the light percentage mapped across this divider's own
       measured ends. Serial.print(value, 1) gives the decimal place. */
  }
}
```

**Functional Requirements**

- Sample both channels every 10 ms.
- Filter temperature as median-of-5 then moving-average-of-8; print one decimal place.
- Boot calibration: the mean of the first 32 samples taken inside the first 500 ms, stored as `tempOffsetC` and subtracted from every later reading.
- A reading outside 0–80 °C raises a sensor-fault flag, printed once per transition.
- CSV header at boot, rows at 2 Hz: `ms,temp_c,lux_raw,light_pct`.

**Constraints**

- No `delay()` or `delayMicroseconds()`, in `setup()` or `loop()`.
- No `String`, no `malloc`, no dynamic allocation: the ATmega328P has 2 KB of SRAM and every `String` fragment is a heap block.
- All interval tests wrap-safe — `now - last >= INTERVAL` in `unsigned long`, so the 49.7-day `millis()` wrap is harmless.
- `Serial` capped at 2 Hz. At 9600 baud the row above is about 22 characters, roughly 23 ms of transmit, far too long to sit inside the 10 ms sample path.
- `log()` is called once per report, never once per sample.

#### 6. Verification Checklist & Debugging Tasks

1. At room temperature the sketch reads 24–26 °C and the meter reads 2.4–2.6 V on node T.
2. Breathe on the NTC: the reading rises within a second and settles back.
3. Cover the LDR: `lux_raw` rises and `light_pct` follows it monotonically.
4. Switch the fan on. The temperature column does not twitch; the unfiltered count does.
5. Fit a 1 kΩ resistor at node T in place of the thermistor. The sketch reports a temperature far above 80 °C, prints the fault once, and stays quiet until the circuit is fixed.
6. Paste the serial output into a spreadsheet and plot `temp_c` against `ms`. A flat line with occasional one-count steps is what you want.

**Simulated Hardware Fault:**

- **Symptom:** every temperature reading is roughly 4.5× too high, and no amount of calibration improves it.
- **Diagnosis:** (1) Search the sketch for `analogReference`. A single `analogReference(INTERNAL)` re-bases the ADC onto the internal 1.1 V bandgap, so the 512 counts that meant 2.5 V now mean 1.1 V, and every `counts × 5.0 / 1023.0` in the maths is wrong by a factor of $5.0/1.1 = 4.55$. Because the error is a change of *slope*, calibrating an offset against it cannot help — this is also the commonest cause of "my ADC is broken" on an ESP32, where the same call exists. (2) Second, separate fault: the reading creeps up about 1 °C while a finger rests near the board. That is self-heating, 250 µA putting 0.625 mW into the bead. Swap both 10 kΩ resistors for 47 kΩ and the current falls to 53 µA, the dissipation to 0.133 mW, and the error roughly halves — at the price of 4.7× the current error referred to the ADC and a 23.5 kΩ source impedance, which puts the 100 nF back on the critical path. (3) Third, separate fault: single-sample spikes when the fan starts. Print the unfiltered count to confirm they are real edges, not conversion noise. The median removes them; the average alone drags the reading for five samples and never fully recovers.
- **Fix:** delete the `analogReference()` call or make it `analogReference(DEFAULT)`, restore the 10 kΩ legs if you changed them, and keep both filters in the chain. Put the 100 nF back on any node you have re-resistorised.

#### 7. Noesis Lab Twin

Uno R3, a `Thermistor (NTC) Module` to A0 and a `Photoresistor (LDR) Module` to A1. Both modules are already 10 kΩ dividers with the sensor leg on top — the same orientation, the same 10 kΩ, the same β = 3950 at 10 kΩ/25 °C the exercise assumes — so on the twin you wire `VCC` → 5 V, `GND` → GND and the module's analogue output straight to the ADC. Do **not** rebuild the divider on the breadboard, and leave the LDR module's `DO` comparator output unconnected. Both modules have a knob, so set the thermistor to 25 °C and the reading must come out at 512 counts.

```cpp
/* 2.2 twin: NTC module on A0, LDR module on A1. Fixed-point tenths of a C.
   The interpreter has no A0..A5 aliases, so the ATmega328P GPIO numbers
   are named directly: A0 is GPIO 14, A1 is GPIO 15. */
#define A0_PIN 14
#define A1_PIN 15
#define SAMPLE_MS 10
#define REPORT_MS 500

/* counts -> tenths of a degree C, NTC on top, 10k below, 25 C = 512 counts */
int lutCounts[17] = { 192, 240, 288, 336, 384, 432, 480, 528, 576,
                       624, 672, 720, 768, 816, 864, 912, 960 };
int lutTenths[17] = { -47, 6, 53, 97, 140, 181, 223, 265, 308,
                      354, 404, 458, 521, 594, 687, 814, 1022 };

int medWin[5], meanWin[8], scratch[5], sum = 0;
int medIndex = 0, meanIndex = 0, tenths = 250, rawTemp = 0, rawLight = 0;
bool fault = false, latched = false;
unsigned long lastSample = 0, lastReport = 0;

int lutLookup(int c) {                     /* clamped linear interpolation */
  if (c <= lutCounts[0]) return lutTenths[0];
  int i = 0;
  while (i < 15 && c > lutCounts[i + 1]) i = i + 1;
  int x0 = lutCounts[i];
  int y0 = lutTenths[i];
  int x1 = lutCounts[i + 1];
  int y1 = lutTenths[i + 1];
  return y0 + ((y1 - y0) * (c - x0) * 2 + (x1 - x0)) / ((x1 - x0) * 2);
}

void setup() {
  Serial.begin(9600);
  Serial.println("ms,temp_c,lux_raw,light_pct");
  for (int i = 0; i < 5; i = i + 1) medWin[i] = 512;
  for (int i = 0; i < 8; i = i + 1) meanWin[i] = 250;
  sum = 250 * 8;                       /* the running mean starts matching its window */
}

void loop() {
  unsigned long now = millis();

  if (now - lastSample >= SAMPLE_MS) {
    lastSample = now;
    rawTemp = analogRead(A0_PIN);
    rawLight = analogRead(A1_PIN);

    medWin[medIndex] = lutLookup(rawTemp);
    medIndex = (medIndex + 1) % 5;
    for (int i = 0; i < 5; i = i + 1) {       /* selection sort; median ends at [2] */
      int k = i;
      for (int j = i + 1; j < 5; j = j + 1) if (medWin[j] < medWin[k]) k = j;
      scratch[i] = medWin[k]; medWin[k] = medWin[i]; medWin[i] = scratch[i];
    }
    sum = sum + scratch[2] - meanWin[meanIndex];    /* running mean of 8 */
    meanWin[meanIndex] = scratch[2];
    meanIndex = (meanIndex + 1) % 8;
    tenths = (sum * 2 + 8) / 16;
  }

  if (now - lastReport >= REPORT_MS) {
    lastReport = now;
    int shown = tenths;
    if (shown < 0) shown = 0;                  // the table's lowest entry is -4.7 C
    Serial.print(now);           Serial.print(",");
    Serial.print(shown / 10);    Serial.print(".");
    Serial.print(shown - (shown / 10) * 10);  Serial.print(",");
    Serial.print(rawLight);      Serial.print(",");
    Serial.println(map(rawLight, 171, 758, 0, 100));
    if (tenths < 0 || tenths > 800) {
      if (!latched) { latched = true; Serial.println("SENSOR FAULT: temp outside 0..80 C"); }
    } else if (latched) { latched = false; Serial.println("SENSOR FAULT cleared"); }
  }
}
```

The twin uses a 17-entry lookup in **tenths of a degree** rather than the β equation, because the interpreter has no `log`. The table was generated from that equation and covers 0–80 °C with a worst-case interpolation error of 0.8 °C, all of it high; halving the 48-count step halves that. Note the consequence — the twin raises its fault flag at about 79.7 °C rather than 80.0 °C. That is the table's error, not a sensor fault, and it is exactly why a limit check needs a guard band wider than the conversion error.

The same interpreter limits apply as in 2.1, and one more bites here: with no `log`, the β conversion has to become a table, and the fixed-point tenths printing exists because `/` truncates. One declarator per statement is why `lutLookup` reads the way it does.

The twin sketch also drops the boot calibration, and the median has almost nothing to do: **the simulator has no `analogReference`, so the 1.1 V fault above is bench-only**, and its ADC output is noiseless — it rounds the settled net voltage straight into the integer count — so filtered and unfiltered columns are identical. Verify the filter by reading the code, not by watching the serial output. `light_pct` maps 171 → 758 counts (50 kΩ dark to 3.5 kΩ bright through the module's own 10 kΩ), the reverse direction a photoresistor needs.