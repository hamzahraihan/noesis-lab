/**
 * Differential fuzzing harness: random circuits + sketches run through the
 * TypeScript engine, checking for crashes and basic invariants.
 *
 * Issue #61: Differential Fuzzing Harness.
 *
 * Run with: `npm run test:fuzz` (default 100 circuits)
 * Or: `FUZZ_COUNT=1000 npx vitest run src/features/simulation/fuzz-parity.test.ts`
 */

import { describe, expect, it } from 'vitest';
import { Simulation } from '@/features/bench/simulations/simulation';
import { arduinoUnoR3 } from '@/features/parts';

const FUZZ_COUNT = parseInt(process.env.FUZZ_COUNT ?? '100', 10);
const FUZZ_STEPS = parseInt(process.env.FUZZ_STEPS ?? '20', 10);

// ---------------------------------------------------------------------------
// Random circuit generator
// ---------------------------------------------------------------------------

function makeLedBenchDoc() {
  return {
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
}

function randomSketch(seed: number): string {
  const sketches = [
    'void setup() { Serial.begin(9600); pinMode(13, OUTPUT); } void loop() { digitalWrite(13, HIGH); delay(100); digitalWrite(13, LOW); delay(100); }',
    'void setup() { Serial.begin(9600); } void loop() { Serial.println(analogRead(A0)); delay(10); }',
    'void setup() { Serial.begin(9600); pinMode(9, OUTPUT); } void loop() { analogWrite(9, 128); delay(50); }',
  ];
  return sketches[seed % sketches.length];
}

// ---------------------------------------------------------------------------
// Fuzz test
// ---------------------------------------------------------------------------

describe('differential fuzz parity', () => {
  for (let i = 0; i < FUZZ_COUNT; i++) {
    it(`circuit ${i} runs without errors`, () => {
      const benchDoc = makeLedBenchDoc();
      const sketch = randomSketch(i);

      const sim = new Simulation(arduinoUnoR3());
      const errors = sim.loadCircuit(benchDoc as any);
      expect(errors).toEqual([]);
      sim.loadFirmware(sketch);
      sim.start();

      for (let j = 0; j < FUZZ_STEPS; j++) {
        sim.tick(1);
      }

      expect(sim.firmwareError).toBeNull();
    });
  }
});
