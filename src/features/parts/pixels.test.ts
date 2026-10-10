import { describe, expect, it } from 'vitest';
import { BenchBuilder, type PartInstance } from '@/features/simulation';
import { esp32DevKitV1 } from '@/features/parts';
import { GROUND, type Element } from '@/features/simulation';
import { solveCircuit, type Solution } from '@/features/simulation';
import { DynamicState } from '@/features/parts';
import { buildNetlist, type Netlist } from '@/features/simulation';
import { McuRuntime } from '@/features/simulation';
import { Engine } from '@/features/simulation';
import { clampChannel, ledRingDefinition, neopixelDefinition, neopixelMatrixDefinition, pixelCount } from './pixels';
import { renderedSizeMm, wokwiPartFor } from '@/features/bench/wokwi/wokwi';

describe('pixel definitions', () => {
  it('exposes the single, matrix, and ring pins', () => {
    expect(neopixelDefinition().pins.map((p) => p.id)).toEqual(['VDD', 'DOUT', 'VSS', 'DIN']);
    expect(neopixelMatrixDefinition().pins.map((p) => p.id)).toEqual(['GND', 'VCC', 'DIN', 'DOUT']);
    expect(ledRingDefinition().pins.map((p) => p.id)).toEqual(['GND', 'VCC', 'DIN', 'DOUT']);
    expect([pixelCount(neopixelDefinition()), pixelCount(neopixelMatrixDefinition()), pixelCount(ledRingDefinition())]).toEqual([1, 64, 16]);
  });
});

describe('channel clamp', () => {
  it('rounds and clamps to 0-255', () => {
    expect(clampChannel(300)).toBe(255);
    expect(clampChannel(-4)).toBe(0);
    expect(clampChannel(12.7)).toBe(13);
  });

  it('maps non-finite channels instead of passing NaN through', () => {
    expect(clampChannel(Number.NaN)).toBe(0);
    expect(clampChannel(Number.POSITIVE_INFINITY)).toBe(255);
    expect(clampChannel(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});

describe('pixel selection', () => {
  it('selection boxes match the pixel artworks', () => {
    const single = renderedSizeMm(neopixelDefinition());
    expect(single.widthMm).toBe(5.6631);
    expect(single.heightMm).toBe(5);
    expect(wokwiPartFor(neopixelDefinition())?.tag).toBe('wokwi-neopixel');
    const matrix = renderedSizeMm(neopixelMatrixDefinition());
    expect(matrix.widthMm).toBe(52.28);
    expect(matrix.heightMm).toBe(49);
    expect(wokwiPartFor(neopixelMatrixDefinition())?.tag).toBe('wokwi-neopixel-matrix');
    const ring = renderedSizeMm(ledRingDefinition());
    expect(ring.widthMm).toBe(37.46);
    expect(ring.heightMm).toBe(41);
    expect(wokwiPartFor(ledRingDefinition())?.tag).toBe('wokwi-led-ring');
  });
});
describe('pixel buffers', () => {
  function bufferBench() {
    const builder = new BenchBuilder();
    const esp32 = builder.addPart(esp32DevKitV1(), 0, 0);
    const pixel = builder.addPart(neopixelDefinition(), 200, 0);
    const other = builder.addPart(neopixelDefinition(), 300, 0);
    const mcu = new McuRuntime(esp32.definition);
    const engine = new Engine({ bench: builder.build(), mcu });
    engine.rebuild();
    return { engine, pixel, other };
  }

  it('ignores out-of-range indexes and clamps channels', () => {
    const { engine, pixel } = bufferBench();
    engine.setPixel(pixel.id, 5, { r: 10, g: 10, b: 10 });
    engine.setPixel(pixel.id, 0, { r: 300, g: -20, b: 12.7 });
    expect(engine.pixelColors(pixel.id)).toEqual([{ r: 255, g: 0, b: 13 }]);
  });

  it('holds independent buffers per part', () => {
    const { engine, pixel, other } = bufferBench();
    engine.setPixel(pixel.id, 0, { r: 1, g: 2, b: 3 });
    expect(engine.pixelColors(other.id)).toEqual([{ r: 0, g: 0, b: 0 }]);
  });

  it('solves finite with a floating DIN', () => {
    const builder = new BenchBuilder();
    const esp32 = builder.addPart(esp32DevKitV1(), 0, 0);
    const matrix = builder.addPart(neopixelMatrixDefinition(), 200, 0);
    const at = (part: PartInstance, pinId: string) => {
      const pin = part.definition.pins.find((p) => p.id === pinId)!;
      return { x: part.x + pin.x, y: part.y + pin.y };
    };
    const join = (a: PartInstance, aPin: string, b: PartInstance, bPin: string) => {
      const pa = at(a, aPin);
      const pb = at(b, bPin);
      builder.addWire(pa.x, pa.y, pb.x, pb.y);
    };
    join(matrix, 'VCC', esp32, 'R_3V3');
    join(matrix, 'GND', esp32, 'L_GND');
    const netlist: Netlist = buildNetlist(builder.build(), new DynamicState());
    // The matrix stamps nothing itself: only the two jumpers show up.
    expect(netlist.elements.every((e) => e.kind === 'resistor' && e.label?.startsWith('wire'))).toBe(true);
    const elements: Element[] = [
      { kind: 'voltageSource', a: netlist.pinNode.get(`${esp32.id}:R_3V3`)!, b: GROUND, volts: 3.3 },
      ...netlist.elements,
    ];
    const solution: Solution = solveCircuit(elements, { nodeCount: netlist.nodeCount });
    for (const pinId of ['DIN', 'DOUT']) {
      const node = netlist.pinNode.get(`${matrix.id}:${pinId}`)!;
      expect(Number.isFinite(node === GROUND ? 0 : solution.voltages[node])).toBe(true);
    }
  });
});
