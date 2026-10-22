/**
 * Display modules.
 *
 * These are the breakout boards sold alongside the OLED and TFT panels: a glass
 * panel on a small carrier PCB, driven over a header. Pin names are the
 * silkscreen ones, because those are what a wiring tutorial will tell you to
 * use and the whole point is that the wiring has to be right.
 */

import type { PartDefinition } from '../catalog';
import {
  Ili9341,
  ILI9341_HEIGHT,
  ILI9341_LARGE_HEIGHT,
  ILI9341_LARGE_WIDTH,
  ILI9341_WIDTH,
} from './ili9341';
import { Ssd1306, SSD1306_HEIGHT, SSD1306_WIDTH } from './ssd1306';
import { Max7219 } from './max7219';
import type { SevenSegment } from './sevensegment';

/** Either controller model a display part can be driving. */
export type DisplayController = Ssd1306 | Ili9341 | SevenSegment | Max7219;

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
    glassMm: { width: 53.0, height: 39.8 },
  };
}

/**
 * 3.2" TFT, ILI9341, on the 8-pin SPI breakout with a socket for a card.
 *
 * The same controller as the 2.4" and the same eight wires, on a carrier about
 * half again as big. What changes is the RAM behind it: 320x480 rather than
 * 320x240, which is why this panel reads out as 480x320 when it is held the
 * way a map wants to be held and 320x480 when it is not.
 *
 * The card socket is decoration on the artwork rather than a part with pins.
 * Drawing a socket that accepted wires would be worse than not drawing one: a
 * hole a jumper could reach but not do anything with teaches the wrong lesson.
 */
export function ili9341LargeDefinition(): PartDefinition {
  const headerX = 12.78;
  // Along the bottom edge of a 56 mm carrier, on the usual 0.1" grid.
  const headerY = 51.0;
  const pitch = 2.54;

  return {
    id: 'ili9341-480x320',
    name: '3.2" TFT (ILI9341)',
    category: 'output',
    // A 3.2" module is wider than it is tall: the glass sits across the top of
    // the carrier with the header along the bottom edge. Sizing it portrait --
    // 57 x 109, the shape of a 2.4" -- left the 73 mm glass hanging 16 mm out
    // past the side of its own board, which is what a panel drawn off the end
    // of its carrier looks like.
    widthMm: 78.0,
    heightMm: 56.0,
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
    displayPixels: { width: ILI9341_LARGE_WIDTH, height: ILI9341_LARGE_HEIGHT },
    ramPixels: { width: ILI9341_LARGE_HEIGHT, height: ILI9341_LARGE_WIDTH },
    // The active area of a 3.2" panel, measured to fit the carrier above: the
    // glass has to end above the header strip or it is drawn over its own pins.
    glassMm: { width: 69.0, height: 46.0 },
  };
}

/**
 * 0.96" 128x64 OLED, SPI, 8-pin breakout.
 *
 * The same glass and controller as the I2C breakout, on the 8-pin SPI
 * module Wokwi draws: chip-select, data/command, and reset beside the
 * data and clock lines. Pin positions are the element's `pinInfo` in
 * CSS pixels at 96 per inch, converted to millimetres and snapped to
 * the grid.
 */
export function ssd1306SpiDefinition(): PartDefinition {
  return {
    id: 'ssd1306-128x64-spi',
    name: '128x64 OLED (SSD1306 SPI)',
    category: 'output',
    widthMm: 39.69,
    heightMm: 30.69,
    component: { kind: 'display', controller: 'ssd1306-spi', address: 0 },
    pins: [
      { id: 'VCC', label: '3V3', x: 22.09, y: 3.31, net: 'VCC' },
      { id: 'GND', label: 'GND', x: 27.34, y: 3.18, net: 'GND' },
      { id: 'CS', label: 'CS', x: 19.71, y: 3.31 },
      { id: 'RESET', label: 'RST', x: 17.07, y: 3.31 },
      { id: 'DC', label: 'D/C', x: 14.42, y: 3.31 },
      { id: 'MOSI', label: 'DIN', x: 9.66, y: 3.31 },
      { id: 'SCK', label: 'CLK', x: 12.04, y: 3.31 },
      { id: 'VIN', label: 'VIN', x: 24.74, y: 3.31, net: 'VCC' },
    ],
    bodyColour: '#101418',
    legendColour: '#7dd3fc',
    displayPixels: { width: SSD1306_WIDTH, height: SSD1306_HEIGHT },
  };
}

/**
 * Instantiates the controller model a display part drives.
 *
 * The colour panel is sized from its own RAM rather than assumed, because the
 * 2.4" and the 3.2" are the same chip on different glass: 320x240 against
 * 320x480.
 *
 * Note which way round that is. `ramPixels` is the panel's memory and
 * `displayPixels` is what a user sees, and for the 3.2" they are the same
 * rectangle the other way up -- the RAM is portrait and the module is fitted
 * landscape. So the controller is built portrait and then *turned* to match the
 * glass, rather than being told the answer twice and expected to keep them
 * consistent. One of the two numbers is the truth about the hardware and the
 * other is a fact about how it is mounted, and starting in the wrong one means
 * a map drawn before the first rotation lands on the wrong screen.
 */
export function createController(definition: PartDefinition): DisplayController | null {
  const component = definition.component;
  if (component.kind !== 'display') return null;
  if (component.controller === 'ssd1306-spi') return new Ssd1306();
  if (component.controller === 'ssd1306') return new Ssd1306(component.address);
  if (component.controller === 'max7219') return new Max7219();

  const ram = definition.ramPixels;
  const panel = new Ili9341(ram?.width ?? ILI9341_WIDTH, ram?.height ?? ILI9341_HEIGHT);

  const visible = definition.displayPixels;
  if (visible && visible.width > panel.width) {
    panel.setRotation(1);
  }

  return panel;
}
