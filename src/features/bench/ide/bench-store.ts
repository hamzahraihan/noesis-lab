// Centralised bench chrome state, backed by zustand.
//
// `Bench.tsx` carried ~20 `useState` hooks for panels, tabs, selection and
// the wire palette. They are all chrome: they survive board switches (the
// route keeps the component mounted) and no test touches them, so a module
// singleton is the same behaviour with one subscription per slice instead
// of one hook per field. Board/run-scoped state (project, example, avrMode,
// compile progress, frame tick) stays local in `Bench`.
import { create } from 'zustand';
import {
  DEFAULT_LAYOUT,
  clampLayoutSizes,
  loadLayoutSizes,
  nextActivity,
  repairCenterKey,
  saveLayoutSizes,
  type Activity,
  type BottomKey,
  type CenterKey,
  type LayoutSizes,
} from './shell-state';
import { DEFAULT_WIRE_COLOUR } from '../wiring/wire-colours';

function readLayout(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLayout(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Session-only: the debounced save retries next change.
  }
}

function initialLayout(): LayoutSizes {
  try {
    return clampLayoutSizes(loadLayoutSizes(readLayout), window.innerHeight);
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

interface LayoutStore {
  layout: LayoutSizes;
  nudge: (key: keyof LayoutSizes, delta: number) => void;
  resetKey: (key: keyof LayoutSizes) => void;
}

export const useLayoutStore = create<LayoutStore>()((set) => ({
  layout:
    typeof window === 'undefined' ? { ...DEFAULT_LAYOUT } : initialLayout(),
  nudge: (key, delta) =>
    set((s) => {
      try {
        return {
          layout: clampLayoutSizes(
            { ...s.layout, [key]: s.layout[key] + delta },
            window.innerHeight,
          ),
        };
      } catch {
        return { layout: clampLayoutSizes({ ...s.layout, [key]: s.layout[key] + delta }) };
      }
    }),
  resetKey: (key) => set((s) => ({ layout: { ...s.layout, [key]: DEFAULT_LAYOUT[key] } })),
}));

/** Debounced persistence previously lived inline in `Bench`; one call site now. */
export function persistLayoutSoon(layout: LayoutSizes): () => void {
  const timer = setTimeout(() => saveLayoutSizes(writeLayout, layout), 300);
  return () => clearTimeout(timer);
}

export interface PaletteAnchor {
  wireId: string;
  x: number;
  y: number;
}

interface ShellStore {
  sidebarOpen: boolean;
  activity: Activity;
  activeCenter: CenterKey;
  instrumentsOpen: boolean;
  bottomTab: BottomKey;
  bottomOpen: boolean;
  selectedId: string | null;
  selectedWireId: string | null;
  paletteFor: PaletteAnchor | null;
  wireColour: string;
  guideOpen: boolean;
  projectBannerOpen: boolean;
  baud: number;
  meterRedPin: string | null;
  meterBlackPin: string | null;
  pickActivity: (next: Activity) => void;
  showActivity: (next: Activity) => void;
  setActiveCenter: (key: CenterKey) => void;
  repairCenter: (files: ReadonlyArray<{ name: string }>, fallback: string) => void;
  setBottomTab: (tab: BottomKey) => void;
  setBottomOpen: (open: boolean) => void;
  toggleBottom: () => void;
  setInstrumentsOpen: (open: boolean) => void;
  toggleInstruments: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  selectPart: (id: string | null) => void;
  selectWire: (id: string | null) => void;
  openPalette: (anchor: PaletteAnchor) => void;
  closePalette: () => void;
  clearSelection: () => void;
  clearWire: () => void;
  setWireColour: (colour: string) => void;
  setGuideOpen: (open: boolean) => void;
  setProjectBannerOpen: (open: boolean) => void;
  setBaud: (baud: number) => void;
  setMeterRedPin: (id: string | null) => void;
  setMeterBlackPin: (id: string | null) => void;
}

export const useBenchShellStore = create<ShellStore>()((set) => ({
  sidebarOpen: true,
  activity: 'components',
  activeCenter: 'circuit',
  instrumentsOpen: true,
  bottomTab: 'serial',
  bottomOpen: true,
  selectedId: null,
  selectedWireId: null,
  paletteFor: null,
  wireColour: DEFAULT_WIRE_COLOUR,
  guideOpen: false,
  projectBannerOpen: true,
  baud: 9600,
  meterRedPin: null,
  meterBlackPin: null,
  pickActivity: (next) =>
    set((s) => {
      const r = nextActivity(s.activity, next, s.sidebarOpen);
      return { activity: r.activity, sidebarOpen: r.sidebarOpen };
    }),
  showActivity: (next) => set({ activity: next, sidebarOpen: true }),
  setActiveCenter: (key) => set({ activeCenter: key }),
  repairCenter: (files, fallback) =>
    set((s) => {
      const fixed = repairCenterKey(s.activeCenter, files, fallback);
      return fixed === s.activeCenter ? s : { activeCenter: fixed };
    }),
  setBottomTab: (tab) => set({ bottomTab: tab }),
  setBottomOpen: (open) => set({ bottomOpen: open }),
  toggleBottom: () => set((s) => ({ bottomOpen: !s.bottomOpen })),
  setInstrumentsOpen: (open) => set({ instrumentsOpen: open }),
  toggleInstruments: () => set((s) => ({ instrumentsOpen: !s.instrumentsOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  selectPart: (id) => set({ selectedId: id, paletteFor: null }),
  selectWire: (id) => set({ selectedWireId: id }),
  openPalette: (anchor) => set({ paletteFor: anchor }),
  closePalette: () => set({ paletteFor: null }),
  clearSelection: () => set({ selectedId: null, selectedWireId: null, paletteFor: null }),
  clearWire: () => set({ selectedWireId: null, paletteFor: null }),
  setWireColour: (colour) => set({ wireColour: colour }),
  setGuideOpen: (open) => set({ guideOpen: open }),
  setProjectBannerOpen: (open) => set({ projectBannerOpen: open }),
  setBaud: (baud) => set({ baud }),
  setMeterRedPin: (id) => set({ meterRedPin: id }),
  setMeterBlackPin: (id) => set({ meterBlackPin: id }),
}));
