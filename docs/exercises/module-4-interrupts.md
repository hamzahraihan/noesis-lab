# Module 4 — Hardware Interrupts & Low-Level Control

Two exercises that hand a signal to the firmware faster than `loop()` can look at it. Both are
explicit about where the Uno's limits bite: two external interrupts and nothing else, no input
capture, and an 8-bit core that reads a `long` in four instructions.

| ID | Exercise | Difficulty | Time |
| --- | --- | --- | --- |
| 4.1 | High-Speed Rotary Encoder & Optical Tachometer | Advanced | 90–120 mins |
| 4.2 | Distance Radar with Ultrasonic Sensor (HC-SR04) | Advanced | 60–75 mins |

---

### 4.1: High-Speed Rotary Encoder & Optical Tachometer
**Difficulty Level:** Advanced
**Level:** 5
**Estimated Completion Time:** 90–120 mins

#### 1. Real-World Scenario

A CNC spindle panel. The KY-040 jog wheel is the operator's hand-wheel — one count per detent, no
lost motion — and it must keep answering while the spindle turns. Spindle speed comes from a
reflective optical sensor looking through a 24-slot disc on the shaft. Both signals outrun a polling
loop: at 3000 RPM the disc alone presents 24 × 50 = 1200 slots/s, and change detection makes that
2400 edges/s, which `loop()` cannot sample because the transitions fall between reads and are simply
gone. Both channels go to interrupt handlers, and those handlers must stay short enough that the
millisecond timing for the serial report and the switch debounce survives untouched.

#### 2. Hardware Inventory & Pinout Map

| Board Pin | Component Terminal | Connects To | Value / Notes |
| --- | --- | --- | --- |
| 5 V | KY-040 VCC | Uno 5 V | Required; CLK/DT/SW are pulled up to it |
| GND | KY-040 GND | Uno GND | |
| D2 (INT0) | KY-040 CLK | through `1 kΩ Resistor` | `10 nF` to GND at the D2 end; idles HIGH |
| D3 (INT1) | KY-040 DT | through `1 kΩ Resistor` | `10 nF` to GND at the D3 end; idles HIGH |
| D4 | KY-040 SW | direct | Active-LOW, polled, `INPUT_PULLUP` + software debounce |
| 5 V | TCRT5000 VCC | Uno 5 V | Sensor 3–5 mm off the disc |
| GND | TCRT5000 GND | Uno GND | |
| D5 | TCRT5000 OUT | `10 kΩ Resistor` to 5 V, `100 nF Capacitor` to GND | PCINT only — no external interrupt on D5 |

Bill of materials: 1× Uno R3 · 1× KY-040 · 1× TCRT5000 with a 24-slot 15°-pitch disc · 2×
`1 kΩ Resistor` · 2× 10 nF (not stocked, see gotchas) · `10 kΩ Resistor` · `100 nF Capacitor`.

#### 3. Circuit Schematics & Wiring Guide

```text
  +5 V ─┬────────────────────────────────────────────────────────────── ┐
       │                                                                │
  KY-040 VCC ─────────► +5 V      TCRT5000 VCC ────────► +5 V           │
  KY-040 GND ─────────► GND      TCRT5000 GND ────────► GND             │
  KY-040 CLK ──┬──[ 1 kΩ ]──┬─────────────► UNO D2  (INT0)              │
                │            │  [10 nF] to GND                          │
  KY-040 DT  ──┬──[ 1 kΩ ]──┬─────────────► UNO D3  (INT1)              │
                │            │  [10 nF] to GND                          │
  KY-040 SW  ──┴───────────────────────────► UNO D4  (polled)           │
  TCRT5000 OUT ─┬──[ 10 kΩ ]──┬────────────► UNO D5  (PCINT0)           │
                 │            │  [100 nF] to GND                        │
  Spindle disc: 24 slots x 15 deg, TCRT5000 gap 3-5 mm ─────►           │
  └─────────────────────────────────────────────────────────────────────┘
```

1. Break the breadboard rails and run +5 V and GND from the Uno's power pins.
2. CLK and DT: `1 kΩ` in series, then `10 nF` from the **D2/D3 side** to GND. The filter belongs at
   the pin — at the module end it does nothing to what the pin sees.
3. SW straight to D4; the KY-040 already brings a pull-up, so `INPUT_PULLUP` is belt-and-braces.
4. TCRT5000 OUT: `10 kΩ` to +5 V, `100 nF` to GND, filtered node to D5.

**Hardware Gotchas & Safety Rules:**

- **Both external interrupts are spent.** INT0 is D2 and INT1 is D3 and nothing else.
  `attachInterrupt(5, ...)` still compiles, but on an ATmega328P it selects the PORTD **pin-change**
  interrupt, whose group covers **D0–D7** — every encoder edge vectors into `tachIsr()` too. Guard it
  by re-reading the port and rejecting a level that did not change: `static uint8_t last = 1;` then
  `uint8_t lv = (PIND & _BV(PIND5)) != 0; if (lv == last) return; last = lv;`
- **10 nF is not in the shared parts bin** (100 nF, 1 µF, 10 µF, 470 µF are). A 100 nF here gives
  $\tau = 100\,\mu s$, exactly the spacing the fastest legitimate edges have, and x4 silently collapses
  to one count per detent. Trim 100 nF to 10 nF.
- With the KY-040's VCC unwired both output lines float and `digitalRead` returns noise. Power the
  module from the board's 5 V pin only, never from a second supply. Do not probe a filtered node on the
  Multimeter's resistance range while the pin drives: the 10 nF charges and the reading drifts.

