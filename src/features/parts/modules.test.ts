import { describe, expect, it } from 'vitest';
import { BenchBuilder, type PartInstance } from '@/features/simulation';
import { columnX, railRowY, stripRowY, breadboardDefinition } from './breadboard';
import { esp32DevKitV1 } from './boards';
import { GROUND, type Element } from '@/features/simulation';
import { elementCurrent, solveCircuit, type Solution } from '@/features/simulation';
import { DynamicState, type KnobSpec, type PartDefinition } from './catalog';
import { buildNetlist, type Netlist } from '@/features/simulation';
import {
  buzzerDefinition,
  COMPARATOR_THRESHOLD_KNOB,
  HORIZONTAL_KNOB,
  joystickDefinition,
  LIGHT_KNOB,
  photoresistorDefinition,
  rgbLedDefinition,
  sevenSegmentDefinition,
  SLIDE_POSITION_KNOB,
  slideSwitchDefinition,
  TEMPERATURE_KNOB,
  thermistorDefinition,
  TILTED_KNOB,
  tiltSwitchDefinition,
} from './modules';

/** Breadboard origin, kept clear of the board so the two never overlap. */
const BOARD_ORIGIN_X = 200;

/** The board's rail, so a module can be powered the way the engine powers it. */
const SUPPLY_VOLTS = 3.3;

const holeX = (column: number): number => BOARD_ORIGIN_X + columnX(column);
const holeY = (row: number): number => stripRowY(row);

/** Rail 2 is the bottom negative rail. */
const BOTTOM_NEGATIVE_RAIL = 2;

/** World position of a named pin on a part placed at the origin. */
function pinAt(part: { definition: PartDefinition }, id: string) {
  return part.definition.pins.find((pin) => pin.id === id)!;
}

/**
 * A module wired the way one is on a real bench: header in the strip, and a
 * jumper from every pin out to its own column of the breadboard.
 *
 * The columns are handed back so a test can reach the same net again through
 * the board rather than through the part.
 */
function stripBench(definition: PartDefinition) {
  const builder = new BenchBuilder();
  builder.addPart(breadboardDefinition(), BOARD_ORIGIN_X, 0);
  const esp32 = builder.addPart(esp32DevKitV1(), 0, 0);

  // The header sits in the strip block, whose rows run 0 to 4: a part with a
  // vertical header has to start high enough that its last pin stays on the
  // board rather than landing on the power rails below it.
  const first = definition.pins[0];
  const module = builder.addPart(definition, holeX(30) - first.x, holeY(4) - first.y);

  const columns = new Map<string, number>();
  for (const [index, pin] of definition.pins.entries()) {
    const column = 40 + index;
    columns.set(pin.id, column);
    const terminal = builder.build().terminals[module.terminals[pin.id]];
    builder.addWire(terminal.x, terminal.y, holeX(column), holeY(4));
  }

  /**
   * Runs the board's own 3V3 and ground plane out to a module's columns: the
   * supply across to the module's rail, and the module's ground down to the
   * breadboard's ground rail. A strip column is not the ground rail until a
   * jumper says so.
   */
  const wirePower = (supplyPin: string | null, groundPin: string) => {
    if (supplyPin) {
      const threeVolt = pinAt(esp32, 'R_3V3');
      builder.addWire(threeVolt.x, threeVolt.y, holeX(columns.get(supplyPin)!), holeY(4));
    }
    const groundColumn = columns.get(groundPin)!;
    builder.addWire(holeX(groundColumn), holeY(4), holeX(groundColumn), railRowY(BOTTOM_NEGATIVE_RAIL));
    const ground = pinAt(esp32, 'L_GND');
    builder.addWire(ground.x, ground.y, holeX(groundColumn), railRowY(BOTTOM_NEGATIVE_RAIL));
  };

  return { builder, esp32, module, columns, wirePower };
}

type ModuleBench = ReturnType<typeof stripBench>;

/**
 * Solves a bench the way the engine does, with the board's regulator holding
 * its rail up. `extra` supplies anything else a test wants driven.
 */
function solveBench(
  bench: ModuleBench,
  state: DynamicState,
  extra?: (netlist: Netlist) => readonly Element[],
): { netlist: Netlist; solution: Solution } {
  const netlist = buildNetlist(bench.builder.build(), state);
  const elements: Element[] = [
    ...(extra?.(netlist) ?? []),
    { kind: 'voltageSource', a: netlist.pinNode.get(`${bench.esp32.id}:R_3V3`)!, b: GROUND, volts: SUPPLY_VOLTS },
    ...netlist.elements,
  ];
  return { netlist, solution: solveCircuit(elements, { nodeCount: netlist.nodeCount }) };
}

/** Volts standing on one of a module's pins. */
function pinVolts(netlist: Netlist, solution: Solution, module: PartInstance, pinId: string): number {
  const node = netlist.pinNode.get(`${module.id}:${pinId}`);
  if (node === undefined) throw new Error(`${module.id} has no net for pin ${pinId}`);
  return node === GROUND ? 0 : solution.voltages[node];
}

