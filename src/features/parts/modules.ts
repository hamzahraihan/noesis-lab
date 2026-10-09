/**
 * Sensor, switch and indicator modules.
 *
 * Every part here is drawn by Wokwi's own element, so the pin coordinates are
 * the element's, converted out of the CSS pixels its `pinInfo` is measured in.
 *
 * Two conversions are in play and they are not the same number:
 *
 * - **Where the element is drawn.** Each part's box is the `width`/`height`
 *   its `<svg>` states, which Wokwi writes either in millimetres (`"45.95mm"`)
 *   or in bare pixels for the smaller parts. `widthMm`/`heightMm` are that
 *   size, and it is what the selection outline follows.
 *
 * - **Where its pins are.** `pinInfo` is in CSS pixels at 96 per inch whatever
 *   the view box says, so a pin lands at `px * 25.4 / 96` millimetres from the
 *   part's origin -- except on the elements whose view box is offset or
 *   stretched, where the pin has to be placed against the box the browser
 *   actually paints.
 *
 * Pin rows are then snapped to the 0.1 inch pitch the breadboard is drilled on,
 * choosing the offset that lands closest to the artwork. Wokwi's own header
 * positions sit within a fraction of a millimetre of the real thing but not
 * exactly on the grid, and a part whose pins fall between holes cannot be wired
 * the way the breadboard in front of it works.
 *
 * The anchor is the artwork's first hole rounded to the half pitch -- to the
 * nearest one the board itself can still carry -- and the rest of the row follow
 * at a full pitch from it. A row sits on the breadboard's grid at either phase,
 * and which phase it takes is the user's to choose by where they drop the part;
 * what the rounding is for is staying on the artwork. Two headers decide it: the
 * PIR's row is 0.1 mm from the bottom edge, where a full-pitch hole would be
 * 1.3 mm further out and past the board, and the gas board's column has to give
 * up 0.7 mm of artwork to stay inside its own right-hand edge.
 */

import type { KnobSpec, PartDefinition, PinSpec, SensorVariant } from './catalog';
import { WIPER_KNOB } from './passives';

/** The hole pitch, and the grid every module's header is snapped to. */
const PITCH = 2.54;

/** Header pins along the bottom edge, left to right. */
function headerRow(x: number, y: number, names: readonly string[]): PinSpec[] {
  return names.map((name, index) => headerPin(name, x + index * PITCH, y));
}

/** Header pins up one edge, top to bottom, as the sensor boards carry theirs. */
function headerColumn(x: number, y: number, names: readonly string[]): PinSpec[] {
  return names.map((name, index) => headerPin(name, x, y + index * PITCH));
}

function headerPin(name: string, x: number, y: number): PinSpec {
  return {
    id: name,
    label: name,
    x,
    y,
    net: name === 'GND' ? 'GND' : name === 'VCC' ? '3V3' : undefined,
  };
}

/**
 * The controls these parts expose.
 *
 * Exported because the netlist reads them as well as the inspector writing
 * them: one object shared by both is what stops a part being solved at one
 * light level and drawn at another.
 */
export const LIGHT_KNOB: KnobSpec = {
  id: 'light',
  label: 'Light',
  min: 0,
  max: 1000,
  step: 10,
  unit: 'lx',
  defaultValue: 100,
};

/**
 * The on-board trimmer, which is what decides where DO changes state.
 *
 * Left at mid travel by default, so the comparator trips at half the supply.
 */
export const COMPARATOR_THRESHOLD_KNOB: KnobSpec = {
  id: 'threshold',
  label: 'Comparator threshold',
  min: 0,
  max: 100,
  step: 1,
  unit: '%',
  defaultValue: 50,
};

/**
 * What each comparator board reports, keyed by the variant that draws it.
 *
 * Held as one table rather than a constant per board because the netlist
 * reaches for it by variant: the model is the same circuit on every one of
 * them, and the only thing that differs is the scale the operator is turning.
 *
 * The three that answer yes or no are toggles, and the three that answer with
 * a level carry the unit they mean it in -- the sound boards read in decibels
 * and a gas board in parts per million, which is a number a sketch can compare
 * against a threshold from a datasheet, where a bare percentage is neither.
 *
 * A toggle has only two positions to offer the trimmer, so on those three boards
 * the threshold reads as trip on anything detected right up until it is wound
 * all the way off. That is the honest consequence of a binary stimulus, and the
 * reason the trimmer is worth turning on the others.
 *
 * The two sound boards are one microphone at two sizes, so they share the one
 * knob object rather than two that happen to agree: the state is keyed by a
 * knob's id, so a second copy would be a second reading of one control.
 */
