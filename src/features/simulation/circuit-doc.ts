import { BenchBuilder, BUTTON_CAP_COLOURS, type Bench, type BenchSnapshot, type PartInstance } from './bench';
import { DynamicState, partDefinitionById, rotateOffset } from '@/features/parts';

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
}

export function validateCircuit(doc: unknown): string[] {
  const errors: string[] = [];
  if (typeof doc !== 'object' || doc === null) {
    errors.push('document must be an object');
    return errors;
  }
  const d = doc as Record<string, unknown>;
  if (typeof d.version !== 'number' || !Number.isInteger(d.version)) errors.push('version must be an integer');
  if (!Array.isArray(d.parts)) errors.push('parts must be an array');
  if (!Array.isArray(d.wires)) errors.push('wires must be an array');
  if (Array.isArray(d.parts)) {
    const ids = new Set<string>();
    for (let i = 0; i < d.parts.length; i++) {
      const p = d.parts[i];
      if (typeof p !== 'object' || p === null) { errors.push(`parts[${i}] must be an object`); continue; }
      const pp = p as Record<string, unknown>;
      if (typeof pp.id !== 'string' || pp.id === '') errors.push(`parts[${i}].id must be a non-empty string`);
      if (typeof pp.type !== 'string' || pp.type === '') errors.push(`parts[${i}].type must be a non-empty string`);
      if (typeof pp.x !== 'number') errors.push(`parts[${i}].x must be a number`);
      if (typeof pp.y !== 'number') errors.push(`parts[${i}].y must be a number`);
      if (pp.rotation !== undefined && ![0, 90, 180, 270].includes(pp.rotation as number)) errors.push(`parts[${i}].rotation must be 0/90/180/270`);
      if (typeof pp.id === 'string') {
        if (ids.has(pp.id)) errors.push(`duplicate part id: ${pp.id}`);
        ids.add(pp.id);
      }
    }
  }
  if (Array.isArray(d.wires)) {
    for (let i = 0; i < d.wires.length; i++) {
      const w = d.wires[i];
      if (typeof w !== 'object' || w === null) { errors.push(`wires[${i}] must be an object`); continue; }
      const ww = w as Record<string, unknown>;
      if (typeof ww.id !== 'string' || ww.id === '') errors.push(`wires[${i}].id must be a non-empty string`);
      if (typeof ww.from !== 'string') errors.push(`wires[${i}].from must be a string`);
      if (typeof ww.to !== 'string') errors.push(`wires[${i}].to must be a string`);
      if (typeof ww.colour !== 'string') errors.push(`wires[${i}].colour must be a string`);
      if (typeof ww.gaugeAwg !== 'number') errors.push(`wires[${i}].gaugeAwg must be a number`);
      if (!Array.isArray(ww.bends)) errors.push(`wires[${i}].bends must be an array`);
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
 * Resolves a pin reference against a part's definition.
 *
 * Exact id matches win outright (ids are unique within a part). The suffix
 * (text after the last underscore) and label fallbacks are deliberately
 * lenient about short forms like `D13` or `A`, but they only resolve when
 * *exactly one* pin matches — an ambiguous ref such as bare `GND` on a board
 * that carries several grounds is treated as unknown rather than silently
 * picking the first in array order.
 */
function findPin(part: PartInstance, ref: string) {
  const pins = part.definition.pins;
  const exact = pins.find((pin) => pin.id === ref);
  if (exact) return exact;
  const suffixMatches = pins.filter((pin) => pin.id.split('_').pop() === ref);
  if (suffixMatches.length === 1) return suffixMatches[0];
  const labelMatches = pins.filter((pin) => pin.label === ref);
  if (labelMatches.length === 1) return labelMatches[0];
  return undefined;
}

export function compile(doc: unknown): { bench: Bench | null; snapshot: BenchSnapshot | null; dynamicState: DynamicState | null; errors: string[] } {
  const errors = validateCircuit(doc);
  if (errors.length > 0) return { bench: null, snapshot: null, dynamicState: null, errors };
  const d = doc as CircuitDocument;
  if (d.version !== 1) {
    return { bench: null, snapshot: null, dynamicState: null, errors: [`unsupported circuit version: ${d.version}`] };
  }
  const builder = new BenchBuilder();
  const partById = new Map<string, PartInstance>();
  const seenIds = new Set<string>();
  for (const p of d.parts) {
    if (seenIds.has(p.id)) { errors.push(`duplicate part id: ${p.id}`); continue; }
    seenIds.add(p.id);
    const definition = partDefinitionById(p.type);
    if (!definition) { errors.push(`unknown part type: ${p.type}`); continue; }
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
      const [partId, knobId] = key.split(':');
      const part = partById.get(partId);
      if (!part) { errors.push(`knob references unknown part: ${partId}`); continue; }
      const spec = part.definition.knobs?.find((k) => k.id === knobId);
      if (!spec) { errors.push(`unknown knob: ${key}`); continue; }
      dynamicState.setKnob(partId, spec, value);
    }
  }
  for (const w of d.wires) {
    const fromMatch = /^([^:]+):(.+)$/.exec(w.from);
    const toMatch = /^([^:]+):(.+)$/.exec(w.to);
    if (!fromMatch || !toMatch) { errors.push(`invalid pin reference in wire ${w.id}`); continue; }
    const fromPart = partById.get(fromMatch[1]);
    const toPart = partById.get(toMatch[1]);
    if (!fromPart || !toPart) { errors.push(`wire ${w.id} references unknown part`); continue; }
    const fromPin = findPin(fromPart, fromMatch[2]);
    const toPin = findPin(toPart, toMatch[2]);
    if (!fromPin || !toPin) { errors.push(`wire ${w.id} references unknown pin`); continue; }
    const fromOff = rotateOffset(fromPin.x, fromPin.y, fromPart.rotation, fromPart.definition.widthMm, fromPart.definition.heightMm);
    const toOff = rotateOffset(toPin.x, toPin.y, toPart.rotation, toPart.definition.widthMm, toPart.definition.heightMm);
    builder.addWireWithId(w.id, fromPart.x + fromOff.x, fromPart.y + fromOff.y, toPart.x + toOff.x, toPart.y + toOff.y, {
      colour: w.colour,
      gaugeAwg: w.gaugeAwg,
      bends: w.bends,
    });
  }
  const bench = builder.build();
  const snapshot = builder.snapshot();
  return { bench, snapshot, dynamicState, errors };
}

export function decompile(bench: Bench, dynamicState: DynamicState): { doc: CircuitDocument; warnings: string[] } {
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
    wires.push({
      id: wire.id,
      from: `${from.partId}:${from.pinId}`,
      to: `${to.partId}:${to.pinId}`,
      colour: wire.colour,
      gaugeAwg: wire.gaugeAwg,
      bends: wire.bends.map((b) => ({ x: b.x, y: b.y })),
    });
  }
  wires.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const knobs: Record<string, number> = {};
  for (const [key, value] of dynamicState.entries()) {
    const partId = key.split(':')[0];
    if (bench.parts.some((p) => p.id === partId)) knobs[key] = value;
  }
  const state = Object.keys(knobs).length > 0 ? { knobs } : undefined;
  const doc: CircuitDocument = { version: 1, parts, wires, ...(state ? { state } : {}) };
  return { doc, warnings };
}
