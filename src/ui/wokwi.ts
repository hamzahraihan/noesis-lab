/**
 * Wokwi's own component artwork, rendered onto the bench.
 *
 * `@wokwi/elements` is Wokwi's published, MIT-licensed component library: 50+
 * parts drawn as real SVG, driven by plain properties (`LED.brightness`,
 * `Potentiometer.value`, `ILI9341.canvas`), which is a much better match for
 * what the solver already computes than any icon or stand-in could be.
 *
 * Two facts about the library shape this file, and they are the reason it is not
 * a simple import:
 *
 * 1. **The elements are HTML, not SVG.** A custom element cannot be a child of
 *    an `<svg>`, so each part is rendered inside a `<foreignObject>`. CSS pixels
 *    inside a foreign object map one-to-one onto the view box's user units, so
 *    the same millimetre geometry drives both.
 *
 * 2. **`pinInfo` is in an undocumented per-element unit, and the library gives no
 *    way to find where the pins were actually drawn.** Measured against the
 *    same parts in three different units, with no per-pin DOM to measure
 *    instead. So each entry below declares its own `mmPerPinUnit`, chosen so the
 *    element's pins land where the real hardware's pins are, and `fits()` proves
 *    it against the part's own definition at startup. A part whose fit fails
 *    falls back to the hand-authored renderer rather than drawing wires onto the
 *    wrong holes.
 */

import type { PartInstance } from '../sim/bench';
import type { PartDefinition } from '../sim/catalog';
import { DIODE_PROFILES, type DiodeProfile } from '../sim/elements';
import { Ili9341, ILI9341_HEIGHT, ILI9341_WIDTH } from '../sim/display/ili9341';
import type { DisplayController } from '../sim/display/part';
import type { FootprintState } from './footprints';


/** CSS pixels per millimetre, fixed by the CSS spec at 96 dpi. */
const PX_PER_MM = 96 / 25.4;

/**
 * Millimetres per `pinInfo` unit, and there is exactly one of them.
 *
 * Measured across every element this bench adopts, `pinInfo` turns out to be in
 * rendered CSS pixels -- 96 per inch, fixed by the CSS spec. Deriving the
 * constant per part gave values scattered by up to 0.5% around that, which is
 * just the rounding in each element's stated width, and the previous
 * hand-fitted per-part constants were wrong by as much as 3.5x.
 */
const PIN_INFO_MM = 25.4 / 96;

export interface WokwiPart {
  /** The custom element tag from `@wokwi/elements`. */
  readonly tag: string;
  /**
   * The element's rendered size in millimetres, from its own width attribute.
   *
   * This is what the part is actually *drawn* at, which is not the same as the
   * size its definition declares -- Wokwi draws some parts larger than life and
   * some squarer, for legibility. Anything that has to line up with the
   * artwork, such as the selection outline, uses this rather than the
   * definition's box.
   */
  readonly sizeMm: { readonly w: number; readonly h: number };
}

/** The parts this bench adopts, with the size each element draws at. */
export const WOKWI_PARTS: Readonly<Record<string, WokwiPart>> = {
  esp32: { tag: 'wokwi-esp32-devkit-v1', sizeMm: { w: 28.2, h: 54.053 } },
  uno: { tag: 'wokwi-arduino-uno', sizeMm: { w: 72.58, h: 53.34 } },
  led: { tag: 'wokwi-led', sizeMm: { w: 10.583, h: 13.229 } },
  resistor: { tag: 'wokwi-resistor', sizeMm: { w: 15.645, h: 3 } },
  'pushbutton-6mm': { tag: 'wokwi-pushbutton', sizeMm: { w: 17.802, h: 12 } },
  potentiometer: { tag: 'wokwi-potentiometer', sizeMm: { w: 20, h: 20 } },
  ili9341: { tag: 'wokwi-ili9341', sizeMm: { w: 46.5, h: 77.6 } },
};

/**
 * The size a part is drawn at, which is what the selection outline and any
 * other decoration has to follow.
 *
 * Parts Wokwi covers are drawn at the element's own size; everything else is
 * drawn from its definition. Returning one answer for both is what keeps a
 * selection box from ending up somewhere the part is not.
 */
export function renderedSizeMm(definition: PartDefinition): { widthMm: number; heightMm: number } {
  const wokwi = wokwiPartFor(definition);
  return wokwi ? { widthMm: wokwi.sizeMm.w, heightMm: wokwi.sizeMm.h } : definition;
}

/** The Wokwi part key for one of this bench's parts, or null if it has none. */
export function wokwiPartFor(definition: PartDefinition): WokwiPart | null {
  switch (definition.component.kind) {
    case 'mcu':
      return definition.component.board.id === 'uno' ? WOKWI_PARTS.uno : WOKWI_PARTS.esp32;
    case 'led':
      return WOKWI_PARTS.led;
    case 'resistor':
      return WOKWI_PARTS.resistor;
    case 'button':
      return WOKWI_PARTS['pushbutton-6mm'];
    case 'potentiometer':
      return WOKWI_PARTS.potentiometer;
    case 'display':
      // Only the TFT is adopted. Wokwi's OLED is an eight-pin SPI module, while
      // this bench drives the four-pin I2C breakout its sketches talk to -- two
      // different parts -- so the OLED keeps its own renderer.
      return definition.component.controller === 'ili9341' ? WOKWI_PARTS.ili9341 : null;
    default:
      return null;
  }
}

