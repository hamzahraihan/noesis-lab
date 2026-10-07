// Public seam for features/parts (catalogue module — what can be placed).
// Code outside this folder must import from '@/features/parts', never deep.
export * from './boards';
export * from './breadboard';
export * from './catalog';
export * from './modules';
export * from './passives';
export * from './devices/device';
export * from './devices/ds1307';
export * from './devices/hx711';
export * from './devices/lcd';
export * from './devices/lcd-driver';
export * from './devices/lcd1602';
export * from './devices/mpu6050';
export * from './devices/part';
export * from './devices/sensors';
export * from './devices/servo';
export * from './display/font5x7';
export * from './display/ili9341';
export * from './display/part';
export * from './display/ssd1306';
// Last: reads engine-defined part factories at module scope, so every
// definition module above must already be evaluated (import-cycle order).
export * from './catalogue';
