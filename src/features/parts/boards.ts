/**
 * Microcontroller board definitions.
 *
 * Header labels and firmware pin numbers are deliberately kept separate. The
 * silkscreen says `GPIO25`, the firmware says `25`, and the breadboard hole
 * says neither. Conflating them is the classic source of confusion when
 * reading a tutorial against a physical board, so `BoardPin` carries all three.
 */

import type { BoardPin, PartDefinition, PinSpec } from './catalog';

/**
 * ESP32-WROOM-32 DevKit V1, the 30-pin variant.
 *
 * Two details here are load-bearing for the learning objectives: the input-only
 * pins (34-39 have no output driver, so `digitalWrite` on them does nothing) and
 * the strapping pins (12 and 15 are sampled at reset, so tying them to the
 * wrong level can stop the board booting).
 */
const ESP32_LEFT_HEADER: ReadonlyArray<[string, string]> = [
  ['EN', 'EN'],
  ['VP', 'GPIO36'],
  ['VN', 'GPIO39'],
  ['GPIO34', 'GPIO34'],
  ['GPIO35', 'GPIO35'],
  ['GPIO32', 'GPIO32'],
  ['GPIO33', 'GPIO33'],
  ['GPIO25', 'GPIO25'],
  ['GPIO26', 'GPIO26'],
  ['GPIO27', 'GPIO27'],
  ['D14', 'GPIO14'],
  ['D12', 'GPIO12'],
  ['D13', 'GPIO13'],
  ['GND', 'GND'],
  ['VIN', 'VIN'],
];

const ESP32_RIGHT_HEADER: ReadonlyArray<[string, string]> = [
  ['D23', 'GPIO23'],
  ['D22', 'GPIO22'],
  ['TX0', 'GPIO1'],
  ['RX0', 'GPIO3'],
  ['D21', 'GPIO21'],
  ['D19', 'GPIO19'],
  ['D18', 'GPIO18'],
  ['D5', 'GPIO5'],
  ['TX2', 'GPIO17'],
  ['RX2', 'GPIO16'],
  ['D4', 'GPIO4'],
  ['D2', 'GPIO2'],
  ['D15', 'GPIO15'],
  ['GND', 'GND'],
  ['3V3', '3V3'],
];

/**
 * The pin rows, from the bottom of the board upwards, as the artwork draws them.
 *
 * Taken from the `wokwi-esp32-devkit-v1` element's own `pinInfo` converted through
 * its measured 96dpi constant, so the jumpers this bench draws land on the pins
 * the element actually paints rather than near them.
 */
const ESP32_PIN_Y_MM: readonly number[] = [
  6.35, 8.99, 11.64, 14.05, 16.64, 19.1, 21.61, 24.15, 26.72, 29.31, 31.75, 34.49, 36.91, 39.42,
  41.94,
];

/** Column centres, from the same conversion. */
const ESP32_ROW_X_LEFT = 1.32;
const ESP32_ROW_X_RIGHT = 26.81;

// Keyed by *header* label, not silkscreen. The two differ on this board -- the
// header calls GPIO36 "VP", GPIO39 "VN" and GPIO15 "D15" -- and keying this by
// silkscreen silently leaves those three pins unreachable from firmware.
const ESP32_GPIO_NUMBERS: Readonly<Record<string, number>> = {
  EN: -1,
  VP: 36,
  VN: 39,
  GPIO34: 34,
  GPIO35: 35,
  GPIO32: 32,
  GPIO33: 33,
  GPIO25: 25,
  GPIO26: 26,
  GPIO27: 27,
  GPIO14: 14,
  GPIO12: 12,
  GND: -1,
  GPIO13: 13,
  D9: 9,
  D23: 23,
  D22: 22,
  TX0: 1,
  RX0: 3,
  D21: 21,
  D19: 19,
  D18: 18,
  D5: 5,
  TX2: 17,
  RX2: 16,
  D4: 4,
  D2: 2,
  D15: 15,
  D14: 14,
  D13: 13,
  D12: 12,
  VIN: -1,
  '3V3': -1,
};

/** ADC1 channels for the ESP32 pins that expose them. */
const ESP32_ADC_CHANNELS: Readonly<Record<string, number>> = {
  VP: 0,
  VN: 3,
  GPIO34: 6,
  GPIO35: 7,
  GPIO32: 4,
  GPIO33: 5,
  GPIO27: 1,
};

/** Header labels of the pins with no output driver or internal pull-up. */
const ESP32_INPUT_ONLY = new Set(['VP', 'VN', 'GPIO34', 'GPIO35']);

/**
 * Header labels of the pins sampled at reset, and the level they expect.
 *
 * Keyed by the header label, so these are the rows Wokwi calls D12 and D15 --
 * the silkscreen on the artwork beside them reads GPIO12 and GPIO15.
 */
const ESP32_STRAPPING: Readonly<Record<string, 'low' | 'high'>> = {
  D12: 'low',
  D15: 'high',
};

function esp32BoardPin(id: string, headerLabel: string, silkscreen: string): BoardPin {
  const gpio = ESP32_GPIO_NUMBERS[headerLabel] ?? -1;
  const isPower = silkscreen === '3V3' || silkscreen === 'VIN';
  const isGround = silkscreen === 'GND';

  return {
    id,
    label: silkscreen,
    role: isPower
      ? 'power'
      : isGround
        ? 'ground'
        : headerLabel in ESP32_ADC_CHANNELS
          ? 'adc'
          : 'gpio',
    gpio: gpio >= 0 ? gpio : undefined,
    adc: ESP32_ADC_CHANNELS[headerLabel],
    strapLevel: ESP32_STRAPPING[headerLabel],
    canDrive: !ESP32_INPUT_ONLY.has(headerLabel),
  };
}

function esp32Definition(): PartDefinition {
  const pins: PinSpec[] = [];
  const boardPins: BoardPin[] = [];

  // Ids carry a header prefix because both headers repeat a label -- each
  // carries its own GND, and a shared id would let one pin silently overwrite
  // the other's terminal. The silkscreen label stays unprefixed for rendering.
  // The two headers are 15 and 15 rows on the same pitch, so both walk the one
  // table; the artwork's own pin list has them in that order.
  const addHeader = (header: readonly [string, string][], prefix: string, x: number) => {
    header.forEach(([headerLabel, silkscreen], index) => {
      const id = `${prefix}_${headerLabel}`;
      pins.push({
        id,
        label: silkscreen,
        x,
        y: ESP32_PIN_Y_MM[index],
        net:
          silkscreen === 'GND'
            ? 'GND'
            : silkscreen === 'VIN'
              ? 'VIN'
              : silkscreen === '3V3'
                ? '3V3'
                : undefined,
      });
      boardPins.push(esp32BoardPin(id, headerLabel, silkscreen));
    });
  };

  addHeader(ESP32_LEFT_HEADER, 'L', ESP32_ROW_X_LEFT);
  addHeader(ESP32_RIGHT_HEADER, 'R', ESP32_ROW_X_RIGHT);

  return {
    id: 'esp32-devkit-v1',
    name: 'ESP32 DevKit V1',
    category: 'board',
    widthMm: 28.2,
    heightMm: 54.053,
    component: {
      kind: 'mcu',
      board: {
        id: 'esp32',
        name: 'ESP32',
        logicVolts: 3.3,
        serialPrefix: 'ESP32',
        // Default drive strength is roughly 40 Ohm in both directions. That is
        // what limits the current when a pin is shorted to ground, and it is
        // the number that makes that fault survivable rather than magic.
        sourceOhms: 40,
        sinkOhms: 40,
        pwmHz: 1000,
        adcBits: 12,
      },
    },
    pins,
    boardPins,
    bodyColour: '#1c1f24',
    legendColour: '#e8e8e8',
  };
}

