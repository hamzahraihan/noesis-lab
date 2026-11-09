/**
 * MQ-2 gas sensor: an analog part that outputs a voltage proportional to gas
 * concentration.
 *
 * The operator sets the gas concentration with a knob (0 ppm to 1000 ppm).
 * The solver drives the AOUT pin at a voltage proportional to concentration:
 * 0 V at 0 ppm, 2.5 V at 500 ppm, 5 V at 1000 ppm. VCC and GND power the
 * chip but do not affect the output in the model.
 *
 * The part is not on a bus: it contributes a voltage source to the netlist
 * rather than answering register reads. Its pins are wired in the circuit
 * like any other part -- VCC to the board's supply, GND to ground, AOUT to
 * an analog input pin the sketch reads with analogRead.
 */
import type { KnobSpec, PartDefinition } from '../catalog';

/** The gas concentration of the air, in parts per million. */
export const MQ2_KNOB: KnobSpec = {
  id: 'gas',
  label: 'Gas concentration',
  min: 0,
  max: 1000,
  step: 1,
  unit: 'ppm',
  defaultValue: 100,
};

/** The output voltage in volts for a given gas concentration. */
export function mq2OutputVolts(ppm: number): number {
  return (ppm / 1000) * 5;
}

export function mq2Definition(): PartDefinition {
  return {
    id: 'mq2',
    name: 'MQ-2 Gas Sensor',
    category: 'input',
    widthMm: 31.8,
    heightMm: 20.9,
    component: { kind: 'gas-sensor' },
    pins: [
      { id: 'VCC', label: 'VCC', x: 0, y: 1.27 },
      { id: 'GND', label: 'GND', x: 1.27, y: 1.27 },
      { id: 'AOUT', label: 'AOUT', x: 2.54, y: 1.27 },
    ],
    knobs: [MQ2_KNOB],
    bodyColour: '#1e293b',
    legendColour: '#e2e8f0',
  };
}
