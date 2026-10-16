# Exercise Authoring Template

Copy this file to start a new exercise. Fill in the bracketed slots, delete the
notes in `<!-- -->` comments, and delete any section the level says is optional.

The seven numbered sections are **fixed** — do not reorder or rename them. Learners
and reviewers navigate by section number, and the level checks below assume the
order. What *changes* between levels is how much of each section you are allowed
to pre-fill, and that is what the level rules specify.

---

## Level rules

Pick a level before writing. The level decides the starter scaffold, the number of
new concepts, and how much you may hand over.

| Level | New concepts | Starter code | `delay()` | Vocabulary | First concept must be |
| --- | --- | --- | --- | --- | --- |
| **1** | ≤ 2 | **Complete and runnable.** No `TODO`s at all. | Permitted, encouraged | Plain language; no symbol used before it is defined | An output |
| **2** | ≤ 3 | Complete helpers, TODOs in application logic | Banned in `loop()` | Each term defined before use | An input |
| **3** | 3 | Signature + TODOs, helpers supplied | Banned | Maths shown, then reused | A measurement |
| **4** | 3 | Signature + TODOs, bus helpers supplied | Banned | Register names given with their datasheet meaning | A second device |
| **5** | 3 | Scaffold + transition tables supplied | Banned | C/C++ semantics (volatile, atomicity) | A signal faster than the loop |

**Level 1 is the one that gets written differently.** There are no `TODO`s, because
a learner who has never uploaded a sketch should never meet a `TODO` on their first
attempt. Instead, ship 3–4 small complete sketches as progressive steps, each one
building on the last and each one working. This is the only place in the track
where "the challenge" is "make the next one work", and it is deliberate.

**The one-level rule.** An exercise introduces at most three concepts, and every
concept it introduces must be one of:

- something the learner can **see or hear** (a blinking LED, a reading on a screen);
- something they can **break on purpose** (a reversed LED, a missing resistor);
- something they **already needed** and were getting by without.

If a fourth concept seems necessary, it belongs in the next exercise. Eleven
exercises over five levels works because each one is small enough to finish.

---

## Template

```markdown
### [X.Y]: [Exercise Name]

**Difficulty Level:** [Beginner / Intermediate / Advanced]
**Level:** [1–5]
**Estimated Completion Time:** [30–45 mins]
**New concepts:** [1. … 2. … 3. …]

#### 1. Real-World Scenario

[One short paragraph: a machine, a room, and a thing that goes wrong. Name the
physical context — a conveyor cabinet, a cold-chain logger, a shop front. The
learner should recognise the situation, not the words.

For Level 1, write the scenario as "the simplest useful thing this device does":
a power-on light, a status lamp. Do not open with a subtle failure mode; the
learner has no context to hang it on.]

#### 2. Hardware Inventory & Pinout Map

**Bill of materials** [table: qty, part, value, why]

**Pinout map** [table: Board Pin | Component Terminal | Connects To | Value / Notes]

[The pinout table header is fixed across every exercise — do not rename its
columns. Reviewers and learners both navigate by it.]

[Show the arithmetic for anything non-obvious, not just LED current:
$$I = \frac{V_{CC} - V_f}{R} = \frac{5 - 1.9}{220} \approx 14.1 \text{ mA}$$
[State the budget it has to fit inside: 40 mA per pin absolute, 20 mA recommended,
200 mA for the whole board.]

#### 3. Circuit Schematics & Wiring Guide

```text
[Aligned ASCII schematic, fenced as text. Every line the same width. Name the
pins at both ends so the drawing stands alone.]
```

**Wiring procedure**

1. [Numbered, one physical action per step, starting from unpowered. Include the
breadboard-topology note whenever a breadboard is involved: rows of five, the
trench, the split rails.]

**Hardware Gotchas & Safety Rules**

- **[Each gotcha names a symptom and its cause, not just a prohibition.
Level 1: at least three, including LED polarity and the missing-resistor case.]

#### 4. Embedded Concept Deep-Dive

[The theory this exercise actually needs, and nothing beyond it. Every new term
is defined here before it appears in section 5.]

- **[Define each new concept in one or two sentences, in plain language, before
giving the arithmetic or the API.]
- **[Then the precise version: the equation, the register, the datasheet limit.]
- **[Then why it matters — the failure it prevents.]

[For Levels 3–5, a worked numeric example. For Level 1, an analogy plus the one
equation that explains the whole level.]

#### 5. Firmware Challenge & Code Template

**Starter Code Scaffold**

```cpp
/*
 * [Exercise X.Y] -- [name]
 *
 * [Hardware: one line describing the wiring.]
 * [Bench: Arduino Uno R3. Twin: see section 7.]
 *
 * [For Levels 2+: what is supplied and why. For Level 1: nothing is supplied,
because nothing is missing.]
 */