/**
 * The Uno's pin rows, as the `wokwi-arduino-uno` element draws them.
 *
 * Coordinates come from the element's `pinInfo` converted through its measured
 * 96dpi constant. The top row runs along one edge in two blocks with the board's
 * gap between pin 7 and pin 8; the bottom row carries the power block and then
 * the analog block.
 *
 * Each entry is `[header label, pin id suffix, x in mm]`. Ids are spelled out
 * rather than derived from the label because three pins on this board are called
 * `GND` and a derived id would silently collapse them into one.
 */
const UNO_TOP_ROW: ReadonlyArray<readonly [string, string, number]> = [
  ['SCL', 'SCL', 23.02],
  ['SDA', 'SDA', 25.66],
  ['AREF', 'AREF', 28.05],
  ['GND', 'GND', 30.56],
  ['13', 'D13', 33.07],
  ['12', 'D12', 35.59],
  ['11', 'D11', 38.1],
  ['10', 'D10', 40.61],
  ['9', 'D9', 43.13],
  ['8', 'D8', 45.77],
  ['7', 'D7', 50.01],
  ['6', 'D6', 52.52],
  ['5', 'D5', 55.03],
  ['4', 'D4', 57.55],
  ['3', 'D3', 60.06],
  ['2', 'D2', 62.57],
  ['1', 'TX', 65.09],
  ['0', 'RX', 67.6],
];

/** Bottom edge: the power block first, then the analog inputs. */
const UNO_BOTTOM_ROW: ReadonlyArray<readonly [string, string, number]> = [
  ['IOREF', 'IOREF', 34.66],
  ['RESET', 'RESET', 37.17],
  ['3V3', '3V3', 39.69],
  ['5V', '5V', 42.33],
  ['GND', 'GND', 44.85],
  ['GND', 'GND2', 47.36],
  ['VIN', 'VIN', 49.87],
  ['A0', 'A0', 55.03],
  ['A1', 'A1', 57.55],
  ['A2', 'A2', 60.06],
  ['A3', 'A3', 62.57],
  ['A4', 'A4', 65.09],
  ['A5', 'A5', 67.6],
];

/** The two rows, in the artwork's coordinate space. */
const UNO_ROW_Y = { top: 2.38, bottom: 50.67 };

/**
 * Prefix per header block, kept so existing pin ids survive the move to Wokwi's
 * layout. The analog inputs stay `J3` because firmware resolves A4/A5 there.
 */
const UNO_ANALOG_FROM = 7;

/**
 * Keyed by *header label*, not pin id: the two differ on this board, and
 * keying by id would silently drop every digital pin.
 *
 * SDA and SCL carry no number because they are the same pins as the numbered 4
 * and 5 beside them. A second board pin claiming either number would overwrite
 * the first in `pinIdByGpio` and take its terminal with it -- and a sketch
 * reaches the bus through A4 and A5, which is what the hardware does too.
 */
const UNO_PIN_GPIOS: Readonly<Record<string, number>> = {
  13: 13,
  12: 12,
  11: 11,
  10: 10,
  9: 9,
  8: 8,
  7: 7,
  6: 6,
  5: 5,
  4: 4,
  3: 3,
  2: 2,
  1: 1,
  0: 0,
  A0: 14,
  A1: 15,
  A2: 16,
  A3: 17,
  A4: 18,
  A5: 19,
};

const UNO_ANALOG: Readonly<Record<string, number>> = {
  A0: 0,
  A1: 1,
  A2: 2,
  A3: 3,
  A4: 4,
  A5: 5,
};

function unoBoardPin(id: string, headerLabel: string): BoardPin {
  const isGround = headerLabel === 'GND';
  const isPower =
    headerLabel === '5V' ||
    headerLabel === '3V3' ||
    headerLabel === 'VIN' ||
    headerLabel === 'IOREF';
  return {
    id,
    label: headerLabel,
    role: isGround ? 'ground' : isPower ? 'power' : headerLabel in UNO_ANALOG ? 'adc' : 'gpio',
    gpio: UNO_PIN_GPIOS[headerLabel],
    adc: UNO_ANALOG[headerLabel],
    canDrive: true,
  };
}

function unoDefinition(): PartDefinition {
  const pins: PinSpec[] = [];
  const boardPins: BoardPin[] = [];

  const addPin = (prefix: string, row: readonly [string, string, number], y: number) => {
    const [headerLabel, suffix, x] = row;
    const id = `${prefix}_${suffix}`;
    pins.push({
      id,
      label: headerLabel,
      x,
      y,
      net:
        headerLabel === 'GND'
          ? 'GND'
          : headerLabel === '5V'
            ? '5V'
            : headerLabel === '3V3'
              ? '3V3'
              : undefined,
    });
    boardPins.push(unoBoardPin(id, headerLabel));
  };

  for (const row of UNO_TOP_ROW) addPin('J1', row, UNO_ROW_Y.top);
  UNO_BOTTOM_ROW.forEach((row, index) => {
    addPin(index >= UNO_ANALOG_FROM ? 'J3' : 'J2', row, UNO_ROW_Y.bottom);
  });

  return {
    id: 'arduino-uno-r3',
    name: 'Arduino Uno R3',
    category: 'board',
    widthMm: 72.58,
    heightMm: 53.34,
    component: {
      kind: 'mcu',
      board: {
        id: 'uno',
        name: 'Arduino Uno',
        logicVolts: 5,
        serialPrefix: 'Arduino Uno',
        // ATmega328P output impedance: lower sourcing than sinking.
        sourceOhms: 25,
        sinkOhms: 50,
        pwmHz: 490,
        adcBits: 10,
      },
    },
    pins,
    boardPins,
    bodyColour: '#0d6ebd',
    legendColour: '#ffffff',
  };
}

