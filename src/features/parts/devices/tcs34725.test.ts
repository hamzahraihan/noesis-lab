import { describe, expect, it } from 'vitest';
import {
  TCS34725_ADDRESS,
  TCS34725_RED_KNOB,
  TCS34725_GREEN_KNOB,
  TCS34725_BLUE_KNOB,
  TCS34725_CLEAR_KNOB,
  Tcs34725,
} from './tcs34725';
import { tcs34725Definition } from './sensors';

/** Points the chip at a register (with command bit set). */
function pointAt(device: Tcs34725, register: number): void {
  device.receive(0x80 | register, true);
}

describe('TCS34725 color sensor', () => {
  it('answers at 0x29', () => {
    expect(new Tcs34725().address).toBe(TCS34725_ADDRESS);
    expect(TCS34725_ADDRESS).toBe(0x29);
  });

  it('reports the ID register', () => {
    const device = new Tcs34725();
    pointAt(device, 0x12);
    expect(device.read(1)).toEqual([0x44]);
  });

  it('reports all four channels', () => {
    const device = new Tcs34725();
    let red = 1000, green = 2000, blue = 1500, clear = 4500;
    device.setSource(() => ({ red, green, blue, clear }));

    pointAt(device, 0x14);
    expect(device.read(2)).toEqual([clear & 0xff, (clear >> 8) & 0xff]);

    pointAt(device, 0x16);
    expect(device.read(2)).toEqual([red & 0xff, (red >> 8) & 0xff]);

    pointAt(device, 0x18);
    expect(device.read(2)).toEqual([green & 0xff, (green >> 8) & 0xff]);

    pointAt(device, 0x1a);
    expect(device.read(2)).toEqual([blue & 0xff, (blue >> 8) & 0xff]);
  });

  it('exposes all four channels as knobs', () => {
    expect(TCS34725_RED_KNOB).toMatchObject({ id: 'red', min: 0, max: 65535 });
    expect(TCS34725_GREEN_KNOB).toMatchObject({ id: 'green', min: 0, max: 65535 });
    expect(TCS34725_BLUE_KNOB).toMatchObject({ id: 'blue', min: 0, max: 65535 });
    expect(TCS34725_CLEAR_KNOB).toMatchObject({ id: 'clear', min: 0, max: 65535 });
  });
});

describe('the TCS34725 module', () => {
  const definition = tcs34725Definition();

  it('is a four-pin I2C sensor', () => {
    expect(definition.component).toEqual({ kind: 'i2c-sensor', device: 'tcs34725' });
    expect(definition.pins.map((pin) => pin.id)).toEqual(['GND', 'VCC', 'SDA', 'SCL']);
  });

  it('carries its four channel controls', () => {
    expect(definition.knobs).toContainEqual(TCS34725_RED_KNOB);
    expect(definition.knobs).toContainEqual(TCS34725_GREEN_KNOB);
    expect(definition.knobs).toContainEqual(TCS34725_BLUE_KNOB);
    expect(definition.knobs).toContainEqual(TCS34725_CLEAR_KNOB);
  });
});
