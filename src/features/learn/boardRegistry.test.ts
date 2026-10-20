import { describe, expect, it } from 'vitest';
import {
  BOARDS,
  boardOption,
  boardSpecs,
  DEFAULT_BOARD_ID,
  isBoardId,
  type BoardId,
} from './boardRegistry';

import { Simulation } from '@/features/bench/simulations/simulation';
import { starterSketchFor } from './examples';
import { STARTER_CIRCUITS } from './benches';
import type { PartInstance } from '@/features/simulation';
import type { BoardPin } from '@/features/parts';

/**
 * The board registry.

 * Three things here are worth defending, and none of them is the prose.
 *
 * First, a card must not describe a board the simulator does not build: the
 * specs are derived from each definition, so what is asserted is that the
 * derivation agrees with the pin table rather than that a number is a number.
 *
 * Second, the starter wiring names header holes by id. An id that no longer
 * exists throws while the bench is being built, which reaches the user as a
 * blank page rather than as a message about a pin -- so it is checked here,
 * for every board, before anyone picks one.
 *
 * Third, and the one that matters most: the wiring has to land the LED on the
 * pin the starter sketch actually drives. Getting that wrong builds a bench
 * whose LED never lights, which to a learner is indistinguishable from a broken
 * simulator -- and it hid because the board it was written for happened to be
 * the only one that worked.
 */

/**
 * Compiles a board's starter document and finds the pin that feeds its LED.
 *
 * The document is the wiring's authority now, so the test asks it rather than a
 * table beside it: the LED's chain reaches exactly one board pin, and that pin
 * is the one the board's own sketch must name.
 */
function starterDrivePin(boardId: BoardId): {
  simulation: Simulation;
  led: PartInstance;
  pin: BoardPin;
} {
  const simulation = new Simulation(boardOption(boardId).make());
  expect(simulation.loadCircuit(STARTER_CIRCUITS[boardId])).toEqual([]);
  const parts = simulation.bench.parts;
  const led = parts.find((part) => part.definition.component.kind === 'led');
  const resistor = parts.find((part) => part.definition.component.kind === 'resistor');
  if (!led) throw new Error(`${boardId}: the starter has no LED`);
  if (!resistor) throw new Error(`${boardId}: the starter has no resistor`);
  const netlist = simulation.engine.currentNetlist;
  const boardPart = parts.find((part) => part.definition.component.kind === 'mcu')!;
  const leadNet = netlist.pinNode.get(`${resistor.id}:a`);
  const pin = boardPart.definition.boardPins?.find(
    (candidate) => netlist.pinNode.get(`${boardPart.id}:${candidate.id}`) === leadNet,
  );
  if (!pin) throw new Error(`${boardId}: no board pin feeds the starter LED`);
  return { simulation, led, pin };
}