#include <Arduino.h>

// --- Configuration ---------------------------------------------------------
[Named constants at the top, with the reason for each value in a comment.]

// --- Supplied: [name] -------------------------------------------------------
[Helpers given complete. This is where you put the part that teaches.]

void setup() {
  [Complete, not TODO. `pinMode` every pin before it is used.]
}

void loop() {
  // TODO 1: [one sentence — the first thing to build]
  // TODO 2: [one sentence]
}
```

**Functional Requirements**

- [Observable behaviour, in the order the learner will check it.]
- [Include the exact thresholds and durations. "About a second" is not a
requirement; "8000 ms" is.]
- [State the worst case: maximum LEDs lit, maximum current, maximum rate.]

**Constraints**

- **No `delay()` in `loop()`.** [From Level 2 onward. If a blocking wait is
unavoidable in hardware, say so and name the alternative.]
- [Structural constraint: "exactly one state machine", "one `IO` pin may only be
used once".]
- [Type constraint: "no `String`", "no dynamic allocation".]
- [For Levels 3+: the CPU or bus budget, if it is the point of the exercise.]

#### 6. Verification Checklist & Debugging Tasks

1. **[A measurement, not a feeling. "Meter the pin and confirm 4.98 V" beats
"confirm it works".]**
2. **[Break it on purpose and confirm the behaviour changes.]**
3. **[The counting task: "count ten flashes; it should take about ten seconds".]**

**Simulated Hardware Fault:**

> **Symptom:** [what the learner sees, in their words — not in datasheet words.
"In the finder the LED is dark and the program uploaded fine" beats "the output
stage is not sinking".]

**Diagnosis**

1. **[Most likely and easiest to check, first. Ordered by cost, not by
interest: what can they test in 30 seconds?]
2. **[Next most likely.]
3. **[The one that catches everyone.]
4. **[Only then: suspect the code.]
5. **[What to try that distinguishes two causes.]

**Fix:** [the repair, and what to do so it does not recur.]

**Variant B — [a second, different failure with the same exercise].** [Recommended
for every exercise: the second fault is usually the one a learner hits next.]

#### 7. Noesis Lab Twin

**Wiring:** [board] · `[exact catalogue name]` · [id, header pin order]

[Catalogue names are the strings `src/sim/catalogue.ts` produces — `220 Resistor`,
not `220 Ω Resistor`; `100nF Capacitor`, not `100 nF Capacitor`. Bench prose keeps
normal SI typography; only backticked simulator names change.]

**What this twin verifies faithfully:** [list — the circuit solving, the current,
the API call.]

**What it cannot show, and what you lose:** [list — bounce, interrupts, 5 V
levels, RAM pressure, 400 pF of bus capacitance. Say what the learner must go to
the bench for.]

**A note on this sketch's dialect:** [only if the sketch flattens something — the
interpreter has no structs, enums, pointers, or `const` at file scope.]

```cpp
[Complete sketch, in the restricted dialect. Must be runnable as pasted.]
```
```

