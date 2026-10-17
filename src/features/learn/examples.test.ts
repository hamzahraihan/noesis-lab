import { describe, expect, it } from 'vitest';
import { Simulation } from '@/features/bench/simulations/simulation';
import { EXAMPLES, I2C_CLOCK_EXAMPLE, LCD_EXAMPLE, SERVO_EXAMPLE } from './examples';
import { esp32DevKitV1 } from '@/features/parts';
import { breadboardDefinition } from '@/features/parts';
import type { PartInstance } from '@/features/simulation';

/**
 * The examples, run.
 *
 * An example is a sketch *and* the wiring it needs, so the only thing worth
 * asserting is that the two go together: that a sketch talks to parts that are
 * actually on the bench and actually connected to the board's pins. An example
 * that reads nothing is indistinguishable from a broken API, which is the whole
 * failure these tests exist to catch.
 */
/**
 * A bench with a board and a breadboard on it.
 *
 * The `Simulation` constructor takes the board's *definition* for its pin model
 * but does not place it, because an example has to be able to add to a bench
 * the app already built rather than replace it. So the parts go down here.
 */
function bench() {
  const created = new Simulation(esp32DevKitV1());
  created.addPart(esp32DevKitV1(), 0, 0);
  created.addPart(breadboardDefinition(), 230, 0);
  return created;
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
  it.each(EXAMPLES.map((example) => [example.id, example] as const))(
    '%s parses as a sketch',
    (_id, example) => {
      const simulation = bench();
      example.wire(simulation);
      simulation.loadFirmware(example.sketch);

      // A syntax error is reported rather than thrown, so this is the check
      // that an example the VM cannot read never ships.
      expect(simulation.firmwareError).toBeNull();
    },
  );

  it('wires a clock onto the board I2C pins', () => {
    const simulation = bench();
    I2C_CLOCK_EXAMPLE.wire(simulation);
    simulation.loadFirmware(I2C_CLOCK_EXAMPLE.sketch);
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
    const simulation = bench();
    LCD_EXAMPLE.wire(simulation);
    simulation.loadFirmware(LCD_EXAMPLE.sketch);

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
    const rows = panel!.text().split('\n').map((row) => row.trim());
    // The sketch writes the clock on the top row and the title beneath it.
    expect(rows[0]).toMatch(/^\d+:\d+:\d+/);
    expect(rows[1]).toContain('noesis bench');
    expect(panel!.lit).toBe(true);
  }, 30_000);

  it('turns a servo between its end stops', () => {
    const simulation = bench();
    SERVO_EXAMPLE.wire(simulation);
    simulation.loadFirmware(SERVO_EXAMPLE.sketch);

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

  it('colours device wires by signal', () => {
    /*
     * Power is red, ground is black, the I2C pair is yellow/green, and signal
     * lines cycle — the Wokwi convention, so a bench wired entirely in red is
     * a thing the suite catches instead of a learner squinting at.
     */
    const simulation = bench();
    LCD_EXAMPLE.wire(simulation);
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
   * undo entry `replaceBench` records -- both halves are pinned below.
   */
  it('leaves one of each module however often it is loaded', () => {
    const simulation = bench();

    for (let round = 0; round < 3; round++) {
      simulation.replaceBench(LCD_EXAMPLE.wire);
    }

    const countOf = (needle: string) =>
      simulation.bench.parts.filter((part) => part.definition.name.includes(needle)).length;

    expect(countOf('LCD 16x2')).toBe(1);
    expect(countOf('DS1307')).toBe(1);
  });

  it('keeps the wire count stable across repeated loads', () => {
    const simulation = bench();

    simulation.replaceBench(LCD_EXAMPLE.wire);
    const first = simulation.bench.wires.length;
    expect(first).toBeGreaterThan(0);

    for (let round = 0; round < 3; round++) {
      simulation.replaceBench(LCD_EXAMPLE.wire);
      expect(simulation.bench.wires.length).toBe(first);
    }
  });

  it('discards anything placed by hand, and one undo brings it back', () => {
    const simulation = bench();
    const mine = simulation.addPart(esp32DevKitV1(), 300, 300);

    simulation.replaceBench(LCD_EXAMPLE.wire);

    expect(simulation.bench.parts.map((part) => part.id)).not.toContain(mine.id);
    expect(partNamed(simulation, 'LCD 16x2')).toBeDefined();

    // One step, not one per part or per wire: the whole load is recorded once.
    expect(simulation.undo()).toBe(true);
    expect(simulation.bench.parts.map((part) => part.id)).toContain(mine.id);
    expect(partNamed(simulation, 'LCD 16x2')).toBeUndefined();
    expect(partNamed(simulation, 'Solderless Breadboard')).toBeDefined();
  });

  it('binds the LCD host to the panel that is on the bench now', () => {
    const simulation = bench();
    /*
     * A sketch that dims the backlight, because that is the one thing the host
     * drives straight at its panel: a panel's backlight is *on* unless told
     * otherwise, so a stale host dimming a part that has left the bench would
     * leave the new one looking correct by default.
     */
    const dim = 'void setup() { lcd.begin(16, 2); lcd.noBacklight(); } void loop() { }';

    simulation.replaceBench(LCD_EXAMPLE.wire);
    const firstId = [...simulation.lcdModels().keys()][0];
    expect(firstId, 'the example put a panel on the bench').toBeDefined();
    simulation.loadFirmware(dim);
    run(simulation, 1);
    expect([...simulation.lcdModels().values()][0]!.backlightOn, 'the sketch can dim it').toBe(false);

    // Loading the example again replaces that panel with an identical one: the
    // part is new, so any host object wrapped around the old one is stale.
    simulation.replaceBench(LCD_EXAMPLE.wire);
    const secondId = [...simulation.lcdModels().keys()][0];
    expect(secondId).not.toBe(firstId);

    simulation.loadFirmware(dim);
    run(simulation, 1);
    expect(
      [...simulation.lcdModels().values()][0]!.backlightOn,
      'the panel on the bench is the one being driven',
    ).toBe(false);
  });

  it('leaves the bench holding only the example it last loaded', () => {
    const simulation = bench();

    // What each example is expected to have on the bench once loaded. Blink
    // places nothing of its own -- it drives the LED and both displays the
    // app already built -- so it expects the board and breadboard alone.
    const expected: ReadonlyArray<readonly [string, readonly string[]]> = [
      ['blink', []],
      ['i2c-clock', ['DS1307']],
      ['character-lcd', ['LCD 16x2', 'DS1307']],
      ['servo', ['Servo']],
    ];

    const onBench = () => simulation.bench.parts
      .map((part) => part.definition.name)
      .filter((name) => name !== esp32DevKitV1().name && name !== breadboardDefinition().name);

    // Twice round, so a leftover from the first pass would show up in the second.
    for (const pass of [1, 2]) {
      for (const [id, modules] of expected) {
        const example = EXAMPLES.find((candidate) => candidate.id === id);
        if (!example) throw new Error(`no example ${id}`);

        simulation.replaceBench(example.wire);

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