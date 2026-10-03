/**
 * Every element `@wokwi/elements` ships, and what this bench does with it.
 *
 * The library is bigger than the bench can honestly simulate, and the honest
 * answer to "why is there no keypad here" is a list rather than a shrug. So the
 * inventory is data: every tag the package registers, the size it draws at, and
 * whether it is on the bench, waiting on a firmware API, or not the part this
 * bench drives at all.
 *
 * Sizes are the `<svg>` width/height the element states, converted to
 * millimetres where it states bare pixels instead -- which is what the browser
 * lays it out at, since CSS fixes a millimetre at 96 pixels to the inch.
 */

export type LibraryStatus =
  /** On the bench, and the solver models its circuit. */
  | 'placed'
  /** Modelled in principle, but the firmware has no way to drive or read it. */
  | 'needs-api'
  /** A different part from the one this bench drives, so not substituted. */
  | 'other-part';

export interface LibraryElement {
  readonly tag: string;
  readonly name: string;
  readonly sizeMm: { readonly w: number; h: number };
  readonly status: LibraryStatus;
  /** Why it is where it is. Shown for everything that is not placed. */
  readonly note?: string;
}

const PX_TO_MM = 25.4 / 96;

/** Millimetres from whatever the element states: `"45.95mm"` or `"40"`. */
function mm(value: string, unit: string | undefined): number {
  return unit === 'mm' ? Number(value) : Number(value) * PX_TO_MM;
}

