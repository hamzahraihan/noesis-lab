import { describe, expect, it } from 'vitest';
import { BenchBuilder } from './bench';
import { breadboardDefinition, columnX, railRowY, stripRowY } from '@/features/parts';
import { esp32DevKitV1 } from '@/features/parts';
import { resistorDefinition } from '@/features/parts';
import { Engine } from './engine';
import { McuRuntime } from './mcu';
import { GROUND } from './elements';
import { VOLT_IMPEDANCE_OHMS, Multimeter, type MeterReading } from './multimeter';

const OHM = 1_000;
const BREADBOARD_ORIGIN_X = 230;

const holeX = (column: number): number => BREADBOARD_ORIGIN_X + columnX(column);
const holeY = (row: number): number => stripRowY(row);

function link(
  builder: BenchBuilder,
  from: { x: number; y: number },
  to: { x: number; y: number },
): void {
  builder.addWire(from.x, from.y, to.x, to.y);
}

/**
 * A board driving an equal divider:
 *
 *   3V3 --[feed]--> col 12 --[R1]--> col 16 --[R2]--> col 20 -- ground
 *
 * `openFeed` leaves the jumper out between the rail and column 12. That is the
 * bench you get after lifting a wire to put an ammeter in the gap, and without
 * the meter the circuit is simply open.
 */
function dividerBench(options: { openFeed?: boolean } = {}) {
  const builder = new BenchBuilder();
  const board = builder.addPart(esp32DevKitV1(), 0, 0);
  builder.addPart(breadboardDefinition(), BREADBOARD_ORIGIN_X, 0);

  const pinAt = (id: string) => board.definition.pins.find((pin) => pin.id === id)!;
  const railY = railRowY(2);

  link(builder, pinAt('R_3V3'), { x: holeX(10), y: holeY(8) });
  if (!options.openFeed) {
    link(builder, { x: holeX(10), y: holeY(8) }, { x: holeX(12), y: holeY(8) });
  }

  builder.addPart(resistorDefinition(OHM), holeX(12), holeY(8) - 2.54);
  builder.addPart(resistorDefinition(OHM), holeX(16), holeY(8) - 2.54);
  link(builder, { x: holeX(20), y: holeY(8) }, { x: holeX(20), y: railY });
  link(builder, { x: holeX(8), y: railY }, pinAt('L_GND'));

  const mcu = new McuRuntime(board.definition);
  const bench = builder.build();
  const engine = new Engine({ bench, mcu });
  engine.rebuild();
  engine.settle();

  const breadboard = bench.parts[1];
  const netAtColumn = (column: number): number =>
    engine.netOfTerminal(breadboard.terminals[`s${column}i`]);

  return { builder, board, engine, netAtColumn };
}

/** Solves with the meter stamped in and returns what its display would show. */
function measure(
  configure: (meter: Multimeter, netAtColumn: (c: number) => number) => void,
  options: { openFeed?: boolean } = {},
): MeterReading {
  const { engine, netAtColumn } = dividerBench(options);
  const meter = new Multimeter();
  configure(meter, netAtColumn);

  engine.setMeter(meter);
  engine.settle();
  const reading = meter.read((net) => engine.voltageOfNet(net));
  engine.setMeter(null);
  return reading;
}

describe('multimeter in volts mode', () => {
  it('reads the divider midpoint against ground', () => {
    const reading = measure((meter, net) => meter.setProbes(net(16), GROUND));

    expect(reading.value).toBeCloseTo(1.65, 1);
    expect(reading.unit).toBe('V');
    expect(reading.valid).toBe(true);
  });

  it('reads the difference between two probes rather than to ground', () => {
    const reading = measure((meter, net) => meter.setProbes(net(12), net(16)));

    expect(reading.value).toBeCloseTo(1.65, 1);
  });

  it('loads the circuit only as much as a real meter would', () => {
    const { engine, netAtColumn } = dividerBench();
    const mid = netAtColumn(16);
    const before = engine.voltageOfNet(mid);

    const meter = new Multimeter();
    meter.setProbes(mid, GROUND);
    engine.setMeter(meter);
    engine.settle();
    const after = engine.voltageOfNet(mid);
    engine.setMeter(null);

    // 10 MOhm against a 500 Ohm divider is a rounding error, not a short.
    expect(VOLT_IMPEDANCE_OHMS).toBeGreaterThan(1e6);
    expect(after).toBeCloseTo(before, 2);
  });
});

