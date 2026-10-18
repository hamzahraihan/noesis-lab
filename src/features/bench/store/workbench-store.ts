// Workbench canvas view + half-drawn jumper, backed by zustand.
//
// Previously five `useState` hooks (`wireAnchor`, `wireBends`, `pointerMm`,
// `view`, `aspect`) plus three call sites spelling `setWireAnchor(null)` +
// `setWireBends([])`. One store collapses the draft to `cancelDraft()` and
// the view to direct patches, saving a line at every call site.
import { create } from 'zustand';
import type { Terminal } from '@/features/simulation';
import type { Point } from '../wiring/wire-route';

export interface ViewBox {
  x: number;
  y: number;
  width: number;
}

export const DEFAULT_ASPECT = 16 / 10;
const INITIAL_VIEW: ViewBox = { x: -12, y: -10, width: 428 };

interface WorkbenchStore {
  wireAnchor: Terminal | null;
  wireBends: readonly Point[];
  pointerMm: { x: number; y: number } | null;
  view: ViewBox;
  aspect: number;
  startDraft: (terminal: Terminal) => void;
  pushBend: (bend: Point) => void;
  cancelDraft: () => void;
  setPointer: (p: { x: number; y: number } | null) => void;
  setView: (view: ViewBox) => void;
  panBy: (dx: number, dy: number) => void;
  setAspect: (aspect: number) => void;
}

export const useWorkbenchStore = create<WorkbenchStore>()((set) => ({
  wireAnchor: null,
  wireBends: [],
  pointerMm: null,
  view: INITIAL_VIEW,
  aspect: DEFAULT_ASPECT,
  startDraft: (terminal) => set({ wireAnchor: terminal, wireBends: [] }),
  pushBend: (bend) => set((s) => ({ wireBends: [...s.wireBends, bend] })),
  cancelDraft: () =>
    set((s) =>
      s.wireAnchor === null && s.wireBends.length === 0 ? s : { wireAnchor: null, wireBends: [] },
    ),
  setPointer: (p) => set({ pointerMm: p }),
  setView: (view) => set({ view }),
  panBy: (dx, dy) => set((s) => ({ view: { ...s.view, x: s.view.x - dx, y: s.view.y - dy } })),
  setAspect: (aspect) => set((s) => (s.aspect === aspect ? s : { aspect })),
}));
