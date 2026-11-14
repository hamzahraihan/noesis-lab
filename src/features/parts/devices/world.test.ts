/**
 * Every knob-bearing I2C device is handed the knob the operator turned.
 *
 * A device does not read the room: it reads its own registers. The bench's world
 * source is what joins the two, and it is installed on every rebuild. What this
 * guards against is not a device that computes wrongly -- each device's own test
 * pins its arithmetic -- but a device that was never given a world at all. It
 * then answers from a fixed default, and the only symptom on the bench is a
 * reading that never moves. That is what happened to nineteen devices, including
 * the HTU21D the gallery ships: the factory had no branch for it, so it was built
 * as a load-cell amplifier.
 *
 * So the assertion is about the join, not the chip: turn a knob on the bench's
 * own controls, rebuild the way the engine does, and read back what the device
 * was handed. A device with no arm in `world.ts` is handed nothing, and this
 * fails -- which is the coverage the installer needs and a device-level test
 * cannot give.
 */

import { describe, expect, it } from 'vitest';
import { BenchBuilder, Engine, McuRuntime } from '@/features/simulation';
import { DynamicState, type KnobSpec, type PartDefinition } from '../catalog';
import { breadboardDefinition } from '../breadboard';
import { esp32DevKitV1 } from '../boards';
import type { I2cDevice } from './device';

import { ADS1115_CHANNEL_KNOBS } from './ads1115';
import { ADXL345_X_KNOB, ADXL345_Y_KNOB, ADXL345_Z_KNOB } from './adxl345';
import { AHT20_HUMIDITY_KNOB, AHT20_TEMPERATURE_KNOB } from './aht20';
import { APDS9960_AMBIENT_KNOB, APDS9960_GESTURE_KNOB, APDS9960_PROXIMITY_KNOB } from './apds9960';
import { BH1750_LIGHT_KNOB } from './bh1750';
import { BME280_HUMIDITY_KNOB, BME280_PRESSURE_KNOB, BME280_TEMPERATURE_KNOB } from './bme280';
import {
  BME680_GAS_KNOB,
  BME680_HUMIDITY_KNOB,
  BME680_PRESSURE_KNOB,
  BME680_TEMPERATURE_KNOB,
} from './bme680';
import { BMP180_PRESSURE_KNOB, BMP180_TEMPERATURE_KNOB } from './bmp180';
import { BMP280_PRESSURE_KNOB, BMP280_TEMPERATURE_KNOB } from './bmp280';
import { BNO055_HEADING_KNOB, BNO055_PITCH_KNOB, BNO055_ROLL_KNOB } from './bno055';
import { CCS811_ECO2_KNOB, CCS811_TVOC_KNOB } from './ccs811';
import { DS3231_TEMPERATURE_KNOB } from './ds3231';
import { HMC5883L_X_KNOB, HMC5883L_Y_KNOB, HMC5883L_Z_KNOB } from './hmc5883l';
import { HTU21D_HUMIDITY_KNOB, HTU21D_TEMPERATURE_KNOB } from './htu21d';
import { INA219_BUS_KNOB, INA219_CURRENT_KNOB } from './ina219';
import { LM75_TEMPERATURE_KNOB } from './lm75';
import { MAX30100_HEART_RATE_KNOB, MAX30100_SPO2_KNOB } from './max30100';
import { MAX30102_HEART_RATE_KNOB, MAX30102_SPO2_KNOB } from './max30102';
import { MCP9808_TEMPERATURE_KNOB } from './mcp9808';
import { MLX90614_AMBIENT_KNOB, MLX90614_OBJECT_KNOB } from './mlx90614';
import { PCF8591_DAC_KNOB } from './pcf8591';
import { SCD40_CO2_KNOB, SCD40_HUMIDITY_KNOB, SCD40_TEMPERATURE_KNOB } from './scd40';
import { SGP30_ECO2_KNOB, SGP30_TVOC_KNOB } from './sgp30';
import { SHT31_HUMIDITY_KNOB, SHT31_TEMPERATURE_KNOB } from './sht31';
import { SI7021_HUMIDITY_KNOB, SI7021_TEMPERATURE_KNOB } from './si7021';
import {
  TCS34725_BLUE_KNOB,
  TCS34725_CLEAR_KNOB,
  TCS34725_GREEN_KNOB,
  TCS34725_RED_KNOB,
} from './tcs34725';
import { TMP102_TEMPERATURE_KNOB } from './tmp102';
import { TSL2561_LIGHT_KNOB } from './tsl2561';
import { VEML6075_UVA_KNOB, VEML6075_UVB_KNOB } from './veml6075';
import { VL53L0X_DISTANCE_KNOB } from './vl53l0x';
import {
  ads1115Definition,
  adxl345Definition,
  aht20Definition,
  apds9960Definition,
  bh1750Definition,
  bme280Definition,
  bme680Definition,
  bmp180Definition,
  bmp280Definition,
  bno055Definition,
  ccs811Definition,
  ds3231Definition,
  hmc5883lDefinition,
  htu21dDefinition,
  ina219Definition,
  lm75Definition,
  max30100Definition,
  max30102Definition,
  mcp9808Definition,
  mlx90614Definition,
  pcf8591Definition,
  scd40Definition,
  sgp30Definition,
  sht31Definition,
  si7021Definition,
  tcs34725Definition,
  tmp102Definition,
  tsl2561Definition,
  veml6075Definition,
  vl53l0xDefinition,
} from './sensors';
import { HX711_LOAD_KNOB, hx711Definition } from './sensors';

