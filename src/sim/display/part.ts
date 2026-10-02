/**
 * Display modules.
 *
 * These are the breakout boards sold alongside the OLED and TFT panels: a glass
 * panel on a small carrier PCB, driven over a header. Pin names are the
 * silkscreen ones, because those are what a wiring tutorial will tell you to
 * use and the whole point is that the wiring has to be right.
 */

import type { PartDefinition } from '../catalog';
import { Ili9341, ILI9341_HEIGHT, ILI9341_WIDTH } from './ili9341';
import { Ssd1306, SSD1306_HEIGHT, SSD1306_WIDTH } from './ssd1306';

/** Either controller model a display part can be driving. */
export type DisplayController = Ssd1306 | Ili9341;

/**
 * 0.96" 128x64 OLED, I2C, 4-pin breakout.
 *
 * The panel is 27.3 x 27.9 mm on a roughly 27 x 28 mm carrier, which puts it at
 * true scale next to a breadboard hole strip.
 */
export function ssd1306Definition(address = 0x3c): PartDefinition {
  const headerX = 2.54;
  const firstPinY = 32.0;
  const pitch = 2.54;

  return {
    id: `ssd1306-128x64-${address.toString(16)}`,
    name: '128x64 OLED (SSD1306)',
    category: 'output',
    widthMm: 32.3,
    heightMm: 37.9,
    component: { kind: 'display', controller: 'ssd1306', address },
    pins: [
      // Only ground is an internal connection. SCL and SDA are separate nets:
      // joining them here would short the bus and make every wiring mistake
      // invisible.
      { id: 'GND', label: 'GND', x: headerX, y: firstPinY, net: 'GND' },
      { id: 'VCC', label: 'VCC', x: headerX + pitch, y: firstPinY },
      { id: 'SCL', label: 'SCL', x: headerX + 2 * pitch, y: firstPinY },
      { id: 'SDA', label: 'SDA', x: headerX + 3 * pitch, y: firstPinY },
    ],
    bodyColour: '#101418',
    legendColour: '#7dd3fc',
    displayPixels: { width: SSD1306_WIDTH, height: SSD1306_HEIGHT },
  };
}

/**
 * 2.4" TFT, ILI9341, on the usual 8-pin SPI breakout.
 *
 * The carrier is 46.5 x 77.6 mm with its header along the bottom edge on a
 * 2.54 mm pitch, which is the geometry of the `wokwi-ili9341` element the
 * bench draws. Matching it matters: the artwork and the pin coordinates have to
 * be the same part, or a jumper lands beside the pin it names.
 */
export function ili9341Definition(): PartDefinition {
  const headerX = 12.78;
  const headerY = 76.0;
  const pitch = 2.54;

  return {
    id: 'ili9341-320x240',
    name: '2.4" TFT (ILI9341)',
    category: 'output',
    widthMm: 46.5,
    heightMm: 77.6,
    component: { kind: 'display', controller: 'ili9341', address: 0 },
    pins: [
      { id: 'VCC', label: 'VCC', x: headerX, y: headerY, net: 'VCC' },
      { id: 'GND', label: 'GND', x: headerX + pitch, y: headerY, net: 'GND' },
      { id: 'CS', label: 'CS', x: headerX + 2 * pitch, y: headerY },
      { id: 'RESET', label: 'RST', x: headerX + 3 * pitch, y: headerY },
      { id: 'DC', label: 'D/C', x: headerX + 4 * pitch, y: headerY },
      { id: 'MOSI', label: 'DIN', x: headerX + 5 * pitch, y: headerY },
      { id: 'SCK', label: 'CLK', x: headerX + 6 * pitch, y: headerY },
      { id: 'LED', label: 'LED', x: headerX + 7 * pitch, y: headerY },
    ],
    bodyColour: '#0b1220',
    legendColour: '#93c5fd',
    displayPixels: { width: ILI9341_WIDTH, height: ILI9341_HEIGHT },
  };
}

/** Instantiates the controller model a display part drives. */
export function createController(definition: PartDefinition): DisplayController | null {
  const component = definition.component;
  if (component.kind !== 'display') return null;
  return component.controller === 'ssd1306'
    ? new Ssd1306(component.address)
    : new Ili9341();
}