#### 4. Embedded Concept Deep-Dive

**Quadrature and the Gray code.** The two outputs cycle through four states and only one bit changes
per transition: $11 \rightarrow 01 \rightarrow 00 \rightarrow 10 \rightarrow 11$, or the reverse. Encoding
a state as $(CLK ? 2 : 0) + (DT ? 1 : 0)$ gives 3 → 1 → 0 → 2 → 3 clockwise. x1 decoding counts one
transition per detent, so 20 detents/rev is **20 counts/rev**; x4 counts all four, so
20 × 4 = **80 counts/rev**. **The transition table is the only correct implementation:** index it by
`previous * 4 + current`, entry +1 clockwise, −1 counter-clockwise, 0 illegal. Eight of the sixteen
indices are illegal — 3, 6, 9 and 15 are both lines changing in the same instant, and 0, 5, 10 and 14
are the line returning to the state it left, the two shapes contact bounce takes. An illegal entry
must be **counted and rejected, never guessed at**; code that samples one line and assumes the other
followed, or that treats any change as one step, is what produces phantom counts, silently.

**The filter is chosen against the edge spacing, not by taste.**
$\tau = RC = 1\,\text{k}\Omega \times 10\,\text{nF} = 10\,\mu s$ — long enough to swallow the ~5 µs
spike of a bouncing contact, short enough to preserve the ~100 µs spacing between the fastest legitimate
edges within a detent transition. At 100 nF, $\tau = 100\,\mu s$ matches that spacing exactly: the
capacitor never charges between the edges of one detent step, the rebuilt waveform has one edge instead
of four, and x4 degrades to x1. Strictly the cap discharges through $R_S \parallel R_{PU} \approx 0.9\,\text{k}\Omega$
and charges through $R_S + R_{PU} \approx 11\,\text{k}\Omega$, so the two constants differ — check the
edges on the Scope. The design number is 10 µs and the acceptance test is behavioural.

**`volatile`, and why it is not enough.** The compiler keeps a variable in a register for the length of
a loop iteration and never sees the interrupt's write; `volatile` forces every access to memory. Above
a byte on an 8-bit core that still is not atomic: a `long` is 32-bit and read in **four** instructions,
so a read straddling the handler's store comes back torn — 3 and 4, or −1 and 0. Read a byte- or
word-sized `volatile`, or wrap the read in `ATOMIC_BLOCK(ATOMIC_RESTORESTATE)`.

**The interrupt budget, and RPM from a period.** One cycle on a 16 MHz AVR is 62.5 ns, and entry plus
exit for a non-minimal handler costs roughly 40–60 cycles before the first instruction, putting the
practical ceiling at about **20–30 k interrupts/s** with a short handler. Count this design at 3000 RPM:
1200 pulses/s becomes 2400 interrupts/s under change detection, plus 20 from hand-wheeling at 5
detents/s; at a 20 µs handler that is $2420 \times 20\,\mu s = 48.4$ ms per second, or **4.84 %** —
inside the 5 % budget with almost nothing to spare. That arithmetic, not intuition, is why bounce is
rejected at the wire instead of in the handler. Speed comes from $\text{RPM} = \dfrac{60 f}{N}$ with
$N = 24$: $f = \frac{3000}{60} \times 24 = 1200$ pulses/s, period 833 µs. Timing edge to edge with
`micros()` resolves as finely but updates every 833 µs instead of every second. `micros()` is a 32-bit
`unsigned long` that wraps every $2^{32}\,\mu s \approx 71.6$ minutes, so the subtraction must be
unsigned and the difference range-checked before it is believed.

#### 5. Firmware Challenge & Code Template

**Starter Code Scaffold**

