import {
  BenchBuilder,
  BUTTON_CAP_COLOURS,
  type Bench,
  type BenchSnapshot,
  type PartInstance,
} from './bench';
import {
  DynamicState,
  partDefinitionById,
  rotateOffset,
  validatePartDefinition,
  type PartDefinition,
} from '@/features/parts';

export interface CircuitPart {
  readonly id: string;
  readonly type: string;
  readonly x: number;
  readonly y: number;
  readonly rotation?: 0 | 90 | 180 | 270;
  readonly name?: string;
  readonly capColour?: string;
  readonly initialRtc?: {
    readonly hours: number;
    readonly minutes: number;
    readonly seconds: number;
    readonly nvram?: ReadonlyArray<readonly [number, number]>;
  };
}

export interface CircuitWire {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly colour: string;
  readonly gaugeAwg: number;
  readonly bends: readonly { readonly x: number; readonly y: number }[];
}

export interface CircuitState {
  readonly knobs?: Readonly<Record<string, number>>;
}

export interface CircuitDocument {
  readonly version: number;
  readonly parts: readonly CircuitPart[];
  readonly wires: readonly CircuitWire[];
  readonly state?: CircuitState;
  /*
   * The parts this circuit brings with it.
   *
   * A shipped part is described by the build, so a document that used only those
   * needs nothing here -- which is every circuit in `learn/circuits/`. A part
   * imported from a part file is not, and a document that named one without
   * carrying it would open only on the machine that happened to import it: the
   * wiring would be there and the part would not. So the definition travels with
   * the circuit, resolved **before** the imported parts, which makes a file
   * behave the same wherever it is opened -- the property that makes a shared
   * example worth sharing.
   */
  readonly definitions?: readonly PartDefinition[];
}

export function validateCircuit(doc: unknown): string[] {
  const errors: string[] = [];
  if (typeof doc !== 'object' || doc === null) {
    errors.push('document must be an object');
    return errors;
  }
  const d = doc as Record<string, unknown>;
  if (typeof d.version !== 'number' || !Number.isInteger(d.version))
    errors.push('version must be an integer');
  if (!Array.isArray(d.parts)) errors.push('parts must be an array');
  if (!Array.isArray(d.wires)) errors.push('wires must be an array');
  if (Array.isArray(d.parts)) {
    const ids = new Set<string>();
    for (let i = 0; i < d.parts.length; i++) {
      const p = d.parts[i];
      if (typeof p !== 'object' || p === null) {
        errors.push(`parts[${i}] must be an object`);
        continue;
      }
      const pp = p as Record<string, unknown>;
      if (typeof pp.id !== 'string' || pp.id === '')
        errors.push(`parts[${i}].id must be a non-empty string`);
      if (typeof pp.type !== 'string' || pp.type === '')
        errors.push(`parts[${i}].type must be a non-empty string`);
      if (typeof pp.x !== 'number') errors.push(`parts[${i}].x must be a number`);
      if (typeof pp.y !== 'number') errors.push(`parts[${i}].y must be a number`);
      if (pp.rotation !== undefined && ![0, 90, 180, 270].includes(pp.rotation as number))
        errors.push(`parts[${i}].rotation must be 0/90/180/270`);
      if (typeof pp.id === 'string') {
        if (ids.has(pp.id)) errors.push(`duplicate part id: ${pp.id}`);
        ids.add(pp.id);
      }
    }
  }
  if (Array.isArray(d.wires)) {
    for (let i = 0; i < d.wires.length; i++) {
      const w = d.wires[i];
      if (typeof w !== 'object' || w === null) {
        errors.push(`wires[${i}] must be an object`);
        continue;
      }
      const ww = w as Record<string, unknown>;
      if (typeof ww.id !== 'string' || ww.id === '')
        errors.push(`wires[${i}].id must be a non-empty string`);
      if (typeof ww.from !== 'string') errors.push(`wires[${i}].from must be a string`);
      if (typeof ww.to !== 'string') errors.push(`wires[${i}].to must be a string`);
      if (typeof ww.colour !== 'string') errors.push(`wires[${i}].colour must be a string`);
      if (typeof ww.gaugeAwg !== 'number') errors.push(`wires[${i}].gaugeAwg must be a number`);
      if (!Array.isArray(ww.bends)) errors.push(`wires[${i}].bends must be an array`);
    }
  }
  if (d.definitions !== undefined) {
    if (!Array.isArray(d.definitions)) {
      errors.push('definitions must be an array');
    } else {
      const carried = new Set<string>();
      for (const [i, entry] of d.definitions.entries()) {
        const verdict = validatePartDefinition(entry);
        if (!verdict.ok) {
          errors.push(`definitions[${i}] is not a part: ${verdict.reason}`);
          continue;
        }
        if (carried.has(verdict.definition.id)) {
          errors.push(`duplicate definition: ${verdict.definition.id}`);
          continue;
        }
        carried.add(verdict.definition.id);
      }
    }
  }
  if (d.state !== undefined) {
    const s = d.state as Record<string, unknown>;
    if (typeof s !== 'object' || s === null) {
      errors.push('state must be an object');
    } else if (s.knobs !== undefined) {
      if (typeof s.knobs !== 'object' || s.knobs === null) {
        errors.push('state.knobs must be an object');
      } else {
        for (const [k, v] of Object.entries(s.knobs as Record<string, unknown>)) {
          if (typeof v !== 'number') errors.push(`state.knobs.${k} must be a number`);
        }
      }
    }
  }
  return errors;
}

