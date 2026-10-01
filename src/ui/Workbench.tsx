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

import { useCallback, useRef, useState } from 'react';
import type { Bench, Terminal } from '../sim/bench';
import { PartFootprint, type FootprintState } from './footprints';

export interface WorkbenchProps {
  bench: Bench;
  renderState: FootprintState;
  /** Terminal id to net index, for tracing a connection on hover. */
  readonly netOfTerminal: ReadonlyMap<number, number>;
  selectedId: string | null;
  wireMode: boolean;
  onSelect(partId: string | null): void;
  onMovePart(partId: string, x: number, y: number): void;
  onRouteWire(from: Terminal, to: Terminal): void;
}

const MIN_VIEW_WIDTH_MM = 24;
const MAX_VIEW_WIDTH_MM = 900;
/** How close a click must land to a hole to count as hitting it. */
const HOLE_PICK_RADIUS_MM = 2;

interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
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
}: WorkbenchProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [wireAnchor, setWireAnchor] = useState<Terminal | null>(null);
  const [pointerMm, setPointerMm] = useState<{ x: number; y: number } | null>(null);
  const movedRef = useRef(false);
  const [view, setView] = useState<ViewBox>({ x: -12, y: -10, width: 428, height: 240 });
  const dragRef = useRef<DragState | null>(null);

  /** Converts a pointer event into world millimetres. */
  const toWorld = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const svg = svgRef.current;
      if (!svg) return { x: 0, y: 0 };
      const rect = svg.getBoundingClientRect();
      return {
        x: view.x + ((clientX - rect.left) / rect.width) * view.width,
        y: view.y + ((clientY - rect.top) / rect.height) * view.height,
      };
    },
    [view],
  );

  const onPointerDown = (event: React.PointerEvent) => {
    movedRef.current = false;
    const world = toWorld(event.clientX, event.clientY);
    const partId = (event.target as SVGElement)
      .closest('[data-part-id]')
      ?.getAttribute('data-part-id');

    // Middle button, shift, or empty space all pan. Dragging a part does not.
    if (event.button === 1 || event.shiftKey || !partId || wireMode) {
      dragRef.current = {
        kind: 'pan',
        startX: event.clientX,
        startY: event.clientY,
        originX: view.x,
        originY: view.y,
      };
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
    movedRef.current = true;

    if (drag.kind === 'pan') {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const dx = ((event.clientX - drag.startX) / rect.width) * view.width;
      const dy = ((event.clientY - drag.startY) / rect.height) * view.height;
      setView((current) => ({ ...current, x: drag.originX - dx, y: drag.originY - dy }));
      return;
    }

    onMovePart(drag.partId, world.x - drag.grabDx, world.y - drag.grabDy);
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const onWheel = (event: React.WheelEvent) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const focusX = view.x + ((event.clientX - rect.left) / rect.width) * view.width;
    const focusY = view.y + ((event.clientY - rect.top) / rect.height) * view.height;

    const factor = Math.exp(-event.deltaY * 0.0015);
    const width = Math.min(
      MAX_VIEW_WIDTH_MM,
      Math.max(MIN_VIEW_WIDTH_MM, view.width * factor),
    );
    const scale = width / view.width;

    setView((current) => ({
      x: focusX - (focusX - current.x) * scale,
      y: focusY - (focusY - current.y) * scale,
      width,
      height: current.height * scale,
    }));
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

    const partId = (event.target as SVGElement)
      .closest('[data-part-id]')
      ?.getAttribute('data-part-id');
    if (!partId) onSelect(null);
  };

  const scale = 900 / view.width;

  return (
    <svg
      ref={svgRef}
      className="h-full w-full touch-none select-none bg-slate-950"
      viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
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

      <rect x={view.x} y={view.y} width={view.width} height={view.height} fill="url(#bench-grid)" />

      <g data-layer="wires" pointerEvents="none">
        {bench.wires.map((wire) => {
          const from = bench.terminals[wire.from];
          const to = bench.terminals[wire.to];
          return (
            <line
              key={wire.id}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke="#0b1220"
              strokeWidth={1.5 / scale + 0.8}
              strokeLinecap="round"
            />
          );
        })}
        {bench.wires.map((wire) => {
          const from = bench.terminals[wire.from];
          const to = bench.terminals[wire.to];
          return (
            <line
              key={`${wire.id}-core`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke={wire.colour}
              strokeWidth={0.9 / scale + 0.35}
              strokeLinecap="round"
            />
          );
        })}
      </g>

      <g data-layer="parts">
        {bench.parts.map((part) => {
          const selected = part.id === selectedId;
          return (
            <g key={part.id} transform={`translate(${part.x} ${part.y})`}>
              {selected && (
                <rect
                  x={-1.5}
                  y={-1.5}
                  width={part.definition.widthMm + 3}
                  height={part.definition.heightMm + 3}
                  rx={2}
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth={0.5}
                  strokeDasharray={`${1.4} ${1.1}`}
                />
              )}
              <PartFootprint part={part} state={renderState} />
            </g>
          );
        })}
      </g>

      {wireAnchor && pointerMm && (
        <line
          x1={wireAnchor.x}
          y1={wireAnchor.y}
          x2={pointerMm.x}
          y2={pointerMm.y}
          stroke="#38bdf8"
          strokeWidth={0.6}
          strokeDasharray="1.5 1.2"
          pointerEvents="none"
        />
      )}

      <g data-layer="net-trace" pointerEvents="none">
        {bench.terminals.map((terminal) => {
          const net = netOfTerminal.get(terminal.id);
          if (net === undefined || net < 0) return null;
          return (
            <circle
              key={terminal.id}
              cx={terminal.x}
              cy={terminal.y}
              r={1.9}
              fill="none"
              stroke="#38bdf8"
              strokeWidth={0.3}
              opacity={0.85}
            />
          );
        })}
      </g>
    </svg>
  );
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