describe('multimeter in amps mode', () => {
  it('reads the divider current when bridging the lifted feed', () => {
    // The meter is the only connection between the rail and the divider, so
    // all the divider's current passes through its 1 Ohm shunt.
    const reading = measure(
      (meter, net) => {
        meter.mode = 'amps';
        meter.setProbes(net(10), net(12));
      },
      { openFeed: true },
    );

    // 3.3 V across 2 kOhm is about 1.65 mA.
    expect(reading.value).toBeGreaterThan(0.0015);
    expect(reading.value).toBeLessThan(0.0018);
    expect(reading.unit).toBe('A');
    expect(reading.valid).toBe(true);
  });

  it('reads nothing when the feed is lifted and the meter is elsewhere', () => {
    const reading = measure(
      (meter, net) => {
        meter.mode = 'amps';
        meter.setProbes(net(12), GROUND);
      },
      { openFeed: true },
    );

    expect(Math.abs(reading.value)).toBeLessThan(1e-3);
  });

  it('drops a burden voltage across the circuit as it measures', () => {
    const withMeter = measure(
      (meter, net) => {
        meter.mode = 'amps';
        meter.setProbes(net(10), net(12));
      },
      { openFeed: true },
    ).value;

    const unloaded = measure((meter, net) => meter.setProbes(net(16), GROUND)).value;

    // The 1 Ohm shunt takes roughly 1.65 mV of the 1.65 V the top resistor had.
    expect(withMeter).toBeGreaterThan(0);
    expect(unloaded).toBeCloseTo(1.65, 1);
  });

  it('reports over range when the circuit draws too much', () => {
    const reading = measure((meter, net) => {
      meter.mode = 'amps';
      meter.ampRange = { id: 'ua', label: '200 µA', shuntOhms: 1, fullScaleAmps: 0.0002 };
      meter.setProbes(net(10), GROUND);
    });

    expect(reading.valid).toBe(false);
    expect(reading.note).toBe('over range');
  });

  it('refuses to read with both probes on the same net', () => {
    const reading = measure((meter) => {
      meter.mode = 'amps';
      meter.setProbes(4, 4);
    });

    expect(reading.valid).toBe(false);
    expect(reading.note).toBe('probes on the same net');
  });

  it('turns a rail into a short when placed across it', () => {
    // The classic mistake. All that stands between the rail and a dead short is
    // the meter's own 10 mOhm shunt, which is why the reading is absurd.
    const reading = measure((meter, net) => {
      meter.mode = 'amps';
      meter.ampRange = { id: 'a', label: '2 A', shuntOhms: 0.01, fullScaleAmps: 2 };
      meter.setProbes(net(10), GROUND);
    });

    expect(Math.abs(reading.value)).toBeGreaterThan(100);
    expect(reading.valid).toBe(false);
  });
});

describe('multimeter in ohms mode', () => {
  it('gives up rather than inventing a reading on a powered circuit', () => {
    const reading = measure((meter, net) => {
      meter.mode = 'ohms';
      meter.setProbes(net(12), net(16));
    });

    expect(reading.valid).toBe(false);
    expect(reading.note).toContain('over range');
  });

  it('reads the resistance of a de-energised component', () => {
    // Across R2 alone: its far terminal runs to ground, so the meter sees one
    // resistor rather than the whole chain back through the lifted feed.
    const reading = measure(
      (meter, net) => {
        meter.mode = 'ohms';
        // 20 k range: 100 uA across 1 k needs 0.1 V, which the 200 ohm range's
        // 0.2 V compliance would not have room for.
        meter.ohmRange = { id: 'r20k', label: '20 k', testAmps: 0.0001, complianceVolts: 2 };
        meter.setProbes(net(16), net(20));
      },
      { openFeed: true },
    );

    expect(reading.valid).toBe(true);
    expect(reading.value).toBeGreaterThan(700);
    expect(reading.value).toBeLessThan(1000);
    expect(reading.unit).toBe('Ω');
  });

  it('reports zero with the probes shorted together', () => {
    const reading = measure((meter) => {
      meter.mode = 'ohms';
      meter.setProbes(7, 7);
    });

    expect(reading.valid).toBe(false);
    expect(reading.note).toBe('probes shorted');
  });

  it('adds nothing to the circuit when lifted', () => {
    const meter = new Multimeter();
    meter.setProbes(3, 9);
    expect(meter.stamp()).not.toBeNull();

    meter.setProbes(5, 5);
    expect(meter.stamp()).toBeNull();
  });
});
