import { describe, expect, it } from 'vitest';
import { Pca9685, PCA9685_CHANNELS, PCA9685_PRESCALE_50_HZ, pca9685Definition } from './pca9685';

/** The registers these tests name, as the datasheet numbers them. */
const MODE1 = 0x00;
const MODE2 = 0x01;
const LED0_ON_L = 0x06;
const ALL_LED_ON_L = 0xfa;
const PRESCALE = 0xfe;

const RESTART = 0x80;
const SLEEP = 0x10;
const AI = 0x20;
const INVRT = 0x10;

/** Writes one register and then its value, the way a sketch transaction does. */
function write(driver: Pca9685, register: number, values: readonly number[]): void {
  driver.receive(register, true);
  for (const value of values) driver.receive(value, false);
}

/** Points at a register and reads one byte back. */
function read(driver: Pca9685, register: number): number {
  driver.receive(register, true);
  return driver.read(1)[0]!;
}

/** Sets one channel's ON and OFF counts. */
function setPwm(driver: Pca9685, channel: number, on: number, off: number): void {
  const register = LED0_ON_L + channel * 4;
  write(driver, register, [on & 0xff, (on >> 8) & 0x1f, off & 0xff, (off >> 8) & 0x1f]);
}

describe('the PCA9685', () => {
  it('answers on the address the module is strapped to', () => {
    expect(new Pca9685().address).toBe(0x40);
  });

  it('powers up asleep with the oscillator stopped and all channels off', () => {
    const driver = new Pca9685();
    expect(read(driver, MODE1)).toBe(SLEEP | 0x01);
    expect(read(driver, MODE2)).toBe(0x04);
    expect(read(driver, PRESCALE)).toBe(0x1e);
    expect(driver.isSleeping).toBe(true);
    expect(driver.frequencyHz).toBeCloseTo(196.9, 1);
    for (let channel = 0; channel < PCA9685_CHANNELS; channel++) {
      expect(driver.duty(channel), `channel ${channel} is off`).toBe(0);
    }
  });

  it('sets a channel from its twelve-bit ON and OFF counts', () => {
    const driver = new Pca9685();
    write(driver, MODE1, [AI]);
    setPwm(driver, 0, 0, 2048);
    setPwm(driver, 1, 1024, 3072);
    expect(driver.duty(0)).toBeCloseTo(0.5, 5);
    expect(driver.duty(1)).toBeCloseTo(0.5, 5);
    expect(driver.duty(2)).toBe(0);
  });

  it('follows ON and OFF phase, not just the width', () => {
    const driver = new Pca9685();
    write(driver, MODE1, [AI]);
    setPwm(driver, 0, 1024, 3072);
    const period = 1000 / driver.frequencyHz;
    expect(driver.level(0, 0)).toBe(0);
    expect(driver.level(0, period * 0.5)).toBe(1);
    expect(driver.level(0, period * 0.9)).toBe(0);
  });

  it('makes twelve-bit full-on and full-off codes, with off taking precedence', () => {
    const driver = new Pca9685();
    write(driver, MODE1, [AI]);
    setPwm(driver, 0, 0x1000, 0);
    setPwm(driver, 1, 0, 0x1000);
    setPwm(driver, 2, 0x1000, 0x1000);
    expect(driver.duty(0)).toBe(1);
    expect(driver.duty(1)).toBe(0);
    expect(driver.duty(2)).toBe(0);
    expect(driver.level(0, 0)).toBe(1);
    expect(driver.level(1, 0)).toBe(0);
    expect(driver.level(2, 0)).toBe(0);
  });

  it('sets the frequency from PRESCALE while the oscillator sleeps', () => {
    const driver = new Pca9685();
    write(driver, MODE1, [SLEEP | AI]);
    write(driver, PRESCALE, [PCA9685_PRESCALE_50_HZ]);
    expect(driver.frequencyHz).toBeCloseTo(50.0, 1);
    write(driver, MODE1, [AI]);
    expect(driver.isSleeping).toBe(false);
    // A PRESCALE write while awake is ignored, as it is on the chip.
    write(driver, PRESCALE, [0x0c]);
    expect(driver.frequencyHz).toBeCloseTo(50.0, 1);
  });

  it('drives all channels from the ALL_LED registers', () => {
    const driver = new Pca9685();
    write(driver, MODE1, [AI]);
    write(driver, ALL_LED_ON_L, [0x00, 0x00, 0x00, 0x08]);
    for (let channel = 0; channel < PCA9685_CHANNELS; channel++) {
      expect(driver.duty(channel), `channel ${channel}`).toBeCloseTo(0.5, 5);
    }
  });

  it('inverts the outputs when MODE2 asks it to', () => {
    const driver = new Pca9685();
    write(driver, MODE1, [AI]);
    setPwm(driver, 0, 0, 2048);
    expect(driver.level(0, 0)).toBe(1);
    write(driver, MODE2, [0x04 | INVRT]);
    expect(driver.level(0, 0)).toBe(0);
  });

  it('walks the register file in one burst when auto-increment is set', () => {
    const driver = new Pca9685();
    write(driver, MODE1, [AI]);
    write(driver, LED0_ON_L, [0x00, 0x00, 0x00, 0x08]);
    driver.receive(LED0_ON_L, true);
    expect(driver.read(4)).toEqual([0x00, 0x00, 0x00, 0x08]);
  });

  it('reads a reserved address as zero, not as whatever a burst left there', () => {
    const driver = new Pca9685();
    write(driver, MODE1, [AI]);
    write(driver, 0x46, [0xaa]);
    expect(read(driver, 0x46)).toBe(0x00);
  });

  it('wraps a burst at the end of the register file', () => {
    const driver = new Pca9685();
    write(driver, MODE1, [AI]);
    driver.receive(0xff, true);
    driver.receive(0x00, false);
    driver.receive(0x00, false);
    expect(read(driver, 0x00)).toBe(0x00);
  });

  it('reports that the oscillator is among the outputs that are switching', () => {
    const driver = new Pca9685();
    expect(driver.isPwmActive).toBe(false);
    write(driver, MODE1, [AI]);
    setPwm(driver, 0, 0, 2048);
    expect(driver.isPwmActive).toBe(true);
    setPwm(driver, 0, 0x1000, 0);
    expect(driver.isPwmActive).toBe(false);
    setPwm(driver, 0, 0, 0x1000);
    expect(driver.isPwmActive).toBe(false);
  });

  it('stops the outputs while it sleeps and restarts them when it wakes', () => {
    const driver = new Pca9685();
    write(driver, MODE1, [AI]);
    setPwm(driver, 0, 0, 2048);
    expect(driver.level(0, 0)).toBe(1);
    write(driver, MODE1, [SLEEP | AI | RESTART]);
    expect(driver.level(0, 0)).toBe(0);
    write(driver, MODE1, [AI]);
    expect(driver.level(0, 0)).toBe(1);
  });
});

describe('the PCA9685 module', () => {
  it('is a sixteen-channel driver with four bus wires', () => {
    const definition = pca9685Definition();
    expect(definition.component).toEqual({ kind: 'pca9685' });
    expect(definition.pins.map((pin) => pin.id)).toEqual([
      'VCC',
      'GND',
      'SDA',
      'SCL',
      ...Array.from({ length: PCA9685_CHANNELS }, (_, index) => `PWM${index}`),
    ]);
  });
});
