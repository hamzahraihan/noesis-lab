/**
 * HC-SR04 ultrasonic ranger: trigger in, echo out.
 *
 * Pin positions are the element's `pinInfo` in CSS pixels at 96 per inch,
 * converted to millimetres: a bottom-edge row at y 94.5 px. The row lands
 * within a hair of the 2.54 mm grid and is snapped onto it; x follows the
 * artwork.
 */

import type { KnobSpec, PartDefinition } from '@/features/parts';

/**
 * Target distance in centimetres: the echo width follows it.
 *
 * Held in the sensor's real 2 to 400 cm range, defaulting to a metre --
 * mid-range, so the first reading is neither a wall nor the void.
 */
export const DISTANCE_KNOB: KnobSpec = {
  id: 'distance',
  label: 'Distance',
  min: 2,
  max: 400,
  step: 1,
  unit: 'cm',
  defaultValue: 100,
};

/** Microseconds of echo per centimetre of distance (~58 at room temperature). */
export const ECHO_US_PER_CM = 58;

/** Echo width for a distance: what `pulseIn` reports and waits out. */
export function echoMicroseconds(distanceCm: number): number {
  return Math.round(distanceCm * ECHO_US_PER_CM);
}

export function sonarDefinition(): PartDefinition {
  return {
    id: 'sonar-hcsr04',
    name: 'Ultrasonic Sensor (HC-SR04)',
    category: 'input',
    widthMm: 45,
    heightMm: 25,
    component: { kind: 'sonar' },
    pins: [
      { id: 'VCC', label: 'VCC', x: 18.86, y: 25.0 },
      { id: 'TRIG', label: 'TRIG', x: 21.5, y: 25.0 },
      { id: 'ECHO', label: 'ECHO', x: 24.15, y: 25.0 },
      { id: 'GND', label: 'GND', x: 26.8, y: 25.0, net: 'GND' },
    ],
    knobs: [DISTANCE_KNOB],
    bodyColour: '#0d6ebd',
    legendColour: '#ffffff',
  };
}