/**
 * Arduino Mega 2560, as the `wokwi-arduino-mega` element draws it.
 *
 * The ATmega2560 is the Uno with four times the I/O, and what a sketch notices
 * is the numbering rather than the count: the analog block continues the
 * digital sequence at 54, so `digitalWrite(54)` is A0 and A15 is 69 -- sixteen
 * analog pins against the Uno's six -- and the four hardware UARTs sit on
 * 0/1, 14/15, 16/17 and 18/19 instead of the Uno's single pair. The two holes
 * the silkscreen calls SDA and SCL are the same two it calls 20 and 21, on
 * the real board as much as here, so those share a pin number exactly as the
 * Uno's SDA and SCL share 4 and 5 with its digital 4 and 5.
 *
 * The element folds the Mega's J2 header into two columns to fit 36 holes
 * along one edge, so each column takes its own id prefix; the `.N` the element
 * appends to a repeated name is dropped, because the prefix has already made
 * the id unique. The power row is the one place a prefix cannot do that -- it
 * carries two grounds inside a single header -- so the second is spelled
 * `GND2`, which is the Uno's spelling too.
 */

/**
 * One header hole: [header label, pin id suffix, x in mm, y in mm].
 *
 * The suffix is spelled out rather than derived from the label wherever a
 * prefix cannot keep the ids apart, for the same reason the Uno's is.
 */
type HeaderHole = readonly [string, string, number, number];

/**
 * J1 along the top edge: the I2C pair, the analog reference and ground, then
 * digital 0 to 21 in the order the silkscreen numbers them.
 */
const MEGA_J1: ReadonlyArray<HeaderHole> = [
  ['SCL', 'SCL', 23.813, 2.381],
  ['SDA', 'SDA', 26.458, 2.381],
  ['AREF', 'AREF', 28.84, 2.381],
  ['GND', 'GND', 31.485, 2.381],
  ['13', '13', 34.131, 2.381],
  ['12', '12', 36.513, 2.381],
  ['11', '11', 39.158, 2.381],
  ['10', '10', 41.672, 2.381],
  ['9', '9', 44.318, 2.381],
  ['8', '8', 46.831, 2.381],
  ['7', '7', 50.271, 2.381],
  ['6', '6', 52.917, 2.381],
  ['5', '5', 55.43, 2.381],
  ['4', '4', 57.944, 2.381],
  ['3', '3', 60.457, 2.381],
  ['2', '2', 62.971, 2.381],
  ['1', '1', 65.484, 2.381],
  ['0', '0', 68.13, 2.381],
  ['14', '14', 71.57, 2.381],
  ['15', '15', 74.083, 2.381],
  ['16', '16', 76.597, 2.381],
  ['17', '17', 79.11, 2.381],
  ['18', '18', 81.624, 2.381],
  ['19', '19', 84.27, 2.381],
  ['20', '20', 86.783, 2.381],
  ['21', '21', 89.297, 2.381],
];

/** The inner half of the split J2 header: the even pins, with 5V and GND. */
const MEGA_J2_INNER: ReadonlyArray<HeaderHole> = [
  ['5V', '5V', 95.515, 2.117],
  ['22', '22', 95.515, 4.63],
  ['24', '24', 95.515, 7.21],
  ['26', '26', 95.515, 9.723],
  ['28', '28', 95.515, 12.237],
  ['30', '30', 95.515, 14.817],
  ['32', '32', 95.515, 17.33],
  ['34', '34', 95.515, 19.844],
  ['36', '36', 95.515, 22.357],
  ['38', '38', 95.515, 24.937],
  ['40', '40', 95.515, 27.451],
  ['42', '42', 95.515, 30.03],
  ['44', '44', 95.515, 32.544],
  ['46', '46', 95.515, 35.123],
  ['48', '48', 95.515, 37.637],
  ['50', '50', 95.515, 40.217],
  ['52', '52', 95.515, 42.73],
  ['GND', 'GND', 95.515, 45.31],
];

/** The outer half: the odd pins, between the same two rails. */
const MEGA_J2_OUTER: ReadonlyArray<HeaderHole> = [
  ['5V', '5V', 98.16, 2.117],
  ['23', '23', 98.16, 4.63],
  ['25', '25', 98.16, 7.21],
  ['27', '27', 98.16, 9.723],
  ['29', '29', 98.16, 12.237],
  ['31', '31', 98.16, 14.817],
  ['33', '33', 98.16, 17.33],
  ['35', '35', 98.16, 19.844],
  ['37', '37', 98.16, 22.357],
  ['39', '39', 98.16, 24.937],
  ['41', '41', 98.16, 27.451],
  ['43', '43', 98.16, 30.03],
  ['45', '45', 98.16, 32.544],
  ['47', '47', 98.16, 35.123],
  ['49', '49', 98.16, 37.637],
  ['51', '51', 98.16, 40.217],
  ['53', '53', 98.16, 42.73],
  ['GND', 'GND', 98.16, 45.31],
];

/**
 * J3 along the bottom edge: the power block, then the analog inputs. Wokwi
 * names the 3.3 V pin `3.3V`; the label here is `3V3`, which is both what the
 * silkscreen says and the net name the rest of the bench uses.
 */
const MEGA_J3: ReadonlyArray<HeaderHole> = [
  ['IOREF', 'IOREF', 35.983, 48.816],
  ['RESET', 'RESET', 38.497, 48.816],
  ['3V3', '3V3', 41.01, 48.816],
  ['5V', '5V', 43.524, 48.816],
  ['GND', 'GND', 46.104, 48.816],
  ['GND', 'GND2', 48.617, 48.816],
  ['VIN', 'VIN', 51.197, 48.816],
  ['A0', 'A0', 55.166, 48.816],
  ['A1', 'A1', 57.679, 48.816],
  ['A2', 'A2', 60.193, 48.816],
  ['A3', 'A3', 62.772, 48.816],
  ['A4', 'A4', 65.286, 48.816],
  ['A5', 'A5', 67.799, 48.816],
  ['A6', 'A6', 70.379, 48.816],
  ['A7', 'A7', 72.893, 48.816],
  ['A8', 'A8', 76.795, 48.816],
  ['A9', 'A9', 79.375, 48.816],
  ['A10', 'A10', 81.889, 48.816],
  ['A11', 'A11', 84.468, 48.816],
  ['A12', 'A12', 86.982, 48.816],
  ['A13', 'A13', 89.561, 48.816],
  ['A14', 'A14', 92.075, 48.816],
  ['A15', 'A15', 94.655, 48.816],
];

/**
 * Keyed by *header label*, not pin id, for the reason every board here keys
 * this way: the two differ wherever the artwork renames a hole, and keying by
 * id would silently drop those pins from firmware.
 *
 * The analog half continues the digital sequence at 54 rather than counting
 * from zero as it does on the Uno, which is the trap worth remembering when a
 * sketch moves between the two.
 *
 * SDA and SCL are the same pins as the numbered 20 and 21 beside them, and
 * carry no number for the reason the Uno's do not: a pin number resolves to
 * one board pin, and two of them claiming it means one loses its terminal.
 */
