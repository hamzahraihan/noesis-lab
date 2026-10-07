import { describe, expect, it } from 'vitest';
import { BenchBuilder, type PartInstance } from './bench';
import { esp32DevKitV1 } from '@/features/parts';
import { GROUND, type Element } from './elements';
import { solveCircuit, type Solution } from './circuit';
import { DynamicState } from '@/features/parts';
import { buildNetlist, type Netlist } from './netlist';
import { DISTANCE_KNOB, echoMicroseconds, sonarDefinition } from './sonar';
import { renderedSizeMm, wokwiPartFor } from '@/ui/wokwi';

describe('sonar definition', () => {
  it('exposes VCC/TRIG/ECHO/GND with a distance knob', () => {
    const def = sonarDefinition();
    expect(def.pins.map((p) => p.id)).toEqual(['VCC', 'TRIG', 'ECHO', 'GND']);
    expect([DISTANCE_KNOB.min, DISTANCE_KNOB.max, DISTANCE_KNOB.step, DISTANCE_KNOB.defaultValue]).toEqual([2, 400, 1, 100]);
  });
});

describe('echo math', () => {
  it('converts distance to echo microseconds at 58 per cm', () => {
    expect(echoMicroseconds(2)).toBe(116);
    expect(echoMicroseconds(100)).toBe(5800);
  });
});

function engineFreeBench(wireVcc: boolean) {
  // No breadboard: direct terminal-to-terminal jumpers, so nothing
  // coincides with a strip and shorts.
  const builder = new BenchBuilder();
  const esp32 = builder.addPart(esp32DevKitV1(), 0, 0);
  const sonar = builder.addPart(sonarDefinition(), 200, 0);
  const at = (part: PartInstance, pinId: string) => {
    const pin = part.definition.pins.find((p) => p.id === pinId)!;
    return { x: part.x + pin.x, y: part.y + pin.y };
  };
  const join = (a: PartInstance, aPin: string, b: PartInstance, bPin: string) => {
    const pa = at(a, aPin);
    const pb = at(b, bPin);
    builder.addWire(pa.x, pa.y, pb.x, pb.y);
  };
  if (wireVcc) join(sonar, 'VCC', esp32, 'R_3V3');
  join(sonar, 'GND', esp32, 'L_GND');
  return { builder, esp32, sonar };
}

function solveWith(
  bench: ReturnType<typeof engineFreeBench>,
  measuring: boolean,
): { netlist: Netlist; solution: Solution } {
  const state = new DynamicState();
  const netlist = buildNetlist(
    bench.builder.build(),
    state,
    new Map(),
    measuring ? new Map([[bench.sonar.id, true]]) : new Map(),
  );
  const elements: Element[] = [
    { kind: 'voltageSource', a: netlist.pinNode.get(`${bench.esp32.id}:R_3V3`)!, b: GROUND, volts: 3.3 },
    ...netlist.elements,
  ];
  return { netlist, solution: solveCircuit(elements, { nodeCount: netlist.nodeCount }) };
}

function echoVolts(solved: { netlist: Netlist; solution: Solution }, sonar: PartInstance): number {
  const node = solved.netlist.pinNode.get(`${sonar.id}:ECHO`)!;
  return node === GROUND ? 0 : solved.solution.voltages[node];
}

describe('sonar selection', () => {
  it('selection box matches the sonar artwork', () => {
    const drawn = renderedSizeMm(sonarDefinition());
    expect(drawn.widthMm).toBe(45);
    expect(drawn.heightMm).toBe(25);
    expect(wokwiPartFor(sonarDefinition())?.tag).toBe('wokwi-hc-sr04');
  });
});

describe('echo line', () => {
  it('rests low, drives high while measuring, releases after', () => {
    const bench = engineFreeBench(true);
    expect(echoVolts(solveWith(bench, false), bench.sonar)).toBeLessThan(0.5);
    expect(echoVolts(solveWith(bench, true), bench.sonar)).toBeGreaterThan(2.8);
    expect(echoVolts(solveWith(bench, false), bench.sonar)).toBeLessThan(0.5);
  });

  it('reads sane finite levels with VCC floating', () => {
    const bench = engineFreeBench(false);
    for (const measuring of [false, true]) {
      expect(Number.isFinite(echoVolts(solveWith(bench, measuring), bench.sonar))).toBe(true);
    }
  });
});
