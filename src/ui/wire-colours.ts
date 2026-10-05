/**
 * Jumper colours.
 *
 * A real bench has a drawer of coloured Dupont wires, and colour is how a person
 * tells two otherwise identical jumpers apart -- which is the whole reason it is
 * worth choosing. Insulation carries no electrical meaning, so the palette is
 * purely a drawing aid and nothing in the solver reads it.
 *
 * The set is Wokwi's, because a diagram that works on one tool should work on
 * the other. Their first ten are numbered rather than named, which is a good
 * convention to copy: a number is unambiguous in every locale and in a
 * screenshot, where "the blue one" is neither.
 */

export interface WireColour {
  /** Wokwi's own label: the number, or a name for the extended set. */
  readonly label: string;
  readonly hex: string;
  /** Ring colour on a swatch, so white and grey are visible on a dark bench. */
  readonly border: string;
}

/** The ten numbered colours, then the extended set Wokwi offers. */
export const WIRE_COLOURS: readonly WireColour[] = [
  { label: '0', hex: '#111111', border: '#6b7280' },
  { label: '1', hex: '#ef4444', border: '#111111' },
  { label: '2', hex: '#f97316', border: '#111111' },
  { label: '3', hex: '#facc15', border: '#111111' },
  { label: '4', hex: '#22c55e', border: '#111111' },
  { label: '5', hex: '#3b82f6', border: '#111111' },
  { label: '6', hex: '#a855f7', border: '#111111' },
  { label: '7', hex: '#e5e7eb', border: '#111111' },
  { label: '8', hex: '#6b7280', border: '#111111' },
  { label: '9', hex: '#92400e', border: '#111111' },
  { label: 'pink', hex: '#ec4899', border: '#111111' },
  { label: 'lime', hex: '#a3e635', border: '#111111' },
  { label: 'cyan', hex: '#06b6d4', border: '#111111' },
];

/** The colour a wire gets when the operator has not chosen one. */
export const DEFAULT_WIRE_COLOUR = WIRE_COLOURS[1].hex;

/**
 * Picks the next colour for a wire the operator has not coloured themselves.
 *
 * Cycles rather than randomises: a bench wired entirely in red is unreadable,
 * and a cycling palette guarantees consecutive wires differ. Black and white are
 * skipped for automatic assignment -- they read as "no wire" and "highlighted"
 * respectively -- but both stay selectable, because sometimes that is exactly
 * what a person wants.
 */
const AUTOMATIC_COLOURS = WIRE_COLOURS.filter(
  (colour) => colour.hex !== '#111111' && colour.hex !== '#e5e7eb',
);

export function nextAutomaticWireColour(wireCount: number): string {
  return AUTOMATIC_COLOURS[wireCount % AUTOMATIC_COLOURS.length].hex;
}
