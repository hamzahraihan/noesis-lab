import { describe, expect, it } from 'vitest';
import { esp32DevKitV1 } from '@/features/parts';
import { DS18B20_TEMPERATURE_KNOB, ds18b20Definition } from '@/features/parts';
import type { PartInstance } from '@/features/simulation';
import { Simulation } from './simulation';

function sensorBench() {
  const simulation = new Simulation(esp32DevKitV1());
  const board = simulation.addPart(esp32DevKitV1(), 0, 0);
  const sensor = simulation.addPart(ds18b20Definition(), 200, 0);
  const pin = (part: PartInstance, pinId: string) => {
    const found = part.definition.pins.find((p) => p.id === pinId)!;
    return { id: -1, x: part.x + found.x, y: part.y + found.y };
  };
  simulation.routeWire(pin(sensor, 'DQ'), pin(board, 'R_D2'));
  simulation.routeWire(pin(sensor, 'VCC'), pin(board, 'R_3V3'));
  simulation.routeWire(pin(sensor, 'GND'), pin(board, 'L_GND'));
  return { simulation, sensor };
}

function readTemperature(simulation: Simulation, gpio: number): string[] {
  simulation.loadFirmware(
    `OneWire ow(${gpio}); void setup() { Serial.println(ow.getTemp()); } void loop() { delay(1000); }`,
  );
  simulation.start();
  for (let i = 0; i < 10; i++) simulation.tick(1);
  return simulation.serialLines().map((line) => line.trim());
}

describe('one-wire sketch', () => {
  it('reports the temperature off a wired part', () => {
    const { simulation, sensor } = sensorBench();
    simulation.setKnob(sensor.id, DS18B20_TEMPERATURE_KNOB, 23.5);
    expect(readTemperature(simulation, 2)).toEqual(['23.50']);
  });

  it('reads 0 on a pin with nothing wired', () => {
    const { simulation } = sensorBench();
    expect(readTemperature(simulation, 4)).toEqual(['0']);
  });

  it('reads each part independently and clamps to the knob range', () => {
    const { simulation, sensor } = sensorBench();
    const board = simulation.bench.parts.find((p) => p.definition.component.kind === 'mcu')!;
    const second = simulation.addPart(ds18b20Definition(), 300, 0);
    const pin = (part: PartInstance, pinId: string) => {
      const found = part.definition.pins.find((p) => p.id === pinId)!;
      return { id: -1, x: part.x + found.x, y: part.y + found.y };
    };
    simulation.routeWire(pin(second, 'DQ'), pin(board, 'R_D4'));
    simulation.routeWire(pin(second, 'VCC'), pin(board, 'R_3V3'));
    simulation.routeWire(pin(second, 'GND'), pin(board, 'L_GND'));
    simulation.setKnob(sensor.id, DS18B20_TEMPERATURE_KNOB, -40);
    simulation.setKnob(second.id, DS18B20_TEMPERATURE_KNOB, 110);
    expect(readTemperature(simulation, 2)).toEqual(['-40']);
    expect(readTemperature(simulation, 4)).toEqual(['110']);
  });
});
