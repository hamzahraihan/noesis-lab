import { describe, expect, it } from 'vitest';
import { esp32DevKitV1 } from '@/features/parts';
import { sonarDefinition } from '@/features/parts';
import type { PartInstance } from '@/features/simulation';
import { Simulation } from './simulation';

function wiredBench(wireEcho: boolean, vccToGround = false) {
  const simulation = new Simulation(esp32DevKitV1());
  const board = simulation.addPart(esp32DevKitV1(), 0, 0);
  const sonar = simulation.addPart(sonarDefinition(), 200, 0);
  const pin = (part: PartInstance, pinId: string) => {
    const found = part.definition.pins.find((p) => p.id === pinId)!;
    return { id: -1, x: part.x + found.x, y: part.y + found.y };
  };
  if (wireEcho) simulation.routeWire(pin(sonar, 'ECHO'), pin(board, 'R_D2'));
  simulation.routeWire(pin(sonar, 'VCC'), pin(board, vccToGround ? 'L_GND' : 'R_3V3'));
  simulation.routeWire(pin(sonar, 'GND'), pin(board, 'L_GND'));
  return simulation;
}

function readPulse(simulation: Simulation, level: string, ticks = 10): string {
  simulation.loadFirmware(
    `void setup() { int d = pulseIn(2, ${level}); Serial.println(d); } void loop() { delay(1000); }`,
  );
  simulation.start();
  // Timeout paths wait out the full one-second default, so those cases
  // need a tick budget past it; echoes return in milliseconds.
  for (let i = 0; i < ticks; i++) simulation.tick(1);
  return simulation.serialLines().join('');
}

describe('sonar sketch', () => {
  it('reports the knob distance through pulseIn', () => {
    expect(readPulse(wiredBench(true), 'HIGH')).toContain('5800');
  });

  it('reports 0 with nothing wired to the pin', () => {
    expect(readPulse(wiredBench(false), 'HIGH', 30)).toContain('0');
  });

  it('times out asking for a LOW pulse the line never makes', () => {
    const output = readPulse(wiredBench(true), 'LOW', 30);
    expect(output).not.toContain('5800');
    expect(output).toContain('0');
  });

  it('still echoes with VCC on the wrong rail', () => {
    expect(readPulse(wiredBench(true, true), 'HIGH')).toContain('5800');
  });
});