const MEGA_PIN_GPIOS: Readonly<Record<string, number>> = {
  0: 0,
  1: 1,
  2: 2,
  3: 3,
  4: 4,
  5: 5,
  6: 6,
  7: 7,
  8: 8,
  9: 9,
  10: 10,
  11: 11,
  12: 12,
  13: 13,
  14: 14,
  15: 15,
  16: 16,
  17: 17,
  18: 18,
  19: 19,
  20: 20,
  21: 21,
  22: 22,
  23: 23,
  24: 24,
  25: 25,
  26: 26,
  27: 27,
  28: 28,
  29: 29,
  30: 30,
  31: 31,
  32: 32,
  33: 33,
  34: 34,
  35: 35,
  36: 36,
  37: 37,
  38: 38,
  39: 39,
  40: 40,
  41: 41,
  42: 42,
  43: 43,
  44: 44,
  45: 45,
  46: 46,
  47: 47,
  48: 48,
  49: 49,
  50: 50,
  51: 51,
  52: 52,
  53: 53,
  A0: 54,
  A1: 55,
  A2: 56,
  A3: 57,
  A4: 58,
  A5: 59,
  A6: 60,
  A7: 61,
  A8: 62,
  A9: 63,
  A10: 64,
  A11: 65,
  A12: 66,
  A13: 67,
  A14: 68,
  A15: 69,
};

const MEGA_ANALOG: Readonly<Record<string, number>> = {
  A0: 0,
  A1: 1,
  A2: 2,
  A3: 3,
  A4: 4,
  A5: 5,
  A6: 6,
  A7: 7,
  A8: 8,
  A9: 9,
  A10: 10,
  A11: 11,
  A12: 12,
  A13: 13,
  A14: 14,
  A15: 15,
};

function megaBoardPin(id: string, headerLabel: string): BoardPin {
  const isGround = headerLabel === 'GND';
  const isPower =
    headerLabel === '5V' ||
    headerLabel === '3V3' ||
    headerLabel === 'VIN' ||
    headerLabel === 'IOREF';
  return {
    id,
    label: headerLabel,
    role: isGround ? 'ground' : isPower ? 'power' : headerLabel in MEGA_ANALOG ? 'adc' : 'gpio',
    gpio: MEGA_PIN_GPIOS[headerLabel],
    adc: MEGA_ANALOG[headerLabel],
    // No pin on this board is input-only. The port pins behind 0-53 are plain
    // bidirectional I/O, and there is no equivalent of the ESP32's GPIO34-39
    // for a sketch to trip over.
    canDrive: true,
  };
}

function megaDefinition(): PartDefinition {
  const pins: PinSpec[] = [];
  const boardPins: BoardPin[] = [];

  const addPin = (prefix: string, hole: HeaderHole) => {
    const [headerLabel, suffix, x, y] = hole;
    const id = `${prefix}_${suffix}`;
    pins.push({
      id,
      label: headerLabel,
      x,
      y,
      net:
        headerLabel === 'GND'
          ? 'GND'
          : headerLabel === '5V'
            ? '5V'
            : headerLabel === '3V3'
              ? '3V3'
              : undefined,
    });
    boardPins.push(megaBoardPin(id, headerLabel));
  };

  for (const hole of MEGA_J1) addPin('J1', hole);
  for (const hole of MEGA_J2_INNER) addPin('J2a', hole);
  for (const hole of MEGA_J2_OUTER) addPin('J2b', hole);
  for (const hole of MEGA_J3) addPin('J3', hole);

  return {
    id: 'arduino-mega-2560',
    name: 'Arduino Mega 2560',
    category: 'board',
    widthMm: 102.66,
    heightMm: 50.8,
    component: {
      kind: 'mcu',
      board: {
        id: 'mega',
        name: 'Arduino Mega 2560',
        logicVolts: 5,
        serialPrefix: 'Arduino Mega',
        // The same output stage as the Uno's ATmega328P: the datasheet allows
        // the same 20 mA per pin either way, sourcing harder than sinking.
        sourceOhms: 25,
        sinkOhms: 50,
        pwmHz: 490,
        adcBits: 10,
      },
    },
    pins,
    boardPins,
    bodyColour: '#0d6ebd',
    legendColour: '#ffffff',
  };
}

/**
 * Arduino Nano, as the `wokwi-arduino-nano` element draws it.
 *
 * The same ATmega328P as the Uno on a board a third of the size, so the pin
 * numbers are the Uno's: A0-A7 are digital 14 to 21 and the lamp is on 13. The
 * two that matter are A6 and A7 -- the 328P reaches them only through the ADC,
 * with no port pin and so no output driver and no internal pull-up, which is
 * the reason `INPUT_PULLUP` does nothing there.
 */
const NANO_J1: ReadonlyArray<HeaderHole> = [
  ['12', '12', 5.212, 1.27],
  ['11', '11', 7.752, 1.27],
  ['10', '10', 10.292, 1.27],
  ['9', '9', 12.832, 1.27],
  ['8', '8', 15.372, 1.27],
  ['7', '7', 17.912, 1.27],
  ['6', '6', 20.452, 1.27],
  ['5', '5', 22.992, 1.27],
  ['4', '4', 25.532, 1.27],
  ['3', '3', 28.072, 1.27],
  ['2', '2', 30.612, 1.27],
  ['GND', 'GND', 33.152, 1.27],
  ['RESET', 'RESET', 35.692, 1.27],
  ['0', '0', 38.232, 1.27],
  ['1', '1', 40.772, 1.27],
];

/** Bottom edge: D13 and the power block first, then the analog inputs. */
const NANO_BOTTOM_ROW: ReadonlyArray<HeaderHole> = [
  ['13', '13', 5.212, 16.51],
  ['3V3', '3V3', 7.752, 16.51],
  ['AREF', 'AREF', 10.292, 16.51],
  ['A0', 'A0', 12.832, 16.51],
  ['A1', 'A1', 15.372, 16.51],
  ['A2', 'A2', 17.912, 16.51],
  ['A3', 'A3', 20.452, 16.51],
  ['A4', 'A4', 22.992, 16.51],
  ['A5', 'A5', 25.532, 16.51],
  ['A6', 'A6', 28.072, 16.51],
  ['A7', 'A7', 30.612, 16.51],
  ['5V', '5V', 33.152, 16.51],
  ['RESET', 'RESET', 35.692, 16.51],
  ['GND', 'GND', 38.232, 16.51],
  ['VIN', 'VIN', 40.772, 16.51],
];

/** Where the bottom row stops being the power block and becomes the analog one. */
const NANO_ANALOG_FROM = 3;

