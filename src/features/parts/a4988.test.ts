import { describe, expect, it } from 'vitest';
import { a4988Definition, A4988 } from './a4988';

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
} as const;

/** The four output levels, as the bench reads them. */
function outputs(driver: A4988): string {
  return (['1A', '1B', '2A', '2B'] as const).map((pin) => (driver.output(pin) ? '1' : '0')).join('');
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
