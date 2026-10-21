import { describe, expect, it } from 'vitest';
import { BenchBuilder, type PartInstance } from '@/features/simulation';
import { esp32DevKitV1 } from '@/features/parts';
import { GROUND, type Element } from '@/features/simulation';
import { solveCircuit, type Solution } from '@/features/simulation';
import { DynamicState } from '@/features/parts';
import { buildNetlist } from '@/features/simulation';
import { renderedSizeMm, wokwiPartFor } from '@/features/bench/wokwi/wokwi';
import { DS18B20_TEMPERATURE_KNOB, ds18b20Definition } from './ds18b20';

describe('ds18b20 definition', () => {
  it('exposes GND/DQ/VCC with a temperature knob', () => {
    const def = ds18b20Definition();
    expect(def.pins.map((p) => p.id)).toEqual(['GND', 'DQ', 'VCC']);
    expect(def.knobs).toEqual([DS18B20_TEMPERATURE_KNOB]);
    expect([def.widthMm, def.heightMm]).toEqual([12.7, 12.7]);
  });

  it('is the bench\u2019s own drawing, with no element behind it', () => {
    // Wokwi's library has no element for a one-wire sensor, so the bench
    // draws the module itself and the selection box follows the definition.
    expect(wokwiPartFor(ds18b20Definition())).toBeNull();
    const drawn = renderedSizeMm(ds18b20Definition());
    expect(drawn.widthMm).toBe(12.7);
    expect(drawn.heightMm).toBe(12.7);
  });
});

describe('ds18b20 pull-up', () => {
  it('idles DQ high through its pull-up', () => {
    const builder = new BenchBuilder();
    const esp32 = builder.addPart(esp32DevKitV1(), 0, 0);
    const sensor = builder.addPart(ds18b20Definition(), 200, 0);
    const at = (part: PartInstance, pinId: string) => {
      const pin = part.definition.pins.find((p) => p.id === pinId)!;
      return { x: part.x + pin.x, y: part.y + pin.y };
    };
    const join = (a: PartInstance, aPin: string, b: PartInstance, bPin: string) => {
      const pa = at(a, aPin);
      const pb = at(b, bPin);
      builder.addWire(pa.x, pa.y, pb.x, pb.y);
    };
    join(sensor, 'VCC', esp32, 'R_3V3');
    join(sensor, 'GND', esp32, 'L_GND');
    const netlist = buildNetlist(builder.build(), new DynamicState());
    const elements: Element[] = [
      {
        kind: 'voltageSource',
        a: netlist.pinNode.get(`${esp32.id}:R_3V3`)!,
        b: GROUND,
        volts: 3.3,
      },
      ...netlist.elements,
    ];
    const solution: Solution = solveCircuit(elements, { nodeCount: netlist.nodeCount });
    const dq = netlist.pinNode.get(`${sensor.id}:DQ`)!;
    expect(dq).not.toBe(GROUND);
    expect(solution.voltages[dq]).toBeGreaterThan(2.8);
  });
});
