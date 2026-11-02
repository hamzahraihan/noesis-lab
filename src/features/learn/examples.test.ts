import { describe, expect, it } from 'vitest';
import { Simulation } from '@/features/bench/simulations/simulation';
import { BOARDS, boardOption } from './boardRegistry';
import {
  EXAMPLES,
  I2C_CLOCK_EXAMPLE,
  POTENTIOMETER_EXAMPLE,
  exampleProjectFor,
  exampleSketchFor,
} from './examples';
import { ENTRY_BY_LANGUAGE } from '@/features/simulation';
import { exampleCircuitFor } from './benches';
import { esp32DevKitV1, resistorDefinition } from '@/features/parts';
import { breadboardDefinition } from '@/features/parts';
import type { PartInstance } from '@/features/simulation';

/**
 * The examples, run.
 *
 * An example is a sketch *and* the wiring it needs, so the only thing worth
 * asserting is that the two go together: that a sketch talks to parts that are
 * actually on the bench and actually connected to the board's pins. The wiring
 * is a document now (`benches/`), so each test starts by loading the one its
 * board and id name rather than by calling a builder.
 */
const BOARD = 'esp32';

/** A fresh bench with the example's circuit already loaded. */
function exampleBench(exampleId: string): Simulation {
  const simulation = new Simulation(esp32DevKitV1());
  const doc = exampleCircuitFor(exampleId, BOARD);
  expect(doc, `${exampleId} on ${BOARD}`).not.toBeNull();
  expect(simulation.loadCircuit(doc!)).toEqual([]);
  return simulation;
}

function partNamed(simulation: Simulation, needle: string): PartInstance | undefined {
  return simulation.bench.parts.find((part) => part.definition.name.includes(needle));
}

/**
 * Runs the sketch for a while.
 *
 * `tick` advances simulated time by the delta, so this is the same path the
 * animation frame takes: a few seconds of the firmware doing what it says.
 */
function run(simulation: Simulation, seconds = 2): void {
  for (let frame = 0; frame < seconds * 20; frame++) {
    simulation.start();
    simulation.tick(0.05);
  }
}

