import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ASPECT, MAX_VIEW_WIDTH_MM, useWorkbenchStore } from './workbench-store';

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

describe('fitting the view to a circuit', () => {
  // A landscape canvas, so the width and the height can be reasoned about.
  beforeEach(() => {
    useWorkbenchStore.setState({ aspect: 2 });
  });

  it('centres on the circuit with room to spare on every side', () => {
    useWorkbenchStore.getState().fitTo({ x: 100, y: 50, width: 200, height: 100 });
    const { view } = useWorkbenchStore.getState();
    const height = view.width / 2;
    expect(view.x + view.width / 2).toBeCloseTo(200);
    expect(view.y + height / 2).toBeCloseTo(100);
    // Both dimensions fit with the margin, not just the wider one.
    expect(view.width).toBeGreaterThan(200);
    expect(height).toBeGreaterThan(100);
  });

  it('widens for a tall circuit instead of clipping it', () => {
    useWorkbenchStore.getState().fitTo({ x: 0, y: 0, width: 10, height: 400 });
    const { view } = useWorkbenchStore.getState();
    expect(view.width).toBeGreaterThanOrEqual(800);
    expect(view.width / 2).toBeGreaterThanOrEqual(400);
  });

  it('shrinks a circuit wider than the bench rather than following it off-world', () => {
    useWorkbenchStore.getState().fitTo({ x: 0, y: 0, width: 5000, height: 10 });
    const { view } = useWorkbenchStore.getState();
    expect(view.width).toBe(MAX_VIEW_WIDTH_MM);
  });

  it('leaves the view exactly where it was when there is nothing to frame', () => {
    const before = useWorkbenchStore.getState().view;
    useWorkbenchStore.getState().fitTo(null);
    expect(useWorkbenchStore.getState().view).toBe(before);
  });
});