/** Breadboard origin, clear of the board plugged in beside it. */
const BOARD_ORIGIN_X = 230;

/**
 * A bench with one device wired onto the firmware's I2C nets.
 *
 * `knob` is turned on the bench's own controls before the rebuild, which is when
 * the installer runs -- so the device is handed the value the operator set, not
 * the one it happened to be built with.
 */
function benchWith(
  definition: PartDefinition,
  controls: DynamicState,
  knob?: { spec: KnobSpec; value: number },
) {
  const builder = new BenchBuilder();
  builder.addPart(breadboardDefinition(), BOARD_ORIGIN_X, 0);
  const esp32 = builder.addPart(esp32DevKitV1(), 0, 0);
  const device = builder.addPart(definition, 640, 200);

  const hole = (pin: string) => {
    const terminal = builder.build().terminals[device.terminals[pin]];
    return { x: terminal.x, y: terminal.y };
  };
  const boardPin = (id: string) => esp32.definition.pins.find((pin) => pin.id === id)!;
  const wire = (from: { x: number; y: number }, to: { x: number; y: number }) =>
    builder.addWire(from.x, from.y, to.x, to.y);

  wire(hole('SDA'), boardPin('R_D21'));
  wire(hole('SCL'), boardPin('R_D22'));
  wire(hole('VCC'), boardPin('R_3V3'));
  wire(hole('GND'), boardPin('L_GND'));

  if (knob !== undefined) controls.setKnob(device.id, knob.spec, knob.value);

  const mcu = new McuRuntime(esp32.definition);
  const engine = new Engine({ bench: builder.build(), mcu, dynamicState: controls });
  engine.rebuild();

  const built = engine.i2cDevice(device.id);
  if (built === undefined) throw new Error(`${definition.id}: the bench built no device`);
  return { device: built, engine, controls };
}

/** One device's knobs and how each is read back from what the device was handed. */
interface Case {
  readonly name: string;
  readonly definition: PartDefinition;
  readonly knobs: readonly KnobCase[];
  /**
   * Some knobs are dialled in one unit and handed over in another (milliamps to
   * amps, hectopascals to pascals); the rest arrive unchanged.
   */
  readonly converts?: (spec: KnobSpec, value: number) => number;
}

interface KnobCase {
  readonly spec: KnobSpec;
  /** Reads the value the device was handed, out of its own world source. */
  readonly read: (device: I2cDevice) => number;
}

/**
 * The world the installer handed the device.
 *
 * Every device with a world source keeps it in a private `world` field, written
 * by its setter and read at the moment the chip reports. This reads that field
 * through a narrowing guard rather than an assertion: a device the installer
 * skipped has no source at all, and that is the failure this file exists to name.
 */
function world(device: I2cDevice): unknown {
  const holder: object = device;
  if (!('world' in holder)) {
    throw new Error(`${device.constructor.name}: no world source was installed`);
  }
  const source: unknown = Reflect.get(holder, 'world');
  if (typeof source !== 'function') {
    throw new Error(`${device.constructor.name}: no world source was installed`);
  }
  return Reflect.apply(source, holder, []) as unknown;
}

/** One field of a multi-field world. */
function field(name: string): (device: I2cDevice) => number {
  return (device) => readField(device, name);
}