describe('the examples', () => {
  /*
   * Every circuit an example ships, on the board it ships for, with the sketch
   * that board's firmware actually reads. A C++ example speaks C++; the Pico
   * and the Nano RP2040 speak MicroPython. Loading one board's language into
   * another is the failure this catches, and it fails on the first line for a
   * reason that has nothing to do with the wiring.
   */
  it.each(EXAMPLES.map((example) => [example.id, example] as const))(
    '%s parses on every board it has',
    (_id, example) => {
      const boards = BOARDS.filter((board) => exampleCircuitFor(example.id, board.id) !== null);
      expect(boards.length, `${example.id} has a board`).toBeGreaterThan(0);

      for (const board of boards) {
        const simulation = new Simulation(board.make());
        const doc = exampleCircuitFor(example.id, board.id)!;
        expect(simulation.loadCircuit(doc), `${example.id} on ${board.id}`).toEqual([]);
        simulation.loadFirmware(exampleProjectFor(example, board.id));
        // A syntax error is reported rather than thrown, so this is the check
        // that an example the VM cannot read never ships.
        expect(simulation.firmwareError, `${example.id} on ${board.id}`).toBeNull();
      }
    },
    60_000,
  );

  it('builds each board’s example in that board’s language', () => {
    /*
     * The bench loads `exampleProjectFor`, so the project's language and its
     * text have to be the same answer. This is the seam the RP2040 clock went
     * through: the circuit and port existed, but the editor built the project
     * from the shared C++ sketch and put it in `main.py`.
     */
    for (const example of EXAMPLES) {
      for (const board of BOARDS) {
        if (exampleCircuitFor(example.id, board.id) === null) continue;
        const project = exampleProjectFor(example, board.id);
        const label = `${example.id} on ${board.id}`;
        expect(project.language, label).toBe(board.language);
        expect(project.activeName, label).toBe(ENTRY_BY_LANGUAGE[board.language]);
        expect(project.files, label).toHaveLength(1);
        expect(project.files[0].content, label).toBe(exampleSketchFor(example, board.id));
      }
    }
  });

  it('wires a clock onto the board I2C pins', () => {
    const simulation = exampleBench('i2c-clock');
    simulation.loadFirmware(EXAMPLES.find((example) => example.id === 'i2c-clock')!.sketch);
    run(simulation);

    const clock = partNamed(simulation, 'DS1307');
    expect(clock).toBeDefined();

    // Wired, not merely placed: the engine asks the device's own SDA and SCL
    // whether they land on the firmware's bus nets, and only then answers.
    expect(simulation.engine.i2cDevice(clock!.id)?.onBus).toBe(true);
    expect(simulation.serialLines().join('\n')).toContain('clock');
  }, 30_000);

  /*
   * A character LCD costs two circuit solves per nibble, so a sketch that fills
   * a screen is a slow one. That is honest -- it is what the panel does -- but it
   * means this test runs the sketch briefly rather than for a screenful.
   */
  it('wires every control line a character LCD needs', () => {
    const simulation = exampleBench('character-lcd');
    simulation.loadFirmware(EXAMPLES.find((example) => example.id === 'character-lcd')!.sketch);

    const lcd = partNamed(simulation, 'LCD 16x2');
    const panel = simulation.engine.lcd(lcd!.id);
    expect(panel).toBeDefined();

    // Six wires, not two: RS, RW, enable and the four data lines, and the glass
    // only says anything if every one of them is on a net the library can drive.
    const netlist = simulation.engine.currentNetlist;
    const lines = ['RS', 'RW', 'E', 'D4', 'D5', 'D6', 'D7'];
    for (const line of lines) {
      const net = netlist.pinNode.get(`${lcd!.id}:${line}`);
      expect(`${line}:${net === undefined ? 'none' : net}`).not.toBe(`${line}:none`);
    }
    run(simulation, 1.5);
    /*
     * The glass only shows what the control lines actually carried, so this
     * asserts what reached the panel rather than what the library meant to
     * send. A character that comes out mangled is a wiring problem the panel
     * can see, which is the whole point of driving it from the nets.
     */
    const rows = panel!
      .text()
      .split('\n')
      .map((row) => row.trim());
    // The sketch writes the clock on the top row and the title beneath it.
    expect(rows[0]).toMatch(/^\d+:\d+:\d+/);
    expect(rows[1]).toContain('noesis bench');
    expect(panel!.lit).toBe(true);
  }, 30_000);

  it('turns a servo between its end stops', () => {
    const simulation = exampleBench('servo');
    simulation.loadFirmware(EXAMPLES.find((example) => example.id === 'servo')!.sketch);

    const horn = partNamed(simulation, 'Servo');
    expect(horn).toBeDefined();
    const model = simulation.engine.servo(horn!.id);
    expect(model).toBeDefined();
    expect(model!.angle).toBe(90);

    // Watch every angle it passes through, since the sweep is a cycle: it ends
    // back at the middle whatever happens.
    const swept = new Set<number>();
    for (let frame = 0; frame < 60; frame++) {
      simulation.start();
      simulation.tick(0.05);
      swept.add(model!.angle);
    }

    // The sketch asks for 10 and 170, which are the stops themselves, and
    // never for 0 or 180, which a hobby servo cannot reach.
    expect(model!.angle).toBeGreaterThanOrEqual(10);
    expect(model!.angle).toBeLessThanOrEqual(170);
    // And it swept rather than sat at the centre: a servo that ignored every
    // command would still pass the range check above, at 90 degrees forever.
    expect(swept).toContain(10);
    expect(swept).toContain(170);
  }, 30_000);

  /*
   * Both boards with an analogue block on the header: the Pico's GP26 and the
   * Nano RP2040's A0 are the same channel behind different silkscreens, so the
   * same MicroPython sketch and the same wiring have to read the same divider.
   */
  it('reads the divider under the knob', () => {
    for (const boardId of ['pico', 'rp2040'] as const) {
      const simulation = new Simulation(boardOption(boardId).make());
      const doc = exampleCircuitFor('potentiometer', boardId);
      expect(doc, `potentiometer on ${boardId}`).not.toBeNull();
      expect(simulation.loadCircuit(doc!)).toEqual([]);
      simulation.loadFirmware(exampleProjectFor(POTENTIOMETER_EXAMPLE, boardId));

      const pot = partNamed(simulation, 'Potentiometer');
      expect(pot, boardId).toBeDefined();
      const knob = pot!.definition.knobs![0];

      /*
       * The wiper is a divider between the two ends, so the two extremes of the
       * knob are the two rails and the middle is half of them. This is the check
       * that the ADC samples the net the wiper is actually on rather than a pin
       * the sketch named.
       */
      const lastLine = () => (simulation.serialLines().at(-1) ?? '').trim();

      simulation.setKnob(pot!.id, knob, 0);
      run(simulation, 1.5);
      const low = lastLine();
      simulation.setKnob(pot!.id, knob, 1);
      run(simulation, 1.5);
      const high = lastLine();
      simulation.setKnob(pot!.id, knob, 0.5);
      run(simulation, 1.5);
      const middle = lastLine();

      // Which end is which depends on how the knob's travel is drawn, so the
      // pair is what matters: one rail and the other, not the same number twice.
      expect([low, high].sort(), boardId).toEqual(['wiper 0%', 'wiper 100%']);
      // Linear in between: half of full scale is half the percentage, which
      // catches a divider that snaps instead of dividing. The two-point gap is
      // the twelve-bit converter's rounding, not a bend in the divider.
      expect(middle, boardId).toMatch(/^wiper (49|50)%$/);
    }
  }, 60_000);

  it('reads the clock on each MicroPython board’s bus', () => {
    for (const boardId of ['pico', 'rp2040'] as const) {
      const simulation = new Simulation(boardOption(boardId).make());
      const doc = exampleCircuitFor('i2c-clock', boardId);
      expect(doc, `i2c-clock on ${boardId}`).not.toBeNull();
      expect(simulation.loadCircuit(doc!)).toEqual([]);
      simulation.loadFirmware(exampleProjectFor(I2C_CLOCK_EXAMPLE, boardId));

      const clock = partNamed(simulation, 'DS1307');
      expect(clock, boardId).toBeDefined();
      // Wired, not merely placed: the DS1307's own SDA and SCL must land on
      // the two nets the board's I2C0 peripheral sits on. On the Nano RP2040
      // Connect those are A4/A5, which firmware reaches only through the
      // internal tie to GPIO12/13.
      expect(simulation.engine.i2cDevice(clock!.id)?.onBus, boardId).toBe(true);

      // The sketch prints once per second via time.sleep(1). With no dynamics
      // in the circuit, each sleep completes in one tick (delay-skip).
      // Three ticks give three printed lines: 00:00:00, 00:00:01, 00:00:02.
      simulation.start();
      simulation.tick(0.05);
      simulation.tick(0.05);
      simulation.tick(0.05);
      const lines = simulation.serialLines().join('\n');
      expect(lines, boardId).toContain('clock online');
      /*
       * The sketch unpacks BCD itself, so a mangled byte would show as a
       * malformed time rather than as a short line. The DS1307's three bytes
       * are seconds, minutes, hours while the printed line is hours first:
       * over two seconds the first two fields must stay zero and the last one
       * must advance. A reversed port printed `02:00:00`, which the old
       * shape-only regex happily accepted.
       */
      const times = lines.split('\n').filter((line) => /^\d\d:\d\d:\d\d$/.test(line));
      expect(times.length, boardId).toBeGreaterThan(0);
      expect(
        times.every((time) => /^00:00:0[0-2]$/.test(time)),
        `${boardId}: ${times.join(', ')}`,
      ).toBe(true);
      expect(times.some((time) => time !== '00:00:00'), boardId).toBe(true);
    }
  }, 60_000);

  it('colours device wires by signal', () => {
    /*
     * Power is red, ground is black, the I2C pair is yellow/green, and signal
     * lines cycle — the Wokwi convention, so a bench wired entirely in red is
     * a thing the suite catches instead of a learner squinting at.
     */
    const simulation = exampleBench('character-lcd');
    const owner = new Map<number, string>();
    for (const part of simulation.bench.parts) {
      for (const [pin, id] of Object.entries(part.terminals)) {
        owner.set(id, `${part.definition.name}:${pin}`);
      }
    }
    const colourOf = (needle: string): string | undefined =>
      simulation.bench.wires.find((wire) =>
        [owner.get(wire.from), owner.get(wire.to)].some((end) => end?.endsWith(needle)),
      )?.colour;
    expect(colourOf(':VCC')).toBe('#ef4444');
    expect(colourOf(':GND')).toBe('#111111');
    expect(colourOf(':VSS')).toBe('#111111');
    expect(colourOf(':SDA')).toBe('#facc15');
    expect(colourOf(':SCL')).toBe('#22c55e');
    expect(new Set(simulation.bench.wires.map((wire) => wire.colour)).size).toBeGreaterThan(4);
  });
});

