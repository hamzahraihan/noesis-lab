import { describe, expect, it } from 'vitest';
import { MLX90614_AMBIENT_KNOB, MLX90614_OBJECT_KNOB, Mlx90614 } from './mlx90614';

describe('MLX90614 IR temperature sensor', () => {
  it('reports ambient temperature as a raw word', () => {
    const sensor = new Mlx90614();
    sensor.setConditionsSource(() => ({ ambient: 21, object: 30 }));
    // Write register address 0x06
    sensor.receive(0x06, true);
    const bytes = sensor.read(3);
    // 21 °C = (21 + 273.15) / 0.02 = 14707.5 → 14708 → 0x3974
    const raw = bytes[0]! | (bytes[1]! << 8);
    const celsius = raw * 0.02 - 273.15;
    expect(celsius).toBeCloseTo(21, 0);
  });

  it('reports object temperature as a raw word', () => {
    const sensor = new Mlx90614();
    sensor.setConditionsSource(() => ({ ambient: 21, object: 50 }));
    sensor.receive(0x07, true);
    const bytes = sensor.read(3);
    const raw = bytes[0]! | (bytes[1]! << 8);
    const celsius = raw * 0.02 - 273.15;
    expect(celsius).toBeCloseTo(50, 0);
  });

  it('knobs carry the sensor range', () => {
    expect(MLX90614_AMBIENT_KNOB).toMatchObject({
      id: 'ambient',
      label: 'Ambient temperature',
      min: -40,
      max: 125,
      step: 0.1,
      unit: '°C',
      defaultValue: 21,
    });
    expect(MLX90614_OBJECT_KNOB).toMatchObject({
      id: 'object',
      label: 'Object temperature',
      min: -70,
      max: 380,
      step: 0.1,
      unit: '°C',
      defaultValue: 30,
    });
  });

});
