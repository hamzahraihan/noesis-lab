/**
 * LM35 analog temperature sensor: a three-pin part that outputs a voltage
 * proportional to temperature.
 *
 * Vout = 10 mV/°C × temperature, straight from the datasheet. The operator
 * sets the temperature with a knob; the solver drives the Vout pin at that
 * voltage above ground. VCC powers the chip but does not affect the output
 * in the model, which is why no supply current is drawn.
 *
 * The part is not on a bus: it contributes a voltage source to the netlist
 * rather than answering register reads. Its pins are wired in the circuit
 * like any other part -- VCC to the board's supply, GND to ground, Vout to
 * an analog input pin the sketch reads with analogRead.
 */
import type { KnobSpec, PartDefinition } from '../catalog';

/** The temperature of the air the sensor is sitting in, in degrees Celsius. */
export const LM35_TEMPERATURE_KNOB: KnobSpec = {
  id: 'temperature',
  label: 'Temperature',
  min: -55,
  max: 150,
  step: 1,
  unit: '°C',
  defaultValue: 25,
};

/** 10 mV per degree Celsius, from the LM35 datasheet. */
const MILLIVOLTS_PER_DEGREE = 0.01;

/** The output voltage, in volts above ground, for a given temperature. */
export function lm35Output(celsius: number): number {
  return MILLIVOLTS_PER_DEGREE * celsius;
}

export class Lm35 {
  /** The temperature in degrees Celsius. */
  celsius = 25;

  /** The output voltage, in volts above ground. */
  output(_supply: number): number {
    return lm35Output(this.celsius);
  }
}

export function lm35Definition(): PartDefinition {
  return {
    id: 'lm35',
    name: 'LM35 Temperature Sensor',
    category: 'input',
    widthMm: 9.8,
    heightMm: 4.35,
    component: { kind: 'lm35' },
    pins: [
      { id: 'VCC', label: 'VCC', x: 0, y: 1.27 },
      { id: 'GND', label: 'GND', x: 1.27, y: 1.27 },
      { id: 'Vout', label: 'Vout', x: 2.54, y: 1.27 },
    ],
    knobs: [LM35_TEMPERATURE_KNOB],
    bodyColour: '#1e293b',
    legendColour: '#e2e8f0',
  };
}
