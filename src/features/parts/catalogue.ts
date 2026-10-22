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
import { customPartsSource } from './custom-registry';
import {
  arduinoMega2560,
  arduinoNano,
  attiny85Chip,
  nanoRp2040Connect,
  arduinoUnoR3,
  esp32DevKitV1,
  franzininhoBoard,
  raspberryPi4,
  raspberryPiPico,
} from './boards';
import { breadboardDefinition } from './breadboard';
import {
  buttonDefinition,
  capacitorDefinition,
  DIODE_PROFILES,
  formatOhms,
  ledDefinition,
  potentiometerDefinition,
  resistorDefinition,
} from './passives';
import {
  ili9341Definition,
  ili9341LargeDefinition,
  ssd1306Definition,
  ssd1306SpiDefinition,
} from './display/part';
import {
  ads1115Definition,
  bmp180Definition,
  ds1307Definition,
  hx711Definition,
  ina219Definition,
  mpu6050Definition,
} from './devices/sensors';
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
import { sonarDefinition } from './sonar';
import { dhtDefinition } from './dht';
import { ds18b20Definition } from './ds18b20';
import { mfrc522Definition } from './mfrc522';
import { tm1637Definition } from './tm1637';
import { a4988Definition } from './a4988';
import { max7219Definition } from './display/max7219';
import { nokia5110Definition } from './display/pcd8544';
import { shift595Definition } from './devices/shift595';
import { remoteDefinition } from './remote';
import { dialerDefinition } from './dialer';
import { microsdDefinition } from './sdcard';
import { ledRingDefinition, neopixelDefinition, neopixelMatrixDefinition } from './pixels';
import { biaxialStepperDefinition, stepperDefinition } from './stepper';

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
    note: 'Turn the detents to walk CLK/DT through quadrature; press for SW. Reads with digitalRead. Needs VCC wired: the outputs are pull-ups to it.',
    make: encoderDefinition,
  },
  {
    id: 'sonar-hcsr04',
    name: 'Ultrasonic Sensor (HC-SR04)',
    group: 'input',
    note: 'Trigger it and read the echo with pulseIn: the width in microseconds is centimeters times 58. Turn the distance knob to move the wall.',
    make: sonarDefinition,
  },
  {
    id: 'stepper-motor',
    name: 'Stepper Motor',
    group: 'output',
    note: 'Four wires, two windings: sequence the coils and the shaft follows in 7.5 degree steps.',
    make: stepperDefinition,
  },
  {
    id: 'biaxial-stepper',
    name: 'Biaxial Stepper',
    group: 'output',
    note: 'Two steppers in one frame: each axis sequences on its own four wires.',
    make: biaxialStepperDefinition,
  },
  {
    id: 'dht22-temp-humidity',
    name: 'DHT22 Temp/Humidity',
    group: 'input',
    note: 'Temp and humidity over one wire; read with dht.temperature/humidity. Turn the climate knobs to change the weather.',
    make: dhtDefinition,
  },
  {
    id: 'ds18b20',
    name: 'DS18B20 Temperature Sensor',
    group: 'input',
    note: 'One wire and a temperature: read with ow.getTemp(). Twelve-bit resolution, and a range the DHT cannot reach.',
    make: ds18b20Definition,
  },
  {
    id: 'a4988',
    name: 'Stepper driver (A4988)',
    group: 'output',
    note: 'A stepper motor driver with a translator behind it: a pulse on STEP moves the motor one step and DIR says which way, so the sketch never writes a phase table. The bench models the full-step excitation; the microstep modes drive one winding at a reduced current, which the bench\u2019s motor does not follow.',
    make: a4988Definition,
  },
  {
    id: 'tm1637',
    name: '4-digit LED display (TM1637)',
    group: 'output',
    note: 'Four digits behind two wires. The chip scans the display itself, so a sketch writes the segment patterns into its registers and the glass shows them.',
    make: tm1637Definition,
  },
  {
    id: 'mfrc522',
    name: 'RFID reader (MFRC522)',
    group: 'input',
    note: 'An SPI register file with a card in its field. A sketch reads the version register, asks for a card, and gets the ATQA back in the FIFO \u2014 or the timer interrupt when no card is there.',
    make: mfrc522Definition,
  },
  {
    id: 'neopixel',
    name: 'NeoPixel',
    group: 'output',
    note: 'One addressable LED: paint it with pixels.setColor. No timing to bit-bang.',
    make: neopixelDefinition,
  },
  {
    id: 'neopixel-matrix-8x8',
    name: 'NeoPixel Matrix (8x8)',
    group: 'output',
    note: 'Sixty-four dice that place and wire but stay dark in v1: their colors are not settable from outside yet.',
    make: neopixelMatrixDefinition,
  },
  {
    id: 'led-ring-16',
    name: 'NeoPixel Ring (16)',
    group: 'output',
    note: 'Sixteen dice in a circle, same honest limit as the matrix in v1.',
    make: ledRingDefinition,
  },
  {
    id: 'ir-remote',
    name: 'IR Remote',
    group: 'input',
    note: 'Hold a key to transmit its code through the air; an IR receiver on the bench hears it via ir.readCode.',
    make: remoteDefinition,
  },
  {
    id: 'rotary-dialer',
    name: 'Rotary Dialer',
    group: 'input',
    note: 'Dial a digit and read it back with dialer.read. The pulse train itself is not modeled.',
    make: dialerDefinition,
  },
  {
    id: 'microsd-card',
    name: 'MicroSD Card',
    group: 'input',
    note: 'Named text files over chip-select: sd.write then sd.read. Files survive a reflash; removing the card clears them.',
    make: microsdDefinition,
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
    name: '1-Digit 7-Segment Display',
    group: 'output',
    note: 'Common anode: a segment is lit by holding its line low while the common is high. Both COM pins are that same electrode.',
    make: () => sevenSegmentDefinition(1),
  },
  {
    id: '7segment-2digit',
    name: '2-Digit 7-Segment Display',
    group: 'output',
    note: 'Common anode, multiplexed. 11 pins (D1-D2, A-G, DP). Digit commons first, then segments.',
    make: () => sevenSegmentDefinition(2),
  },
  {
    id: '7segment-3digit',
    name: '3-Digit 7-Segment Display',
    group: 'output',
    note: 'Common anode, multiplexed. 12 pins (D1-D3, A-G, DP). Digit commons first, then segments.',
    make: () => sevenSegmentDefinition(3),
  },
  {
    id: '7segment-4digit',
    name: '4-Digit 7-Segment Display',
    group: 'output',
    note: '14 pins (D1-D4, A-G, DP, COM, CLN). Common anode, multiplexed. D2-D5 digits, D6-D12 segments, D13 colon, COM to 5V.',
    make: () => sevenSegmentDefinition(4),
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
    id: 'bmp180-barometer',
    name: 'BMP180 Barometer',
    group: 'input',
    note: 'Pressure and temperature as raw counts, with the calibration in the chip\u2019s own E2PROM. A sketch applies the datasheet\u2019s compensation to get pascals.',
    make: bmp180Definition,
  },
  {
    id: 'ina219-current-monitor',
    name: 'INA219 Current Monitor',
    group: 'input',
    note: 'The voltage across its own hundredth-of-an-ohm shunt, and the bus it watches. The current register is only as good as the calibration a sketch wrote.',
    make: ina219Definition,
  },
  {
    id: 'ads1115-adc',
    name: 'ADS1115 16-bit ADC',
    group: 'input',
    note: 'Four channels read against the chip\u2019s own reference, in sixteen-bit counts. The gain setting says how much of the range a channel gets.',
    make: ads1115Definition,
  },
  {
    id: 'shift595',
    name: '74HC595 Shift Register',
    group: 'output',
    note: 'Eight outputs from two wires: shift a byte in over SPI, then raise the latch to put it on the outputs.',
    make: shift595Definition,
  },
  {
    id: 'max7219-matrix',
    name: '8x8 LED matrix (MAX7219)',
    group: 'output',
    note: 'Sixty-four LEDs behind three wires. Every pixel is a register write: DIGIT0..7 are the columns and each bit is a row, so a frame is an address and a byte.',
    make: max7219Definition,
  },
  {
    id: 'nokia-5110',
    name: 'Nokia 5110 LCD (PCD8544)',
    group: 'output',
    note: '84x48 pixels of glass backed by six banks of eight rows. One pin tells commands from data, and the contrast voltage lives in the extended half of the instruction set.',
    make: nokia5110Definition,
  },
  {
    id: 'lcd-16x2',
    name: 'LCD1602, 16x2',
    group: 'output',
    note: 'Six wires, not two: RS, RW, enable and D4-D7. The second row starts at address 0x40, which is why a display wired correctly and driven correctly can still show one line.',
    make: lcd1602Definition,
  },
  {
    id: 'lcd-20x4',
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
    id: 'ssd1306-128x64-3c',
    name: '128x64 OLED (SSD1306)',
    group: 'output',
    note: 'I2C, four wires. Address 0x3C unless the module says otherwise.',
    make: () => ssd1306Definition(),
  },
  {
    id: 'ssd1306-128x64-spi',
    name: '128x64 OLED SPI module (SSD1306)',
    group: 'output',
    note: 'SPI, eight wires. The same glass as the I2C breakout, on the module Wokwi draws.',
    make: ssd1306SpiDefinition,
  },
  {
    id: 'ili9341-320x240',
    name: '2.4" TFT (ILI9341)',
    group: 'output',
    note: 'SPI, eight wires. Far more pixels than the OLED, and far more wires.',
    make: ili9341Definition,
  },
  {
    id: 'ili9341-480x320',
    name: '3.2" TFT (ILI9341)',
    group: 'output',
    note: '480×320 behind the same eight wires. Bigger glass, and it turns.',
    make: ili9341LargeDefinition,
  },
  {
    id: 'breadboard-830',
    name: 'Breadboard (830 point)',
    group: 'breadboard',
    note: 'The prototyping surface. Strip holes run in columns of five.',
    make: breadboardDefinition,
  },
];

