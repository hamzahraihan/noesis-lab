# Simulation CI - running a project on every push

A project on the bench is a circuit and a sketch. A CI run takes that pair,
runs the simulation headlessly, and says whether the sketch did what the
project says it should.

The simulation underneath the app is plain TypeScript: a circuit, a sketch and
a clock, with no page around it. That is what makes this possible, and it is
the same simulation the browser runs -- not a second implementation of it.

## What a project is

A folder with three files:

```
simulation/
  circuit.json   the circuit, in the form the bench saves
  main.ino       the sketch, in the board's language (main.py for a Python board)
  expect.json    what the run should see
```

`circuit.json` is the document the bench writes when you save a circuit, so a
project that starts on the bench ends up here without being rewritten: copy
the file out of the bench and into the folder.

`expect.json` says what the run expects to see:

```json
{
  "frames": 150,
  "serial": ["blink ready", "tick", "tick"]
}
```

- `frames` -- how long to run. A frame is a sixtieth of a second of simulated
  time, so 150 frames is two and a half seconds. The default is 120.
- `serial` -- lines the serial output has to carry, **in order**. A line
  matches if the output line contains it, so a sketch that logs more than
  this still passes, and a sketch that logs a different order does not.
- `hardware` -- optional assertions about the bench itself: a pin's voltage,
  the current through a pin, an LCD's text, a display pixel, or a stepper's
  shaft. They are checked at the end of the run unless an assertion names a
  frame.

The example in `examples/ci/blink` is a complete project: an LED on pin 13 and
a line in the log every second. `examples/ci/hardware` is the same idea with
hardware assertions: an LED lit from pin 13 and an LCD showing `hardware ok`.

## Checking the hardware

Serial output says what the sketch printed. A hardware assertion says what the
bench did, which is the thing a sketch can get wrong while still printing the
right lines: an LED on the wrong pin, a display that never received its bytes,
a motor that never turned.

```json
{
  "frames": 60,
  "serial": ["hardware ready"],
  "hardware": [
    { "kind": "volts", "part": "p1", "pin": "D13", "min": 4.0 },
    { "kind": "amps", "pin": "D13", "min": 0.001 },
    { "kind": "text", "part": "p4", "contains": "hardware ok" },
    { "kind": "pixel", "part": "p4", "x": 1, "y": 1, "on": true },
    { "kind": "angle", "part": "p6", "degrees": 7.5, "tolerance": 0.6 }
  ]
}
```

Every assertion has a `kind`, and may carry:

- `name` -- what a failure calls it. Defaults to the kind and its target.
- `at` -- the frame to read, counted from one. Defaults to the final frame, so
  an assertion that only cares about the finished state needs nothing here.
  An `at` past `frames` is an error in `expect.json`, not a failed run.

The kinds are:

- `volts` -- `part`, `pin`, and at least one of `min` or `max`, in volts. A
  numeric pin such as `D13` resolves the same way a wire endpoint does.
- `amps` -- `pin` and at least one of `min` or `max`, in amps. This is the
  magnitude of the current through a board pin, whichever way it flows.
- `text` -- `part` and `contains`, the text a character LCD should be showing.
- `pixel` -- `part`, zero-based `x` and `y`, and `on` (`true` or `false`) for a
  display the bench can read dot by dot.
- `angle` -- `part`, `degrees`, and an optional `tolerance` in degrees
  (default `0.5`) for a stepper's shaft.

A failure names the assertion and what the bench actually read, for example:

```
volts p1:D13: expected at least 4 V on p1:D13, saw 0.2 V
text p4: expected p4 to contain "hardware ok", saw "                "
```

Voltage and current assertions need the part or pin to exist; a misspelled pin
fails with `p1:NOPE is not a pin on the circuit` rather than reading zero.

## Running it

The repository ships a reusable workflow. A project calls it:

```yaml
name: Simulation

on: [push, pull_request]

jobs:
  simulate:
    uses: hamzahraihan/noesis-lab/.github/workflows/simulation-ci.yml@main
    with:
      project: simulation
```

That is the whole thing: the workflow checks out the bench, installs it, runs
the project, and fails the build if the sketch did not say what the project
expected. The log carries the simulation's own serial output, so a failure
says what the bench saw.

To run it before you push it anywhere, from a checkout of the bench:

```sh
NOESIS_PROJECT=examples/ci/blink npx vitest run src/features/learn/ci/runner.test.ts
```

## What it checks, and what it does not

It checks the **serial output** and whatever **hardware assertions** the
project declares. Serial is still the default, because a sketch that prints
nothing has nothing to say; hardware assertions are opt-in, because not every
project has a display or a motor, and a bench reading is only meaningful when
the project says which one it means.

Hardware assertions read the same models the app draws: the solved netlist for
voltage, the pin source for current, the LCD controller's DDRAM for text, a
display's pixel buffer for `pixel`, and the stepper model's shaft for `angle`.
They do not re-solve the circuit or run a second simulator. The limits are the
models' own: `text` needs a character LCD, `angle` needs a stepper, and `pixel`
needs a display with a readable per-pixel buffer. A part that cannot answer is
a failed assertion that says so.

The sketch runs on the **interpreter**, because that is the path a machine
without a browser can run: the compiled path needs a HEX built by a toolchain
the workflow would have to fetch, and a project that wants its firmware
compiled should build it in its own workflow and check the HEX there.

## How it is put together

- `src/features/learn/ci/project.ts` reads the folder: the circuit, the
  sketch, the expectations, and the board the circuit names.
- `src/features/learn/ci/assertions.ts` defines the hardware assertion shapes,
  validates `expect.json`, and checks one reading against one assertion. Its
  tests use a mock bench, so failure messages are tested without a simulation.
- `src/features/learn/ci/runner.ts` runs it: the same `Simulation` the app
  drives, ticked frame by frame, sampling hardware assertions at their frames,
  then checking both the bench readings and the serial output.
- `src/features/learn/ci/runner.test.ts` is the entry point the workflow
  runs. It is a test because a test is what a Node process can run here: the
  bench's modules are TypeScript with a path alias, and vitest is what
  resolves them. The test skips itself when no project is named, so the
  bench's own suite is unaffected.
