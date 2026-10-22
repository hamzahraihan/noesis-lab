/**
 * A bench supply: a rail the operator sets, and the bench carries.
 *
 * The Uno's own supply is five volts, and that is enough for a sketch and
 * not enough for a motor. A stepper driver wants the motor's own supply,
 * and a bench where the only voltage is the board's is a bench that cannot
 * show a motor turning at its real speed.
 *
 * So the supply is a part with two terminals and a knob: the knob says
 * what the terminals are at, and the solver carries that voltage like any
 * other source. Nothing else on the bench drives a net at a level the
 * operator chooses, and that is the whole of it.
 */

import type { KnobSpec, PartDefinition } from './catalog';

/** The voltage the terminals are at. */
export const SUPPLY_VOLTAGE_KNOB: KnobSpec = {
  id: 'volts',
  label: 'Output',
  min: 0,
  max: 12,
  step: 0.5,
  defaultValue: 12,
  unit: 'V',
};

/**
 * The supply, as a box with two terminals and a dial.
 *
 * The terminals are the whole interface: the positive one is a net the
 * solver takes the knob's voltage from, and the ground one is the bench's
 * own ground, so a part wired to it is on the same ground as the board.
 */
export function powerSupplyDefinition(): PartDefinition {
  return {
    id: 'power-supply',
    name: 'Bench supply (0-12 V)',
    category: 'output',
    widthMm: 30.0,
    heightMm: 20.0,
    component: { kind: 'power-supply' },
    pins: [
      { id: 'V+', label: 'V+', x: 6.0, y: 16.0 },
      { id: 'GND', label: 'GND', x: 10.0, y: 16.0, net: 'GND' },
    ],
    knobs: [SUPPLY_VOLTAGE_KNOB],
    bodyColour: '#1e293b',
    legendColour: '#e2e8f0',
  };
}