/** Parts too large to sit on a breadboard strip, dropped below the bench. */
const LARGE_PARTS: Readonly<Record<string, true>> = {
  'breadboard-830': true,
  servo: true,
  'lcd-16x2': true,
  'lcd-20x4': true,
  'ssd1306-128x64-3c': true,
  'ssd1306-128x64-spi': true,
  'ili9341-320x240': true,
  'ili9341-480x320': true,
  'slide-potentiometer': true,
  'membrane-keypad': true,
  'biaxial-stepper': true,
  'neopixel-matrix-8x8': true,
  'led-ring-16': true,
  'ir-remote': true,
  'rotary-dialer': true,
  '7segment': true,
  '7segment-2digit': true,
  '7segment-3digit': true,
  '7segment-4digit': true,
};

/**
 * Whether the bench lays a part out as a large one.
 *
 * The shipped set is a curation, not a measurement: measured on 2026-10-18 the
 * large parts run from a 22 mm span (the slide potentiometer) to 84 mm (the IR
 * remote) while the small ones reach 58 mm, so no size rule separates them --
 * what they share is that they take a lot of the bench. An imported part says so
 * itself (`large: true` in its file), which is the same judgement in data.
 */
export function isLargePart(id: string): boolean {
  if (LARGE_PARTS[id] === true) return true;
  return customPartsSource()?.isLarge(id) === true;
}