/** Reads one numeric field of the world the device was handed. */
function readField(device: I2cDevice, name: string): number {
  const value: unknown = world(device);
  if (typeof value === 'object' && value !== null && name in value) {
    const entry: unknown = Reflect.get(value, name);
    if (typeof entry === 'number') return entry;
  }
  throw new Error(`${device.constructor.name}: world has no numeric '${name}'`);
}

/** The whole world, when a single-knob device hands over a bare number. */
const bare = (device: I2cDevice): number => {
  const value: unknown = world(device);
  if (typeof value !== 'number') {
    throw new Error(`${device.constructor.name}: world is not a bare number`);
  }
  return value;
};

/** One entry of an array world, for the multi-channel converters. */
function channel(index: number): (device: I2cDevice) => number {
  return (device) => {
    const value: unknown = world(device);
    if (!Array.isArray(value)) {
      throw new Error(`${device.constructor.name}: world is not an array`);
    }
    const entry: unknown = value[index];
    if (typeof entry !== 'number') {
      throw new Error(`${device.constructor.name}: world has no channel ${index}`);
    }
    return entry;
  };
}

/**
 * The die temperature a DS3231 was handed.
 *
 * Its source is kept under `temperatureSource` rather than `world`, because the
 * chip reads its own die rather than the room; `temperatureCelsius` is the one
 * accessor that runs it.
 */
function dieTemperature(device: I2cDevice): number {
  const probe: object = device;
  if (!('temperatureCelsius' in probe)) {
    throw new Error(`${device.constructor.name}: no die temperature`);
  }
  const read: unknown = Reflect.get(probe, 'temperatureCelsius');
  if (typeof read !== 'function') {
    throw new Error(`${device.constructor.name}: no die temperature`);
  }
  return Reflect.apply(read, probe, []) as number;
}