const SOUND_STIMULUS_KNOB: KnobSpec = {
  id: 'sound',
  label: 'Sound level',
  min: 0,
  max: 100,
  step: 1,
  unit: 'dB',
  defaultValue: 20,
};

export const SENSOR_STIMULUS_KNOBS: Readonly<Record<SensorVariant, KnobSpec>> = {
  pir: { id: 'motion', label: 'Motion', min: 0, max: 1, step: 1, toggle: true, defaultValue: 0 },
  sound: SOUND_STIMULUS_KNOB,
  soundSmall: SOUND_STIMULUS_KNOB,
  heartbeat: { id: 'beat', label: 'Beat', min: 0, max: 1, step: 1, toggle: true, defaultValue: 0 },
  gas: { id: 'gas', label: 'Gas level', min: 0, max: 100, step: 1, unit: 'ppm', defaultValue: 10 },
  flame: { id: 'flame', label: 'Flame', min: 0, max: 1, step: 1, toggle: true, defaultValue: 0 },
};

/** Ways on the DIP switch, which is also how many pins its header carries. */
export const DIP_WAYS = 8;

/**
 * One control per way of the DIP switch, in the order the ways are numbered.
 *
 * A knob each rather than one control carrying all eight positions, because the
 * inspector already draws a list of toggles and the state already holds one
 * number per knob: eight of them is the whole of what eight independent
 * positions cost, where a single control would have to be both drawn and set as
 * a bitmask by hand. Way `n` is the `n`th entry, which is the order the
 * element's own `values` array runs in.
 *
 * Latching, so nothing springs back -- which is what tells these apart from the
 * momentary contacts, which are held in state instead of described here.
 */
export const DIP_WAY_KNOBS: readonly KnobSpec[] = Array.from({ length: DIP_WAYS }, (_, index) => ({
  id: `dip${index + 1}`,
  label: `${index + 1}`,
  min: 0,
  max: 1,
  step: 1,
  toggle: true,
  defaultValue: 0,
}));

export const TEMPERATURE_KNOB: KnobSpec = {
  id: 'temperature',
  label: 'Temperature',
  min: 0,
  max: 100,
  step: 0.5,
  unit: '°C',
  defaultValue: 25,
};

export const TILTED_KNOB: KnobSpec = {
  id: 'tilted',
  label: 'Tilted',
  min: 0,
  max: 1,
  step: 1,
  toggle: true,
  defaultValue: 0,
};

export const SLIDE_POSITION_KNOB: KnobSpec = {
  id: 'closed',
  label: 'Throwing to pin 1',
  min: 0,
  max: 1,
  step: 1,
  toggle: true,
  defaultValue: 0,
};

export const HORIZONTAL_KNOB: KnobSpec = {
  id: 'horizontal',
  label: 'Horizontal',
  min: 0,
  max: 1,
  step: 0.01,
  defaultValue: 0.5,
};

export const VERTICAL_KNOB: KnobSpec = {
  id: 'vertical',
  label: 'Vertical',
  min: 0,
  max: 1,
  step: 0.01,
  defaultValue: 0.5,
};

/**
 * Whether a code has arrived on the IR receiver.
 *
 * A toggle and not a level, because a code is an event rather than a
 * measurement: what the board puts on its data line is high until something is
 * decoded onto it, and the decoder's own work -- the carrier, the timings, the
 * gap that separates one code from the next -- happens behind that line and
 * never reaches the netlist. So the knob is the whole of what a sketch can see.
 */
export const IR_CODE_KNOB: KnobSpec = {
  id: 'code',
  label: 'Code received',
  min: 0,
  max: 1,
  step: 1,
  toggle: true,
  defaultValue: 0,
};

/** Segments on a bar graph, and the anode and cathode pair each one owns. */
export const LED_BAR_GRAPH_SEGMENTS = 10;

