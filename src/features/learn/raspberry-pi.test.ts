import { describe, expect, it } from 'vitest';
import { raspberryPi4 } from '@/features/parts';
import { boardOption, boardSpecs } from './boardRegistry';
import { STARTER_CIRCUITS } from './benches';
import { Simulation } from '@/features/bench/simulations/simulation';

/**
 * The Raspberry Pi 4.
 *
 * This board is not a microcontroller with a different label, and every test
 * here is about one of the three things that makes it a different kind of
 * thing. A pin table that merely looked plausible would pass the general
 * registry checks -- the holes exist, they are GPIOs, they can drive -- so the
 * facts below are pinned against the header the Pi Foundation publishes.
 */
const pi = () => raspberryPi4();

describe('the 40-pin header', () => {
  it('carries all forty holes, numbered as the board numbers them', () => {
    expect(pi().pins).toHaveLength(40);
  });

  it('puts each BCM line on the physical pin the reference gives it', () => {
    // Physical pin to BCM GPIO, from the standard 40-pin block every Pi with a
    // J8 shares. The physical number is what a jumper lands on and the BCM
    // number is what a program names, so a board that has them the right way
    // round is one where both readings agree.
    const byId = new Map(pi().boardPins?.map((pin) => [pin.id, pin]));
    const expected: ReadonlyArray<readonly [number, number]> = [
      [3, 2],
      [5, 3],
      [7, 4],
      [8, 14],
      [10, 15],
      [11, 17],
      [12, 18],
      [13, 27],
      [15, 22],
      [16, 23],
      [18, 24],
      [19, 10],
      [21, 9],
      [22, 25],
      [23, 11],
      [24, 8],
      [26, 7],
      [27, 0],
      [28, 1],
      [29, 5],
      [31, 6],
      [32, 12],
      [33, 13],
      [35, 19],
      [36, 16],
      [37, 26],
      [38, 20],
      [40, 21],
    ];

    for (const [physical, gpio] of expected) {
      expect(byId.get(`J8_${physical}`)?.gpio, `physical ${physical}`).toBe(gpio);
    }
  });

  it('carries the supply and ground pins where the header puts them', () => {
    // Two 5 V and two 3.3 V, and eight grounds. A jumper to the wrong one of
    // these is the difference between a working board and a dead one.
    const nets = pi().pins.map((pin) => pin.net);
    expect(nets.filter((net) => net === '5V')).toHaveLength(2);
    expect(nets.filter((net) => net === '3V3')).toHaveLength(2);
    expect(nets.filter((net) => net === 'GND')).toHaveLength(8);
  });

  it('lays the header out as a two-row block rather than two edge columns', () => {
    /*
     * The artwork groups the pins into rows by their y, so the geometry has to
     * be a block: one line of odd physical pins and one of even, stacked one
     * above the other. Two columns at opposite ends of the board would draw two
     * strips nowhere near the holes, and the wires would land on nothing.
     */
    const odd = pi().pins.filter((pin) => Number(pin.id.slice(3)) % 2 === 1);
    const even = pi().pins.filter((pin) => Number(pin.id.slice(3)) % 2 === 0);

    // Each line is one row, so every pin in it shares the other coordinate.
    expect(new Set(odd.map((pin) => pin.y)).size).toBe(1);
    expect(new Set(even.map((pin) => pin.y)).size).toBe(1);
    expect(new Set(odd.map((pin) => pin.x)).size).toBe(20);

    // And the two rows sit a header pitch apart, as drawn in the artwork.
    const [oddY] = [...new Set(odd.map((pin) => pin.y))];
    const [evenY] = [...new Set(even.map((pin) => pin.y))];
    expect(Math.abs(oddY - evenY)).toBeCloseTo(2.215, 3);
  });
});

