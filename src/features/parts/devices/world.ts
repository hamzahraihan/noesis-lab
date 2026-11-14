/**
 * Where a device gets its world.
 *
 * A chip does not read the room: it reads its own registers. What the bench has
 * instead of a room is the operator's knob, so every device that reports about
 * the world -- the air, the light, the distance, the load on a cell -- carries a
 * "world source": a closure that answers with what the world is doing *now*,
 * read at the moment the chip reports rather than pushed in on a tick.
 *
 * The device declares which knobs it wants and how to turn each one into a
 * reading. This module joins the two halves: given the part and the controls the
 * operator is holding, it installs the device's world source with the knob specs
 * the device itself exports. The engine no longer knows which chip needs which
 * knob -- it hands over the controls and lets the device's own declaration
 * decide.
 *
 * Each arm is keyed on the concrete class, so a device with a world cannot be
 * added without an arm here: the chain is exhaustive over the devices that carry
 * one, and `tsc` fails on a missing class. That is the point. The failure this
 * module exists to prevent is a chip answering from a knob the bench never
 * wired, which reads on the bench as "the reading never came".
 */

import type { DynamicState, KnobSpec } from '../catalog';
import type { I2cDevice } from './device';
import { Ads1115, ADS1115_CHANNEL_KNOBS } from './ads1115';
import { Adxl345, ADXL345_X_KNOB, ADXL345_Y_KNOB, ADXL345_Z_KNOB } from './adxl345';
import { Aht20, AHT20_HUMIDITY_KNOB, AHT20_TEMPERATURE_KNOB } from './aht20';
import {
  Apds9960,
  APDS9960_AMBIENT_KNOB,
  APDS9960_GESTURE_KNOB,
  APDS9960_PROXIMITY_KNOB,
} from './apds9960';
import { Bh1750, BH1750_LIGHT_KNOB } from './bh1750';
import {
  Bme280,
  BME280_HUMIDITY_KNOB,
  BME280_PRESSURE_KNOB,
  BME280_TEMPERATURE_KNOB,
} from './bme280';
import {
  Bme680,
  BME680_GAS_KNOB,
  BME680_HUMIDITY_KNOB,
  BME680_PRESSURE_KNOB,
  BME680_TEMPERATURE_KNOB,
} from './bme680';
import {
  Bmp180,
  BMP180_PRESSURE_KNOB,
  BMP180_TEMPERATURE_KNOB,
} from './bmp180';
import {
  Bmp280,
  BMP280_PRESSURE_KNOB,
  BMP280_TEMPERATURE_KNOB,
} from './bmp280';
import {
  Bno055,
  BNO055_HEADING_KNOB,
  BNO055_PITCH_KNOB,
  BNO055_ROLL_KNOB,
} from './bno055';
import { Ccs811, CCS811_ECO2_KNOB, CCS811_TVOC_KNOB } from './ccs811';
import { Ds3231, DS3231_TEMPERATURE_KNOB } from './ds3231';
import { Hmc5883l, HMC5883L_X_KNOB, HMC5883L_Y_KNOB, HMC5883L_Z_KNOB } from './hmc5883l';
import { Htu21d, HTU21D_HUMIDITY_KNOB, HTU21D_TEMPERATURE_KNOB } from './htu21d';
import { Hx711 } from './hx711';
import { Ina219, INA219_BUS_KNOB, INA219_CURRENT_KNOB } from './ina219';
import { Lm75, LM75_TEMPERATURE_KNOB } from './lm75';
import { Max30100, MAX30100_HEART_RATE_KNOB, MAX30100_SPO2_KNOB } from './max30100';
import { Max30102, MAX30102_HEART_RATE_KNOB, MAX30102_SPO2_KNOB } from './max30102';
import { Mcp9808, MCP9808_TEMPERATURE_KNOB } from './mcp9808';
import { Mlx90614, MLX90614_AMBIENT_KNOB, MLX90614_OBJECT_KNOB } from './mlx90614';
import {
  Pcf8591,
  PCF8591_CH0_KNOB,
  PCF8591_CH1_KNOB,
  PCF8591_CH2_KNOB,
  PCF8591_CH3_KNOB,
  PCF8591_DAC_KNOB,
} from './pcf8591';
import { Scd40, SCD40_CO2_KNOB, SCD40_HUMIDITY_KNOB, SCD40_TEMPERATURE_KNOB } from './scd40';
import { Sgp30, SGP30_ECO2_KNOB, SGP30_TVOC_KNOB } from './sgp30';
import { Sht31, SHT31_HUMIDITY_KNOB, SHT31_TEMPERATURE_KNOB } from './sht31';
import { Si7021, SI7021_HUMIDITY_KNOB, SI7021_TEMPERATURE_KNOB } from './si7021';
import {
  Tcs34725,
  TCS34725_BLUE_KNOB,
  TCS34725_CLEAR_KNOB,
  TCS34725_GREEN_KNOB,
  TCS34725_RED_KNOB,
} from './tcs34725';
import { Tmp102, TMP102_TEMPERATURE_KNOB } from './tmp102';
import { Tsl2561, TSL2561_LIGHT_KNOB } from './tsl2561';
import { Veml6075, VEML6075_UVA_KNOB, VEML6075_UVB_KNOB } from './veml6075';
import { Vl53l0x, VL53L0X_DISTANCE_KNOB } from './vl53l0x';
import { HX711_LOAD_KNOB } from './sensors';