/**
 * The ICSP pads at the far edge: the element draws them as duplicate holes for
 * 11, 12, 13, RESET, 5V and GND, which are the same pins the two headers
 * already carry. Wokwi marks them no-breadboard, but a jumper aimed at the
 * silkscreen beside them lands on one, so they are here with their own ids --
 * the prefix keeps those apart from the header pins they duplicate, and
 * `nanoBoardPin` keeps them off the pin numbers those headers already own.
 */
const NANO_ICSP: ReadonlyArray<HeaderHole> = [
  ['12', '12', 43.312, 11.43],
  ['5V', '5V', 40.772, 11.43],
  ['13', '13', 43.312, 8.89],
  ['11', '11', 40.772, 8.89],
  ['RESET', 'RESET', 43.312, 6.35],
  ['GND', 'GND', 40.772, 6.35],
];

const NANO_PIN_GPIOS: Readonly<Record<string, number>> = {
  0: 0,
  1: 1,
  2: 2,
  3: 3,
  4: 4,
  5: 5,
  6: 6,
  7: 7,
  8: 8,
  9: 9,
  10: 10,
  11: 11,
  12: 12,
  13: 13,
  A0: 14,
  A1: 15,
  A2: 16,
  A3: 17,
  A4: 18,
  A5: 19,
  A6: 20,
  A7: 21,
};

const NANO_ANALOG: Readonly<Record<string, number>> = {
  A0: 0,
  A1: 1,
  A2: 2,
  A3: 3,
  A4: 4,
  A5: 5,
  A6: 6,
  A7: 7,
};

function nanoBoardPin(id: string, headerLabel: string): BoardPin {
  const isGround = headerLabel === 'GND';
  const isPower = headerLabel === '5V' || headerLabel === '3V3' || headerLabel === 'VIN';
  // One number per physical pin is the rule here: the runtime keys its pins by
  // gpio, so a second hole claiming 11 or 13 would take the header's terminal
  // and every `digitalWrite(13)` would land at the far edge of the board.
  const isIcssp = id.startsWith('IC_');
  return {
    id,
    label: headerLabel,
    role: isGround ? 'ground' : isPower ? 'power' : headerLabel in NANO_ANALOG ? 'adc' : 'gpio',
    gpio: isIcssp ? undefined : NANO_PIN_GPIOS[headerLabel],
    adc: isIcssp ? undefined : NANO_ANALOG[headerLabel],
    // A6 and A7 are digital 20 and 21, and they are the only pins on the 328P
    // that number without a port bit behind them: the ADC reaches them, the
    // output driver and the internal pull-up do not.
    canDrive: headerLabel !== 'A6' && headerLabel !== 'A7',
  };
}

function nanoDefinition(): PartDefinition {
  const pins: PinSpec[] = [];
  const boardPins: BoardPin[] = [];

  const addPin = (prefix: string, hole: HeaderHole) => {
    const [headerLabel, suffix, x, y] = hole;
    const id = `${prefix}_${suffix}`;
    pins.push({
      id,
      label: headerLabel,
      x,
      y,
      net:
        headerLabel === 'GND'
          ? 'GND'
          : headerLabel === '5V'
            ? '5V'
            : headerLabel === '3V3'
              ? '3V3'
              : undefined,
    });
    boardPins.push(nanoBoardPin(id, headerLabel));
  };

  for (const hole of NANO_J1) addPin('J1', hole);
  NANO_BOTTOM_ROW.forEach((hole, index) => {
    addPin(index >= NANO_ANALOG_FROM ? 'J3' : 'J2', hole);
  });
  for (const hole of NANO_ICSP) addPin('IC', hole);

  return {
    id: 'arduino-nano',
    name: 'Arduino Nano',
    category: 'board',
    widthMm: 44.9,
    heightMm: 17.8,
    component: {
      kind: 'mcu',
      board: {
        id: 'nano',
        name: 'Arduino Nano',
        logicVolts: 5,
        serialPrefix: 'Arduino Nano',
        // ATmega328P output impedance: lower sourcing than sinking.
        sourceOhms: 25,
        sinkOhms: 50,
        pwmHz: 490,
        adcBits: 10,
      },
    },
    pins,
    boardPins,
    bodyColour: '#1b7e84',
    legendColour: '#eee',
  };
}

/**
 * Arduino Nano RP2040 Connect, as the `wokwi-nano-rp2040-connect` element
 * draws it. It runs at 3.3 V like the ESP32, so a 5 V part on a pin damages it
 * rather than merely misbehaving. Its built-in LED is the RGB one on GPIO25,
 * which is on the board edge rather than a header, so no sketch can reach it
 * by number.
 *
 * Note the TX and RX holes: here the one the silkscreen calls TX is GPIO0 and
 * the one it calls RX is GPIO1, the other way round from every ATmega board
 * above, because the RP2040's UART0 puts its transmit on GPIO0.
 */
const RP2040_J1: ReadonlyArray<HeaderHole> = [
  ['D12', 'D12', 5.318, 0.265],
  ['D11', 'D11', 7.885, 0.265],
  ['D10', 'D10', 10.398, 0.265],
  ['D9', 'D9', 12.938, 0.265],
  ['D8', 'D8', 15.478, 0.265],
  ['D7', 'D7', 18.018, 0.265],
  ['D6', 'D6', 20.558, 0.265],
  ['D5', 'D5', 23.098, 0.265],
  ['D4', 'D4', 25.638, 0.265],
  ['D3', 'D3', 28.178, 0.265],
  ['D2', 'D2', 30.718, 0.265],
  ['GND', 'GND', 33.126, 0.265],
  ['RESET', 'RESET', 35.798, 0.265],
  ['RX', 'RX', 40.719, 0.265],
  ['TX', 'TX', 38.232, 0.265],
];

/** The head of the bottom row: the lamp, the 3.3 V rail and the reference. */
const RP2040_J2: ReadonlyArray<HeaderHole> = [
  ['D13', 'D13', 5.318, 17.859],
  ['3V3', '3V3', 7.858, 17.859],
  ['AREF', 'AREF', 10.398, 17.859],
];

/** The rest of the bottom row: the analog inputs, then the power block. */
const RP2040_J3: ReadonlyArray<HeaderHole> = [
  ['A0', 'A0', 12.912, 17.859],
  ['A1', 'A1', 15.478, 17.859],
  ['A2', 'A2', 17.992, 17.859],
  ['A3', 'A3', 20.532, 17.859],
  ['A4', 'A4', 23.098, 17.859],
  ['A5', 'A5', 25.638, 17.859],
  ['A6', 'A6', 28.178, 17.859],
  ['A7', 'A7', 30.718, 17.859],
  ['5V', '5V', 33.205, 17.859],
  ['RESET', 'RESET', 35.692, 17.859],
  ['GND', 'GND', 38.444, 17.859],
  ['VIN', 'VIN', 40.772, 17.859],
];