/**
 * Turns untrusted document data into a `CircuitDocument`, or throws naming the
 * circuit it came from.
 *
 * Every document that enters from outside the type system — an imported data
 * file, a fetched submission — is shape-checked *and* compiled here, so a
 * broken circuit fails where an author can see which one it is instead of
 * half-loading onto a bench. Compiling twice (once here, once at seed time) is
 * the price of that single gate; a document is a few hundred bytes and a
 * shelved bench, not a per-frame cost.
 */
export function parseCircuit(raw: unknown, label: string): CircuitDocument {
  const errors = validateCircuit(raw);
  if (errors.length === 0) errors.push(...compile(raw).errors);
  if (errors.length > 0) throw new Error(`${label}: ${errors.join('; ')}`);
  return raw as CircuitDocument;
}

/**
 * The definition a part type refers to, for a given document.
 *
 * The order is the point: **the circuit's own definitions come first**, then the
 * parts this session imported, then the build's catalogue. A shared circuit is
 * therefore exactly what its author had -- a local import cannot quietly change
 * what a file means -- while a stray id still resolves against the catalogue for
 * every document that was written before any of this existed.
 *
 * Exported because the edits that add a wire or a part resolve a type the same
 * way the compiler does; two rules would let an edit name a part the compiler
 * then refuses.
 */
export function definitionFor(
  doc: CircuitDocument,
  type: string,
): PartDefinition | undefined {
  return doc.definitions?.find((definition) => definition.id === type) ?? partDefinitionById(type);
}

/**
 * A document as it should be written to a file.
 *
 * Definitions the circuit no longer uses are dropped, and a document that needs
 * none omits the field entirely -- which keeps every shipped circuit's bytes
 * exactly as they were, and keeps a saved file honest about what it needs.
 */
export function documentForFile(doc: CircuitDocument): CircuitDocument {
  const used = new Set(doc.parts.map((part) => part.type));
  const definitions = (doc.definitions ?? []).filter((definition) => used.has(definition.id));
  if (definitions.length === (doc.definitions ?? []).length) return doc;
  if (definitions.length === 0) {
    const { definitions: _unused, ...rest } = doc;
    return rest;
  }
  return { ...doc, definitions };
}

/**
 * Resolves a pin reference against a part definition.
 *
 * Exact id matches win outright (ids are unique within a part). The suffix
 * (text after the last underscore) and label fallbacks are deliberately
 * lenient about short forms like `D13` or `A`, but they only resolve when
 * *exactly one* pin matches — an ambiguous ref such as bare `GND` on a board
 * that carries several grounds is treated as unknown rather than silently
 * picking the first in array order.
 *
 * Exported because the document's editors (adding a wire, moving one end)
 * must resolve a reference by the same rule the compiler does; two rules
 * would let an edit save a pin the compiler then refuses.
 */
