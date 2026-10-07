// Public seam for features/simulation. Populated in Task 3.
// Code outside this folder must import from '@/features/simulation', never deep.
export * from './engine';
export * from './circuit';
export * from './netlist';
export * from './mcu';
export * from './bench';
export * from './elements';
export * from './probe';
export * from './multimeter';
export * from './units';
export * from './matrix';
// Transition shims for src/ui/* (untouchable until Task 5): these device
// models now live in features/parts. Task 5 rewrites ui to the parts seam
// and removes these lines. sim → parts-seam direction only; no cycle.
export { DISTANCE_KNOB, echoMicroseconds, sonarDefinition } from '@/features/parts';
export { HUMIDITY_KNOB, dhtDefinition } from '@/features/parts';
export { REMOTE_KEY_KNOB, remoteDefinition } from '@/features/parts';
export { DIGIT_KNOB, dialerDefinition } from '@/features/parts';
export { microsdDefinition } from '@/features/parts';
export { pixelCount, type PixelColor, neopixelDefinition } from '@/features/parts';
export * from './bus/i2c';
export * from './bus/spi';
export * from './bus/log';
export * from './firmware/interpreter';
export * from './firmware/parser';
export * from './firmware/python';
