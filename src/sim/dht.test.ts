import { describe, expect, it } from 'vitest';
import { HUMIDITY_KNOB, dhtDefinition } from './dht';
import { TEMPERATURE_KNOB } from './modules';

describe('dht definition', () => {
  it('exposes VCC/SDA/NC/GND with climate knobs', () => {
    const def = dhtDefinition();
    expect(def.pins.map((p) => p.id)).toEqual(['VCC', 'SDA', 'NC', 'GND']);
    expect(def.knobs).toEqual([TEMPERATURE_KNOB, HUMIDITY_KNOB]);
    expect([def.widthMm, def.heightMm]).toEqual([15.1, 30.885]);
  });
});
