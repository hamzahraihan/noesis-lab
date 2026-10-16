import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  EXERCISES,
  exerciseBoard,
  exerciseById,
  exerciseLanguage,
  firstExercise,
  type Exercise,
} from './exercises';
import { Simulation } from '@/features/bench/simulations/simulation';
import { boardOption } from './boardRegistry';
import { PART_CATALOGUE } from '@/features/parts';

/**
 * The curriculum has to be true, not just present.
 *
 * Nine exercises is a lot of hand-written content, and content drifts: a part
 * gets renamed in the catalogue, a sketch reaches for a C++ construct the
 * interpreter does not have, a wiring row names a pin that does not exist. Each
 * of those is invisible until a learner hits it, which is the worst place to
 * find out. These tests are what makes the drift a build failure instead.
 */

const CATALOGUE_NAMES = new Set(PART_CATALOGUE.map((entry) => entry.make().name));
import { breadboardDefinition } from '@/features/parts';

/**
 * A bench with the board and breadboard already placed.
 *
 * Not decoration: `new Simulation(board)` builds the MCU but does not put the
 * board on the bench. Without it, an exercise's `boardTerminal('D8')` resolves
 * to a coordinate nothing occupies, every wire claims a loose contact of its
 * own, and the circuit is drawn but electrically dead -- no LED lights and
 * every input reads zero. These tests have to run against a real bench or they
 * would have passed that for months.
 */
function freshBench(exercise?: Exercise) {
  /*
   * On the board the exercise is written for. Most of the curriculum is Uno
   * lessons and `exerciseBoard` says so for them; the one that is not gets its
   * own board, because running its wiring against an Uno would resolve every
   * `boardTerminal('GPIO11')` to nothing and leave the circuit drawn and dead.
   */
  const board = boardOption(exercise ? exerciseBoard(exercise) : 'uno').make();
  const simulation = new Simulation(board);
  simulation.addPart(board, 0, 0);
  simulation.addPart(breadboardDefinition(), 230, 0);
  return simulation;
}

/** Every contact that belongs to a part -- that is, one a wire can really join. */
function partTerminals(simulation: Simulation): Set<number> {
  const ids = new Set<number>();
  for (const part of simulation.bench.parts) {
    for (const id of Object.values(part.terminals)) ids.add(id);
  }
  return ids;
}