---

## Pre-submission checklist

Run this before handing an exercise over. Every line is a thing that has actually
gone wrong.

**Structure**
- [ ] Seven numbered sections, in order, with the exact fixed headings.
- [ ] `Board Pin | Component Terminal | Connects To | Value / Notes` table present.
- [ ] At least one ASCII schematic, fenced `text`, with aligned columns.
- [ ] `**Hardware Gotchas & Safety Rules:**` present and symptom-shaped.
- [ ] `**Simulated Hardware Fault:**` with Symptom / Diagnosis / Fix.

**Level discipline**
- [ ] Three or fewer new concepts, listed in the header.
- [ ] Every new term defined in section 4 before its first use in section 5.
- [ ] Level 1 has **no** `TODO`s anywhere in its code.
- [ ] `delay()` appears only where the level allows, and never in `loop()` from
      Level 2 up.
- [ ] The exit check in [`LEVELS.md`](LEVELS.md) would actually be passable after
      this exercise and only this exercise.

**Hardware honesty**
- [ ] Every LED has its own current-limiting resistor, with the arithmetic shown.
- [ ] Total current stated against the 40 mA per-pin and 200 mA board limits.
- [ ] Pull-ups on every input, and active-LOW noted wherever it applies.
- [ ] Nothing invented: no resistor value, pin number, or register asserted from
      memory without checking.

**Firmware**
- [ ] The scaffold compiles as pasted. Verify it — do not eyeball it.
- [ ] No blocking call in `loop()` from Level 2 up.
- [ ] Wrap-safe time comparisons (`now - last >= SPAN`).
- [ ] No `String`, no dynamic allocation, fixed-size buffers sized in the text.
- [ ] The twin sketch compiles **and runs** in the interpreter.

**Twin**
- [ ] Part names match `src/sim/catalogue.ts` exactly.
- [ ] Limits stated honestly, including what the learner loses.
- [ ] Nothing claimed that the simulator does not model.

---

## Verification, the part that actually matters

Two checks catch most authoring errors, and both are mechanical.

**Compile the sketches.** Every ```cpp block containing `setup()` and `loop()` must
compile. There is no Arduino toolchain in this repo, but a stub header plus
`g++ -fsyntax-only` is enough to catch a missing brace, an undeclared identifier,
and a call that does not exist. Two classes of false positive to suppress: the AVR
`freeRAM()` idiom casts 16-bit pointers to `int`, which is legal on the Uno and only
lossy on a 64-bit host (compile with `-fpermissive`), and `ATOMIC_BLOCK` must be
defined the way avr-libc defines it — as a `for` loop whose hidden variable is the
argument — or valid interrupt-handler code will not parse.

**Run the twin sketch.** A twin sketch that does not parse in
`src/sim/firmware/parser.ts` is a broken promise, and the parser's limits are not
guessable:

| Looks fine | The interpreter's actual limit |
| --- | --- |
| `const byte LED = 8;` at file scope | `const` is a keyword but not a type — **fails** |
| `struct Button { … };` | no structs (`parser.ts:6`) |
| `enum State { A, B };` | no enums — use `#define` |
| `void f(Button &b)` | no reference parameters — pass an index |
| `long a = millis(), b = micros();` | one declarator per declaration |
| `1.0 / 58.1` | `/` truncates like C integer division, so this is **0** |

The last two are the expensive mistakes: both compile, both run, and both fail
silently at runtime with a plausible-looking wrong number.

**Then recompute every number in the prose.** Divider inversions, β conversions,
µs-per-cm, `$t_r = 0.8473 \cdot R_p \cdot C_b$, current budgets, prescaler
arithmetic. Recompute them in a scratch script and compare. Do not trust the
figures you remember — several that look authoritative in this track's own early
drafts were wrong, and a curriculum that teaches a wrong constant teaches it
confidently.