describe('loading one example replaces the last', () => {
  /*
   * An example is a circuit plus the sketch that assumes it, so loading one
   * replaces the bench rather than adding to it: a part left over from the
   * operator's own circuit, or from the previous example, sitting in the middle
   * of one teaches the wrong thing twice. What makes that safe is the single
   * undo entry `replaceCircuit` records -- both halves are pinned below.
   */
  const lcdDoc = () => exampleCircuitFor('character-lcd', BOARD)!;

  it('leaves one of each module however often it is loaded', () => {
    const simulation = exampleBench('character-lcd');

    for (let round = 0; round < 3; round++) {
      expect(simulation.replaceCircuit(lcdDoc())).toEqual([]);
    }

    const countOf = (needle: string) =>
      simulation.bench.parts.filter((part) => part.definition.name.includes(needle)).length;

    expect(countOf('LCD 16x2')).toBe(1);
    expect(countOf('DS1307')).toBe(1);
  });

  it('keeps the wire count stable across repeated loads', () => {
    const simulation = exampleBench('character-lcd');
    const first = simulation.bench.wires.length;
    expect(first).toBeGreaterThan(0);

    for (let round = 0; round < 3; round++) {
      simulation.replaceCircuit(lcdDoc());
      expect(simulation.bench.wires.length).toBe(first);
    }
  });

  it('discards anything placed by hand, and one undo brings it back', () => {
    const simulation = exampleBench('blink');
    // A resistor: the example's document has none, so its presence is the
    // question, not a part id the next document might reuse.
    simulation.addPart(resistorDefinition(220), 300, 300);
    const hasResistor = () =>
      simulation.bench.parts.some((part) => part.definition.component.kind === 'resistor');

    expect(simulation.replaceCircuit(lcdDoc())).toEqual([]);

    expect(hasResistor()).toBe(false);
    expect(partNamed(simulation, 'LCD 16x2')).toBeDefined();

    // One step, not one per part or per wire: the whole load is recorded once.
    expect(simulation.undo()).toBe(true);
    expect(hasResistor()).toBe(true);
    expect(partNamed(simulation, 'LCD 16x2')).toBeUndefined();
  });

  it('keeps the LCD host driving the panel across a reload', () => {
    const simulation = exampleBench('character-lcd');
    /*
     * A sketch that dims the backlight, because that is the one thing the host
     * drives straight at its panel: a panel's backlight is *on* unless told
     * otherwise, so a host left pointing at a part that has left the bench
     * would leave the new one looking correct by default.
     */
    const dim = 'void setup() { lcd.begin(16, 2); lcd.noBacklight(); } void loop() { }';

    // One frame is enough: the dim happens in setup, and a character-panel
    // bench solves twice per nibble, so a simulated second costs seconds.
    simulation.loadFirmware(dim);
    run(simulation, 0.05);
    expect([...simulation.lcdModels().values()][0]!.backlightOn, 'the sketch can dim it').toBe(
      false,
    );

    // The same document again: the part id is stable, so the engine carries the
    // panel and its controller forward -- the host must still reach it.
    expect(simulation.replaceCircuit(lcdDoc())).toEqual([]);
    simulation.loadFirmware(dim);
    run(simulation, 0.05);
    expect(
      [...simulation.lcdModels().values()][0]!.backlightOn,
      'the panel on the bench is the one being driven',
    ).toBe(false);
  });

  it('leaves the bench holding only the example it last loaded', () => {
    const simulation = exampleBench('blink');

    // What each example is expected to have on the bench once loaded. Blink
    // places nothing of its own -- it drives the LED and both displays the
    // starter bench already has -- so its document is the board and breadboard.
    const expected: ReadonlyArray<readonly [string, readonly string[]]> = [
      ['blink', []],
      ['i2c-clock', ['DS1307']],
      ['character-lcd', ['LCD 16x2', 'DS1307']],
      ['servo', ['Servo']],
    ];

    const onBench = () =>
      simulation.bench.parts
        .map((part) => part.definition.name)
        .filter((name) => name !== esp32DevKitV1().name && name !== breadboardDefinition().name);

    // Twice round, so a leftover from the first pass would show up in the second.
    for (const pass of [1, 2]) {
      for (const [id, modules] of expected) {
        expect(simulation.replaceCircuit(exampleCircuitFor(id, BOARD)!), id).toEqual([]);

        // Exactly the modules this example places: a survivor from an earlier
        // load would make this list longer than it should ever be.
        expect(onBench(), `pass ${pass}, after ${id}`).toHaveLength(modules.length);
        for (const module of modules) {
          expect(partNamed(simulation, module), `pass ${pass}, after ${id}`).toBeDefined();
        }
      }
    }
  });
});
