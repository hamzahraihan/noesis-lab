/**
 * DS18B20 temperature sensor: three leads, one wire, and a temperature.
 *
 * The part is the chip on its little breakout: a three-pin module with the
 * sensor's flat face toward the header, and the data line on the middle pin.
 *
 * The one-wire waveform is deliberately not modelled, the same way the DHT's
 * is not: the part reports through the `onewire` firmware port, the way a
 * servo reports an angle rather than a pulse train. What the part does carry
 * is the one thing a sketch can ask it for -- the temperature -- and the
 * twelve-bit resolution it converts it in.
 */
import type { KnobSpec, PartDefinition } from '@/features/parts';

/**
 * The temperature the sensor is reporting, in degrees Celsius.
 *
 * The DS18B20's own range is -55 to +125, which is wider than the DHT's, and
 * the step is the chip's: a twelfth of a degree, the resolution it converts
 * at.
 */
export const DS18B20_TEMPERATURE_KNOB: KnobSpec = {
  id: 'temperature',
  label: 'Temperature',
  min: -55,
  max: 125,
  step: 0.0625,
  unit: '°C',
  defaultValue: 22,
};

export function ds18b20Definition(): PartDefinition {
  return {
    id: 'ds18b20',
    name: 'DS18B20 Temperature Sensor',
    category: 'input',
    widthMm: 12.7,
    heightMm: 12.7,
    component: { kind: 'ds18b20' },
    pins: [
      // The header's order is the chip's: ground, data, supply, as they sit
      // along the flat face of the package.
      { id: 'GND', label: 'GND', x: 2.54, y: 10.16, net: 'GND' },
      { id: 'DQ', label: 'DQ', x: 5.08, y: 10.16 },
      { id: 'VCC', label: 'VCC', x: 7.62, y: 10.16 },
    ],
    knobs: [DS18B20_TEMPERATURE_KNOB],
    bodyColour: '#1b1d21',
    legendColour: '#e8e8e8',
  };
}
