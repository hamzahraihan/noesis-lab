# The Level Ladder

How to find where to start, what each level assumes, and what you are expected to
be able to do before moving up. Twelve exercises, five levels, roughly 13 hours of
bench time in total.

Work the levels in order. They are cumulative: every level assumes the previous
one completely, and no level introduces more than **three** new concepts.

---

## 1. Placement: where should I start?

Answer honestly. Starting too low costs you 45 minutes; starting too high costs
you a wasted evening and a circuit you cannot debug.

| # | Question | If **yes** |
| --- | --- | --- |
| 1 | Have you ever put a component into a breadboard and got two pins to connect? | go to Q2 |
| 2 | Can you explain why an LED needs a resistor, in terms of current? | go to Q3 |
| 3 | Have you uploaded a sketch that used `millis()` instead of `delay()` to time something? | go to Q4 |
| 4 | Have you ever wired two chips to one I²C bus and used an address to tell them apart? | go to Q5 |
| 5 | Have you written an interrupt handler that touches a variable the main loop also reads? | Level 5 |
| — | **No** to Q1 or Q2 | **Level 1** |
| — | **Yes** to Q2, **No** to Q3 | **Level 2** |
| — | **Yes** to Q3, **No** to Q4 | **Level 3** |
| — | **Yes** to Q4, **No** to Q5 | **Level 4** |

Nobody skips levels on this ladder. There is no shame in redoing Level 1 on a
breadboard you have used before — the first time, the trench and the row-junctions
will beat you, and the second time they will not.

---

## 2. The ladder

| Level | Theme | Assumes | New concepts (max 3) | Exercises | Time |
| --- | --- | --- | --- | --- | --- |
| **1** | First contact | nothing | A pin is a switch · a resistor sets a current · `HIGH` is 5 V | [0.1](module-0-first-light.md) | 45–60 mins |
| **2** | Reading the world | Level 1 | `digitalRead` · pull-ups and active-LOW · non-blocking time | [1.1](module-1-gpio.md) · [1.2](module-1-gpio.md) | 105–135 mins |
| **3** | Signals that are not on or off | Level 2 | ADC resolution · PWM duty · voltage dividers and filtering | [2.1](module-2-analog.md) · [2.2](module-2-analog.md) | 120–150 mins |
| **4** | Talking to other chips | Level 3 | open-drain and addressing · chip-select framing · the RAM budget | [3.1](module-3-bus-protocols.md) · [3.2](module-3-bus-protocols.md) | 150–180 mins |
| **5** | Faster than the loop | Level 4 | interrupts and `volatile` · atomic reads · microsecond timing | [4.1](module-4-interrupts.md) · [4.2](module-4-interrupts.md) · [5.1](module-5-maps.md) · [5.2](module-5-single-board-computers.md) · [5.3](module-5-networks.md) | 255–330 mins |

---

## 3. Level 1 — First contact

**Start here if you have never wired anything.**

The goal is not to learn a concept. The goal is to make a physical thing happen,
then break it on purpose and put it right.

| | |
| --- | --- |
| **Exercise** | [0.1 Your First Circuit](module-0-first-light.md) |
| **You will use** | the board, a breadboard, LEDs, resistors, `pinMode`, `digitalWrite`, `delay` |
| **You will learn** | that a pin is a switch between 5 V and ground; that a resistor converts a voltage into a current; that a circuit is a loop and a gap anywhere makes it dead |
| **Deliberately not yet** | inputs of any kind, timing that is not `delay()`, maths beyond arithmetic |

**Exit check — all three, without looking anything up:**

1. Wire an LED and a 220 Ω resistor to a pin on a breadboard you have not seen
   before, and make it blink.
2. Say why the resistor is there, in terms of what it does to the current.
3. Given a dark LED, produce a ranked list of the three most likely causes.

Failing any one of these means repeat Level 1. It is cheap and it is the
difference between a beginner who can debug and one who cannot.

---

## 4. Level 2 — Reading the world

**Start here if you can build an output circuit but have never read a pin.**

Outputs are safe: you tell the chip what to do. Inputs are where embedded
engineering begins, because the world does not behave the way you asked.

| | |
| --- | --- |
| **Exercises** | [1.1 Push-Button & Debouncing](module-1-gpio.md) · [1.2 Traffic Signal State Machine](module-1-gpio.md) |
| **You will use** | buttons, `digitalRead`, pull-up resistors, capacitors, `millis()`, an `enum`, a struct |
| **You will learn** | that an input you have not defined is a liar; that a mechanical contact is not a switch; that `delay()` stops your program from noticing anything else |

**The moment `delay()` is withdrawn.** Level 1 used `delay()`, and it was correct
there. From 1.1 onwards it is banned in the main loop, because your program now
has other work to do and a program that waits cannot do it. If you skip straight to
1.1 and find the ban arbitrary, go back and run 1.2 with `delay()` deliberately
wrong: put the amber phase behind a `delay(2500)` and press the button during it.
Nothing happens, for two and a half seconds, and that silence is the whole
argument.

**Exit check:**

1. Explain, in one sentence, what a floating input reads and why.
2. Say what happens to a machine's RUN command if the debounce window is removed.
3. Build a state machine with `millis()` and no `delay()` in `loop()`.

---

## 5. Level 3 — Signals that are not on or off

