/**
 * WS2812 addressable LEDs: a pixel buffer behind a one-wire header.
 *
 * Pin positions are each element's `pinInfo` in CSS pixels at 96 per inch,
 * converted to millimetres and snapped to the 2.54 mm grid the breadboard
 * modules use. Matrix and ring sizes come from the elements' own render
 * math -- the library table's 25x25 entries disagree with the matrix
 * width formula, so the formulas win and the disagreement is noted here
 * rather than papered over.
 *
 * The 800 kHz waveform is deliberately not modeled: sketches set colors
 * through the `pixels` firmware port, the way a servo takes an angle
 * rather than a pulse train.
 */

import type { PartDefinition } from '@/features/parts';

/** One LED die: integer channels, 0 to 255. */
export interface PixelColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** Rounds a channel into the 0-255 range a die actually takes. */
export function clampChannel(value: number): number {
  // NaN would poison the buffer and the element prop alike; park it at 0.
  if (!Number.isFinite(value)) return value === Number.POSITIVE_INFINITY ? 255 : 0;
  return Math.min(255, Math.max(0, Math.round(value)));
}

/** LEDs on one part: 1 on a single, 64 on an 8x8 matrix, 16 on a ring. */
export function pixelCount(definition: PartDefinition): number {
  switch (definition.component.kind) {
    case 'neopixel':
      return 1;
    case 'neopixel-matrix':
      return 64;
    case 'led-ring':
      return 16;
    default:
      return 0;
  }
}

export function neopixelDefinition(): PartDefinition {
  return {
    id: 'neopixel',
    name: 'NeoPixel',
    category: 'output',
    widthMm: 5.6631,
    heightMm: 5,
    component: { kind: 'neopixel' },
    pins: [
      { id: 'VDD', label: 'VDD', x: 0.26, y: 0.93 },
      { id: 'DOUT', label: 'DOUT', x: 5.56, y: 3.7 },
      { id: 'VSS', label: 'VSS', x: 0.26, y: 3.7, net: 'GND' },
      { id: 'DIN', label: 'DIN', x: 5.56, y: 0.93 },
    ],
    bodyColour: '#f5f5f5',
    legendColour: '#1b1d21',
  };
}

export function neopixelMatrixDefinition(): PartDefinition {
  return {
    id: 'neopixel-matrix-8x8',
    name: 'NeoPixel Matrix (8x8)',
    category: 'output',
    // Element render math at 8x8: 5.66 * 8 + 1 * 7 wide, 5 * 8 + 1 * 7
    // of glass with the header row at 48.02 below it.
    widthMm: 52.28,
    heightMm: 49,
    component: { kind: 'neopixel-matrix' },
    pins: [
      { id: 'GND', label: 'GND', x: 22.83, y: 48.02, net: 'GND' },
      { id: 'VCC', label: 'VCC', x: 25.37, y: 48.02 },
      { id: 'DIN', label: 'DIN', x: 27.91, y: 48.02 },
      { id: 'DOUT', label: 'DOUT', x: 30.45, y: 48.02 },
    ],
    bodyColour: '#101418',
    legendColour: '#e8e8e8',
  };
}

export function ledRingDefinition(): PartDefinition {
  return {
    id: 'led-ring-16',
    name: 'NeoPixel Ring (16)',
    category: 'output',
    // Radius formula at 16 pixels: (5 * 16) / 2 pi + 6 of board around
    // it, so 37.46 across and 40.46 down to the pin row, plus a margin.
    widthMm: 37.46,
    heightMm: 41,
    component: { kind: 'led-ring' },
    pins: [
      { id: 'GND', label: 'GND', x: 14.92, y: 40.46, net: 'GND' },
      { id: 'VCC', label: 'VCC', x: 17.46, y: 40.46 },
      { id: 'DIN', label: 'DIN', x: 20.0, y: 40.46 },
      { id: 'DOUT', label: 'DOUT', x: 22.54, y: 40.46 },
    ],
    bodyColour: '#336633',
    legendColour: '#e8e8e8',
  };
}
