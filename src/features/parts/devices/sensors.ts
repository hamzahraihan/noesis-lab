/**
 * I2C sensor modules: the small breakout boards that answer on the bus instead
 * of contributing a circuit to it.
 *
 * Each is four holes on the header every I2C breakout has, drawn at the size
 * the element draws it, so a jumper lands beside the pin it names. The pin
 * names are the ones a wiring tutorial will use, because the whole point is
 * that the wiring has to be right.
 */

import type { I2cSensorVariant, KnobSpec, PartDefinition, PinSpec } from '../catalog';
import { ADS1115_CHANNEL_KNOBS } from './ads1115';
import { BH1750_LIGHT_KNOB } from './bh1750';
import { BMP180_PRESSURE_KNOB, BMP180_TEMPERATURE_KNOB } from './bmp180';
import { BMP280_PRESSURE_KNOB, BMP280_TEMPERATURE_KNOB } from './bmp280';
import { BME280_PRESSURE_KNOB, BME280_TEMPERATURE_KNOB, BME280_HUMIDITY_KNOB } from './bme280';
import { AHT20_TEMPERATURE_KNOB, AHT20_HUMIDITY_KNOB } from './aht20';
import { SCD40_CO2_KNOB, SCD40_TEMPERATURE_KNOB, SCD40_HUMIDITY_KNOB } from './scd40';
import { MAX30102_HEART_RATE_KNOB, MAX30102_SPO2_KNOB } from './max30102';
import { BME680_PRESSURE_KNOB, BME680_TEMPERATURE_KNOB, BME680_HUMIDITY_KNOB, BME680_GAS_KNOB } from './bme680';
import { APDS9960_PROXIMITY_KNOB, APDS9960_AMBIENT_KNOB, APDS9960_GESTURE_KNOB } from './apds9960';
import { BNO055_HEADING_KNOB, BNO055_PITCH_KNOB, BNO055_ROLL_KNOB } from './bno055';
import { VL53L0X_DISTANCE_KNOB } from './vl53l0x';
import { DS3231_TEMPERATURE_KNOB } from './ds3231';
import { INA219_BUS_KNOB, INA219_CURRENT_KNOB } from './ina219';
import { SHT31_HUMIDITY_KNOB, SHT31_TEMPERATURE_KNOB } from './sht31';
import { TMP102_TEMPERATURE_KNOB } from './tmp102';
import { MCP9808_TEMPERATURE_KNOB } from './mcp9808';
import { LM75_TEMPERATURE_KNOB } from './lm75';
import { TCS34725_RED_KNOB, TCS34725_GREEN_KNOB, TCS34725_BLUE_KNOB, TCS34725_CLEAR_KNOB } from './tcs34725';
import { PCF8591_CH0_KNOB, PCF8591_CH1_KNOB, PCF8591_CH2_KNOB, PCF8591_CH3_KNOB, PCF8591_DAC_KNOB } from './pcf8591';

/** The hole pitch, and the grid every module's header is snapped to. */
const PITCH = 2.54;

/**
 * The load the bench can put on the cell.
 *
 * In grams, because that is the unit a scale is read in; the amplifier does the
 * conversion to counts itself. At rest the reading is the tare offset, which
 * is what an unloaded cell reports.
 */
export const HX711_LOAD_KNOB: KnobSpec = {
  id: 'load',
  label: 'Load',
  min: 0,
  max: 1000,
  step: 10,
  unit: 'g',
  defaultValue: 0,
};

/** One module: the element that draws it, and the header that element carries. */
interface I2cModule {
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
  readonly knobs?: readonly KnobSpec[];
}

