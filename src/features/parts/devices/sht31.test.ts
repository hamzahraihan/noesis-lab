import { describe, expect, it } from 'vitest';
import {
  SHT31_ADDRESS,
  SHT31_HUMIDITY_KNOB,
  SHT31_TEMPERATURE_KNOB,
  Sht31,
  sht31Crc8,
} from './sht31';
import { sht31Definition } from './sensors';

/** Sends a sixteen-bit command the way a Wire transmission delivers it. */
function command(device: Sht31, command: number): void {
  device.receive((command >> 8) & 0xff, true);
  device.receive(command & 0xff, false);
}

/** The raw word the sensor reports for a temperature. */
function rawTemperature(celsius: number): number {
  return Math.min(0xffff, Math.max(0, Math.round(((celsius + 45) * 0xffff) / 175)));
}

/** The raw word the sensor reports for a relative humidity. */
function rawHumidity(percent: number): number {
  return Math.min(0xffff, Math.max(0, Math.round((percent * 0xffff) / 100)));
}

/** A six-byte frame split into its three bytes per measurement. */
function frame(device: Sht31): {
  temperature: readonly number[];
  humidity: readonly number[];
} {
  const bytes = device.read(6);
  return { temperature: bytes.slice(0, 3), humidity: bytes.slice(3, 6) };
}

describe('SHT31 temperature and humidity sensor', () => {
  it('answers at 0x44', () => {
    expect(new Sht31().address).toBe(SHT31_ADDRESS);
    expect(SHT31_ADDRESS).toBe(0x44);
  });

  it('computes the datasheet CRC over a word', () => {
    // Sensirion's own worked example.
    expect(sht31Crc8([0xbe, 0xef])).toBe(0x92);
  });

  it('returns a frame that fails its CRC before a measurement', () => {
    const device = new Sht31();
    const bytes = device.read(6);
    expect(bytes).toHaveLength(6);
    expect(bytes.every((byte) => byte === 0xff)).toBe(true);
    // 0xFF is not the CRC of 0xFF,0xFF, so a sketch that checks the CRC can
    // tell "no measurement" from a reading.
    expect(sht31Crc8(bytes.slice(0, 2))).not.toBe(bytes[2]);
  });

  it('reports temperature and humidity with a CRC per word', () => {
    const device = new Sht31();
    device.setConditionsSource(() => ({ celsius: 21, humidity: 45 }));
    command(device, 0x24_00);

    const words = frame(device);
    expect(words.temperature.slice(0, 2)).toEqual([0x60, 0x8c]);
    expect(words.humidity.slice(0, 2)).toEqual([0x73, 0x33]);
    expect(words.temperature[2]).toBe(sht31Crc8(words.temperature.slice(0, 2)));
    expect(words.humidity[2]).toBe(sht31Crc8(words.humidity.slice(0, 2)));
  });

  it('accepts the clock-stretching and non-stretching single-shot commands', () => {
    const device = new Sht31();
    device.setConditionsSource(() => ({ celsius: 5, humidity: 80 }));

    command(device, 0x2c_06);
    expect(frame(device).temperature.slice(0, 2)).toEqual([
      rawTemperature(5) >> 8,
      rawTemperature(5) & 0xff,
    ]);

    command(device, 0x24_00);
    expect(frame(device).humidity.slice(0, 2)).toEqual([
      rawHumidity(80) >> 8,
      rawHumidity(80) & 0xff,
    ]);
  });

  it('holds the measurement until another command asks for a fresh one', () => {
    const device = new Sht31();
    let celsius = 21;
    let humidity = 45;
    device.setConditionsSource(() => ({ celsius, humidity }));

    command(device, 0x24_00);
    const first = frame(device);
    expect(first.temperature.slice(0, 2)).toEqual([0x60, 0x8c]);

    celsius = 30;
    humidity = 60;
    expect(frame(device).temperature, 'a read is not a new conversion').toEqual(first.temperature);

    command(device, 0x24_00);
    expect(frame(device).temperature.slice(0, 2)).toEqual([
      rawTemperature(30) >> 8,
      rawTemperature(30) & 0xff,
    ]);
  });

  it('warms the die while the heater is on, and forgets everything on reset', () => {
    const device = new Sht31();
    device.setConditionsSource(() => ({ celsius: 21, humidity: 40 }));

    command(device, 0x24_00);
    const cold = frame(device).temperature.slice(0, 2);

    command(device, 0x30_a2);
    command(device, 0x24_00);
    const warm = frame(device).temperature.slice(0, 2);
    expect(warm).not.toEqual(cold);
    expect(warm).toEqual([rawTemperature(22) >> 8, rawTemperature(22) & 0xff]);

    command(device, 0x27_37);
    expect(device.read(6).every((byte) => byte === 0xff)).toBe(true);
    // The reset also turned the heater off: the next reading is back to the
    // ambient temperature the operator dialled in.
    command(device, 0x24_00);
    expect(frame(device).temperature.slice(0, 2)).toEqual(cold);

    // The off command has to undo the on command, not merely be acknowledged.
    command(device, 0x30_a2);
    command(device, 0x24_00);
    expect(frame(device).temperature.slice(0, 2)).toEqual(warm);
    command(device, 0x30_6d);
    command(device, 0x24_00);
    expect(frame(device).temperature.slice(0, 2)).toEqual(cold);
  });

  it('does not execute a command until both bytes have arrived', () => {
    const device = new Sht31();
    device.setConditionsSource(() => ({ celsius: 21, humidity: 45 }));
    device.receive(0x24, true);
    expect(device.read(6).every((byte) => byte === 0xff)).toBe(true);

    device.receive(0x00, false);
    expect(frame(device).temperature.slice(0, 2)).toEqual([0x60, 0x8c]);
  });

  it('clamps conversions to the ends of the sixteen-bit range', () => {
    const device = new Sht31();
    let celsius = 200;
    let humidity = 150;
    device.setConditionsSource(() => ({ celsius, humidity }));
    command(device, 0x24_00);
    expect(frame(device).temperature.slice(0, 2)).toEqual([0xff, 0xff]);
    expect(frame(device).humidity.slice(0, 2)).toEqual([0xff, 0xff]);

    celsius = -100;
    humidity = -5;
    command(device, 0x24_00);
    expect(frame(device).temperature.slice(0, 2)).toEqual([0x00, 0x00]);
    expect(frame(device).humidity.slice(0, 2)).toEqual([0x00, 0x00]);
  });

  it('exposes temperature and humidity knobs', () => {
    expect(SHT31_TEMPERATURE_KNOB).toMatchObject({ id: 'temperature', unit: '°C' });
    expect(SHT31_HUMIDITY_KNOB).toMatchObject({
      id: 'humidity',
      unit: '%',
      min: 0,
      max: 100,
    });
  });
});

describe('the SHT31 module', () => {
  const definition = sht31Definition();

  it('is a four-pin I2C sensor', () => {
    expect(definition.component).toEqual({ kind: 'i2c-sensor', device: 'sht31' });
    expect(definition.pins.map((pin) => pin.id)).toEqual(['GND', 'VCC', 'SDA', 'SCL']);
  });

  it('carries both of its controls', () => {
    expect(definition.knobs).toEqual(
      expect.arrayContaining([SHT31_TEMPERATURE_KNOB, SHT31_HUMIDITY_KNOB]),
    );
  });
});