/**
 * GL5528 light-dependent resistor module: the sensor, a fixed resistor and a
 * comparator, on one board.
 *
 * The two outputs are what the part is for: `AO` is the raw divider for
 * `analogRead`, and `DO` is that divider passed through the on-board
 * comparator, which is a digital output a sketch can branch on without ever
 * reading the ADC.
 */
export function photoresistorDefinition(): PartDefinition {
  return {
    id: 'photoresistor-module',
    name: 'Photoresistor (LDR) Module',
    category: 'input',
    widthMm: 45.95,
    heightMm: 16.267,
    component: { kind: 'photoresistor' },
    pins: headerColumn(44.45, 3.81, ['VCC', 'GND', 'DO', 'AO']),
    knobs: [LIGHT_KNOB, COMPARATOR_THRESHOLD_KNOB],
    bodyColour: '#1c2546',
    legendColour: '#e8e8e8',
  };
}

/**
 * NTC thermistor module: the sensor and a fixed resistor, on one board.
 *
 * The thermistor falls as it warms, so the divider's output rises with
 * temperature -- the opposite way round from the light sensor, which is the
 * whole reason the two are worth having side by side.
 */
export function thermistorDefinition(): PartDefinition {
  return {
    id: 'ntc-module',
    name: 'Thermistor (NTC) Module',
    category: 'input',
    widthMm: 35.826,
    heightMm: 19,
    component: { kind: 'thermistor' },
    pins: headerColumn(35.56, 6.35, ['GND', 'VCC', 'OUT']),
    knobs: [TEMPERATURE_KNOB],
    bodyColour: '#0f3661',
    legendColour: '#e8e8e8',
  };
}

/**
 * Mercury tilt switch module: a contact to ground and a pull-up, on one board.
 *
 * The switch itself is worth two pins and the board supplies the third, which
 * is why `OUT` reads high whenever the switch is level. A sketch that reads it
 * as active-low has to say so, exactly as it would on the real module.
 */
export function tiltSwitchDefinition(): PartDefinition {
  return {
    id: 'tilt-switch-module',
    name: 'Tilt Switch Module',
    category: 'input',
    widthMm: 23.4,
    heightMm: 14.7,
    component: { kind: 'tilt-switch' },
    pins: headerColumn(22.86, 5.08, ['GND', 'VCC', 'OUT']),
    knobs: [TILTED_KNOB],
    bodyColour: '#19365e',
    legendColour: '#e8e8e8',
  };
}

/** SPDT slide switch: pin 2 is the common leg and throws to 1 or to 3. */
export function slideSwitchDefinition(): PartDefinition {
  return {
    id: 'slide-switch',
    name: 'Slide Switch (SPDT)',
    category: 'input',
    widthMm: 8.5,
    heightMm: 9.23,
    component: { kind: 'slide-switch' },
    pins: [
      { id: '1', label: '1', x: PITCH / 2, y: 8.89 },
      { id: '2', label: '2', x: PITCH / 2 + PITCH, y: 8.89 },
      { id: '3', label: '3', x: PITCH / 2 + 2 * PITCH, y: 8.89 },
    ],
    knobs: [SLIDE_POSITION_KNOB],
    bodyColour: '#c9ccd1',
    legendColour: '#1b1d21',
  };
}

/**
 * Two-axis analog joystick with a push-to-select contact.
 *
 * Each axis is a 10 k pot across the supply and the select contact shorts to
 * ground when held, so all three read with the same two lines of firmware.
 */
export function joystickDefinition(): PartDefinition {
  return {
    id: 'analog-joystick',
    name: 'Analog Joystick',
    category: 'input',
    widthMm: 27.2,
    heightMm: 31.8,
    component: { kind: 'joystick' },
    pins: headerRow(8.89, 30.48, ['VCC', 'VERT', 'HORZ', 'SEL', 'GND']),
    knobs: [HORIZONTAL_KNOB, VERTICAL_KNOB],
    momentary: true,
    bodyColour: '#bd1e34',
    legendColour: '#ffffff',
  };
}

