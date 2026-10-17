// src/features/bench/store/circuit-store.test.ts
import { describe, expect, it } from 'vitest';
import {
  circuitStorageKey,
  hasCircuit,
  loadCircuit,
  resolveCircuitSeed,
  saveCircuit,
} from './circuit-store';
import type { CircuitDocument } from '@/features/simulation';

describe('circuit store', () => {
  it('round-trips through injected storage', () => {
    const backing = new Map<string, string>();
    const storage = {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => void backing.set(k, v),
      removeItem: (k: string) => void backing.delete(k),
    };
    const doc: CircuitDocument = { version: 1, parts: [{ id: 'b', type: 'arduino-uno-r3', x: 0, y: 0, rotation: 0 }], wires: [] };
    saveCircuit('uno', doc, storage as Storage);
    expect(loadCircuit('uno', storage as Storage)).toEqual(doc);
    expect(circuitStorageKey('uno')).toBe('noesis:circuit:uno');
  });

  it('returns null on corrupt saves', () => {
    const storage = {
      getItem: () => '{broken',
      setItem: () => {},
      removeItem: () => {},
    } as unknown as Storage;
    expect(loadCircuit('uno', storage)).toBeNull();
  });

  it('returns null when the save fails circuit validation', () => {
    const backing = new Map<string, string>([
      [circuitStorageKey('uno'), JSON.stringify({ version: 1.5, parts: [{ id: 'b', type: 'arduino-uno-r3', x: 0, y: 0, rotation: 0 }], wires: [] })],
    ]);
    const storage = {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => void backing.set(k, v),
      removeItem: (k: string) => void backing.delete(k),
    };
    expect(loadCircuit('uno', storage as Storage)).toBeNull();
    expect(hasCircuit('uno', storage as Storage)).toBe(true);
  });

  it('returns null when the save fails to compile', () => {
    const backing = new Map<string, string>([
      [circuitStorageKey('uno'), JSON.stringify({ version: 1, parts: [{ id: 'x', type: 'no-such-part', x: 0, y: 0, rotation: 0 }], wires: [] })],
    ]);
    const storage = {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => void backing.set(k, v),
      removeItem: (k: string) => void backing.delete(k),
    };
    expect(loadCircuit('uno', storage as Storage)).toBeNull();
    expect(hasCircuit('uno', storage as Storage)).toBe(true);
  });

  /*
   * The autosave writes what `decompile` produced from the live bench, so a
   * saved document always carries the board and the breadboard. Reading that
   * document back is the whole point of the slot: if any of those definition
   * ids fails to resolve, the save is silently reported as unreadable and the
   * operator loses the circuit they were working on.
   */
  it('loads back a save that carries the bench the autosave writes', () => {
    const backing = new Map<string, string>();
    const storage = {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => void backing.set(k, v),
      removeItem: (k: string) => void backing.delete(k),
    };
    const doc: CircuitDocument = {
      version: 1,
      parts: [
        { id: 'bb', type: 'breadboard-830', x: 230, y: 0, rotation: 0 },
        { id: 'lcd', type: 'lcd-16x2', x: 100, y: 70, rotation: 0 },
        { id: 'u', type: 'arduino-uno-r3', x: 0, y: 0, rotation: 0 },
      ],
      wires: [{ id: 'w', from: 'u:D12', to: 'lcd:RS', colour: '#a3e635', gaugeAwg: 26, bends: [] }],
    };
    saveCircuit('uno', doc, storage as Storage);
    expect(loadCircuit('uno', storage as Storage)).toEqual(doc);
  });

  it('reports no save when the slot is empty', () => {
    const storage = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    } as unknown as Storage;
    expect(hasCircuit('uno', storage)).toBe(false);
  });
});