/** Moves one of a part's controls. */
function setKnob(state: DynamicState, module: PartInstance, spec: KnobSpec, value: number) {
  state.setKnob(module.id, spec, value);
}

describe('photoresistor module', () => {
  function lightModule() {
    const bench = stripBench(photoresistorDefinition());
    bench.wirePower('VCC', 'GND');
    return bench;
  }

  it('raises its analog output as the light gets brighter', () => {
    const bench = lightModule();
    const state = new DynamicState();

    setKnob(state, bench.module, LIGHT_KNOB, 0);
    const dark = solveBench(bench, state);
    const darkVolts = pinVolts(dark.netlist, dark.solution, bench.module, 'AO');

    setKnob(state, bench.module, LIGHT_KNOB, 1000);
    const bright = solveBench(bench, state);
    const brightVolts = pinVolts(bright.netlist, bright.solution, bench.module, 'AO');

    // The sensor's resistance falls with light, so the divider it forms with
    // the module's fixed resistor rises: near-dark below a volt, daylight above.
    expect(darkVolts).toBeLessThan(1);
    expect(brightVolts).toBeGreaterThan(2);
  });

  it('pulls its digital output down until the light passes the trimmer', () => {
    const bench = lightModule();
    const state = new DynamicState();

    setKnob(state, bench.module, LIGHT_KNOB, 1000);
    const bright = solveBench(bench, state);
    expect(pinVolts(bright.netlist, bright.solution, bench.module, 'DO')).toBeGreaterThan(2);

    setKnob(state, bench.module, LIGHT_KNOB, 0);
    const dark = solveBench(bench, state);
    expect(pinVolts(dark.netlist, dark.solution, bench.module, 'DO')).toBeLessThan(1);
  });

  it('moves the trip point when the trimmer is turned', () => {
    const bench = lightModule();
    const state = new DynamicState();
    // Light enough to pass a trimmer at mid travel, but not one at 90%.
    setKnob(state, bench.module, LIGHT_KNOB, 300);
    setKnob(state, bench.module, COMPARATOR_THRESHOLD_KNOB, 50);
    const tripped = solveBench(bench, state);
    expect(pinVolts(tripped.netlist, tripped.solution, bench.module, 'DO')).toBeLessThan(1);

    setKnob(state, bench.module, COMPARATOR_THRESHOLD_KNOB, 90);
    const held = solveBench(bench, state);
    expect(pinVolts(held.netlist, held.solution, bench.module, 'DO')).toBeGreaterThan(2);
  });
});

describe('thermistor module', () => {
  it('raises its output as it warms, because an NTC falls with temperature', () => {
    const bench = stripBench(thermistorDefinition());
    bench.wirePower('VCC', 'GND');
    const state = new DynamicState();

    const outputAt = (celsius: number): number => {
      setKnob(state, bench.module, TEMPERATURE_KNOB, celsius);
      const solved = solveBench(bench, state);
      return pinVolts(solved.netlist, solved.solution, bench.module, 'OUT');
    };

    // At its rated 10 k the divider sits at half the supply, so the figure is
    // one the datasheet can be checked against.
    expect(outputAt(25)).toBeCloseTo(SUPPLY_VOLTS / 2, 2);
    expect(outputAt(0)).toBeLessThan(outputAt(25));
    expect(outputAt(100)).toBeGreaterThan(outputAt(25));
  });
});

describe('tilt switch module', () => {
  it('reads high when level and low once tilted, on the board pull-up', () => {
    const bench = stripBench(tiltSwitchDefinition());
    bench.wirePower('VCC', 'GND');
    const state = new DynamicState();

    const level = solveBench(bench, state);
    expect(pinVolts(level.netlist, level.solution, bench.module, 'OUT')).toBeGreaterThan(2);

    setKnob(state, bench.module, TILTED_KNOB, 1);
    const tilted = solveBench(bench, state);
    expect(pinVolts(tilted.netlist, tilted.solution, bench.module, 'OUT')).toBeLessThan(0.5);
  });
});

describe('slide switch', () => {
  it('throws the common leg to one end or the other, never both', () => {
    const bench = stripBench(slideSwitchDefinition());
    // The switch has no supply of its own, so pin 3 is fed from the rail and
    // pin 1 is left on ground: the throw shows up as which leg follows pin 3.
    bench.wirePower('3', '1');
    const state = new DynamicState();

    // The knob names the throw, not the supply: thrown to pin 1 puts the common
    // leg on ground, and thrown to pin 3 puts it on the rail.
    const commonLeg = (): number => {
      const solved = solveBench(bench, state);
      return pinVolts(solved.netlist, solved.solution, bench.module, '2');
    };

    setKnob(state, bench.module, SLIDE_POSITION_KNOB, 1);
    expect(commonLeg()).toBeLessThan(0.5);

    setKnob(state, bench.module, SLIDE_POSITION_KNOB, 0);
    expect(commonLeg()).toBeGreaterThan(3);
  });
});

