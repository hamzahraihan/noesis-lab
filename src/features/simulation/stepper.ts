/**
 * Stepper motors: windings the sketch energizes in sequence, and a shaft
 * that follows the order of the edges.
 *
 * The 4-wire part carries two windings (A and B ends); the biaxial part
 * carries two independent pairs. Positions below are artwork-true from
 * each element's `pinInfo`, snapped to the 2.54 mm grid the breadboard
 * modules use.
 */

import type { PartDefinition } from '@/sim/catalog';

/** Shaft travel of one full step on the 42 mm NEMA frame the artwork draws. */
export const STEP_DEGREES = 7.5;

/** One winding, both ends driven: a small motor's phase resistance class. */
export const WINDING_OHMS = 50;

/** Dead band around zero differential: inside it a winding reads un-driven. */
export const WINDING_DEADBAND_VOLTS = 0.2;

/** Winding polarity: +1 means the + end sits above the - end. */
export type WindingPolarity = -1 | 0 | 1;

const GRAY_ORDER: ReadonlyArray<readonly [WindingPolarity, WindingPolarity]> = [
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
];

/**
 * Shaft direction for one full-step move, from the winding polarities
 * before and after. Follows the Gray cycle forward (+1) or back (-1);
 * anything else -- no change, a diagonal jump, a pass through undriven --
 * holds position (0) rather than guessing.
 */
export function stepTransition(
  prev: readonly [WindingPolarity, WindingPolarity],
  next: readonly [WindingPolarity, WindingPolarity],
): -1 | 0 | 1 {
  if (prev[0] === 0 || prev[1] === 0 || next[0] === 0 || next[1] === 0) return 0;
  const from = GRAY_ORDER.findIndex(([a, b]) => a === prev[0] && b === prev[1]);
  const to = GRAY_ORDER.findIndex(([a, b]) => a === next[0] && b === next[1]);
  if (from < 0 || to < 0) return 0;
  if (to === (from + 1) % 4) return 1;
  if (from === (to + 1) % 4) return -1;
  return 0;
}

/** Polarity of one winding from its solved end voltages. */
export function windingPolarity(plusVolts: number, minusVolts: number): WindingPolarity {
  const across = plusVolts - minusVolts;
  if (across > WINDING_DEADBAND_VOLTS) return 1;
  if (across < -WINDING_DEADBAND_VOLTS) return -1;
  return 0;
}

export function stepperDefinition(): PartDefinition {
  return {
    id: 'stepper-motor',
    name: 'Stepper Motor',
    category: 'output',
    widthMm: 42,
    heightMm: 42,
    component: { kind: 'stepper' },
    pins: [
      { id: 'A-', label: 'A-', x: 0, y: 40.0 },
      { id: 'A+', label: 'A+', x: 2.54, y: 40.0 },
      { id: 'B+', label: 'B+', x: 5.08, y: 40.0 },
      { id: 'B-', label: 'B-', x: 7.62, y: 40.0 },
    ],
    bodyColour: '#666666',
    legendColour: '#ffffff',
  };
}

export function biaxialStepperDefinition(): PartDefinition {
  const ids = ['A1-', 'A1+', 'B1+', 'B1-', 'A2-', 'A2+', 'B2+', 'B2-'] as const;
  return {
    id: 'biaxial-stepper',
    name: 'Biaxial Stepper',
    category: 'output',
    widthMm: 56,
    heightMm: 67.5,
    component: { kind: 'biaxial-stepper' },
    pins: ids.map((id, index) => ({
      id,
      label: id,
      x: 11.9,
      y: 28.9 + index * 2.54,
    })),
    bodyColour: '#666666',
    legendColour: '#ffffff',
  };
}