```cpp
// Exercise 4.1 -- CNC spindle panel: quadrature jog wheel + optical tachometer.
// Uno R3. Section 7 holds a separate polling-only twin.
const uint8_t PIN_CLK = 2, PIN_DT = 3, PIN_SW = 4, PIN_TACH = 5;  // 2, 3 are INT0/INT1
const uint8_t SLOTS_PER_REV = 24;
const unsigned long REPORT_MS = 100, SW_DEBOUNCE_MS = 20;
const unsigned long NOISE_FLOOR_US = 300, SLOWEST_US = 1000000;

// Shared with a handler: volatile stops the compiler caching a value, but it
// does not make a 32-bit read atomic.
volatile uint8_t  encoderState = 0;
volatile int8_t   stepCount    = 0;
volatile uint16_t illegalCount = 0;
volatile unsigned long lastEdgeUs = 0;
volatile uint16_t periodUs        = 0;
volatile uint32_t tachEdges       = 0;

// previous * 4 + current, state = (CLK ? 2 : 0) + (DT ? 1 : 0).
// +1 clockwise, -1 counter-clockwise, 0 illegal and never applied.
static const int8_t QUAD_TABLE[16] = {
  0, -1,  1,  0,    1,  0,  0, -1,   -1,  0,  0,  1,    1, -1,  0,  0
};

void encoderIsr() {
  // TODO: sample both lines into curr and index QUAD_TABLE with
  //       encoderState * 4 + curr. Apply a non-zero entry to stepCount, count a
  //       zero entry in illegalCount, and write curr back either way.
}

void tachIsr() {
  // TODO: micros() against lastEdgeUs -- unsigned, so the 71.6 min wrap cannot
  //       produce an enormous positive period. Reject < NOISE_FLOOR_US and
  //       > SLOWEST_US, then publish periodUs and update lastEdgeUs, tachEdges.
}

// A 32-bit read of stepCount is four instructions; guard it.
long readStepCountAtomic() {
  long value;
  ATOMIC_BLOCK(ATOMIC_RESTORESTATE) { value = stepCount; }
  return value;
}

// Supplied complete: the middle sample, so one bad edge cannot move the reading.
unsigned long medianOfThree(unsigned long a, unsigned long b, unsigned long c) {
  return a + b + c - max(a, max(b, c)) - min(a, min(b, c));
}

float rpmFromPeriod(unsigned long medianUs) {
  return medianUs == 0 ? 0.0 : 60.0 * (1000000.0 / (float)medianUs) / SLOTS_PER_REV;
}

void setup() {
  pinMode(PIN_CLK, INPUT); pinMode(PIN_DT, INPUT);
  pinMode(PIN_SW, INPUT_PULLUP); pinMode(PIN_TACH, INPUT);
  encoderState = (digitalRead(PIN_CLK) ? 2 : 0) + (digitalRead(PIN_DT) ? 1 : 0);
  Serial.begin(9600);
  attachInterrupt(0, encoderIsr, CHANGE);
  attachInterrupt(1, encoderIsr, CHANGE);
  attachInterrupt(PIN_TACH, tachIsr, CHANGE);
}

// loop() state: no handler touches these, so none of it is volatile.
unsigned long swChangedAt = 0, lastReport = 0, history[3] = {0, 0, 0};
bool swRaw = false, swStable = false, swEvent = false;

void loop() {
  unsigned long now = millis();
  bool raw = digitalRead(PIN_SW) == LOW;
  if (raw != swRaw) { swChangedAt = now; swRaw = raw; }
  if (swRaw != swStable && now - swChangedAt >= SW_DEBOUNCE_MS) { swStable = swRaw; swEvent = swStable; }
  if (swEvent) { swEvent = false; /* TODO: print readStepCountAtomic() and illegalCount. */ }
  if (now - lastReport >= REPORT_MS) {
    lastReport = now;
    // TODO: push periodUs into history[] while it is non-zero, then print
    //       rpmFromPeriod(medianOfThree(history[0], history[1], history[2]))
    //       at 10 Hz alongside tachEdges.
  }
}
```

**Functional Requirements**
- x4 decoding through `QUAD_TABLE`, illegal transitions counted, reported, never applied.
- SW debounced in software by polling D4 — not by interrupt, not by `INPUT_PULLUP` alone.
- The step count printed on every debounced press, taken under `ATOMIC_BLOCK`.
- RPM from the median of the last three accepted edge-to-edge periods, printed 10 times a second;
  periods under 300 µs rejected as noise. Illegal transitions printed on every report, so the filter's
  effectiveness is visible.
- A measured CPU-load figure for the interrupt path: time a known number of handler invocations once,
  put the per-handler figure in a comment, and compare it against the 5 % budget.

**Constraints**
- No `delay()` anywhere.
- No polling of CLK or DT in `loop()`; the pin-change interrupt is required, not optional.
- Handlers under 20 µs. No `Serial` output, no `delay`, no blocking call inside a handler.
- Every variable a handler shares is `volatile`; every shared value wider than 16 bits is read inside
  `ATOMIC_BLOCK`. Print at 10 Hz, not per edge: 2400 interrupts/s through a 9600-baud port would drop
  the report.

#### 6. Verification Checklist & Debugging Tasks

1. One detent clockwise, Scope on D2 and D3: four edges across two pins, count advances by 4.
2. Twenty detents — one revolution — and the count reads 80.
3. Push SW: one line on the serial monitor. Tap it hard: still one line, never two.
4. Drag the knob quickly. `illegal` may be non-zero, but the count must still be 4 per detent.
5. Rotate the disc slowly by hand and check the RPM against a stopwatch; 3000 RPM is 50 rev/s.
6. Cover the sensor: RPM reads 0, and the sketch neither locks up nor prints garbage.
7. Time the handlers against the 5 % budget and record the figure in a comment.
8. **Simulated Hardware Fault:** *One detent gives four counts instead of one, and with nothing
   touching the knob the count drifts by ±1 every few seconds.*
   **Diagnosis:**
   1. *The four-for-one half.* Scope D2 and D3 for one detent. Four edges across two pins means x4
      decoding is right, so four counts for a detent is the decoder, not the hardware. Confirm the ISR
      only ever changes `stepCount` when `QUAD_TABLE` returned non-zero: code that adds 1 on any change
      has no table at all, and one missing the eight illegal rows is counting bounce as motion.
   2. *The idle drift.* A count that moves untouched is a read problem, not a signal problem.
      `readStepCountAtomic()` wraps the read in `ATOMIC_BLOCK`; a bare `stepCount` load can straddle the
      handler's four-byte store and return a torn value, so the printed number disagrees with the stored
      one.
   **Fix:** restore the table with all eight illegal rows reading 0 and counted separately, and read
   every shared 32-bit value inside `ATOMIC_BLOCK(ATOMIC_RESTORESTATE)`.
   **Third variant:** *The count is consistently 20 per revolution instead of 80.* That is the filter,
   not the decoder: $\tau = RC$ with 100 nF where the design says 10 nF gives 100 µs, matching the
   spacing between the fastest legitimate edges, so the rebuilt waveform has one edge instead of four.
   Fit 10 nF.

#### 7. Noesis Lab Twin

