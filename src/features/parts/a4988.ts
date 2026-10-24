/**
 * A4988: a stepper driver with a translator behind it.
 *
 * The chip's whole idea is that a sketch does not have to know the phase
 * sequence: a pulse on STEP moves the motor one step, DIR says which way,
 * and the driver works out which windings to energise. That is the part a
 * learner meets -- a motor driven from two pins instead of four, and a
 * sketch that never writes a phase table.
 *
 * The full-step excitation is four states, each with one winding driven
 * forward and the other driven back, and the states walk the Gray cycle the
 * bench's motor already follows.
 *
 * The fine modes are modelled as average output levels rather than a
 * switch-level chopper. Each full bridge's high-side duty follows the
 * sine/cosine current the datasheet's table asks for, so the two winding
 * voltages carry a phase vector the motor can follow between the full-step
 * positions. The high-frequency chopper, its decay modes and the VREF current
 * limit are outside the linear solver; the average is the model.
 *
 * The enable, reset and sleep lines are all active low, and each of them
 * turns the outputs off: the chip's FETs go high-impedance rather than
 * driving, and the winding holds its position.
 */

import type { PartDefinition, PinSpec } from './catalog';

/**
 * The output stage, in ohms.
 *
 * The datasheet has the FETs at 320 milliohms each, and that is what
 * stands between the supply and a winding: the difference between the
 * two ends of a winding is the supply less what the driver drops.
 */
export const A4988_OUTPUT_OHMS = 0.32;

/** The resolutions the MS pins select, in microsteps per full step. */
export type MicrostepMode = 1 | 2 | 4 | 8 | 16;

/** Every resolution the chip offers, from the coarsest to the finest. */
export const MICROSTEP_MODES: readonly MicrostepMode[] = [1, 2, 4, 8, 16];

/**
 * The resolution the MS pins ask for.
 *
 * The datasheet defines five combinations. The others are not defined, so
 * they fall back to full step rather than guessing at a mode the chip does
 * not promise.
 */
export function microstepsFor(ms1: boolean, ms2: boolean, ms3: boolean): MicrostepMode {
  if (ms3) return ms1 && ms2 ? 16 : 1;
  if (ms2) return ms1 ? 8 : 4;
  return ms1 ? 2 : 1;
}

/** One electrical cycle is four full steps; one full step is 90 degrees. */
const ELECTRICAL_DEGREES_PER_STEP = 90;

/** The home state sits half a step before the first full-step state. */
const HOME_ANGLE_DEGREES = -45;

/** The four outputs, in the order the module's motor header carries them. */
export type A4988OutputPin = '1A' | '1B' | '2A' | '2B';

/** The four outputs in header order, for callers that stamp all of them. */
export const A4988_OUTPUT_PINS: readonly A4988OutputPin[] = ['1A', '1B', '2A', '2B'];

/** The four full-step states, as the levels of 1A, 1B, 2A and 2B. */
const FULL_STEP: ReadonlyArray<readonly [boolean, boolean, boolean, boolean]> = [
  // A forward, B backward.
  [true, false, false, true],
  // Both forward.
  [true, false, true, false],
  // A backward, B forward.
  [false, true, true, false],
  // Both backward.
  [false, true, false, true],
];

/** The input lines a driver reads, as the bench sees them. */
export interface A4988Inputs {
  /** The step line: a rising edge moves the motor one step. */
  readonly step: boolean;
  /** The direction line: which way a step goes. */
  readonly dir: boolean;
  /** The enable line, active low: high turns the outputs off. */
  readonly enable: boolean;
  /** The reset line, active low: low parks the translator at home. */
  readonly reset: boolean;
  /** The sleep line, active low: low puts the chip to sleep. */
  readonly sleep: boolean;
  /**
   * The microstep-select lines. Absent means the module's pull-downs hold
   * them low, which is the chip's full-step setting.
   */
  readonly ms1?: boolean;
  readonly ms2?: boolean;
  readonly ms3?: boolean;
}

/**
 * The driver's translator.
 *
 * The state is the position in the full-step cycle, and everything else is
 * the chip's housekeeping: the lines that turn the outputs off, and the
 * edge on STEP that the translator counts.
 */
export class A4988 {
  /**
   * Where in the electrical cycle the translator stands, in 1/16-step
   * units. One electrical cycle is 64 of them.
   */
  private finePosition = 0;
  /** The resolution the last STEP edge selected. */
  private activeMicrosteps: MicrostepMode = 1;
  /** The resolution the MS pins are asking for now. */
  private pendingMicrosteps: MicrostepMode = 1;
  /** The step line's level last seen, so a rising edge can be told. */
  private previousStep = false;
  private enabled = true;
  private asleep = false;
  private inReset = false;