describe('analog joystick', () => {
  function stick() {
    const bench = stripBench(joystickDefinition());
    bench.wirePower('VCC', 'GND');
    return bench;
  }

  it('reads each axis as a fraction of the supply across it', () => {
    const bench = stick();
    const state = new DynamicState();

    // The stick's far end reads high, so three-quarters of the travel is three
    // quarters of the supply.
    setKnob(state, bench.module, HORIZONTAL_KNOB, 0.75);
    const threeQuarters = solveBench(bench, state);
    expect(
      pinVolts(threeQuarters.netlist, threeQuarters.solution, bench.module, 'HORZ'),
    ).toBeCloseTo(SUPPLY_VOLTS * 0.75, 2);

    setKnob(state, bench.module, HORIZONTAL_KNOB, 0);
    const back = solveBench(bench, state);
    expect(pinVolts(back.netlist, back.solution, bench.module, 'HORZ')).toBeCloseTo(0, 2);
  });

  it('pulls the select line down only while the stick is held', () => {
    const bench = stick();
    const state = new DynamicState();

    const released = solveBench(bench, state);
    expect(pinVolts(released.netlist, released.solution, bench.module, 'SEL')).toBeGreaterThan(2);

    state.setPressed(bench.module.id, true);
    const held = solveBench(bench, state);
    expect(pinVolts(held.netlist, held.solution, bench.module, 'SEL')).toBeLessThan(0.5);
  });
});

describe('rgb led', () => {
  it('lights only the channel that is driven, on one shared cathode', () => {
    const bench = stripBench(rgbLedDefinition());
    // A five-pin-wide package would need the other two channels driven too;
    // this one shares the cathode with the board's ground, as a sketch wires it.
    bench.wirePower(null, 'common');
    const state = new DynamicState();

    const channel = (pinId: string, volts: number) => (netlist: Netlist): Element => ({
      kind: 'voltageSource',
      a: netlist.pinNode.get(`${bench.module.id}:${pinId}`)!,
      b: GROUND,
      volts,
    });

    const { netlist, solution } = solveBench(bench, state, (built) => [
      channel('red', SUPPLY_VOLTS)(built),
      channel('green', 0)(built),
      channel('blue', 0)(built),
    ]);
    expect(solution.converged).toBe(true);

    const currentInto = (pinId: string): number => {
      const anode = netlist.pinNode.get(`${bench.module.id}:${pinId}`)!;
      const cathode = netlist.pinNode.get(`${bench.module.id}:common`)!;
      const diode = netlist.elements.find(
        (element) => element.kind === 'diode' && element.a === anode && element.b === cathode,
      );
      return diode ? elementCurrent(diode, solution) : 0;
    };

    expect(currentInto('red')).toBeGreaterThan(0.001);
    expect(currentInto('green')).toBeLessThan(1e-9);
    expect(currentInto('blue')).toBeLessThan(1e-9);
  });
});

describe('piezo buzzer', () => {
  it('draws nothing once the edge that started it has passed', () => {
    const bench = stripBench(buzzerDefinition());
    bench.wirePower(null, 'negative');
    const state = new DynamicState();

    const { netlist, solution } = solveBench(bench, state, (built) => [
      {
        kind: 'voltageSource',
        a: built.pinNode.get(`${bench.module.id}:positive`)!,
        b: GROUND,
        volts: SUPPLY_VOLTS,
      },
    ]);

    // A piezo disc is a capacitor, so on steady DC it passes only the leakage
    // across its own insulation -- which is what stops a held pin sounding.
    const piezo = netlist.elements.find((element) => element.kind === 'capacitor');
    expect(piezo).toBeDefined();
    expect(Math.abs(elementCurrent(piezo!, solution))).toBeLessThan(5e-6);
  });
});

describe('7-segment display', () => {
  it('expands from one digit to four, with a common per digit', () => {
    const one = sevenSegmentDefinition(1);
    expect(one.id).toBe('7segment');
    expect(one.pins.map((pin) => pin.id)).toContain('COM.1');

    for (const digits of [2, 3, 4] as const) {
      const definition = sevenSegmentDefinition(digits);
      expect(definition.id).toBe(`7segment-${digits}digit`);
      expect(definition.component).toEqual({ kind: '7segment', digits });
      for (let d = 1; d <= digits; d++) {
        expect(definition.pins.map((pin) => pin.id)).toContain(`DIG${d}`);
      }
      // One shared set of eight segment lines, however many digits.
      for (const segment of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'DP']) {
        expect(definition.pins.map((pin) => pin.id)).toContain(segment);
      }
    }
  });

  it('clamps the digit count into the Wokwi element\u2019s range', () => {
    expect(sevenSegmentDefinition(0).id).toBe('7segment');
    expect(sevenSegmentDefinition(9).id).toBe('7segment-4digit');
  });

  it('stamps one diode per segment per digit', () => {
    for (const digits of [1, 2, 4] as const) {
      const builder = new BenchBuilder();
      builder.addPart(sevenSegmentDefinition(digits), 0, 0);
      const netlist = buildNetlist(builder.build(), new DynamicState());
      const diodes = netlist.elements.filter((element) => element.kind === 'diode');
      // Eight segments, each tied to every digit common on the part.
      expect(diodes.length).toBe(digits * 8);
    }
  });
});
