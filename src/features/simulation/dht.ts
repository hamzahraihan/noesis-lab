/**
 * DHT22 temperature/humidity sensor: climate knobs behind a one-wire header.
 *
 * Pin positions are the element's `pinInfo` in CSS pixels at 96 per inch,
 * converted to millimetres: a bottom-edge row at y 114.9 px, snapped to
 * the 2.54 mm grid the breadboard modules use. `NC` is a real position
 * with no circuit behind it, so a jumper clipped there reads floating,
 * exactly as on hardware.
 *
 * The single-wire waveform is deliberately not modeled: the part reports
 * through the `dht` firmware port, the way a servo reports an angle
 * rather than a pulse train.
 */

import type { KnobSpec, PartDefinition } from '@/sim/catalog';
import { TEMPERATURE_KNOB } from '@/sim/modules';

/** Relative humidity in percent, the unit its datasheet works in. */
export const HUMIDITY_KNOB: KnobSpec = {
  id: 'humidity',
  label: 'Humidity',
  min: 0,
  max: 100,
  step: 1,
  unit: '%',
  defaultValue: 50,
};

export function dhtDefinition(): PartDefinition {
  return {
    id: 'dht22-temp-humidity',
    name: 'DHT22 Temp/Humidity',
    category: 'input',
    widthMm: 15.1,
    heightMm: 30.885,
    component: { kind: 'dht' },
    pins: [
      { id: 'VCC', label: 'VCC', x: 3.97, y: 30.39 },
      { id: 'SDA', label: 'SDA', x: 6.48, y: 30.39 },
      { id: 'NC', label: 'NC', x: 9.02, y: 30.39 },
      { id: 'GND', label: 'GND', x: 11.59, y: 30.39, net: 'GND' },
    ],
    knobs: [TEMPERATURE_KNOB, HUMIDITY_KNOB],
    bodyColour: '#e8e5db',
    legendColour: '#1b1d21',
  };
}