const I2C_MODULES: Readonly<Record<I2cSensorVariant, I2cModule>> = {
  ds1307: {
    id: 'ds1307-rtc',
    name: 'DS1307 RTC Module',
    widthMm: 25.8,
    heightMm: 22.212,
    bodyColour: '#015abe',
    legendColour: '#e6e6e6',
    // The element draws five holes down the left edge, the last of them SQW.
    // This part has no wire for that one, so the header is the first four: the
    // supply, which the element silkscreens as 5V and every tutorial calls
    // VCC, and then the bus.
    header: { x: 2.54, y: 3.81, names: ['GND', 'VCC', 'SDA', 'SCL'], alongColumn: true },
  },
  ds3231: {
    id: 'ds3231-rtc',
    name: 'DS3231 RTC Module',
    widthMm: 25.8,
    heightMm: 22.212,
    bodyColour: '#015abe',
    legendColour: '#e6e6e6',
    header: { x: 2.54, y: 3.81, names: ['GND', 'VCC', 'SDA', 'SCL'], alongColumn: true },
    knobs: [DS3231_TEMPERATURE_KNOB],
  },
  mpu6050: {
    id: 'mpu6050-accel',
    name: 'MPU-6050 Accel/Gyro',
    widthMm: 21.6,
    heightMm: 16.2,
    bodyColour: '#16619d',
    legendColour: '#ffffff',
    // Eight holes run along the top edge, of which the last four are the ones
    // on the bus. The first four are INT, AD0 and the auxiliary master's two
    // lines, and a header hole the bench can do nothing with is a hole a
    // jumper can reach and never learn anything from. The holes the element
    // draws are already 2.54 mm apart on the bench's grid, so nothing moves.
    header: { x: 12.065, y: 1.27, names: ['SDA', 'SCL', 'GND', 'VCC'], alongColumn: false },
  },
  hx711: {
    id: 'hx711-load-cell',
    name: 'HX711 Load Cell Amplifier',
    widthMm: 58,
    heightMm: 43,
    bodyColour: '#1c8944',
    legendColour: '#fbfbfb',
    // Four holes up the left edge, which the element silkscreens GND, DAT, SCK
    // and VCC: DAT and SCK are the bit-banged pair of the bare amplifier. The
    // module the bench models is the one with a microcontroller on it, which
    // is the part that answers at an address, and it spells the same two wires
    // SDA and SCL. The element spaces them unevenly, so the first hole is
    // snapped to the grid and the rest follow at the pitch.
    header: { x: 1.27, y: 7.62, names: ['GND', 'SDA', 'SCL', 'VCC'], alongColumn: true },
    knobs: [HX711_LOAD_KNOB],
  },
  /*
   * The modules below are the bench's own drawings rather than Wokwi's: the
   * library has no element for a barometer, a current monitor, a converter, a
   * light meter, a thermometer or a temp/humidity sensor, so the artwork is
   * drawn here and the header is on the same grid the others sit on.
   */
  bmp180: {
    id: 'bmp180-barometer',
    name: 'BMP180 Barometer',
    widthMm: 21.5,
    heightMm: 20,
    bodyColour: '#1b1f2a',
    legendColour: '#e8e8e8',
    // Four holes down the left edge, the way every I2C breakout carries them.
    header: { x: 2.54, y: 3.81, names: ['GND', 'VCC', 'SDA', 'SCL'], alongColumn: true },
    knobs: [BMP180_PRESSURE_KNOB, BMP180_TEMPERATURE_KNOB],
  },
  ina219: {
    id: 'ina219-current-monitor',
    name: 'INA219 Current Monitor',
    widthMm: 25,
    heightMm: 22,
    bodyColour: '#123b2e',
    legendColour: '#f2f2ee',
    header: { x: 2.54, y: 3.81, names: ['GND', 'VCC', 'SDA', 'SCL'], alongColumn: true },
    knobs: [INA219_BUS_KNOB, INA219_CURRENT_KNOB],
  },
  ads1115: {
    id: 'ads1115-adc',
    name: 'ADS1115 16-bit ADC',
    widthMm: 25,
    heightMm: 25,
    bodyColour: '#12203b',
    legendColour: '#e8e8e8',
    header: { x: 2.54, y: 3.81, names: ['GND', 'VCC', 'SDA', 'SCL'], alongColumn: true },
    knobs: [...ADS1115_CHANNEL_KNOBS],
  },
  bh1750: {
    id: 'bh1750-light',
    name: 'BH1750 Light Sensor',
    widthMm: 21.5,
    heightMm: 20,
    bodyColour: '#1b2a4a',
    legendColour: '#e8e8e8',
    header: { x: 2.54, y: 3.81, names: ['GND', 'VCC', 'SDA', 'SCL'], alongColumn: true },
    knobs: [BH1750_LIGHT_KNOB],
  },
  tmp102: {
    id: 'tmp102-temperature',
    name: 'TMP102 Temperature Sensor',
    widthMm: 21.5,
    heightMm: 20,
    bodyColour: '#0f3b3a',
    legendColour: '#e8f5f2',
    header: { x: 2.54, y: 3.81, names: ['GND', 'VCC', 'SDA', 'SCL'], alongColumn: true },
    knobs: [TMP102_TEMPERATURE_KNOB],
  },
  mcp9808: {
    id: 'mcp9808-temperature',
    name: 'MCP9808 Temperature Sensor',
    widthMm: 21.5,
    heightMm: 20,
    bodyColour: '#0f3b3a',
    legendColour: '#e8f5f2',
    header: { x: 2.54, y: 3.81, names: ['GND', 'VCC', 'SDA', 'SCL'], alongColumn: true },
    knobs: [MCP9808_TEMPERATURE_KNOB],
  },
  lm75: {
    id: 'lm75-temperature',
    name: 'LM75 Temperature Sensor',
    widthMm: 21.5,
    heightMm: 20,
    bodyColour: '#1a3a3a',
    legendColour: '#e8f5f2',
    header: { x: 2.54, y: 3.81, names: ['GND', 'VCC', 'SDA', 'SCL'], alongColumn: true },
    knobs: [LM75_TEMPERATURE_KNOB],
  },
  tcs34725: {
    id: 'tcs34725-color',
    name: 'TCS34725 Color Sensor',
    widthMm: 21.5,
    heightMm: 20,
    bodyColour: '#2a1a3a',
    legendColour: '#f2e8f5',
    header: { x: 2.54, y: 3.81, names: ['GND', 'VCC', 'SDA', 'SCL'], alongColumn: true },
    knobs: [TCS34725_RED_KNOB, TCS34725_GREEN_KNOB, TCS34725_BLUE_KNOB, TCS34725_CLEAR_KNOB],
  },
  pcf8591: {
    id: 'pcf8591-adc',
    name: 'PCF8591 ADC/DAC',
    widthMm: 21.5,
    heightMm: 20,
    bodyColour: '#1a2a3a',
    legendColour: '#e8f2f5',
    header: { x: 2.54, y: 3.81, names: ['GND', 'VCC', 'SDA', 'SCL'], alongColumn: true },
    knobs: [PCF8591_CH0_KNOB, PCF8591_CH1_KNOB, PCF8591_CH2_KNOB, PCF8591_CH3_KNOB, PCF8591_DAC_KNOB],
  },
  sht31: {
    id: 'sht31-temp-humidity',
    name: 'SHT31 Temp/Humidity',
    widthMm: 21.5,
    heightMm: 20,
    bodyColour: '#123b2e',
    legendColour: '#eef7f2',
    header: { x: 2.54, y: 3.81, names: ['GND', 'VCC', 'SDA', 'SCL'], alongColumn: true },
    knobs: [SHT31_TEMPERATURE_KNOB, SHT31_HUMIDITY_KNOB],
  },
  bmp280: {
    id: 'bmp280-barometer',
    name: 'BMP280 Barometer',
    widthMm: 21.5,
    heightMm: 20,
    bodyColour: '#1e3a5f',
    legendColour: '#e8f2ff',
    header: { x: 2.54, y: 3.81, names: ['GND', 'VCC', 'SDA', 'SCL'], alongColumn: true },
    knobs: [BMP280_PRESSURE_KNOB, BMP280_TEMPERATURE_KNOB],
  },
  vl53l0x: {
    id: 'vl53l0x-distance',
    name: 'VL53L0X Distance Sensor',
    widthMm: 21.5,
    heightMm: 20,
    bodyColour: '#1e3a5f',
    legendColour: '#e8f2ff',
    header: { x: 2.54, y: 3.81, names: ['GND', 'VCC', 'SDA', 'SCL'], alongColumn: true },
    knobs: [VL53L0X_DISTANCE_KNOB],
  },
  bme280: {
    id: 'bme280-environment',
    name: 'BME280 Environment Sensor',
    widthMm: 21.5,
    heightMm: 20,
    bodyColour: '#1e3a5f',
    legendColour: '#e8f2ff',
    header: { x: 2.54, y: 3.81, names: ['GND', 'VCC', 'SDA', 'SCL'], alongColumn: true },
    knobs: [BME280_PRESSURE_KNOB, BME280_TEMPERATURE_KNOB, BME280_HUMIDITY_KNOB],
  },
  aht20: {
    id: 'aht20-environment',
    name: 'AHT20 Environment Sensor',
    widthMm: 21.5,
    heightMm: 20,
    bodyColour: '#123b2e',
    legendColour: '#eef7f2',
    header: { x: 2.54, y: 3.81, names: ['GND', 'VCC', 'SDA', 'SCL'], alongColumn: true },
    knobs: [AHT20_TEMPERATURE_KNOB, AHT20_HUMIDITY_KNOB],
  },
  scd40: {
    id: 'scd40-co2',
    name: 'SCD40 CO2 Sensor',
    widthMm: 21.5,
    heightMm: 20,
    bodyColour: '#1e3a5f',
    legendColour: '#e8f2ff',
    header: { x: 2.54, y: 3.81, names: ['GND', 'VCC', 'SDA', 'SCL'], alongColumn: true },
    knobs: [SCD40_CO2_KNOB, SCD40_TEMPERATURE_KNOB, SCD40_HUMIDITY_KNOB],
  },
  max30102: {
    id: 'max30102-pulse',
    name: 'MAX30102 Pulse Oximeter',
    widthMm: 21.5,
    heightMm: 20,
    bodyColour: '#1e3a5f',
    legendColour: '#e8f2ff',
    header: { x: 2.54, y: 3.81, names: ['GND', 'VCC', 'SDA', 'SCL'], alongColumn: true },
    knobs: [MAX30102_HEART_RATE_KNOB, MAX30102_SPO2_KNOB],
  },
  bme680: {
    id: 'bme680-gas',
    name: 'BME680 Gas Sensor',
    widthMm: 21.5,
    heightMm: 20,
    bodyColour: '#1e3a5f',
    legendColour: '#e8f2ff',
    header: { x: 2.54, y: 3.81, names: ['GND', 'VCC', 'SDA', 'SCL'], alongColumn: true },
    knobs: [BME680_PRESSURE_KNOB, BME680_TEMPERATURE_KNOB, BME680_HUMIDITY_KNOB, BME680_GAS_KNOB],
  },
  apds9960: {
    id: 'apds9960-gesture',
    name: 'APDS9960 Gesture Sensor',
    widthMm: 21.5,
    heightMm: 20,
    bodyColour: '#1e3a5f',
    legendColour: '#e8f2ff',
    header: { x: 2.54, y: 3.81, names: ['GND', 'VCC', 'SDA', 'SCL'], alongColumn: true },
    knobs: [APDS9960_PROXIMITY_KNOB, APDS9960_AMBIENT_KNOB, APDS9960_GESTURE_KNOB],
  },
  bno055: {
    id: 'bno055-imu',
    name: 'BNO055 Absolute Orientation',
    widthMm: 21.5,
    heightMm: 20,
    bodyColour: '#1e3a5f',
    legendColour: '#e8f2ff',
    header: { x: 2.54, y: 3.81, names: ['GND', 'VCC', 'SDA', 'SCL'], alongColumn: true },
    knobs: [BNO055_HEADING_KNOB, BNO055_PITCH_KNOB, BNO055_ROLL_KNOB],
  },
};

