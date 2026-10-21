// The stops a person set on the sketch, and the debugger that holds them.
//
// The stops live here rather than in the editor because they belong to the
// bench and not to a tab: a stop on line 12 is still a stop when the editor
// shows another file, and the panel that lists them is not the editor. The
// debugger is the state that decides whether the program stops, so the store
// holds it and the bench hands it to the simulation it is running.

import { create } from 'zustand';
import { FirmwareDebugger, type Breakpoint } from '@/features/simulation';

interface DebugStore {
  /** The debugger that holds the stops and answers the program's question. */
  readonly watcher: FirmwareDebugger;
  /** Every stop, for the editor's margin and the panel's list. */
  readonly stops: readonly Breakpoint[];
  /** Sets a stop on a line, or takes it off. */
  toggleStop(file: string, line: number): void;
  /** Forgets every stop, which is what a new sketch does. */
  clearStops(): void;
}

export const useDebugStore = create<DebugStore>()((set) => ({
  watcher: new FirmwareDebugger(),
  stops: [],
  toggleStop: (file, line) =>
    set((state) => {
      state.watcher.toggleBreakpoint(file, line);
      return { stops: state.watcher.breakpoints() };
    }),
  clearStops: () =>
    set((state) => {
      state.watcher.clear();
      return { stops: [] };
    }),
}));