export const WOKWI_LIBRARY: readonly LibraryElement[] = [
  { tag: 'wokwi-esp32-devkit-v1', name: 'ESP32 DevKit V1', sizeMm: { w: 28.2, h: 54.053 }, status: 'placed' },
  { tag: 'wokwi-arduino-uno', name: 'Arduino Uno R3', sizeMm: { w: 72.58, h: 53.34 }, status: 'placed' },
  { tag: 'wokwi-resistor', name: 'Resistor', sizeMm: { w: 15.645, h: 3 }, status: 'placed' },
  { tag: 'wokwi-arduino-nano', name: 'Arduino Nano', sizeMm: { w: 44.9, h: 17.8 }, status: 'placed' },
  { tag: 'wokwi-nano-rp2040-connect', name: 'Nano RP2040 Connect', sizeMm: { w: 44.573, h: 17.956 }, status: 'placed' },
  { tag: 'wokwi-franzininho', name: 'Franzininho', sizeMm: { w: 64, h: 30 }, status: 'placed' },

  { tag: 'wokwi-resistor', name: 'Resistor', sizeMm: { w: 15.645, h: mm('3', undefined) }, status: 'placed' },
  { tag: 'wokwi-potentiometer', name: 'Potentiometer', sizeMm: { w: 20, h: 20 }, status: 'placed' },
  { tag: 'wokwi-slide-potentiometer', name: 'Slide potentiometer', sizeMm: { w: 55, h: 29 }, status: 'placed' },
  { tag: 'wokwi-pushbutton-6mm', name: 'Push button, 6 mm', sizeMm: { w: 7.413, h: 6 }, status: 'placed' },
  { tag: 'wokwi-pushbutton', name: 'Push button', sizeMm: { w: 17.802, h: 12 }, status: 'placed' },
  { tag: 'wokwi-slide-switch', name: 'Slide switch', sizeMm: { w: 8.5, h: 9.23 }, status: 'placed' },
  { tag: 'wokwi-dip-switch-8', name: 'DIP switch, 8 way', sizeMm: { w: 21.926, h: 14.646 }, status: 'placed' },
  { tag: 'wokwi-tilt-switch', name: 'Tilt switch module', sizeMm: { w: 23.4, h: 14.7 }, status: 'placed' },
  { tag: 'wokwi-analog-joystick', name: 'Analog joystick', sizeMm: { w: 27.2, h: 31.8 }, status: 'placed' },
  { tag: 'wokwi-membrane-keypad', name: 'Membrane keypad, 4x4', sizeMm: { w: 70.336, h: 91 }, status: 'placed' },

  { tag: 'wokwi-led', name: 'LED, 5 mm', sizeMm: { w: mm('40', undefined), h: mm('50', undefined) }, status: 'placed' },
  { tag: 'wokwi-rgb-led', name: 'RGB LED, 5 mm', sizeMm: { w: mm('42.129', undefined), h: mm('72.582', undefined) }, status: 'placed' },
  { tag: 'wokwi-led-bar-graph', name: 'LED bar graph, 10 segment', sizeMm: { w: 10.1, h: 25.5 }, status: 'placed' },
  { tag: 'wokwi-buzzer', name: 'Piezo buzzer', sizeMm: { w: 17, h: 20 }, status: 'placed' },
  { tag: 'wokwi-photoresistor-sensor', name: 'Photoresistor module', sizeMm: { w: 45.95, h: 16.267 }, status: 'placed' },
  { tag: 'wokwi-ntc-temperature-sensor', name: 'Thermistor module', sizeMm: { w: 35.826, h: 19 }, status: 'placed' },
  { tag: 'wokwi-big-sound-sensor', name: 'Sound sensor module', sizeMm: { w: 37.056, h: 13.346 }, status: 'placed' },
  { tag: 'wokwi-small-sound-sensor', name: 'Sound sensor, small', sizeMm: { w: 35.211, h: 13.346 }, status: 'placed' },
  { tag: 'wokwi-pir-motion-sensor', name: 'PIR motion sensor', sizeMm: { w: 24, h: 24.448 }, status: 'placed' },
  { tag: 'wokwi-heart-beat-sensor', name: 'Heart-rate sensor', sizeMm: { w: 23.4, h: 20.943 }, status: 'placed' },
  { tag: 'wokwi-gas-sensor', name: 'Gas sensor module', sizeMm: { w: 36.232, h: 16.617 }, status: 'placed' },
  { tag: 'wokwi-flame-sensor', name: 'Flame sensor module', sizeMm: { w: 52.904, h: 16.267 }, status: 'placed' },
  { tag: 'wokwi-ir-receiver', name: 'IR receiver module', sizeMm: { w: 16.178, h: 23.482 }, status: 'placed' },
  { tag: 'wokwi-7segment', name: '7-segment display', sizeMm: { w: 30.48, h: 20.32 }, status: 'placed' },
  { tag: 'wokwi-ili9341', name: '2.4" TFT (ILI9341)', sizeMm: { w: 46.5, h: 77.6 }, status: 'placed' },

  { tag: 'wokwi-ds1307', name: 'DS1307 real-time clock', sizeMm: { w: 25.8, h: 22.212 }, status: 'placed' },
  { tag: 'wokwi-mpu6050', name: 'MPU-6050 accelerometer', sizeMm: { w: 21.6, h: 16.2 }, status: 'placed' },
  { tag: 'wokwi-hx711', name: 'HX711 load-cell amplifier', sizeMm: { w: mm('3', undefined), h: mm('33', undefined) }, status: 'placed' },
  { tag: 'wokwi-lcd1602', name: 'LCD1602, 16x2', sizeMm: { w: mm('2.95', undefined), h: mm('5.55', undefined) }, status: 'placed' },
  { tag: 'wokwi-lcd2004', name: 'LCD2004, 20x4', sizeMm: { w: 98, h: 60 }, status: 'placed' },
  { tag: 'wokwi-servo', name: 'Hobby servo', sizeMm: { w: 45, h: 31.63 }, status: 'placed' },
  {
    tag: 'wokwi-dht22',
    name: 'DHT22 temperature/humidity',
    sizeMm: { w: 15.1, h: 30.885 },
    status: 'needs-api',
    note: 'A single-wire protocol the firmware has no way to clock out or clock in.',
  },
  {
    tag: 'wokwi-microsd-card',
    name: 'MicroSD breakout',
    sizeMm: { w: 21.6, h: 20.4 },
    status: 'needs-api',
    note: 'A file system over SPI: there is no filesystem here to put on it.',
  },
  {
    tag: 'wokwi-stepper-motor',
    name: 'Stepper motor',
    sizeMm: { w: 42, h: 42 },
    status: 'needs-api',
    note: 'Coils in sequence; the angle is how many steps have been pulsed.',
  },
  {
    tag: 'wokwi-biaxial-stepper',
    name: 'Biaxial stepper',
    sizeMm: { w: 56, h: 67.5 },
    status: 'needs-api',
    note: 'Two of the above, geared.',
  },
  {
    tag: 'wokwi-neopixel',
    name: 'NeoPixel',
    sizeMm: { w: 5.6631, h: 5 },
    status: 'needs-api',
    note: 'WS2812: a bit-banged protocol timed to the microsecond.',
  },
  {
    tag: 'wokwi-neopixel-matrix',
    name: 'NeoPixel matrix',
    sizeMm: { w: 25, h: 25 },
    status: 'needs-api',
    note: 'A daisy chain of the same timed protocol.',
  },
  {
    tag: 'wokwi-led-ring',
    name: 'NeoPixel ring',
    sizeMm: { w: 25, h: 25 },
    status: 'needs-api',
    note: 'The same, in a circle.',
  },
  {
    tag: 'wokwi-hc-sr04',
    name: 'HC-SR04 ultrasonic',
    sizeMm: { w: 45, h: 25 },
    status: 'needs-api',
    note: 'Its echo is a pulse whose width is a distance, so it needs timing the solver does not do.',
  },
  {
    tag: 'wokwi-ky-040',
    name: 'Rotary encoder',
    sizeMm: { w: 30.815, h: 18.63 },
    status: 'needs-api',
    note: 'Quadrature: the meaning is in the order of the edges, not their level.',
  },
  {
    tag: 'wokwi-ir-remote',
    name: 'IR remote',
    sizeMm: { w: 40, h: 83.653 },
    status: 'needs-api',
    note: 'A carrier burst the sketch has no way to time.',
  },
  {
    tag: 'wokwi-rotary-dialer',
    name: 'Rotary dialer',
    sizeMm: { w: mm('266', undefined), h: mm('286', undefined) },
    status: 'needs-api',
    note: 'Emits a burst of pulses whose count is the number dialled.',
  },
  {
    tag: 'wokwi-ks2e-m-dc5',
    name: 'Relay module',
    sizeMm: { w: 21, h: 10 },
    status: 'needs-api',
    note: 'A contact that follows its coil, on a board whose artwork declares no pin positions yet.',
  },
  {
    tag: 'wokwi-ssd1306',
    name: '128x64 OLED (SSD1306)',
    sizeMm: { w: mm('148', undefined), h: mm('114', undefined) },
    status: 'other-part',
    note: 'Wokwi draws the eight-pin SPI module; this bench drives the four-pin I2C breakout, which it draws itself.',
  },
];