/**
 * Five millimetre RGB LED: three dice in one package, one common cathode.
 *
 * The three channels share a cathode, so the colour is whatever mix of forward
 * bias the sketch puts on them -- which is what `analogWrite` on three pins
 * does, and the reason a red and a green at half brightness read as yellow.
 */
export function rgbLedDefinition(): PartDefinition {
  return {
    id: 'rgb-led-5mm',
    name: 'RGB LED (5 mm)',
    category: 'output',
    widthMm: 11.148,
    heightMm: 19.204,
    component: { kind: 'rgb-led' },
    pins: [
      { id: 'red', label: 'R', x: 1.27, y: 15.24 },
      { id: 'common', label: 'COM', x: 3.81, y: 17.78 },
      { id: 'green', label: 'G', x: 6.35, y: 15.24 },
      { id: 'blue', label: 'B', x: 8.89, y: 15.24 },
    ],
    bodyColour: '#e6e6e6',
    legendColour: '#1b1d21',
  };
}

/**
 * Piezo buzzer.
 *
 * A piezo disc is a capacitor, and on DC that is the whole of its electrical
 * behaviour: it passes the edge that starts it and draws nothing afterwards.
 * Modelling it that way is why a sketch that holds a pin high stops sounding
 * after the first step, which is true of the real part.
 */
export function buzzerDefinition(): PartDefinition {
  return {
    id: 'piezo-buzzer',
    name: 'Piezo Buzzer',
    category: 'output',
    widthMm: 17,
    heightMm: 20,
    component: { kind: 'buzzer' },
    pins: [
      { id: 'positive', label: '+', x: 6.35, y: 19.05 },
      { id: 'negative', label: '-', x: 8.89, y: 19.05 },
    ],
    bodyColour: '#111111',
    legendColour: '#e0e0e0',
  };
}

/**
 * Ten-segment LED bar graph: ten dice in one package, an anode and a cathode
 * each, both brought out along the two long edges.
 *
 * Ten separate parts rather than one common pair, which is what makes it a bar
 * graph and not a strip of one colour: the level a sketch draws is the count of
 * segments it lights, and every one of them needs a line of its own on both
 * sides to be counted that way.
 *
 * The pins are placed on the grid the element's own pin pattern draws, which is
 * the one thing about this part that cannot be taken on trust from the element:
 * `wokwi-led-bar-graph` states each pin as `1.27 * mmToPix` and its `mmToPix` is
 * 3.78 rather than the 96 per inch every other element here rounds to. Read as
 * millimetres and converted again, the two columns land 2 mm apart instead of
 * 7.5 -- the numbers still look like a plausible two-column part, which is what
 * makes the mistake hard to see. Going through the pattern instead puts the
 * anodes 1.27 mm from the left edge, the cathodes three pins along, and both
 * rows on the 2.54 mm pitch the dice are on.
 */
export function ledBarGraphDefinition(): PartDefinition {
  return {
    id: 'led-bar-graph',
    name: 'LED Bar Graph (10 segment)',
    category: 'output',
    widthMm: 10.1,
    heightMm: 25.5,
    component: { kind: 'led-bar-graph' },
    pins: [
      ...headerColumn(1.27, 1.27, Array.from({ length: LED_BAR_GRAPH_SEGMENTS }, (_, i) => `A${i + 1}`)),
      // 8.83 in the artwork, which is 0.06 mm off the half pitch: the nearest
      // hole the breadboard can actually take.
      ...headerColumn(8.89, 1.27, Array.from({ length: LED_BAR_GRAPH_SEGMENTS }, (_, i) => `C${i + 1}`)),
    ],
    bodyColour: '#1b1d21',
    legendColour: '#e0e0e0',
  };
}