function headerPins(module: I2cModule): PinSpec[] {
  const { header } = module;
  return header.names.map((name, index) => {
    const step = index * PITCH;
    return {
      id: name,
      label: name,
      x: header.alongColumn ? header.x : header.x + step,
      y: header.alongColumn ? header.y + step : header.y,
      // Ground is the one pin that has to be tied. The engine decides whether
      // a device is on the bus by looking for its SDA and SCL on the firmware's
      // own nets, and a part whose ground is floating is a part that is not
      // there at all. The supply and the bus are separate nets, deliberately:
      // joining them here would hide every wiring mistake.
      net: name === 'GND' ? 'GND' : undefined,
    };
  });
}

function i2cSensorDefinition(variant: I2cSensorVariant): PartDefinition {
  const module = I2C_MODULES[variant];
  return {
    id: module.id,
    name: module.name,
    category: 'input',
    widthMm: module.widthMm,
    heightMm: module.heightMm,
    component: { kind: 'i2c-sensor', device: variant },
    pins: headerPins(module),
    knobs: module.knobs,
    bodyColour: module.bodyColour,
    legendColour: module.legendColour,
  };
}

/** DS1307 real-time clock: the blue coin-cell module on a four-pin header. */
export function ds1307Definition(): PartDefinition {
  return i2cSensorDefinition('ds1307');
}

