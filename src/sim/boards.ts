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
  6.35, 8.99, 11.64, 14.05, 16.64, 19.10, 21.61, 24.15, 26.72, 29.31, 31.75, 34.49,
  36.91, 39.42, 41.94,
];

/** Column centres, from the same conversion. */
const ESP32_ROW_X_LEFT = 1.32;
const ESP32_ROW_X_RIGHT = 26.81;

// Keyed by *header* label, not silkscreen. The two differ on this board -- the
// header calls GPIO36 "VP", GPIO39 "VN" and GPIO15 "D15" -- and keying this by
// silkscreen silently leaves those three pins unreachable from firmware.
const ESP32_GPIO_NUMBERS: Readonly<Record<string, number>> = {
  EN: -1, VP: 36, VN: 39, GPIO34: 34, GPIO35: 35, GPIO32: 32,
  GPIO33: 33, GPIO25: 25, GPIO26: 26, GPIO27: 27, GPIO14: 14, GPIO12: 12,
  GND: -1, GPIO13: 13, D9: 9, D23: 23, D22: 22, TX0: 1, RX0: 3, D21: 21,
  D19: 19, D18: 18, D5: 5, TX2: 17, RX2: 16, D4: 4, D2: 2, D15: 15,
  D14: 14, D13: 13, D12: 12, VIN: -1, '3V3': -1,
};

/** ADC1 channels for the ESP32 pins that expose them. */
const ESP32_ADC_CHANNELS: Readonly<Record<string, number>> = {
  VP: 0, VN: 3, GPIO34: 6, GPIO35: 7, GPIO32: 4, GPIO33: 5, GPIO27: 1,
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
    role: isPower ? 'power' : isGround ? 'ground' : headerLabel in ESP32_ADC_CHANNELS ? 'adc' : 'gpio',
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
        net: silkscreen === 'GND' ? 'GND' : silkscreen === 'VIN' ? 'VIN' : silkscreen === '3V3' ? '3V3' : undefined,
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
  ['11', 'D11', 38.10],
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
  ['0', 'RX', 67.60],
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
  ['A5', 'A5', 67.60],
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
 */
const UNO_PIN_GPIOS: Readonly<Record<string, number>> = {
  SCL: 5, SDA: 4, 13: 13, 12: 12, 11: 11, 10: 10, 9: 9, 8: 8,
  7: 7, 6: 6, 5: 5, 4: 4, 3: 3, 2: 2, 1: 1, 0: 0,
  A0: 14, A1: 15, A2: 16, A3: 17, A4: 18, A5: 19,
};

const UNO_ANALOG: Readonly<Record<string, number>> = {
  A0: 0, A1: 1, A2: 2, A3: 3, A4: 4, A5: 5,
};

function unoBoardPin(id: string, headerLabel: string): BoardPin {
  const isGround = headerLabel === 'GND';
  const isPower = headerLabel === '5V' || headerLabel === '3V3' || headerLabel === 'VIN' || headerLabel === 'IOREF';
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
        headerLabel === 'GND' ? 'GND'
        : headerLabel === '5V' ? '5V'
        : headerLabel === '3V3' ? '3V3'
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

let esp32: PartDefinition | null = null;
let uno: PartDefinition | null = null;

export function esp32DevKitV1(): PartDefinition {
  return (esp32 ??= esp32Definition());
}

export function arduinoUnoR3(): PartDefinition {
  return (uno ??= unoDefinition());
}