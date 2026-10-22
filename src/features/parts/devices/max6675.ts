/**
 * MAX6675: a thermocouple amplifier with a shift register on the front.
 *
 * The chip reads a K-type thermocouple and hands the reading out as sixteen
 * bits: four status bits and a temperature in quarter-degree steps. The
 * reading comes back over the same bus the command goes out on, which is why
 * this part is the second thing on the bench that *answers* over SPI -- the
 * MFRC522 reader was the first, and the bus grew a return path for it.
 *
 * The bench models the chip, not the probe. A thermocouple is a junction of
 * two metals whose voltage depends on the temperature at the hot end, and
 * that is a physical fact about a wire rather than something a chip can be
 * asked about. So the probe's temperature is a knob, and the chip reads it
 * the way it would read a probe: in quarter-degree steps, rounded to what the
 * wire can tell it.
 *
 * The status bits are not modelled: the bench does not model a thermocouple
 * that has come loose, and the bits are all zero on a healthy read.
 */

import type { KnobSpec, PartDefinition } from '../catalog';

/** The probe's temperature, in degrees Celsius. */
export const MAX6675_TEMPERATURE_KNOB: KnobSpec = {
  id: 'probe',
  label: 'Probe',
  min: 0,
  max: 500,
  step: 1,
  defaultValue: 25,
  unit: 'C',
};

/** How many quarter-degrees one bit is worth. */
const STEP = 0.25;

/**
 * The chip's shift register.
 *
 * Sixteen bits go out, most significant first, and the answer is the
 * temperature the probe is at -- so the model holds the reading and hands it
 * out one byte at a time, the way the chip does.
 */
export class Max6675 {
  /** The reading, as the chip counts it: quarter-degrees in twelve bits. */
  private raw = 0;
  /** How many bytes have gone out since the transaction began. */
  private sent = 0;

  /** The probe's temperature, in degrees Celsius. */
  setTemperature(celsius: number): void {
    const steps = Math.round(celsius / STEP);
    this.raw = Math.max(0, Math.min(0xfff, steps));
  }

  /**
   * One byte out of the chip.
   *
   * The first byte is the top half of the reading, with the status bits
   * above it; the second is the bottom half. The chip shifts the same bits
   * out again after that, so a third byte is the low half once more.
   */
  receive(): number {
    const byte = this.sent === 0 ? this.raw >> 5 : (this.raw & 0x1f) << 3;
    this.sent += 1;
    return byte;
  }

  /**
   * The chip-select rise: the shift register is loaded again.
   *
   * The counter is the chip's own: a new transaction starts at the top of the
   * reading, the way the chip reloads when the converter is triggered.
   */
  endTransaction(): void {
    this.sent = 0;
  }
}

/**
 * The module as it is sold: a small board with the chip on it and a screw
 * terminal for the probe.
 */
export function max6675Definition(): PartDefinition {
  return {
    id: 'max6675',
    name: 'Thermocouple (MAX6675)',
    category: 'input',
    widthMm: 25.4,
    heightMm: 20.32,
    component: { kind: 'thermocouple' },
    pins: [
      { id: 'VCC', label: 'VCC', x: 2.54, y: 4.0, net: 'VCC' },
      { id: 'GND', label: 'GND', x: 5.08, y: 4.0, net: 'GND' },
      { id: 'CS', label: 'CS', x: 7.62, y: 4.0 },
      { id: 'SCLK', label: 'SCLK', x: 10.16, y: 4.0 },
      { id: 'SDI', label: 'SDI', x: 12.70, y: 4.0 },
      { id: 'SDO', label: 'SDO', x: 15.24, y: 4.0 },
    ],
    knobs: [MAX6675_TEMPERATURE_KNOB],
    bodyColour: '#111827',
    legendColour: '#e5e7eb',
  };
}
