import { describe, expect, it } from 'vitest';
import { max6675Definition, Max6675 } from './max6675';

/** The sixteen bits a sketch reads, as the chip counts them. */
function read(display: Max6675): number {
  const high = display.receive();
  const low = display.receive();
  return ((high << 8) | low) >> 3;
}

describe('the MAX6675', () => {
  it('hands back the probe temperature in quarter-degree steps', () => {
    const display = new Max6675();
    display.setTemperature(25);
    expect(read(display) * 0.25).toBe(25);
  });

  it('rounds to what the wire can tell it', () => {
    const display = new Max6675();
    display.setTemperature(24.9);
    expect(read(display) * 0.25).toBe(25);
  });

  it('keeps the reading to twelve bits', () => {
    const display = new Max6675();
    display.setTemperature(1024);
    expect(read(display) * 0.25).toBe(1023.75);
  });

  it('starts over at the beginning of a transaction', () => {
    const display = new Max6675();
    display.setTemperature(100);
    read(display);
    display.endTransaction();
    expect(read(display) * 0.25).toBe(100);
  });
});

describe('the MAX6675 module', () => {
  it('is a sensor with the chip\u2019s own line names', () => {
    const definition = max6675Definition();
    expect(definition.component).toEqual({ kind: 'thermocouple' });
    expect(definition.pins.map((pin) => pin.id)).toEqual([
      'VCC',
      'GND',
      'CS',
      'SCLK',
      'SDI',
      'SDO',
    ]);
    expect(definition.knobs?.map((knob) => knob.id)).toEqual(['probe']);
  });
});