/**
 * The digital header is numbered the way a sketch names it: D2 is pin 2, and
 * TX and RX are pins 0 and 1.
 */
const RP2040_PIN_GPIOS: Readonly<Record<string, number>> = {
  TX: 0,
  RX: 1,
  D2: 2,
  D3: 3,
  D4: 4,
  D5: 5,
  D6: 6,
  D7: 7,
  D8: 8,
  D9: 9,
  D10: 10,
  D11: 11,
  D12: 12,
  D13: 13,
};

/**
 * What the analog block's holes are on the chip: the GPIO number firmware
 * addresses them by, and the ADC channel they sample from.
 *
 * Only A0-A3 have either. They are GPIO26 to GPIO29 and the ADC's four
 * channels, so `analogRead(26)` and `analogRead(A0)` are the same pin. A4 and
 * A5 are the I2C pair -- GPIO12 and GPIO13, which D12 and D13 already bring out
 * on this board -- and A6 and A7 have no GPIO behind them at all.
 *
 * A4/A5 stay unnumbered here on purpose: the runtime keys pins by gpio, so a
 * second pin claiming 12 would take over D12's terminal. Their pin specs share
 * an internal net with D12/D13 instead (`RP2040_ALIASED_NETS`), which is how a
 * wire on A4 becomes the same node as firmware's GPIO12 and the I2C bus can
 * reach it. The ADC has four channels, so a number on A6 would only resolve
 * `analogRead` to a pin the chip cannot sample; A6/A7 are reached by wiring,
 * not by firmware.
 */
const RP2040_ANALOG: Readonly<Record<string, { gpio?: number; adc?: number }>> = {
  A0: { gpio: 26, adc: 0 },
  A1: { gpio: 27, adc: 1 },
  A2: { gpio: 28, adc: 2 },
  A3: { gpio: 29, adc: 3 },
  A4: {},
  A5: {},
  A6: {},
  A7: {},
};

/**
 * Holes that bring out the same silicon pad under two silkscreens.
 *
 * A4 and A5 are the I2C pair, and they are GPIO12/GPIO13; D12 and D13 bring out
 * those same GPIOs. The GPIO numbers belong to D12/D13 in `boardPins` so the
 * runtime keeps one terminal per number, and these internal nets make a wire on
 * A4 the same electrical node as GPIO12, which is what lets the bus find it.
 */
const RP2040_ALIASED_NETS: Readonly<Record<string, string>> = {
  D12: 'GPIO12',
  A4: 'GPIO12',
  D13: 'GPIO13',
  A5: 'GPIO13',
};

function rp2040BoardPin(id: string, headerLabel: string): BoardPin {
  const isGround = headerLabel === 'GND';
  const isPower = headerLabel === '5V' || headerLabel === '3V3' || headerLabel === 'VIN';
  const analog = RP2040_ANALOG[headerLabel];
  return {
    id,
    label: headerLabel,
    role: isGround ? 'ground' : isPower ? 'power' : analog ? 'adc' : 'gpio',
    gpio: analog?.gpio ?? RP2040_PIN_GPIOS[headerLabel],
    adc: analog?.adc,
    // A4 and A5 are ordinary I2C pins and drive; A6 and A7 are ADC aliases with
    // nothing behind them, the same dead end as the ESP32's GPIO34-39.
    canDrive: headerLabel !== 'A6' && headerLabel !== 'A7',
  };
}

function rp2040Definition(): PartDefinition {
  const pins: PinSpec[] = [];
  const boardPins: BoardPin[] = [];

  const addPin = (prefix: string, hole: HeaderHole) => {
    const [headerLabel, suffix, x, y] = hole;
    const id = `${prefix}_${suffix}`;
    pins.push({
      id,
      label: headerLabel,
      x,
      y,
      net:
        headerLabel === 'GND'
          ? 'GND'
          : headerLabel === '5V'
            ? '5V'
            : headerLabel === '3V3'
              ? '3V3'
              : RP2040_ALIASED_NETS[headerLabel],
    });
    boardPins.push(rp2040BoardPin(id, headerLabel));
  };

  for (const hole of RP2040_J1) addPin('J1', hole);
  for (const hole of RP2040_J2) addPin('J2', hole);
  for (const hole of RP2040_J3) addPin('J3', hole);

  return {
    id: 'arduino-nano-rp2040-connect',
    name: 'Arduino Nano RP2040 Connect',
    category: 'board',
    widthMm: 44.573,
    heightMm: 17.956,
    component: {
      kind: 'mcu',
      board: {
        id: 'rp2040',
        name: 'Arduino Nano RP2040 Connect',
        logicVolts: 3.3,
        serialPrefix: 'Arduino Nano RP2040 Connect',
        // The RP2040's GPIO driver is about 40 Ohm either way at its default
        // drive strength, one of four the silicon can be configured for.
        sourceOhms: 40,
        sinkOhms: 40,
        pwmHz: 1000,
        adcBits: 12,
      },
    },
    pins,
    boardPins,
    bodyColour: '#1d1d1b',
    legendColour: '#eaecec',
  };
}

/**
 * Franzininho, as the `wokwi-franzininho` element draws it.
 *
 * An ATtiny85 rather than an ATmega, and the difference is not cosmetic: six I/O
 * pins instead of twenty, numbered by firmware position rather than by header
 * order, so the silkscreen's PB5 is pin 4 and its PB4 is pin 5. Port B carries
 * the whole SPI and I2C peripheral, which is why the header is those six pins
 * and the chip's seventh I/O pin, PB3, is on it as the USI's chip select.
 *
 * PB5 is the reset pin, brought out on the header and usable as pin 4 all the
 * same -- the sort of thing a tutorial about this board mentions once and then
 * forgets.
 *
 * The board's own lamp, LED1, sits on PB1, so pin 1 drives the header and the
 * lamp together. The bench solves the pin; the lamp in the artwork is the
 * element's own.
 */
const FRANZINHO_J1: ReadonlyArray<HeaderHole> = [
  ['GND', 'GND.1', 57.811, 6.165],
  ['VCC', 'VCC.1', 57.811, 8.705],
  ['PB4', 'PB4', 57.811, 11.245],
  ['PB5', 'PB5', 57.811, 13.811],
  ['PB3', 'PB3', 57.811, 16.326],
  ['PB2', 'PB2', 57.811, 18.838],
  ['PB1', 'PB1', 57.811, 21.405],
  ['PB0', 'PB0', 57.811, 23.945],
];

/** Along the top edge: the supply row, left to right as the element draws it. */
const FRANZINHO_J2: ReadonlyArray<HeaderHole> = [
  ['VIN', 'VIN', 35.11, 2.143],
  ['GND', 'GND.2', 37.81, 2.143],
  ['VCC', 'VCC.2', 40.481, 2.143],
];

