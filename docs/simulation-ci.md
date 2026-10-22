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

The example in `examples/ci/blink` is a complete project: an LED on pin 13 and
a line in the log every second.

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

It checks the **serial output**, because that is the one observable every
project has: a sketch that prints nothing has nothing to say, and a project
that expects a line has said what it wanted. The glass, the LEDs and the
shaft are not read -- a project that wants those checked needs an assertion
of its own, and the serial output is where a sketch says what it saw.

The sketch runs on the **interpreter**, because that is the path a machine
without a browser can run: the compiled path needs a HEX built by a toolchain
the workflow would have to fetch, and a project that wants its firmware
compiled should build it in its own workflow and check the HEX there.

## How it is put together

- `src/features/learn/ci/project.ts` reads the folder: the circuit, the
  sketch, the expectations, and the board the circuit names.
- `src/features/learn/ci/runner.ts` runs it: the same `Simulation` the app
  drives, ticked frame by frame, and then the expectations are checked
  against what came out of the serial port.
- `src/features/learn/ci/runner.test.ts` is the entry point the workflow
  runs. It is a test because a test is what a Node process can run here: the
  bench's modules are TypeScript with a path alias, and vitest is what
  resolves them. The test skips itself when no project is named, so the
  bench's own suite is unaffected.