**The limit first, because it is the point of this section: the simulator models no interrupts at
all.** There is no `attachInterrupt`, no pin-change interrupt, no `ATOMIC_BLOCK` and no `volatile` —
`volatile` lexes as a keyword but is not one of the type names the parser accepts, so
`volatile int x` does not even parse. The catalogue entry says as much: the `Rotary Encoder (KY-040)`
"reads with `digitalRead`". What survives is the part learners usually get wrong, **the transition
table**: the twin drives the same `QUAD_TABLE` from a polling decoder, so the table can be written,
debugged and proven before it ever meets an interrupt. **Build:** Uno R3 · one
`Rotary Encoder (KY-040)` with VCC to 5 V, because CLK/DT/SW are 10 kΩ pull-ups to it and an unwired VCC
leaves the outputs floating; D2 = CLK, D3 = DT, D4 = SW (active-LOW, already pulled up).

```cpp
// Noesis Lab twin for 4.1: the same transition table, driven by polling.
// Plain types only -- the interpreter has no volatile, no enum, no structs,
// and `const` lexes as a keyword that its declaration grammar will not accept,
// so plain globals with an initialiser stand in. Values and logic unchanged.
int PIN_CLK = 2, PIN_DT = 3, PIN_SW = 4;
int QUAD_TABLE[16] = {
  0, -1,  1,  0,    1,  0,  0, -1,   -1,  0,  0,  1,    1, -1,  0,  0
};   // previous * 4 + current: +1 CW, -1 CCW, 0 illegal

int state = 0, swHeld = 1;
long counts = 0, rejected = 0;

void setup() {
  pinMode(PIN_CLK, INPUT); pinMode(PIN_DT, INPUT); pinMode(PIN_SW, INPUT_PULLUP);
  state = (digitalRead(PIN_CLK) == HIGH ? 2 : 0) + (digitalRead(PIN_DT) == HIGH ? 1 : 0);
  Serial.begin(9600);
  Serial.println("press,counts,rejected");
}

void loop() {
  int curr = (digitalRead(PIN_CLK) == HIGH ? 2 : 0) + (digitalRead(PIN_DT) == HIGH ? 1 : 0);
  if (curr != state) {
    int step = QUAD_TABLE[state * 4 + curr];
    if (step != 0) counts = counts + step; else rejected = rejected + 1;
    state = curr;
  }
  int pressed = digitalRead(PIN_SW) == LOW ? 1 : 0;
  if (pressed == 1 && swHeld == 0) {
    Serial.print(pressed); Serial.print(",");
    Serial.print(counts);   Serial.print(",");
    Serial.println(rejected);
  }
  swHeld = pressed;
}
```

**Three things the twin does not model, and what they cost you.** *No interrupts and no atomicity:*
there is no torn 32-bit read to find and no `ATOMIC_BLOCK` to reach for, so the idle-drift fault is
bench-only and the twin will never reproduce it, however long it runs. *One knob step is one Gray
state, not one mechanical detent:* the `Detents` knob advances a single state, so the twin counts **1
per step**, while a real KY-040 crosses four states per detent, which is where 80 counts/rev comes
from — the twin proves the decoder, not the 80. *No filter, no $\tau$, no bounce:* the model's contacts
change state cleanly, so nothing is ever rejected and `rejected` stays 0, and both the
$\tau = 10\,\mu s$ trade-off and the 100 nF mistake that collapses x4 to x1 are entirely a Scope
experiment. What the bench buys that the twin cannot is the interrupt mechanism, the CPU-load budget,
and every filter decision. Prove the table here, then go and earn the rest.

---

### 4.2: Distance Radar with Ultrasonic Sensor (HC-SR04)
**Difficulty Level:** Advanced
**Level:** 5
**Estimated Completion Time:** 60–75 mins

#### 1. Real-World Scenario

A reverse-parking sensor behind a car. Five LEDs report the distance band and a passive piezo buzzer
beeps faster the closer the wall gets — the interval runs from 1000 ms above 200 cm down to 100 ms
inside 30 cm. The bar must keep updating while it is being driven, which rules out any measurement
that blocks the loop for the length of the echo, up to 23 ms. It must also be honest: a reading of
"0 cm" or "400 cm" from a target that is not there is worse than no reading, because the driver
trusts the LEDs.

#### 2. Hardware Inventory & Pinout Map

| Board Pin | Component Terminal | Connects To | Value / Notes |
| --- | --- | --- | --- |
| 5 V | HC-SR04 VCC | Uno 5 V | 5 V module; do not power from 3V3 |
| GND | HC-SR04 GND | Uno GND | |
| D6 | HC-SR04 TRIG | direct | 10 µs HIGH pulse |
| D7 | HC-SR04 ECHO | divider tap | $5 \times 2k/(1k+2k) = 3.33$ V at the pin |
| — | `1 kΩ Resistor` | ECHO → D7 node | Divider top leg |
| — | `2 kΩ Resistor` | D7 node → GND | Divider bottom leg |
| D2 | `220 Ω Resistor` → `Green LED` | anode 5 V, cathode D2 | 0–30 cm |
| D3 | `220 Ω Resistor` → `Green LED` | anode 5 V | 30–60 cm |
| D4 | `220 Ω Resistor` → `Yellow LED` | anode 5 V | 60–100 cm |
| D5 | `220 Ω Resistor` → `Yellow LED` | anode 5 V | 100–200 cm |
| D8 | `220 Ω Resistor` → `Red LED` | anode 5 V | > 200 cm |
| D9 | `100 Ω Resistor` → piezo | passive, 2 kHz | D9 is Timer1's OC1A |

