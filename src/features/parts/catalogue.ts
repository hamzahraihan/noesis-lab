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
  esp32C3DevKit,
  esp32S3DevKit,
  franzininhoBoard,
  raspberryPi4,
  raspberryPiPico,
  stm32f103BluePill,
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
  bh1750Definition,
  bmp180Definition,
  ds1307Definition,
  ds3231Definition,
  hx711Definition,
  ina219Definition,
  mcp9808Definition,
  lm75Definition,
  tcs34725Definition,
  pcf8591Definition,
  mpu6050Definition,
  sht31Definition,
  tmp102Definition,
  bmp280Definition,
  vl53l0xDefinition,
  bme280Definition,
  aht20Definition,
  scd40Definition,
  max30102Definition,
  bme680Definition,
  apds9960Definition,
  bno055Definition,
} from './devices/sensors';
import { lm35Definition } from './devices/lm35';
import { adxl335Definition } from './devices/adxl335';
import { soilMoistureDefinition } from './devices/soil-moisture';
import { mq2Definition } from './devices/mq2';
import { dht22Definition } from './devices/dht22';
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
import { pcf8574Definition } from './devices/pcf8574';
import { mcp23017Definition } from './devices/mcp23017';
import { pca9685Definition } from './devices/pca9685';
import { max6675Definition } from './devices/max6675';
import { mcp4725Definition } from './devices/mcp4725';
import { powerSupplyDefinition } from './power-supply';
import { eeprom24lc256Definition } from './devices/eeprom24lc256';
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
    id: 'eeprom24lc256',
    name: 'EEPROM (24LC256)',
    group: 'output',
    note: 'A memory rather than a register file: the sketch writes an address and then the bytes at it, and a write that runs off the end of a page comes back to the start of that page.',
    make: eeprom24lc256Definition,
  },
  {
    id: 'power-supply',
    name: 'Bench supply (0-12 V)',
    group: 'output',
    note: 'A rail the operator sets. The board’s own five volts are enough for a sketch and not enough for a motor, and this is the part that carries a second voltage.',
    make: powerSupplyDefinition,
  },
  {
    id: 'mcp4725',
    name: 'DAC converter (MCP4725)',
    group: 'output',
    note: 'A converter rather than a sensor: the sketch writes twelve bits over the I2C bus and the chip holds a voltage on its output, somewhere between the ground and the supply, in four thousand and ninety-five steps.',
    make: mcp4725Definition,
  },
  {
    id: 'max6675',
    name: 'Thermocouple (MAX6675)',
    group: 'input',
    note: 'A thermocouple amplifier with a shift register on the front: the sketch shifts out a dummy byte and the chip hands back sixteen bits, four of them status and twelve the temperature in quarter-degree steps.',
    make: max6675Definition,
  },
  {
    id: 'pcf8574',
    name: 'I/O expander (PCF8574)',
    group: 'output',
    note: 'Eight pins in two wires. A sketch writes one byte over the I2C bus and the ports follow it, which is the answer to a board that has run out of pins.',
    make: pcf8574Definition,
  },
  {
    id: 'mcp23017',
    name: 'I/O expander (MCP23017)',
    group: 'output',
    note: 'Sixteen pins in two wires, with a direction register for each port. A port powers up as an input, so a sketch clears its direction bits before the latch can drive anything.',
    make: mcp23017Definition,
  },
  {
    id: 'pca9685',
    name: 'PWM driver (PCA9685)',
    group: 'output',
    note: 'Sixteen PWM channels on two wires. A sketch writes each channel’s ON and OFF counts, and the chip repeats the frame: a light can be dimmed or a servo pulse placed without spending a board pin.',
    make: pca9685Definition,
  },
  {
    id: 'a4988',
    name: 'Stepper driver (A4988)',
    group: 'output',
    note: 'A stepper motor driver with a translator behind it: a pulse on STEP moves the motor one step and DIR says which way, so the sketch never writes a phase table. The five microstep modes (full, 1/2, 1/4, 1/8 and 1/16) are selected by MS1, MS2 and MS3 and sampled on the STEP edge. The bench stamps each bridge as its average output, so a fine step is a voltage between the rails, and the motor follows the phase vector between full-step positions.',
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
    id: 'ds3231-rtc',
    name: 'DS3231 Real-Time Clock',
    group: 'input',
    note: 'The same BCD time registers as the DS1307, with two alarms, a control and status register, and a thermometer on the die. It reports whether it lost power until a sketch sets the time.',
    make: ds3231Definition,
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
    id: 'bmp280-barometer',
    name: 'BMP280 Barometer',
    group: 'input',
    note: 'Pressure and temperature as raw counts over I2C, with calibration coefficients the sketch reads from the chip\u2019s own registers. The successor to the BMP180, with a tighter tolerance and a lower supply current.',
    make: bmp280Definition,
  },
  {
    id: 'vl53l0x-distance',
    name: 'VL53L0X Distance Sensor',
    group: 'input',
    note: 'Time-of-flight distance sensor: the sketch starts a ranging measurement and reads millimetres back over I2C. No moving parts, no sound -- just light timed to a stopwatch.',
    make: vl53l0xDefinition,
  },
  {
    id: 'bme280-environment',
    name: 'BME280 Environment Sensor',
    group: 'input',
    note: 'Temperature, pressure and humidity over I2C — the all-in-one weather station on a single breakout. The sketch reads compensation coefficients and applies the datasheet formula to the raw counts.',
    make: bme280Definition,
  },
  {
    id: 'aht20-environment',
    name: 'AHT20 Environment Sensor',
    group: 'input',
    note: 'Temperature and humidity over I2C — the compact all-in-one weather module on a single breakout. The sketch starts a measurement and reads the raw counts back.',
    make: aht20Definition,
  },
  {
    id: 'scd40-co2',
    name: 'SCD40 CO2 Sensor',
    group: 'input',
    note: 'Carbon dioxide, temperature and humidity over I2C — the air-quality monitor on a single breakout. The sketch starts periodic measurement and reads three words with their CRCs back.',
    make: scd40Definition,
  },
  {
    id: 'max30102-pulse',
    name: 'MAX30102 Pulse Oximeter',
    group: 'input',
    note: 'Heart rate and blood oxygen over I2C — the fingertip monitor that reads the pulse with red and infrared light. The sketch starts the PPG and reads the FIFO counts back.',
    make: max30102Definition,
  },
  {
    id: 'bme680-gas',
    name: 'BME680 Gas Sensor',
    group: 'input',
    note: 'Temperature, pressure, humidity and gas resistance over I2C — the air-quality upgrade of the BME280 with a VOC sensor on the same breakout. The sketch reads the raw counts back.',
    make: bme680Definition,
  },
  {
    id: 'apds9960-gesture',
    name: 'APDS9960 Gesture Sensor',
    group: 'input',
    note: 'Gesture, proximity and ambient light over I2C — the hand-wave module that reads a swipe through the air and a finger close up. The sketch reads the data registers back.',
    make: apds9960Definition,
  },
  {
    id: 'bno055-imu',
    name: 'BNO055 Absolute Orientation',
    group: 'input',
    note: 'Heading, pitch and roll over I2C — the nine-axis sensor with a magnetometer and sensor fusion. The sketch reads the orientation registers back.',
    make: bno055Definition,
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
    id: 'bh1750-light',
    name: 'BH1750 Light Sensor',
    group: 'input',
    note: 'Ambient light as a sixteen-bit count. The command byte chooses one-shot or continuous and the resolution, and the sketch divides by 1.2 to get lux.',
    make: bh1750Definition,
  },
  {
    id: 'tmp102-temperature',
    name: 'TMP102 Temperature Sensor',
    group: 'input',
    note: 'A signed twelve-bit thermometer at 0.0625 °C a count, left-justified across two bytes. It also carries a configuration register and two trip points.',
    make: tmp102Definition,
  },
  {
    id: 'mcp9808-temperature',
    name: 'MCP9808 Temperature Sensor',
    group: 'input',
    note: '±0.25 °C accuracy at 0.0625 °C resolution over I2C; the sketch reads the temperature register and the chip divides it into integer and fractional counts.',
    make: mcp9808Definition,
  },
  {
    id: 'lm75-temperature',
    name: 'LM75 Temperature Sensor',
    group: 'input',
    note: 'A signed eleven-bit thermometer at 0.125 °C a count, left-justified across two bytes. It carries a configuration register and two trip points.',
    make: lm75Definition,
  },
  {
    id: 'lm35',
    name: 'LM35 Temperature Sensor',
    group: 'input',
    note: 'An analog temperature sensor: Vout is 10 mV per degree Celsius, so a sketch reads it with analogRead and converts the count back to degrees. No bus, no registers -- just a voltage on a pin.',
    make: lm35Definition,
  },
  {
    id: 'adxl335',
    name: 'ADXL335 Accelerometer',
    group: 'input',
    note: 'A three-axis analog accelerometer: X, Y and Z are voltages, so a sketch reads them with analogRead and converts the counts back to g. No bus, no registers -- just three voltages on pins.',
    make: adxl335Definition,
  },
  {
    id: 'soil-moisture',
    name: 'Soil Moisture Sensor',
    group: 'input',
    note: 'An analog soil moisture sensor: AOUT is a fraction of the supply proportional to moisture (0 = dry, 100 = saturated). A sketch reads it with analogRead and converts the count back to percent. No bus, no registers -- just a voltage on a pin.',
    make: soilMoistureDefinition,
  },
  {
    id: 'mq2',
    name: 'MQ-2 Gas Sensor',
    group: 'input',
    note: 'An analog gas sensor: AOUT is a voltage proportional to gas concentration (0 ppm to 1000 ppm). A sketch reads it with analogRead and converts the count back to ppm. No bus, no registers -- just a voltage on a pin.',
    make: mq2Definition,
  },
  {
    id: 'dht22',
    name: 'DHT22 Temp/Humidity',
    group: 'input',
    note: 'A digital temperature and humidity sensor on a single data pin. A sketch polls it and reads the temperature and humidity it reports.',
    make: dht22Definition,
  },
  {
    id: 'tcs34725-color',
    name: 'TCS34725 Color Sensor',
    group: 'input',
    note: 'Red, green, blue and clear channels as sixteen-bit counts over I2C. The sketch enables the sensor, sets integration time and gain, and reads four registers.',
    make: tcs34725Definition,
  },
  {
    id: 'pcf8591-adc',
    name: 'PCF8591 ADC/DAC',
    group: 'input',
    note: 'Four eight-bit ADC channels and one DAC output over I2C. The sketch writes a control byte to select the channel, reads the conversion, and writes the DAC.',
    make: pcf8591Definition,
  },
  {
    id: 'sht31-temp-humidity',
    name: 'SHT31 Temp/Humidity',
    group: 'input',
    note: 'Temperature and humidity in one six-byte frame, with a CRC after each word. A soft reset and a die heater share the same sixteen-bit command space.',
    make: sht31Definition,
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
  'esp32-c3-devkit': esp32C3DevKit,
  'esp32-s3-devkit': esp32S3DevKit,
  'stm32f103-blue-pill': stm32f103BluePill,
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
