import { describe, expect, it } from 'vitest';
import {
  BOARDS,
  boardOption,
  boardSpecs,
  DEFAULT_BOARD_ID,
  isBoardId,
  STARTER_WIRING,
  type BoardId,
} from './boardRegistry';

import { Simulation } from '@/features/bench/simulation';
import { BLINK_SKETCH, PI_BLINK_SKETCH } from './examples';
import { breadboardDefinition, columnX, railRowY, stripRowY } from '@/features/parts';
import { ledDefinition, resistorDefinition } from '@/features/parts';
import { DIODE_PROFILES } from '@/features/simulation';
import type { PartInstance, Terminal } from '@/features/simulation';

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

/** A terminal-shaped placeholder, matching how the app routes a starter wire. */
function at(x: number, y: number): Terminal {
  return { id: -1, x, y };
}

/**
 * The starter bench's LED, wired exactly as the app builds it.
 *
 * This is the only way to catch the fault the pin assertions cannot: that the
 * hole is named right, that it answers to the pin the sketch drives, and that
 * current actually flows. Any one of the three can hold while the LED stays
 * dark -- a pull-up that never reaches it, or a ground that is not ground.
 */
function starterLedBench(boardId: BoardId): { simulation: Simulation; led: PartInstance } {
  const wiring = STARTER_WIRING[boardId];
  const simulation = new Simulation(boardOption(boardId).make());
  const board = simulation.addPart(boardOption(boardId).make(), 0, 0);
  simulation.addPart(breadboardDefinition(), 230, 0);

  const pinAt = (id: string) => {
    const pin = board.definition.pins.find((candidate) => candidate.id === id);
    if (!pin) throw new Error(`${board.definition.name} has no pin ${id}`);
    return pin;
  };
  const holeX = (column: number) => 230 + columnX(column);
  const holeY = (row: number) => stripRowY(row);
  const railY = railRowY(2);

  const ledPin = pinAt(wiring.led);
  simulation.routeWire(at(ledPin.x, ledPin.y), at(holeX(20), holeY(8)));
  simulation.addPart(resistorDefinition(330), holeX(20), holeY(8) - 2.54);
  // Anode-anchored: the long leg lands on its hole, cathode one column along.
  const starterLedDef = ledDefinition(DIODE_PROFILES.red, 'Red');
  const starterAnode = starterLedDef.pins.find((pin) => pin.id === 'anode')!;
  const led = simulation.addPart(
    starterLedDef,
    holeX(24) - starterAnode.x,
    holeY(8) - starterAnode.y,
  );
  // The cathode sits one column back from the anode; return it to ground.
  simulation.routeWire(at(holeX(23), holeY(8)), at(holeX(23), railY));
  const ground = pinAt(wiring.ground);
  simulation.routeWire(at(ground.x, ground.y), at(holeX(10), railY));

  return { simulation, led };
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
        expect(specs.inputOnlyCount).toBe(
          pins.filter((pin) => pin.canDrive === false).length,
        );
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

  describe('starter wiring points at real holes', () => {
    /** The eight pins the starter bench routes, named for the failure message. */
    function routedPins(boardId: BoardId): ReadonlyArray<readonly [string, string]> {
      const wiring = STARTER_WIRING[boardId];
      return [
        ['led', wiring.led],
        ['ground', wiring.ground],
        ['sda', wiring.i2c[0]],
        ['scl', wiring.i2c[1]],
        ['cs', wiring.spi[0]],
        ['dc', wiring.spi[1]],
        ['sck', wiring.spi[2]],
        ['mosi', wiring.spi[3]],
      ];
    }

    it('names pins that exist on the board it is keyed to', () => {
      for (const board of BOARDS) {
        const definition = boardOption(board.id).make();
        for (const [label, pinId] of routedPins(board.id)) {
          const exists = definition.pins.some((pin) => pin.id === pinId);
          expect(exists, `${board.name} has no ${label} pin ${pinId}`).toBe(true);
        }
      }
    });

    it('wires a ground pin that really is ground', () => {
      // A mislabelled ground gives a bench that solves but never lights, which
      // reads to a learner as a broken LED rather than a wrong pin id.
      for (const board of BOARDS) {
        const definition = boardOption(board.id).make();
        const pin = definition.pins.find(
          (candidate) => candidate.id === STARTER_WIRING[board.id].ground,
        );
        expect(pin?.net, `${board.name} ground`).toBe('GND');
      }
    });

    it('lands the starter LED on the pin that board’s own sketch drives', () => {
      /*
       * Every microcontroller here names `#define LED_PIN 2` in the sketch that
       * ships, so the starter wiring has to put the LED on the hole that
       * answers to pin 2 -- not on the pin a board's silkscreen would suggest.
       * Wiring it to pin 13 instead gives a bench whose LED never lights, which
       * looks exactly like a broken simulator and was true on five of the six
       * boards that shipped before this check.
       *
       * The number lives on the wiring rather than here because it is no longer
       * the same on every board: a single-board computer's GPIO2 is its I2C data
       * line, so its sketch names a different pin and the wiring follows it.
       */
      for (const board of BOARDS) {
        const definition = boardOption(board.id).make();
        const pin = definition.boardPins?.find(
          (candidate) => candidate.id === STARTER_WIRING[board.id].led,
        );
        expect(pin?.gpio, `${board.name} starter LED pin`).toBe(STARTER_WIRING[board.id].ledPin);
        // A pin with no output driver cannot light anything, however it is wired.
        expect(pin?.canDrive, `${board.name} starter LED pin`).not.toBe(false);
      }
    });
  });

  describe('the starter bench actually blinks', () => {
    /*
     * Everything above checks the wiring on paper. This runs it: the sketch
     * loaded, the firmware stepped, the net solved, and the LED's anode watched
     * for both a lit and a dark state.
     *
     * It is the only assertion here that would have caught the pin-13 fault on
     * its own, because a correctly named hole wired to the wrong pin still
     * passes every other check -- the hole exists, it is a GPIO, it can drive.
     * It also guards the wiring itself, which is duplicated here rather than
     * imported: importing it would make this test pass exactly when the app
     * breaks.
     */
    for (const board of BOARDS) {
      it(`lights and darkens the LED on the ${board.name}`, () => {
        const { simulation, led } = starterLedBench(board.id);
        // Each board is given the sketch it would actually be handed when its
        // bench opens, in its own language. Loading the C++ one onto a
        // single-board computer would fail before it reached a pin, which says
        // nothing about whether the wiring is right.
        const language = boardOption(board.id).language;
        simulation.loadFirmware(
          language === 'python' ? PI_BLINK_SKETCH : BLINK_SKETCH,
          language,
        );
        simulation.start();

        const anodeKey = `${led.id}:anode`;
        const levels: number[] = [];
        for (let frame = 0; frame < 120; frame++) {
          simulation.tick(0.05);
          levels.push(simulation.pinVoltages().get(anodeKey) ?? -1);
        }

        expect(Math.max(...levels), `${board.name} LED never lit`).toBeGreaterThan(1.5);
        expect(Math.min(...levels), `${board.name} LED never went dark`).toBeLessThan(0.5);
      });
    }
  });
});