**Start here if you are comfortable with inputs and non-blocking timing.**

The world is analogue. Your chip is digital. Everything in this level is about the
gap between those two facts.

| | |
| --- | --- |
| **Exercises** | [2.1 Pot Dimmer & PWM](module-2-analog.md) · [2.2 Sensor Calibration & Dividers](module-2-analog.md) |
| **You will use** | potentiometer, thermistor, LDR, `analogRead`, `analogWrite`, `map`, `pow` |
| **You will learn** | that the ADC is a set of buckets, not a number; that PWM is a duty cycle pretending to be an analogue voltage; that a sensor plus a resistor is a measurement you have to invert with algebra |

**Exit check:**

1. Work out the node voltage of a 10 kΩ/10 kΩ divider at 5 V, then invert the
   equation to recover the sensor's resistance.
2. Explain why a thermistor's own β tolerance matters more than the ADC's
   resolution.
3. Name one thing that makes a moving average lie to you, and say why.

---

## 6. Level 4 — Talking to other chips

**Start here if you are comfortable with analogue signals and timing.**

One wire to the outside world stops being enough when there are two devices.
Level 4 is about shared buses, addresses, framing, and the memory that costs.

| | |
| --- | --- |
| **Exercises** | [3.1 I²C Environmental Monitor](module-3-bus-protocols.md) · [3.2 SPI Display Control](module-3-bus-protocols.md) |
| **You will use** | SSD1306 OLED, DS1307, `Wire`, `SPI`, 74HC595, 1 Mbit of noes you can no longer ignore |
| **You will learn** | that I²C lines are open-drain and the HIGH level exists only because of pull-ups; that a datasheet address of `0x78` is really `0x3C`; that SPI has no addresses, so chip-select *is* the addressing |

**Exit check:**

1. Explain why a bus with no pull-up resistors does not read high, and what the
   scanner shows you.
2. Convert a datasheet address to the 7-bit form your code uses.
3. Look at an SSD1306 frame buffer's size against the Uno's 2 KB of RAM and say
   what that costs you.

---

## 7. Level 5 — Faster than the loop

**Start here if you have driven both buses.** The hardest level, and the one where
the hardware stops cooperating.

| | |
| --- | --- |
| **Exercises** | [4.1 Encoder & Tachometer](module-4-interrupts.md) · [4.2 Ultrasonic Radar](module-4-interrupts.md) · [5.1 A map on a TFT](module-5-maps.md) · [5.2 A pocket map on a TFT](module-5-single-board-computers.md) · [5.3 A network desk](module-5-networks.md) |
| **You will use** | KY-040 encoder, optical sensor, HC-SR04, `attachInterrupt`, `volatile`, `ATOMIC_BLOCK`, `micros` |
| **You will learn** | that a signal faster than your loop needs the chip to come to you; that `volatile` is a promise to the compiler, not to you; that a 32-bit number read while an interrupt writes it can be torn in half; that a network's answers arrive on the same terms — on their schedule, never yours |

**Exit check:**

1. Write a Gray-code transition table from scratch and say what you do with an
   entry that is not in it.
2. Explain what `volatile` does and does not protect.
3. Compute a distance from an echo width, including the factor of two and the
   temperature term.

---

## 8. The rules of the ladder

These are the constraints that keep the track teachable. They are enforced when
writing new exercises — see [`TEMPLATE.md`](TEMPLATE.md).

1. **Three new concepts per exercise, maximum.** If a fourth is needed, it becomes
   the next exercise. This is why 1.1 and 1.2 are separate exercises about
   "buttons" rather than one exercise about "user interfaces".
2. **No vocabulary without a definition.** Every new term is defined in the
   deep-dive section before it is used in code, and Level 1 defines its terms in
   plain language rather than in terms of each other.
3. **`delay()` is permitted at Level 1 and banned from Level 2 onwards.** Not a
   stylistic preference — the reason is taught in the exercise that withdraws it.
   The single late exception — 5.1's fetch wait — is argued in that lesson.
4. **Hardware is reused before it is added.** Each level's first exercise uses
   parts already in the bin. New parts arrive only where the concept requires them,
   and the reason is written down.
5. **Every exercise ends with something broken.** The learner is given a symptom
   and must produce a ranked diagnosis. A working circuit teaches less than a
   circuit they repaired.
6. **Every exercise is built on the bench first and in the twin second.** Building
   it in the simulator first spoils the debugging, because the simulator removes the
   fault you were supposed to find.
7. **Honest limits.** Where the simulator cannot model something — interrupts,
   bounce, 5 V levels, RAM pressure — the twin says so and names what is lost.

---

## 9. If you want to skip ahead

You can, and for an experienced engineer that is the sensible thing to do. Two
ways it usually goes wrong:

- **You skip the level and hit its bug later, at a worse moment.** Learning why a
  pull-up is mandatory is much cheaper at Level 2 than while debugging a bus that
  intermittently reads `0x00`.
- **You skip the level and lose the vocabulary.** The exercises define terms as they
  go; arriving late means meeting `VOL`, `I_OL` and `$t_r$` without ever having been
  introduced to any of them.

If you skip, at least do the three-minute diagnostic above, and read the **Shared
rules** and **Portability notes** in [`README.md`](README.md) first. Those apply at
every level and are the things that bite hardest.