/** DS3231 real-time clock: the same header, with a thermometer on the die. */
export function ds3231Definition(): PartDefinition {
  return i2cSensorDefinition('ds3231');
}

/** MPU-6050 accelerometer and gyroscope, on the carrier board it is sold on. */
export function mpu6050Definition(): PartDefinition {
  return i2cSensorDefinition('mpu6050');
}

/** HX711 load-cell amplifier, with the load cell connector along the top. */
export function hx711Definition(): PartDefinition {
  return i2cSensorDefinition('hx711');
}

/** BMP180 barometer: pressure and temperature over I2C. */
export function bmp180Definition(): PartDefinition {
  return i2cSensorDefinition('bmp180');
}

/** INA219 current monitor: the voltage on a bus and the current through it. */
export function ina219Definition(): PartDefinition {
  return i2cSensorDefinition('ina219');
}

/** ADS1115 converter: four channels read as sixteen-bit counts. */
export function ads1115Definition(): PartDefinition {
  return i2cSensorDefinition('ads1115');
}

/** BH1750 light sensor: ambient light as a sixteen-bit count. */
export function bh1750Definition(): PartDefinition {
  return i2cSensorDefinition('bh1750');
}

/** TMP102 thermometer: a signed twelve-bit temperature over the bus. */
export function tmp102Definition(): PartDefinition {
  return i2cSensorDefinition('tmp102');
}

