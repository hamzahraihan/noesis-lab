/**
 * KY-040 rotary encoder: quadrature CLK/DT plus a push-to-select contact.
 *
 * Pin positions come from the element's `pinInfo` (CSS pixels at 96dpi):
 * a single column at x 116px with CLK/DT/SW/VCC/GND down it. The column is
 * snapped to the 2.54 mm grid the breadboard modules use; rows follow at
 * the measured spacing rather than a uniform pitch so they stay on the pads.
 */

import type { KnobSpec, PartDefinition } from '@/sim/catalog';

/**
 * Detent steps turned from rest. Each step advances the Gray cycle one
 * state, so a sketch counts edges on CLK/DT the way it would on hardware.
 */
export const DETENT_KNOB: KnobSpec = {
  id: 'detent',
  label: 'Detents',
  min: -1000,
  max: 1000,
  step: 1,
  defaultValue: 0,
};

/** Quadrature levels per detent mod 4: Gray code, both idle high. */
export const QUADRATURE: ReadonlyArray<readonly [clk: 0 | 1, dt: 0 | 1]> = [
  [1, 1],
  [0, 1],
  [0, 0],
  [1, 0],
];

export function quadratureAt(detents: number): readonly [0 | 1, 0 | 1] {
  return QUADRATURE[((Math.round(detents) % 4) + 4) % 4];
}

export function encoderDefinition(): PartDefinition {
  return {
    id: 'rotary-encoder',
    name: 'Rotary Encoder (KY-040)',
    category: 'input',
    widthMm: 30.815,
    heightMm: 18.63,
    component: { kind: 'rotary-encoder' },
    pins: [
      { id: 'CLK', label: 'CLK', x: 30.48, y: 2.09 },
      { id: 'DT', label: 'DT', x: 30.48, y: 4.6 },
      { id: 'SW', label: 'SW', x: 30.48, y: 7.14 },
      { id: 'VCC', label: 'VCC', x: 30.48, y: 9.6 },
      { id: 'GND', label: 'GND', x: 30.48, y: 12.04, net: 'GND' },
    ],
    knobs: [DETENT_KNOB],
    momentary: true,
    bodyColour: '#1c2546',
    legendColour: '#e8e8e8',
  };
}