Bill of materials: 1× Uno R3 · 1× HC-SR04 · `1 kΩ Resistor` · `2 kΩ Resistor` · 5× `220 Ω Resistor` ·
1× 100 Ω · 2 green, 2 yellow, 1 red 5 mm LED · 1× passive piezo. From $I = \frac{V_{CC} - V_f}{R}$: green
and yellow at $V_f \approx 2.0$ V give $(5 - 2.0)/220 = 13.6$ mA, red at $V_f \approx 1.9$ V gives
$14.1$ mA. Five lit is 69 mA, inside the board's 200 mA VCC + GND budget, and each pin sinks at most
14.1 mA against the ATmega328P's 20 mA recommended per pin. The LEDs sit on D2–D5 and D8 rather than
D8–D13 so D10–D13 stay free for SPI and D9 is left as the timer pin the buzzer wants.

#### 3. Circuit Schematics & Wiring Guide

```text
  +5 V ─┬────────────────────────────────────────────────────────────── ┐
       │                                                                │
  HC-SR04 VCC ──────► +5 V        +5 V ─┬─|<|─[ 220 Ω ]────── D2        │
  HC-SR04 GND ──────► GND              ├─|<|─[ 220 Ω ]────── D3         │
  UNO D6 ────────────► TRIG             ├─|<|─[ 220 Ω ]────── D4        │
  HC-SR04 ECHO ─┬─[ 1 kΩ ]─┬─────────► D7 ├─|<|─[ 220 Ω ]────── D5      │
                  │         │ [2 kΩ]         └─|<|─[ 220 Ω ]────── D8   │
                  │         │  V_pin = 5 x 2k/(1k + 2k) = 3.33 V        │
  UNO D9 ───[ 100 Ω ]────( ))──── passive piezo                         │
  Transducer face ── target surface ───────────────────────────►        │
  └─────────────────────────────────────────────────────────────────────┘
```

1. Power and ground first: HC-SR04 VCC to the Uno's 5 V, GND to the rail.
2. TRIG straight to D6. ECHO does **not** go straight to D7 — `1 kΩ` from ECHO to the D7 node, `2 kΩ`
   from that node to GND.
3. Five LEDs, each with its own `220 Ω Resistor`, anodes to +5 V and cathodes to D2/D3/D4/D5/D8 so the
   pin sinks. D9 goes to the piezo through `100 Ω`: a capacitive load, so the resistor limits the peak
   current the pin dumps into it on every edge.

**Hardware Gotchas & Safety Rules:**

- **The ECHO divider is not optional on a 3.3 V board.** The module drives ECHO to 5 V, and on an
  ESP32 or RP2040 that destroys the input.
  $5 \times \frac{2\,\text{k}\Omega}{1\,\text{k}\Omega + 2\,\text{k}\Omega} = 3.33$ V is the design's whole
  reason, and the sketch then runs unmodified on either board. On the Uno alone the divider is
  unnecessary — the pin is already 5 V tolerant. Drop it when moving to 3.3 V and that is how a GPIO dies.
- **Never leave ECHO floating.** The pin is open-collector; with the module unpowered D7 reads noise and
  the sketch will publish the 25 ms timeout as a distance.
- **The 100 Ω series resistor is not in the shared parts bin.** A stocked `220 Ω Resistor` is
  electrically equivalent here, since the piezo is capacitive and the resistor only limits edge current.
  Do not aim the transducers at an angled or glossy surface: specular reflection deflects the beam, and
  a real wall can read as 400 cm. The module draws about 15 mA during a burst; power it from the board's
  5 V pin, not a second supply.

#### 4. Embedded Concept Deep-Dive

**The round trip, and the factor of two.** The sensor emits a 10 µs burst of 40 kHz ultrasound. ECHO
goes high when the burst leaves and low when the first reflection returns, so the high time is the
**round trip**: $$d = \frac{t \cdot v}{2}$$. Omit the 2 and every reading doubles — the most common error
in this exercise, and plausible enough to survive a quick bench check.
**Temperature.** $v(T) \approx 331.3 + 0.606\,T$ m/s gives 331.3 m/s at 0 °C, 343.4 at 20 °C and 346.5 at
25 °C. At 20 °C one centimetre takes $\frac{0.02}{343.4} = 58.2\,\mu s$, which is where the datasheet's
"58 µs/cm" comes from. At 0 °C the same centimetre takes 60.4 µs — a **4 % error** if temperature is
ignored, larger than the sensor's own accuracy. The exercise's 58.1 µs/cm is the 20 °C figure at
datasheet precision; real modules vary a microsecond or so per centimetre.

| Target | 2 cm | 100 cm | 200 cm | 400 cm |
| --- | --- | --- | --- | --- |
| Echo width at 58.1 µs/cm | 116 µs | 5800 µs | 11 600 µs | 23 260 µs |

**The timing window.** The oscillator is not re-triggerable immediately and the datasheet asks for at
least 60 ms between triggers; burst faster and echoes start going missing in a way that reads as noise.
Below about 2 cm is a blind zone — the transducer cannot separate its own ring-down from a return. Above
2 m accuracy degrades as the echo weakens and the surface absorbs, and past roughly 4 m an echo wider
than 23 ms means nothing answered. A 25 ms timeout is therefore the right ceiling: wider than the
longest legitimate echo, narrow enough that a missing target is reported promptly. `micros()` is a
32-bit `unsigned long` that rolls over every $2^{32}\,\mu s \approx 71.6$ minutes; unsigned subtraction
makes the wrap harmless, but the result must be range-checked before it is believed.

#### 5. Firmware Challenge & Code Template

**Starter Code Scaffold**

