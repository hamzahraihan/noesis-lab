import { describe, expect, it } from 'vitest';
import { BH1750_ADDRESS, BH1750_LIGHT_KNOB, Bh1750, type Bh1750Resolution } from './bh1750';
import { bh1750Definition } from './sensors';

/** Sends a command the way a sketch's Wire transmission delivers it. */
function command(device: Bh1750, ...bytes: readonly number[]): void {
  bytes.forEach((byte, index) => device.receive(byte, index === 0));
}

/** The raw count the chip reports for a light level at one resolution. */
function countsFor(lux: number, resolution: Bh1750Resolution): number {
  if (resolution === 'high2') return Math.min(0xffff, Math.max(0, Math.round(lux * 2.4)));
  // The low-resolution mode has the same scale but only changes in 4 lx steps.
  const measured = resolution === 'low' ? Math.round(lux / 4) * 4 : lux;
  return Math.min(0xffff, Math.max(0, Math.round(measured * 1.2)));
}

describe('BH1750 light sensor', () => {
  it('answers at 0x23', () => {
    expect(new Bh1750().address).toBe(BH1750_ADDRESS);
    expect(BH1750_ADDRESS).toBe(0x23);
  });

  it('measures the light the operator dialled in, in the selected resolution', () => {
    const device = new Bh1750();
    let lux = 250;
    device.setLightSource(() => lux);

    command(device, 0x01, 0x10);
    const high = countsFor(250, 'high');
    expect(high).toBe(300);
    expect(device.read(2)).toEqual([high >> 8, high & 0xff]);

    // The operator turns the light up, and the next read sees it: a continuous
    // measurement is the chip's current answer, not a pushed value.
    lux = 500;
    const brighter = countsFor(500, 'high');
    expect(device.read(2)).toEqual([brighter >> 8, brighter & 0xff]);

    command(device, 0x11);
    const high2 = countsFor(500, 'high2');
    expect(device.read(2)).toEqual([high2 >> 8, high2 & 0xff]);

    // Low resolution trades the finer scale for a faster conversion: the same
    // light is only resolved to the nearest four lux.
    lux = 250;
    command(device, 0x13);
    const low = countsFor(250, 'low');
    expect(low).toBe(302);
    expect(device.read(2)).toEqual([low >> 8, low & 0xff]);
  });

  it('takes one measurement and holds it when the command is one-shot', () => {
    const device = new Bh1750();
    let lux = 100;
    device.setLightSource(() => lux);

    command(device, 0x20);
    const first = countsFor(100, 'high');
    expect(device.read(2)).toEqual([first >> 8, first & 0xff]);

    // A one-shot is a measurement, not a subscription: the next read is the
    // same result until another command starts a new one.
    lux = 900;
    expect(device.read(2)).toEqual([first >> 8, first & 0xff]);

    command(device, 0x20);
    const second = countsFor(900, 'high');
    expect(device.read(2)).toEqual([second >> 8, second & 0xff]);
  });

  it('stops measuring in power-down and clears the result on reset', () => {
    const device = new Bh1750();
    let lux = 200;
    device.setLightSource(() => lux);

    command(device, 0x10);
    const before = countsFor(200, 'high');
    expect(device.read(2)).toEqual([before >> 8, before & 0xff]);

    command(device, 0x00);
    lux = 800;
    expect(device.read(2), 'power-down retains the last result').toEqual([
      before >> 8,
      before & 0xff,
    ]);

    command(device, 0x07);
    expect(device.read(2), 'reset clears the data register').toEqual([0, 0]);

    command(device, 0x10);
    const after = countsFor(800, 'high');
    expect(device.read(2)).toEqual([after >> 8, after & 0xff]);
  });

  it('saturates at the ends of its sixteen-bit count', () => {
    const device = new Bh1750();
    let lux = 200_000;
    device.setLightSource(() => lux);
    command(device, 0x10);
    expect(device.read(2)).toEqual([0xff, 0xff]);

    lux = -50;
    expect(device.read(2)).toEqual([0, 0]);
  });

  it('repeats the last byte for a read longer than its two-byte frame', () => {
    const device = new Bh1750();
    device.setLightSource(() => 250);
    command(device, 0x10);
    expect(device.read(5)).toEqual([0x01, 0x2c, 0x2c, 0x2c, 0x2c]);
  });

  it('exposes the light level as a knob in lux', () => {
    expect(BH1750_LIGHT_KNOB).toMatchObject({
      id: 'light',
      unit: 'lx',
      min: 0,
      max: 10_000,
    });
  });
});

describe('the BH1750 module', () => {
  const definition = bh1750Definition();

  it('is a four-pin I2C sensor', () => {
    expect(definition.component).toEqual({ kind: 'i2c-sensor', device: 'bh1750' });
    expect(definition.pins.map((pin) => pin.id)).toEqual(['GND', 'VCC', 'SDA', 'SCL']);
  });

  it('carries its light control', () => {
    expect(definition.knobs).toContainEqual(BH1750_LIGHT_KNOB);
  });
});
