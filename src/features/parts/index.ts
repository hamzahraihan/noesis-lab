// Public seam for features/parts (catalogue module — what can be placed).
// Code outside this folder must import from '@/features/parts', never deep.
export * from './boards';
export * from './breadboard';
export * from './catalog';
export * from './modules';
export * from './passives';
export * from './devices/device';
export * from './devices/ads1115';
export * from './devices/bmp180';
export * from './devices/ds1307';
export * from './devices/hx711';
export * from './devices/pcf8574';
export * from './devices/ina219';
export * from './devices/shift595';
export * from './devices/lcd';
export * from './devices/lcd-driver';
export * from './devices/lcd1602';
export * from './devices/mpu6050';
export * from './devices/part';
export * from './devices/sensors';
export * from './devices/servo';
export * from './display/font5x7';
export * from './display/ili9341';
export * from './display/max7219';
export * from './display/part';
export * from './display/pcd8544';
export * from './display/sevensegment';
export * from './display/ssd1306';
export * from './relay';
export * from './encoder';
export * from './sonar';
export * from './dht';
export * from './ds18b20';
export * from './remote';
export * from './dialer';
export * from './sdcard';
export * from './pixels';
export * from './stepper';
export * from './mfrc522';
export * from './tm1637';
export * from './a4988';
// Last: the catalogue aggregates every definition above, so it evaluates
// after them (import-cycle order).
export * from './catalogue';

/*
 * Custom parts, last for the same reason the catalogue is: the validator's
 * derivation reads `PART_CATALOGUE`. The store's own module load registers it as
 * the catalogue's source, so importing this barrel anywhere is what makes an
 * imported part resolvable -- which is why the store is exported from it rather
 * than only from the screen that shows the palette.
 */
export * from './custom';
export * from './custom-registry';
export * from './custom-store';
