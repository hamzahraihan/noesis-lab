// Workbench canvas view + half-drawn jumper, backed by zustand.
//
// Previously five `useState` hooks (`wireAnchor`, `wireBends`, `pointerMm`,
// `view`, `aspect`) plus three call sites spelling `setWireAnchor(null)` +
// `setWireBends([])`. One store collapses the draft to `cancelDraft()` and
// the view to direct patches, saving a line at every call site.
import { create } from 'zustand';
import type { Terminal } from '@/features/simulation';
import type { BenchBounds } from '../wiring/bounds';
import type { Point } from '../wiring/wire-route';

export interface ViewBox {
  x: number;
  y: number;
  width: number;
}

export const DEFAULT_ASPECT = 16 / 10;

/**
 * The narrowest and widest the view box may become.
 *
 * Zoom notches clamp to these, and so does a fit: a bench with two parts
 * should not arrive magnified until the breadboard fills the screen, and a
 * circuit wider than the bench's own world should not arrive as a speck.
 */
export const MIN_VIEW_WIDTH_MM = 24;
export const MAX_VIEW_WIDTH_MM = 900;

/** Breathing room around a fitted circuit, in millimetres. */
const FIT_MARGIN_MM = 12;

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
  /** Centres and sizes the view on a circuit, or leaves it alone for null. */
  fitTo: (bounds: BenchBounds | null) => void;
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
  fitTo: (bounds) =>
    set((s) => {
      if (bounds === null) return s;
      /*
       * The width has to satisfy both dimensions: the view's height is
       * `width / aspect`, so a wide circuit and a tall one each get the width
       * that fits them, and the clamp keeps either from arriving absurd.
       */
      const width = Math.min(
        Math.max(bounds.width + FIT_MARGIN_MM * 2, (bounds.height + FIT_MARGIN_MM * 2) * s.aspect),
        MAX_VIEW_WIDTH_MM,
      );
      const clamped = Math.max(MIN_VIEW_WIDTH_MM, width);
      const height = clamped / s.aspect;
      return {
        view: {
          x: bounds.x + bounds.width / 2 - clamped / 2,
          y: bounds.y + bounds.height / 2 - height / 2,
          width: clamped,
        },
      };
    }),
}));
