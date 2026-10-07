/**
 * Discrete passives and simple input/output parts.
 *
 * Pin spacing here is the real one, because the whole premise is that a wiring
 * diagram in a book matches what the user sees and clicks on.
 */

import type { KnobSpec, PartDefinition } from './catalog';
import { DIODE_PROFILES, type DiodeProfile } from '@/features/simulation/elements';
/**
 * The potentiometer's one control.
 *
 * Exported for the same reason the modules' controls are: the netlist reads it
 * as well as the inspector writing it.
 */
export const WIPER_KNOB: KnobSpec = {
  id: 'turn',
  label: 'Wiper',
  min: 0,
  max: 1,
  step: 0.01,
  defaultValue: 0.5,
};

/**
 * Through-hole resistor, 0.25 W axial, leads on a 10.16 mm body.
 *
 * The pins sit at the ends of the drawn leads, one grid step down, and that
 * is the whole reason for the number. They used to sit at y = 1.6, the middle
 * of the part's own 3.2 mm box, which is above where the lead visibly stops:
 * a wire clipped to the pin met the body a millimetre higher than the metal it
 * was supposed to be soldered to, so it read as floating against the resistor's
 * waist. 2.54 is where `AxialLeads` terminates, and it is a whole 0.1" step, so
 * a resistor dropped on the breadboard lands in a real row.
 */
export function resistorDefinition(ohms: number): PartDefinition {
  return {
    id: `resistor-${ohms}`,
    name: `${formatOhms(ohms)} Resistor`,
    category: 'passive',
    widthMm: 12.7,
    heightMm: 3.2,
    component: { kind: 'resistor', ohms },
    pins: [
      { id: 'a', label: '', x: 0, y: 2.54 },
      { id: 'b', label: '', x: 10.16, y: 2.54 },
    ],
    bodyColour: '#d8c9a3',
    legendColour: '#3a3222',
  };
}

/**
 * 5 mm through-hole LED, drawn by the Wokwi element: dome, flange and long
 * legs, tinted by the diode profile and lit by the solver's forward bias.
 *
 * The geometry is the element's own, converted from its `pinInfo` pixels at
 * 96 per inch (`px * 25.4 / 96`): the legs land at x = 15 px (cathode) and
 * 25 px (anode), both at y = 42 px, in a 40 x 50 px body. Defining the pins
 * anywhere else puts the wires somewhere the visible legs are not, so they
 * read as floating beside the part instead of soldered to it. The 2.64 mm
 * leg spacing sits 0.1 mm off the breadboard pitch, well inside the 0.4 mm
 * snap that joins a leg to its hole.
 */
export function ledDefinition(profile: DiodeProfile, colourName: string): PartDefinition {
  return {
    id: `led-${profile === DIODE_PROFILES.blue ? 'blue' : 'generic'}`,
    name: `${colourName} LED`,
    category: 'output',
    widthMm: 10.583,
    heightMm: 13.229,
    component: { kind: 'led', profile },
    pins: [
      { id: 'anode', label: 'A', x: 6.61, y: 11.11 },
      { id: 'cathode', label: 'K', x: 3.97, y: 11.11 },
    ],
    bodyColour: profile === DIODE_PROFILES.blue ? '#2b4fd6' : '#d63b3b',
    legendColour: '#ffffff',
  };
}

/** Radial electrolytic capacitor; long lead is positive. */
export function capacitorDefinition(farads: number): PartDefinition {
  return {
    id: `capacitor-${farads}`,
    name: `${formatFarads(farads)} Capacitor`,
    category: 'passive',
    widthMm: 8,
    heightMm: 8,
    component: { kind: 'capacitor', farads },
    pins: [
      { id: 'positive', label: '+', x: 0, y: 4 },
      { id: 'negative', label: '-', x: 2.54, y: 4 },
    ],
    bodyColour: '#2b3f6b',
    legendColour: '#dfe6f5',
  };
}

/** 6 mm tactile switch. The two legs on each side are internally joined. */
export function buttonDefinition(): PartDefinition {
  return {
    id: 'button-tactile',
    name: 'Tactile Button',
    category: 'input',
    widthMm: 6,
    heightMm: 6,
    component: { kind: 'button' },
    pins: [
      { id: 'a', label: '', x: 0, y: 3, net: 'side-a' },
      { id: 'b', label: '', x: 5.08, y: 3, net: 'side-b' },
    ],
    momentary: true,
    bodyColour: '#111111',
    legendColour: '#e0e0e0',
  };
}

/** Rotary potentiometer, three pins in a row: end A, wiper, end B. */
export function potentiometerDefinition(ohms: number): PartDefinition {
  return {
    id: `potentiometer-${ohms}`,
    name: `${formatOhms(ohms)} Potentiometer`,
    category: 'input',
    widthMm: 12.7,
    heightMm: 9,
    component: { kind: 'potentiometer', ohms },
    pins: [
      { id: 'endA', label: '1', x: 0, y: 4.5 },
      { id: 'wiper', label: '2', x: 5.08, y: 4.5 },
      { id: 'endB', label: '3', x: 10.16, y: 4.5 },
    ],
    knobs: [WIPER_KNOB],
    bodyColour: '#2b2f3a',
    legendColour: '#d8dde8',
  };
}

export function formatOhms(ohms: number): string {
  if (ohms >= 1_000_000) return `${trimNumber(ohms / 1_000_000)}M`;
  if (ohms >= 1000) return `${trimNumber(ohms / 1000)}k`;
  return `${trimNumber(ohms)}`;
}

function formatFarads(farads: number): string {
  if (farads >= 1e-3) return `${trimNumber(farads * 1000)}mF`;
  if (farads >= 1e-6) return `${trimNumber(farads * 1e6)}uF`;
  if (farads >= 1e-9) return `${trimNumber(farads * 1e9)}nF`;
  return `${trimNumber(farads * 1e12)}pF`;
}

/** Trims float noise like 2.6000000000000005 down to a readable 2.6. */
function trimNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}