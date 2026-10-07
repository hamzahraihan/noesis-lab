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

import type { PartInstance } from '@/features/simulation';
import type { PartDefinition, Rotation, SensorVariant } from '@/features/parts';
import { Ili9341, ILI9341_HEIGHT, ILI9341_WIDTH } from '@/features/parts';
import { Ssd1306, SSD1306_HEIGHT, SSD1306_WIDTH } from '@/features/parts';
import { DIODE_PROFILES, type DiodeProfile } from '@/features/simulation';
import { WIPER_KNOB } from '@/features/parts';
import {
  HORIZONTAL_KNOB,
  SLIDE_POSITION_KNOB,
  VERTICAL_KNOB,
} from '@/features/parts';
import { DIGIT_KNOB } from '@/features/simulation';
import type { DisplayController } from '@/features/parts';
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
  // Bare pixels to millimetres (px * 25.4 / 96): the LED states 40 x 50 px.
  led: { tag: 'wokwi-led', sizeMm: { w: 10.583, h: 13.229 } },
  resistor: { tag: 'wokwi-resistor', sizeMm: { w: 15.645, h: 3 } },
  'pushbutton-6mm': { tag: 'wokwi-pushbutton-6mm', sizeMm: { w: 7.413, h: 6 } },
  pushbutton: { tag: 'wokwi-pushbutton', sizeMm: { w: 17.802, h: 12 } },
  mega: { tag: 'wokwi-arduino-mega', sizeMm: { w: 102.66, h: 50.8 } },
  nano: { tag: 'wokwi-arduino-nano', sizeMm: { w: 44.9, h: 17.8 } },
  rp2040: { tag: 'wokwi-nano-rp2040-connect', sizeMm: { w: 44.573, h: 17.956 } },
  franzininho: { tag: 'wokwi-franzininho', sizeMm: { w: 64, h: 30 } },
  ili9341: { tag: 'wokwi-ili9341', sizeMm: { w: 46.5, h: 77.6 } },
  // Bare pixels to millimetres (px * 25.4 / 96): the element states
  // 150 x 116 with no unit.
  ssd1306: { tag: 'wokwi-ssd1306', sizeMm: { w: 39.69, h: 30.69 } },
  photoresistor: { tag: 'wokwi-photoresistor-sensor', sizeMm: { w: 45.95, h: 16.267 } },
  thermistor: { tag: 'wokwi-ntc-temperature-sensor', sizeMm: { w: 35.826, h: 19 } },
  'tilt-switch': { tag: 'wokwi-tilt-switch', sizeMm: { w: 23.4, h: 14.7 } },
  'slide-switch': { tag: 'wokwi-slide-switch', sizeMm: { w: 8.5, h: 9.23 } },
  sonar: { tag: 'wokwi-hc-sr04', sizeMm: { w: 45, h: 25 } },
  stepper: { tag: 'wokwi-stepper-motor', sizeMm: { w: 42, h: 42 } },
  'biaxial-stepper': { tag: 'wokwi-biaxial-stepper', sizeMm: { w: 56, h: 67.5 } },
  dht22: { tag: 'wokwi-dht22', sizeMm: { w: 15.1, h: 30.885 } },
  microsd: { tag: 'wokwi-microsd-card', sizeMm: { w: 21.6, h: 20.4 } },
  'ir-remote': { tag: 'wokwi-ir-remote', sizeMm: { w: 40, h: 83.653 } },
  'rotary-dialer': { tag: 'wokwi-rotary-dialer', sizeMm: { w: 70.4, h: 75.6 } },
  neopixel: { tag: 'wokwi-neopixel', sizeMm: { w: 5.6631, h: 5 } },
  'neopixel-matrix': { tag: 'wokwi-neopixel-matrix', sizeMm: { w: 52.28, h: 49 } },
  'led-ring': { tag: 'wokwi-led-ring', sizeMm: { w: 37.46, h: 41 } },
  relay: { tag: 'wokwi-ks2e-m-dc5', sizeMm: { w: 21, h: 10 } },
  'rotary-encoder': { tag: 'wokwi-ky-040', sizeMm: { w: 30.815, h: 18.63 } },
  joystick: { tag: 'wokwi-analog-joystick', sizeMm: { w: 27.2, h: 31.8 } },
  'rgb-led': { tag: 'wokwi-rgb-led', sizeMm: { w: 11.148, h: 19.204 } },
  buzzer: { tag: 'wokwi-buzzer', sizeMm: { w: 17, h: 20 } },
  sensor: { tag: 'wokwi-pir-motion-sensor', sizeMm: { w: 24, h: 24.448 } },
  'sound-sensor': { tag: 'wokwi-big-sound-sensor', sizeMm: { w: 37.056, h: 13.346 } },
  'heart-beat': { tag: 'wokwi-heart-beat-sensor', sizeMm: { w: 23.4, h: 20.943 } },
  'gas-sensor': { tag: 'wokwi-gas-sensor', sizeMm: { w: 36.232, h: 16.617 } },
  'flame-sensor': { tag: 'wokwi-flame-sensor', sizeMm: { w: 52.904, h: 16.267 } },
  'dip-switch': { tag: 'wokwi-dip-switch-8', sizeMm: { w: 21.926, h: 14.646 } },
  'small-sound-sensor': { tag: 'wokwi-small-sound-sensor', sizeMm: { w: 35.211, h: 13.346 } },
  'led-bar-graph': { tag: 'wokwi-led-bar-graph', sizeMm: { w: 10.1, h: 25.5 } },
  'ir-receiver': { tag: 'wokwi-ir-receiver', sizeMm: { w: 16.178, h: 23.482 } },
  'slide-potentiometer': { tag: 'wokwi-slide-potentiometer', sizeMm: { w: 55, h: 29 } },
  keypad: { tag: 'wokwi-membrane-keypad', sizeMm: { w: 70.336, h: 91 } },
  '7segment': { tag: 'wokwi-7segment', sizeMm: { w: 12.55, h: 22 } },
  // Kept for inventory only: the rotary pot keeps its hand-authored renderer
  // because the element's pins (29/39/49 px, 5.3 mm span) do not land where
  // this bench's 10.16 mm header is, so adopting it would miswire it.
  potentiometer: { tag: 'wokwi-potentiometer', sizeMm: { w: 20, h: 20 } },
  ds1307: { tag: 'wokwi-ds1307', sizeMm: { w: 25.8, h: 22.212 } },
  mpu6050: { tag: 'wokwi-mpu6050', sizeMm: { w: 21.6, h: 16.2 } },
  hx711: { tag: 'wokwi-hx711', sizeMm: { w: 58, h: 43 } },
  // 16x2 glass: panel 56.2 x 11.5 mm plus the carrier around it (see
  // lcd1602-element render(): panelWidth + 23.8, panelHeight + 24.5).
  lcd1602: { tag: 'wokwi-lcd1602', sizeMm: { w: 80, h: 36 } },
  lcd2004: { tag: 'wokwi-lcd2004', sizeMm: { w: 94.05, h: 47.5 } },
  servo: { tag: 'wokwi-servo', sizeMm: { w: 45, h: 31.63 } },
};