/**
 * The comparator sensor boards, as the elements draw them.
 *
 * The circuit is the same on every one of them -- a sensor, an LM393 with a
 * trimmer across the sensor's own output, and a pull-up on the comparator's
 * open-drain leg -- so what a variant chooses is the element, the header that
 * element happens to carry, and the stimulus. Two of them bring no analogue tap
 * out at all: the PIR and the heart sensor are three-pin boards, and a fourth
 * pin the artwork has no hole for would be a terminal a jumper could reach but
 * could never see.
 *
 * The sound boards are the same four-pin column in the same place, so swapping
 * one for the other is a change of parts and nothing else -- which is the point
 * of them being variants rather than a separate model.
 *
 * The digital output is `DOUT` on every one so the family is interchangeable in
 * a sketch, though the PIR and heart boards silkscreen it as `OUT`.

/** One variant's element: what it is called, how big it draws, and its header. */
interface SensorBoard {
  readonly id: string;
  readonly name: string;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly bodyColour: string;
  readonly legendColour: string;
  /** The element's header: its first hole, and which way the row runs. */
  readonly header: {
    readonly x: number;
    readonly y: number;
    readonly names: readonly string[];
    readonly alongColumn: boolean;
  };
}

const SENSOR_BOARDS: Readonly<Record<SensorVariant, SensorBoard>> = {
  pir: {
    id: 'pir-motion-sensor',
    name: 'PIR Motion Sensor',
    widthMm: 24,
    heightMm: 24.448,
    bodyColour: '#e8e5db',
    legendColour: '#1b1d21',
    header: { x: 9.525, y: 24.13, names: ['VCC', 'DOUT', 'GND'], alongColumn: false },
  },
  sound: {
    id: 'sound-sensor-module',
    name: 'Sound Sensor Module',
    widthMm: 37.056,
    heightMm: 13.346,
    bodyColour: '#12203a',
    legendColour: '#e8e8e8',
    header: { x: 0, y: 2.54, names: ['AOUT', 'GND', 'VCC', 'DOUT'], alongColumn: true },
  },
  soundSmall: {
    id: 'small-sound-sensor',
    name: 'Small Sound Sensor Module',
    widthMm: 35.211,
    heightMm: 13.346,
    bodyColour: '#12203a',
    legendColour: '#e8e8e8',
    // The same column at the same place as the big board: the two elements
    // differ in the width of the board between the holes, not in the holes.
    header: { x: 0, y: 2.54, names: ['AOUT', 'GND', 'VCC', 'DOUT'], alongColumn: true },
  },
  heartbeat: {
    id: 'heart-beat-sensor',
    name: 'Heart-Rate Sensor',
    widthMm: 23.4,
    heightMm: 20.943,
    bodyColour: '#12203a',
    legendColour: '#e8e8e8',
    header: { x: 22.86, y: 5.08, names: ['GND', 'VCC', 'DOUT'], alongColumn: true },
  },
  gas: {
    id: 'gas-sensor-module',
    name: 'Gas Sensor Module',
    widthMm: 36.232,
    heightMm: 16.617,
    bodyColour: '#12203a',
    legendColour: '#e8e8e8',
    header: { x: 35.56, y: 3.81, names: ['AOUT', 'DOUT', 'GND', 'VCC'], alongColumn: true },
  },
  flame: {
    id: 'flame-sensor-module',
    name: 'Flame Sensor Module',
    widthMm: 52.904,
    heightMm: 16.267,
    bodyColour: '#12203a',
    legendColour: '#e8e8e8',
    header: { x: 52.07, y: 3.81, names: ['VCC', 'GND', 'DOUT', 'AOUT'], alongColumn: true },
  },
};

/**
 * A comparator sensor board, in the variant that names the element it is
 * drawn by.
 *
 * `DOUT` reads high until the stimulus passes the trimmer and then pulls low,
 * so a sketch branches on it as active-low or inverts it once. `AOUT` is the
 * divider feeding `analogRead`, and rises with the stimulus, which is what makes
 * the trimmer worth setting at all: it is the only way to tell a weak
 * detection from a strong one on a board whose digital output is a single bit.
 */
export function sensorModuleDefinition(variant: SensorVariant): PartDefinition {
  const board = SENSOR_BOARDS[variant];
  const { header } = board;
  return {
    id: board.id,
    name: board.name,
    category: 'input',
    widthMm: board.widthMm,
    heightMm: board.heightMm,
    component: { kind: 'sensor-module', variant },
    pins: header.alongColumn
      ? headerColumn(header.x, header.y, header.names)
      : headerRow(header.x, header.y, header.names),
    knobs: [SENSOR_STIMULUS_KNOBS[variant], COMPARATOR_THRESHOLD_KNOB],
    bodyColour: board.bodyColour,
    legendColour: board.legendColour,
  };
}

