import { describe, expect, it } from 'vitest';
import { BenchBuilder } from './bench';
import {
  BREADBOARD_HEIGHT_MM,
  columnX,
  holeAt,
  railNet,
  railRowY,
  stripRowY,
  breadboardDefinition,
} from './breadboard';
import { esp32DevKitV1 } from './boards';
import { ledDefinition, resistorDefinition } from './passives';
import { DIODE_PROFILES, GROUND, type Element } from './elements';
import { NO_DYNAMIC_STATE } from './catalog';
import { buildNetlist } from './netlist';
import { elementCurrent, solveCircuit } from './circuit';

/** Breadboard origin, kept clear of the board so the two never overlap. */
const BOARD_ORIGIN_X = 200;

const holeX = (column: number): number => BOARD_ORIGIN_X + columnX(column);
const holeY = (row: number): number => stripRowY(row);

/** Rail 2 is the bottom negative rail. */
const BOTTOM_NEGATIVE_RAIL = 2;

function benchWithBreadboardAndEsp32() {
  const builder = new BenchBuilder();
  builder.addPart(breadboardDefinition(), BOARD_ORIGIN_X, 0);
  const esp32 = builder.addPart(esp32DevKitV1(), 0, 0);
  return { builder, esp32 };
}

/** World position of a named pin on a part placed at the origin. */
function pinAt(esp32: { definition: { pins: readonly { id: string; x: number; y: number }[] } }, id: string) {
  return esp32.definition.pins.find((pin) => pin.id === id)!;
}

describe('breadboard geometry', () => {
  it('spaces holes at a real 0.1 inch pitch', () => {
    expect(columnX(1) - columnX(0)).toBeCloseTo(2.54, 6);
    expect(stripRowY(1) - stripRowY(0)).toBeCloseTo(2.54, 6);
  });

  it('leaves a centre channel three pitches wide between rows e and f', () => {
    expect(stripRowY(5) - stripRowY(4)).toBeCloseTo(3 * 2.54, 6);
  });

  it('resolves points in both the top and bottom strip blocks', () => {
    expect(holeAt(columnX(10), stripRowY(2))).toEqual({
      kind: 'strip', column: 10, row: 2,
    });
    expect(holeAt(columnX(10), stripRowY(6))).toEqual({
      kind: 'strip', column: 10, row: 6,
    });
    expect(holeAt(columnX(10), stripRowY(9))).toEqual({
      kind: 'strip', column: 10, row: 9,
    });
  });

  it('resolves a point inside the rail area', () => {
    expect(holeAt(columnX(25), railRowY(BOTTOM_NEGATIVE_RAIL))).toEqual({
      kind: 'rail', column: 25, rail: BOTTOM_NEGATIVE_RAIL,
    });
  });

  it('rejects points off the board', () => {
    expect(holeAt(-40, stripRowY(2))).toBeNull();
    expect(holeAt(columnX(10), BREADBOARD_HEIGHT_MM + 20)).toBeNull();
  });

  it('leaves the channel itself hole-free for a straddling chip', () => {
    const midChannelY = (stripRowY(4) + stripRowY(5)) / 2;
    expect(holeAt(columnX(10), midChannelY)).toBeNull();
  });
});

describe('netlist extraction', () => {
  it('keeps the two halves of a power rail apart', () => {
    // The single most common beginner bug: assuming the rail runs all the way
    // across the board. Left and right halves must not share a net.
    expect(railNet(0, 5)).not.toBe(railNet(0, 40));
  });

  it('unions the five holes of one breadboard strip', () => {
    const { builder } = benchWithBreadboardAndEsp32();
    const board = builder.build();
    const breadboard = board.parts[0];

    const holesAtoE = [0, 1, 2, 3, 4].map(
      (row) => breadboard.terminals[`s10${'abcde'[row]}`],
    );

    const netlist = buildNetlist(board, NO_DYNAMIC_STATE);
    const nodes = holesAtoE.map((terminal) => netlist.nodeOfTerminal[terminal]);
    expect(new Set(nodes).size).toBe(1);
  });

  it('keeps the top and bottom strips of a column apart', () => {
    const { builder } = benchWithBreadboardAndEsp32();
    const board = builder.build();
    const breadboard = board.parts[0];
    const netlist = buildNetlist(board, NO_DYNAMIC_STATE);

    const topStrip = netlist.nodeOfTerminal[breadboard.terminals.s10a];
    const bottomStrip = netlist.nodeOfTerminal[breadboard.terminals.s10f];
    expect(topStrip).not.toBe(bottomStrip);
  });

  it('treats every ground pin on the board as the reference net', () => {
    const { builder, esp32 } = benchWithBreadboardAndEsp32();
    const board = builder.build();
    const netlist = buildNetlist(board, NO_DYNAMIC_STATE);

    // The ESP32 carries ground in both headers; all of it is one plane, and
    // neither header's copy may be lost to a duplicate pin id.
    expect(netlist.nodeOfTerminal[esp32.terminals.L_GND]).toBe(GROUND);
    expect(netlist.nodeOfTerminal[esp32.terminals.R_GND]).toBe(GROUND);
    expect(netlist.nodeCount).toBeGreaterThan(0);
  });

  it('leaves an unwired board pin on a net of its own', () => {
    const { builder, esp32 } = benchWithBreadboardAndEsp32();
    const board = builder.build();
    const netlist = buildNetlist(board, NO_DYNAMIC_STATE);

    const gpio27 = netlist.pinNode.get(`${esp32.id}:L_GPIO27`);
    const gpio26 = netlist.pinNode.get(`${esp32.id}:L_GPIO26`);
    expect(gpio27).not.toBe(GROUND);
    expect(gpio27).not.toBe(gpio26);
  });
});

