import { describe, expect, it } from 'vitest';
import { esp32DevKitV1 } from '../sim/boards';
import { irReceiverDefinition } from '../sim/modules';
import { remoteDefinition, REMOTE_KEY_KNOB } from '@/features/simulation';
import type { PartInstance } from '@/features/simulation';
import { Simulation } from './simulation';

function airBench() {
  const simulation = new Simulation(esp32DevKitV1());
  const board = simulation.addPart(esp32DevKitV1(), 0, 0);
  const receiver = simulation.addPart(irReceiverDefinition(), 200, 0);
  const remote = simulation.addPart(remoteDefinition(), 300, 0);
  const pin = (part: PartInstance, pinId: string) => {
    const found = part.definition.pins.find((p) => p.id === pinId)!;
    return { id: -1, x: part.x + found.x, y: part.y + found.y };
  };
  simulation.routeWire(pin(receiver, 'DAT'), pin(board, 'R_D2'));
  simulation.routeWire(pin(receiver, 'VCC'), pin(board, 'R_3V3'));
  simulation.routeWire(pin(receiver, 'GND'), pin(board, 'L_GND'));
  return { simulation, receiver, remote };
}

function readCode(simulation: Simulation, gpio: number): string[] {
  simulation.loadFirmware(
    `void setup() { Serial.println(ir.readCode(${gpio})); } void loop() { delay(1000); }`,
  );
  simulation.start();
  for (let i = 0; i < 10; i++) simulation.tick(1);
  return simulation.serialLines().map((line) => line.trim());
}

function datVolts(simulation: Simulation, receiver: PartInstance): number {
  const net = simulation.engine.currentNetlist.pinNode.get(`${receiver.id}:DAT`)!;
  return simulation.engine.voltageOfNet(net);
}

describe('ir sketch', () => {
  it('pulls DAT low with the key code while held', () => {
    const { simulation, receiver, remote } = airBench();
    simulation.setKnob(remote.id, REMOTE_KEY_KNOB, 11);
    simulation.setPressed(remote.id, true);
    expect(readCode(simulation, 2)).toEqual(['48']);
    expect(datVolts(simulation, receiver)).toBeLessThan(0.5);
  });

  it('releases DAT high with code 0 after the window', () => {
    const { simulation, receiver, remote } = airBench();
    simulation.setKnob(remote.id, REMOTE_KEY_KNOB, 11);
    simulation.setPressed(remote.id, true);
    simulation.tick(1);
    simulation.setPressed(remote.id, false);
    for (let i = 0; i < 10; i++) simulation.tick(1);
    expect(readCode(simulation, 2)).toEqual(['0']);
    expect(datVolts(simulation, receiver)).toBeGreaterThan(2.8);
  });

  it('reads 0 on a pin with no receiver wired', () => {
    const { simulation } = airBench();
    expect(readCode(simulation, 4)).toEqual(['0']);
  });
});
