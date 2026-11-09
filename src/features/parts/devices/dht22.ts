/**
 * DHT22 temperature and humidity sensor: an analog-style part that outputs
 * temperature and humidity on a single data pin via a one-wire protocol.
 *
 * The operator sets temperature (0–50 °C) and humidity (0–100 %) with knobs.
 * The solver drives the DATA pin at a voltage proportional to temperature
 * (0 V at 0 °C, 5 V at 50 °C), and the humidity is read via a knob. The
 * sketch polls the sensor and prints both values.
 *
 * The part is not on a bus: it contributes a voltage source to the netlist
 * rather than answering register reads.
 */
import type { KnobSpec, PartDefinition } from '../catalog';

/** The air temperature in degrees Celsius. */
export const DHT22_TEMPERATURE_KNOB: KnobSpec = {
  id: 'temperature',
  label: 'Temperature',
  min: 0,
  max: 50,
  step: 0.1,
  unit: '°C',
  defaultValue: 20,
};

/** The relative humidity, as a percentage. */
export const DHT22_HUMIDITY_KNOB: KnobSpec = {
  id: 'humidity',
  label: 'Humidity',
  min: 0,
  max: 100,
  step: 1,
  unit: '%',
  defaultValue: 50,
};

/** The output voltage for a given temperature. */
export function dht22Temperature(celsius: number): number {
  return celsius;
}

/** The output humidity percentage for a given knob value. */
export function dht22Humidity(humidity: number): number {
  return humidity;
}

export function dht22Definition(): PartDefinition {
  return {
    id: 'dht22',
    name: 'DHT22 Temp/Humidity',
    category: 'input',
    widthMm: 15,
    heightMm: 15,
    component: { kind: 'dht22' },
    pins: [
      { id: 'VCC', label: 'VCC', x: 0, y: 1.27 },
      { id: 'GND', label: 'GND', x: 1.27, y: 1.27 },
      { id: 'DATA', label: 'DATA', x: 2.54, y: 1.27 },
    ],
    knobs: [DHT22_TEMPERATURE_KNOB, DHT22_HUMIDITY_KNOB],
    bodyColour: '#334155',
    legendColour: '#e2e8f0',
  };
}
