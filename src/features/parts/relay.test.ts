import { describe, expect, it } from 'vitest';
import { BenchBuilder, type PartInstance } from '@/features/simulation';
import { columnX, railRowY, stripRowY, breadboardDefinition } from '@/features/parts';
import { esp32DevKitV1 } from '@/features/parts';
import { McuRuntime } from '@/features/simulation';
import { Engine } from '@/features/simulation';
import { GROUND, type Element } from '@/features/simulation';
import { solveCircuit, type Solution } from '@/features/simulation';
import { DynamicState, type PartDefinition } from '@/features/parts';
import { buildNetlist, type Netlist } from '@/features/simulation';
import { coilEnergized, RELAY_COIL_OHMS, relayDefinition } from './relay';
import { renderedSizeMm, wokwiPartFor } from '@/features/bench/wokwi/wokwi';

const BOARD_ORIGIN_X = 200;
const SUPPLY_VOLTS = 3.3;
const BOTTOM_NEGATIVE_RAIL = 2;

const holeX = (column: number): number => BOARD_ORIGIN_X + columnX(column);
const holeY = (row: number): number => stripRowY(row);

function pinAt(part: { definition: PartDefinition }, id: string) {
  return part.definition.pins.find((pin) => pin.id === id)!;
}

function stripBench(definition: PartDefinition) {
  const builder = new BenchBuilder();
  builder.addPart(breadboardDefinition(), BOARD_ORIGIN_X, 0);
  const esp32 = builder.addPart(esp32DevKitV1(), 0, 0);

  const first = definition.pins[0];
  const module = builder.addPart(definition, holeX(30) - first.x, holeY(4) - first.y);

  const columns = new Map<string, number>();
  for (const [index, pin] of definition.pins.entries()) {
    const column = 40 + index;
    columns.set(pin.id, column);
    const terminal = builder.build().terminals[module.terminals[pin.id]];
    builder.addWire(terminal.x, terminal.y, holeX(column), holeY(4));
  }

  const wirePower = (supplyPin: string | null, groundPin: string) => {
    if (supplyPin) {
      const threeVolt = pinAt(esp32, 'R_3V3');
      builder.addWire(threeVolt.x, threeVolt.y, holeX(columns.get(supplyPin)!), holeY(4));
    }
    const groundColumn = columns.get(groundPin)!;
    builder.addWire(
      holeX(groundColumn),
      holeY(4),
      holeX(groundColumn),
      railRowY(BOTTOM_NEGATIVE_RAIL),
    );
    const ground = pinAt(esp32, 'L_GND');
    builder.addWire(ground.x, ground.y, holeX(groundColumn), railRowY(BOTTOM_NEGATIVE_RAIL));
  };

  return { builder, esp32, module, columns, wirePower };
}

type ModuleBench = ReturnType<typeof stripBench>;

function solveBench(
  bench: ModuleBench,
  state: DynamicState,
  relayEnergized: ReadonlyMap<string, boolean> = new Map(),
  extra?: (netlist: Netlist) => readonly Element[],
): { netlist: Netlist; solution: Solution } {
  const netlist = buildNetlist(bench.builder.build(), state, relayEnergized);
  const elements: Element[] = [
    ...(extra?.(netlist) ?? []),
    {
      kind: 'voltageSource',
      a: netlist.pinNode.get(`${bench.esp32.id}:R_3V3`)!,
      b: GROUND,
      volts: SUPPLY_VOLTS,
    },
    ...netlist.elements,
  ];
  return { netlist, solution: solveCircuit(elements, { nodeCount: netlist.nodeCount }) };
}

function pinVolts(
  netlist: Netlist,
  solution: Solution,
  module: PartInstance,
  pinId: string,
): number {
  const node = netlist.pinNode.get(`${module.id}:${pinId}`);
  if (node === undefined) throw new Error(`${module.id} has no net for pin ${pinId}`);
  return node === GROUND ? 0 : solution.voltages[node];
}

function drive(netlist: Netlist, key: string, volts: number): Element {
  return { kind: 'voltageSource', a: netlist.pinNode.get(key)!, b: GROUND, volts };
}

describe('relay definition', () => {
  it('exposes two poles and one coil across eight pins', () => {
    const def = relayDefinition();
    expect(def.pins.map((p) => p.id)).toEqual([
      'NO2',
      'NC2',
      'P2',
      'COIL-',
      'NO1',
      'NC1',
      'P1',
      'COIL+',
    ]);
    expect(def.widthMm).toBe(21);
    expect(def.heightMm).toBe(10);
    expect(RELAY_COIL_OHMS).toBe(70);
  });
});