const CASES: readonly Case[] = [
  {
    name: 'HTU21D',
    definition: htu21dDefinition(),
    knobs: [
      { spec: HTU21D_TEMPERATURE_KNOB, read: field('celsius') },
      { spec: HTU21D_HUMIDITY_KNOB, read: field('humidity') },
    ],
  },
  {
    name: 'SI7021',
    definition: si7021Definition(),
    knobs: [
      { spec: SI7021_TEMPERATURE_KNOB, read: field('celsius') },
      { spec: SI7021_HUMIDITY_KNOB, read: field('humidity') },
    ],
  },
  {
    name: 'AHT20',
    definition: aht20Definition(),
    knobs: [
      { spec: AHT20_TEMPERATURE_KNOB, read: field('celsius') },
      { spec: AHT20_HUMIDITY_KNOB, read: field('humidity') },
    ],
  },
  {
    name: 'SHT31',
    definition: sht31Definition(),
    knobs: [
      { spec: SHT31_TEMPERATURE_KNOB, read: field('celsius') },
      { spec: SHT31_HUMIDITY_KNOB, read: field('humidity') },
    ],
  },
  {
    name: 'BMP180',
    definition: bmp180Definition(),
    knobs: [
      { spec: BMP180_TEMPERATURE_KNOB, read: field('celsius') },
      { spec: BMP180_PRESSURE_KNOB, read: field('pascals') },
    ],
    converts: (spec, value) => (spec.id === 'pressure' ? value * 100 : value),
  },
  {
    name: 'BMP280',
    definition: bmp280Definition(),
    knobs: [
      { spec: BMP280_TEMPERATURE_KNOB, read: field('celsius') },
      { spec: BMP280_PRESSURE_KNOB, read: field('pascals') },
    ],
    converts: (spec, value) => (spec.id === 'pressure' ? value * 100 : value),
  },
  {
    name: 'BME280',
    definition: bme280Definition(),
    knobs: [
      { spec: BME280_TEMPERATURE_KNOB, read: field('celsius') },
      { spec: BME280_HUMIDITY_KNOB, read: field('humidity') },
      { spec: BME280_PRESSURE_KNOB, read: field('pascals') },
    ],
    converts: (spec, value) => (spec.id === 'pressure' ? value * 100 : value),
  },
  {
    name: 'BME680',
    definition: bme680Definition(),
    knobs: [
      { spec: BME680_TEMPERATURE_KNOB, read: field('celsius') },
      { spec: BME680_HUMIDITY_KNOB, read: field('humidity') },
      { spec: BME680_GAS_KNOB, read: field('gas') },
      { spec: BME680_PRESSURE_KNOB, read: field('pascals') },
    ],
    converts: (spec, value) => (spec.id === 'pressure' ? value * 100 : value),
  },
  {
    name: 'SCD40',
    definition: scd40Definition(),
    knobs: [
      { spec: SCD40_TEMPERATURE_KNOB, read: field('celsius') },
      { spec: SCD40_HUMIDITY_KNOB, read: field('humidity') },
      { spec: SCD40_CO2_KNOB, read: field('co2') },
    ],
  },
  {
    name: 'MLX90614',
    definition: mlx90614Definition(),
    knobs: [
      { spec: MLX90614_AMBIENT_KNOB, read: field('ambient') },
      { spec: MLX90614_OBJECT_KNOB, read: field('object') },
    ],
  },
  {
    name: 'TMP102',
    definition: tmp102Definition(),
    // A single-knob device hands over a bare number, not a record.
    knobs: [{ spec: TMP102_TEMPERATURE_KNOB, read: bare }],
  },
  {
    name: 'MCP9808',
    definition: mcp9808Definition(),
    knobs: [{ spec: MCP9808_TEMPERATURE_KNOB, read: bare }],
  },
  {
    name: 'LM75',
    definition: lm75Definition(),
    knobs: [{ spec: LM75_TEMPERATURE_KNOB, read: bare }],
  },
  {
    name: 'DS3231',
    definition: ds3231Definition(),
    // The thermometer reads its own die, so its source lives under its own
    // field rather than the general `world` one.
    knobs: [{ spec: DS3231_TEMPERATURE_KNOB, read: dieTemperature }],
  },
  {
    name: 'BH1750',
    definition: bh1750Definition(),
    knobs: [{ spec: BH1750_LIGHT_KNOB, read: bare }],
  },
  {
    name: 'TSL2561',
    definition: tsl2561Definition(),
    knobs: [{ spec: TSL2561_LIGHT_KNOB, read: bare }],
  },
  {
    name: 'VL53L0X',
    definition: vl53l0xDefinition(),
    knobs: [{ spec: VL53L0X_DISTANCE_KNOB, read: bare }],
  },
  {
    name: 'HX711',
    definition: hx711Definition(),
    knobs: [{ spec: HX711_LOAD_KNOB, read: bare }],
  },
  {
    name: 'INA219',
    definition: ina219Definition(),
    knobs: [
      { spec: INA219_BUS_KNOB, read: field('busVolts') },
      { spec: INA219_CURRENT_KNOB, read: field('amps') },
    ],
    converts: (spec, value) => (spec.id === 'current' ? value / 1000 : value),
  },
  {
    name: 'ADS1115',
    definition: ads1115Definition(),
    knobs: ADS1115_CHANNEL_KNOBS.map((spec, index) => ({
      spec,
      read: channel(index),
    })),
  },
  {
    name: 'TCS34725',
    definition: tcs34725Definition(),
    knobs: [
      { spec: TCS34725_RED_KNOB, read: field('red') },
      { spec: TCS34725_GREEN_KNOB, read: field('green') },
      { spec: TCS34725_BLUE_KNOB, read: field('blue') },
      { spec: TCS34725_CLEAR_KNOB, read: field('clear') },
    ],
  },
  {
    name: 'APDS9960',
    definition: apds9960Definition(),
    knobs: [
      { spec: APDS9960_PROXIMITY_KNOB, read: field('proximity') },
      { spec: APDS9960_AMBIENT_KNOB, read: field('ambient') },
      { spec: APDS9960_GESTURE_KNOB, read: field('gesture') },
    ],
  },
  {
    name: 'BNO055',
    definition: bno055Definition(),
    knobs: [
      { spec: BNO055_HEADING_KNOB, read: field('heading') },
      { spec: BNO055_PITCH_KNOB, read: field('pitch') },
      { spec: BNO055_ROLL_KNOB, read: field('roll') },
    ],
  },
  {
    name: 'ADXL345',
    definition: adxl345Definition(),
    knobs: [
      { spec: ADXL345_X_KNOB, read: field('x') },
      { spec: ADXL345_Y_KNOB, read: field('y') },
      { spec: ADXL345_Z_KNOB, read: field('z') },
    ],
  },
  {
    name: 'HMC5883L',
    definition: hmc5883lDefinition(),
    knobs: [
      { spec: HMC5883L_X_KNOB, read: field('x') },
      { spec: HMC5883L_Y_KNOB, read: field('y') },
      { spec: HMC5883L_Z_KNOB, read: field('z') },
    ],
  },
  {
    name: 'CCS811',
    definition: ccs811Definition(),
    knobs: [
      { spec: CCS811_ECO2_KNOB, read: field('eco2') },
      { spec: CCS811_TVOC_KNOB, read: field('tvoc') },
    ],
  },
  {
    name: 'SGP30',
    definition: sgp30Definition(),
    knobs: [
      { spec: SGP30_ECO2_KNOB, read: field('eco2') },
      { spec: SGP30_TVOC_KNOB, read: field('tvoc') },
    ],
  },
  {
    name: 'VEML6075',
    definition: veml6075Definition(),
    knobs: [
      { spec: VEML6075_UVA_KNOB, read: field('uva') },
      { spec: VEML6075_UVB_KNOB, read: field('uvb') },
    ],
  },
  {
    name: 'MAX30100',
    definition: max30100Definition(),
    knobs: [
      { spec: MAX30100_HEART_RATE_KNOB, read: field('heartRate') },
      { spec: MAX30100_SPO2_KNOB, read: field('spo2') },
    ],
  },
  {
    name: 'MAX30102',
    definition: max30102Definition(),
    knobs: [
      { spec: MAX30102_HEART_RATE_KNOB, read: field('heartRate') },
      { spec: MAX30102_SPO2_KNOB, read: field('spo2') },
    ],
  },
  {
    name: 'PCF8591',
    definition: pcf8591Definition(),
    knobs: [
      { spec: PCF8591_DAC_KNOB, read: channel(4) },
      { spec: { ...PCF8591_DAC_KNOB, id: 'ch0' }, read: channel(0) },
      { spec: { ...PCF8591_DAC_KNOB, id: 'ch1' }, read: channel(1) },
      { spec: { ...PCF8591_DAC_KNOB, id: 'ch2' }, read: channel(2) },
      { spec: { ...PCF8591_DAC_KNOB, id: 'ch3' }, read: channel(3) },
    ],
  },
];