/**
 * The firmware number of each header pin, keyed by the silkscreen beside it.
 *
 * The port bit order is not the pin order: PB5 is digital 4 and PB4 is digital
 * 5, which is the one mapping a sketch ported from an Uno gets wrong. The ADC
 * channels are the element's own declarations, which is why A0 lands on PB5
 * rather than where the datasheet's ADC0 would put it.
 */
const FRANZINHO_PINS: Readonly<Record<string, { gpio: number; adc?: number }>> = {
  PB0: { gpio: 0 },
  PB1: { gpio: 1 },
  PB2: { gpio: 2, adc: 1 },
  PB3: { gpio: 3, adc: 3 },
  PB5: { gpio: 4, adc: 0 },
  PB4: { gpio: 5, adc: 2 },
};

function franzininhoBoardPin(id: string, headerLabel: string): BoardPin {
  const isGround = headerLabel === 'GND';
  const isPower = headerLabel === 'VCC' || headerLabel === 'VIN';
  const io = FRANZINHO_PINS[headerLabel];
  return {
    id,
    label: headerLabel,
    role: isGround ? 'ground' : isPower ? 'power' : io?.adc !== undefined ? 'adc' : 'gpio',
    gpio: io?.gpio,
    adc: io?.adc,
  };
}

function franzininhoDefinition(): PartDefinition {
  const pins: PinSpec[] = [];
  const boardPins: BoardPin[] = [];

  const addPin = (prefix: string, hole: HeaderHole) => {
    const [headerLabel, suffix, x, y] = hole;
    const id = `${prefix}_${suffix}`;
    pins.push({
      id,
      label: headerLabel,
      x,
      y,
      net: headerLabel === 'GND' ? 'GND' : headerLabel === 'VCC' ? '5V' : undefined,
    });
    boardPins.push(franzininhoBoardPin(id, headerLabel));
  };

  for (const hole of FRANZINHO_J1) addPin('J1', hole);
  for (const hole of FRANZINHO_J2) addPin('J2', hole);

  return {
    id: 'franzininho',
    name: 'Franzininho',
    category: 'board',
    widthMm: 64,
    heightMm: 30,
    component: {
      kind: 'mcu',
      board: {
        id: 'franzininho',
        name: 'Franzininho',
        logicVolts: 5,
        serialPrefix: 'Franzininho',
        // The AVR output stage the ATmega boards above run at: the datasheet
        // allows the same current sourcing as sinking but less of it, and at
        // these currents the impedances are the same figure.
        sourceOhms: 25,
        sinkOhms: 50,
        // Timer0's PWM. The prescaler is the sketch's choice on this chip as it
        // is on every other AVR board here, so this is the bench's usual 490 Hz
        // rather than a number the part fixes for us.
        pwmHz: 490,
        adcBits: 10,
      },
    },
    pins,
    boardPins,
    bodyColour: '#2c8240',
    legendColour: '#ffffff',
  };
}

/*
 * Raspberry Pi 4 Model B, by its 40-pin J8 header.
 *
 * Three facts about this one are the reason it is not a microcontroller board
 * with a different label, and each is load-bearing:
 *
 *   - It has no ADC. Not a weak one, not a 10-bit one -- none. Reading an
 *     analogue input needs an MCP3008 on the SPI pins, which is a lesson the
 *     bench can now teach rather than one it has to hide.
 *   - Its GPIO numbering is BCM, not physical. A program names GPIO 17, not
 *     "pin 11", so the firmware number and the silkscreen are different
 *     numbers here exactly as they are on an ESP32.
 *   - Its outputs are weak. The BCM2711 drives 8 mA at most, which is about
 *     400 ohm of output impedance against the Uno's 25. A jumper that lights
 *     an LED on an Uno barely registers on a Pi, and that is the board's
 *     answer rather than a fault.
 *
 * The header is the standard 40-pin block, identical on every Pi with a J8,
 * taken from the pinout reference and cross-checked against the Foundation's
 * own table of alternate functions.
 */

/**
 * The header, in physical pin order: odd pins down the left column, even down
 * the right, which is how it is numbered and how the board is laid out.
 */
const PI_J8: ReadonlyArray<readonly [physical: number, label: string]> = [
  [1, '3V3'],
  [2, '5V'],
  [3, 'GPIO2'],
  [4, '5V'],
  [5, 'GPIO3'],
  [6, 'GND'],
  [7, 'GPIO4'],
  [8, 'GPIO14'],
  [9, 'GND'],
  [10, 'GPIO15'],
  [11, 'GPIO17'],
  [12, 'GPIO18'],
  [13, 'GPIO27'],
  [14, 'GND'],
  [15, 'GPIO22'],
  [16, 'GPIO23'],
  [17, '3V3'],
  [18, 'GPIO24'],
  [19, 'GPIO10'],
  [20, 'GND'],
  [21, 'GPIO9'],
  [22, 'GPIO25'],
  [23, 'GPIO11'],
  [24, 'GPIO8'],
  [25, 'GND'],
  [26, 'GPIO7'],
  [27, 'GPIO0'],
  [28, 'GPIO1'],
  [29, 'GPIO5'],
  [30, 'GND'],
  [31, 'GPIO6'],
  [32, 'GPIO12'],
  [33, 'GPIO13'],
  [34, 'GND'],
  [35, 'GPIO19'],
  [36, 'GPIO16'],
  [37, 'GPIO26'],
  [38, 'GPIO20'],
  [39, 'GND'],
  [40, 'GPIO21'],
];

/** Where the header sits on an 85 x 56 mm board, and where each column runs. */
const PI_HEADER_X = 24.0;
const PI_HEADER_Y = 7.5;
const PI_HEADER_PITCH = 2.54;

function raspberryPiBoardPin(id: string, label: string, physical: number): BoardPin {
  const gpio = label.startsWith('GPIO') ? Number(label.slice(4)) : undefined;
  const isGround = label === 'GND';
  const isPower = label === '3V3' || label === '5V';

  /*
   * GPIO0 and GPIO1 are on the header but reserved for the board's own HAT ID
   * EEPROM lines. gpiozero will happily construct a device on them and nothing
   * will happen, which is exactly what happens on real hardware -- so they are
   * declared as what they are rather than quietly left out of the count.
   */
  const reserved = physical === 27 || physical === 28;

  return {
    id,
    label,
    role: isGround ? 'ground' : isPower ? 'power' : 'gpio',
    gpio,
    canDrive: !reserved,
  };
}

