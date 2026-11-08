/**
 * ADXL335 analog accelerometer: a three-axis part that outputs a voltage per
 * axis proportional to acceleration.
 *
 * The operator sets the acceleration on each axis with a knob (-3 g to
 * +3 g). The solver drives the X, Y and Z pins at that fraction of the
 * supply: the mid-rail (half the supply) at rest, the near rail at full
 * scale. VCC and GND power the chip but do not affect the outputs in the
 * model.
 *
 * The part is not on a bus: it contributes three voltage sources to the
 * netlist rather than answering register reads. Its pins are wired in the
 * circuit like any other part -- VCC to the board's supply, GND to ground,
 * and X, Y and Z to analog input pins the sketch reads with analogRead.
 */
import type { KnobSpec, PartDefinition } from '../catalog';

/** The acceleration on the X axis, in g. */
export const ADXL335_X_KNOB: KnobSpec = {
  id: 'x',
  label: 'X',
  min: -3,
  max: 3,
  step: 0.1,
  unit: 'g',
  defaultValue: 0,
};

/** The acceleration on the Y axis, in g. */
export const ADXL335_Y_KNOB: KnobSpec = {
  id: 'y',
  label: 'Y',
  min: -3,
  max: 3,
  step: 0.1,
  unit: 'g',
  defaultValue: 0,
};

/** The acceleration on the Z axis, in g. */
export const ADXL335_Z_KNOB: KnobSpec = {
  id: 'z',
  label: 'Z',
  min: -3,
  max: 3,
  step: 0.1,
  unit: 'g',
  defaultValue: 1,
};

/** The output voltage in volts for a given acceleration, on the 5 V supply. */
function outputFor(g: number): number {
  return ((g + 3) / 6) * 5;
}

/** The voltage on the X axis pin, in volts. */
export function adxl335OutputX(g: number): number {
  return outputFor(g);
}

/** The voltage on the Y axis pin, in volts. */
export function adxl335OutputY(g: number): number {
  return outputFor(g);
}

/** The voltage on the Z axis pin, in volts. */
export function adxl335OutputZ(g: number): number {
  return outputFor(g);
}

export function adxl335Definition(): PartDefinition {
  return {
    id: 'adxl335',
    name: 'ADXL335 Accelerometer',
    category: 'input',
    widthMm: 17.8,
    heightMm: 11.1,
    component: { kind: 'adxl335' },
    pins: [
      { id: 'VCC', label: 'VCC', x: 0, y: 1.27 },
      { id: 'GND', label: 'GND', x: 1.27, y: 1.27 },
      { id: 'X', label: 'X', x: 2.54, y: 1.27 },
      { id: 'Y', label: 'Y', x: 3.81, y: 1.27 },
      { id: 'Z', label: 'Z', x: 5.08, y: 1.27 },
    ],
    knobs: [ADXL335_X_KNOB, ADXL335_Y_KNOB, ADXL335_Z_KNOB],
    bodyColour: '#1e293b',
    legendColour: '#e2e8f0',
  };
}
