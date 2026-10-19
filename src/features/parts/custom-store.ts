/**
 * The parts a session has imported, and the file they came from.
 *
 * A custom part is data (`custom.ts` says what it has to satisfy), so the store
 * is small: a list, a way in, a way out, and the persistence that keeps a bench
 * whole across a reload. It registers itself as the catalogue's source
 * (`custom-registry.ts`), which is how `partDefinitionById` -- and through it
 * `compile`, the palette and the inspector -- finds an imported part without any
 * of them knowing the store exists.
 *
 * Imported on purpose, never implied: nothing here runs until a file is chosen,
 * and `clear()` puts the bench back to shipped parts only.
 */

import { create } from 'zustand';
import type { PartDefinition } from './catalog';
import { readPartFile } from './custom';
import { setCustomPartsSource } from './custom-registry';

/** Where imported parts are kept between visits. */
export const customPartsStorageKey = 'noesis:parts';

/** The stored shape, versioned like the circuit's own slot. */
interface StoredParts {
  readonly version: number;
  readonly parts: readonly PartDefinition[];
}

export interface ImportOutcome {
  readonly added: readonly PartDefinition[];
  readonly refused: readonly { readonly index: number; readonly reason: string }[];
}

/**
 * The browser's storage, or null where there is none.
 *
 * Parts are session-local without it -- a test, a worker, a private window that
 * refuses the slot -- rather than a crash on the way in.
 */
function defaultStorage(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

export function loadCustomParts(storage: Storage | null = defaultStorage()): PartDefinition[] {
  if (storage === null) return [];
  let raw: string | null = null;
  try {
    raw = storage.getItem(customPartsStorageKey);
  } catch {
    return [];
  }
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw) as StoredParts;
    if (parsed.version !== 1 || !Array.isArray(parsed.parts)) return [];
    // Re-validated on the way in: storage is a boundary like any other, and a
    // definition that was fine last visit may name a part this build dropped.
    const kept: PartDefinition[] = [];
    for (const part of parsed.parts) {
      const read = readPartFile(JSON.stringify(part), customPartsStorageKey);
      kept.push(...read.definitions);
    }
    return kept;
  } catch {
    return [];
  }
}

export function saveCustomParts(
  definitions: readonly PartDefinition[],
  storage: Storage | null = defaultStorage(),
): void {
  if (storage === null) return;
  try {
    const stored: StoredParts = { version: 1, parts: definitions };
    storage.setItem(customPartsStorageKey, JSON.stringify(stored));
  } catch {
    /* quota or private mode: the parts stay session-local */
  }
}

export interface CustomPartsStore {
  readonly parts: readonly PartDefinition[];
  readonly import: (text: string, label: string) => ImportOutcome;
  readonly remove: (id: string) => void;
  readonly clear: () => void;
  readonly rehydrate: (storage?: Storage) => void;
}

export const useCustomPartsStore = create<CustomPartsStore>()((set, get) => ({
  parts: [],

  import: (text, label) => {
    const read = readPartFile(text, label);
    const kept = get().parts.filter(
      (part) => !read.definitions.some((definition) => definition.id === part.id),
    );
    const parts = [...kept, ...read.definitions];
    set({ parts });
    saveCustomParts(parts);
    return { added: read.definitions, refused: read.refused };
  },

  remove: (id) => {
    const parts = get().parts.filter((part) => part.id !== id);
    set({ parts });
    saveCustomParts(parts);
  },

  clear: () => {
    set({ parts: [] });
    saveCustomParts([]);
  },

  /** Reads the stored parts in, at boot, before any bench seeds its circuit. */
  rehydrate: (storage) => {
    const parts = loadCustomParts(storage ?? defaultStorage());
    if (parts.length === 0) return;
    set({ parts });
  },
}));

/*
 * Registered once, at module load: the source reads the store live rather than
 * capturing a snapshot, so an import is visible to the catalogue on the next
 * lookup with no notification to anyone.
 */
setCustomPartsSource({
  definition: (id) => useCustomPartsStore.getState().parts.find((part) => part.id === id) ?? null,
  isLarge: (id) =>
    useCustomPartsStore.getState().parts.find((part) => part.id === id)?.large === true,
});
