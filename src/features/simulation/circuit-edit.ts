/**
 * The operator's changes, as functions over the circuit document.
 *
 * The document is the circuit's structure: every gesture that changes what is
 * wired, where a part sits, or how it reads becomes one of these functions,
 * and the bench is rebuilt from the result. Keeping them pure means a change
 * can be tested without a bench, undo is a stack of documents, and nothing can
 * edit the projection into a state the document could not represent.
 *
 * Every function returns a result rather than throwing: `doc` is always a
 * valid document (the input when the operation refused) and `error` says why
 * it refused, in the same collected-string style `compile` uses. Placements and
 * routings report what they allocated in `partId` / `wireId`.
 */

import { partDefinitionById, type PartDefinition } from '@/features/parts';
import { BUTTON_CAP_COLOURS } from './bench';
import {
  pinRefFor,
  resolvePin,
  type CircuitDocument,
  type CircuitPart,
  type CircuitWire,
} from './circuit-doc';

/** The four orientations a part can sit in. */
export type PartRotation = 0 | 90 | 180 | 270;

export interface EditResult {
  /** Always a valid document; the input unchanged when `error` is set. */
  readonly doc: CircuitDocument;
  /** The part a placement allocated. */
  readonly partId?: string;
  /** The wire a routing allocated. */
  readonly wireId?: string;
  /** Why the operation refused, or absent when it applied. */
  readonly error?: string;
}

export interface WireEdit {
  /** Insulation colour, as the hex the palette offers. */
  readonly colour: string;
  readonly gaugeAwg: number;
  /** Bends in bench millimetres; omitted means the automatic dogleg. */
  readonly bends?: readonly { readonly x: number; readonly y: number }[];
}

function refused(doc: CircuitDocument, error: string): EditResult {
  return { doc, error };
}

