/**
 * Rotary dialer: a finger dial behind three header pins.
 *
 * Pin positions are the element's `pinInfo` in CSS pixels at 96 per inch,
 * converted to millimetres: a bottom-edge row at y 286 px, snapped to the
 * 2.54 mm grid the breadboard modules use. `PULSE` is topology-only --
 * a DC solver cannot draw a pulse train, so the digit travels through
 * the `dialer` firmware port instead, the way climate travels through
 * the `dht` port.
 */

import type { KnobSpec, PartDefinition } from '@/sim/catalog';

/** The finger hole the dial stopped at: 0 counts the full ten pulses. */
export const DIGIT_KNOB: KnobSpec = {
  id: 'digit',
  label: 'Digit',
  min: 0,
  max: 9,
  step: 1,
  defaultValue: 0,
};

export function dialerDefinition(): PartDefinition {
  return {
    id: 'rotary-dialer',
    name: 'Rotary Dialer',
    category: 'input',
    widthMm: 70.4,
    heightMm: 75.6,
    component: { kind: 'rotary-dialer' },
    pins: [
      { id: 'GND', label: 'GND', x: 32.29, y: 75.67, net: 'GND' },
      { id: 'DIAL', label: 'DIAL', x: 34.83, y: 75.67 },
      { id: 'PULSE', label: 'PULSE', x: 37.36, y: 75.67 },
    ],
    knobs: [DIGIT_KNOB],
    momentary: true,
    bodyColour: '#1b1d21',
    legendColour: '#e8e8e8',
  };
}
