# Module 0 — First Contact

**There is no electronics background assumed here.** You have never held a
breadboard, and that is fine — this module exists so you do not have to pretend
otherwise. By the end you will have wired a real circuit, made it misbehave on
purpose, and diagnosed why.

Nothing in this module requires maths beyond arithmetic. Nothing requires a
multimeter. The only software you need is the ability to copy text into a text
editor and press one button.

| ID | Exercise | Difficulty | Time |
| --- | --- | --- | --- |
| [0.1](#01-your-first-circuit) | Your First Circuit | Beginner | 45–60 mins |

> **This is Level 1 of the ladder.** After it, go to
> [`LEVELS.md`](LEVELS.md) and pick your next exercise from there.

---

### 0.1: Your First Circuit

**Difficulty Level:** Beginner
**Level:** 1 — no prior knowledge assumed
**Estimated Completion Time:** 45–60 mins
**New concepts:** 3. What a pin is. What a resistor is for. Why `HIGH` means 5 V.

#### 1. Real-World Scenario

Almost every piece of electronics ever built does one thing first: it tells you it
is on.

A vending machine has a light that says *ready*. A car has a dashboard light that
says *low fuel*. A server rack has an LED that says *power*. None of them measure
anything, none of them are clever, and all of them are the reason anyone knows the
thing is alive.

You are building that light. It is the smallest useful embedded program there is,
and if you can do this one properly — including working out why it stopped working —
nothing later in this curriculum will surprise you.

#### 2. Hardware Inventory & Pinout Map

**What you need**

| Qty | Part | Why |
| --- | --- | --- |
| 1 | Arduino Uno R3 | The board. Needs a USB cable and a computer. |
| 1 | Breadboard | A plastic board with holes that connect in rows. No solder. |
| 1 | Resistor, **220 Ω** | Sits in series with the LED. Not optional — see section 4. |
| 3 | LEDs (red, green, blue) | Colours so you can tell the pins apart at a glance. |
| 2+ | Jumper wires | Plain wires to make the connections. |
| — | Laptop, USB cable | To upload the program. |

**If you do not own any of this**, the digital twin in section 7 runs the whole
exercise in a browser. Do that first if hardware is not in front of you.

**Pinout map**

| Board Pin | Component Terminal | Connects To | Value / Notes |
| --- | --- | --- | --- |
| D8 | 220 Ω resistor, one leg | LED cathode | The resistor goes on the cathode side. |
| D8 | 220 Ω resistor, other leg | LED anode | LED long leg. |
| D9 | 220 Ω resistor, one leg | second LED cathode | — |
| D9 | 220 Ω resistor, other leg | second LED anode | — |
| D10 | 220 Ω resistor, one leg | third LED cathode | — |
| D10 | 220 Ω resistor, other leg | third LED anode | — |
| 5V | — | the breadboard's red `+` rail | Power for the LEDs' other end. |
| GND | — | the breadboard's blue `−` rail | The return path. Never optional. |

We use D8, D9 and D10 rather than pin 13, because the Uno already has an LED and a
resistor built in on pin 13 and it would hide the lesson.

**Current-limiting arithmetic, worked**

$$I = \frac{V_{CC} - V_f}{R} = \frac{5 - 1.9}{220} \approx 14.1 \text{ mA}$$

An LED's forward voltage ($V_f$) is roughly 1.9 V for red and about 3.0 V for
blue. The rest of the 5 V has to be dropped somewhere, and the resistor is what
drops it. More on this in section 4, because it is the single most important
number in this module.

#### 3. Circuit Schematics & Wiring Guide

**The whole circuit, once. Every exercise below is this diagram with a program
attached.**

```text
   +5V rail (red)                          breadboard power rails
  ──────┬──────┬──────┬────────────────    ── connected down the red line
        │      │      │                         to nothing but your LEDs
      ┌─┴─┐  ┌─┴─┐  ┌─┴─┐                     and their resistors
      │LED│  │LED│  │LED│                  blue rail = GND
      └┬─┘  └┬─┘  └┬─┘
        │      │      │
      [220]  [220]  [220]                   R = 220 ohm
        │      │      │
       D8     D9     D10                     microcontroller pins sink to GND
```

Current flows the way water flows: out of the 5 V rail, through the LED, through
the resistor, into the pin, and back to ground. **Every circuit is a loop.** If
there is a gap anywhere in that loop, nothing happens — which is the single most
useful thing to know when something refuses to work.

**How the breadboard works — read this once**

A breadboard is a grid of spring clips. Internally, metal strips join certain holes
together permanently. You cannot see the strips, so you have to know the pattern:

```text
   + + + + + + + + + +          <- red line: all joined together
   o o o o o o o o o o
   o o o o o o o o o o          <- each ROW of 5 holes is joined sideways
   o o o o o o o o o o
   ┼─────────┼─────────┼        <- THE TRENCH: left and right are separate
   o o o o o o o o o o             nothing joins across this channel
   o o o o o o o o o o
   o o o o o o o o o o
   o o o o o o o o o o
   ─ ─ ─ ─ ─ ─ ─ ─ ─ ─          <- blue line: all joined together
```

Three rules that prevent almost every beginner mistake:

1. **A row of five holes is one connection.** Put both legs of a part's resistor in
   the same row and they are joined. Put them in *different* rows and they are not.
2. **The trench in the middle separates the two halves.** The red and blue rails on
   the left of the trench are not connected to the red and blue rails on the right.
   This catches nearly everyone once.
3. **The red and blue rails run the length of the board** and are usually joined
   together already at one end — but split them anyway and power from one side only,
   so there is only one path for current to take.

**Wiring procedure**

1. Unplug the USB cable. Wire with the board unpowered, every time.
2. Run a jumper from the board's **5V** pin to the red `+` rail, and another from
   **GND** to the blue `−` rail. Both on the same side of the trench.
3. Take the first LED. Find its two legs: **the long leg is the anode (+), the short
   leg is the cathode (−).** If they are the same length, the flat spot on the rim
   of the bulb marks the cathode.
4. Push the anode into a row on the red rail, and the cathode into its own row in
   the middle of the board.
5. Push the 220 Ω resistor into that cathode row and into any free row. Now the
   cathode and one leg of the resistor share a row.
6. Jumper that resistor's other leg to **D8**.
7. Repeat for the second LED on **D9** and the third on **D10**, each with its own
   220 Ω resistor, each using its own rows.
8. Plug in USB. The board's small power LED lights. Your LEDs do not yet — that is
   correct, there is no program.

**Hardware Gotchas & Safety Rules**

- **The 220 Ω resistor is not decoration.** Do not connect an LED directly to a pin
  to "test it quickly". An LED is not a resistor: once it reaches its forward
  voltage it passes current freely, so the only thing limiting it is the pin's own
  internal resistance — of a few ohms. The result is tens of milliamps through a
  part rated for about 20, and the LED dies, sometimes taking the pin's driver with
  it. Always 220 Ω.
- **Never bridge the red rail to the blue rail.** That is a short circuit, it will
  make the board's regulator hot, and on a poor supply it will reset the board every
  time you press Upload.
- **40 mA is the hard ceiling on one pin.** Never put more than about three LEDs on
  one pin. Two is comfortable; four is a design mistake.
- **Wire unpowered.** Hot-swapping a jumper onto a live 5 V rail can blow the
  onboard diode.
- **LED polarity is the number one reason a beginner's LED does not light.** If it
  will not light, flip it before you touch anything else. See section 6.
- **Count the legs, do not trust the drawing.** A resistor has no polarity, but an
  LED does, and getting it backwards is invisible until you wonder why nothing
  happens.

#### 4. Embedded Concept Deep-Dive

**What a pin actually is.** Each digital pin is a tiny electronic switch with two
positions. In one position it connects to the 5 V supply; in the other it connects
to ground. That is the whole interface:

| What the program says | What the pin is doing | What you measure |
| --- | --- | --- |
| `digitalWrite(8, HIGH)` | connected to 5 V | ≈ 5 V at the pin |
| `digitalWrite(8, LOW)` | connected to ground | ≈ 0 V at the pin |

That is why an LED on a pin needs 5 V on its other end: the pin can only *supply*
5 V or *drain* to 0 V, so the LED needs one end at each. It is also why there is
no "dim" and no "half" — a pin is a switch, so it is either on or off. Modules 3
in this curriculum is where we get around that.

**Why the resistor exists — the arithmetic that matters most.** Here is the whole
reason, and it is worth understanding properly rather than memorising:

An LED has a property called its **forward voltage**: push about 1.9 V across a
red LED and it conducts, and pushing more voltage does *not* make proportionally
more light — it makes more heat and eventually kills it. So a red LED is not a
resistor. Connect it straight across 5 V and the LED's own resistance collapses to
a few ohms, and Ohm's law says the current becomes enormous:

$$\text{wire straight across 5 V:}\quad I = \frac{5 - 1.9}{2} \approx 1.5 \text{ A}$$

One and a half amps, through a 20 mA part. It will be destroyed in under a second,
and it may take the microcontroller's pin with it.

Add a resistor and the arithmetic becomes safe:

$$I = \frac{5 - 1.9}{220} \approx 14.1 \text{ mA}$$

You are choosing the resistor to make the current *smaller on purpose*. It works
because it takes a fixed voltage (the LED's forward drop) and converts it into a
fixed current (by dividing by a fixed resistance). **Choosing a resistor is
choosing a current.** That single sentence is the reason every LED in every
exercise in this curriculum has one, and the reason the arithmetic is written out
each time instead of handed to you as a magic number.

**Ground is a reference, not an absence.** "Ground" means *the 0 V point every
voltage is measured against*. It is not where current disappears; current goes
around the loop through ground, back to the supply, exactly as the water analogy
in section 3 says. This is why a circuit with no ground connection does not work at
all, even if the 5 V side is perfectly connected.

**A microcontroller is a computer that cannot float.** It reads a pin as either
HIGH or LOW by comparing the voltage against a threshold. Later levels spend a
whole exercise (1.1) on the fact that if you never *tell* it which state a pin is
in, it will happily guess — and guess wrong, in a way that changes with the
weather. For now, everything you build is an output, and outputs have no such
problem. That is why this module uses no inputs at all.

#### 5. Firmware Challenge & Code Template

Four steps, each a complete program. Do them in order. **Each one is finished and
runnable as typed — there is nothing to fill in.** That is deliberate: your first
goal is to see the thing work, and every construct you have not met yet is one
more thing between you and that.

**Step 1 — the board's own LED.** No wiring at all. Open the Arduino IDE, paste
this, press Upload.

```cpp
/*
 * Step 1 -- the LED already on the board.
 *
 * The Uno has a small LED wired to pin 13, with its own resistor already
 * fitted. That is why the very first program ever written needs no parts.
 */

#include <Arduino.h>

void setup() {
  pinMode(13, OUTPUT);   // "this pin will be used to switch something"
}

void loop() {
  digitalWrite(13, HIGH);  // connect pin 13 to 5 V -> LED lights
  delay(500);              // wait half a second
  digitalWrite(13, LOW);   // connect pin 13 to ground -> LED goes out
  delay(500);              // wait half a second
}
```

The board's LED should now blink about once a second.

> **On `delay()`:** `delay(500)` means "do nothing for 500 milliseconds". At this
> level that is the correct tool, not a bad habit — the program genuinely has
> nothing else to do. From Exercise 1.1 onwards `delay()` is banned in the main
> loop, because by then your program *will* have something else to do, and a
> program that stops to wait cannot do it. Do not worry about that yet. You will
> understand exactly why on the day.

**Step 2 — your first external LED.** Now wire D8 as in section 3, and replace
the sketch. Notice the pin number changed from 13 to 8; that is the only edit.

```cpp
/*
 * Step 2 -- the LED you wired yourself.
 *
 * Hardware: D8 -> 220 ohm -> LED -> 5V rail.
 */

#include <Arduino.h>

const byte LED_PIN = 8;   // the pin our LED is on

void setup() {
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  digitalWrite(LED_PIN, HIGH);
  delay(500);
  digitalWrite(LED_PIN, LOW);
  delay(500);
}
```

**Step 3 — turn it on and off from a program you can change.** Replace `HIGH` and
`LOW` with numbers and see what happens.

```cpp
/*
 * Step 3 -- prove that HIGH and LOW are only two values.
 *
 * Try 5, then 3, then 1. Then try 6 and -1.
 */

#include <Arduino.h>

const byte LED_PIN = 8;
const byte ON_LEVEL = HIGH;

void setup() {
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  digitalWrite(LED_PIN, ON_LEVEL);
  delay(1000);
  digitalWrite(LED_PIN, LOW);
  delay(1000);
}
```

Whatever you put in `ON_LEVEL`, the LED is either fully lit or fully dark. That is
the switch, and seeing it is worth more than being told.

**Step 4 — a pattern on all three LEDs.** Now use every pin you wired.

```cpp
/*
 * Step 4 -- three LEDs, one pattern.
 *
 * D8 red, D9 green, D10 blue.
 */

#include <Arduino.h>

const byte RED  = 8;
const byte GREEN = 9;
const byte BLUE = 10;

void setup() {
  pinMode(RED, OUTPUT);
  pinMode(GREEN, OUTPUT);
  pinMode(BLUE, OUTPUT);
}

void loop() {
  digitalWrite(RED, HIGH);
  digitalWrite(GREEN, LOW);
  digitalWrite(BLUE, LOW);
  delay(300);

  digitalWrite(RED, LOW);
  digitalWrite(GREEN, HIGH);
  digitalWrite(BLUE, LOW);
  delay(300);

  digitalWrite(RED, LOW);
  digitalWrite(GREEN, LOW);
  digitalWrite(BLUE, HIGH);
  delay(300);
}
```

**Functional Requirements**

- All three LEDs light and go dark under program control.
- The current in each LED is limited by its own 220 Ω resistor.
- Every pin used is declared `OUTPUT` in `setup()` **before** it is written to.
- You can explain, out loud, why each LED has a resistor.

**Constraints**

- No inputs. Nothing to read, nothing to debounce, no pull-ups.
- `digitalWrite` only. No `analogWrite` — there is no dimming at this level, and
  section 4 explains why.
- Only `HIGH` and `LOW`. Nothing between them.
- `delay()` is expected here and is not a mistake. See the note in step 1.

#### 6. Verification Checklist & Debugging Tasks

Work down this list. Stop at the first thing that does not pass and fix it before
going further — this is the discipline that makes debugging fast.

1. **Power.** Plug in USB. The small power LED on the board lights. It does not
   blink, and it is not connected to your circuit.
2. **Step 1 works.** Upload the step 1 sketch. The board's own LED blinks at
   roughly 1 Hz. Count ten flashes — it should take about ten seconds. If it is
   faster or slower, `delay()` is not 500 on your board.
3. **Rails are connected.** Touch a jumper from the 5 V pin to the red rail. Now
   measure: you should see 5 V between the red and blue rails at the far end of the
   board. If it reads 0 V, your 5 V jumper went into the wrong rail.
4. **Each LED has a path.** For one LED, touch the metal leg of a wire to the LED's
   anode (long leg), then move it to the cathode (short leg). The LED must light in
   exactly one of those two positions. If it lights in neither, or both, you have a
   wiring gap. If it lights in both, you have probably bridged the rails.
5. **Step 2 works.** Upload step 2. D8's LED blinks, and the board's own LED stays
   dark. Exactly one blink, not two.
6. **Step 4 works.** All three blink in turn, red then green then blue.
7. **You can answer these three questions.** If you cannot, go back and re-read
   section 4:
   1. Why does the LED need the 5 V rail as well as the pin?
   2. What would the current be if the resistor were 10 Ω instead of 220 Ω?
      ($I = (5 - 1.9)/10 = 310$ mA — twenty-two times the 14.1 mA the 220 Ω
      resistor allows, and past the pin's 40 mA limit on its own.)
   3. If you removed the resistor entirely, which part would break first: the LED
      or the pin?

**Simulated Hardware Fault:**

> **Symptom:** "I uploaded step 2 and nothing happens. The board's power LED is on,
> the program uploaded without errors, and the board's own LED on pin 13 blinks
> fine when I try step 1 — so the board works."
>
> **Diagnosis, in order. Do not skip to step 4.**
>
> 1. **Is the LED in the right row?** Look for the flat spot on the rim of the
>    bulb. The short leg on that side is the cathode. If the anode and cathode are
>    in two rows that are not joined, nothing happens. Follow the row with your
>    finger and confirm each connection actually exists.
> 2. **Is the LED the right way round?** Swap the two legs. This single fix solves
>    more beginner problems than everything else combined. An LED wired backwards
>    does not glow dimly — it does not glow at all, and it looks identical to an
>    LED that is wired to nothing.
> 3. **Is the resistor actually in circuit?** The path must be
>    `5 V rail → LED anode → LED cathode → 220 Ω → D8`. Any of those four links
>    broken gives a dark LED. Most often the resistor's two legs are in different
>    rows, or one LED is sharing another LED's rows.
> 4. **Is the jumper on D8, or on D9?** The board's silkscreen for D8/D9/D10 sits
>    right next to the chip and is easy to misread. Move the jumper one pin and
>    watch.
> 5. **Is the rail split?** If you powered the left-hand red rail and built on the
>    right-hand one, the two are separated by the trench and are not connected.
>    Power one side, build on that side.
> 6. **Only now, question the code.** Print nothing, change nothing. Upload step 3
>    and set `ON_LEVEL = HIGH`. If the LED is still dark, it is the circuit — the
>    code is the last suspect, not the first.
>
> **Fix:** flip the LED, then re-verify the four links in the path. Once it blinks,
> deliberately remove the resistor and watch it die or stop working, then refit it.
> Breaking it on purpose is how the lesson sticks.

**Two more faults worth meeting early**

- **"It only works while I press the reset button."** The sketch is fine; the
  contact between the LED lead and the breadboard hole is poor. Reseat the pin.
  Breadboard contacts degrade fast and are the most common cause of an intermittent
  beginner circuit.
- **"My second LED is dimmer than the first."** Check that it has its own 220 Ω
  resistor and not a shared one, and that it is not a different colour. Blue and
  white LEDs have a higher forward voltage, so at the same current they are simply
  harder to see.

#### 7. Noesis Lab Twin

This exercise runs completely in the simulator, which is the recommended first
path if you do not have parts in front of you.

**Wiring:** Arduino Uno R3 board · `Red LED` on **D8** with a `220 Resistor` between
the LED and the pin, anode to the 5 V rail · `Green LED` on **D9** · `Blue LED` on
**D10**, each with its own `220 Resistor`.

Note the catalogue's naming: the part is `220 Resistor`, not `220 Ω Resistor`, and
`10k Resistor` rather than `10 kΩ Resistor`. The catalogue does not put a space in
an SI prefix.

**What this twin does faithfully:** the LED's forward voltage and the resulting
current, the effect of the resistor, `pinMode` before `digitalWrite`, and the
`HIGH`/`LOW` switch. Remove the `220 Resistor` from the twin and the LED's modelled
current rises exactly as the arithmetic in section 4 predicts — the simulation
solves the circuit, so the Ohm's law lesson is real rather than illustrated.

**What it cannot show:** breadboard rows and the trench. The simulator has no
physical contacts to strip, so the single most common beginner fault — two legs
that look adjacent and are not connected — has no equivalent to reproduce. That
fault is worth experiencing on real hardware, or at least reasoning carefully about
before it costs you an evening.

**A note on this sketch's dialect:** the simulator's interpreter is deliberately
small (`src/sim/firmware/parser.ts:6`) — it has no structs, enums or pointers. So
file-scope constants are written as plain globals with an initialiser, rather than
`const byte`. Later modules say more about why that dialect limit is itself a
useful design lesson.

```cpp
/*
 * Module 0 twin -- three LEDs, the same pattern as bench step 4.
 *
 * File-scope globals rather than `const`: the interpreter's parser rejects
 * `const` at file scope. Inside functions `const` is fine.
 */

byte RED  = 8;
byte GREEN = 9;
byte BLUE = 10;

void setup() {
  pinMode(RED, OUTPUT);
  pinMode(GREEN, OUTPUT);
  pinMode(BLUE, OUTPUT);
}

void loop() {
  digitalWrite(RED, HIGH);
  digitalWrite(GREEN, LOW);
  digitalWrite(BLUE, LOW);
  delay(300);

  digitalWrite(RED, LOW);
  digitalWrite(GREEN, HIGH);
  digitalWrite(BLUE, LOW);
  delay(300);

  digitalWrite(RED, LOW);
  digitalWrite(GREEN, LOW);
  digitalWrite(BLUE, HIGH);
  delay(300);
}
```

**The level 1 exit check.** Before going to [`LEVELS.md`](LEVELS.md), be able to do
all three without looking anything up:

1. Wire an LED and a 220 Ω resistor to a pin from a breadboard you have never seen
   before, and have it blink.
2. Say why the resistor is there, in terms of what it does to the current.
3. Take a dark LED and produce a ranked list of the three most likely causes.

---

**Next:** [`LEVELS.md`](LEVELS.md) to choose Level 2 — or jump straight to
[1.1 Industrial Push-Button & Mechanical Debouncing](module-1-gpio.md) if the three
checks above feel easy.

**Exercise authoring:** new exercises at this level start from
[`TEMPLATE.md`](TEMPLATE.md).