/** The controls the operator is holding, and the part they are holding them on. */
export interface DeviceWorld {
  readonly controls: DynamicState;
  readonly partId: string;
}

/**
 * Installs a device's world source, reading each knob the device declares.
 *
 * Called on every rebuild, because the device is carried across rebuilds while
 * the controls it reads are replaced: a knob turned between two reads is seen by
 * the very next one.
 */
export function installWorld(device: I2cDevice, world: DeviceWorld): void {
  const knob = (spec: KnobSpec): number => world.controls.knob(world.partId, spec);

  if (device instanceof Bmp180) {
    // The pressure knob is dialled in hectopascals; the chip answers in pascals.
    device.setConditionsSource(() => ({
      pascals: knob(BMP180_PRESSURE_KNOB) * 100,
      celsius: knob(BMP180_TEMPERATURE_KNOB),
    }));
  } else if (device instanceof Bmp280) {
    device.setConditionsSource(() => ({
      pascals: knob(BMP280_PRESSURE_KNOB) * 100,
      celsius: knob(BMP280_TEMPERATURE_KNOB),
    }));
  } else if (device instanceof Ina219) {
    // The current knob is dialled in milliamps; the chip answers in amps.
    device.setConditionsSource(() => ({
      busVolts: knob(INA219_BUS_KNOB),
      amps: knob(INA219_CURRENT_KNOB) / 1000,
    }));
  } else if (device instanceof Ads1115) {
    device.setChannelsSource(() => ADS1115_CHANNEL_KNOBS.map((spec) => knob(spec)));
  } else if (device instanceof Hx711) {
    device.setLoadSource(() => knob(HX711_LOAD_KNOB));
  } else if (device instanceof Ds3231) {
    device.setTemperatureSource(() => knob(DS3231_TEMPERATURE_KNOB));
  } else if (device instanceof Bh1750) {
    device.setLightSource(() => knob(BH1750_LIGHT_KNOB));
  } else if (device instanceof Tmp102) {
    device.setTemperatureSource(() => knob(TMP102_TEMPERATURE_KNOB));
  } else if (device instanceof Mcp9808) {
    device.setTemperatureSource(() => knob(MCP9808_TEMPERATURE_KNOB));
  } else if (device instanceof Lm75) {
    device.setTemperatureSource(() => knob(LM75_TEMPERATURE_KNOB));
  } else if (device instanceof Tcs34725) {
    device.setSource(() => ({
      red: knob(TCS34725_RED_KNOB),
      green: knob(TCS34725_GREEN_KNOB),
      blue: knob(TCS34725_BLUE_KNOB),
      clear: knob(TCS34725_CLEAR_KNOB),
    }));
  } else if (device instanceof Pcf8591) {
    device.setChannelsSource(() => [
      knob(PCF8591_CH0_KNOB),
      knob(PCF8591_CH1_KNOB),
      knob(PCF8591_CH2_KNOB),
      knob(PCF8591_CH3_KNOB),
      knob(PCF8591_DAC_KNOB),
    ]);
  } else if (device instanceof Sht31) {
    device.setConditionsSource(() => ({
      celsius: knob(SHT31_TEMPERATURE_KNOB),
      humidity: knob(SHT31_HUMIDITY_KNOB),
    }));
  } else if (device instanceof Htu21d) {
    device.setConditionsSource(() => ({
      celsius: knob(HTU21D_TEMPERATURE_KNOB),
      humidity: knob(HTU21D_HUMIDITY_KNOB),
    }));
  } else if (device instanceof Si7021) {
    device.setConditionsSource(() => ({
      celsius: knob(SI7021_TEMPERATURE_KNOB),
      humidity: knob(SI7021_HUMIDITY_KNOB),
    }));
  } else if (device instanceof Aht20) {
    device.setConditionsSource(() => ({
      celsius: knob(AHT20_TEMPERATURE_KNOB),
      humidity: knob(AHT20_HUMIDITY_KNOB),
    }));
  } else if (device instanceof Bme280) {
    device.setConditionsSource(() => ({
      pascals: knob(BME280_PRESSURE_KNOB) * 100,
      celsius: knob(BME280_TEMPERATURE_KNOB),
      humidity: knob(BME280_HUMIDITY_KNOB),
    }));
  } else if (device instanceof Bme680) {
    device.setConditionsSource(() => ({
      pascals: knob(BME680_PRESSURE_KNOB) * 100,
      celsius: knob(BME680_TEMPERATURE_KNOB),
      humidity: knob(BME680_HUMIDITY_KNOB),
      gas: knob(BME680_GAS_KNOB),
    }));
  } else if (device instanceof Scd40) {
    device.setConditionsSource(() => ({
      co2: knob(SCD40_CO2_KNOB),
      celsius: knob(SCD40_TEMPERATURE_KNOB),
      humidity: knob(SCD40_HUMIDITY_KNOB),
    }));
  } else if (device instanceof Mlx90614) {
    device.setConditionsSource(() => ({
      ambient: knob(MLX90614_AMBIENT_KNOB),
      object: knob(MLX90614_OBJECT_KNOB),
    }));
  } else if (device instanceof Vl53l0x) {
    device.setDistanceSource(() => knob(VL53L0X_DISTANCE_KNOB));
  } else if (device instanceof Adxl345) {
    device.setAccelerationSource(() => ({
      x: knob(ADXL345_X_KNOB),
      y: knob(ADXL345_Y_KNOB),
      z: knob(ADXL345_Z_KNOB),
    }));
  } else if (device instanceof Hmc5883l) {
    device.setFieldSource(() => ({
      x: knob(HMC5883L_X_KNOB),
      y: knob(HMC5883L_Y_KNOB),
      z: knob(HMC5883L_Z_KNOB),
    }));
  } else if (device instanceof Tsl2561) {
    device.setLightSource(() => knob(TSL2561_LIGHT_KNOB));
  } else if (device instanceof Ccs811) {
    device.setAirSource(() => ({
      eco2: knob(CCS811_ECO2_KNOB),
      tvoc: knob(CCS811_TVOC_KNOB),
    }));
  } else if (device instanceof Sgp30) {
    device.setAirSource(() => ({
      eco2: knob(SGP30_ECO2_KNOB),
      tvoc: knob(SGP30_TVOC_KNOB),
    }));
  } else if (device instanceof Veml6075) {
    device.setUvSource(() => ({
      uva: knob(VEML6075_UVA_KNOB),
      uvb: knob(VEML6075_UVB_KNOB),
    }));
  } else if (device instanceof Apds9960) {
    device.setConditionsSource(() => ({
      proximity: knob(APDS9960_PROXIMITY_KNOB),
      ambient: knob(APDS9960_AMBIENT_KNOB),
      gesture: knob(APDS9960_GESTURE_KNOB),
    }));
  } else if (device instanceof Bno055) {
    device.setOrientationSource(() => ({
      heading: knob(BNO055_HEADING_KNOB),
      pitch: knob(BNO055_PITCH_KNOB),
      roll: knob(BNO055_ROLL_KNOB),
    }));
  } else if (device instanceof Max30100) {
    device.setConditionsSource(() => ({
      heartRate: knob(MAX30100_HEART_RATE_KNOB),
      spo2: knob(MAX30100_SPO2_KNOB),
    }));
  } else if (device instanceof Max30102) {
    device.setConditionsSource(() => ({
      heartRate: knob(MAX30102_HEART_RATE_KNOB),
      spo2: knob(MAX30102_SPO2_KNOB),
    }));
  }
}