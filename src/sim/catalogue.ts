/**
 * The placeable part catalogue.
 *
 * One list, shared by the quick palette and the full browser, so a part can
 * never exist in one and not the other. Entries carry a short note because a
 * list of values says nothing about *which* 330 Ohm you should reach for -- a
 * current-limiting resistor and a pull-up are the same part in different
 * places, and telling them apart is what the note is for.
 */

import type { PartDefinition, SensorVariant } from './catalog';
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
import { ds1307Definition, hx711Definition, mpu6050Definition } from './devices/sensors';
import { lcd1602Definition, lcd2004Definition } from './devices/lcd';
import { servoDefinition } from './devices/servo';
import {
  buzzerDefinition,
  dipSwitchDefinition,
  irReceiverDefinition,
  joystickDefinition,
  keypadDefinition,
  ledBarGraphDefinition,
  photoresistorDefinition,
  rgbLedDefinition,
  sensorModuleDefinition,
  sevenSegmentDefinition,
  slidePotentiometerDefinition,
  slideSwitchDefinition,
  thermistorDefinition,
  tiltSwitchDefinition,
} from './modules';
import { relayDefinition } from './relay';
import { encoderDefinition } from './encoder';

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

/**
 * The comparator sensor family, which is one board with a microphone at two
 * sizes and five other things to sense.
 *
 * Held as a table because the entries differ only in what the part is for: they
 * are the same circuit, they take the same trimmer, and a sketch can swap one
 * for another without changing a line of firmware.
 */
