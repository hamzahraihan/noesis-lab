/**
 * A4988: a stepper driver with a translator behind it.
 *
 * The chip's whole idea is that a sketch does not have to know the phase
 * sequence: a pulse on STEP moves the motor one step, DIR says which way,
 * and the driver works out which windings to energise. That is the part a
 * learner meets -- a motor driven from two pins instead of four, and a
 * sketch that never writes a phase table.
 *
 * The excitation modelled here is the chip's full-step pattern: four
 * states, each with one winding driven forward and the other driven back,
 * and the states walk the Gray cycle the bench's motor already follows.
 *
 * The microstep modes are not modelled, and the reason is the motor rather
 * than the chip: a microstep drives one winding at a *reduced current*
 * instead of reversing it, while the bench's motor follows the polarity
 * across a winding. A fine mode would therefore move the motor by whole
 * steps or not at all, and the current regulation that makes a microstep
 * real is a chopper the bench's linear solver cannot carry. The
 * microstep-select pins are on the part because the module has them, and
 * the model reads them; a sketch that wants the full step the bench
 * models wires them low, which is the chip's full-step setting.
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
}

/**
 * The driver's translator.
 *
 * The state is the position in the full-step cycle, and everything else is
 * the chip's housekeeping: the lines that turn the outputs off, and the
 * edge on STEP that the translator counts.
 */
export class A4988 {
  /** Where in the full-step cycle the translator stands. */
  private phase = 0;
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
   * stream of them.
   */
  setInputs(inputs: A4988Inputs): void {
    const rising = inputs.step && !this.previousStep;
    this.previousStep = inputs.step;
    // The enable, reset and sleep lines are all active low.
    this.enabled = !inputs.enable;
    this.asleep = !inputs.sleep;
    this.inReset = !inputs.reset;
    if (this.asleep || this.inReset) {
      // The chip parks at its home position with the outputs off.
      this.phase = 0;
      return;
    }
    if (!this.enabled || !rising) return;
    this.phase = (this.phase + (inputs.dir ? 1 : FULL_STEP.length - 1)) % FULL_STEP.length;
  }

  /** The level an output is driving. */
  output(pin: '1A' | '1B' | '2A' | '2B'): boolean {
    if (!this.enabled || this.asleep || this.inReset) return false;
    const state = FULL_STEP[this.phase] ?? FULL_STEP[0]!;
    switch (pin) {
      case '1A':
        return state[0];
      case '1B':
        return state[1];
      case '2A':
        return state[2];
      case '2B':
        return state[3];
      default:
        return false;
    }
  }

  /** Where in the full-step cycle the translator stands, for a renderer. */
  get position(): number {
    return this.phase;
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
