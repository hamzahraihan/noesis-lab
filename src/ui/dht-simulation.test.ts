import { describe, expect, it } from 'vitest';
import { esp32DevKitV1 } from '../sim/boards';
import { HUMIDITY_KNOB, dhtDefinition } from '@/features/simulation';
import { TEMPERATURE_KNOB } from '../sim/modules';
import type { PartInstance } from '@/features/simulation';
import { Simulation } from './simulation';

function climateBench() {
  const simulation = new Simulation(esp32DevKitV1());
  const board = simulation.addPart(esp32DevKitV1(), 0, 0);
  const dht = simulation.addPart(dhtDefinition(), 200, 0);
  const pin = (part: PartInstance, pinId: string) => {
    const found = part.definition.pins.find((p) => p.id === pinId)!;
    return { id: -1, x: part.x + found.x, y: part.y + found.y };
  };
  simulation.routeWire(pin(dht, 'SDA'), pin(board, 'R_D2'));
  simulation.routeWire(pin(dht, 'VCC'), pin(board, 'R_3V3'));
  simulation.routeWire(pin(dht, 'GND'), pin(board, 'L_GND'));
  return { simulation, dht };
}

function readClimate(simulation: Simulation, gpio: number): string[] {
  simulation.loadFirmware(
    `void setup() { dht.begin(${gpio}); float t = dht.temperature(${gpio}); float h = dht.humidity(${gpio}); Serial.println(t); Serial.println(h); } void loop() { delay(1000); }`,
  );
  simulation.start();
  for (let i = 0; i < 10; i++) simulation.tick(1);
  return simulation.serialLines().map((line) => line.trim());
}

describe('dht sketch', () => {
  it('reports the knob climate off a wired part', () => {
    const { simulation, dht } = climateBench();
    simulation.setKnob(dht.id, TEMPERATURE_KNOB, 23.5);
    simulation.setKnob(dht.id, HUMIDITY_KNOB, 61);
    expect(readClimate(simulation, 2)).toEqual(['23.50', '61']);
  });

  it('reads 0 on a pin with nothing wired', () => {
    const { simulation } = climateBench();
    expect(readClimate(simulation, 4)).toEqual(['0', '0']);
  });

  it('reads each part independently and clamps to the knob range', () => {
    const { simulation, dht } = climateBench();
    const board = simulation.bench.parts.find((p) => p.definition.component.kind === 'mcu')!;
    const second = simulation.addPart(dhtDefinition(), 300, 0);
    const pin = (part: PartInstance, pinId: string) => {
      const found = part.definition.pins.find((p) => p.id === pinId)!;
      return { id: -1, x: part.x + found.x, y: part.y + found.y };
    };
    simulation.routeWire(pin(second, 'SDA'), pin(board, 'R_D4'));
    simulation.routeWire(pin(second, 'VCC'), pin(board, 'R_3V3'));
    simulation.routeWire(pin(second, 'GND'), pin(board, 'L_GND'));
    simulation.setKnob(dht.id, TEMPERATURE_KNOB, 20);
    simulation.setKnob(dht.id, HUMIDITY_KNOB, 40);
    simulation.setKnob(second.id, TEMPERATURE_KNOB, 30);
    simulation.setKnob(second.id, HUMIDITY_KNOB, 70);
    expect(readClimate(simulation, 2)).toEqual(['20', '40']);
    expect(readClimate(simulation, 4)).toEqual(['30', '70']);
    simulation.setKnob(second.id, HUMIDITY_KNOB, HUMIDITY_KNOB.min);
    expect(readClimate(simulation, 4)).toEqual(['30', '0']);
    simulation.setKnob(second.id, HUMIDITY_KNOB, HUMIDITY_KNOB.max);
    expect(readClimate(simulation, 4)).toEqual(['30', '100']);
  });
});