/**
 * Which element draws which board.
 *
 * Keyed by the board's own id rather than by "is this an Arduino", because the
 * pin layouts are as different as the outlines: a Mega is twice the width of an
 * Uno and an RP2040 has no L lamp at all.
 */
const BOARD_ELEMENTS: Readonly<Record<string, WokwiPart>> = {
  esp32: WOKWI_PARTS.esp32,
  uno: WOKWI_PARTS.uno,
  mega: WOKWI_PARTS.mega,
  nano: WOKWI_PARTS.nano,
  rp2040: WOKWI_PARTS.rp2040,
  franzininho: WOKWI_PARTS.franzininho,
};

/**
 * Which element draws which comparator sensor board.
 *
 * Five boards, one circuit, five pieces of artwork: the variant picks the
 * element and the size it draws at, and nothing else about the part differs.
 */
const SENSOR_ELEMENTS: Readonly<Record<SensorVariant, WokwiPart>> = {
  pir: WOKWI_PARTS.sensor,
  sound: WOKWI_PARTS['sound-sensor'],
  soundSmall: WOKWI_PARTS['small-sound-sensor'],
  heartbeat: WOKWI_PARTS['heart-beat'],
  gas: WOKWI_PARTS['gas-sensor'],
  flame: WOKWI_PARTS['flame-sensor'],
};