/** The pin number the board's own starter sketch drives. */
function sketchPin(boardId: BoardId): number {
  const sketch = starterSketchFor(boardId);
  const match = /LED_PIN (\d+)|LED\((\d+)\)|Pin\((\d+)/.exec(sketch);
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  if (value === undefined) throw new Error(`${boardId}: the starter sketch names no pin`);
  return Number(value);
}

describe('board registry', () => {
  it('offers a unique id per board, including the default', () => {
    const ids = BOARDS.map((board) => board.id);
    // Duplicates would make one board unreachable: the first match always wins.
    expect(ids.filter((id, at) => ids.indexOf(id) !== at)).toEqual([]);
    expect(ids).toContain(DEFAULT_BOARD_ID);
  });

  it('describes every board and resolves it back by id', () => {
    for (const board of BOARDS) {
      expect(board.summary.length).toBeGreaterThan(0);
      expect(board.bestFor.length).toBeGreaterThan(0);
      expect(boardOption(board.id)).toBe(board);
    }
  });

  it('names the board when asked for one that does not exist', () => {
    // A board id can arrive from a URL or a stale saved choice, so a silent
    // fallback would build the wrong bench with no explanation.
    expect(() => boardOption('teensy' as BoardId)).toThrow(/unknown board teensy/);
  });

  describe('board ids from the URL', () => {
    /*
     * The bench reads its board out of a route parameter, so this guard is the
     * only thing between a hand-edited link and a throw inside a render. An id
     * that fails here is caught by the bench and falls back to the default
     * board; an id that slips past would blank the page.
     */
    it('accepts every board the app offers', () => {
      for (const board of BOARDS) {
        expect(isBoardId(board.id)).toBe(true);
      }
      expect(isBoardId(DEFAULT_BOARD_ID)).toBe(true);
    });

    it('rejects an absent, empty or unknown board id', () => {
      expect(isBoardId(undefined)).toBe(false);
      expect(isBoardId('')).toBe(false);
      expect(isBoardId('teensy')).toBe(false);
    });

    it('is case-sensitive, because the path is', () => {
      // `/bench/Uno` and `/bench/uno` are different URLs. Accepting both would
      // mean two addresses for one bench, which is what a canonical path is for.
      expect(isBoardId('Uno')).toBe(false);
      expect(isBoardId('uno')).toBe(true);
    });
  });

  describe('derived specs agree with the pin table', () => {
    it('counts what the definition actually declares', () => {
      for (const board of BOARDS) {
        const pins = boardOption(board.id).make().boardPins ?? [];
        const specs = boardSpecs(board.id);

        expect(specs.gpioCount).toBe(pins.filter((pin) => pin.role === 'gpio').length);
        expect(specs.adcCount).toBe(pins.filter((pin) => pin.role === 'adc').length);
        expect(specs.inputOnlyCount).toBe(pins.filter((pin) => pin.canDrive === false).length);
        expect(specs.logicVolts).toBeGreaterThan(0);
        // Zero is the honest answer for a board with no converter at all.
        expect(specs.adcBits).toBeGreaterThanOrEqual(0);
      }
    });

    it('pairs the 3.3 V boards with a 12-bit ADC and the 5 V boards with 10, or has none', () => {
      /*
       * The pairing a learner meets on the card has to be the pairing the
       * converter implements, or the card's first fact is the wrong one -- but
       * it only applies to a board that has a converter at all. A single-board
       * computer has none, and `adcBits: 0` is how it says so: giving it a
       * width would advertise a resolution the board cannot deliver.
       */
      for (const board of BOARDS) {
        const specs = boardSpecs(board.id);
        const expected = specs.adcCount > 0 ? (specs.logicVolts < 3.4 ? 12 : 10) : 0;
        expect(specs.adcBits, `${board.name} ADC`).toBe(expected);
      }
    });

    it('reports input-only pins only where the chip has them', () => {
      // GPIO34-39 on the ESP32 have no output driver; an AVR has none of this.
      expect(boardSpecs('esp32').inputOnlyCount).toBeGreaterThan(0);
      expect(boardSpecs('uno').inputOnlyCount).toBe(0);
    });
  });

  describe('the starter documents', () => {
    it('wire the LED to the pin the board’s own starter sketch drives', () => {
      /*
       * Every microcontroller here names `#define LED_PIN 2` in the sketch that
       * ships; a single-board computer's GPIO2 is its I2C data line, so its
       * sketch names a different pin. The document is where the two must agree
       * now -- the wiring table that used to hold the number is gone.
       */
      for (const board of BOARDS) {
        const { pin } = starterDrivePin(board.id);
        expect(pin.gpio, `${board.name} starter LED pin is a GPIO`).toBe(sketchPin(board.id));
        // A pin with no output driver cannot light anything, however it is wired.
        expect(pin.canDrive, `${board.name} starter LED pin`).not.toBe(false);
      }
    });

    it('puts the Nano RP2040 starter OLED on the pair the board documents', () => {
      /*
       * A4/A5 are the I2C pair, but they carry no firmware pin number of their
       * own -- D12/D13 own GPIO12/13. They are reachable only through the
       * internal nets those holes share, so this checks both ends of that tie
       * and then asks the engine whether the device is really on the bus.
       */
      const simulation = new Simulation(boardOption('rp2040').make());
      expect(simulation.loadCircuit(STARTER_CIRCUITS.rp2040)).toEqual([]);

      const board = simulation.bench.parts.find(
        (part) => part.definition.component.kind === 'mcu',
      )!;
      const oled = simulation.bench.parts.find(
        (part) =>
          part.definition.component.kind === 'display' &&
          part.definition.component.controller === 'ssd1306',
      );
      if (!oled) throw new Error('rp2040: the starter has no I2C OLED');

      const netlist = simulation.engine.currentNetlist;
      const netOf = (terminal: string) => netlist.pinNode.get(terminal);
      expect(netOf(`${board.id}:J3_A4`)).toBe(netOf(`${oled.id}:SDA`));
      expect(netOf(`${board.id}:J3_A5`)).toBe(netOf(`${oled.id}:SCL`));
      // The engine resolves the bus through the numbered holes; the internal
      // ties are what make those the same nodes as A4 and A5.
      expect(netOf(`${board.id}:J1_D12`)).toBe(netOf(`${oled.id}:SDA`));
      expect(netOf(`${board.id}:J2_D13`)).toBe(netOf(`${oled.id}:SCL`));
      expect(simulation.engine.i2cDevice(oled.id)?.onBus).toBe(true);
    });

    it('blink it when the firmware runs', () => {
      /*
       * The paper checks cannot see a pull-up that never reaches the LED or a
       * ground that is not ground. This runs the board's starter document with
       * the sketch its own language uses, and watches the anode for both a lit
       * and a dark state.
       */
      for (const board of BOARDS) {
        const { simulation, led } = starterDrivePin(board.id);
        const language = boardOption(board.id).language;
        /*
         * The board's own starter sketch, not a probe written to suit this
         * test. Substituting one hid a starter that could not run at all: the
         * Pico's `machine` import was missing, and a gpiozero probe on the same
         * bench blinked happily while the bench a learner opens was dead.
         */
        simulation.loadFirmware(starterSketchFor(board.id, language), language);
        expect(simulation.firmwareError, `${board.name} starter`).toBeNull();
        simulation.start();

        const anodeKey = `${led.id}:anode`;
        const levels: number[] = [];
        for (let frame = 0; frame < 120; frame++) {
          simulation.tick(0.05);
          levels.push(simulation.pinVoltages().get(anodeKey) ?? -1);
        }

        expect(Math.max(...levels), `${board.name} LED never lit`).toBeGreaterThan(1.5);
        expect(Math.min(...levels), `${board.name} LED never went dark`).toBeLessThan(0.5);
      }
    });
  });
});