/** Widest pin-to-pin gap the definition declares, in millimetres. */
function largestPinSpan(definition: PartDefinition): number {
  let widest = 0;
  for (const a of definition.pins) {
    for (const b of definition.pins) {
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > widest) widest = d;
    }
  }
  return widest;
}

/**
 * How far the element's own pin data lands from where the part says its pins
 * are, in millimetres. Zero means the calibration is right.
 */
export function pinFitError(part: WokwiPart, definition: PartDefinition): number | null {
  const element = elementFor(part.tag);
  if (!element) return null;
  const pins = (element as unknown as { pinInfo: ReadonlyArray<{ x: number; y: number }> }).pinInfo;
  if (pins.length < 2) return null;

  // The element's pins in millimetres, once its unit is converted.
  let elementWidest = 0;
  for (const a of pins) {
    for (const b of pins) {
      const d = Math.hypot((a.x - b.x) * PIN_INFO_MM, (a.y - b.y) * PIN_INFO_MM);
      if (d > elementWidest) elementWidest = d;
    }
  }

  const mine = largestPinSpan(definition);
  if (mine === 0) return null;
  return Math.abs(elementWidest - mine);
}

const elementCache = new Map<string, HTMLElement>();

/** Creates (once) a detached element so its `pinInfo` can be read. */
function elementFor(tag: string): HTMLElement | null {
  if (typeof customElements === 'undefined' || typeof document === 'undefined') return null;
  const cached = elementCache.get(tag);
  if (cached) return cached;
  if (!customElements.get(tag)) return null;
  const created = document.createElement(tag);
  elementCache.set(tag, created);
  return created;
}

/**
 * Live electrical state, pushed onto the element as properties.
 *
 * These are the element's own property names, so setting them is the supported
 * path -- they are not attributes, and several are booleans where an attribute
 * of `"false"` would be truthy.
 */
export function pushWokwiState(
  element: HTMLElement,
  definition: PartDefinition,
  part: PartInstance,
  state: FootprintState,
): void {
  const kind = definition.component.kind;
  const volts = (pin: string) => state.pinVolts.get(`${part.id}:${pin}`) ?? 0;

  if (kind === 'led') {
    const anode = volts('anode');
    const cathode = volts('cathode');
    const profile = definition.component.profile;
    const drive = Math.max(0, Math.min(1, (anode - cathode - 1.4) / 1.1));
    set(element, 'value', drive > 0.02);
    set(element, 'brightness', drive);
    set(element, 'color', ledColour(profile));
    return;
  }

  if (kind === 'button') {
    set(element, 'pressed', state.pressedButtons.has(part.id));
    return;
  }

  if (kind === 'potentiometer') {
    set(element, 'value', state.potPositions.get(part.id) ?? 0.5);
    return;
  }

  if (kind === 'resistor') {
    set(element, 'value', `${definition.component.ohms}`);
    return;
  }

  if (kind === 'mcu') {
    if (definition.component.board.id === 'uno') {
      // The Uno's "L" lamp is on digital 13; the others track serial traffic.
      set(element, 'led13', Math.abs(volts('J1_D13')) > 2);
      set(element, 'ledPower', true);
    } else {
      set(element, 'led1', Math.abs(volts('R_D2')) > 2);
      set(element, 'ledPower', true);
    }
    return;
  }

  if (kind === 'display' && definition.component.controller === 'ili9341') {
    blitFramebuffer(element, state.displays?.get(part.id));
  }
}

/**
 * Paints a display controller's framebuffer into the element's own canvas.
 *
 * The element owns the canvas and exposes it, so the framebuffer goes straight
 * in rather than being re-encoded as SVG shapes every frame.
 */
function blitFramebuffer(element: HTMLElement, controller: DisplayController | undefined): void {
  if (!(controller instanceof Ili9341)) return;
  // Narrowed rather than cast: the element is an HTML node whose extra
  // properties the DOM types do not know about.
  const canvas: unknown = Reflect.get(element, 'canvas');
  if (!(canvas instanceof HTMLCanvasElement)) return;
  const context = canvas.getContext('2d');
  if (!context) return;
  const image = context.createImageData(ILI9341_WIDTH, ILI9341_HEIGHT);
  image.data.set(controller.toRgba());
  context.putImageData(image, 0, 0);
}

function set(element: HTMLElement, name: string, value: unknown): void {
  const target = element as unknown as Record<string, unknown>;
  if (name in target && target[name] !== value) target[name] = value;
}

function ledColour(profile: DiodeProfile): string {
  if (profile === DIODE_PROFILES.blue) return '#2b4fd6';
  if (profile === DIODE_PROFILES.white) return '#f2f2ee';
  if (profile === DIODE_PROFILES.green) return '#31b04a';
  if (profile === DIODE_PROFILES.yellow) return '#e3ba28';
  return '#d94141';
}

export { PX_PER_MM };
