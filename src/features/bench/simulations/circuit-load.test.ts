import { describe, expect, it } from 'vitest';
import { Simulation } from './simulation';
import { arduinoUnoR3, breadboardDefinition } from '@/features/parts';
import { decompile, parseCircuit, type CircuitDocument } from '@/features/simulation';

/*
 * A circuit the way a stored or shared one arrives: the board and the
 * breadboard are in the document, because `compile` builds from an empty bench
 * and nothing placed before the load survives the restore.
 */
const benchDoc: CircuitDocument = {
  version: 1,
  parts: [
    { id: 'bb', type: 'breadboard-830', x: 230, y: 0, rotation: 0 },
    { id: 'led', type: 'led-red', x: 415, y: 70, rotation: 0 },
    { id: 'res', type: 'resistor-220', x: 477, y: 70, rotation: 0 },
    { id: 'u', type: 'arduino-uno-r3', x: 0, y: 0, rotation: 0 },
  ],
  wires: [
    { id: 'w1', from: 'u:5V', to: 'led:A', colour: '#ef4444', gaugeAwg: 26, bends: [] },
    { id: 'w2', from: 'led:K', to: 'res:a', colour: '#111111', gaugeAwg: 26, bends: [] },
    { id: 'w3', from: 'res:b', to: 'u:D13', colour: '#f97316', gaugeAwg: 26, bends: [] },
  ],
};

describe('Simulation.loadCircuit', () => {
  it('puts the document on the bench, board and breadboard included', () => {
    const simulation = new Simulation(arduinoUnoR3());
    expect(simulation.loadCircuit(benchDoc)).toEqual([]);
    expect(simulation.bench.parts.map((part) => part.definition.id).sort()).toEqual([
      'arduino-uno-r3',
      'breadboard-830',
      'led-red',
      'resistor-220',
    ]);
    expect(simulation.bench.wires).toHaveLength(3);
  });

  it('reproduces the document it was given, so what loaded is what was stored', () => {
    const simulation = new Simulation(arduinoUnoR3());
    simulation.loadCircuit(benchDoc);
    const { doc, warnings } = decompile(simulation.builder.build(), simulation.controls);
    expect(warnings).toEqual([]);
    expect(doc).toEqual(benchDoc);
  });

  it('runs firmware on the loaded circuit', () => {
    const simulation = new Simulation(arduinoUnoR3());
    simulation.loadCircuit(benchDoc);
    simulation.loadFirmware(
      'void setup() { Serial.begin(9600); Serial.println("loaded"); } void loop() { }',
    );
    simulation.start();
    for (let i = 0; i < 5; i++) simulation.tick(1);
    expect(simulation.firmwareError).toBeNull();
    expect(simulation.serialLines().join('')).toContain('loaded');
  });

  it('leaves the bench alone when the document cannot be compiled', () => {
    const simulation = new Simulation(arduinoUnoR3());
    simulation.loadCircuit(benchDoc);
    const before = simulation.bench.parts.length;

    const errors = simulation.loadCircuit({
      version: 1,
      parts: [{ id: 'x', type: 'no-such-part', x: 0, y: 0, rotation: 0 }],
      wires: [],
    } as CircuitDocument);

    expect(errors.some((error) => error.includes('no-such-part'))).toBe(true);
    expect(simulation.bench.parts).toHaveLength(before);
    expect(simulation.bench.parts.some((part) => part.definition.id === 'led-red')).toBe(true);
  });

  it('refuses a document with no board, rather than wiring against nothing', () => {
    const simulation = new Simulation(arduinoUnoR3());
    const errors = simulation.loadCircuit({
      version: 1,
      parts: [{ id: 'led', type: 'led-red', x: 415, y: 70, rotation: 0 }],
      wires: [],
    });
    expect(errors).toEqual(['circuit has no board']);
    expect(simulation.bench.parts).toHaveLength(0);
  });

  it("refuses a document for another board, because the pin map is this one's", () => {
    const simulation = new Simulation(arduinoUnoR3());
    const errors = simulation.loadCircuit({
      version: 1,
      parts: [{ id: 'u', type: 'esp32-devkit-v1', x: 0, y: 0, rotation: 0 }],
      wires: [],
    });
    expect(errors).toEqual(['circuit is for esp32-devkit-v1, this bench is arduino-uno-r3']);
  });

  it('takes the circuit apart again when another one is loaded', () => {
    const simulation = new Simulation(arduinoUnoR3());
    simulation.loadCircuit(benchDoc);
    simulation.loadCircuit({
      version: 1,
      parts: [{ id: 'u', type: 'arduino-uno-r3', x: 0, y: 0, rotation: 0 }],
      wires: [],
    });
    expect(simulation.bench.parts).toHaveLength(1);
    expect(simulation.bench.wires).toHaveLength(0);
  });

  it('keeps the meter on the pin it was clipped to when the circuit is replaced', () => {
    const simulation = new Simulation(arduinoUnoR3());
    simulation.addPart(arduinoUnoR3(), 0, 0);
    simulation.addPart(breadboardDefinition(), 230, 0);
    simulation.loadFirmware('void setup() { pinMode(8, OUTPUT); digitalWrite(8, HIGH); } void loop() { }');
    simulation.start();
    for (let i = 0; i < 5; i++) simulation.tick(1);

    const d8 = simulation.mcu.pins().find((pin) => pin.label === '8')!;
    const ground = simulation.mcu.pins().find((pin) => pin.role === 'ground')!;
    simulation.setMeterProbes(d8.id, ground.id);
    const clipped = simulation.meterReading().value;
    expect(clipped, 'a high pin reads as the supply').toBeGreaterThan(4);

    // A document that lists its parts in any order: this one puts the board
    // last, so the nets are numbered differently afterwards than before.
    simulation.loadCircuit(
      parseCircuit(
        {
          version: 1,
          parts: [
            { id: 'led', type: 'led-red', x: 415, y: 70, rotation: 0 },
            { id: 'u', type: 'arduino-uno-r3', x: 0, y: 0, rotation: 0 },
          ],
          wires: [{ id: 'w1', from: 'u:8', to: 'led:A', colour: '#ef4444', gaugeAwg: 26, bends: [] }],
        },
        'board-last',
      ),
    );

    // The probe is still on D8 -- the pin the operator clipped, not the net
    // index that meant D8 before the load.
    expect(simulation.meterReading().value, 'still clipped to the high pin').toBeGreaterThan(4);
  });

  it('cannot be undone back into the circuit that was there before it', () => {
    const simulation = new Simulation(arduinoUnoR3());
    simulation.addPart(arduinoUnoR3(), 0, 0);
    simulation.loadCircuit(benchDoc);
    expect(simulation.canUndo()).toBe(false);
    expect(simulation.undo()).toBe(false);
  });
});