describe('relay under firmware control', () => {
  function engineBench() {
    // No breadboard: direct terminal-to-terminal jumpers, so nothing
    // coincides with a strip and shorts.
    const builder = new BenchBuilder();
    const esp32 = builder.addPart(esp32DevKitV1(), 0, 0);
    const relay = builder.addPart(relayDefinition(), 200, 0);
    const at = (part: PartInstance, pinId: string) => {
      const pin = part.definition.pins.find((p) => p.id === pinId)!;
      return { x: part.x + pin.x, y: part.y + pin.y };
    };
    const wire = (a: PartInstance, aPin: string, b: PartInstance, bPin: string) => {
      const pa = at(a, aPin);
      const pb = at(b, bPin);
      builder.addWire(pa.x, pa.y, pb.x, pb.y);
    };
    wire(esp32, 'R_D2', relay, 'COIL+');
    wire(esp32, 'L_GND', relay, 'COIL-');
    wire(esp32, 'R_3V3', relay, 'NO1');
    wire(esp32, 'L_GND', relay, 'NC1');
    const mcu = new McuRuntime(esp32.definition);
    const engine = new Engine({ bench: builder.build(), mcu });
    engine.rebuild();
    return { engine, mcu, relay };
  }

  function poleVolts(engine: Engine, relay: PartInstance, pinId: string): number {
    const net = engine.currentNetlist.pinNode.get(`${relay.id}:${pinId}`)!;
    return engine.voltageOfNet(net);
  }

  it('throws the pole from firmware within two settles', () => {
    const { engine, mcu, relay } = engineBench();
    mcu.setDirection(2, 'output');

    mcu.writeDigital(2, false, engine.timeMs);
    engine.settle();
    engine.settle();
    expect(poleVolts(engine, relay, 'P1')).toBeLessThan(0.5);

    mcu.writeDigital(2, true, engine.timeMs);
    engine.settle();
    engine.settle();
    expect(poleVolts(engine, relay, 'P1')).toBeGreaterThan(2.8);
  });

  it('rests on NC with the coil unwired', () => {
    const builder = new BenchBuilder();
    const esp32 = builder.addPart(esp32DevKitV1(), 0, 0);
    const relay = builder.addPart(relayDefinition(), 200, 0);
    const at = (part: PartInstance, pinId: string) => {
      const pin = part.definition.pins.find((p) => p.id === pinId)!;
      return { x: part.x + pin.x, y: part.y + pin.y };
    };
    const join = (a: PartInstance, aPin: string, b: PartInstance, bPin: string) => {
      const pa = at(a, aPin);
      const pb = at(b, bPin);
      builder.addWire(pa.x, pa.y, pb.x, pb.y);
    };
    join(relay, 'NO1', esp32, 'R_3V3');
    join(relay, 'NC1', esp32, 'L_GND');
    const mcu = new McuRuntime(esp32.definition);
    const engine = new Engine({ bench: builder.build(), mcu });
    engine.rebuild();
    engine.settle();
    engine.settle();
    expect(poleVolts(engine, relay, 'P1')).toBeLessThan(0.5);
  });
});
describe('relay selection', () => {
  it('selection box matches the relay artwork', () => {
    const drawn = renderedSizeMm(relayDefinition());
    expect(drawn.widthMm).toBe(21);
    expect(drawn.heightMm).toBe(10);
    expect(wokwiPartFor(relayDefinition())?.tag).toBe('wokwi-ks2e-m-dc5');
  });
});
describe('relay coil threshold', () => {
  it('pulls in on direct GPIO drive and rests below threshold', () => {
    expect(coilEnergized(0)).toBe(false);
    expect(coilEnergized(1.0)).toBe(false);
    // A 3.3 V pin sags to ~2.1 V through its output impedance into 70 ohm.
    expect(coilEnergized(2.1)).toBe(true);
    expect(coilEnergized(3.3)).toBe(true);
    expect(coilEnergized(5)).toBe(true);
  });
});

describe('relay contacts', () => {
  it('rests pole on NC and flips to NO when energized, per pole', () => {
    const bench = stripBench(relayDefinition());
    const state = new DynamicState();
    const id = bench.module.id;
    const extra = (netlist: Netlist) => [
      drive(netlist, `${id}:NO1`, 3.3),
      drive(netlist, `${id}:NC1`, 0),
      drive(netlist, `${id}:NO2`, 0),
      drive(netlist, `${id}:NC2`, 3.3),
    ];

    const resting = solveBench(bench, state, new Map(), extra);
    expect(pinVolts(resting.netlist, resting.solution, bench.module, 'P1')).toBeLessThan(0.5);
    expect(pinVolts(resting.netlist, resting.solution, bench.module, 'P2')).toBeGreaterThan(2.8);

    const energized = solveBench(bench, state, new Map([[id, true]]), extra);
    expect(pinVolts(energized.netlist, energized.solution, bench.module, 'P1')).toBeGreaterThan(
      2.8,
    );
    expect(pinVolts(energized.netlist, energized.solution, bench.module, 'P2')).toBeLessThan(0.5);
  });

  it('never shorts NO to NC', () => {
    const bench = stripBench(relayDefinition());
    const state = new DynamicState();
    const id = bench.module.id;
    const extra = (netlist: Netlist) => [
      drive(netlist, `${id}:NO1`, 3.3),
      drive(netlist, `${id}:NC1`, 0),
    ];
    for (const energized of [false, true]) {
      const solved = solveBench(bench, state, new Map([[id, energized]]), extra);
      // Driven pins keep their own levels: no path between NO and NC.
      expect(pinVolts(solved.netlist, solved.solution, bench.module, 'NO1')).toBeCloseTo(3.3, 1);
      expect(pinVolts(solved.netlist, solved.solution, bench.module, 'NC1')).toBeCloseTo(0, 1);
    }
  });
});