describe('end to end: an LED driven from an ESP32 pin', () => {
  /** Wires the classic GPIO -> resistor -> LED -> ground chain onto a board. */
  function buildLedBench(resistorOhms = 330) {
    const { builder, esp32 } = benchWithBreadboardAndEsp32();

    // ESP32 GPIO2 across to the column-20 bottom strip.
    const gpio2 = pinAt(esp32, 'R_D2');
    builder.addWire(gpio2.x, gpio2.y, holeX(20), holeY(8));

    // Resistor across columns 20 to 24, both in the row-8 strip.
    builder.addPart(resistorDefinition(resistorOhms), holeX(20), holeY(8) - 1.6);

    // LED anode shares column 24; the cathode steps one column along.
    builder.addPart(ledDefinition(DIODE_PROFILES.red, 'Red'), holeX(24), holeY(8) - 3);

    // LED cathode down to the bottom ground rail, and the board's own ground
    // onto that same rail.
    builder.addWire(holeX(25), holeY(8), holeX(25), railRowY(BOTTOM_NEGATIVE_RAIL));
    const ground = pinAt(esp32, 'L_GND');
    builder.addWire(ground.x, ground.y, holeX(10), railRowY(BOTTOM_NEGATIVE_RAIL));

    return { builder, esp32 };
  }

  it('chains the nets from the pin through the resistor to the LED', () => {
    const { builder, esp32 } = buildLedBench();
    const board = builder.build();
    const netlist = buildNetlist(board, NO_DYNAMIC_STATE);

    const signalNet = netlist.pinNode.get(`${esp32.id}:R_D2`)!;
    const resistorNearNet = netlist.pinNode.get(`${board.parts[2].id}:a`)!;
    const resistorFarNet = netlist.pinNode.get(`${board.parts[2].id}:b`)!;
    const ledAnodeNet = netlist.pinNode.get(`${board.parts[3].id}:anode`)!;
    const ledCathodeNet = netlist.pinNode.get(`${board.parts[3].id}:cathode`)!;

    // The pin and the near side of the resistor share the column-20 strip.
    expect(resistorNearNet).toBe(signalNet);
    // The resistor separates signal from LED: different columns, different nets.
    expect(resistorFarNet).not.toBe(signalNet);
    // The far side of the resistor and the LED anode share column 24.
    expect(ledAnodeNet).toBe(resistorFarNet);
    // The LED returns to the board's ground plane.
    expect(ledCathodeNet).not.toBe(ledAnodeNet);
    expect(ledCathodeNet).toBe(GROUND);
  });

  it('lights the LED when the pin drives 3.3 V', () => {
    const { builder, esp32 } = buildLedBench();
    const board = builder.build();
    const netlist = buildNetlist(board, NO_DYNAMIC_STATE);

    const signalNet = netlist.pinNode.get(`${esp32.id}:R_D2`)!;
    const elements: Element[] = [
      // Standing in for the engine's pin driver: 3.3 V onto the signal net.
      { kind: 'voltageSource', a: signalNet, b: GROUND, volts: 3.3 },
      ...netlist.elements,
    ];

    const solution = solveCircuit(elements, { nodeCount: netlist.nodeCount });
    expect(solution.converged).toBe(true);

    const ledElement = netlist.elements.find((element) => element.kind === 'diode')!;
    const amps = elementCurrent(ledElement, solution);
    // 3.3 V through 330 Ohm leaves a few mA once the LED drops ~1.9 V.
    expect(amps).toBeGreaterThan(0.002);
    expect(amps).toBeLessThan(0.007);
  });

  it('leaves the LED dark when the pin is not driven', () => {
    const { builder } = buildLedBench();
    const board = builder.build();
    const netlist = buildNetlist(board, NO_DYNAMIC_STATE);

    const solution = solveCircuit(netlist.elements, { nodeCount: netlist.nodeCount });
    expect(solution.converged).toBe(true);

    const ledElement = netlist.elements.find((element) => element.kind === 'diode')!;
    expect(elementCurrent(ledElement, solution)).toBeLessThan(1e-6);
  });
});