export function resolvePin(
  definition: PartDefinition,
  ref: string,
): PartDefinition['pins'][number] | undefined {
  const pins = definition.pins;
  const exact = pins.find((pin) => pin.id === ref);
  if (exact) return exact;
  const suffixMatches = pins.filter((pin) => pin.id.split('_').pop() === ref);
  if (suffixMatches.length === 1) return suffixMatches[0];
  const labelMatches = pins.filter((pin) => pin.label === ref);
  if (labelMatches.length === 1) return labelMatches[0];
  return undefined;
}

export function compile(doc: unknown): {
  bench: Bench | null;
  snapshot: BenchSnapshot | null;
  dynamicState: DynamicState | null;
  errors: string[];
} {
  const errors = validateCircuit(doc);
  if (errors.length > 0) return { bench: null, snapshot: null, dynamicState: null, errors };
  const d = doc as CircuitDocument;
  if (d.version !== 1) {
    return {
      bench: null,
      snapshot: null,
      dynamicState: null,
      errors: [`unsupported circuit version: ${d.version}`],
    };
  }
  const builder = new BenchBuilder();
  const partById = new Map<string, PartInstance>();
  const seenIds = new Set<string>();
  for (const p of d.parts) {
    if (seenIds.has(p.id)) {
      errors.push(`duplicate part id: ${p.id}`);
      continue;
    }
    seenIds.add(p.id);
    const definition = definitionFor(d, p.type);
    if (!definition) {
      errors.push(
        `unknown part type: ${p.type} (not shipped, not imported, and this circuit carries no definition for it)`,
      );
      continue;
    }
    const part = builder.addPartWithId(p.id, definition, p.x, p.y, p.rotation ?? 0);
    partById.set(p.id, part);
    if (p.name !== undefined) part.name = p.name;
    if (p.capColour !== undefined) {
      if ((BUTTON_CAP_COLOURS as readonly string[]).includes(p.capColour)) {
        part.capColour = p.capColour;
      } else {
        errors.push(`invalid capColour for ${p.id}: ${p.capColour}`);
      }
    }
    if (p.initialRtc !== undefined) {
      part.initialRtc = {
        hours: p.initialRtc.hours,
        minutes: p.initialRtc.minutes,
        seconds: p.initialRtc.seconds,
        nvram: p.initialRtc.nvram?.map(([a, v]) => [a, v] as const),
      };
    }
  }
  const dynamicState = new DynamicState();
  if (d.state?.knobs) {
    for (const [key, value] of Object.entries(d.state.knobs)) {
      const idx = key.indexOf(':');
      if (idx < 0) continue;
      const partId = key.slice(0, idx);
      const knobId = key.slice(idx + 1);
      const part = partById.get(partId);
      if (!part) continue;
      const spec = part.definition.knobs?.find((k) => k.id === knobId);
      if (!spec) continue;
      dynamicState.setKnob(partId, spec, value);
    }
  }
  for (const w of d.wires) {
    const fromMatch = /^([^:]+):(.+)$/.exec(w.from);
    const toMatch = /^([^:]+):(.+)$/.exec(w.to);
    if (!fromMatch || !toMatch) {
      errors.push(`invalid pin reference in wire ${w.id}`);
      continue;
    }
    const fromPart = partById.get(fromMatch[1]);
    const toPart = partById.get(toMatch[1]);
    if (!fromPart || !toPart) {
      errors.push(`wire ${w.id} references unknown part`);
      continue;
    }
    const fromPin = resolvePin(fromPart.definition, fromMatch[2]);
    const toPin = resolvePin(toPart.definition, toMatch[2]);
    if (!fromPin || !toPin) {
      errors.push(`wire ${w.id} references unknown pin`);
      continue;
    }
    const fromOff = rotateOffset(
      fromPin.x,
      fromPin.y,
      fromPart.rotation,
      fromPart.definition.widthMm,
      fromPart.definition.heightMm,
    );
    const toOff = rotateOffset(
      toPin.x,
      toPin.y,
      toPart.rotation,
      toPart.definition.widthMm,
      toPart.definition.heightMm,
    );
    builder.addWireWithId(
      w.id,
      fromPart.x + fromOff.x,
      fromPart.y + fromOff.y,
      toPart.x + toOff.x,
      toPart.y + toOff.y,
      {
        colour: w.colour,
        gaugeAwg: w.gaugeAwg,
        bends: w.bends,
      },
    );
  }
  const bench = builder.build();
  const snapshot = builder.snapshot();
  return { bench, snapshot, dynamicState, errors };
}

