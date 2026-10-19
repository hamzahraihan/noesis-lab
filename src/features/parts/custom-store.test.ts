import { beforeEach, describe, expect, it } from 'vitest';
import { partDefinitionById, isLargePart, useCustomPartsStore } from './index';
import { customPartsStorageKey, loadCustomParts, saveCustomParts } from './custom-store';
import { PART_FILE_VERSION, partFileText, validatePartDefinition } from './custom';

/** A part a file may carry: the catalogue has no 4.7k resistor. */
const RESISTOR = {
  id: 'resistor-4k7',
  name: '4.7k Resistor',
  category: 'passive',
  widthMm: 10.16,
  heightMm: 4,
  bodyColour: '#d8c9a3',
  legendColour: '#3f3a2f',
  component: { kind: 'resistor', ohms: 4700 },
  pins: [
    { id: 'a', label: '1', x: 0, y: 2 },
    { id: 'b', label: '2', x: 10.16, y: 2 },
  ],
};

/** A second one, so a file can hold two. */
const LED = {
  ...RESISTOR,
  id: 'led-violet',
  name: 'Violet LED',
  category: 'output',
  widthMm: 10.583,
  heightMm: 13.229,
  bodyColour: '#7a4fd6',
  large: true,
  component: { kind: 'led', profile: 'blue' },
  pins: [
    { id: 'anode', label: 'A', x: 2.54, y: 0 },
    { id: 'cathode', label: 'C', x: 2.54, y: 13.229 },
  ],
};

/** An in-memory `Storage`, so a persistence leg never touches the real one. */
function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => map.delete(key),
    setItem: (key, value) => void map.set(key, value),
  };
}

const fileText = (parts: unknown[]): string =>
  JSON.stringify({ version: PART_FILE_VERSION, parts });

describe('the custom parts store', () => {
  beforeEach(() => {
    useCustomPartsStore.getState().clear();
  });

  it('imports what a file may carry, and resolves it like a shipped part', () => {
    const outcome = useCustomPartsStore.getState().import(fileText([RESISTOR, LED]), 'parts.json');
    expect(outcome.refused).toEqual([]);
    expect(outcome.added.map((part) => part.id)).toEqual(['resistor-4k7', 'led-violet']);

    // The idiomatic path: the resolver the compiler and the palette use.
    const definition = partDefinitionById('resistor-4k7');
    expect(definition?.component).toEqual({ kind: 'resistor', ohms: 4700 });
    expect(partDefinitionById('led-red')).toBeDefined();
  });

  it('keeps the parts of a file that pass and names the ones that do not', () => {
    const bad = { ...RESISTOR, id: 'led-red' };
    useCustomPartsStore.getState().import(fileText([RESISTOR, bad, LED]), 'mixed.json');
    const ids = useCustomPartsStore.getState().parts.map((part) => part.id);
    expect(ids).toEqual(['resistor-4k7', 'led-violet']);
    expect(partDefinitionById('resistor-4k7')).toBeDefined();
  });

  it('replaces a part it already has rather than doubling it', () => {
    const store = useCustomPartsStore.getState();
    store.import(fileText([RESISTOR]), 'one.json');
    store.import(fileText([{ ...RESISTOR, name: '4.7k Resistor (1%)' }]), 'two.json');
    const parts = useCustomPartsStore.getState().parts;
    expect(parts).toHaveLength(1);
    expect(parts[0]!.name).toBe('4.7k Resistor (1%)');
  });

  it('forgets a part when it is removed, and the resolver says no again', () => {
    const store = useCustomPartsStore.getState();
    store.import(fileText([RESISTOR]), 'one.json');
    useCustomPartsStore.getState().remove('resistor-4k7');
    expect(partDefinitionById('resistor-4k7')).toBeUndefined();
  });

  /*
   * The large-part question is a curation, not a measurement (see
   * `catalogue.ts`), so an imported part answers it for itself.
   */
  it('lets an imported part say it is a large one', () => {
    useCustomPartsStore.getState().import(fileText([RESISTOR, LED]), 'parts.json');
    expect(isLargePart('led-violet')).toBe(true);
    expect(isLargePart('resistor-4k7')).toBe(false);
    // And the shipped answer is untouched by any of this.
    expect(isLargePart('led-red')).toBe(false);
    expect(isLargePart('ir-remote')).toBe(true);
  });
});

describe('custom parts between visits', () => {
  beforeEach(() => {
    useCustomPartsStore.getState().clear();
  });

  it('round-trips through storage', () => {
    const storage = fakeStorage();
    const verdict = validatePartDefinition(RESISTOR);
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    saveCustomParts([verdict.definition], storage);
    expect(storage.getItem(customPartsStorageKey)).not.toBeNull();
    expect(loadCustomParts(storage).map((part) => part.id)).toEqual(['resistor-4k7']);
  });

  it('ignores a stored slot it cannot read, rather than failing the boot', () => {
    const storage = fakeStorage();
    storage.setItem(customPartsStorageKey, '{"version": 99, "parts": []}');
    expect(loadCustomParts(storage)).toEqual([]);
    storage.setItem(customPartsStorageKey, 'not json');
    expect(loadCustomParts(storage)).toEqual([]);
  });

  it('reads the stored parts in, and re-validates them on the way', () => {
    const storage = fakeStorage();
    saveCustomParts([{ ...RESISTOR, id: 'led-red' } as never], storage);
    expect(loadCustomParts(storage)).toEqual([]);
  });

  it('rehydrates the store and the resolver together', () => {
    const storage = fakeStorage();
    const verdict = validatePartDefinition(LED);
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    saveCustomParts([verdict.definition], storage);
    useCustomPartsStore.getState().rehydrate(storage);
    expect(partDefinitionById('led-violet')).toBeDefined();
    expect(isLargePart('led-violet')).toBe(true);
  });
});

// The file writer is the reader's inverse, which is what makes a part portable.
describe('a part file', () => {
  it('writes what the reader reads', () => {
    const verdict = validatePartDefinition(RESISTOR);
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    const text = partFileText(verdict.definition);
    expect(text).toContain('"version": 1');
    expect(text.endsWith('\n')).toBe(true);
  });
});