const BOARD_FACTORIES: Readonly<Record<string, () => PartDefinition>> = {
  'esp32-devkit-v1': esp32DevKitV1,
  'arduino-uno-r3': arduinoUnoR3,
  'arduino-mega-2560': arduinoMega2560,
  'arduino-nano': arduinoNano,
  'arduino-nano-rp2040-connect': nanoRp2040Connect,
  franzininho: franzininhoBoard,
  'raspberry-pi-4': raspberryPi4,
  'raspberry-pi-pico': raspberryPiPico,
  attiny85: attiny85Chip,
};

/**
 * Every id the bench already answers to: the catalogue's parts and its boards.
 *
 * `partDefinitionById` resolves those before it looks at anything a session
 * imported, so an imported part that claimed one of these ids would resolve to
 * the bench's own part instead -- the file would import cleanly and then not be
 * the thing that got placed.
 */
export const BENCH_PART_IDS: ReadonlySet<string> = new Set([
  ...PART_CATALOGUE.map((entry) => entry.id),
  ...Object.keys(BOARD_FACTORIES),
]);

/**
 * Whether an id belongs to a part this build ships.
 *
 * The line the circuit format draws: a shipped part is described by the build and
 * needs no definition in a file, while anything else -- a part imported from a
 * part file -- has to travel with the circuit that uses it, or the circuit only
 * opens on the machine that imported it.
 */
export function isShippedPart(id: string): boolean {
  return PART_CATALOGUE.some((entry) => entry.id === id) || BOARD_FACTORIES[id] !== undefined;
}

export function partDefinitionById(id: string): PartDefinition | undefined {
  const entry = PART_CATALOGUE.find((e) => e.id === id);
  if (entry) return entry.make();
  const factory = BOARD_FACTORIES[id];
  if (factory) return factory();
  /*
   * And the parts a session imported (`custom-store.ts`), which is how a circuit
   * that names one compiles: the idiomatic path goes through the catalogue, so a
   * custom part is a part, not a second kind of thing the compiler has to know
   * about. Nothing registered -- the usual case -- costs one null check.
   */
  return customPartsSource()?.definition(id) ?? undefined;
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