/**
 * Picks a pin reference string for `pinId` that (a) resolves back to the same
 * pin through `resolvePin`, and (b) is as short/human as possible. Preferring
 * the label or suffix keeps round-trips stable for hand-authored documents
 * that use short forms like `D13` or `A`; falling back to the full id keeps
 * ambiguous pins (e.g. multiple GNDs) unambiguous.
 *
 * Exported for the same reason `resolvePin` is: an edit writes the reference
 * the decompiler and the compiler agree on, so no document ever carries two
 * spellings of the same pin.
 */
export function pinRefFor(definition: PartDefinition, pinId: string): string {
  const pin = definition.pins.find((p) => p.id === pinId);
  if (!pin) return pinId;
  // Parts with prefixed pin ids (e.g. Arduino headers `J1_D13`) expose the
  // silkscreen name as the suffix; simple parts (e.g. LEDs) expose it as the
  // label. Prefer the short, unique form in that order so hand-authored
  // references round-trip.
  if (pin.id.includes('_')) {
    const suffix = pin.id.split('_').pop() ?? '';
    if (suffix !== '' && resolvePin(definition, suffix)?.id === pinId) return suffix;
  }
  if (pin.label !== '' && resolvePin(definition, pin.label)?.id === pinId) return pin.label;
  return pinId;
}

export function decompile(
  bench: Bench,
  dynamicState: DynamicState,
): { doc: CircuitDocument; warnings: string[] } {
  const warnings: string[] = [];
  const owners = new Map<number, { partId: string; pinId: string }[]>();
  for (const part of bench.parts) {
    for (const [pinId, terminalId] of Object.entries(part.terminals)) {
      const list = owners.get(terminalId) ?? [];
      list.push({ partId: part.id, pinId });
      owners.set(terminalId, list);
    }
  }
  const parts: CircuitPart[] = bench.parts
    .map((part) => ({
      id: part.id,
      type: part.definition.id,
      x: part.x,
      y: part.y,
      rotation: part.rotation as 0 | 90 | 180 | 270,
      ...(part.name !== undefined ? { name: part.name } : {}),
      ...(part.capColour !== undefined ? { capColour: part.capColour } : {}),
      ...(part.initialRtc !== undefined ? { initialRtc: part.initialRtc } : {}),
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const wires: CircuitWire[] = [];
  for (const wire of bench.wires) {
    const fromOwners = owners.get(wire.from) ?? [];
    const toOwners = owners.get(wire.to) ?? [];
    if (fromOwners.length === 0 || toOwners.length === 0) {
      warnings.push(`wire ${wire.id} has a loose end; skipped`);
      continue;
    }
    // Deterministic tie-break: when multiple parts share a terminal (e.g. a
    // breadboard column), pick the first owner in insertion order. Owners are
    // collected by iterating bench.parts in their stored order, so this is
    // stable across decompile runs of the same bench.
    const from = fromOwners[0];
    const to = toOwners[0];
    if (from.partId === to.partId && from.pinId === to.pinId) {
      warnings.push(`wire ${wire.id} connects a pin to itself; skipped`);
      continue;
    }
    const fromPart = bench.parts.find((p) => p.id === from.partId)!;
    const toPart = bench.parts.find((p) => p.id === to.partId)!;
    wires.push({
      id: wire.id,
      from: `${from.partId}:${pinRefFor(fromPart.definition, from.pinId)}`,
      to: `${to.partId}:${pinRefFor(toPart.definition, to.pinId)}`,
      colour: wire.colour,
      gaugeAwg: wire.gaugeAwg,
      bends: wire.bends.map((b) => ({ x: b.x, y: b.y })),
    });
  }
  wires.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const entries = dynamicState.entries();
  const knobs: Record<string, number> = {};
  const knobKeys = [...entries.keys()]
    .filter((key) => {
      const idx = key.indexOf(':');
      const partId = idx < 0 ? key : key.slice(0, idx);
      return bench.parts.some((p) => p.id === partId);
    })
    .sort();
  for (const key of knobKeys) {
    knobs[key] = entries.get(key)!;
  }
  const state = Object.keys(knobs).length > 0 ? { knobs } : undefined;
  const doc: CircuitDocument = { version: 1, parts, wires, ...(state ? { state } : {}) };
  return { doc, warnings };
}
