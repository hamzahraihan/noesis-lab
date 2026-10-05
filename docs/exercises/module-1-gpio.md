# Module 1 — GPIO & Physical Input Dynamics

Digital input is the first thing that lies to you. A mechanical contact is not a
switch; it is two surfaces that collide and ring for a few milliseconds, and the
first version of every control panel pressed far more buttons than anyone intended.
This module builds the two skills that fix it — a network that gives an input a
defined level, and a program that refuses to believe a level it has not seen settle.

| ID | Exercise | Difficulty | Time |
| --- | --- | --- | --- |
| [1.1](#11-industrial-push-button--mechanical-debouncing) | Industrial Push-Button & Mechanical Debouncing | Beginner | 45–60 mins |
| [1.2](#12-traffic-signal-state-machine) | Traffic Signal State Machine | Beginner | 60–75 mins |

---

### 1.1: Industrial Push-Button & Mechanical Debouncing

**Difficulty Level:** Beginner
**Level:** 2
**Estimated Completion Time:** 45–60 mins

#### 1. Real-World Scenario

A conveyor control cabinet for a packaging line. Three panel-mounted momentary
buttons — RUN, STOP, RESET — sit within a metre of a 2 kW motor drive and its
contactors. An operator presses RUN once to start the belt.

The cabinet's original firmware counted edges on the input pin. Because the RUN
contact bounced for about 8 ms on closing, the drive's own interlock saw three
start commands, the contactor dropped out, and the belt restarted twice before it
had finished its first metre. The fix is not a better switch. It is a defined
input level and a debounce.

#### 2. Hardware Inventory & Pinout Map

**Bill of materials**

| Qty | Part | Value | Purpose |
| --- | --- | --- | --- |
| 1 | Arduino Uno R3 | — | Controller, 10 kΩ external pull-ups, 100 nF filters |
| 3 | Tactile push-button | 6 mm, momentary, normally open | RUN, STOP, RESET |
| 3 | Resistor | 10 kΩ | Pull-ups to the 5 V rail |
| 3 | Ceramic capacitor | 100 nF | Hardware RC filter on each input node |
| 3 | Resistor | 220 Ω | LED current limit |
| 3 | LED | red, green, amber | RUN, STOP, RESET indicators |

**Pinout map**

| Board Pin | Component Terminal | Connects To | Value / Notes |
| --- | --- | --- | --- |
| D2 | RUN switch, leg 1 | input node | active-LOW |
| D2 | RUN switch, leg 2 | GND rail | momentary, normally open |
| D2 node | 10 kΩ resistor | 5 V rail | the pull-up: this is what D2 reads when open |
| D2 node | 100 nF capacitor | GND rail | $\tau = R \cdot C = 1$ ms filter |
| D3 | STOP switch, leg 1 | input node | active-LOW |
| D3 | STOP switch, leg 2 | GND rail | — |
| D3 node | 10 kΩ resistor | 5 V rail | — |
| D3 node | 100 nF capacitor | GND rail | — |
| D4 | RESET switch, leg 1 | input node | active-LOW |
| D4 | RESET switch, leg 2 | GND rail | — |
| D4 node | 10 kΩ resistor | 5 V rail | — |
| D4 node | 100 nF capacitor | GND rail | — |
| D12 | 220 Ω resistor | RUN LED cathode | LED anode to the 5 V rail |
| D11 | 220 Ω resistor | STOP LED cathode | — |
| D10 | 220 Ω resistor | RESET LED cathode | — |
| GND | all three switches, all three capacitors | GND rail | every capacitor needs its own return |

Each LED is a sink arrangement: the pin pulls the cathode down and the anode sits
at 5 V. The current is set by the resistor alone:

$$I = \frac{V_{CC} - V_f}{R} = \frac{5 - 1.9}{220} \approx 14.1 \text{ mA}$$

Three lit at once is 42 mA of output — inside the ATmega328P's 40 mA absolute
per-pin limit individually, but above the 20 mA the datasheet *recommends*. The
requirements below keep at most two lit.

#### 3. Circuit Schematics & Wiring Guide

One input node, shown in full. The other two are identical, on D3 and D4.

```text
        +5V rail
          |
        [10k]            220R
          |               |
   D2 ----+----[ BTN ]-----+----[ LED ]----+--> D12 sink
          |                                 |
         [100n]                            +5V rail (anode)
          |
        GND rail
```

As a voltage divider seen from D2, the same node is a 10 kΩ pull-up fighting
whatever the button and capacitor do to it:

```text
   +5V ---[ 10k ]---o---[ 100n ]--- GND        while the button is open
                   |
                   D2  reads ~5 V
```

**Wiring procedure**

1. Break the breadboard in half. The two long rails either side of the centre
   channel are the power rails and are **not** joined to each other across the
   break. Wire the left `+` rail to the Uno's 5 V and the left `−` rail to GND.
2. Leave a full 5-row gap between the two halves and straddle the gap with each
   part, so both legs land on their own rows. A two-leg part with both legs in one
   row is the single most common wiring mistake on a breadboard.
3. RUN switch: one leg to D2's row, the other leg to the GND rail.
4. RUN 10 kΩ: from D2's row to the 5 V rail.
5. RUN 100 nF: from D2's row to the GND rail. Repeat all three for STOP on D3 and
   RESET on D4.
6. Each LED: anode to the 5 V rail, cathode to a free row; 220 Ω from that row to
   the matching output pin (D12, D11, D10).
7. Before powering up, meter the board: with no button pressed, D2 to GND should
   read ≈ 5 V. With the button held, ≈ 0.01 V.

**Hardware Gotchas & Safety Rules:**

- **A 4-leg tactile button has its legs paired internally.** Two legs on one side
  are one terminal; the two sides are the switch. If you straddle the gap with the
  button rotated 90°, both "legs" land on the same node and the button does
  nothing — forever, with no visible fault.
- **Never rely on the internal pull-up.** The ATmega328P's is 20–50 kΩ and, more
  importantly, it is **disabled during reset** — including for the whole second or
  two while a sketch uploads over USB. An input that is valid during `loop()` and
  floating during reset is a real machine fault waiting for a brownout.
- **Never wire a 5 V pull-up to an ESP32 or RP2040 pin.** 3.3 V logic does not
  tolerate 5 V. Use a 3.3 V rail for the pull-up there, or a divider.
- **The 100 nF and 10 kΩ are a filter, not a debounce.** $\tau = 10\,000 \times 100\times10^{-9}$ = 1 ms with a −3 dB corner at $\frac{1}{2\pi RC} \approx 159$ Hz. It rounds the edge over about 1 ms. Bounce lasting 8 ms is not removed by it — it is *slowed*, and the firmware still has to do the work.
- **Capacitor polarity.** The 100 nF ceramic is unpolarised; the marking is not a
  polarity. Do not fit it across 5 V and GND *in series* with something else.
- **Resistor to the cathode, not the anode.** Putting the 220 Ω between the pin and
  the LED's anode leaves the anode node to be dragged about by the pin's output
  impedance; keep the resistor adjacent to the cathode.

#### 4. Embedded Concept Deep-Dive

**Why a switch is not a switch.** When two contacts touch, the metal is compliant
and the closing surfaces carry microscopic oxide. The contact compresses, rebounds,
compresses again, and the oxide breaks into a conducting path — typically for
1–20 ms, with several transitions in between. A digital input pin has no
middling state: it reports HIGH or LOW at a threshold, so 20 ms of mechanical
ring becomes anything from 2 to 40 discrete logic edges. Count them and one press is
many presses.

**The three defences.**

*Hardware filtering* (the 100 nF here) collapses a burst of edges into a single
slower transition. The capacitor charges through the pull-up's 10 kΩ with
$\tau = RC$, so the input voltage moves exponentially rather than instantly. It
reduces edge count and shortens the burst, but it does not eliminate it, and a
capacitor large enough to flatten the whole burst to a logic-level transition
also adds perceptible lag — at 100 nF on a 10 kΩ node you have spent 1 ms; at
1 µF you have spent 10 ms on every press.

*Software debouncing* is the real answer, and it is a **stability** test, not a
delay: sample the pin, and only accept a new level once it has been *the same level*
for longer than the worst-case bounce. The cost is that first $T$ milliseconds of
every press are not yet believed, which is why the window is 20–50 ms and not
200 ms. A debounce implemented as `delay(50); if (read) ...` is not a debounce —
it is a 50 ms stall that samples none of the other inputs, and it is exactly what
Exercise 1.2's timing requirements forbid.

*The right pull-up.* A CMOS input leaks picoamps. Left alone, the input node has
nothing to hold it, so its voltage wanders — you can watch it on a scope as a slow
undulation of a volt or two, and it wanders across the input threshold, which is a
perfectly ordinary press being detected every second or so. The pull-up is not
optional and it is not the internal one.

**Active-HIGH versus active-LOW.** With a pull-up, an unpressed switch reads 5 V
and a press reads 0 V: the switch is *active-LOW*. Every logic term inverts —
pressed is `LOW`, released is `HIGH`. This is the convention because it is the
one that degrades safely: a broken wire, an unplugged connector, or a pin that
has not yet been configured reads as "released" instead of "pressed". A stuck-on
RUN command is an interesting fault; a machine that starts itself is an incident.

#### 5. Firmware Challenge & Code Template

**Starter Code Scaffold**

```cpp
/*
 * Exercise 1.1 -- Industrial Push-Button & Mechanical Debouncing
 *
 * Bench: Arduino Uno R3. Three momentary buttons on external 10k pull-ups with
 * 100nF filters; three indicator LEDs through 220 ohm on D12/D11/D10.
 *
 * updateButton() is supplied complete -- it is the whole lesson. The TODOs in
 * loop() are the application logic built on top of it.
 */

#include <Arduino.h>

// --- Configuration --------------------------------------------------------

const byte PIN_RUN   = 2;
const byte PIN_STOP  = 3;
const byte PIN_RESET = 4;

const byte LED_RUN   = 12;
const byte LED_STOP  = 11;
const byte LED_RESET = 10;

// A level must hold this long before it is believed. 25 ms outlasts the worst
// case bounce of a cheap tactile switch; 100 ms would still work but every press
// would feel mushy.
const unsigned long DEBOUNCE_MS = 25;

// Held longer than this, an indicator blinks instead of lighting steady.
const unsigned long LONG_PRESS_MS = 1000;
const unsigned long BLINK_HALF_MS = 250;   // 2 Hz overall

const byte RELEASED = 0;
const byte PRESSED  = 1;   // active-LOW: pressed means the pin is LOW

struct Button {
  const char *name;
  byte  pin;
  byte  led;
  byte  rawState;          // last raw sample: HIGH or LOW off the pin
  byte  debouncedState;    // last believed state: PRESSED or RELEASED
  unsigned long rawChangedAt;   // when rawState last moved; restarts the window
  unsigned long pressStartedAt; // when the current press was accepted
  unsigned long blinkStartedAt; // when this press was promoted to a blink
  byte  blinking;
  byte  latched;           // short press wants the indicator; long press does not
};

Button buttons[] = {
  { "RUN",   PIN_RUN,   LED_RUN,   HIGH, RELEASED, 0, 0, 0, 0, 0 },
  { "STOP",  PIN_STOP,  LED_STOP,  HIGH, RELEASED, 0, 0, 0, 0, 0 },
  { "RESET", PIN_RESET, LED_RESET, HIGH, RELEASED, 0, 0, 0, 0, 0 },
};
const byte BUTTON_COUNT = sizeof(buttons) / sizeof(buttons[0]);

// --- Supplied: the debounce ----------------------------------------------

// Returns true on the loop() pass where a new state was *accepted*.
//
// Why there is no delay() here: three buttons are sampled in the same pass, so a
// debounce that waits stops watching the other two. The window is enforced by
// remembering when the raw level last moved, and by letting loop() run on.
bool updateButton(Button &b, unsigned long now) {
  byte raw = digitalRead(b.pin);

  // Any edge restarts the clock. Bounce is a train of edges, so the window only
  // ever restarts -- it is never satisfied until the contacts stop ringing.
  if (raw != b.rawState) {
    b.rawState = raw;
    b.rawChangedAt = now;
  }

  // Still settling. Leave the believed state exactly where it was.
  if (now - b.rawChangedAt < DEBOUNCE_MS) {
    return false;
  }

  // Settled. Commit only if it actually differs from what we believe.
  byte wanted = (b.rawState == LOW) ? PRESSED : RELEASED;
  if (wanted == b.debouncedState) {
    return false;
  }

  b.debouncedState = wanted;
  b.pressStartedAt = now;
  return true;
}

// --- Supplied: the blink --------------------------------------------------

// Interval division. No extra timer, no state machine: the phase is derived
// from the clock, so it cannot drift and cannot be missed.
void serviceBlink(Button &b, unsigned long now) {
  if (!b.blinking) {
    digitalWrite(b.led, LOW);
    return;
  }
  bool on = ((now - b.blinkStartedAt) / BLINK_HALF_MS) % 2 == 1;
  digitalWrite(b.led, on ? HIGH : LOW);
}

void setup() {
  Serial.begin(9600);
  for (byte i = 0; i < BUTTON_COUNT; i++) {
    // INPUT, deliberately. The constraint for this exercise is that the sketch
    // must work with the internal pull-up switched OFF, which is what proves the
    // external 10k network is doing its job.
    pinMode(buttons[i].pin, INPUT);
    pinMode(buttons[i].led, OUTPUT);
    digitalWrite(buttons[i].led, LOW);
  }
  Serial.println(F("1.1 ready -- 3 buttons, active-LOW, 25 ms debounce"));
}

void loop() {
  unsigned long now = millis();

  for (byte i = 0; i < BUTTON_COUNT; i++) {
    Button &b = buttons[i];

    if (updateButton(b, now)) {

      // TODO 1: an accepted change. b.debouncedState is now PRESSED or RELEASED.
      //   On PRESSED: remember pressStartedAt (the helper already set it) and
      //   print one line -- "RUN pressed @1234 ms" -- to Serial.
      //   Print on *change* only, never on every pass through loop().

      // TODO 2: on RELEASE, clear the blink and clear b.blinking. Decide what a
      //   short press (released before LONG_PRESS_MS) leaves behind: the
      //   requirements say a short press latches its indicator on, so set
      //   b.latched = 1 here, and only if the press was short.

      // TODO 3: promotion to a blink. A long press that has now been held for
      //   LONG_PRESS_MS should start blinking instead of latching steady.
      //   Put this OUTSIDE the change branch -- it has to be checked on every
      //   pass while the button is held, not only at the edges. Guard it so the
      //   blink starts once, not every loop() pass.

    }

    // TODO 4: LED arbitration. Exactly one indicator may be lit at a time.
    //   STOP outranks everything the instant its debounced state is PRESSED.
    //   Otherwise show whichever latched button was pressed most recently.
    //   Call serviceBlink(b, now) for the button that is blinking; drive every
    //   other LED LOW.

  }
}
```

**Functional Requirements**

- Each of the three buttons drives exactly one indicator LED. At most two LEDs are
  lit at any moment, and never two non-STOP indicators.
- A short press (released before 1 s) latches its indicator on. The next short
  press moves the indication to the new button.
- Holding a button for more than 1 s promotes its indicator to a 2 Hz blink. The
  blink continues while the button is held and stops on release.
- STOP overrides any RUN or RESET indication the instant STOP's debounced state is
  PRESSED, and releases it when STOP is released.
- `Serial` prints exactly one line per accepted state change, with the millisecond
  timestamp. A press-and-hold of 5 seconds prints two lines, not five hundred.

**Constraints**

- **No `delay()` or `delayMicroseconds()` anywhere.** All timing via `millis()`.
- **No `INPUT_PULLUP`.** Use `pinMode(pin, INPUT)` only. The external network is the
  subject of the exercise.
- **Debouncing must be in software.** Removing the 100 nF capacitors must not
  change the behaviour, and pulling one button's 10 kΩ out must produce visible
  noise in the raw reads (which the printouts let you see) while the debounced
  logic stays stable.
- All time comparisons must be wrap-safe: `now - start >= SPAN`, never
  `now > start + SPAN`.
- No interrupt handlers. Module 4 owns those, and this exercise is about the
  polling path.
- No `String`. Use `const char *`.

#### 6. Verification Checklist & Debugging Tasks

1. **Power-on check.** With no button pressed, meter D2 → GND: ≈ 5 V. Held: ≈ 0 V.
   Repeat for D3 and D4. Any node reading 2.8 V "sometimes" has a bad pull-up.
2. **The blink test.** Press RUN briefly. RUN's LED stays on. Press RESET briefly:
   RUN's LED goes out, RESET's LED comes on. One press each — if a single press
   produced two or three indications, the debounce window is too short or missing.
3. **The long-press test.** Hold RUN for 3 seconds. It must blink at 2 Hz, count
   roughly 6 flashes, and print exactly two lines (pressed, released).
4. **The override test.** Latch RUN, then press and hold STOP. STOP takes the
   indicator immediately and RUN's LED goes dark on the same loop pass.
5. **The serial-rate test.** Hold a button for 5 seconds and count the lines. Two.
   A number in the hundreds means you are printing inside the sampling loop.
6. **The filter-removal test.** Pull all three 100 nF capacitors. Everything must
   still behave identically, which is the proof that the software debounce is
   carrying the load.
7. **The pull-up-removal test.** Pull RUN's 10 kΩ only. The RUN LED now flickers on
   its own, and the raw reads in your serial log swing between 0 and 1. Put the
   resistor back.

**Simulated Hardware Fault:**

> **Symptom:** "I pressed RUN once and the LED flickered five or six times before
> settling. Pressing harder makes it worse."

**Diagnosis**

1. Pull the 100 nF from RUN's node and press again. If the flicker *stops*, the
   problem is not bounce at all — you have accidentally connected the capacitor
   across the switch or across the pull-up rather than from the node to ground, so
   it is damping a transition the code never sees. Meter it: one leg on D2's row,
   the other on the GND rail.
2. If the flicker survives the capacitor's removal, measure the actual bounce.
   Temporarily print the raw read on every change with its timestamp, then press
   once. The log will show the window you have to cover — usually 3–12 ms for a
   cheap tactile switch pressed hard, and nearer 1 ms pressed lightly. That number,
   not folklore, sets `DEBOUNCE_MS`.
3. Set `DEBOUNCE_MS` deliberately below your measured window — try 2 ms — and press
   again. The flicker returns. That is your threshold.
4. Check the wiring rule that produces this exact symptom: if the switch's two legs
   ended up on rows that are bridged by the breadboard's internal strips rather than
   separated by the centre channel, the button shorts nothing and the input reads
   the pull-up only. Confirm with a meter that the node is a *switch* and not a
   permanent short.

**Fix:** size `DEBOUNCE_MS` from the measured bounce (25 ms for a margin), keep the
100 nF as hardware insurance, and confirm that the behaviour is unchanged when the
capacitors are removed.

#### 7. Noesis Lab Twin

The twin proves the *topology*; it cannot reproduce the *mechanism*, and the
difference is worth knowing.

**Wiring:** Arduino Uno R3 · `Tactile Button` (one leg to D2's row, one to the GND
rail) · `10k Resistor` from D2's row to the 5 V rail · `100nF Capacitor` from the
same row to GND · `Red LED` with `220 Resistor` on D12.

**What the simulator models:** the button is 0.05 Ω closed and 1 GΩ open, and the
whole network is solved as a resistive circuit every solve. The internal pull-up is
45 kΩ, the input impedance of an unconnected GPIO is 1 TΩ, and a genuinely floating
input is driven by a wandering voltage rather than sitting politely at 0 V.

**What it does not model:** contact bounce. There is no edge train to filter, so
the twin cannot show you the fault this exercise is about. What it *does* show, and
show well, is the pull-up doing its job — pull the 10 kΩ out and the LED genuinely
flickers as the pin wanders across the threshold. That is the same failure the real
bench gives you from a missing resistor, arrived at honestly.

**Dialect note:** the interpreter covers no structs and no reference parameters, so
the twin sketch flattens the `Button` array into parallel arrays and indexes by
position:

```cpp
// Noesis Lab twin for 1.1 -- flat arrays, because the interpreter's parser
// covers no structs (src/sim/firmware/parser.ts).

const byte PIN[3]   = { 2, 3, 4 };
const byte LED[3]   = { 12, 11, 10 };
const char *NAME[3] = { "RUN", "STOP", "RESET" };
const unsigned long DEBOUNCE_MS = 25;

byte rawState[3]       = { HIGH, HIGH, HIGH };
byte debouncedState[3] = { 0, 0, 0 };
byte latched[3]        = { 0, 0, 0 };
unsigned long rawChangedAt[3] = { 0, 0, 0 };

// 0 = no change, 1 = accepted press, 2 = accepted release.
byte updateButton(byte i, unsigned long now) {
  byte raw = digitalRead(PIN[i]);

  if (raw != rawState[i]) {
    rawState[i] = raw;
    rawChangedAt[i] = now;
  }
  if (now - rawChangedAt[i] < DEBOUNCE_MS) {
    return 0;
  }

  byte wanted = (rawState[i] == LOW) ? 1 : 0;
  if (wanted == debouncedState[i]) {
    return 0;
  }
  debouncedState[i] = wanted;
  return wanted == 1 ? 1 : 2;
}

void setup() {
  Serial.begin(9600);
  for (byte i = 0; i < 3; i++) {
    pinMode(PIN[i], INPUT);
    pinMode(LED[i], OUTPUT);
  }
}

void loop() {
  unsigned long now = millis();
  byte winner = 2;

  for (byte i = 0; i < 3; i++) {
    byte change = updateButton(i, now);

    if (change == 1) {                    // TODO 1
      Serial.print(NAME[i]);
      Serial.println(" pressed");
    }
    if (change == 2) {                    // TODO 2
      latched[i] = 1;
    }
    if (debouncedState[i] == 1) {         // TODO 3: long press latches instead
      winner = i;                         //   (STOP always wins -- index 1)
    }
  }

  for (byte i = 0; i < 3; i++) {          // TODO 4: arbitration
    digitalWrite(LED[i], i == winner ? HIGH : LOW);
  }
}
```

Two things to try in the twin that the bench cannot show cheaply: switch
`pinMode(PIN[i], INPUT_PULLUP)` and delete the `10k Resistor` — it still works,
because 45 kΩ against a 1 TΩ input is enough, which is exactly why the internal
pull-up gets away with it in a quiet room and fails next to a contactor. And
replace the debounce with `delay(50)`: the sketch still *works* here, because the
simulator advances its clock by whatever the sketch waits on. On the bench the same
change makes STOP unresponsive for 50 ms whenever RUN is pressed. Blocking bugs hide
in simulators; that is a lesson worth earning here rather than at the cabinet.

---

### 1.2: Traffic Signal State Machine

**Difficulty Level:** Beginner
**Level:** 2
**Estimated Completion Time:** 60–75 mins

#### 1. Real-World Scenario

A pedestrian-crossing controller at an industrial junction near a goods yard. The
controller runs a fixed cycle — green 8 s, amber 2.5 s, red 12 s — and flashes the
pedestrian lamp at 1 Hz for the final 6 seconds of each red so the phase reads as
"about to change".

The unit has to satisfy two requirements at once, and the naive versions of each
fail:

- **It must never miss a press.** The operator's button is polled continuously; a
  sketch that spends the amber phase inside a timing delay cannot see it.
- **It must never stop.** A controller that stops mid-cycle when the UART glitches
  is a fault an authority will not accept, so every wait has to be interruptible by
  the passage of time rather than by the passage of instructions.

The answer is a finite state machine driven by `millis()`.

#### 2. Hardware Inventory & Pinout Map

**Bill of materials**

| Qty | Part | Value | Purpose |
| --- | --- | --- | --- |
| 1 | Arduino Uno R3 | — | Controller |
| 1 | LED | red | Stop aspect |
| 1 | LED | amber | Caution aspect |
| 1 | LED | green | Go aspect |
| 1 | LED | white | Pedestrian instruction |
| 4 | Resistor | 220 Ω | Current limit, one per LED |
| 1 | Tactile push-button | 6 mm | Extend-request |
| 1 | Resistor | 10 kΩ | Pull-up |
| 1 | Ceramic capacitor | 100 nF | Input filter |

**Pinout map**

| Board Pin | Component Terminal | Connects To | Value / Notes |
| --- | --- | --- | --- |
| D8 | red LED cathode, via 220 Ω | — | red LED anode → 5 V |
| D7 | amber LED cathode, via 220 Ω | — | amber LED anode → 5 V |
| D6 | green LED cathode, via 220 Ω | — | green LED anode → 5 V |
| D5 | white LED cathode, via 220 Ω | — | pedestrian lamp, anode → 5 V |
| D2 | button, leg 1 | input node | active-LOW extend request |
| D2 | button, leg 2 | GND rail | — |
| D2 node | 10 kΩ resistor | 5 V rail | pull-up |
| D2 node | 100 nF capacitor | GND rail | 1 ms filter |

The aspect currents with a 220 Ω series resistor:

| LED | $V_f$ | Current |
| --- | --- | --- |
| red | 1.9 V | 14.1 mA |
| amber | 2.1 V | 13.2 mA |
| green | 3.0 V | 9.1 mA |
| white | 3.0 V | 9.1 mA |

No legal state lights more than two of them — green plus pedestrian, or red plus
pedestrian — so the worst case is about 23 mA of output, inside both the 20 mA
per-pin recommendation and the board's 200 mA total.

#### 3. Circuit Schematics & Wiring Guide

```text
   +5V rail ──┬──[220R]──[|>|]── D8    RED     (anode at +5V, pin sinks)
              ├──[220R]──[|>|]── D7    AMBER
              ├──[220R]──[|>|]── D6    GREEN
              └──[220R]──[|>|]── D5    WALK

   +5V ──[10k]──o── D2        press button to GND
                   |
                  [100n]
                   |
                  GND
```

**Wiring procedure**

1. Power rails: 5 V and GND on the left-hand pair only, split across the centre
   channel.
2. LEDs: anode to the 5 V rail, cathode each to its own row, 220 Ω from that row
   to D8/D7/D6/D5. Mind the flat side of the LED — the cathode is the shorter leg
   and the rimmed side of the dome.
3. Button on D2 with its 10 kΩ pull-up to 5 V and 100 nF to GND, exactly as in
   Exercise 1.1.
4. Meter each aspect with the sketch driving it: every LED should read 1.9–3.0 V
   forward and a sane voltage at the pin.

**Hardware Gotchas & Safety Rules:**

- **LED polarity is the first hardware fault.** A reversed LED does not glow
  dimly, it does not glow at all. Confirm with a meter in diode mode before
  suspecting the code.
- **Do not use D9/D10 here.** They are Timer1's PWM pins, and touching them from
  `analogWrite()` or the `Servo` library reconfigures Timer1 for the whole chip —
  a lesson reserved for Exercise 2.1, but easier to skip than to unlearn.
- **One resistor per LED.** Sharing a single resistor between two aspects means the
  pair can only ever be driven one at a time.
- **The pedestrian lamp is a real safety device.** Do not prototype the amber
  timing on a road junction. This is a bench exercise.
- **Never connect an aspect directly to 5 V without the resistor.** At 20 mA a bare
  LED pulls 20 mA through the pin's output impedance, the die heats, and the pin
  stops being a pin.

#### 4. Embedded Concept Deep-Dive

**`millis()` and the wrap.** `millis()` returns an `unsigned long` — 32 bits,
milliseconds since reset, incrementing forever. After $2^{32}$ ms ≈ 49.71 days it
rolls over to zero. Two idioms handle this, and only one is safe:

```cpp
unsigned long elapsed = now - stateEntered;   // SAFE: unsigned arithmetic wraps
if (elapsed >= GREEN_MS) { ... }

if (now > stateEntered + GREEN_MS) { ... }    // UNSAFE: the sum wraps to a
                                              // small number near the rollover,
                                              // so the comparison goes false
                                              // and the state can hang forever
```

The safe form is safe *because* unsigned subtraction is defined modulo $2^{32}$:
when `now` wraps below `stateEntered`, the difference still comes out as a small
positive number near $2^{32}$, which compares correctly. Code that adds first loses
the borrow.

**Why a state machine at all.** A controller expressed as a sequence of
`delay(8000); ledGreenOff(); ...` is a controller whose *duration is a property of
the instruction stream*. Change the order of two statements and the phase lengths
change; add a `Serial.println` on the hot path and the amber is 3 ms longer. An FSM
inverts that: the state names the mode, one table says how long each mode lasts,
and the transition function is the only place behaviour changes.

The shape of it:

```text
              8000 ms
        +------------------+
        v                  |
   +--------+  2500 ms  +--------+  12000 ms  +------+
   | GREEN  +----------->| AMBER  +------------>| RED  |
   +--------+            +--------+             +------+
        ^                                          |
        +------------------------------------------+
              (plus a +6000 ms extension, twice)
```

**The blink without a second timer.** The pedestrian lamp flashes at 1 Hz inside
one state. The temptation is another `millis()` accumulator, which is a second
timer to get wrong. The better answer is interval division — derive the phase from
the same clock that already drives the state:

```cpp
bool walkPhaseOn = ((now - stateEntered) / 500) % 2;
```

That is one expression with no state, no accumulator, nothing to initialise, and it
cannot drift from the state clock because it *is* the state clock. The same trick
produces Exercise 2.1's gamma-corrected fade and Exercise 4.2's buzzer cadence.

#### 5. Firmware Challenge & Code Template

**Starter Code Scaffold**

```cpp
/*
 * Exercise 1.2 -- Traffic Signal State Machine
 *
 * Bench: Arduino Uno R3, four aspects on D8/D7/D6/D5 through 220 ohm,
 * extend-request button on D2 with a 10k pull-up.
 *
 * enterState() is supplied. The TODOs are the timing and transition logic.
 */

#include <Arduino.h>

const byte LED_RED    = 8;
const byte LED_AMBER  = 7;
const byte LED_GREEN  = 6;
const byte LED_WALK   = 5;
const byte PIN_EXTEND = 2;

const unsigned long GREEN_MS  = 8000;
const unsigned long AMBER_MS  = 2500;
const unsigned long RED_MS    = 12000;
const unsigned long WALK_LAST_MS   = 6000;   // flashing window at the end of red
const unsigned long WALK_HALF_MS   = 500;    // 1 Hz flash, 50% duty
const unsigned long EXTEND_HOLD_MS = 1500;   // press held this long counts
const unsigned long EXTEND_MS      = 6000;   // what one extension adds
const byte           MAX_EXTENSIONS = 2;

const unsigned long DEBOUNCE_MS = 25;
const unsigned long SERIAL_INTERVAL_MS = 500;

enum State { GREEN, AMBER, RED };

State state = RED;
unsigned long stateEntered = 0;
byte extensionsUsed = 0;

// Button bookkeeping, flattened because a struct array is overkill for one pin.
byte buttonRaw = HIGH;
byte buttonSettled = HIGH;
unsigned long rawChangedAt = 0;
unsigned long pressStartedAt = 0;
unsigned long lastSerialAt = 0;

// Supplied: every state change funnels through here, so the timestamp can
// never drift out of sync with the LEDs.
void enterState(State next) {
  state = next;
  stateEntered = millis();

  digitalWrite(LED_RED,   next == RED   ? HIGH : LOW);
  digitalWrite(LED_AMBER, next == AMBER ? HIGH : LOW);
  digitalWrite(LED_GREEN, next == GREEN ? HIGH : LOW);

  Serial.print("-> ");
  Serial.print(next == GREEN ? "GREEN" : next == AMBER ? "AMBER" : "RED");
  Serial.print(" @");
  Serial.print(stateEntered);
  Serial.println(" ms");

  // TODO 0 (optional, but do it): refresh the extension counter here when
  //   entering RED -- a new cycle means a fresh budget of MAX_EXTENSIONS.
}

// Supplied: true on the pass where a settled press is accepted.
bool updateExtendButton(unsigned long now) {
  byte raw = digitalRead(PIN_EXTEND);

  if (raw != buttonRaw) {
    buttonRaw = raw;
    rawChangedAt = now;
  }
  if (now - rawChangedAt < DEBOUNCE_MS) {
    return false;
  }
  if (buttonSettled == LOW) {
    return false;            // already held; do not re-arm
  }
  buttonSettled = LOW;
  pressStartedAt = now;
  return true;
}

// Supplied: how long the pedestrian lamp has been flashing, and whether it is
// currently lit. Interval division -- no accumulator, no drift.
void serviceWalkLamp(unsigned long now) {
  bool inWindow = state == RED && (now - stateEntered) >= (RED_MS - WALK_LAST_MS);
  bool phaseOn = ((now - stateEntered) / WALK_HALF_MS) % 2 == 1;
  digitalWrite(LED_WALK, inWindow && phaseOn ? HIGH : LOW);
}

void setup() {
  Serial.begin(9600);
  pinMode(LED_RED, OUTPUT);
  pinMode(LED_AMBER, OUTPUT);
  pinMode(LED_GREEN, OUTPUT);
  pinMode(LED_WALK, OUTPUT);
  pinMode(PIN_EXTEND, INPUT);       // not INPUT_PULLUP -- the external 10k stands
  enterState(RED);
}

void loop() {
  unsigned long now = millis();
  unsigned long inState = now - stateEntered;

  // TODO 1: the extend request. While state == RED, a button held for at least
  //   EXTEND_HOLD_MS adds EXTEND_MS to this red phase -- at most MAX_EXTENSIONS
  //   times per cycle. Remember the current deadline in a variable so the
  //   extension can move it; a bare `stateEntered -= EXTEND_MS` is also
  //   legitimate and is worth comparing. Ignore the request in any other state,
  //   and ignore it once the budget is spent.

  // TODO 2: the transitions. RED -> GREEN when the (possibly extended) red
  //   deadline passes; GREEN -> AMBER at GREEN_MS; AMBER -> RED at AMBER_MS.
  //   Each branch calls enterState(). Do all three with if/else, or a switch on
  //   `state` -- but exactly one of them may run per pass.

  // TODO 3: serviceWalkLamp(now) every pass, not inside a transition branch.

  // TODO 4: at most 10 lines/second of diagnostics. Print the current state and
  //   the seconds remaining in it, but no more than twice a second:
  //       if (now - lastSerialAt >= SERIAL_INTERVAL_MS) { ... }
}
```

**Functional Requirements**

- GREEN for 8000 ms → AMBER for 2500 ms → RED for 12000 ms → GREEN, repeating.
- During RED, the pedestrian lamp flashes at 1 Hz with a 50 % duty cycle, but only
  over the final `WALK_LAST_MS` (6000 ms) of the red phase. It is dark for the
  first 6 seconds of every red.
- A button held for at least 1500 ms while in RED extends the current red phase by
  6000 ms. No more than two extensions per cycle; the third is refused.
- The request is ignored entirely outside RED, and ignored while the button is held
  for less than 1500 ms.
- One `Serial` line per transition, with the millisecond timestamp, plus a periodic
  status line no more than twice a second.
- The loop stays responsive throughout: a press made during AMBER is sampled on the
  next pass, not deferred to the end of the phase.

**Constraints**

- **No `delay()` or `delayMicroseconds()` in `loop()`.** Every duration is a
  comparison against `millis()`.
- **Exactly one state machine.** No nested blocking waits, no "wait for the button"
  loops.
- Wrap-safe comparisons only: `now - stateEntered >= SPAN`.
- `Serial` output capped at 10 lines/second, enforced in the code.
- No `String`, no `delay()` in `setup()` either.

#### 6. Verification Checklist & Debugging Tasks

1. **Timing check.** Watch the `Serial` timestamps for a full cycle. Expect roughly
   8000, 2500, 12000, then repeat — and the interval between two consecutive green
   entries should be 2500 + 12000 = 14500 ms.
2. **Aspect exclusivity.** At every moment exactly one of D6/D7/D8 is lit. Catch it
   by eye in a dark room, then confirm in code: assert that no branch lights two.
3. **Walk window.** The pedestrian lamp must stay dark for the first 6 s of red and
   then flash at 1 Hz for the last 6 s. Count the flashes: about 6.
4. **Extension.** Press and hold the button through red. The red phase extends by
   6 s once. Hold again: it extends a second time. A third hold does nothing, and
   the counter resets when the next red begins.
5. **Short press ignored.** Tap the button during red — under 1500 ms. Nothing
   happens.
6. **Ignored outside red.** Press and hold during GREEN. The green phase still ends
   at 8000 ms; the request is discarded.
7. **Responsiveness.** Press during AMBER. The sketch still exits AMBER at 2500 ms.
   If the button seems to do nothing until the next phase, you have put a wait
   inside the transition.
8. **Serial rate.** Run for a minute and divide lines by seconds. Under 10/s.

**Simulated Hardware Fault:**

> **Symptom:** "The amber aspect never lights. The sequence goes green straight to
> red, and the red phase is the right length."

**Diagnosis**

1. The state machine ran; the branch is wrong. Add a print of the state on entry
   and you will see `-> GREEN` then `-> RED` with no `-> AMBER` between them. Look
   at the `AMBER` branch: a copy-paste error that calls `enterState(RED)` inside
   `case AMBER`, or a missing `break` that falls through into the red transition, is
   the usual cause — and it produces precisely this symptom, because the timing
   values are all correct.
2. Check the pin. `enterState()` drives D7 for AMBER. Confirm D7's row is the one
   the amber LED's 220 Ω reaches; a lamp wired to D8's row lights red and leaves
   D7 dark.
3. Check polarity with a meter in diode mode. A reversed amber LED is dark on every
   state and the code is innocent.
4. Check the resistor value by feel and by colour band. A 1 kΩ where 220 Ω was
   specified drops the current to 3.1 mA, which on a blue-white amber LED in a bright
   room looks indistinguishable from "not wired at all".

**Fix:** one branch per transition, one `enterState()` per branch, no fall-through.

#### 7. Noesis Lab Twin

The FSM is the one part of this module the simulator reproduces exactly, because it
is pure logic and pure `millis()`.

**Wiring:** Arduino Uno R3 · `Red LED`, `Yellow LED`, `Green LED`, `White LED`, each
with a `220 Resistor` on D8/D7/D6/D5 · `Tactile Button` on D2 with a `10k Resistor`
pull-up to 5 V.

**Dialect note:** the interpreter's parser covers no `enum`, so the twin declares
the states as constants:

```cpp
// Noesis Lab twin for 1.2 -- no enum in the interpreter's dialect.
#define GREEN 0
#define AMBER 1
#define RED   2

const byte LED_RED = 8, LED_AMBER = 7, LED_GREEN = 6, LED_WALK = 5;
const byte PIN_EXTEND = 2;

const unsigned long GREEN_MS = 8000;
const unsigned long AMBER_MS = 2500;
const unsigned long RED_MS   = 12000;
const unsigned long WALK_LAST_MS = 6000;
const unsigned long WALK_HALF_MS = 500;

byte state = RED;
unsigned long stateEntered = 0;

void enterState(byte next) {
  state = next;
  stateEntered = millis();
  digitalWrite(LED_RED,   next == RED   ? HIGH : LOW);
  digitalWrite(LED_AMBER, next == AMBER ? HIGH : LOW);
  digitalWrite(LED_GREEN, next == GREEN ? HIGH : LOW);
}

void setup() {
  Serial.begin(9600);
  pinMode(LED_RED, OUTPUT);
  pinMode(LED_AMBER, OUTPUT);
  pinMode(LED_GREEN, OUTPUT);
  pinMode(LED_WALK, OUTPUT);
  pinMode(PIN_EXTEND, INPUT_PULLUP);   // twin uses the internal pull-up: the
                                       // external one is optional on a clean bench
  enterState(RED);
}

void loop() {
  unsigned long now = millis();
  unsigned long inState = now - stateEntered;

  // TODO 1: extend the red phase on a held button, twice per cycle.
  if (state == RED && digitalRead(PIN_EXTEND) == LOW && inState >= 1500) {
    stateEntered -= 6000;
    digitalWrite(PIN_EXTEND, HIGH);
  }

  // TODO 2: the three transitions.
  if (state == RED && inState >= RED_MS)      { enterState(GREEN); }
  else if (state == GREEN && inState >= GREEN_MS) { enterState(AMBER); }
  else if (state == AMBER && inState >= AMBER_MS) { enterState(RED); }

  // TODO 3: the walk lamp, from the interval-division expression in section 4.
  bool inWindow = state == RED && inState >= RED_MS - WALK_LAST_MS;
  bool phaseOn = (inState / WALK_HALF_MS) % 2 == 1;
  digitalWrite(LED_WALK, inWindow && phaseOn ? HIGH : LOW);
}
```

**What the twin cannot show:** the serial monitor blanks during an upload on real
hardware because A4/A5 are the Uno's USB-serial pins — an $I^2C$ concern that
belongs to Exercise 3.1, but worth knowing now if you ever move the aspects.

**What the twin hides, deliberately:** replace the timing with `delay()` and it
still looks perfect, because the simulator advances its clock by whatever the
sketch waits on. Run the bench version and the green phase is 8 seconds whether or
not you blocked. The FSM earns its keep in the place where time passes regardless of
what the code is doing — which is exactly the machine, and not the simulator.

---

Work through Module 2 next: **[Module 2 — Analog Interfaces & Signals](module-2-analog.md)**
takes the same non-blocking timing from 1.2 and points it at a signal that is not
digital at all.
