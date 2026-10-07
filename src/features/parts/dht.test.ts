import { describe, expect, it } from 'vitest';
import { BenchBuilder, type PartInstance } from '@/features/simulation';
import { esp32DevKitV1 } from '@/features/parts';
import { GROUND, type Element } from '@/features/simulation';
import { solveCircuit, type Solution } from '@/features/simulation';
import { DynamicState } from '@/features/parts';
import { buildNetlist } from '@/features/simulation';
import { HUMIDITY_KNOB, dhtDefinition } from './dht';
import { TEMPERATURE_KNOB } from '@/features/parts';
import { renderedSizeMm, wokwiPartFor } from '@/ui/wokwi';

describe('dht definition', () => {
  it('exposes VCC/SDA/NC/GND with climate knobs', () => {
    const def = dhtDefinition();
    expect(def.pins.map((p) => p.id)).toEqual(['VCC', 'SDA', 'NC', 'GND']);
    expect(def.knobs).toEqual([TEMPERATURE_KNOB, HUMIDITY_KNOB]);
    expect([def.widthMm, def.heightMm]).toEqual([15.1, 30.885]);
  });
});

describe('dht selection', () => {
  it('selection box matches the dht artwork', () => {
    const drawn = renderedSizeMm(dhtDefinition());
    expect(drawn.widthMm).toBe(15.1);
    expect(drawn.heightMm).toBe(30.885);
    expect(wokwiPartFor(dhtDefinition())?.tag).toBe('wokwi-dht22');
  });
});

describe('dht pull-up', () => {
  it('idles SDA high through its pull-up', () => {
    const builder = new BenchBuilder();
    const esp32 = builder.addPart(esp32DevKitV1(), 0, 0);
    const dht = builder.addPart(dhtDefinition(), 200, 0);
    const at = (part: PartInstance, pinId: string) => {
      const pin = part.definition.pins.find((p) => p.id === pinId)!;
      return { x: part.x + pin.x, y: part.y + pin.y };
    };
    const join = (a: PartInstance, aPin: string, b: PartInstance, bPin: string) => {
      const pa = at(a, aPin);
      const pb = at(b, bPin);
      builder.addWire(pa.x, pa.y, pb.x, pb.y);
    };
    join(dht, 'VCC', esp32, 'R_3V3');
    join(dht, 'GND', esp32, 'L_GND');
    const netlist = buildNetlist(builder.build(), new DynamicState());
    const elements: Element[] = [
      { kind: 'voltageSource', a: netlist.pinNode.get(`${esp32.id}:R_3V3`)!, b: GROUND, volts: 3.3 },
      ...netlist.elements,
    ];
    const solution: Solution = solveCircuit(elements, { nodeCount: netlist.nodeCount });
    const sda = netlist.pinNode.get(`${dht.id}:SDA`)!;
    expect(sda).not.toBe(GROUND);
    expect(solution.voltages[sda]).toBeGreaterThan(2.8);
  });
});