/**
 * Eight-way DIP switch: eight latching contacts and no supply of its own.
 *
 * Pin `na` and pin `nb` are the two ends of way `n`, and nothing is wired
 * across the package -- a DIP switch is a set of contacts, not a bus. So a
 * sketch reads the bank as eight bits, which is what it is for: the settings a
 * sketch would otherwise be recompiled with.
 */
export function dipSwitchDefinition(): PartDefinition {
  return {
    id: `dip-switch-${DIP_WAYS}`,
    name: `DIP Switch (${DIP_WAYS}-way)`,
    category: 'input',
    // The element states this one in pixels, not the millimetres the other
    // elements use: 82.87 x 55.355 px at 96 per inch.
    widthMm: 21.926,
    heightMm: 14.646,
    component: { kind: 'dip-switch', ways: DIP_WAYS },
    pins: [
      /*
       * Two rows of eight, five pitches apart, as the element lays them: 2.14
       * and 0.79 mm from the left and top edges, snapped to the nearest half
       * pitch. The element numbers its holes 1a..8a across the top and 1b..8b
       * across the bottom, which is the order they are declared in here.
       */
      ...headerRow(2.54, 13.97, Array.from({ length: DIP_WAYS }, (_, index) => `${index + 1}a`)),
      ...headerRow(2.54, 1.27, Array.from({ length: DIP_WAYS }, (_, index) => `${index + 1}b`)),
    ],
    knobs: DIP_WAY_KNOBS,
    bodyColour: '#7a1f1f',
    legendColour: '#fffef4',
  };
}

/**
 * Infrared receiver module: a demodulator and its own pull-up, on one board.
 *
 * The circuit it presents is the tilt switch's: `DAT` is the receiver's
 * open-drain output behind a pull-up, so the line idles high and is pulled down
 * only while a code is being decoded. Which is the whole of what a sketch can
 * see -- the carrier is demodulated on the board, and the timings that make a
 * code a code never leave it -- so a knob for the arrival of a code is as much
 * of the protocol as this netlist can honestly carry.
 */
export function irReceiverDefinition(): PartDefinition {
  return {
    id: 'ir-receiver',
    name: 'IR Receiver',
    category: 'input',
    widthMm: 16.178,
    heightMm: 23.482,
    component: { kind: 'ir-receiver' },
    /*
     * Three holes 5.55, 8.09 and 10.63 mm from the left edge in the element's
     * `pinInfo`, which is the 96 dpi the other elements use, and one row 0.36 mm
     * inside the bottom edge once snapped to the grid.
     */
    pins: headerRow(5.08, 22.86, ['GND', 'VCC', 'DAT']),
    knobs: [IR_CODE_KNOB],
    bodyColour: '#171514',
    legendColour: '#ffffff',
  };
}

/**
 * Slide potentiometer, the part that reads as a thumb-sized pot.
 *
 * Electrically the rotary pot beside it, so the model is the same two resistors
 * either side of the wiper. What differs is where the pins are: a slide pot's
 * travel is its case length, so the two ends are as far apart as the part is
 * long and no pitch will put both of them on the same phase of the
 * breadboard's holes. 10 k is the value these ship in, and the one every
 * example divider assumes.
 *
 * The element's `pinInfo` is a getter and is in the 96 dpi the rest of the
 * library uses: 0.26 and 54.76 mm across, 11.38 and 16.67 mm down, which are
 * the outer tips of the three legs the artwork draws at x 0-5, x 50-55 and
 * y 16.25-17 in its own millimetre view box.
 */
export function slidePotentiometerDefinition(ohms: number): PartDefinition {
  return {
    id: 'slide-potentiometer',
    name: 'Slide Potentiometer',
    category: 'input',
    // The element draws 55 x 29 mm at its default 30 mm travel, and the travel
    // is a property, so the case length is whatever the sketch asks for.
    widthMm: 55,
    heightMm: 29,
    component: { kind: 'slide-potentiometer', ohms },
    pins: [
      { id: 'endA', label: '1', x: 0, y: 11.43 },
      { id: 'wiper', label: '2', x: 0, y: 16.51 },
      { id: 'endB', label: '3', x: 54.61, y: 11.43 },
    ],
    knobs: [WIPER_KNOB],
    bodyColour: '#7a7a7a',
    legendColour: '#1b1d21',
  };
}