/**
 * The lamp each sensor element lights for its digital output.
 *
 * Keyed by variant because the elements name theirs differently and two of the
 * six carry none at all. The sound board draws two lamps it does not label, so
 * only the one beside `DOUT` is driven -- `set` leaves a property an element
 * does not have alone, which is what makes the missing ones harmless.
 */
const SENSOR_LAMP: Readonly<Partial<Record<SensorVariant, string>>> = {
  sound: 'led1',
  soundSmall: 'ledSignal',
  gas: 'ledD0',
  flame: 'ledSignal',
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

/**
 * Where a part's artwork actually paints, relative to the part's origin.
 *
 * The artwork is centred on the definition box, so the two share a centre and
 * a rotation pivot: turning the part about the definition centre turns the
 * artwork about its own. Where the boxes already match this is the origin
 * itself and nothing moves; where they differ (the tactile button draws
 * 7.413 mm wide in a 6 mm box) the artwork shifts half the difference rather
 * than hanging off one side, which is what left presses on the visible body
 * finding no part after a turn.
 *
 * The selection outline, the pointer hit test and the artwork all read this
 * one answer, so the three can never disagree about where the part is.
 */
export function artworkBox(
  definition: PartDefinition,
  rotation: Rotation,
): { dx: number; dy: number; widthMm: number; heightMm: number } {
  const drawn = renderedSizeMm(definition);
  const swapped = rotation === 90 || rotation === 270;
  const defW = swapped ? definition.heightMm : definition.widthMm;
  const defH = swapped ? definition.widthMm : definition.heightMm;
  const artW = swapped ? drawn.heightMm : drawn.widthMm;
  const artH = swapped ? drawn.widthMm : drawn.heightMm;
  return { dx: (defW - artW) / 2, dy: (defH - artH) / 2, widthMm: artW, heightMm: artH };
}

/** The Wokwi part key for one of this bench's parts, or null if it has none. */
export function wokwiPartFor(definition: PartDefinition): WokwiPart | null {
  switch (definition.component.kind) {
    case 'mcu':
      return BOARD_ELEMENTS[definition.component.board.id] ?? null;
    case 'led':
      return WOKWI_PARTS.led;
    case 'resistor':
      // Intentional fallback: the element spans 15.56 mm while the definition
      // spans 10.16 mm on the breadboard grid, so the right-hand wire would
      // land 5.4 mm inside the body. The hand-authored body draws its leads
      // at the definition pins.
      return null;
    case 'button':
      return WOKWI_PARTS['pushbutton-6mm'];
    case 'potentiometer':
      // Intentional fallback: see the inventory note on WOKWI_PARTS.potentiometer.
      return null;
    case 'photoresistor':
      return WOKWI_PARTS.photoresistor;
    case 'thermistor':
      return WOKWI_PARTS.thermistor;
    case 'tilt-switch':
      return WOKWI_PARTS['tilt-switch'];
    case 'slide-switch':
      return WOKWI_PARTS['slide-switch'];
    case 'relay':
      return WOKWI_PARTS.relay;
    case 'rotary-encoder':
      return WOKWI_PARTS['rotary-encoder'];
    case 'sonar':
      return WOKWI_PARTS.sonar;
    case 'stepper':
      return WOKWI_PARTS.stepper;
    case 'biaxial-stepper':
      return WOKWI_PARTS['biaxial-stepper'];
    case 'dht':
      return WOKWI_PARTS.dht22;
    case 'microsd':
      return WOKWI_PARTS.microsd;
    case 'ir-remote':
      return WOKWI_PARTS['ir-remote'];
    case 'rotary-dialer':
      return WOKWI_PARTS['rotary-dialer'];
    case 'neopixel':
      return WOKWI_PARTS.neopixel;
    case 'neopixel-matrix':
      return WOKWI_PARTS['neopixel-matrix'];
    case 'led-ring':
      return WOKWI_PARTS['led-ring'];
    case 'joystick':
      return WOKWI_PARTS.joystick;
    case 'rgb-led':
      return WOKWI_PARTS['rgb-led'];
    case 'buzzer':
      return WOKWI_PARTS.buzzer;
    case 'sensor-module':
      return SENSOR_ELEMENTS[definition.component.variant];
    case 'dip-switch':
      return WOKWI_PARTS['dip-switch'];
    case 'led-bar-graph':
      return WOKWI_PARTS['led-bar-graph'];
    case 'ir-receiver':
      return WOKWI_PARTS['ir-receiver'];
    case 'slide-potentiometer':
      return WOKWI_PARTS['slide-potentiometer'];
    case 'keypad':
      return WOKWI_PARTS.keypad;
    case '7segment':
      return WOKWI_PARTS['7segment'];
    case 'i2c-sensor':
      return WOKWI_PARTS[definition.component.device];
    case 'lcd':
      return definition.component.variant === '1602' ? WOKWI_PARTS.lcd1602 : WOKWI_PARTS.lcd2004;
    case 'servo':
      return WOKWI_PARTS.servo;
    case 'display':
      /*
       * The colour TFT keeps the hand-authored renderer, like the I2C OLED.
       *
       * Wokwi has an element for it, but that element draws a 240x320 glass --
       * the panel rotated a quarter turn, which is how it sits on a desk -- and
       * nothing here knows how to transpose a framebuffer into it. Feeding it
       * nothing leaves it permanently black, which is how a TFT a sketch had
       * plainly filled with colour came to draw as a blank rectangle.
       *
       * The hand-authored path blits the framebuffer onto a canvas of exactly
       * the panel's own 320x240, so it is both the one that works and the one
       * with nothing to get wrong.
       */
      // The SPI OLED is the eight-pin module Wokwi does draw, and it draws it
      // from its own text buffer rather than a canvas, so it keeps that path.
      return definition.component.controller === 'ssd1306-spi'
        ? WOKWI_PARTS.ssd1306
        : null;
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

  if (kind === 'joystick') {
    /*
     * The element takes its stick position as a step from centre, with left
     * and up positive, and the far end of the stick reads high -- which is
     * how the axes are wired, so the picture and the pin agree. The select
     * contact is a momentary one as well, and is pushed below.
     */
    set(element, 'xValue', 1 - state.controls.knob(part.id, HORIZONTAL_KNOB) * 2);
    set(element, 'yValue', state.controls.knob(part.id, VERTICAL_KNOB) * 2 - 1);
  }

  if (definition.momentary) {
    set(element, 'pressed', state.controls.isPressed(part.id));
    return;
  }

  if (kind === 'potentiometer' || kind === 'slide-potentiometer') {
    set(element, 'value', state.controls.knob(part.id, WIPER_KNOB));
    return;
  }

  if (kind === 'led-bar-graph' || kind === '7segment') {
    /*
     * Both are a set of diodes on one package, so brightness is the forward
     * bias the solver reports on each one -- exactly as a single LED is lit,
     * and for a display segment rather than a channel that matters twice over.
     */
    pushSegmentLevels(element, definition, part, state);
    return;
  }

  if (kind === 'keypad') {
    /*
     * The keypad has no state of its own: a key is closed because a sketch is
     * scanning it, which the solver already reflects in the nets. The element
     * only needs to know whether its connector is fitted, because without one
     * it draws no pin holes at all.
     */
    set(element, 'connector', true);
    return;
  }

  if (kind === 'servo') {
    set(element, 'angle', state.servos?.get(part.id)?.angle ?? 90);
    return;
  }

  if (kind === 'stepper') {
    // The element draws its rotor from `angle`; the biaxial one exposes no
    // such prop, so it stays stateless artwork like the relay.
    set(element, 'angle', state.steppers?.get(part.id) ?? 0);
    return;
  }

  if (kind === 'neopixel') {
    // Matrix and ring expose no per-pixel colors from outside, so only the
    // single paints live; the rest fall through as stateless artwork.
    const color = state.pixels?.get(part.id)?.[0];
    set(element, 'r', color?.r ?? 0);
    set(element, 'g', color?.g ?? 0);
    set(element, 'b', color?.b ?? 0);
    return;
  }

  if (kind === 'lcd') {
    /*
     * The element draws a character LCD from the panel's text rather than from
     * a canvas, so what goes across is the characters that arrived as pins --
     * which is the one place a miswired header would show up as wrong text.
     */
    const panel = state.lcds?.get(part.id);
    if (panel) {
      const shape = panel.shape;
      set(element, 'cols', shape.columns);
      // The element lays its text out in a single run, so the rows are handed
      // over as one string with a newline at each break -- a character LCD's
      // rows are contiguous in display RAM, and the element draws them in turn.
      set(element, 'text', panel.text().replace(/[ \n]+$/, ''));
      set(element, 'backlight', panel.backlightOn);
    }
    return;
  }

  if (kind === 'ir-receiver') {
    set(element, 'pressed', Math.abs(volts('DAT') - volts('GND')) < 1.5);
    return;
  }

  if (kind === 'mcu') {
    /*
     * Every Arduino board lights its L lamp from digital 13 and the ESP32 from
     * digital 2, so the lamp is found by pin number rather than by a header id
     * -- no two boards spell those holes the same way. A board whose element
     * draws no such lamp simply has no property to set.
     */
    const lampGpio = definition.component.board.id === 'esp32' ? 2 : 13;
    const lampPin = definition.boardPins?.find((pin) => pin.gpio === lampGpio)?.id;
    set(element, 'led13', lampPin !== undefined && Math.abs(volts(lampPin)) > 2);
    set(element, 'ledPower', true);
    return;
  }

  if (kind === 'slide-switch') {
    set(element, 'value', state.controls.knob(part.id, SLIDE_POSITION_KNOB) >= 0.5 ? 1 : 0);
    return;
  }

  if (kind === 'rotary-dialer') {
    // The operator's setting, not the latched value: the knob is what the
    // finger turns, and the latch equals it whenever the dial is held.
    set(element, 'digit', String(Math.round(state.controls.knob(part.id, DIGIT_KNOB))));
    return;
  }

  if (kind === 'photoresistor') {
    set(element, 'ledPower', Math.abs(volts('VCC') - volts('GND')) > 0.5);
    set(element, 'ledDO', Math.abs(volts('DO') - volts('GND')) > 1.5);
    return;
  }

  if (kind === 'sensor-module') {
    // Every one of these boards pulls its output low when the sensor trips.
    const lamp = SENSOR_LAMP[definition.component.variant];
    if (lamp) set(element, lamp, Math.abs(volts('DOUT') - volts('GND')) < 1.5);
    set(element, 'ledPower', Math.abs(volts('VCC') - volts('GND')) > 0.5);
    return;
  }

  if (kind === 'dip-switch') {
    const values = (definition.knobs ?? []).map((knob) =>
      state.controls.knob(part.id, knob) >= 0.5 ? 1 : 0,
    );
    /*
     * The element compares the array by identity, so handing it a fresh one
     * every frame would redraw the switches even when nothing has moved.
     */
    const target = element as unknown as { values?: readonly number[] };
    if (target.values && !sameSwitches(target.values, values)) target.values = values;
    return;
  }

  if (kind === 'rgb-led') {
    // Each channel brightens on its own forward bias, the same way a single LED does.
    const cathode = volts('common');
    set(element, 'ledRed', channelDrive(volts('red'), cathode, DIODE_PROFILES.red));
    set(element, 'ledGreen', channelDrive(volts('green'), cathode, DIODE_PROFILES.green));
    set(element, 'ledBlue', channelDrive(volts('blue'), cathode, DIODE_PROFILES.blue));
    return;
  }

  if (kind === 'buzzer') {
    // A piezo sounds on the voltage across it, so that is what is measured here.
    set(element, 'hasSignal', Math.abs(volts('positive') - volts('negative')) > 1.5);
    return;
  }

  if (kind === 'resistor') {
    set(element, 'value', `${definition.component.ohms}`);
    return;
  }


  if (kind === 'display' && definition.component.controller === 'ili9341') {
    blitFramebuffer(element, state.displays?.get(part.id));
  }

  if (kind === 'display' && definition.component.controller === 'ssd1306-spi') {
    blitMonoFramebuffer(element, state.displays?.get(part.id));
  }
}

/**
 * Brightness for a package of diodes: the bar graph's ten segments and the
 * seven-segment display's eight.
 *
 * Each is driven from the forward bias its own diode shows, exactly as a
 * single LED is lit -- and for a display segment the measure matters twice
 * over, because a multiplexed display's brightness is the *product* of which
 * digit common and which segment line are held where, not one wire's level.
 */
function pushSegmentLevels(
  element: HTMLElement,
  definition: PartDefinition,
  part: PartInstance,
  state: FootprintState,
): void {
  const volts = (pin: string): number => state.pinVolts.get(`${part.id}:${pin}`) ?? 0;
  const anode = definition.component.kind === '7segment' ? volts('COM.1') : 0;

  const levels = definition.pins
    .filter((pin) => pin.id !== 'COM.1' && pin.id !== 'COM.2')
    .map((pin) => {
      const cathode = volts(pin.id);
      // The bar graph's anodes are the A pins and its cathodes the C pins, so
      // the anode reference is whichever of the pair is higher.
      const forward =
        definition.component.kind === 'led-bar-graph'
          ? Math.max(volts(pin.id.replace(/^C/, 'A')), 0) - cathode
          : anode - cathode;
      return Math.max(0, Math.min(1, (forward - 1.9) / 1.1));
    });

  set(element, 'values', levels);
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

/**
 * Paints an SSD1306 framebuffer into the SPI module's own canvas.
 *
 * The glass is monochrome, so a lit pixel goes across white at full
 * alpha and a dark one stays transparent black -- the element's own
 * glass tints it from there.
 */
function blitMonoFramebuffer(element: HTMLElement, controller: DisplayController | undefined): void {
  if (!(controller instanceof Ssd1306)) return;
  const canvas: unknown = Reflect.get(element, 'canvas');
  if (!(canvas instanceof HTMLCanvasElement)) return;
  const context = canvas.getContext('2d');
  if (!context) return;
  const image = context.createImageData(SSD1306_WIDTH, SSD1306_HEIGHT);
  for (let y = 0; y < SSD1306_HEIGHT; y++) {
    for (let x = 0; x < SSD1306_WIDTH; x++) {
      const offset = (y * SSD1306_WIDTH + x) * 4;
      const lit = controller.isLit(x, y) ? 255 : 0;
      image.data[offset] = lit;
      image.data[offset + 1] = lit;
      image.data[offset + 2] = lit;
      image.data[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
}

/**
 * How hard one channel of a multi-colour LED is being driven.
 *
 * The same forward-bias measure a single LED uses, against that die's own
 * forward voltage: a blue channel needs a volt and a half more rail than a red
 * one, and drawing them all from one figure is what makes a mixed colour read
 * as too yellow.
 */
function channelDrive(anode: number, cathode: number, profile: DiodeProfile): number {
  const overDrive = anode - cathode - profile.forwardVolts;
  return Math.max(0, Math.min(1, overDrive / 1.1));
}

/** Whether a switch bank is already in the state the part is being set to. */
function sameSwitches(current: readonly number[], next: readonly number[]): boolean {
  return current.length === next.length && current.every((value, index) => value === next[index]);
}

/**
 * Pushes one property, if the element has it and it is not already there.
 *
 * `name in target` rather than a truthiness check: a property the element does
 * not have is left alone, which is what lets one push cover every part without
 * a table of which elements happen to carry which indicator. The comparison is
 * by value because Lit re-renders on assignment, and a fresh string every frame
 * would redraw the artwork sixty times a second for nothing.
 */
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
