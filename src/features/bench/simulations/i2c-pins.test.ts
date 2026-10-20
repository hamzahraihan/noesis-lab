import { describe, expect, it } from 'vitest';
import { Simulation } from './simulation';
import { boardOption } from '@/features/learn';
import { STARTER_CIRCUITS } from '@/features/learn/benches';
import { Ssd1306 } from '@/features/parts';

/**
 * The pins a MicroPython sketch names.
 *
 * `machine.I2C(0, sda=21, scl=22)` used to be accepted and ignored: the bus
 * was the board's whatever the sketch said. A sketch that named the wrong
 * pair therefore talked to the panel anyway, and the two backends -- the
 * interpreter and the emulated chip, which honours its pins -- disagreed
 * about the same sketch.
 */
function bench(): Simulation {
  const simulation = new Simulation(boardOption('esp32').make());
  simulation.loadCircuit(STARTER_CIRCUITS.esp32);
  return simulation;
}

/** The OLED on the starter bench: the panel an I2C sketch talks to. */
function panel(simulation: Simulation): Ssd1306 {
  const part = simulation.bench.parts.find(
    (candidate) =>
      candidate.definition.component.kind === 'display' &&
      candidate.definition.component.controller === 'ssd1306',
  );
  if (!part) throw new Error('the starter bench has no OLED');
  const controller = simulation.engine.displayController(part.id);
  if (!(controller instanceof Ssd1306)) throw new Error('the panel is not an I2C display');
  return controller;
}

/** A sketch that turns the glass on, over the bus it names. */
function sketch(pins: string): string {
  return [
    'from machine import I2C',
    pins === '' ? 'i2c = I2C(0)' : `i2c = I2C(0, ${pins})`,
    "i2c.writeto(0x3c, b'\\x00\\xaf')",
    '',
  ].join('\n');
}

describe('the bus a MicroPython sketch names', () => {
  it('reaches the panel when the pins are the ones it is wired to', () => {
    const simulation = bench();
    simulation.loadFirmware(sketch('sda=21, scl=22'), 'python');
    simulation.start();
    for (let frame = 0; frame < 20; frame++) simulation.tick(0.02);

    expect(panel(simulation).lit, 'the panel never lit').toBe(true);
  });

  it('reaches the panel when the pins are given by position', () => {
    const simulation = bench();
    simulation.loadFirmware(sketch('21, 22'), 'python');
    simulation.start();
    for (let frame = 0; frame < 20; frame++) simulation.tick(0.02);

    expect(panel(simulation).lit, 'the panel never lit').toBe(true);
  });

  it('does not reach the panel when the sketch names another pair', () => {
    const simulation = bench();
    simulation.loadFirmware(sketch('sda=18, scl=19'), 'python');
    simulation.start();
    for (let frame = 0; frame < 20; frame++) simulation.tick(0.02);

    expect(panel(simulation).lit, 'the panel lit on a bus it is not on').toBe(false);
  });

  it('gives the board its own bus when the sketch names no pins', () => {
    const simulation = bench();
    simulation.loadFirmware(sketch(''), 'python');
    simulation.start();
    for (let frame = 0; frame < 20; frame++) simulation.tick(0.02);

    expect(panel(simulation).lit, 'the panel never lit').toBe(true);
  });
});

describe('a read from a device nobody wired', () => {
  it('raises the error a sketch can guard', () => {
    const simulation = bench();
    simulation.loadFirmware(
      [
        'from machine import I2C',
        'i2c = I2C(0)',
        'try:',
        '    data = i2c.readfrom(0x50, 1)',
        'except OSError as e:',
        "    print('guarded')",
        '',
      ].join('\n'),
      'python',
    );
    simulation.start();
    for (let frame = 0; frame < 20; frame++) simulation.tick(0.02);

    expect(simulation.firmwareError).toBeNull();
    expect(simulation.serial.join(''), 'the sketch did not catch the error').toContain('guarded');
  });

  it('stops the sketch when nothing catches the error', () => {
    const simulation = bench();
    simulation.loadFirmware(
      ['from machine import I2C', 'i2c = I2C(0)', 'data = i2c.readfrom(0x50, 1)', ''].join('\n'),
      'python',
    );
    simulation.start();
    for (let frame = 0; frame < 20; frame++) simulation.tick(0.02);

    expect(simulation.firmwareError).toContain('OSError');
  });
});