/** Rows and columns on the membrane keypad, which is square. */
export const KEYPAD_ROWS = 4;
export const KEYPAD_COLUMNS = 4;

/**
 * What is printed on the keys, in the order the element lists them: across a row
 * before down a column, which puts each row's fourth key on the letter rather
 * than on the next digit.
 *
 * The element takes sixteen of these for four columns, and the netlist walks
 * them in order to work out which row and column a closed contact sits at, so
 * this list is also the matrix's row-major order.
 */
export const KEYPAD_KEYS: readonly string[] = [
  '1', '2', '3', 'A',
  '4', '5', '6', 'B',
  '7', '8', '9', 'C',
  '*', '0', '#', 'D',
];

/**
 * One control per key, for the same reason the DIP switch has one per way: the
 * inspector already draws a list of toggles and the state already holds one
 * number per knob. A keypad is read by scanning rather than by watching a pin,
 * so nothing here latches -- a key is down while its control says so and no
 * longer.
 */
export const KEYPAD_KEY_KNOBS: readonly KnobSpec[] = KEYPAD_KEYS.map((legend, index) => ({
  id: `key${index + 1}`,
  label: legend,
  min: 0,
  max: 1,
  step: 1,
  toggle: true,
  defaultValue: 0,
}));

/**
 * 4x4 membrane keypad: sixteen contacts and nothing else.
 *
 * No bus across the package and no supply of its own. Every row wire crosses
 * every column wire through one contact and through nothing else, which is why
 * eight holes are all a keypad has, and why it is read by scanning: drive a row
 * low, read the four columns, and the column that reads low is the key at that
 * intersection while the other three read whatever the sketch's own pull-ups
 * hold them at. The pull-up is left to the sketch because that is what a real
 * keypad wants, and a part that supplied one would hide the resistor.
 *
 * The pins come from the element's `pinInfo` getter, which is at 26.46, 29.21,
 * 31.63, 34.13, 36.65, 39.15, 41.71 and 44.29 mm along and 89.45 mm down in the
 * 96 dpi the rest of the library uses. Snapped to the grid that is one row of
 * eight from 26.67 mm, at 88.9 mm.
 *
 * The 91 mm height is with the connector fitted, which is the only state the
 * pins exist in: the element leaves the connector off by default, and without
 * it the board is 76 mm tall and has no holes at all.
 */
export function keypadDefinition(): PartDefinition {
  return {
    id: 'membrane-keypad',
    name: '4x4 Membrane Keypad',
    category: 'input',
    widthMm: 70.336,
    heightMm: 91,
    component: { kind: 'keypad' },
    pins: [
      ...headerRow(26.67, 88.9, Array.from({ length: KEYPAD_ROWS }, (_, index) => `R${index + 1}`)),
      // The column block starts a row-length further along, so the eight holes
      // read R1..R4 then C1..C4 as the element names them.
      ...headerRow(
        26.67 + KEYPAD_ROWS * PITCH,
        88.9,
        Array.from({ length: KEYPAD_COLUMNS }, (_, index) => `C${index + 1}`),
      ),
    ],
    knobs: KEYPAD_KEY_KNOBS,
    bodyColour: '#454449',
    legendColour: '#dfe2e5',
  };
}

/** The segment lines of a 7-segment display, as the element names them. */
export const SEVEN_SEGMENT_SEGMENTS: readonly string[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'DP'];

/**
 * One-digit 7-segment display: seven segments and a dot, multiplexed.
 *
 * The digit common is the anode and each segment line is a cathode, which is
 * what makes this a multiplexed display rather than a plain row of LEDs: the
 * sketch lights a segment by holding its line low while the common it wants lit
 * * is high. With one digit there is one common, and the two pins marked `COM`
 * are that same electrode brought out twice -- joined here, so a sketch may
 * drive either and light both halves of the digit.
 *
 * The element's `pinInfo` getter lays a one-digit part out as two rows of five
 * rather than a column of ten, and it numbers them so the top row counts from
 * the right: `G`, `F`, `COM`, `A`, `B` along the top, `E`, `D`, `COM`, `C`,
 * `DP` along the bottom. Its holes are at 1.195 mm along each row and 1 and
 * 19 mm down, which the grid rounds to 1.27 and 19.05 -- seven pitches apart
 * afterwards, so both rows land in holes at the same placement.
 *
 * Supports 1-4 digits. Multi-digit parts use a single-row header with digit
 * commons first (D1, D2...), then segments A, B, DP, G, F, E, D, C.
 */