```cpp
// Exercise 4.2 -- HC-SR04 reverse-parking radar. Uno R3.
const uint8_t PIN_TRIG = 6, PIN_ECHO = 7, PIN_BUZZER = 9;
const uint8_t PIN_LED[5] = {2, 3, 4, 5, 8};   // band 1 first, nearest first
const unsigned long TRIGGER_HOLD_US = 10;      // datasheet: a 10 us burst
const unsigned long SETTLE_US       = 500;
const unsigned long ECHO_TIMEOUT_US = 25000;   // > the 23260 us of 400 cm
const unsigned long RECOVER_MS      = 60;      // datasheet: 60 ms between triggers
const unsigned long CSV_MS = 200, NOTE_US = 40000, HALF_PERIOD_US = 250;
const float CM_PER_US = 1.0 / 58.1;            // 20 C round trip: t = 2d/v
const float MIN_VALID_CM = 2.0, MAX_VALID_CM = 400.0;

enum SonarState { IDLE, TRIGGERED, SETTLE, WAIT_ECHO, PROCESS };

SonarState sonarState = IDLE;
unsigned long stateEnteredUs = 0, lastTriggerMs = 0, echoStartUs = 0;
unsigned long rawUs = 0, lastCsvMs = 0, lastBeepMs = 0, beepStartUs = 0;
bool echoSeen = false, valid = false;
float distanceCm = 0.0;

void enterSonarState(SonarState next) {
  sonarState = next;
  stateEnteredUs = micros();
  if (next == TRIGGERED) { digitalWrite(PIN_TRIG, LOW); lastTriggerMs = millis(); }
  if (next == WAIT_ECHO) { echoSeen = false; echoStartUs = micros(); }
}

void serviceBuzzer() {
  // TODO: from distanceCm pick the interval: 1000 ms above 200 cm, 700 ms
  //       (100-200), 400 ms (60-100), 200 ms (30-60), 100 ms under 30, and 0 when
  //       valid is false. Re-arm at most one note per interval. Then drive the
  //       square wave HIGH while
  //       (micros() - beepStartUs) % (2 * HALF_PERIOD_US) < HALF_PERIOD_US,
  //       LOW otherwise, and LOW once the note has run NOTE_US.
}

void loop() {
  unsigned long nowMs = millis();
  unsigned long nowUs = micros();   // every comparison below is unsigned
  (void)nowUs;                      // consumed by the switch once the TODOs are filled in

  switch (sonarState) {
    case IDLE:
      // TODO: enter TRIGGERED once nowMs - lastTriggerMs >= RECOVER_MS.
      break;
    case TRIGGERED:
      digitalWrite(PIN_TRIG, HIGH);
      // TODO: after TRIGGER_HOLD_US pull TRIG LOW and enter SETTLE. The pulse
      //       is one loop iteration long or longer, never shorter.
      break;
    case SETTLE:
      // TODO: hold for SETTLE_US. If ECHO is already HIGH, stamp the edge, set
      //       echoSeen and enter WAIT_ECHO; otherwise abort to PROCESS once
      //       ECHO_TIMEOUT_US passes with the line still low.
      break;
    case WAIT_ECHO:
      // TODO: on the ECHO falling edge set rawUs = nowUs - echoStartUs, set
      //       echoSeen true, enter PROCESS. On ECHO_TIMEOUT_US with the line
      //       still HIGH, abort to PROCESS with echoSeen false. Unsigned both.
      break;
    case PROCESS:
      // TODO: distanceCm = rawUs * CM_PER_US, then valid = echoSeen && rawUs > 0
      //       && distanceCm in range. Light LED[n] for every band the distance
      //       falls inside, so under 30 cm lights all five. Then enter IDLE.
      break;
  }

  serviceBuzzer();

  if (nowMs - lastCsvMs >= CSV_MS) {
    lastCsvMs = nowMs;
    // TODO: one CSV row -- ms,raw_us,distance_cm,valid -- with the literal
    //       string "no target" when valid is false.
    //  The one-liner this replaces: unsigned long us = pulseIn(PIN_ECHO, HIGH,
    //  ECHO_TIMEOUT_US); -- it spins until the pin changes, so it blocks loop()
    //  for the whole echo, up to 23 ms, and the LED bar and buzzer stall.
  }
}

void setup() {
  pinMode(PIN_TRIG, OUTPUT); digitalWrite(PIN_TRIG, LOW);
  pinMode(PIN_ECHO, INPUT);
  pinMode(PIN_BUZZER, OUTPUT); digitalWrite(PIN_BUZZER, LOW);
  for (uint8_t i = 0; i < 5; i++) pinMode(PIN_LED[i], OUTPUT);
  Serial.begin(9600);
  Serial.println("ms,raw_us,distance_cm,valid");
}
```

**Functional Requirements**
- A five-state non-blocking sequence: 10 µs TRIG pulse, at least 500 µs of settle before the echo is
  trusted, ECHO edge detection with `digitalRead` and `micros()`, and a PROCESS step that publishes.
- The echo wait aborts on a 25 ms timeout rather than hanging.
- No re-trigger sooner than 60 ms after the previous burst.
- Five bands — 0–30, 30–60, 60–100, 100–200, > 200 cm — lighting cumulatively, so under 30 cm lights
  all five.
- A beep whose interval shortens 1000 → 700 → 400 → 200 → 100 ms across the bands, silent with no
  valid target, driven by a `millis()` schedule and a hand-written 2 kHz square wave. `tone()` with an
  explicit end time is an acceptable alternative on the bench; it is unavailable here.
- Readings below 2 cm or above 400 cm flagged invalid and reported as "no target", never as a distance.
- CSV at 5 Hz: `ms,raw_us,distance_cm,valid`.

**Constraints**
- No `delay()` or `delayMicroseconds()` in `loop()`. The state machine is mandatory.
- No blocking wait for ECHO. `pulseIn` is not used in the main requirement; it appears above only as
  the one-liner it replaces.
