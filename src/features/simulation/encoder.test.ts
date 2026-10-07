import { describe, expect, it } from 'vitest';
import { BenchBuilder, type PartInstance } from './bench';
import { esp32DevKitV1 } from '@/sim/boards';
import { GROUND, type Element } from './elements';
import { solveCircuit, type Solution } from './circuit';
import { DynamicState, type KnobSpec, type PartDefinition } from '@/sim/catalog';
import { buildNetlist, type Netlist } from './netlist';
import { DETENT_KNOB, encoderDefinition, quadratureAt } from './encoder';
import { renderedSizeMm, wokwiPartFor } from '@/ui/wokwi';

const SUPPLY_VOLTS = 3.3;

function stripBench(definition: PartDefinition) {
  // No breadboard: the encoder's five header pins share one x column, so
  // seating it in a strip would land every pin in the same 5-hole strip and
  // short them together. Wire power straight across instead.
  const builder = new BenchBuilder();
  const esp32 = builder.addPart(esp32DevKitV1(), 0, 0);
  const module = builder.addPart(definition, 200, 0);

  const world = (part: PartInstance, pinId: string) => {
    const pin = part.definition.pins.find((p) => p.id === pinId)!;
    return { x: part.x + pin.x, y: part.y + pin.y };
  };
  const vcc = world(module, 'VCC');
  const rail = world(esp32, 'R_3V3');
  builder.addWire(vcc.x, vcc.y, rail.x, rail.y);
  const gnd = world(module, 'GND');
  const ground = world(esp32, 'L_GND');
  builder.addWire(gnd.x, gnd.y, ground.x, ground.y);

  const columns = new Map<string, number>();
  const wirePower = (_supplyPin: string | null, _groundPin: string) => {};
  return { builder, esp32, module, columns, wirePower };
}

type ModuleBench = ReturnType<typeof stripBench>;

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

function pinVolts(netlist: Netlist, solution: Solution, module: PartInstance, pinId: string): number {
  const node = netlist.pinNode.get(`${module.id}:${pinId}`);
  if (node === undefined) throw new Error(`${module.id} has no net for pin ${pinId}`);
  return node === GROUND ? 0 : solution.voltages[node];
}

function setKnob(state: DynamicState, module: PartInstance, spec: KnobSpec, value: number) {
  state.setKnob(module.id, spec, value);
}

describe('encoder definition', () => {
  it('exposes CLK/DT/SW/VCC/GND with a detent knob', () => {
    const def = encoderDefinition();
    expect(def.pins.map((p) => p.id)).toEqual(['CLK', 'DT', 'SW', 'VCC', 'GND']);
    expect(DETENT_KNOB.step).toBe(1);
  });
});

describe('encoder selection', () => {
  it('selection box matches the encoder artwork', () => {
    const drawn = renderedSizeMm(encoderDefinition());
    expect(drawn.widthMm).toBe(30.815);
    expect(drawn.heightMm).toBe(18.63);
    expect(wokwiPartFor(encoderDefinition())?.tag).toBe('wokwi-ky-040');
  });
});

describe('encoder quadrature', () => {
  function powered() {
    const bench = stripBench(encoderDefinition());
    return bench;
  }

  it('walks the Gray cycle one state per detent', () => {
    const bench = powered();
    const state = new DynamicState();
    const expected: Array<readonly [number, number]> = [
      [3.3, 3.3],
      [0, 3.3],
      [0, 0],
      [3.3, 0],
    ];
    for (let detent = 0; detent < 4; detent++) {
      setKnob(state, bench.module, DETENT_KNOB, detent);
      const solved = solveBench(bench, state);
      const clk = pinVolts(solved.netlist, solved.solution, bench.module, 'CLK');
      const dt = pinVolts(solved.netlist, solved.solution, bench.module, 'DT');
      expect(clk).toBeGreaterThan(expected[detent][0] > 1 ? 2.8 : -0.5);
      expect(clk).toBeLessThan(expected[detent][0] > 1 ? 3.6 : 0.5);
      expect(dt).toBeGreaterThan(expected[detent][1] > 1 ? 2.8 : -0.5);
      expect(dt).toBeLessThan(expected[detent][1] > 1 ? 3.6 : 0.5);
    }
  });

  it('stays in a valid table state at the knob extremes', () => {
    const bench = powered();
    const state = new DynamicState();
    for (const extreme of [DETENT_KNOB.min, DETENT_KNOB.max]) {
      setKnob(state, bench.module, DETENT_KNOB, extreme);
      const solved = solveBench(bench, state);
      const clk = pinVolts(solved.netlist, solved.solution, bench.module, 'CLK');
      const dt = pinVolts(solved.netlist, solved.solution, bench.module, 'DT');
      const high = (v: number) => v > 2.8;
      expect([high(clk), high(dt)]).toEqual([quadratureAt(extreme)[0] === 1, quadratureAt(extreme)[1] === 1]);
    }
  });

  it('pulls SW low only while held', () => {
    const bench = powered();
    const state = new DynamicState();

    const released = solveBench(bench, state);
    expect(pinVolts(released.netlist, released.solution, bench.module, 'SW')).toBeGreaterThan(2.8);

    state.setPressed(bench.module.id, true);
    const held = solveBench(bench, state);
    expect(pinVolts(held.netlist, held.solution, bench.module, 'SW')).toBeLessThan(0.5);
  });

  it('reads sane finite levels with VCC floating', () => {
    const builder = new BenchBuilder();
    const esp32 = builder.addPart(esp32DevKitV1(), 0, 0);
    const module = builder.addPart(encoderDefinition(), 200, 0);
    const gnd = module.definition.pins.find((p) => p.id === 'GND')!;
    const boardGround = esp32.definition.pins.find((p) => p.id === 'L_GND')!;
    builder.addWire(module.x + gnd.x, module.y + gnd.y, boardGround.x, boardGround.y);
    const bench = { builder, esp32, module, columns: new Map<string, number>(), wirePower: () => {} };
    const state = new DynamicState();
    const solved = solveBench(bench, state);
    for (const pinId of ['CLK', 'DT', 'SW']) {
      const volts = pinVolts(solved.netlist, solved.solution, module, pinId);
      expect(Number.isFinite(volts)).toBe(true);
    }
  });
});
