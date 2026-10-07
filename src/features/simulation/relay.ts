/**
 * DPDT signal relay (ks2e-m-dc5 class): one coil, two poles ganged.
 *
 * Pin positions are the element's `pinInfo` in CSS pixels at 96 per inch,
 * converted to millimetres. Spacing is irregular (5.2/5.3/7.7 mm), so the
 * holes stay artwork-true rather than snapped to the 2.54 mm grid the
 * breadboard modules use -- snapping would pull holes off their pads.
 */

import type { PartDefinition } from '@/sim/catalog';

/** Coil resistance of a 5 V signal relay of this class (~70 mA pull-in). */
export const RELAY_COIL_OHMS = 70;

/**
 * Coil volts above which the armature pulls in.
 *
 * Generous toward real 5 V-coil behavior on purpose: a GPIO driving the
 * 70 ohm coil sags through its own output impedance (40 ohm on the ESP32),
 * so a 3.3 V pin delivers ~2.1 V at the coil. The threshold sits below
 * that so both logic families pull in on direct drive.
 */
export const RELAY_PULLIN_VOLTS = 1.8;

/** Whether a solved coil voltage pulls the armature in. */
export function coilEnergized(coilVolts: number): boolean {
  return Math.abs(coilVolts) >= RELAY_PULLIN_VOLTS;
}

export function relayDefinition(): PartDefinition {
  return {
    id: 'relay-dpdt',
    name: 'Relay (DPDT)',
    category: 'input',
    widthMm: 21,
    heightMm: 10,
    component: { kind: 'relay' },
    pins: [
      { id: 'NO2', label: 'NO2', x: 1.46, y: 1.35 },
      { id: 'NC2', label: 'NC2', x: 6.61, y: 1.35 },
      { id: 'P2', label: 'P2', x: 11.91, y: 1.35 },
      { id: 'COIL-', label: 'COIL-', x: 19.58, y: 1.35 },
      { id: 'NO1', label: 'NO1', x: 1.46, y: 8.65 },
      { id: 'NC1', label: 'NC1', x: 6.61, y: 8.65 },
      { id: 'P1', label: 'P1', x: 11.91, y: 8.65 },
      { id: 'COIL+', label: 'COIL+', x: 19.58, y: 8.65 },
    ],
    bodyColour: '#f7b93c',
    legendColour: '#1b1d21',
  };
}