const SENSOR_MODULES: ReadonlyArray<readonly [variant: SensorVariant, note: string]> = [
  [
    'pir',
    'Watches a room rather than a person. DOUT idles high and pulls low on a detection, so it reads active-low.',
  ],
  [
    'sound',
    'Past the trimmer and DOUT pulls low. AOUT is the level itself, and is the pin to read when how loud matters.',
  ],
  [
    'soundSmall',
    'The same microphone on a narrower board, so the two swap without a line changing. AOUT is the level; DOUT only says it is past the trimmer.',
  ],
  [
    'heartbeat',
    'Optical, so it wants a finger resting on it. High between beats, low on one, and fooled by room light.',
  ],
  [
    'gas',
    'Reads what it is breathing. The trip point is a gas level rather than a voltage, which is what the trimmer sets.',
  ],
  [
    'flame',
    'Infrared, so a lighter reads the same as a campfire. Only AOUT tells a flicker from a flame.',
  ],
];

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
  {
    id: 'slide-potentiometer',
    name: 'Slide Potentiometer',
    group: 'input',
    note: 'A 10k divider in a case you can push along. Its two ends are as far apart as its travel, so they do not share a breadboard row.',
    make: () => slidePotentiometerDefinition(10_000),
  },
  ...LEDS.map<CatalogueEntry>(([colour, note]) => ({
    id: `led-${colour}`,
    name: `${LED_NAMES[colour]} LED`,
    group: 'output',
    note,
    make: () => ledDefinition(DIODE_PROFILES[colour], LED_NAMES[colour]),
  })),
  {
    id: 'photoresistor-module',
    name: 'Photoresistor (LDR) Module',
    group: 'input',
    note: 'Analog and digital outputs off one light sensor. AO is the raw divider, DO is the comparator.',
    make: photoresistorDefinition,
  },
  {
    id: 'ntc-module',
    name: 'Thermistor (NTC) Module',
    group: 'input',
    note: 'A thermistor falls as it warms, so its divider rises with temperature.',
    make: thermistorDefinition,
  },
  {
    id: 'tilt-switch-module',
    name: 'Tilt Switch Module',
    group: 'input',
    note: 'Contact closed when tilted. The board holds OUT high, so it reads active-low.',
    make: tiltSwitchDefinition,
  },
  {
    id: 'ir-receiver',
    name: 'IR Receiver',
    group: 'input',
    note: 'DAT idles high and is pulled low while a code is decoded, so it reads active-low and brings its own pull-up.',
    make: irReceiverDefinition,
  },
  {
    id: 'slide-switch',
    name: 'Slide Switch (SPDT)',
    group: 'input',
    note: 'Pin 2 throws to 1 or to 3 and never to both. How a mode selector is built.',
    make: slideSwitchDefinition,
  },
  {
    id: 'relay-dpdt',
    name: 'Relay (DPDT)',
    group: 'input',
    note: 'A coil-driven double switch: energize the coil and each pole throws from NC to NO.',
    make: relayDefinition,
  },
  {
    id: 'rotary-encoder',
    name: 'Rotary Encoder (KY-040)',
    group: 'input',
    note: 'Turn the detents to walk CLK/DT through quadrature; press for SW. Reads with digitalRead.',
    make: encoderDefinition,
  },
  {
    id: 'analog-joystick',
    name: 'Analog Joystick',
    group: 'input',
    note: 'Two pots and a momentary contact. Centre both axes for 512 on a ten-bit ADC.',
    make: joystickDefinition,
  },

  ...SENSOR_MODULES.map<CatalogueEntry>(([variant, note]) => {
    const { id, name } = sensorModuleDefinition(variant);
    return { id, name, group: 'input', note, make: () => sensorModuleDefinition(variant) };
  }),
  {
    id: 'dip-switch-8',
    name: 'DIP Switch (8-way)',
    group: 'input',
    note: 'Eight latches and no supply of its own. The settings a sketch is otherwise compiled with.',
    make: dipSwitchDefinition,
  },
  {
    id: 'membrane-keypad',
    name: '4x4 Membrane Keypad',
    group: 'input',
    note: 'Eight wires for sixteen keys: drive a row low and read the columns. It brings no pull-ups, so the columns want them.',
    make: keypadDefinition,
  },
  {
    id: 'rgb-led-5mm',
    name: 'RGB LED (5 mm)',
    group: 'output',
    note: 'Three dice, one common cathode. analogWrite on R, G and B mixes the colour.',
    make: rgbLedDefinition,
  },
  {
    id: 'led-bar-graph',
    name: 'LED Bar Graph (10 segment)',
    group: 'output',
    note: 'Ten dice with an anode and a cathode each, so twenty wires. A level is the number of segments lit, not a voltage.',
    make: ledBarGraphDefinition,
  },
  {
    id: 'piezo-buzzer',
    name: 'Piezo Buzzer',
    group: 'output',
    note: 'A capacitor, so it passes the edge that starts it and draws nothing after.',
    make: buzzerDefinition,
  },
  {
    id: '7segment',
    name: '7-Segment Display',
    group: 'output',
    note: 'Common anode: a segment is lit by holding its line low while the common is high. Both COM pins are that same electrode.',
    make: sevenSegmentDefinition,
  },
  {
    id: 'ds1307-rtc',
    name: 'DS1307 Real-Time Clock',
    group: 'input',
    note: 'Keeps time with a battery, and reads it a register at a time over I2C. Seconds are BCD, so the low nibble is the seconds.',
    make: ds1307Definition,
  },
  {
    id: 'mpu6050-accel',
    name: 'MPU-6050 Accelerometer',
    group: 'input',
    note: 'Six axes in fourteen bytes. Every axis reads zero until the sketch writes the power register, exactly as a real chip asleep does.',
    make: mpu6050Definition,
  },
  {
    id: 'hx711-load-cell',
    name: 'HX711 Load-Cell Amplifier',
    group: 'input',
    note: 'Turns a load cell\u2019s four-wire bridge into one 24-bit number. It has no registers at all: a read is a fresh reading.',
    make: hx711Definition,
  },
  {
    id: 'lcd-1602',
    name: 'LCD1602, 16x2',
    group: 'output',
    note: 'Six wires, not two: RS, RW, enable and D4-D7. The second row starts at address 0x40, which is why a display wired correctly and driven correctly can still show one line.',
    make: lcd1602Definition,
  },
  {
    id: 'lcd-2004',
    name: 'LCD2004, 20x4',
    group: 'output',
    note: 'The same glass twice as tall. Rows three and four live above the second row, not below it, so the driver moves the address pointer rather than counting on.',
    make: lcd2004Definition,
  },
  {
    id: 'servo',
    name: 'Hobby Servo',
    group: 'output',
    note: 'Three wires and an angle it cannot point past 10 or 170 degrees. It draws hard on its supply while driven, which is the reason it wants its own supply.',
    make: servoDefinition,
  },
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
  'servo': true,
  'lcd-1602': true,
  'lcd-2004': true,
  'ssd1306-128x64': true,
  'ili9341-320x240': true,
  'slide-potentiometer': true,
  'membrane-keypad': true,
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