/**
 * Both ends of a knob's range, so a device handed a fixed default fails. The
 * knob is set on the bench's own controls and the bench rebuilt, which is when
 * the installer runs and hands the device its world.
 */
function knobValues(spec: KnobSpec): readonly number[] {
  return [spec.min, spec.max];
}

describe('a knob-bearing device is handed the knob the operator turned', () => {
  for (const testCase of CASES) {
    it(`${testCase.name} receives each of its knobs`, () => {
      for (const knob of testCase.knobs) {
        // Both ends of the knob's own range: a device handed a fixed default,
        // or one clamped to the middle, fails an endpoint rather than passing a
        // midpoint.
        for (const value of knobValues(knob.spec)) {
          const controls = new DynamicState();
          const { device } = benchWith(testCase.definition, controls, {
            spec: knob.spec,
            value,
          });

          const wanted = testCase.converts?.(knob.spec, value) ?? value;
          const reported = knob.read(device);
          expect(
            reported,
            `${testCase.name}.${knob.spec.id}: turned to ${value}, the device was handed ${reported}`,
          ).toBeCloseTo(wanted, 6);
        }
      }
    });
  }
});

describe('the HTU21D the gallery ships', () => {
  it('is built as itself and given a world', () => {
    /*
     * The case that started this: the factory had no branch for the HTU21D, so
     * a temperature sensor was built as a load-cell amplifier. The factory is
     * fixed; this pins the other half -- the installer must arm it, or its knobs
     * do nothing however correct the wiring is.
     */
    const definition = htu21dDefinition();
    const controls = new DynamicState();
    const { device } = benchWith(definition, controls);
    expect(device.constructor.name).toBe('Htu21d');
    expect(() => world(device)).not.toThrow();
  });
});

describe('an I2C variant the host has no model for', () => {
  it('refuses the build instead of answering as another part', () => {
    const definition: PartDefinition = {
      ...htu21dDefinition(),
      id: 'invented-sensor',
      name: 'Invented Sensor',
      component: { kind: 'i2c-sensor', device: 'not-a-real-variant' as never },
    };
    expect(() => {
      const builder = new BenchBuilder();
      builder.addPart(esp32DevKitV1(), 0, 0);
      builder.addPart(definition, 640, 200);
      const engine = new Engine({
        bench: builder.build(),
        mcu: new McuRuntime(esp32DevKitV1()),
        dynamicState: new DynamicState(),
      });
      engine.rebuild();
    }).toThrow(/no I2C device model/);
  });
});