describe('what this board cannot do', () => {
  it('has no analogue input at all', () => {
    // Not a 10-bit one, not a weak one. The card and the simulation both have
    // to be able to say this, and the starter exercises assume it.
    expect(boardSpecs('raspberry-pi').adcBits).toBe(0);
    expect(boardSpecs('raspberry-pi').adcCount).toBe(0);
    expect(pi().boardPins?.some((pin) => pin.role === 'adc')).toBe(false);
  });

  it('drives far less than a microcontroller does', () => {
    // The BCM2711 drives 8 mA at 3.3 V, which is about 400 ohm against the
    // Uno's 25. This is the number that makes a jumper that works on an Uno
    // fail here, and it is the board's answer rather than a fault.
    const board = pi().component;
    if (board.kind !== 'mcu') throw new Error('expected a microcontroller board');

    expect(board.board.sourceOhms).toBeGreaterThan(300);
    const uno = boardOption('uno').make().component;
    if (uno.kind !== 'mcu') throw new Error('expected a microcontroller board');
    expect(board.board.sourceOhms).toBeGreaterThan(uno.board.sourceOhms * 10);
  });

  it('is 3.3 V logic that a 5 V signal would damage', () => {
    const board = pi().component;
    if (board.kind !== 'mcu') throw new Error('expected a microcontroller board');
    expect(board.board.logicVolts).toBe(3.3);
  });
});

describe('the starter wiring', () => {
  it('keeps the LED off the pin the display bus needs', () => {
    /*
     * Every microcontroller here starts its LED on GPIO 2 because that is what
     * the shipped sketch names. A Pi's GPIO 2 is the I2C data line and the
     * starter bench has a display on that bus, so the LED moves to GPIO 17.
     */
    const simulation = new Simulation(raspberryPi4());
    expect(simulation.loadCircuit(STARTER_CIRCUITS['raspberry-pi'])).toEqual([]);
    const resistor = simulation.bench.parts.find(
      (part) => part.definition.component.kind === 'resistor',
    )!;
    const drive = gpioOn(simulation, resistor.id, 'a');
    const oled = simulation.bench.parts.find((part) => part.definition.id.startsWith('ssd1306'))!;
    expect(drive).toBe(17);
    expect(drive).not.toBe(gpioOn(simulation, oled.id, 'SDA'));
    expect(drive).not.toBe(gpioOn(simulation, oled.id, 'SCL'));
  });

  it('wires the buses to the pins the Pi actually has them on', () => {
    const simulation = new Simulation(raspberryPi4());
    expect(simulation.loadCircuit(STARTER_CIRCUITS['raspberry-pi'])).toEqual([]);
    const oled = simulation.bench.parts.find((part) => part.definition.id.startsWith('ssd1306'))!;
    const tft = simulation.bench.parts.find((part) => part.definition.id.startsWith('ili9341'))!;

    // SDA1 then SCL1, and SPI0 with its chip select on CE0.
    expect([gpioOn(simulation, oled.id, 'SDA'), gpioOn(simulation, oled.id, 'SCL')]).toEqual([
      2, 3,
    ]);
    expect([
      gpioOn(simulation, tft.id, 'CS'),
      gpioOn(simulation, tft.id, 'SCK'),
      gpioOn(simulation, tft.id, 'MOSI'),
    ]).toEqual([8, 11, 10]);
  });

  it('opens its bench in Python, because the board runs Linux', () => {
    expect(boardOption('raspberry-pi').language).toBe('python');
  });
});

/** The GPIO number of the board pin sharing a part pin's net. */
function gpioOn(simulation: Simulation, partId: string, pinId: string): number | undefined {
  const netlist = simulation.engine.currentNetlist;
  const net = netlist.pinNode.get(`${partId}:${pinId}`);
  const board = simulation.bench.parts.find((part) => part.definition.component.kind === 'mcu')!;
  const pin = board.definition.boardPins?.find(
    (candidate) => netlist.pinNode.get(`${board.id}:${candidate.id}`) === net,
  );
  return pin?.gpio;
}
