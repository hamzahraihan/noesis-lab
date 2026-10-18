import { describe, expect, it } from 'vitest';
import { esp32DevKitV1 } from '@/features/parts';
import { microsdDefinition } from '@/features/parts';
import type { PartInstance } from '@/features/simulation';
import { Simulation } from './simulation';

function cardBench() {
  const simulation = new Simulation(esp32DevKitV1());
  const board = simulation.addPart(esp32DevKitV1(), 0, 0);
  const card = simulation.addPart(microsdDefinition(), 200, 0);
  const pin = (part: PartInstance, pinId: string) => {
    const found = part.definition.pins.find((p) => p.id === pinId)!;
    return { id: -1, x: part.x + found.x, y: part.y + found.y };
  };
  simulation.routeWire(pin(card, 'CS'), pin(board, 'R_D5'));
  simulation.routeWire(pin(card, 'VCC'), pin(board, 'R_3V3'));
  simulation.routeWire(pin(card, 'GND'), pin(board, 'L_GND'));
  return { simulation, card };
}

function runSketch(simulation: Simulation, body: string): string[] {
  simulation.loadFirmware(`void setup() { ${body} } void loop() { delay(1000); }`);
  simulation.start();
  for (let i = 0; i < 10; i++) simulation.tick(1);
  return simulation.serialLines().map((line) => line.trim());
}

describe('sd sketch', () => {
  it('keeps a file across a reflash', () => {
    const { simulation } = cardBench();
    expect(runSketch(simulation, 'sd.begin(5); sd.write(5, "log.txt", "hello");')).toEqual([]);
    expect(runSketch(simulation, 'Serial.println(sd.read(5, "log.txt"));')).toEqual(['hello']);
  });

  it('fails closed on a pin with no card wired', () => {
    const { simulation } = cardBench();
    expect(
      runSketch(simulation, 'Serial.println(sd.begin(4)); Serial.println(sd.read(4, "x"));'),
    ).toEqual(['0', '']);
  });

  it('forgets files with the removed card', () => {
    const { simulation, card } = cardBench();
    runSketch(simulation, 'sd.begin(5); sd.write(5, "log.txt", "hi");');
    simulation.removePart(card.id);
    const fresh = simulation.addPart(microsdDefinition(), 200, 0);
    const pin = (part: PartInstance, pinId: string) => {
      const found = part.definition.pins.find((p) => p.id === pinId)!;
      return { id: -1, x: part.x + found.x, y: part.y + found.y };
    };
    const board = simulation.bench.parts.find((p) => p.definition.component.kind === 'mcu')!;
    simulation.routeWire(pin(fresh, 'CS'), pin(board, 'R_D5'));
    simulation.routeWire(pin(fresh, 'VCC'), pin(board, 'R_3V3'));
    simulation.routeWire(pin(fresh, 'GND'), pin(board, 'L_GND'));
    expect(runSketch(simulation, 'Serial.println(sd.read(5, "log.txt"));')).toEqual(['']);
  });
});