function raspberryPiDefinition(): PartDefinition {
  const pins: PinSpec[] = [];
  const boardPins: BoardPin[] = [];
  const odd: PinSpec[] = [];
  const even: PinSpec[] = [];

  for (const [physical, label] of PI_J8) {
    const row = Math.floor((physical - 1) / 2);
    const column = physical % 2 === 0 ? 1 : 0;
    const id = `J8_${physical}`;
    const pin: PinSpec = {
      id,
      label,
      x: PI_HEADER_X + column * PI_HEADER_PITCH,
      y: PI_HEADER_Y + row * PI_HEADER_PITCH,
      net: label === 'GND' ? 'GND' : label === '5V' ? '5V' : label === '3V3' ? '3V3' : undefined,
    };
    pins.push(pin);
    (column === 0 ? odd : even).push(pin);
    boardPins.push(raspberryPiBoardPin(id, label, physical));
  }

  return {
    id: 'raspberry-pi-4',
    name: 'Raspberry Pi 4',
    category: 'board',
    widthMm: 85,
    heightMm: 56,
    component: {
      kind: 'mcu',
      board: {
        id: 'raspberry-pi-4',
        name: 'Raspberry Pi 4',
        logicVolts: 3.3,
        serialPrefix: 'Raspberry Pi',
        /*
         * The BCM2711 drives 4 mA by default and 8 mA at its maximum, into 3.3 V.
         * That is the number that makes a jumper that works on an Uno fail
         * here, so it is modelled rather than rounded-none away.
         */
        sourceOhms: 412,
        sinkOhms: 412,
        /*
         * Hardware PWM is only on GPIO12 and GPIO13 of the header, and only the
         * pigpio library can reach it -- there is no register a sketch could set.
         * The bench's figure is pigpio's own default.
         */
        pwmHz: 100,
        // There is no converter on this board to sample. Zero says so.
        adcBits: 0,
      },
    },
    pins,
    boardPins,
    bodyColour: '#1d7042',
    legendColour: '#ffffff',
  };
}

let esp32: PartDefinition | null = null;
let uno: PartDefinition | null = null;
let mega: PartDefinition | null = null;
let nano: PartDefinition | null = null;
let rp2040: PartDefinition | null = null;
let franzininho: PartDefinition | null = null;
let raspberryPi: PartDefinition | null = null;

export function esp32DevKitV1(): PartDefinition {
  return (esp32 ??= esp32Definition());
}

export function arduinoUnoR3(): PartDefinition {
  return (uno ??= unoDefinition());
}

export function arduinoMega2560(): PartDefinition {
  return (mega ??= megaDefinition());
}

export function arduinoNano(): PartDefinition {
  return (nano ??= nanoDefinition());
}

export function nanoRp2040Connect(): PartDefinition {
  return (rp2040 ??= rp2040Definition());
}

export function franzininhoBoard(): PartDefinition {
  return (franzininho ??= franzininhoDefinition());
}

export function raspberryPi4(): PartDefinition {
  return (raspberryPi ??= raspberryPiDefinition());
}

/*
 * Raspberry Pi Pico, the RP2040-based board. Same chip as the Nano RP2040
 * Connect, so the firmware backend and the pin model transfer unchanged; only
 * the header layout and the artwork differ. GPIO numbering is the Pico's own,
 * which is the reason a sketch ported between the two boards has to be
 * re-pinned even though the chip is identical.
 */
const PICO_LEFT: ReadonlyArray<readonly [string, number | -1]> = [
  ['GP0', 0],
  ['GP1', 1],
  ['GND', -1],
  ['GP2', 2],
  ['GP3', 3],
  ['GP4', 4],
  ['GP5', 5],
  ['GND', -1],
  ['GP6', 6],
  ['GP7', 7],
  ['GP8', 8],
  ['GP9', 9],
  ['GND', -1],
  ['GP10', 10],
  ['GP11', 11],
  ['GP12', 12],
  ['GP13', 13],
  ['GND', -1],
  ['GP14', 14],
  ['GP15', 15],
];

const PICO_RIGHT: ReadonlyArray<readonly [string, number | -1]> = [
  ['GP16', 16],
  ['GP17', 17],
  ['GND', -1],
  ['GP18', 18],
  ['GP19', 19],
  ['GP20', 20],
  ['GP21', 21],
  ['GND', -1],
  ['GP22', 22],
  ['RUN', -1],
  ['GP26', 26],
  ['GP27', 27],
  ['GND', -1],
  ['GP28', 28],
  ['ADC_VREF', -1],
  ['3V3', -1],
  ['3V3_EN', -1],
  ['GND', -1],
  ['VSYS', -1],
  ['VBUS', -1],
];

const PICO_PITCH = 2.54;
const PICO_HEADER_X_LEFT = 2.54;
const PICO_HEADER_X_RIGHT = 48.26 - 2.54;
const PICO_HEADER_Y = 2.54;

function picoBoardPin(id: string, label: string, gpio: number | -1): BoardPin {
  const isGround = label === 'GND';
  const isPower =
    label === '3V3' || label === 'VSYS' || label === 'VBUS' || label === 'ADC_VREF' || label === '3V3_EN';
  const analog = label === 'GP26' || label === 'GP27' || label === 'GP28';
  return {
    id,
    label,
    role: isGround ? 'ground' : isPower ? 'power' : analog ? 'adc' : 'gpio',
    gpio: gpio >= 0 ? gpio : undefined,
    adc: analog ? gpio - 26 : undefined,
    canDrive: !(label === 'RUN' || label === 'ADC_VREF' || label === '3V3_EN'),
  };
}

function picoDefinition(): PartDefinition {
  const pins: PinSpec[] = [];
  const boardPins: BoardPin[] = [];

  const addColumn = (column: readonly (readonly [string, number | -1])[], x: number, prefix: string) => {
    column.forEach(([label, gpio], index) => {
      const id = `${prefix}_${index}`;
      pins.push({
        id,
        label,
        x,
        y: PICO_HEADER_Y + index * PICO_PITCH,
        net:
          label === 'GND'
            ? 'GND'
            : label === '3V3' || label === '3V3_EN'
              ? '3V3'
              : label === '5V' || label === 'VSYS' || label === 'VBUS'
                ? '5V'
                : undefined,
      });
      boardPins.push(picoBoardPin(id, label, gpio));
    });
  };

  addColumn(PICO_LEFT, PICO_HEADER_X_LEFT, 'L');
  addColumn(PICO_RIGHT, PICO_HEADER_X_RIGHT, 'R');

  return {
    id: 'raspberry-pi-pico',
    name: 'Raspberry Pi Pico',
    category: 'board',
    widthMm: 51,
    heightMm: 21,
    component: {
      kind: 'mcu',
      board: {
        id: 'pico',
        name: 'Raspberry Pi Pico',
        logicVolts: 3.3,
        serialPrefix: 'Raspberry Pi Pico',
        sourceOhms: 40,
        sinkOhms: 40,
        pwmHz: 1000,
        adcBits: 12,
      },
    },
    pins,
    boardPins,
    bodyColour: '#2c7a3f',
    legendColour: '#ffffff',
  };
}

let pico: PartDefinition | null = null;
export function raspberryPiPico(): PartDefinition {
  return (pico ??= picoDefinition());
}
