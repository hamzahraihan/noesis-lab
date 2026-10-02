/**
 * The bench canvas: an SVG world in millimetres, viewed through a pan/zoom box.
 *
 * All geometry stays in millimetres and only the viewBox changes, so nothing
 * downstream ever has to think about screen pixels. Drag, pan and zoom all work
 * by converting pointer coordinates back into world millimetres.
 *
 * Interaction modes are deliberately blunt: drag a part to move it, click a hole
 * in wire mode to route a jumper. Anything cleverer hides where a click will
 * land, which is the opposite of what this tool is for.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Bench, Terminal } from '../sim/bench';
import { PartFootprint, type FootprintState } from './footprints';
import { HardwareDefs } from './hardware';
import { routeWire } from './wire-route';
import { renderedSizeMm } from './wokwi';

export interface WorkbenchProps {
  bench: Bench;
  renderState: FootprintState;
  /** Terminal id to net index, used to trace the connection under the cursor. */
  readonly netOfTerminal: ReadonlyMap<number, number>;
  selectedId: string | null;
  wireMode: boolean;
  onSelect(partId: string | null): void;
  onMovePart(partId: string, x: number, y: number): void;
  /** Forwarded from parts whose own element detects a press. */
  onTogglePressed(partId: string, pressed: boolean): void;
  onRouteWire(from: Terminal, to: Terminal): void;
}

const MIN_VIEW_WIDTH_MM = 24;
const MAX_VIEW_WIDTH_MM = 900;
/**
 * How far, in CSS pixels, the pointer must travel before a press counts as a
 * drag rather than a click.
 *
 * Generous enough to absorb hand tremor on a click, small enough that nudging a
 * part on the bench still moves it.
 */
const CLICK_SLOP_PX = 4;

/** How close a click must land to a hole to count as hitting it. */
const HOLE_PICK_RADIUS_MM = 2;
/** Zoom applied per millimetre of wheel travel, before the per-device scaling. */
const ZOOM_PER_WHEEL_MM = 0.0015;
/**
 * One notch cannot zoom further than this, so a flung trackpad gesture or a
 * high-resolution mouse cannot throw the view off the bench entirely.
 */
const MAX_WHEEL_ZOOM_STEP = 0.6;
/**
 * How many pixels of travel one unit of `WheelEvent.deltaMode` is worth:
 * pixels, lines (Firefox on some platforms) and whole pages.
 */
const WHEEL_UNITS_PER_MODE = [1, 16, 400];
/** Aspect assumed until the canvas has been measured. */
const DEFAULT_ASPECT = 16 / 10;

/**
 * The visible slice of the bench. Only the width is stored: the height is
 * derived from the canvas shape, which is what keeps the view box and the
 * element rectangle in the same proportions.
 */
interface ViewBox {
  x: number;
  y: number;
  width: number;
}

type DragState =
  | { kind: 'pan'; startX: number; startY: number; originX: number; originY: number }
  | { kind: 'move'; partId: string; grabDx: number; grabDy: number };

