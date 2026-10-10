// FirmwareEditor chrome state, backed by zustand.
//
// `FirmwareEditor` (Panels.tsx) carried 13 `useState` hooks for the notice
// bar, the Libraries popup, the slot pick, and the Library Manager browse +
// install flow. There is exactly one editor instance (the bench center tab),
// so a module singleton behaves identically with one subscription instead
// of one hook per field. Monaco view states and the install AbortController
// stay refs: they are never rendered from.
import { create } from 'zustand';
import type { IndexLibrary } from '@/features/simulation';

export interface InstallingMark {
  name: string;
  version: string;
}

export interface InstalledEntry {
  version: string;
  headers: readonly string[];
}

interface FirmwareEditorStore {
  notice: string | null;
  libsPopupOpen: boolean;
  slotId: string | null;
  slotPath: string | null;
  browseOpen: boolean;
  indexLibs: readonly IndexLibrary[] | null;
  indexLoading: boolean;
  query: string;
  debouncedQuery: string;
  category: string;
  selectedName: string | null;
  pinnedVersion: string | null;
  installing: InstallingMark | null;
  installedIndex: ReadonlyMap<string, InstalledEntry>;
  setNotice: (notice: string | null) => void;
  setLibsPopupOpen: (open: boolean) => void;
  toggleLibsPopup: () => void;
  pickSlotFile: (id: string | null, path: string | null) => void;
  setBrowseOpen: (open: boolean) => void;
  toggleBrowse: () => void;
  setIndexLibs: (libs: readonly IndexLibrary[]) => void;
  setIndexLoading: (loading: boolean) => void;
  setQuery: (query: string) => void;
  setDebouncedQuery: (query: string) => void;
  setCategory: (category: string) => void;
  setSelectedName: (name: string | null) => void;
  setPinnedVersion: (version: string | null) => void;
  setInstalling: (mark: InstallingMark | null) => void;
  /** Merges restored builds without overwriting entries installed this session. */
  mergeInstalled: (restored: ReadonlyMap<string, InstalledEntry>) => void;
  setInstalled: (name: string, entry: InstalledEntry) => void;
  removeInstalled: (name: string) => void;
}

export const useFirmwareEditorStore = create<FirmwareEditorStore>()((set) => ({
  notice: null,
  libsPopupOpen: false,
  slotId: null,
  slotPath: null,
  browseOpen: false,
  indexLibs: null,
  indexLoading: false,
  query: '',
  debouncedQuery: '',
  category: 'all',
  selectedName: null,
  pinnedVersion: null,
  installing: null,
  installedIndex: new Map(),
  setNotice: (notice) => set({ notice }),
  setLibsPopupOpen: (open) => set({ libsPopupOpen: open }),
  toggleLibsPopup: () => set((s) => ({ libsPopupOpen: !s.libsPopupOpen })),
  pickSlotFile: (id, path) => set({ slotId: id, slotPath: path }),
  setBrowseOpen: (open) => set({ browseOpen: open }),
  toggleBrowse: () => set((s) => ({ browseOpen: !s.browseOpen })),
  setIndexLibs: (libs) => set({ indexLibs: libs }),
  setIndexLoading: (loading) => set({ indexLoading: loading }),
  setQuery: (query) => set({ query }),
  setDebouncedQuery: (query) => set({ debouncedQuery: query }),
  setCategory: (category) => set({ category }),
  setSelectedName: (name) => set({ selectedName: name }),
  setPinnedVersion: (version) => set({ pinnedVersion: version }),
  setInstalling: (mark) => set({ installing: mark }),
  mergeInstalled: (restored) =>
    set((s) => {
      if (restored.size === 0) return s;
      const next = new Map(s.installedIndex);
      for (const [name, entry] of restored) {
        if (!next.has(name)) next.set(name, entry);
      }
      return { installedIndex: next };
    }),
  setInstalled: (name, entry) =>
    set((s) => ({ installedIndex: new Map(s.installedIndex).set(name, entry) })),
  removeInstalled: (name) =>
    set((s) => {
      if (!s.installedIndex.has(name)) return s;
      const next = new Map(s.installedIndex);
      next.delete(name);
      return { installedIndex: next };
    }),
}));