- Every timing comparison is `now - then >= INTERVAL` with unsigned operands.
- LED currents as computed in section 2. Do not raise the drive to "make them brighter".

#### 6. Verification Checklist & Debugging Tasks

1. A flat board 100 cm away: `distance_cm` reads ≈ 100, and ≈ 50 at 50 cm. Tape, not eye.
2. Sweep 30, 60, 100 and 200 cm; the lit count steps 5, 4, 3, 2 across each threshold.
3. Unplug the module: the sketch prints "no target", lights nothing, stays silent, and keeps running
   at full rate — the timeout must not stall the loop.
4. Scope D6: a 10 µs pulse, then silence for at least 60 ms, which validates the recovery floor. Scope
   D7 at a 400 cm target: 23 260 µs, comfortably inside the 25 ms timeout.
5. Walk a target sideways out of the beam: the reading must go invalid, not to a distance.
6. **Simulated Hardware Fault:** *Every reading is exactly double the real distance.*
   **Diagnosis:**
   1. Put the target at a known 100 cm. The plot shows ≈ 200 cm — a factor of exactly two, not an
      offset, which rules out temperature, calibration and resistor drift.
   2. Look at the PROCESS step. $d = \frac{t v}{2}$; if the code divides by 29.05 somewhere, or treats
      $v$ as a one-way speed against an already-halved time, the factor is counted twice. Halve it:
      200 cm snaps onto 100 cm and 400 cm onto 200 cm.
   **Fix:** `distanceCm = rawUs * CM_PER_US` with `CM_PER_US = 1.0 / 58.1` — the 2 is already inside the
   constant, because 58.1 µs is the *round-trip* time for one centimetre.
   **Second variant:** *The reading is 0 cm, or it always says 400 cm.* That is the timeout path
   reporting garbage: an echo that never arrives leaves `rawUs` at the 25 ms timeout, which converts to
   a large distance, and a `pulseIn` that times out returns 0, which converts to zero. Either way the
   elapsed measurement is not a distance. Check that the invalid flag is set *before* the value is
   printed, and that the timeout branch leaves `echoSeen` false so PROCESS cannot promote it.
   **Third variant — hardware, and the expensive one:** *On the ESP32 the ECHO pin reads nothing and
   then reads 0 forever.* A 5 V echo has been driving a 3.3 V input directly and the pin is damaged; no
   sketch change fixes that. Fit the `1 kΩ` / `2 kΩ` divider, or route ECHO to ESP32 GPIO34, which is 5 V
   tolerant and input-only, so it can never drive TRIG or an LED. Nothing here uses the ADC, but the
   same care applies to any analog input moved onto that board: ADC2 is unusable while Wi-Fi is running,
   so it must land on an ADC1 pin.

#### 7. Noesis Lab Twin

**The limit first: the model has no TRIG→ECHO causality.** `TRIG` is a high-impedance input that
contributes nothing to the netlist, and the ECHO pulse is synthesised *only* for the duration of a
`pulseIn` call — the engine arms the line in `pulseInBegin` and releases it in `pulseInEnd`. A sketch
that pulses D6 and then polls `digitalRead(D7)` therefore sees ECHO stay low every cycle and correctly
reports "no target" forever. That is the model, not a bug, and it is the one part of the state machine
the twin cannot exercise.
**What is modelled, and it is most of the exercise:** the `Ultrasonic Sensor (HC-SR04)` part with a
**Distance** knob spanning 2–400 cm; an ECHO line that is a genuine open-drain output under a 10 kΩ
pull-up, held low unless a measurement is running; an echo width of exactly `distance_cm × 58` µs; and
`pulseIn(pin, HIGH, timeout)`, which returns that width, returns 0 when the width exceeds the timeout,
and returns 0 immediately for a `LOW` pulse. **Build:** Uno R3 · `Ultrasonic Sensor (HC-SR04)` on D6
(TRIG) and D7 (ECHO) · five LEDs with `220 Resistor` on D2, D3, D4, D5 and D8, anodes to 5 V · a
`10k Resistor` from ECHO to 5 V (the model already carries a 10 kΩ pull-up, so the external one sits
in parallel and changes nothing electrically — fit it anyway, because the real breadboard needs it and
the Multimeter on the ECHO net during a measurement shows the open-drain shape) · optionally a
`Piezo Buzzer` on D9, which makes the beep audible when the Scope shows the 2 kHz square wave as
clearly.