export function Workbench({
  bench,
  renderState,
  netOfTerminal,
  selectedId,
  wireMode,
  onSelect,
  onMovePart,
  onRouteWire,
  onTogglePressed,
}: WorkbenchProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [wireAnchor, setWireAnchor] = useState<Terminal | null>(null);
  const [pointerMm, setPointerMm] = useState<{ x: number; y: number } | null>(null);
  const movedRef = useRef(false);
  const [view, setView] = useState<ViewBox>({ x: -12, y: -10, width: 428 });
  const [aspect, setAspect] = useState(DEFAULT_ASPECT);
  const dragRef = useRef<DragState | null>(null);
  /** Part id under the pointer at press time; see `onPointerDown`. */
  const pressedPartRef = useRef<string | null>(null);
  /** Where the pointer went down, in client pixels; see `onPointerMove`. */
  const pressRef = useRef<{ x: number; y: number } | null>(null);

  /** Visible height, always the same shape as the canvas it is drawn into. */
  const viewHeight = view.width / aspect;

  /**
   * Tracks the canvas shape so the view box can match it.
   *
   * An SVG letterboxes any view box that does not share its aspect ratio, and
   * the pointer maths below maps the element rectangle straight onto the view
   * box. Matching the two is what puts a click on the hole actually under it,
   * and it fills the canvas instead of centring a narrow strip of bench in it.
   */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setAspect(width / height);
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  /** Converts a pointer event into world millimetres. */
  const toWorld = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const svg = svgRef.current;
      if (!svg) return { x: 0, y: 0 };
      const rect = svg.getBoundingClientRect();
      return {
        x: view.x + ((clientX - rect.left) / rect.width) * view.width,
        y: view.y + ((clientY - rect.top) / rect.height) * viewHeight,
      };
    },
    [view, viewHeight],
  );

  const onPointerDown = (event: React.PointerEvent) => {
    movedRef.current = false;
    pressRef.current = { x: event.clientX, y: event.clientY };
    const world = toWorld(event.clientX, event.clientY);
    /*
     * Which part was pressed is decided here and remembered, because by the
     * time the click event arrives its target has been retargeted to the
     * capturing `<svg>` by setPointerCapture. Pointer-down hit-testing still
     * sees the real target, so this is the one moment it can be read.
     */
    const partId = (event.target as Element)
      .closest('[data-part-id]')
      ?.getAttribute('data-part-id');
    pressedPartRef.current = partId ?? null;

    // Middle button, shift, or empty space all pan. Dragging a part does not.
    // Capture either way: a drag that wanders off the canvas has to keep
    // going, or the part is left wherever the pointer happened to cross the
    // edge.
    if (event.button === 1 || event.shiftKey || !partId || wireMode) {
      dragRef.current = {
        kind: 'pan',
        startX: event.clientX,
        startY: event.clientY,
        originX: view.x,
        originY: view.y,
      };
      (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
      return;
    }

    const part = bench.parts.find((candidate) => candidate.id === partId);
    if (!part) return;
    dragRef.current = {
      kind: 'move',
      partId,
      grabDx: world.x - part.x,
      grabDy: world.y - part.y,
    };
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const world = toWorld(event.clientX, event.clientY);
    setPointerMm(world);

    const drag = dragRef.current;
    if (!drag) return;

    /*
     * A press only becomes a drag once the pointer has actually travelled.
     *
     * A hand is never perfectly still, so a real click almost always emits a
     * pointermove or two between press and release. Treating any movement as a
     * drag meant a click could never complete, which is why a part could not be
     * picked no matter how carefully it was clicked. Below the threshold
     * nothing moves at all, so a shaky click stays a click.
     */
    const press = pressRef.current;
    if (press && !movedRef.current) {
      const travelled = Math.hypot(event.clientX - press.x, event.clientY - press.y);
      if (travelled > CLICK_SLOP_PX) movedRef.current = true;
    }
    if (!movedRef.current) return;

    if (drag.kind === 'pan') {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const dx = ((event.clientX - drag.startX) / rect.width) * view.width;
      const dy = ((event.clientY - drag.startY) / rect.height) * viewHeight;
      setView((current) => ({ ...current, x: drag.originX - dx, y: drag.originY - dy }));
      return;
    }

    onMovePart(drag.partId, world.x - drag.grabDx, world.y - drag.grabDy);
  };

  const endDrag = (event: React.PointerEvent) => {
    dragRef.current = null;
    pressRef.current = null;
    const target = event.currentTarget as Element;
    if (target.hasPointerCapture?.(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
  };

  /**
   * Zooms about the pointer, so the hole under the cursor stays under it.
   *
   * Wheel up pulls the view in and wheel down pushes it out, matching every
   * other map and CAD canvas. The delta is normalised first because browsers
   * disagree on its unit -- Firefox reports lines where Chromium reports
   * pixels -- and then clamped so one flung gesture cannot throw the view off
   * the bench.
   */
  const onWheel = (event: React.WheelEvent) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const focusX = view.x + ((event.clientX - rect.left) / rect.width) * view.width;
    const focusY = view.y + ((event.clientY - rect.top) / rect.height) * viewHeight;

    const unit = WHEEL_UNITS_PER_MODE[event.deltaMode] ?? 1;
    const step = clamp(event.deltaY * unit * ZOOM_PER_WHEEL_MM, -MAX_WHEEL_ZOOM_STEP, MAX_WHEEL_ZOOM_STEP);
    const width = clamp(view.width * Math.exp(step), MIN_VIEW_WIDTH_MM, MAX_VIEW_WIDTH_MM);

    // Hold the pointer at the same fraction across the view rather than at the
    // same millimetre offset, so zooming in still converges on the cursor.
    const fractionX = (focusX - view.x) / view.width;
    const fractionY = (focusY - view.y) / viewHeight;
    setView({
      x: focusX - fractionX * width,
      y: focusY - fractionY * (width / aspect),
      width,
    });
  };

  /** Clicking a hole in wire mode anchors, then completes, a jumper. */
  const onClick = (event: React.MouseEvent) => {
    if (movedRef.current) return;
    const world = toWorld(event.clientX, event.clientY);

    if (wireMode) {
      const terminal = nearestHole(bench, world.x, world.y);
      if (!terminal) return;
      if (!wireAnchor) {
        setWireAnchor(terminal);
        return;
      }
      if (terminal.id !== wireAnchor.id) onRouteWire(wireAnchor, terminal);
      setWireAnchor(null);
      return;
    }

    /*
     * A click that did not turn into a drag selects whatever was pressed, and
     * clicking bare bench clears the selection. A drag deliberately does not,
     * so moving a part does not also change what the inspector is showing.
     */
    onSelect(pressedPartRef.current);
  };

  /** The hole under the cursor, which is what a click would pick. */
  const hovered = useMemo(
    () => (pointerMm ? nearestHole(bench, pointerMm.x, pointerMm.y) : null),
    [bench, pointerMm],
  );

  /**
   * Every contact sharing the hovered hole's net.
   *
   * Tracing the whole net on hover is the whole point: it shows where a signal
   * actually goes, which is the question a wiring bench exists to answer. It
   * is scoped to one net because ringing every hole on the board says nothing.
   */
  const traced = useMemo(() => {
    if (!hovered) return [];
    const net = netOfTerminal.get(hovered.id);
    if (net === undefined || net < 0) return [];
    const ids: number[] = [];
    for (const terminal of bench.terminals) {
      if (netOfTerminal.get(terminal.id) === net) ids.push(terminal.id);
    }
    return ids;
  }, [bench, netOfTerminal, hovered]);

  const scale = 900 / view.width;

  return (
    <svg
      ref={svgRef}
      className="h-full w-full touch-none select-none bg-slate-950"
      viewBox={`${view.x} ${view.y} ${view.width} ${viewHeight}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onWheel={onWheel}
      onClick={onClick}
      style={{ cursor: wireMode ? 'crosshair' : 'default' }}
    >
      <defs>
        <pattern id="bench-grid" width={10.16} height={10.16} patternUnits="userSpaceOnUse">
          <path d="M 10.16 0 L 0 0 0 10.16" fill="none" stroke="#1e293b" strokeWidth={0.3} />
        </pattern>
      </defs>

      <HardwareDefs />

      <rect x={view.x} y={view.y} width={view.width} height={viewHeight} fill="url(#bench-grid)" />

      {/*
       * Each jumper is drawn twice: a dark casing that reads as the shadow the
       * wire casts on the board, and the coloured insulation over it. Both take
       * the same route, so the corner radius stays put at any zoom.
       */}
      <g data-layer="wires" pointerEvents="none">
        {bench.wires.map((wire, index) => (
          <path
            key={wire.id}
            d={routeWire(
              bench.terminals[wire.from],
              bench.terminals[wire.to],
              index,
            )}
            fill="none"
            stroke="#05080d"
            strokeWidth={1.6 / scale + 0.7}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.85}
          />
        ))}
        {bench.wires.map((wire, index) => (
          <path
            key={`${wire.id}-core`}
            d={routeWire(
              bench.terminals[wire.from],
              bench.terminals[wire.to],
              index,
            )}
            fill="none"
            stroke={wire.colour}
            strokeWidth={0.9 / scale + 0.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </g>

      <g data-layer="parts">
        {bench.parts.map((part) => {
          const selected = part.id === selectedId;
          /*
           * The outline has to bound what is actually drawn, which for a part
           * Wokwi covers is the element's own size rather than the size its
           * definition declares. Sizing it from the definition left the box
           * floating beside the artwork on the smaller parts and cutting through
           * it on the larger ones.
           */
          const drawn = renderedSizeMm(part.definition);
          return (
            <g
              key={part.id}
              data-part-id={part.id}
              transform={`translate(${part.x} ${part.y})`}
            >
              {selected && (
                <rect
                  x={-1.5}
                  y={-1.5}
                  width={drawn.widthMm + 3}
                  height={drawn.heightMm + 3}
                  rx={2}
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth={0.5}
                  strokeDasharray={`${1.4} ${1.1}`}
                />
              )}
              <PartFootprint part={part} state={renderState} onTogglePressed={onTogglePressed} />
            </g>
          );
        })}
      </g>

      {wireAnchor && pointerMm && (
        <path
          d={routeWire(wireAnchor, pointerMm, bench.wires.length)}
          fill="none"
          stroke="#38bdf8"
          strokeWidth={0.9 / scale + 0.4}
          strokeDasharray="2.2 1.6"
          strokeLinecap="round"
          pointerEvents="none"
        />
      )}

      <g data-layer="net-trace" pointerEvents="none">
        {traced.map((terminalId) => {
          const terminal = bench.terminals[terminalId];
          const isHovered = terminal.id === hovered?.id;
          return (
            <circle
              key={terminal.id}
              cx={terminal.x}
              cy={terminal.y}
              r={isHovered ? 2.1 : 1.7}
              fill={isHovered ? '#38bdf8' : 'none'}
              stroke="#38bdf8"
              strokeWidth={isHovered ? 0.2 : 0.28}
              opacity={isHovered ? 1 : 0.8}
            />
          );
        })}
      </g>
    </svg>
  );
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Nearest terminal within picking range, or null. */
function nearestHole(
  bench: Bench,
  x: number,
  y: number,
): Terminal | null {
  let best: Terminal | null = null;
  let bestDistance = HOLE_PICK_RADIUS_MM;
  for (const terminal of bench.terminals) {
    const distance = Math.hypot(terminal.x - x, terminal.y - y);
    if (distance < bestDistance) {
      best = terminal;
      bestDistance = distance;
    }
  }
  return best;
}