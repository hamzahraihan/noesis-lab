/**
 * Soil moisture sensor: an analog part that outputs a voltage proportional to
 * how wet the soil is.
 *
 * The operator sets the moisture with a knob (0 = bone dry, 100 = saturated),
 * and the solver drives the AOUT pin at that fraction of the supply. VCC
 * powers the chip but does not affect the output in the model.
 *
 * The part is not on a bus: it contributes a voltage source to the netlist
 * rather than answering register reads. Its pins are wired in the circuit
 * like any other part -- VCC to the board's supply, GND to ground, AOUT to
 * an analog input pin the sketch reads with analogRead.
 */
import type { KnobSpec, PartDefinition } from '../catalog';

/** The moisture of the soil, in percent. 0 is dry, 100 is saturated. */
export const MOISTURE_KNOB: KnobSpec = {
  id: 'moisture',
  label: 'Moisture',
  min: 0,
  max: 100,
  step: 1,
  unit: '%',
  defaultValue: 30,
};

/** The output voltage in volts: moisture percent scaled onto the 5 V supply. */
export function soilMoistureOutput(moisture: number): number {
  return (moisture / 100) * 5;
}

export class SoilMoisture {
  /** The moisture in percent. */
  moisture = 30;

  /** The output voltage, as a fraction of the supply voltage. */
  output(): number {
    return soilMoistureOutput(this.moisture);
  }
}

export function soilMoistureDefinition(): PartDefinition {
  return {
    id: 'soil-moisture',
    name: 'Soil Moisture Sensor',
    category: 'input',
    widthMm: 39,
    heightMm: 19,
    component: { kind: 'soil-moisture' },
    pins: [
      { id: 'VCC', label: 'VCC', x: 0, y: 1.27 },
      { id: 'GND', label: 'GND', x: 1.27, y: 1.27 },
      { id: 'AOUT', label: 'AOUT', x: 2.54, y: 1.27 },
    ],
    knobs: [MOISTURE_KNOB],
    bodyColour: '#3e2723',
    legendColour: '#efebe9',
  };
}
