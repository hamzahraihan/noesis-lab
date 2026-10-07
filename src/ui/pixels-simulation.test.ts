import { describe, expect, it } from 'vitest';
import { esp32DevKitV1 } from '@/features/parts';
import { neopixelDefinition } from '@/features/simulation';
import type { PartInstance } from '@/features/simulation';
import { Simulation } from './simulation';

function pixelBench() {
  const simulation = new Simulation(esp32DevKitV1());
  const board = simulation.addPart(esp32DevKitV1(), 0, 0);
  const pixel = simulation.addPart(neopixelDefinition(), 200, 0);
  const pin = (part: PartInstance, pinId: string) => {
    const found = part.definition.pins.find((p) => p.id === pinId)!;
    return { id: -1, x: part.x + found.x, y: part.y + found.y };
  };
  simulation.routeWire(pin(pixel, 'DIN'), pin(board, 'R_D2'));
  simulation.routeWire(pin(pixel, 'VDD'), pin(board, 'R_3V3'));
  simulation.routeWire(pin(pixel, 'VSS'), pin(board, 'L_GND'));
  return { simulation, board, pixel };
}

function paint(simulation: Simulation, gpio: number, index: number, r: number, g: number, b: number): void {
  simulation.loadFirmware(
    `void setup() { pixels.setColor(${gpio}, ${index}, ${r}, ${g}, ${b}); } void loop() { delay(1000); }`,
  );
  simulation.start();
  for (let i = 0; i < 10; i++) simulation.tick(1);
}

describe('pixels sketch', () => {
  it('paints the wired pixel through the port', () => {
    const { simulation, pixel } = pixelBench();
    paint(simulation, 2, 0, 255, 128, 0);
    expect(simulation.pixelColors().get(pixel.id)).toEqual([{ r: 255, g: 128, b: 0 }]);
  });

  it('is a no-op on a pin with nothing wired', () => {
    const { simulation, pixel } = pixelBench();
    paint(simulation, 4, 0, 255, 0, 0);
    expect(simulation.pixelColors().get(pixel.id)).toEqual([{ r: 0, g: 0, b: 0 }]);
  });

  it('holds independent buffers per part', () => {
    const { simulation, board, pixel } = pixelBench();
    const second = simulation.addPart(neopixelDefinition(), 300, 0);
    const pin = (part: PartInstance, pinId: string) => {
      const found = part.definition.pins.find((p) => p.id === pinId)!;
      return { id: -1, x: part.x + found.x, y: part.y + found.y };
    };
    simulation.routeWire(pin(second, 'DIN'), pin(board, 'R_D4'));
    simulation.routeWire(pin(second, 'VDD'), pin(board, 'R_3V3'));
    simulation.routeWire(pin(second, 'VSS'), pin(board, 'L_GND'));
    paint(simulation, 4, 0, 9, 9, 9);
    expect(simulation.pixelColors().get(second.id)).toEqual([{ r: 9, g: 9, b: 9 }]);
    expect(simulation.pixelColors().get(pixel.id)).toEqual([{ r: 0, g: 0, b: 0 }]);
  });
});
