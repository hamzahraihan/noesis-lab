/**
 * What every exercise file needs, in one place.
 *
 * The curriculum is split across a file per module so that two people can write
 * two modules at once without editing the same array. That makes this the one
 * place the shared vocabulary has to live: the catalogue lookup, the board
 * constant, and the bench coordinates. If each module file resolved parts its own
 * way, "the part named `220 Resistor`" would stop meaning one thing.
 */

import { PART_CATALOGUE } from '@/features/parts';
import type { PartDefinition } from '@/features/parts';

/**
 * The board the exercises are written for.
 *
 * Shared by the pages that link to a bench and the bench that reads the link,
 * so "the exercise board" cannot be one board in the button and a different one
 * in the handler that answers it.
 */
export const EXERCISE_BOARD = 'uno';

/**
 * The catalogue's parts, by the name the Components list shows.
 *
 * An exercise names its parts in the catalogue's own words, so the lesson and
 * the picker cannot disagree: a worksheet that said "220 Ω Resistor" while the
 * list said "220 Resistor" would send a beginner hunting for a part that does
 * not exist. Going through the catalogue rather than the factories also means
 * an exercise cannot quietly name a part the bench does not stock.
 */
const PART_BY_NAME = new Map<string, PartDefinition>(
  PART_CATALOGUE.map((entry) => {
    const definition = entry.make();
    return [definition.name, definition];
  }),
);

/**
 * The catalogue part an exercise names.
 *
 * Throws rather than returning null: an exercise naming a part the catalogue
 * does not stock is a broken lesson, and the test that loads every exercise
 * should say which part is wrong instead of the wiring quietly coming up short.
 */
export function part(name: string): PartDefinition {
  const found = PART_BY_NAME.get(name);
  if (!found) throw new Error(`no catalogue part named "${name}"`);
  return found;
}

/**
 * Where the exercises put their parts.
 *
 * The breadboard starts at x = 230 and runs to about x = 397, so 415 is the
 * first clear column to its right and the modules stack down from there rather
 * than across. A module straddling the board would hide the holes the rest of
 * the circuit uses, which is the very thing a first exercise teaches.
 */
export const PART_X = 415;
export const PART_Y = 70;
export const PART_STEP = 42;
