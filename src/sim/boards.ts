/**
 * Microcontroller board definitions.
 *
 * Header labels and firmware pin numbers are deliberately kept separate. The
 * silkscreen says `GPIO25`, the firmware says `25`, and the breadboard hole
 * says neither. Conflating them is the classic source of confusion when
 * reading a tutorial against a physical board, so `BoardPin` carries all three.
 */

import type { BoardPin, PartDefinition, PinSpec } from './catalog';

const ESP32_ROW_X_LEFT = 1.27;
const ESP32_ROW_X_RIGHT = 26.67;
const ESP32_FIRST_PIN_Y = 5.08;
const ESP32_PIN_PITCH = 2.54;

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
  ['GPIO14', 'GPIO14'],
  ['GPIO12', 'GPIO12'],
  ['GND', 'GND'],
  ['GPIO13', 'GPIO13'],
  ['D9', 'GPIO9'],
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
  ['3V3', '3V3'],
  ['GND', 'GND'],
];

const ESP32_GPIO_NUMBERS: Readonly<Record<string, number>> = {
  EN: -1, GPIO36: 36, GPIO39: 39, GPIO34: 34, GPIO35: 35, GPIO32: 32,
  GPIO33: 33, GPIO25: 25, GPIO26: 26, GPIO27: 27, GPIO14: 14, GPIO12: 12,
  GND: -1, GPIO13: 13, D9: 9, D23: 23, D22: 22, TX0: 1, RX0: 3, D21: 21,
  D19: 19, D18: 18, D5: 5, TX2: 17, RX2: 16, D4: 4, D2: 2, GPIO15: 15,
  '3V3': -1,
};

/** ADC1 channels for the ESP32 pins that expose them. */
const ESP32_ADC_CHANNELS: Readonly<Record<string, number>> = {
  GPIO36: 0, GPIO39: 3, GPIO34: 6, GPIO35: 7, GPIO32: 4, GPIO33: 5, GPIO27: 1,
};

/** GPIO34-39 are input-only: no output driver and no internal pull-up. */
const ESP32_INPUT_ONLY = new Set(['GPIO36', 'GPIO39', 'GPIO34', 'GPIO35']);

/** Pins sampled at reset; holding these the wrong way stops the board booting. */
const ESP32_STRAPPING: Readonly<Record<string, 'low' | 'high'>> = {
  GPIO12: 'low',
  GPIO15: 'high',
};

function esp32BoardPin(id: string, headerLabel: string, silkscreen: string): BoardPin {
  const gpio = ESP32_GPIO_NUMBERS[headerLabel] ?? -1;
  const isPower = silkscreen === '3V3';
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
  const addHeader = (header: readonly [string, string][], prefix: string, x: number) => {
    header.forEach(([headerLabel, silkscreen], index) => {
      const id = `${prefix}_${headerLabel}`;
      pins.push({
        id,
        label: silkscreen,
        x,
        y: ESP32_FIRST_PIN_Y + index * ESP32_PIN_PITCH,
        net: silkscreen === 'GND' ? 'GND' : silkscreen === '3V3' ? '3V3' : undefined,
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
    widthMm: 27.94,
    heightMm: 51.5,
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

/** Arduino Uno R3 digital header, top-left with the USB connector facing up. */
const UNO_DIGITAL_HEADER = ['SCL', 'SDA', 'AREF', 'GND', 'GND', 'D13', 'D12', 'D11', 'D10', 'D9'];

/** R3 power header: IOREF, RESET, 3V3, 5V, GND, GND, Vin, AREF. */
const UNO_POWER_HEADER = ['IOREF', 'RESET', '3V3', '5V', 'GND', 'GND', 'Vin', 'AREF'];

const UNO_ANALOG_HEADER = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5'];

const UNO_PIN_GPIOS: Readonly<Record<string, number>> = {
  SCL: 5, SDA: 4, D13: 13, D12: 12, D11: 11, D10: 10, D9: 9, D8: 8,
  D7: 7, D6: 6, D5: 5, D4: 4, D3: 3, D2: 2, D1: 1, D0: 0,
  A0: 14, A1: 15, A2: 16, A3: 17, A4: 18, A5: 19,
};

const UNO_ANALOG: Readonly<Record<string, number>> = {
  A0: 0, A1: 1, A2: 2, A3: 3, A4: 4, A5: 5,
};

function unoBoardPin(id: string, headerLabel: string): BoardPin {
  const isGround = headerLabel === 'GND';
  const isPower =
    headerLabel === '5V' || headerLabel === '3V3' || headerLabel === 'Vin' || headerLabel === 'IOREF';
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

  // Prefix per header for the same reason as the ESP32: the digital and power
  // headers both carry GND and AREF.
  const addHeader = (labels: readonly string[], prefix: string, x: number, firstY: number) => {
    labels.forEach((headerLabel, index) => {
      const id = `${prefix}_${headerLabel}`;
      pins.push({
        id,
        label: headerLabel,
        x,
        y: firstY + index * 2.54,
        net:
          headerLabel === 'GND' ? 'GND'
          : headerLabel === '5V' ? '5V'
          : headerLabel === '3V3' ? '3V3'
          : undefined,
      });
      boardPins.push(unoBoardPin(id, headerLabel));
    });
  };

  addHeader(UNO_DIGITAL_HEADER, 'J1', 8.89, 12.7);
  addHeader(UNO_POWER_HEADER, 'J2', 59.69, 12.7);
  addHeader(UNO_ANALOG_HEADER, 'J3', 59.69, 45.72);

  return {
    id: 'arduino-uno-r3',
    name: 'Arduino Uno R3',
    category: 'board',
    widthMm: 68.6,
    heightMm: 66.04,
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