  /**
   * The input lines, read at the solve.
   *
   * The translator moves on a rising edge of STEP and nowhere else, so the
   * level is kept and compared: a line that stays high is one step, not a
   * stream of them. The MS pins are sampled every solve but only take effect
   * on the next edge, which is the datasheet's rule.
   */
  setInputs(inputs: A4988Inputs): void {
    const rising = inputs.step && !this.previousStep;
    this.previousStep = inputs.step;
    this.pendingMicrosteps = microstepsFor(
      inputs.ms1 ?? false,
      inputs.ms2 ?? false,
      inputs.ms3 ?? false,
    );
    // The enable, reset and sleep lines are all active low.
    this.enabled = !inputs.enable;
    this.asleep = !inputs.sleep;
    this.inReset = !inputs.reset;
    if (this.asleep || this.inReset) {
      // The chip parks at its home position with the outputs off. The pins
      // still say which resolution the parked translator should wake into.
      this.finePosition = 0;
      this.activeMicrosteps = this.pendingMicrosteps;
      return;
    }
    if (!this.enabled || !rising) return;
    this.activeMicrosteps = this.pendingMicrosteps;
    // Every mode divides 16, so a step is always a whole number of
    // sixteenths and the fine position stays exact.
    const stride = 16 / this.activeMicrosteps;
    this.finePosition = (this.finePosition + (inputs.dir ? stride : -stride) + 64) % 64;
  }

  /**
   * The high-side duty an output is driving, from 0 to 1.
   *
   * Full step is the existing binary waveform. A fine mode is the chip's
   * sine table turned into a pair of bridge duties: the positive end of a
   * winding carries `(1 + current) / 2`, the negative end `(1 - current) / 2`.
   */
  duty(pin: A4988OutputPin): number {
    if (!this.enabled || this.asleep || this.inReset) return 0;
    if (this.activeMicrosteps === 1) {
      const state = FULL_STEP[this.position] ?? FULL_STEP[0]!;
      const index = A4988_OUTPUT_PINS.indexOf(pin);
      return state[index] ? 1 : 0;
    }
    const degrees = HOME_ANGLE_DEGREES + this.finePosition * (ELECTRICAL_DEGREES_PER_STEP / 16);
    const radians = (degrees * Math.PI) / 180;
    const a = Math.cos(radians);
    const b = Math.sin(radians);
    switch (pin) {
      case '1A':
        return (1 + a) / 2;
      case '1B':
        return (1 - a) / 2;
      case '2A':
        return (1 + b) / 2;
      case '2B':
        return (1 - b) / 2;
      default:
        return 0;
    }
  }

  /** The level an output is driving, as a binary view of its duty. */
  output(pin: A4988OutputPin): boolean {
    return this.duty(pin) > 0.5;
  }

  /** Where in the full-step cycle the translator stands, for a renderer. */
  get position(): number {
    return Math.floor(this.finePosition / 16) % 4;
  }

  /** The resolution the last STEP edge selected. */
  get microsteps(): MicrostepMode {
    return this.activeMicrosteps;
  }

  /** Where in the 1/16-step cycle the translator stands, for tests. */
  get microstepPosition(): number {
    return this.finePosition;
  }
}

/**
 * The module as it is sold: a black carrier with the driver in the middle,
 * a trim potentiometer for the current limit and the header along one edge.
 *
 * The header is four groups of four, the way the carrier carries them: the
 * motor's four leads, the supply, and the eight lines the driver takes.
 */
const A4988_PINS: ReadonlyArray<readonly [id: string, label: string]> = [
  ['1B', '1B'],
  ['1A', '1A'],
  ['2A', '2A'],
  ['2B', '2B'],
  ['VMOT', 'VMOT'],
  ['GND', 'GND'],
  ['GND2', 'GND'],
  ['VCC', 'VCC'],
  ['STEP', 'STEP'],
  ['DIR', 'DIR'],
  ['ENABLE', 'EN'],
  ['RESET', 'RST'],
  ['SLEEP', 'SLP'],
  ['MS1', 'MS1'],
  ['MS2', 'MS2'],
  ['MS3', 'MS3'],
];

export function a4988Definition(): PartDefinition {
  const pins: PinSpec[] = [];
  const pitch = 2.54;
  A4988_PINS.forEach(([id, label], index) => {
    pins.push({
      id,
      label,
      x: 3.8 + index * pitch,
      y: 38.0,
      net: id === 'GND' || id === 'GND2' ? 'GND' : id === 'VCC' ? '5V' : undefined,
    });
  });

  return {
    id: 'a4988',
    name: 'Stepper driver (A4988)',
    category: 'output',
    widthMm: 43.0,
    heightMm: 43.0,
    component: { kind: 'a4988' },
    pins,
    bodyColour: '#111827',
    legendColour: '#e5e7eb',
  };
}
