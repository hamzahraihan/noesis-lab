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
import { Bmp180 } from './bmp180';
import { Ds1307 } from './ds1307';
import { Hx711 } from './hx711';
import { Ina219 } from './ina219';
import { Mpu6050 } from './mpu6050';
import { Pcf8574 } from './pcf8574';
import { Mcp4725 } from './mcp4725';
import { Eeprom24lc256 } from './eeprom24lc256';
import { ScriptedI2cDevice } from './scripted';

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
    case 'i2c-sensor':
      if (component.device === 'ds1307') return new Ds1307();
      if (component.device === 'mpu6050') return new Mpu6050();
      if (component.device === 'bmp180') return new Bmp180();
      if (component.device === 'ina219') return new Ina219();
      if (component.device === 'ads1115') return new Ads1115();
      return new Hx711();
    default:
      return null;
  }
}
