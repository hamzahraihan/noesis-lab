/**
 * Which device model a part drives.
 *
 * A part that answers on a bus does not decide what it is by its own name: it
 * is looked up from its definition, so adding a device is a part, a model, and
 * one line here.
 */

import type { PartDefinition } from '../catalog';
import type { I2cDevice, ScriptedI2cSlave } from './device';
import { Ssd1306 } from '../display/ssd1306';
import { Ads1115 } from './ads1115';
import { Bh1750 } from './bh1750';
import { Bmp180 } from './bmp180';
import { Bmp280 } from './bmp280';
import { Bme280 } from './bme280';
import { Aht20 } from './aht20';
import { Scd40 } from './scd40';
import { Vl53l0x } from './vl53l0x';
import { Ds1307 } from './ds1307';
import { Ds3231 } from './ds3231';
import { Hx711 } from './hx711';
import { Ina219 } from './ina219';
import { Mpu6050 } from './mpu6050';
import { Pcf8574 } from './pcf8574';
import { Mcp23017 } from './mcp23017';
import { Pca9685 } from './pca9685';
import { Mcp4725 } from './mcp4725';
import { Mcp9808 } from './mcp9808';
import { Lm75 } from './lm75';
import { Tcs34725 } from './tcs34725';
import { Pcf8591 } from './pcf8591';
import { Eeprom24lc256 } from './eeprom24lc256';
import { ScriptedI2cDevice } from './scripted';
import { Sht31 } from './sht31';
import { Tmp102 } from './tmp102';

export type { I2cDevice } from './device';

/**
 * Whether a display model also answers on the bus.
 *
 * The TFT is selected by its chip-select line and has no address, so it is a
 * display and not an I2C device; the OLED is both.
 */
export function isI2cDevice(candidate: object): candidate is I2cDevice {
  return 'address' in candidate && 'read' in candidate && 'onBus' in candidate;
}

export function createI2cDevice(
  definition: PartDefinition,
  slave?: ScriptedI2cSlave,
): I2cDevice | null {
  const component = definition.component;
  switch (component.kind) {
    /*
     * A part the host has no model for: the file says which bus it speaks, and
     * on I2C that means an address and a script. The slave is passed in rather
     * than reached for, because the runtime that answers it belongs to whoever
     * owns the solve.
     */
    case 'scripted':
      return component.bus === 'i2c' && slave !== undefined
        ? new ScriptedI2cDevice(component.address, slave)
        : null;
    case 'display':
      // Only the OLED speaks I2C; a TFT on the same wires stays silent, and a
      // character LCD is driven over its own parallel header instead.
      return component.controller === 'ssd1306' ? new Ssd1306(component.address) : null;
    case 'eeprom':
      // A memory is a device like any other: an address and the bytes at
      // it, over the bus.
      return new Eeprom24lc256();
    case 'dac':
      // The converter is a device like any other: a code over the bus, and
      // a voltage on the output.
      return new Mcp4725();
    case 'i2c-expander':
      // The expander is a device like any other: one byte over the bus, and
      // eight pins that follow it.
      return new Pcf8574();
    case 'mcp23017':
      // Two ports behind direction registers: the sketch says which pins
      // drive before the latch has any effect on them.
      return new Mcp23017();
    case 'pca9685':
      // Sixteen comparators on one free-running counter: the sketch writes
      // where each channel turns on and off, and the chip repeats it.
      return new Pca9685();
    case 'i2c-sensor':
      if (component.device === 'ds1307') return new Ds1307();
      if (component.device === 'ds3231') return new Ds3231();
      if (component.device === 'mpu6050') return new Mpu6050();
      if (component.device === 'bmp180') return new Bmp180();
      if (component.device === 'ina219') return new Ina219();
      if (component.device === 'ads1115') return new Ads1115();
      if (component.device === 'bh1750') return new Bh1750();
      if (component.device === 'tmp102') return new Tmp102();
      if (component.device === 'mcp9808') return new Mcp9808();
      if (component.device === 'lm75') return new Lm75();
      if (component.device === 'tcs34725') return new Tcs34725();
      if (component.device === 'pcf8591') return new Pcf8591();
      if (component.device === 'sht31') return new Sht31();
      if (component.device === 'bmp280') return new Bmp280();
      if (component.device === 'bme280') return new Bme280();
      if (component.device === 'aht20') return new Aht20();
      if (component.device === 'scd40') return new Scd40();
      if (component.device === 'vl53l0x') return new Vl53l0x();
      return new Hx711();
    default:
      return null;
  }
}
