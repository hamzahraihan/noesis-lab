import { describe, expect, it } from 'vitest';
import { a4988Definition, A4988, microstepsFor } from './a4988';

/**
 * The lines a running driver sees: awake, enabled, no step pulse.
 *
 * The enable, reset and sleep lines are all active low, so a running chip
 * holds the enable line low and the other two high.
 */
const IDLE = {
  step: false,
  dir: true,
  enable: false,
  reset: true,
  sleep: true,
  ms1: false,
  ms2: false,
  ms3: false,
} as const;

/** The four output levels, as the bench reads them. */
function outputs(driver: A4988): string {
  return (['1A', '1B', '2A', '2B'] as const)
    .map((pin) => (driver.output(pin) ? '1' : '0'))
    .join('');
}

/** The four average duties, rounded to the datasheet's four places. */
function duties(driver: A4988): number[] {
  return (['1A', '1B', '2A', '2B'] as const).map((pin) => Number(driver.duty(pin).toFixed(4)));
}

describe('the A4988', () => {
  it('starts at its home position with the outputs driving', () => {
    const driver = new A4988();
    driver.setInputs(IDLE);
    expect(outputs(driver)).toBe('1001');
  });

  it('moves one step on the rising edge of STEP', () => {
    const driver = new A4988();
    driver.setInputs(IDLE);
    driver.setInputs({ ...IDLE, step: true });
    expect(outputs(driver)).toBe('1010');
  });

  it('counts one step for a line that stays high', () => {
    const driver = new A4988();
    driver.setInputs(IDLE);
    driver.setInputs({ ...IDLE, step: true });
    driver.setInputs({ ...IDLE, step: true });
    expect(outputs(driver)).toBe('1010');
  });

  it('goes the other way when DIR is low', () => {
    const driver = new A4988();
    driver.setInputs({ ...IDLE, dir: false });
    driver.setInputs({ ...IDLE, dir: false, step: true });
    expect(outputs(driver)).toBe('0101');
  });

  it('turns the outputs off while the enable line is high', () => {
    const driver = new A4988();
    driver.setInputs(IDLE);
    driver.setInputs({ ...IDLE, enable: true });
    expect(outputs(driver)).toBe('0000');
  });

  it('parks at home with the outputs off while the reset line is low', () => {
    const driver = new A4988();
    driver.setInputs(IDLE);
    driver.setInputs({ ...IDLE, step: true });
    driver.setInputs({ ...IDLE, reset: false });
    expect(outputs(driver)).toBe('0000');
    expect(driver.position).toBe(0);
  });

  it('sleeps with the outputs off, and wakes at home', () => {
    const driver = new A4988();
    driver.setInputs(IDLE);
    driver.setInputs({ ...IDLE, step: true });
    driver.setInputs({ ...IDLE, sleep: false });
    expect(outputs(driver)).toBe('0000');
    driver.setInputs(IDLE);
    expect(outputs(driver)).toBe('1001');
  });

  it('ignores a step while the outputs are disabled', () => {
    const driver = new A4988();
    driver.setInputs({ ...IDLE, enable: true });
    driver.setInputs({ ...IDLE, enable: true, step: true });
    driver.setInputs(IDLE);
    expect(outputs(driver)).toBe('1001');
  });
});

describe('microstep selection', () => {
  it('reads the datasheet truth table', () => {
    expect(microstepsFor(false, false, false)).toBe(1);
    expect(microstepsFor(true, false, false)).toBe(2);
    expect(microstepsFor(false, true, false)).toBe(4);
    expect(microstepsFor(true, true, false)).toBe(8);
    expect(microstepsFor(true, true, true)).toBe(16);
  });

  it('falls back to full step on an undefined combination', () => {
    expect(microstepsFor(false, false, true)).toBe(1);
    expect(microstepsFor(true, false, true)).toBe(1);
  });
});

describe('average output duties', () => {
  const FINE = { ...IDLE, ms1: true, ms2: true, ms3: true } as const;

  it('keeps the full-step outputs', () => {
    const driver = new A4988();
    driver.setInputs(IDLE);
    expect(duties(driver)).toEqual([1, 0, 0, 1]);
  });

  it('wakes at the full-step anchor in 1/16', () => {
    const driver = new A4988();
    driver.setInputs({ ...FINE, reset: false });
    driver.setInputs(FINE);
    expect(duties(driver)).toEqual([0.8536, 0.1464, 0.1464, 0.8536]);
  });

  it('moves one sixteenth on the first fine step', () => {
    const driver = new A4988();
    driver.setInputs(FINE);
    driver.setInputs({ ...FINE, step: true });
    expect(duties(driver)).toEqual([0.8865, 0.1135, 0.1828, 0.8172]);
    expect(driver.microstepPosition).toBe(1);
  });

  it('reaches the next anchor after sixteen fine steps', () => {
    const driver = new A4988();
    driver.setInputs(FINE);
    for (let i = 0; i < 16; i++) {
      driver.setInputs({ ...FINE, step: true });
      driver.setInputs({ ...FINE, step: false });
    }
    expect(driver.microstepPosition).toBe(16);
    expect(duties(driver)).toEqual([0.8536, 0.1464, 0.8536, 0.1464]);
  });

  it('goes the other way in a fine mode', () => {
    const driver = new A4988();
    const fine = { ...FINE, dir: false } as const;
    driver.setInputs(fine);
    driver.setInputs({ ...fine, step: true });
    expect(driver.microstepPosition).toBe(63);
    expect(duties(driver)).toEqual([0.8172, 0.1828, 0.1135, 0.8865]);
  });

  it('changes mode on the next STEP edge, not before', () => {
    const driver = new A4988();
    driver.setInputs(IDLE);
    driver.setInputs(FINE);
    expect(driver.microsteps).toBe(1);
    expect(duties(driver)).toEqual([1, 0, 0, 1]);
    driver.setInputs({ ...FINE, step: true });
    expect(driver.microsteps).toBe(16);
    expect(driver.microstepPosition).toBe(1);
  });

  it('parks at home in the selected mode', () => {
    const driver = new A4988();
    driver.setInputs(FINE);
    driver.setInputs({ ...FINE, step: true });
    driver.setInputs({ ...FINE, reset: false });
    expect(driver.microstepPosition).toBe(0);
    expect(duties(driver)).toEqual([0, 0, 0, 0]);
    driver.setInputs(FINE);
    expect(duties(driver)).toEqual([0.8536, 0.1464, 0.1464, 0.8536]);
  });

  it('turns all duties off while disabled', () => {
    const driver = new A4988();
    driver.setInputs({ ...FINE, enable: true });
    expect(duties(driver)).toEqual([0, 0, 0, 0]);
  });
});

describe('the A4988 module', () => {
  it('is a driver with the header the carrier carries', () => {
    const definition = a4988Definition();
    expect(definition.component).toEqual({ kind: 'a4988' });
    expect(definition.pins.map((pin) => pin.id)).toEqual([
      '1B',
      '1A',
      '2A',
      '2B',
      'VMOT',
      'GND',
      'GND2',
      'VCC',
      'STEP',
      'DIR',
      'ENABLE',
      'RESET',
      'SLEEP',
      'MS1',
      'MS2',
      'MS3',
    ]);
  });
});