/** MCP9808 thermometer: a signed thirteen-bit temperature at 0.0625 °C a count. */
export function mcp9808Definition(): PartDefinition {
  return i2cSensorDefinition('mcp9808');
}

/** LM75 thermometer: a signed eleven-bit temperature at 0.125 °C a count. */
export function lm75Definition(): PartDefinition {
  return i2cSensorDefinition('lm75');
}

/** TCS34725 color sensor: red, green, blue and clear channels over I2C. */
export function tcs34725Definition(): PartDefinition {
  return i2cSensorDefinition('tcs34725');
}

/** PCF8591 ADC/DAC: four channels and a DAC output over I2C. */
export function pcf8591Definition(): PartDefinition {
  return i2cSensorDefinition('pcf8591');
}

/** SHT31 temp/humidity sensor: two CRC-protected words in one frame. */
export function sht31Definition(): PartDefinition {
  return i2cSensorDefinition('sht31');
}

/** BMP280 barometer: pressure and temperature over I2C. */
export function bmp280Definition(): PartDefinition {
  return i2cSensorDefinition('bmp280');
}

/** VL53L0X time-of-flight distance sensor: millimetres over I2C. */
export function vl53l0xDefinition(): PartDefinition {
  return i2cSensorDefinition('vl53l0x');
}

/** BME280 environment sensor: temperature, pressure and humidity over I2C. */
export function bme280Definition(): PartDefinition {
  return i2cSensorDefinition('bme280');
}

/** AHT20 environment sensor: temperature and humidity over I2C. */
export function aht20Definition(): PartDefinition {
  return i2cSensorDefinition('aht20');
}

/** SCD40 CO2 sensor: carbon dioxide, temperature and humidity over I2C. */
export function scd40Definition(): PartDefinition {
  return i2cSensorDefinition('scd40');
}

/** MAX30102 pulse oximeter: heart rate and blood oxygen over I2C. */
export function max30102Definition(): PartDefinition {
  return i2cSensorDefinition('max30102');
}

/** BME680 gas sensor: temperature, pressure, humidity and gas over I2C. */
export function bme680Definition(): PartDefinition {
  return i2cSensorDefinition('bme680');
}

/** APDS9960 gesture sensor: gesture, proximity and ambient light over I2C. */
export function apds9960Definition(): PartDefinition {
  return i2cSensorDefinition('apds9960');
}

/** BNO055 absolute orientation sensor: heading, pitch and roll over I2C. */
export function bno055Definition(): PartDefinition {
  return i2cSensorDefinition('bno055');
}