describe('the exercise curriculum', () => {
  it('is not empty, and starts where a beginner can start', () => {
    expect(EXERCISES.length).toBeGreaterThan(0);
    expect(firstExercise().level).toBe(1);
  });

  it('numbers every exercise uniquely', () => {
    const ids = EXERCISES.map((exercise) => exercise.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps its ids in curriculum order, so the levels never go backwards', () => {
    let previous = 0;
    for (const exercise of EXERCISES) {
      expect(exercise.level).toBeGreaterThanOrEqual(previous);
      previous = exercise.level;
    }
  });

  it('finds every exercise by the id its page is addressed with', () => {
    for (const exercise of EXERCISES) {
      expect(exerciseById(exercise.id)).toBe(exercise);
    }
    expect(exerciseById('nope')).toBeNull();
  });

  it('names only parts the catalogue actually stocks', () => {
    for (const exercise of EXERCISES) {
      for (const entry of exercise.parts) {
        expect(CATALOGUE_NAMES.has(entry.name), `${exercise.id} part "${entry.name}"`).toBe(
          true,
        );
      }
      for (const row of exercise.wiring) {
        expect(CATALOGUE_NAMES.has(row.part), `${exercise.id} wiring part "${row.part}"`).toBe(
          true,
        );
      }
    }
  });

  it('gives every exercise the guidance a stuck learner needs', () => {
    for (const exercise of EXERCISES) {
      // Three is the floor, not a target: a learner who is stuck on an exercise
      // with one hint has run out of hints while still stuck.
      expect(exercise.hints.length, `${exercise.id} hints`).toBeGreaterThanOrEqual(3);
      expect(exercise.references.length, `${exercise.id} references`).toBeGreaterThanOrEqual(3);
      expect(exercise.steps.length, `${exercise.id} steps`).toBeGreaterThan(0);
      expect(exercise.concepts.length, `${exercise.id} concepts`).toBeGreaterThan(0);
    }
  });

  it('loads every sketch through the real parser', () => {
    for (const exercise of EXERCISES) {
      const simulation = freshBench(exercise);
      simulation.loadFirmware(exercise.sketch, exerciseLanguage(exercise));
      // A sketch the interpreter cannot parse reports here rather than silently
      // doing nothing on the bench.
      expect(simulation.firmwareError, `${exercise.id} sketch: ${simulation.firmwareError}`)
        .toBeNull();
    }
  });

  it('gives every sketch the entry point its language needs', () => {
    /*
     * A C++ sketch is entered twice: `setup()` then `loop()`, over and over. A
     * Python one is not -- the module body runs from top to bottom and never
     * returns -- so the check is that a Python sketch ends in a loop it will
     * stay in, rather than that it defines two functions it has no way to name.
     */
    for (const exercise of EXERCISES) {
      if (exerciseLanguage(exercise) === 'python') {
        expect(exercise.sketch, `${exercise.id}`).toContain('while True:');
        continue;
      }
      expect(exercise.sketch, `${exercise.id}`).toContain('void setup()');
      expect(exercise.sketch, `${exercise.id}`).toContain('void loop()');
    }
  });

  it('wires each exercise onto the bench without throwing', () => {
    for (const exercise of EXERCISES) {
      const simulation = freshBench(exercise);
      // The setup is the one thing in the curriculum that touches the model, and
      // it is the only part that can go wrong at runtime: a pin name that does
      // not resolve, or a terminal the catalogue renamed.
      expect(() => exercise.setup(simulation), `${exercise.id} setup`).not.toThrow();
    }
  });

  it('puts the parts each exercise says it needs on the bench', () => {
    for (const exercise of EXERCISES) {
      const simulation = freshBench(exercise);
      exercise.setup(simulation);
      const placed = new Map(simulation.bench.parts.map((p) => [p.definition.name, 0]));
      for (const p of simulation.bench.parts) {
        placed.set(p.definition.name, (placed.get(p.definition.name) ?? 0) + 1);
      }
      for (const entry of exercise.parts) {
        expect(placed.get(entry.name) ?? 0, `${exercise.id} "${entry.name}" qty`).toBeGreaterThanOrEqual(
          entry.qty,
        );
      }
    }
  });

  it('adds jumpers, because a circuit with no wires is not a circuit', () => {
    for (const exercise of EXERCISES) {
      const simulation = freshBench(exercise);
      const before = simulation.bench.wires.length;
      exercise.setup(simulation);
      expect(simulation.bench.wires.length, `${exercise.id} wires`).toBeGreaterThan(before);
    }
  });

  it('joins every jumper to a real part contact, not a loose one', () => {
    for (const exercise of EXERCISES) {
      const simulation = freshBench(exercise);
      exercise.setup(simulation);
      const real = partTerminals(simulation);
      for (const wire of simulation.bench.wires) {
        /*
         * The bug this catches: with no board on the bench, every wire aimed at
         * a board pin lands on a coordinate nothing occupies and quietly claims
         * a terminal of its own. The wires are all there, every terminal
         * exists, and the circuit is dead.
         */
        expect(real.has(wire.from), `${exercise.id} wire ${wire.id} from`).toBe(true);
        expect(real.has(wire.to), `${exercise.id} wire ${wire.id} to`).toBe(true);
      }
    }
  });

  it('connects every part of the circuit back to the board', () => {
    for (const exercise of EXERCISES) {
      const simulation = freshBench(exercise);
      exercise.setup(simulation);

      /*
       * Two kinds of union, then one rule.
       *
       * A part's pins are one node electrically -- the two legs of a resistor
       * are joined by the resistor, not by a jumper -- so each part's contacts
       * are collapsed together first. The jumpers are then collapsed on top.
       * What comes out are the circuit's islands, and every one of them must
       * reach the board.
       *
       * This is the check that catches a circuit drawn but not connected: a
       * wire aimed at a board pin that lands on empty bench still exists, still
       * has two terminals, and still satisfies every structural test above --
       * but its island never reaches the board, so nothing in it is ever
       * driven.
       */
      const boardTerminals = new Set<number>();
      for (const part of simulation.bench.parts) {
        const onBoard = part.definition.id === simulation.mcu.definition.id;
        for (const id of Object.values(part.terminals)) {
          if (onBoard) boardTerminals.add(id);
        }
      }

      const parent = new Map<number, number>();
      const find = (id: number): number => {
        const known = parent.get(id);
        if (known === undefined) {
          parent.set(id, id);
          return id;
        }
        if (known === id) return id;
        const root = find(known);
        parent.set(id, root);
        return root;
      };
      const join = (a: number, b: number) => {
        parent.set(find(a), find(b));
      };

      for (const part of simulation.bench.parts) {
        const pins = Object.values(part.terminals);
        for (let i = 1; i < pins.length; i++) join(pins[0], pins[i]);
      }
      for (const wire of simulation.bench.wires) join(wire.from, wire.to);

      // Only contacts a jumper touches are worth an opinion. The breadboard has
      // hundreds of holes nothing is wired to, and each of those is trivially an
      // island the board cannot reach -- which says nothing about the circuit.
      const wired = new Set<number>();
      for (const wire of simulation.bench.wires) {
        wired.add(wire.from);
        wired.add(wire.to);
      }
      const islands = new Map<number, boolean>();
      for (const terminal of wired) {
        const root = find(terminal);
        islands.set(root, (islands.get(root) ?? false) || boardTerminals.has(terminal));
      }

      for (const [root, touches] of islands) {
        expect(touches, `${exercise.id} leaves island ${root} unreachable from the board`).toBe(
          true,
        );
      }
    }
  });

  it('carries module 5 as two lessons: the map, then the pocket map', () => {
    /*
     * The Pi lesson was written and then left out of EXERCISES -- a lesson
     * nobody could take, and nothing failed. The whole module is the guard:
     * both lessons and their order, because a lesson that drops off the
     * curriculum is a page that 404s rather than a build that fails.
     */
    const moduleFive = EXERCISES.filter((exercise) => exercise.id.startsWith('5.')).map(
      (exercise) => exercise.id,
    );
    expect(moduleFive).toEqual(['5.1', '5.2']);
  });

  it('points every lesson at a write-up that exists', () => {
    /*
     * The exercise page tells the learner the full write-up is in the
     * repository at this path. A path that names a file nobody wrote is a
     * promise the repository cannot keep -- and both halves of module 5 have
     * made that mistake once, in opposite directions.
     */
    for (const exercise of EXERCISES) {
      expect(
        existsSync(join(__dirname, '..', '..', '..', exercise.writeUp)),
        `${exercise.id} write-up "${exercise.writeUp}"`,
      ).toBe(true);
    }
  });
});
