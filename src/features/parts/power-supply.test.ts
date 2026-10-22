import { describe, expect, it } from 'vitest';
import { powerSupplyDefinition, SUPPLY_VOLTAGE_KNOB } from './power-supply';

describe('the bench supply', () => {
  it('is a source with two terminals', () => {
    const definition = powerSupplyDefinition();
    expect(definition.component).toEqual({ kind: 'power-supply' });
    expect(definition.pins.map((pin) => pin.id)).toEqual(['V+', 'GND']);
    // The ground terminal is the bench's own ground, so a part wired to it
    // shares the board's ground.
    expect(definition.pins[1]?.net).toBe('GND');
  });

  it('is turned to a voltage the operator chooses', () => {
    expect(SUPPLY_VOLTAGE_KNOB.id).toBe('volts');
    expect(SUPPLY_VOLTAGE_KNOB.max).toBe(12);
    expect(powerSupplyDefinition().knobs).toEqual([SUPPLY_VOLTAGE_KNOB]);
  });
});
