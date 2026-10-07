import { describe, expect, it } from 'vitest';
import { esp32DevKitV1 } from '../sim/boards';
import { DIGIT_KNOB, dialerDefinition } from '@/features/simulation';
import type { PartInstance } from '@/features/simulation';
import { Simulation } from './simulation';

function dialBench() {
  const simulation = new Simulation(esp32DevKitV1());
  const board = simulation.addPart(esp32DevKitV1(), 0, 0);
  const dialer = simulation.addPart(dialerDefinition(), 200, 0);
  const pin = (part: PartInstance, pinId: string) => {
    const found = part.definition.pins.find((p) => p.id === pinId)!;
    return { id: -1, x: part.x + found.x, y: part.y + found.y };
  };
  simulation.routeWire(pin(dialer, 'DIAL'), pin(board, 'R_D2'));
  simulation.routeWire(pin(dialer, 'GND'), pin(board, 'L_GND'));
  return { simulation, dialer };
}

function readDial(simulation: Simulation, gpio: number): string[] {
  simulation.loadFirmware(
    `void setup() { Serial.println(dialer.read(${gpio})); } void loop() { delay(1000); }`,
  );
  simulation.start();
  for (let i = 0; i < 10; i++) simulation.tick(1);
  return simulation.serialLines().map((line) => line.trim());
}

describe('dialer sketch', () => {
  it('reads -1 before any dial', () => {
    const { simulation } = dialBench();
    expect(readDial(simulation, 2)).toEqual(['-1']);
  });

  it('reads -1 on a pin with no dialer wired', () => {
    const { simulation } = dialBench();
    expect(readDial(simulation, 4)).toEqual(['-1']);
  });

  it('latches the held digit and keeps it after release', () => {
    const { simulation, dialer } = dialBench();
    simulation.setKnob(dialer.id, DIGIT_KNOB, 7);
    simulation.setPressed(dialer.id, true);
    simulation.tick(1);
    simulation.setPressed(dialer.id, false);
    expect(readDial(simulation, 2)).toEqual(['7']);
  });
});