export function sevenSegmentDefinition(digits = 1): PartDefinition {
  if (digits < 1) digits = 1;
  if (digits > 4) digits = 4;

  const isMulti = digits > 1;
  // The element draws 12.55 mm per digit with the header in two rows, like
  // the single digit above: top row first, then bottom, both on the 2.54 mm
  // pitch the part is drilled on. Orders are the element's own per-model
  // pinouts (CL5621C / SP420281N / KW4-56NALB), read left to right.
  const widthMm = isMulti ? 12.55 * digits : 12.55;
  const heightMm = 22;
  const pitch = 2.54;
  // The pin cluster is centred in the artwork, so the first column starts
  // wherever centring leaves it rather than at the part's own edge: the x
  // here is exact on purpose, where snapping it to the grid would pull every
  // wire up to a millimetre off the hole the artwork draws.
  const cols = digits === 4 ? 7 : digits === 3 ? 6 : 5;
  const headerX = (widthMm - cols * pitch) / 2 + 1.27;
  const headerY = 1.27;

  const pins: PinSpec[] = [];

  if (isMulti) {
    // Top row first, then bottom, both left to right as the element draws
    // them. Three-digit glass leaves one hole empty (no pin 6); four-digit
    // glass fills all 14 (KW4-56NALB: DIG1(14) A(13) F(12) DIG2(11) DIG3(10)
    // B(9) CLN(8) up top, E(1) D(2) DP(3) C(4) G(5) DIG4(6) COM(7) below).
    const rows: string[][] =
      digits === 4
        ? [
            ['DIG1', 'A', 'F', 'DIG2', 'DIG3', 'B', 'CLN'],
            ['E', 'D', 'DP', 'C', 'G', 'DIG4', 'COM'],
          ]
        : digits === 3
          ? [
              ['DIG1', 'A', 'F', 'DIG2', 'DIG3', 'B'],
              ['E', 'D', 'DP', 'C', 'G'],
            ]
          : [
              ['A', 'B', 'DIG1', 'DIG2', 'F'],
              ['C', 'DP', 'E', 'D', 'G'],
            ];
    rows.forEach((row, rowIndex) => {
      row.forEach((id, column) => {
        pins.push({
          id,
          label: id.startsWith('DIG') ? `D${id.slice(3)}` : id,
          x: headerX + column * pitch,
          y: headerY + rowIndex * (19.05 - 1.27),
        });
      });
    });
  } else {
    pins.push(
      { id: 'G', label: 'G', x: 1.27, y: 1.27 },
      { id: 'F', label: 'F', x: 3.81, y: 1.27 },
      { id: 'COM.2', label: 'COM.2', x: 6.35, y: 1.27, net: 'COM' },
      { id: 'A', label: 'A', x: 8.89, y: 1.27 },
      { id: 'B', label: 'B', x: 11.43, y: 1.27 },
      { id: 'E', label: 'E', x: 1.27, y: 19.05 },
      { id: 'D', label: 'D', x: 3.81, y: 19.05 },
      { id: 'COM.1', label: 'COM.1', x: 6.35, y: 19.05, net: 'COM' },
      { id: 'C', label: 'C', x: 8.89, y: 19.05 },
      { id: 'DP', label: 'DP', x: 11.43, y: 19.05 },
    );
  }

  const suffix = digits === 1 ? '' : `-${digits}digit`;
  const typedDigits = digits as 1 | 2 | 3 | 4;
  return {
    id: `7segment${suffix}`,
    name: `${digits}-Digit 7-Segment Display`,
    category: 'output',
    widthMm,
    heightMm,
    component: { kind: '7segment', digits: typedDigits },
    pins,
    bodyColour: '#111111',
    legendColour: '#e0e0e0',
  };
}