describe('resolveCircuitSeed', () => {
  const board = 'arduino-uno-r3';
  const shared: CircuitDocument = { version: 1, parts: [{ id: 'b', type: 'arduino-uno-r3', x: 0, y: 0, rotation: 0 }], wires: [] };
  const saved: CircuitDocument = { version: 1, parts: [{ id: 'b', type: 'arduino-uno-r3', x: 1, y: 1, rotation: 0 }], wires: [] };
  const decode = (payload: string): CircuitDocument | null =>
    payload === 'valid-payload' ? shared : null;

  it('prefers pinned over everything', () => {
    const seed = resolveCircuitSeed({
      boardDefinitionId: board,
      pinned: true,
      sharedPayload: 'valid-payload',
      saved,
      hadUnreadableSave: false,
      decode,
    });
    expect(seed).toEqual({ circuit: null, error: null });
  });

  it('prefers the share payload over the autosave', () => {
    const seed = resolveCircuitSeed({
      boardDefinitionId: board,
      pinned: false,
      sharedPayload: 'valid-payload',
      saved,
      hadUnreadableSave: false,
      decode,
    });
    expect(seed).toEqual({ circuit: shared, error: null });
  });

  it('falls back with a notice on a corrupt share link', () => {
    const seed = resolveCircuitSeed({
      boardDefinitionId: board,
      pinned: false,
      sharedPayload: 'bogus',
      saved,
      hadUnreadableSave: false,
      decode,
    });
    expect(seed.circuit).toBeNull();
    expect(seed.error).toMatch(/share link/);
  });

  it('falls back with a notice on a share payload that fails to compile', () => {
    const badDoc: CircuitDocument = { version: 1, parts: [{ id: 'x', type: 'no-such-part', x: 0, y: 0, rotation: 0 }], wires: [] };
    const decodeBad = (payload: string): CircuitDocument | null =>
      payload === 'bad-payload' ? badDoc : null;
    const seed = resolveCircuitSeed({
      boardDefinitionId: board,
      pinned: false,
      sharedPayload: 'bad-payload',
      saved,
      hadUnreadableSave: false,
      decode: decodeBad,
    });
    expect(seed.circuit).toBeNull();
    expect(seed.error).toMatch(/share link/);
  });

  /*
   * A link carries whatever board its sender was on, and the recipient's bench
   * runs its own pin model. Handing the document over would place a circuit
   * that is drawn but wired to nothing, so it is refused and said in a
   * sentence -- the notice the operator reads, not the compiler's version.
   */
  it('refuses a share payload wired for another board', () => {
    const esp32Doc: CircuitDocument = { version: 1, parts: [{ id: 'b', type: 'esp32-devkit-v1', x: 0, y: 0, rotation: 0 }], wires: [] };
    const seed = resolveCircuitSeed({
      boardDefinitionId: board,
      pinned: false,
      sharedPayload: 'valid-payload',
      saved,
      hadUnreadableSave: false,
      decode: () => esp32Doc,
    });
    expect(seed.circuit).toBeNull();
    expect(seed.error).toMatch(/not wired for this board/);
  });

  it('refuses a document that names no board at all', () => {
    const boardlessDoc: CircuitDocument = { version: 1, parts: [{ id: 'led', type: 'led-red', x: 0, y: 0, rotation: 0 }], wires: [] };
    const seed = resolveCircuitSeed({
      boardDefinitionId: board,
      pinned: false,
      sharedPayload: null,
      saved: boardlessDoc,
      hadUnreadableSave: false,
      decode,
    });
    expect(seed.circuit).toBeNull();
    expect(seed.error).toMatch(/not wired for this board/);
  });

  it('prefers the autosave over empty', () => {
    const seed = resolveCircuitSeed({
      boardDefinitionId: board,
      pinned: false,
      sharedPayload: null,
      saved,
      hadUnreadableSave: false,
      decode,
    });
    expect(seed).toEqual({ circuit: saved, error: null });
  });

  it('falls back with a notice on an unreadable save', () => {
    const seed = resolveCircuitSeed({
      boardDefinitionId: board,
      pinned: false,
      sharedPayload: null,
      saved: null,
      hadUnreadableSave: true,
      decode,
    });
    expect(seed.circuit).toBeNull();
    expect(seed.error).toMatch(/saved project/);
  });

  it('falls back with a notice on a saved doc that fails to compile', () => {
    const badSaved: CircuitDocument = { version: 1, parts: [{ id: 'x', type: 'no-such-part', x: 0, y: 0, rotation: 0 }], wires: [] };
    const seed = resolveCircuitSeed({
      boardDefinitionId: board,
      pinned: false,
      sharedPayload: null,
      saved: badSaved,
      hadUnreadableSave: false,
      decode,
    });
    expect(seed.circuit).toBeNull();
    expect(seed.error).toMatch(/saved project/);
  });

  it('opens empty quietly with nothing to load', () => {
    const seed = resolveCircuitSeed({
      boardDefinitionId: board,
      pinned: false,
      sharedPayload: null,
      saved: null,
      hadUnreadableSave: false,
      decode,
    });
    expect(seed).toEqual({ circuit: null, error: null });
  });
});
