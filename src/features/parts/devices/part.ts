/**
 * Which device model a part drives.
 *
 * A part that answers on a bus does not decide what it is by its own name: it
 * is looked up from its definition, so adding a device is a part, a model, and
 * one line here.
 */

import type { PartDefinition } from '../catalog';
import type { I2cDevice } from './device';
import { Ssd1306 } from '../display/ssd1306';
import { Ds1307 } from './ds1307';
import { Hx711 } from './hx711';
import { Mpu6050 } from './mpu6050';

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

export function createI2cDevice(definition: PartDefinition): I2cDevice | null {
  const component = definition.component;
  switch (component.kind) {
    case 'display':
      // Only the OLED speaks I2C; a TFT on the same wires stays silent, and a
      // character LCD is driven over its own parallel header instead.
      return component.controller === 'ssd1306' ? new Ssd1306(component.address) : null;
    case 'i2c-sensor':
      if (component.device === 'ds1307') return new Ds1307();
      if (component.device === 'mpu6050') return new Mpu6050();
      return new Hx711();
    default:
      return null;
  }
}