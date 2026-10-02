/**
 * The placeable part catalogue.
 *
 * One list, shared by the quick palette and the full browser, so a part can
 * never exist in one and not the other. Entries carry a short note because a
 * list of values says nothing about *which* 330 Ohm you should reach for -- a
 * current-limiting resistor and a pull-up are the same part in different
 * places, and telling them apart is what the note is for.
 */

import type { PartDefinition } from './catalog';
import { breadboardDefinition } from './breadboard';
import { DIODE_PROFILES } from './elements';
import {
  buttonDefinition,
  capacitorDefinition,
  formatOhms,
  ledDefinition,
  potentiometerDefinition,
  resistorDefinition,
} from './passives';
import { ili9341Definition, ssd1306Definition } from './display/part';

export interface CatalogueEntry {
  readonly id: string;
  readonly name: string;
  /** Drives the grouping in the browser; taken from the definition itself. */
  readonly group: PartDefinition['category'];
  readonly note: string;
  readonly make: () => PartDefinition;
}

const RESISTORS: ReadonlyArray<readonly [ohms: number, note: string]> = [
  [220, 'LED current limit. The usual first choice for a 3.3 V pin.'],
  [330, 'LED current limit, and the standard Arduino blink resistor.'],
  [1_000, 'Series resistance, LED limiting, and logic pull-ups.'],
  [10_000, 'The default pull-up and pull-down value on most boards.'],
  [100_000, 'High-value pull-ups, where 10k would load the line.'],
];

const CAPACITORS: ReadonlyArray<readonly [farads: number, note: string]> = [
  [100e-9, 'Decoupling. Goes across a supply pin, as close to the chip as it fits.'],
  [1e-6, 'General filtering and smoothing on a supply rail.'],
  [10e-6, 'Bulk smoothing and timing alongside a resistor.'],
  [470e-6, 'Reservoir cap for a regulator, and charge storage on a power rail.'],
];

const LEDS: ReadonlyArray<
  readonly [colour: 'red' | 'green' | 'yellow' | 'blue' | 'white', note: string]
> = [
  ['red', 'Lowest forward drop of the lot, so the easiest to light from 3.3 V.'],
  ['green', 'Standard "it works" indicator.'],
  ['yellow', 'A shade below red, and easier on the eye at low current.'],
  ['blue', 'Needs about 3.1 V forward, so it is dim on a 3.3 V pin.'],
  ['white', 'A blue die behind phosphor. Also around 3.1 V forward.'],
];

const POTS: ReadonlyArray<readonly [ohms: number, note: string]> = [
  [1_000, 'Low-impedance divider for a stiff signal, or a simple current sink.'],
  [10_000, 'The usual analog input pot, and the default value in most examples.'],
  [100_000, 'High-impedance divider, for inputs that draw very little.'],
];

const LED_NAMES: Readonly<Record<string, string>> = {
  red: 'Red',
  green: 'Green',
  yellow: 'Yellow',
  blue: 'Blue',
  white: 'White',
};

export const PART_CATALOGUE: readonly CatalogueEntry[] = [
  ...RESISTORS.map<CatalogueEntry>(([ohms, note]) => ({
    id: `resistor-${ohms}`,
    name: `${formatOhms(ohms)} Resistor`,
    group: 'passive',
    note,
    make: () => resistorDefinition(ohms),
  })),
  ...CAPACITORS.map<CatalogueEntry>(([farads, note]) => ({
    id: `capacitor-${farads}`,
    name: capacitorDefinition(farads).name,
    group: 'passive',
    note,
    make: () => capacitorDefinition(farads),
  })),
  {
    id: 'button-tactile',
    name: 'Tactile Button',
    group: 'input',
    note: 'Momentary contact. Wants a pull-up or pull-down, or it reads noise when open.',
    make: buttonDefinition,
  },
  ...POTS.map<CatalogueEntry>(([ohms, note]) => ({
    id: `potentiometer-${ohms}`,
    name: `${formatOhms(ohms)} Potentiometer`,
    group: 'input',
    note,
    make: () => potentiometerDefinition(ohms),
  })),
  ...LEDS.map<CatalogueEntry>(([colour, note]) => ({
    id: `led-${colour}`,
    name: `${LED_NAMES[colour]} LED`,
    group: 'output',
    note,
    make: () => ledDefinition(DIODE_PROFILES[colour], LED_NAMES[colour]),
  })),
  {
    id: 'ssd1306-128x64',
    name: '128x64 OLED (SSD1306)',
    group: 'output',
    note: 'I2C, four wires. Address 0x3C unless the module says otherwise.',
    make: () => ssd1306Definition(),
  },
  {
    id: 'ili9341-320x240',
    name: '2.4" TFT (ILI9341)',
    group: 'output',
    note: 'SPI, eight wires. Far more pixels than the OLED, and far more wires.',
    make: ili9341Definition,
  },
  {
    id: 'breadboard',
    name: 'Breadboard (830 point)',
    group: 'breadboard',
    note: 'The prototyping surface. Strip holes run in columns of five.',
    make: breadboardDefinition,
  },
];

/** Parts too large to sit on a breadboard strip, dropped below the bench. */
const LARGE_PARTS: Readonly<Record<string, true>> = {
  breadboard: true,
  'ssd1306-128x64': true,
  'ili9341-320x240': true,
};

export function isLargePart(id: string): boolean {
  return LARGE_PARTS[id] === true;
}

/** Group headings, in the order the browser shows them. */
export const CATALOGUE_GROUPS: ReadonlyArray<{
  readonly id: PartDefinition['category'];
  readonly label: string;
}> = [
  { id: 'passive', label: 'Passives' },
  { id: 'input', label: 'Inputs' },
  { id: 'output', label: 'Outputs' },
  { id: 'breadboard', label: 'Prototyping' },
];

