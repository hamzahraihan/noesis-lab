/**
 * Digital multimeter.
 *
 * A DMM is not a passive probe, and pretending otherwise would teach the wrong
 * lesson. In volts mode it has effectively infinite impedance and changes
 * nothing. In amps mode it *becomes* the circuit -- a low-resistance shunt in
 * series -- so measuring current across a rail is a short circuit, exactly as on
 * real hardware. In ohms mode it removes the circuit's own power and drives its
 * test current through whatever is between the probes, so reading a resistance
 * on a live circuit gives a number, and a wrong one.
 *
 * Those three failures are the reason this is modelled rather than faked.
 */

import { GROUND, type Element } from './elements';

export type MeterMode = 'volts' | 'amps' | 'ohms';

export interface AmpRange {
  readonly id: string;
  readonly label: string;
  /** Burden resistance in series with the circuit, ohms. */
  readonly shuntOhms: number;
  /** Full-scale current this range survives, amps. */
  readonly fullScaleAmps: number;
}

export interface OhmRange {
  readonly id: string;
  readonly label: string;
  /** Test current pushed between the probes, amps. */
  readonly testAmps: number;
  /** Highest voltage the meter can develop before giving up, volts. */
  readonly complianceVolts: number;
}

export const AMP_RANGES: readonly AmpRange[] = [
  // 1 Ohm gives a 200 mV burden at full scale; 10 mOhm gives 20 mV.
  { id: 'ma', label: '200 mA', shuntOhms: 1, fullScaleAmps: 0.2 },
  { id: 'a', label: '2 A', shuntOhms: 0.01, fullScaleAmps: 2 },
];

export const OHM_RANGES: readonly OhmRange[] = [
  { id: 'r200', label: '200 Ω', testAmps: 0.001, complianceVolts: 0.2 },
  { id: 'r20k', label: '20 kΩ', testAmps: 0.0001, complianceVolts: 2 },
];

/** Input impedance of a DMM in volts mode, ohms. */
export const VOLT_IMPEDANCE_OHMS = 10e6;

export interface MeterReading {
  readonly value: number;
  readonly unit: string;
  /** False when the meter cannot make a trustworthy measurement. */
  readonly valid: boolean;
  readonly note?: string;
}

export class Multimeter {
  mode: MeterMode = 'volts';
  ampRange = AMP_RANGES[0];
  ohmRange = OHM_RANGES[0];

  /** Net the red probe touches; `GROUND` when it is on the bench ground. */
  redNet: number = GROUND;
  /** Net the black probe touches. */
  blackNet: number = GROUND;

  setProbes(redNet: number, blackNet: number): void {
    this.redNet = redNet;
    this.blackNet = blackNet;
  }

  get probesTouchingTheSameNet(): boolean {
    return this.redNet === this.blackNet;
  }

  /**
   * The element this meter contributes to the circuit, or null when it is
   * effectively invisible.
   *
   * A voltmeter loads the circuit slightly, which is why the input impedance is
   * modelled rather than omitted: a 10 MOhm probe does pull a real pin down,
   * and that is a genuine thing to be able to observe.
   */
  stamp(): Element | null {
    if (this.probesTouchingTheSameNet) return null;

    switch (this.mode) {
      case 'volts':
        return {
          kind: 'resistor',
          a: this.redNet,
          b: this.blackNet,
          ohms: VOLT_IMPEDANCE_OHMS,
          label: 'meter input',
        };
      case 'amps':
        return {
          kind: 'resistor',
          a: this.redNet,
          b: this.blackNet,
          ohms: this.ampRange.shuntOhms,
          label: 'meter shunt',
        };
      case 'ohms':
        // Drives its test current out of the red probe and back through the
        // black one, so the unknown sits at a positive potential between them.
        return {
          kind: 'currentSource',
          a: this.redNet,
          b: this.blackNet,
          amps: this.ohmRange.testAmps,
          label: 'meter test current',
        };
    }
  }

  /** What the display would show, given the solved circuit. */
  read(voltageOf: (net: number) => number): MeterReading {
    const volts = voltageOf(this.redNet) - voltageOf(this.blackNet);
    switch (this.mode) {
      case 'volts':
        return { value: volts, unit: 'V', valid: true };

      case 'amps': {
        if (this.probesTouchingTheSameNet) {
          return {
            value: 0,
            unit: 'A',
            valid: false,
            note: 'probes on the same net',
          };
        }
        const current = volts / this.ampRange.shuntOhms;
        if (Math.abs(current) > this.ampRange.fullScaleAmps) {
          return { value: current, unit: 'A', valid: false, note: 'over range' };
        }
        return { value: current, unit: 'A', valid: true };
      }

      case 'ohms': {
        if (this.probesTouchingTheSameNet) {
          return { value: 0, unit: 'Ω', valid: false, note: 'probes shorted' };
        }
        // Above the compliance voltage the meter cannot push its test current,
        // so it reports nothing rather than inventing a resistance.
        if (Math.abs(volts) > this.ohmRange.complianceVolts) {
          return {
            value: Number.NaN,
            unit: 'Ω',
            valid: false,
            note: 'over range — is the circuit powered?',
          };
        }
        return { value: volts / this.ohmRange.testAmps, unit: 'Ω', valid: true };
      }
    }
  }
}