```cpp
// Noesis Lab twin for 4.2. Plain types only: the interpreter has no enum, so
// the state constants are spelled out, and `const` is a keyword its grammar
// will not accept, so plain globals stand in. The line that differs from the
// bench sketch is the WAIT_ECHO branch, marked TWIN and explained above.
int PIN_TRIG = 6, PIN_ECHO = 7, PIN_BUZZER = 9;
int PIN_LED1 = 2, PIN_LED2 = 3, PIN_LED3 = 4, PIN_LED4 = 5, PIN_LED5 = 8;
int IDLE = 0, TRIGGERED = 1, SETTLE = 2, WAIT_ECHO = 3, PROCESS = 4;
long TRIGGER_HOLD_US = 10, SETTLE_US = 500, ECHO_TIMEOUT_US = 25000;
long RECOVER_MS = 60, CSV_MS = 200, HALF_PERIOD_US = 250, NOTE_US = 40000;
float CM_PER_US = 0.0172117;                     // 1 / 58.1, carried pre-divided:
                                                // the interpreter's / truncates,
                                                // so rawUs / 58.1 would floor to 0

int sonarState = IDLE, echoSeen = 0, valid = 0;
long stateEnteredUs = 0, lastTriggerMs = 0, rawUs = 0;
long lastCsvMs = 0, lastBeepMs = 0, beepStartUs = 0;
float distanceCm = 0.0;

void enterSonarState(int next) {
  sonarState = next;
  stateEnteredUs = micros();
  if (next == TRIGGERED) { digitalWrite(PIN_TRIG, LOW); lastTriggerMs = millis(); }
  if (next == WAIT_ECHO) echoSeen = 0;
}

void setup() {
  pinMode(PIN_TRIG, OUTPUT); digitalWrite(PIN_TRIG, LOW);
  pinMode(PIN_ECHO, INPUT);
  pinMode(PIN_BUZZER, OUTPUT); digitalWrite(PIN_BUZZER, LOW);
  pinMode(PIN_LED1, OUTPUT); pinMode(PIN_LED2, OUTPUT); pinMode(PIN_LED3, OUTPUT);
  pinMode(PIN_LED4, OUTPUT); pinMode(PIN_LED5, OUTPUT);
  Serial.begin(9600);
  Serial.println("ms,raw_us,distance_cm,valid");
}

void loop() {
  long nowUs = micros();
  long nowMs = millis();

  if (sonarState == IDLE) {
    if (nowMs - lastTriggerMs >= RECOVER_MS) enterSonarState(TRIGGERED);
  } else if (sonarState == TRIGGERED) {
    digitalWrite(PIN_TRIG, HIGH);
    if (nowUs - stateEnteredUs >= TRIGGER_HOLD_US) {
      digitalWrite(PIN_TRIG, LOW);
      enterSonarState(SETTLE);
    }
  } else if (sonarState == SETTLE) {
    if (nowUs - stateEnteredUs >= SETTLE_US) enterSonarState(WAIT_ECHO);
  } else if (sonarState == WAIT_ECHO) {
    // TWIN, the one substitution: the bench sketch polls the ECHO rising and
    // falling edges with digitalRead and micros() and aborts on its own
    // ECHO_TIMEOUT_US. This model raises ECHO only inside a pulseIn call, so
    // that poll could never see a level change and the sketch would report
    // "no target" for ever. pulseIn supplies the same measurement and reports
    // the timeout as 0, so the invalid path still exercises.
    rawUs = pulseIn(PIN_ECHO, HIGH, ECHO_TIMEOUT_US);
    echoSeen = rawUs > 0 ? 1 : 0;
    enterSonarState(PROCESS);
  } else {
    float cm = rawUs * CM_PER_US;
    valid = echoSeen == 1 && cm >= 2.0 && cm <= 400.0 ? 1 : 0;
    distanceCm = cm;
    digitalWrite(PIN_LED1, cm < 30.0 ? HIGH : LOW);    digitalWrite(PIN_LED2, cm < 60.0 ? HIGH : LOW);
    digitalWrite(PIN_LED3, cm < 100.0 ? HIGH : LOW);  digitalWrite(PIN_LED4, cm < 200.0 ? HIGH : LOW);
    digitalWrite(PIN_LED5, cm < 200.0 ? LOW : HIGH);
    long gap = valid == 0 ? 0 : cm < 30.0 ? 100 : cm < 60.0 ? 200 : cm < 100.0 ? 400 : cm < 200.0 ? 700 : 1000;
    if (gap > 0 && nowMs - lastBeepMs >= gap) { lastBeepMs = nowMs; beepStartUs = nowUs; }
    enterSonarState(IDLE);
  }

  if (beepStartUs > 0 && nowUs - beepStartUs < NOTE_US) {
    digitalWrite(PIN_BUZZER, (nowUs - beepStartUs) % (2 * HALF_PERIOD_US) < HALF_PERIOD_US ? HIGH : LOW);
  } else { digitalWrite(PIN_BUZZER, LOW); beepStartUs = 0; }

  if (nowMs - lastCsvMs >= CSV_MS) {
    lastCsvMs = nowMs;
    Serial.print(nowMs); Serial.print(","); Serial.print(rawUs); Serial.print(",");
    Serial.print(distanceCm); Serial.print(",");
    Serial.println(valid == 1 ? "1" : "0 no target");
  }
}
```

Set **Distance** to 100 cm and the CSV reports `5800,99.83,1`; drop it to 2 cm and `raw_us` reads 116.
Nothing above 400 cm is reachable, so the 25 ms timeout never fires from the knob — lower
`ECHO_TIMEOUT_US` to 10000 and everything beyond about 172 cm returns 0, which exercises the invalid
path and gives the banned one-liner its comparison: `pulseIn` blocks for the whole echo, up to 23 ms of
real loop time, exactly the stall the state machine exists to avoid. Both figures above were produced by
running this sketch through the simulator's firmware interpreter; the 4.1 twin was checked the same way,
walking the Gray cycle 11 → 01 → 00 → 10 → 11 and confirming the count moves by exactly one per state
change while an illegal transition is counted and never applied.

**What the twin does not model, and what that costs you.** *No temperature:* the echo width is
`distance_cm × 58` µs, the 20 °C constant with no $T$ term, so the $\frac{v(T)t}{2}$ maths and the 4 %
error at 0 °C are bench-only. *No blind zone and no recovery floor:* the knob bottoms out at 2 cm and
the model answers instantly however fast you re-trigger. *No 5 V echo level:* ECHO is a modelled
open-drain line, not a 5 V push-pull output, so the divider cannot be demonstrated and the
damaged-ESP32 fault cannot be reproduced. That lesson is the divider itself, fitted before the wire goes
in, every time.
