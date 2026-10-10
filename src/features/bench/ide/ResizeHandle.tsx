import { useRef } from 'react';

/**
 * A draggable divider between two panels.
 *
 * `axis: 'x'` is a vertical bar that resizes widths (delta = pointer dx);
 * `axis: 'y'` is a horizontal bar that resizes heights (delta = pointer dy).
 * Pointer capture keeps the drag alive outside the bar, double-click resets,
 * and arrow keys nudge when focused so resizing is not pointer-only.
 */
export function ResizeHandle({
  axis,
  onResize,
  onReset,
  label,
}: {
  axis: 'x' | 'y';
  onResize(deltaPx: number): void;
  onReset(): void;
  label: string;
}) {
  const last = useRef<{ x: number; y: number } | null>(null);
  const vertical = axis === 'x';

  return (
    <div
      role="separator"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-label={label}
      title={`${label} — drag to resize, double-click to reset`}
      tabIndex={0}
      onPointerDown={(event) => {
        (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
        last.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerMove={(event) => {
        const from = last.current;
        if (from === null) return;
        const delta = vertical ? event.clientX - from.x : event.clientY - from.y;
        last.current = { x: event.clientX, y: event.clientY };
        if (delta !== 0) onResize(delta);
      }}
      onPointerUp={(event) => {
        last.current = null;
        (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
      }}
      onPointerCancel={() => {
        last.current = null;
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        onReset();
      }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 24 : 8;
        const forward = vertical
          ? event.key === 'ArrowRight'
          : event.key === 'ArrowDown';
        const backward = vertical ? event.key === 'ArrowLeft' : event.key === 'ArrowUp';
        if (!forward && !backward) return;
        event.preventDefault();
        onResize(forward ? step : -step);
      }}
      className={
        vertical
          ? 'w-1 shrink-0 cursor-col-resize self-stretch touch-none transition-colors focus:outline-none bg-transparent hover:bg-sky-500/60 focus-visible:bg-sky-500/60 active:bg-sky-500/80'
          : 'h-1 w-full shrink-0 cursor-row-resize touch-none transition-colors focus:outline-none bg-transparent hover:bg-sky-500/60 focus-visible:bg-sky-500/60 active:bg-sky-500/80'
      }
    />
  );
}
