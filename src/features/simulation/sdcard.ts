/**
 * MicroSD breakout: seven header pins over a card that holds text files.
 *
 * Pin positions are the element's `pinInfo` in CSS pixels at 96 per inch,
 * converted to millimetres: a single column at x 76.734 px with the bus
 * down it, snapped to the 2.54 mm grid the breadboard modules use. Only
 * ground is an internal net; everything else is topology the firmware
 * port reads through. FAT, the SPI command protocol, and binary files
 * are explicitly not modeled -- files live in the engine store.
 */

import type { PartDefinition } from '@/features/parts';

/** Flat-file capacity of one virtual card, in text length units. */
export const SD_CARD_BYTES = 1048576;

export function microsdDefinition(): PartDefinition {
  return {
    id: 'microsd-card',
    name: 'MicroSD Card',
    category: 'input',
    widthMm: 21.6,
    heightMm: 20.4,
    component: { kind: 'microsd' },
    pins: [
      { id: 'CD', label: 'CD', x: 20.3, y: 2.48 },
      { id: 'DO', label: 'DO', x: 20.3, y: 4.99 },
      { id: 'GND', label: 'GND', x: 20.3, y: 7.53, net: 'GND' },
      { id: 'SCK', label: 'SCK', x: 20.3, y: 10.1 },
      { id: 'VCC', label: 'VCC', x: 20.3, y: 12.6 },
      { id: 'DI', label: 'DI', x: 20.3, y: 15.2 },
      { id: 'CS', label: 'CS', x: 20.3, y: 17.7 },
    ],
    bodyColour: '#1b1d21',
    legendColour: '#e8e8e8',
  };
}
