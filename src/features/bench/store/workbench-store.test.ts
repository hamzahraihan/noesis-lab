import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ASPECT, useWorkbenchStore } from './workbench-store';

const initialView = { x: -12, y: -10, width: 428 };

beforeEach(() => {
  useWorkbenchStore.setState({
    wireAnchor: null,
    wireBends: [],
    pointerMm: null,
    view: { ...initialView },
    aspect: DEFAULT_ASPECT,
  });
});

describe('useWorkbenchStore', () => {
  it('starts and cancels a routing draft', () => {
    const anchor = { id: 3, x: 1, y: 2 };
    useWorkbenchStore.getState().startDraft(anchor);
    useWorkbenchStore.getState().pushBend({ x: 4, y: 5 });
    expect(useWorkbenchStore.getState().wireBends).toHaveLength(1);
    useWorkbenchStore.getState().cancelDraft();
    expect(useWorkbenchStore.getState()).toMatchObject({ wireAnchor: null, wireBends: [] });
  });

  it('pans the view by a delta', () => {
    useWorkbenchStore.getState().panBy(10, 4);
    expect(useWorkbenchStore.getState().view).toMatchObject({ x: -22, y: -14, width: 428 });
  });

  it('ignores redundant aspect updates', () => {
    const before = useWorkbenchStore.getState();
    useWorkbenchStore.getState().setAspect(before.aspect);
    expect(useWorkbenchStore.getState().aspect).toBe(before.aspect);
    useWorkbenchStore.getState().setAspect(2);
    expect(useWorkbenchStore.getState().aspect).toBe(2);
  });
});