/** The next serial in a `pN` / `wN` sequence, never reusing a live id. */
function nextSerial(ids: readonly string[], prefix: 'p' | 'w'): string {
  let highest = 0;
  for (const id of ids) {
    const match = new RegExp(`^${prefix}(\\d+)$`).exec(id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  const taken = new Set(ids);
  let serial = highest + 1;
  while (taken.has(`${prefix}${serial}`)) serial += 1;
  return `${prefix}${serial}`;
}

function findPart(doc: CircuitDocument, partId: string): CircuitPart | undefined {
  return doc.parts.find((part) => part.id === partId);
}

function splitRef(ref: string): { partId: string; pin: string } | undefined {
  const match = /^([^:]+):(.+)$/.exec(ref);
  return match ? { partId: match[1], pin: match[2] } : undefined;
}

/**
 * Resolves an endpoint to its part and pin, and to the short reference the
 * compiler and decompiler agree on.
 *
 * Canonicalising here is what keeps the document free of two spellings of one
 * pin: `p1:J1_D13` and `p1:D13` are the same endpoint, and only the short form
 * is ever written.
 */
function resolveRef(
  doc: CircuitDocument,
  ref: string,
): { part: CircuitPart; definition: PartDefinition; ref: string } | { error: string } {
  const split = splitRef(ref);
  if (!split) return { error: `invalid pin reference: ${ref}` };
  const part = findPart(doc, split.partId);
  if (!part) return { error: `unknown part: ${split.partId}` };
  const definition = partDefinitionById(part.type);
  if (!definition) return { error: `unknown part type: ${part.type}` };
  const pin = resolvePin(definition, split.pin);
  if (!pin) return { error: `unknown pin: ${ref}` };
  return { part, definition, ref: `${part.id}:${pinRefFor(definition, pin.id)}` };
}

function withPart(
  doc: CircuitDocument,
  partId: string,
  change: (part: CircuitPart) => CircuitPart,
): EditResult {
  const part = findPart(doc, partId);
  if (!part) return refused(doc, `unknown part: ${partId}`);
  return { doc: { ...doc, parts: doc.parts.map((p) => (p.id === partId ? change(p) : p)) } };
}

/** Places a part and reports the id it took. */
export function addPart(
  doc: CircuitDocument,
  type: string,
  x: number,
  y: number,
  rotation: PartRotation = 0,
): EditResult {
  if (!partDefinitionById(type)) return refused(doc, `unknown part type: ${type}`);
  const partId = nextSerial(
    doc.parts.map((part) => part.id),
    'p',
  );
  const part: CircuitPart = { id: partId, type, x, y, rotation };
  return { doc: { ...doc, parts: [...doc.parts, part] }, partId };
}

export function movePart(doc: CircuitDocument, partId: string, x: number, y: number): EditResult {
  return withPart(doc, partId, (part) => ({ ...part, x, y }));
}

export function rotatePart(
  doc: CircuitDocument,
  partId: string,
  rotation: PartRotation,
): EditResult {
  if (![0, 90, 180, 270].includes(rotation)) return refused(doc, `invalid rotation: ${rotation}`);
  return withPart(doc, partId, (part) => ({ ...part, rotation }));
}

/** Takes a part off the bench, and every wire that reached it with it. */
export function removePart(doc: CircuitDocument, partId: string): EditResult {
  if (!findPart(doc, partId)) return refused(doc, `unknown part: ${partId}`);
  const wires = doc.wires.filter(
    (wire) => splitRef(wire.from)?.partId !== partId && splitRef(wire.to)?.partId !== partId,
  );
  return { doc: { ...doc, parts: doc.parts.filter((part) => part.id !== partId), wires } };
}

export function setPartName(doc: CircuitDocument, partId: string, name: string | null): EditResult {
  return withPart(doc, partId, (part) => {
    if (name === null) {
      const { name: _name, ...rest } = part;
      return rest;
    }
    return { ...part, name };
  });
}

export function setCapColour(
  doc: CircuitDocument,
  partId: string,
  colour: string | null,
): EditResult {
  if (colour !== null && !(BUTTON_CAP_COLOURS as readonly string[]).includes(colour)) {
    return refused(doc, `invalid cap colour: ${colour}`);
  }
  return withPart(doc, partId, (part) => {
    if (colour === null) {
      const { capColour: _capColour, ...rest } = part;
      return rest;
    }
    return { ...part, capColour: colour };
  });
}

/** Routes a jumper between two pins and reports the id it took. */
export function addWire(
  doc: CircuitDocument,
  from: string,
  to: string,
  wire: WireEdit,
): EditResult {
  const start = resolveRef(doc, from);
  const end = resolveRef(doc, to);
  if ('error' in start) return refused(doc, start.error);
  if ('error' in end) return refused(doc, end.error);
  if (start.ref === end.ref) return refused(doc, 'a wire needs two different pins');
  const wireId = nextSerial(
    doc.wires.map((candidate) => candidate.id),
    'w',
  );
  const next: CircuitWire = {
    id: wireId,
    from: start.ref,
    to: end.ref,
    colour: wire.colour,
    gaugeAwg: wire.gaugeAwg,
    bends: wire.bends?.map(({ x, y }) => ({ x, y })) ?? [],
  };
  return { doc: { ...doc, wires: [...doc.wires, next] }, wireId };
}

export function removeWire(doc: CircuitDocument, wireId: string): EditResult {
  if (!doc.wires.some((wire) => wire.id === wireId)) return refused(doc, `unknown wire: ${wireId}`);
  return { doc: { ...doc, wires: doc.wires.filter((wire) => wire.id !== wireId) } };
}

/** Recolours a jumper; insulation carries no electrical meaning. */
export function setWireColour(doc: CircuitDocument, wireId: string, colour: string): EditResult {
  const wire = doc.wires.find((candidate) => candidate.id === wireId);
  if (!wire) return refused(doc, `unknown wire: ${wireId}`);
  const next: CircuitWire = { ...wire, colour };
  return {
    doc: {
      ...doc,
      wires: doc.wires.map((candidate) => (candidate.id === wireId ? next : candidate)),
    },
  };
}

/** Re-clips one end of a jumper to another pin. */
export function moveWireEnd(
  doc: CircuitDocument,
  wireId: string,
  end: 'from' | 'to',
  ref: string,
): EditResult {
  const wire = doc.wires.find((candidate) => candidate.id === wireId);
  if (!wire) return refused(doc, `unknown wire: ${wireId}`);
  const resolved = resolveRef(doc, ref);
  if ('error' in resolved) return refused(doc, resolved.error);
  const other = end === 'from' ? wire.to : wire.from;
  if (resolved.ref === other) return refused(doc, 'a wire needs two different pins');
  const next: CircuitWire = { ...wire, [end]: resolved.ref };
  return {
    doc: {
      ...doc,
      wires: doc.wires.map((candidate) => (candidate.id === wireId ? next : candidate)),
    },
  };
}

/** Replaces a jumper's route, without touching its endpoints. */
export function setWireBends(
  doc: CircuitDocument,
  wireId: string,
  bends: readonly { readonly x: number; readonly y: number }[],
): EditResult {
  const wire = doc.wires.find((candidate) => candidate.id === wireId);
  if (!wire) return refused(doc, `unknown wire: ${wireId}`);
  const next: CircuitWire = { ...wire, bends: bends.map(({ x, y }) => ({ x, y })) };
  return {
    doc: {
      ...doc,
      wires: doc.wires.map((candidate) => (candidate.id === wireId ? next : candidate)),
    },
  };
}

/**
 * Moves a knob, clamped to the range its part declares.
 *
 * A knob is operator state, not wiring: the caller writes the same value to
 * the live `DynamicState` so the bench re-solves without a rebuild, and the
 * document keeps it because that is what the next load should start from. The
 * clamp matches `DynamicState.setKnob` — one rule, two places that must agree.
 */
export function setKnob(doc: CircuitDocument, key: string, value: number): EditResult {
  const colon = key.indexOf(':');
  if (colon < 0) return refused(doc, `invalid knob key: ${key}`);
  const partId = key.slice(0, colon);
  const knobId = key.slice(colon + 1);
  const part = findPart(doc, partId);
  if (!part) return refused(doc, `unknown part: ${partId}`);
  const definition = partDefinitionById(part.type);
  if (!definition) return refused(doc, `unknown part type: ${part.type}`);
  const spec = definition.knobs?.find((knob) => knob.id === knobId);
  if (!spec) return refused(doc, `unknown knob: ${key}`);
  const clamped = Math.min(spec.max, Math.max(spec.min, value));
  const knobs = { ...(doc.state?.knobs ?? {}), [`${part.id}:${spec.id}`]: clamped };
  return { doc: { ...doc, state: { ...doc.state, knobs } } };
}
