import { beforeEach, describe, expect, it } from 'vitest';
import { useBenchShellStore, useLayoutStore } from './bench-store';
import { DEFAULT_LAYOUT } from './shell-state';
import { DEFAULT_WIRE_COLOUR } from '../wiring/wire-colours';

beforeEach(() => {
  useBenchShellStore.setState(
    {
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
    },
    false,
  );
  useLayoutStore.setState({ layout: { ...DEFAULT_LAYOUT } }, false);
});

describe('useBenchShellStore', () => {
  it('toggles the sidebar when re-picking the active activity', () => {
    const { pickActivity } = useBenchShellStore.getState();
    expect(useBenchShellStore.getState().sidebarOpen).toBe(true);
    pickActivity('components');
    expect(useBenchShellStore.getState().sidebarOpen).toBe(false);
    pickActivity('files');
    expect(useBenchShellStore.getState()).toMatchObject({ activity: 'files', sidebarOpen: true });
  });

  it('opens an activity unconditionally via showActivity', () => {
    useBenchShellStore.getState().showActivity('components');
    expect(useBenchShellStore.getState()).toMatchObject({
      activity: 'components',
      sidebarOpen: true,
    });
  });

  it('repairs a stale center key against the file list', () => {
    const s = useBenchShellStore.getState();
    s.setActiveCenter('gone.h');
    s.repairCenter([{ name: 'a.ino' }], 'a.ino');
    expect(useBenchShellStore.getState().activeCenter).toBe('a.ino');
  });

  it('clears the palette when a part is picked, and all selection on clear', () => {
    const s = useBenchShellStore.getState();
    s.openPalette({ wireId: 'w1', x: 1, y: 2 });
    s.selectPart('p1');
    expect(useBenchShellStore.getState()).toMatchObject({ selectedId: 'p1', paletteFor: null });
    s.selectWire('w1');
    s.clearWire();
    expect(useBenchShellStore.getState()).toMatchObject({ selectedWireId: null, paletteFor: null });
    s.selectPart('p1');
    s.selectWire('w1');
    s.clearSelection();
    expect(useBenchShellStore.getState()).toMatchObject({
      selectedId: null,
      selectedWireId: null,
      paletteFor: null,
    });
  });

  it('toggles panels', () => {
    const s = useBenchShellStore.getState();
    s.toggleBottom();
    s.toggleInstruments();
    s.toggleSidebar();
    expect(useBenchShellStore.getState()).toMatchObject({
      bottomOpen: false,
      instrumentsOpen: false,
      sidebarOpen: false,
    });
  });
});

describe('useLayoutStore', () => {
  it('starts from defaults in node and clamps nudges', () => {
    expect(useLayoutStore.getState().layout).toEqual(DEFAULT_LAYOUT);
    useLayoutStore.getState().nudge('sidebarWidth', -10000);
    expect(useLayoutStore.getState().layout.sidebarWidth).toBe(176);
  });

  it('resets one key without touching the others', () => {
    useLayoutStore.getState().nudge('sidebarWidth', 44);
    useLayoutStore.getState().resetKey('sidebarWidth');
    expect(useLayoutStore.getState().layout.sidebarWidth).toBe(DEFAULT_LAYOUT.sidebarWidth);
  });
});
