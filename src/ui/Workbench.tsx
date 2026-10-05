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
import type { Bench, Terminal, Wire, WireEnd } from '../sim/bench';
import { PartFootprint, type FootprintState } from './footprints';
import { HardwareDefs } from './hardware';
import { routeWire, routeWireVia, wireLanes, type Point, type RouteSpan } from './wire-route';
import { renderedSizeMm } from './wokwi';

/**
 * Name for the jumper that is only half drawn. It lives in a map of its own
 * alongside the placed wires, so it cannot collide with a wire id on the bench.
 */
const DRAFT_WIRE = '';

export interface WorkbenchProps {
  bench: Bench;
  renderState: FootprintState;
  /** Terminal id to net index, used to trace the connection under the cursor. */
  readonly netOfTerminal: ReadonlyMap<number, number>;
  selectedId: string | null;
  onSelect(partId: string | null): void;
  onMovePart(partId: string, x: number, y: number): void;
  /** Forwarded from parts whose own element detects a press. */
  onTogglePressed(partId: string, pressed: boolean): void;
  /** `bends` are the waypoints the operator placed along the way. */
  onRouteWire(from: Terminal, to: Terminal, bends: readonly Point[]): void;
  /** Reshapes a placed jumper, re-measuring it. */
  onSetWireBends(wireId: string, bends: readonly Point[]): void;
  onRemoveWireBend(wireId: string, index: number): void;
  /** Inserts a waypoint at a leg index rather than always at the end. */
  onInsertWireBend(wireId: string, index: number, bend: Point): void;
  /** Which leg of a wire sits nearest a world position. */
  bendIndexNear(wireId: string, x: number, y: number): number;
  /** Re-clips one end of a placed jumper, the way Wokwi lets a wire be dragged. */
  onMoveWireEnd(wireId: string, end: WireEnd, to: Terminal): void;
  /**
   * Notifies the shell that a wire was picked, so the palette it opens can
   * recolour that wire.
   */
  onWirePicked(wireId: string, clientX: number, clientY: number): void;
  /** The wire whose endpoint handles are shown; null shows none. */
  selectedWireId: string | null;
  onSelectWire(wireId: string | null): void;
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
 * Where a remove button sits from the thing it removes, in screen pixels.
 *
 * Divided by `scale` wherever it is used, so the offset holds at any zoom. A
 * size written in world units would shrink with the bench until the button was
 * a couple of pixels across and impossible to hit.
 */
const REMOVE_OFFSET_MM = 11;

/** Radius of a remove button, again in screen pixels via `scale`. */
const REMOVE_RADIUS_MM = 3.4;

/**
 * Waypoint dots, purple so a committed corner reads differently from the
 * sky-blue preview of a corner being placed.
 */
const WAYPOINT_COLOUR = '#c084fc';

/**
 * The red cross that removes a waypoint or a whole jumper.
 *
 * Shared by both because they are the same affordance at two scales of the
 * bench, and a second hand-drawn copy would be a second thing to keep legible.
 */
function RemoveDot({
  x,
  y,
  scale,
  label,
  onRemove,
}: {
  x: number;
  y: number;
  scale: number;
  label: string;
  /** Called on press, before the state change that re-renders this away. */
  onRemove(): void;
}) {
  const arm = 0.42 * REMOVE_RADIUS_MM;
  return (
    <g
      style={{ cursor: 'pointer' }}
      onPointerDown={(event) => {
        /*
         * Stopped so the canvas does not read the press as the start of a drag
         * on the wire underneath. The click that follows cannot be stopped
         * here: removing re-renders, so by the time it is dispatched this
         * button is no longer the element under the pointer and the click
         * lands on the wire instead. The canvas drops it via the flag this
         * handler's caller sets.
         */
        event.stopPropagation();
        event.preventDefault();
        onRemove();
      }}
      aria-label={label}
      role="button"
    >
      <circle cx={x} cy={y} r={5.5 / scale} fill="transparent" />
      <circle
        cx={x}
        cy={y}
        r={REMOVE_RADIUS_MM / scale}
        fill="#450a0a"
        stroke="#f87171"
        strokeWidth={0.7 / scale}
      />
      {/*
       * Drawn as two lines rather than set as text: an SVG <text> would depend
       * on a font being available and would scale with the view box rather
       * than with the zoom.
       */}
      <path
        d={
          `M ${x - arm / scale} ${y - arm / scale} L ${x + arm / scale} ${y + arm / scale}` +
          ` M ${x + arm / scale} ${y - arm / scale} L ${x - arm / scale} ${y + arm / scale}`
        }
        stroke="#f87171"
        strokeWidth={0.85 / scale}
        strokeLinecap="round"
        fill="none"
        pointerEvents="none"
      />
    </g>
  );
}

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
  | { kind: 'move'; partId: string; grabDx: number; grabDy: number }
  /**
   * Reshaping a placed wire by dragging one of its own waypoints.
   *
   * Distinct from `move` because the thing under the pointer is a waypoint
   * rather than a part, and because dropping it past the end of the list pulls
   * it off rather than leaving it hanging there.
   */
  | { kind: 'bend'; wireId: string; index: number }
  /**
   * Re-clipping a wire's end onto another hole, which is the gesture Wokwi calls
   * dragging a wire.
   *
   * Separate from `bend` because it moves an electrical endpoint rather than a
   * routing hint: dropping this changes what the wire joins, while dropping a
   * bend changes only where it runs.
   */
  | { kind: 'wire-end'; wireId: string; end: WireEnd }
  /**
   * Dragging a wire's own body to pull the route aside.
   *
   * No waypoint exists yet, so the drag creates one where the pointer went
   * down and then behaves exactly like `bend` from then on. Promoting itself
   * rather than carrying its own move maths means the new waypoint is shaped
   * by one code path, not two that can disagree about where a bend snaps.
   */
  | { kind: 'bend-new'; wireId: string };

export function Workbench({
  bench,
  renderState,
  onSetWireBends,
  onRemoveWireBend,
  onInsertWireBend,
  bendIndexNear,
  netOfTerminal,
  selectedId,
  onMoveWireEnd,
  onSelectWire,
  selectedWireId,
  onSelect,
  onWirePicked,
  onMovePart,
  onRouteWire,
  onTogglePressed,
}: WorkbenchProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  /*
   * The pin a jumper is being drawn from, or null when none is.
   *
   * Wiring needs no tool to be armed: a click on a pin starts a wire and a
   * second click on a pin ends it. This is the only record that a wire is half
   * drawn, so it is the only thing Escape has to clear to put the bench back.
   */
  const [wireAnchor, setWireAnchor] = useState<Terminal | null>(null);
  /** Waypoints placed so far on the jumper being routed. */
  const [wireBends, setWireBends] = useState<readonly Point[]>([]);

  /*
   * Escape drops a half-drawn jumper.
   *
   * Necessary rather than decorative now that wiring is always armed: with no
   * tool to switch off, a click on a pin would otherwise leave the bench
   * waiting for the far end with no way out short of completing the wire or
   * reloading the page.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setWireAnchor((anchor) => (anchor === null ? anchor : null));
      setWireBends((bends) => (bends.length === 0 ? bends : []));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const [pointerMm, setPointerMm] = useState<{ x: number; y: number } | null>(null);
  const movedRef = useRef(false);
  const [view, setView] = useState<ViewBox>({ x: -12, y: -10, width: 428 });
  const [aspect, setAspect] = useState(DEFAULT_ASPECT);
  const dragRef = useRef<DragState | null>(null);
  /** Part id under the pointer at press time; see `onPointerDown`. */
  const pressedPartRef = useRef<string | null>(null);
  /**
   * Wire id under the pointer at press time; see `onPointerDown`.
   *
   * Recorded for the same reason as `pressedPartRef`: by the time the click
   * event arrives, pointer capture has retargeted it to the `<svg>` and the
   * wire that was actually under the cursor is unrecoverable.
   */
  const pressedWireRef = useRef<string | null>(null);
  /*
   * Set when a waypoint's remove button is pressed, cleared by the next canvas
   * click.
   *
   * The click that follows a delete has to be swallowed at the canvas, because
   * removing re-renders and the browser resolves that click's target against
   * the *new* DOM -- the remove control is gone by then, so stopping the event
   * at the control itself cannot catch it. Left to land it reads as a click on
   * the wire, which picks the wire and opens the palette over the canvas.
   */
  const suppressedRemoveRef = useRef(false);
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
     * Which part and which wire were pressed is decided here and remembered,
     * because by the time the click event arrives its target has been retargeted
     * to the capturing `<svg>` by setPointerCapture. Pointer-down hit-testing
     * still sees the real target, so this is the one moment it can be read.
     */
    const partId = (event.target as Element)
      .closest('[data-part-id]')
      ?.getAttribute('data-part-id');
    pressedPartRef.current = partId ?? null;
    pressedWireRef.current =
      (event.target as Element).closest('[data-wire-id]')?.getAttribute('data-wire-id') ?? null;


    /*
     * Wire handles are picked up before part hit-testing.
     *
     * They sit in layers above the wires rather than inside the wire group, so
     * they can be hit at all, and a wire crossing a part would otherwise win
     * the press and leave the part immovable.
     *
     * None of this runs while a jumper is being drawn. Every click then means
     * "route", and a press that quietly grabbed a waypoint instead would send
     * the wire somewhere the operator never pointed.
     */
    if (wireAnchor === null && event.button === 0 && !event.shiftKey) {
      const grab = event.target as Element;
      const wireId = grab.closest('[data-wire-id]')?.getAttribute('data-wire-id');

      /*
       * A waypoint is picked up before a wire end, and both before the wire
       * body.
       *
       * The order matters because they can overlap -- a wire end sitting on a
       * waypoint is a legitimate shape -- and an end is the more consequential
       * of the two to grab by accident, so the waypoint wins.
       */
      const index = Number(grab.closest('[data-bend-index]')?.getAttribute('data-bend-index'));
      if (wireId !== null && wireId !== undefined && Number.isInteger(index)) {
        dragRef.current = { kind: 'bend', wireId, index };
        onSelectWire(wireId);
        (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
        return;
      }

      const end = grab.closest('[data-wire-end]')?.getAttribute('data-wire-end');
      if (wireId !== null && wireId !== undefined && (end === 'from' || end === 'to')) {
        dragRef.current = { kind: 'wire-end', wireId, end };
        onSelectWire(wireId);
        (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
        return;
      }

      /*
       * The wire's own body pulls the route aside.
       *
       * Dragging a segment is how a wire is rerouted around whatever is in the
       * way: the drag drops a waypoint where the pointer went down and shapes
       * it from there, which is the same thing as grabbing an existing waypoint
       * except that this one does not exist yet. A press that never moves is a
       * click instead, and the click handler picks the wire rather than
       * bending it -- so grabbing a wire to look at it costs nothing.
       *
       * Nothing is selected here. Selecting now would re-render before the
       * click arrives, and the click is what opens the colour palette.
       */
      if (wireId !== null && wireId !== undefined) {
        dragRef.current = { kind: 'bend-new', wireId };
        (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
        return;
      }
    }

    /*
     * Middle button, shift, bare bench, and anything pressed mid-route all pan.
     * Capture either way: a drag that wanders off the canvas has to keep going,
     * or the part is left wherever the pointer happened to cross the edge.
     */
    if (event.button === 1 || event.shiftKey || !partId || wireAnchor !== null) {
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
    if (drag.kind === 'bend') {
      const wire = bench.wires.find((candidate) => candidate.id === drag.wireId);
      if (!wire) return;

      // Dragging the last waypoint onto the wire's far contact pulls it off
      // again. That is the one gesture that removes a bend, so there is no
      // separate delete mode to discover.
      if (drag.index === wire.bends.length - 1) {
        const far = bench.terminals[wire.to];
        if (Math.hypot(world.x - far.x, world.y - far.y) <= HOLE_PICK_RADIUS_MM * 2) {
          onRemoveWireBend(drag.wireId, drag.index);
          return;
        }
      }

      const bends = [...wire.bends];
      bends[drag.index] = {
        x: Math.round(world.x / 2.54) * 2.54,
        y: Math.round(world.y / 2.54) * 2.54,
      };
      onSetWireBends(drag.wireId, bends);
      return;
    }

    /*
     * A drag that began on a wire's body becomes a waypoint drag the moment it
     * turns out to be a drag at all.
     *
     * The waypoint is inserted at the pointer rather than at the press point,
     * so it appears where the operator is now looking, and on the leg nearest
     * that spot so it splits the run the pointer is actually over. From here
     * it is an ordinary bend drag: one code path shapes it, so a waypoint
     * dropped this way cannot snap differently from one dropped on an existing
     * dot.
     */
    if (drag.kind === 'bend-new') {
      const wire = bench.wires.find((candidate) => candidate.id === drag.wireId);
      if (!wire) return;
      const at = {
        x: Math.round(world.x / 2.54) * 2.54,
        y: Math.round(world.y / 2.54) * 2.54,
      };
      const index = bendIndexNear(drag.wireId, world.x, world.y);
      onInsertWireBend(drag.wireId, index, at);
      dragRef.current = { kind: 'bend', wireId: drag.wireId, index };
      return;
    }

    if (drag.kind === 'wire-end') {
      /*
       * Re-clipped on every frame of the drag, not on release, so the wire
       * follows the pointer the way a real one does. That means a full circuit
       * re-solve per frame, which is the same cost the part drag already pays
       * and the same trade: a smooth bench that solves, rather than a cheap
       * one that lags behind the pointer.
       *
       * Dropping on bare bench claims a loose contact at that spot, which is
       * what a wire end hanging off the edge of a board actually looks like.
       */
      onMoveWireEnd(drag.wireId, drag.end, {
        id: -1,
        x: world.x,
        y: world.y,
      });
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
  }

  /**
   * Routing and picking, both driven by a plain click.
   *
   * A click on a pin starts a jumper and a second click on a pin ends it;
   * a click on bare canvas mid-route drops a waypoint there. There is no tool
   * to arm, so which of those a click means is decided entirely by whether a
   * wire is half drawn.
   *
   * Bends are only taken from bare canvas, and never from a pin. A click on a
   * pin is unambiguous -- it is the contact to clip the wire to -- and stealing
   * it to mean "bend here" would make the one gesture the tool actually needs
   * impossible to perform by accident.
   */
  const onClick = (event: React.MouseEvent) => {
    /*
     * The click trailing a waypoint delete is dropped here rather than at the
     * control that caused it. Removing the waypoint re-renders, so by the time
     * the click is dispatched the control that stopped propagation is no longer
     * under the pointer and the click lands on the wire -- where it would pick
     * the wire and fling the colour palette open over the canvas.
     */
    if (suppressedRemoveRef.current) {
      suppressedRemoveRef.current = false;
      return;
    }
    if (movedRef.current) return;
    const world = toWorld(event.clientX, event.clientY);
    const terminal = nearestHole(bench, world.x, world.y);

    if (wireAnchor !== null) {
      if (!terminal) {
        // Bare bench: a corner on the way.
        setWireBends((bends) => [
          ...bends,
          {
            // Snapped to the 2.54 mm grid so a hand-placed bend lands on a
            // real hole pitch rather than a fraction off it.
            x: Math.round(world.x / 2.54) * 2.54,
            y: Math.round(world.y / 2.54) * 2.54,
          },
        ]);
        return;
      }

      // Clicking the pin the wire started from abandons it rather than
      // routing a zero-length jumper back to itself.
      if (terminal.id !== wireAnchor.id) onRouteWire(wireAnchor, terminal, wireBends);
      setWireAnchor(null);
      setWireBends([]);
      return;
    }

    if (terminal !== null) {
      setWireAnchor(terminal);
      setWireBends([]);
      return;
    }

    /*
     * Clicking a wire picks it and opens its colour palette.
     *
     * Picking rather than bending is what makes the palette reachable at all:
     * the drag is how a wire is rerouted, so a click that also bent would
     * leave a corner behind every time the operator wanted to look at a wire
     * or change its colour.
     */
    const wireId = pressedWireRef.current;
    if (wireId !== null) {
      onSelectWire(wireId);
      onWirePicked(wireId, event.clientX, event.clientY);
      return;
    }

    /*
     * Anything else selects whatever was pressed, and clicking bare bench
     * clears the selection. A drag deliberately does not, so moving a part does
     * not also change what the inspector is showing.
     *
     * The wire selection is cleared with it: the endpoint handles belong to the
     * part being worked on, and leaving them up while the inspector showed
     * something else put draggable dots on a bench nobody was editing.
     */
    onSelectWire(null);
    onSelect(pressedPartRef.current);
  };

  /** The hole under the cursor, which is what a click would pick. */
  const hovered = useMemo(
    () => (pointerMm ? nearestHole(bench, pointerMm.x, pointerMm.y) : null),
    [bench, pointerMm],
  );

  /**
   * Every contact sharing the hovered hole's net.
   * Tracing the whole net on hover is the whole point: it shows where a signal
   * actually goes, which is the question a wiring bench exists to answer. It
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

  /**
   * The wires, as the router sees them: a jumper is a pair of contacts and a
   * name, and the lane it draws on follows from where the other wires turn.
   */
  const spans = useMemo<readonly RouteSpan[]>(
    () =>
      bench.wires.map((wire) => ({
        id: wire.id,
        from: bench.terminals[wire.from],
        to: bench.terminals[wire.to],
      })),
    [bench],
  );
  const lanes = useMemo(() => wireLanes(spans), [spans]);

  /**
   * The lane the jumper being drawn would take if it were dropped here.
   *
   * The draft counts into its group alongside the jumpers already placed, so
   * the preview is drawn on the line the wire will land on instead of jumping
   * onto it the moment the pointer stops.
   */
  const draftLane = useMemo(() => {
    if (!wireAnchor || !pointerMm || wireBends.length > 0) return 0;
    const draft: RouteSpan = { id: DRAFT_WIRE, from: wireAnchor, to: pointerMm };
    return wireLanes([...spans, draft]).get(DRAFT_WIRE) ?? 0;
  }, [spans, wireAnchor, pointerMm, wireBends]);

  /**
   * The drawn path of a placed jumper.
   *
   * A wire with hand-placed bends is routed through them exactly; one without
   * takes the automatic lane-separated dogleg. Both the casing and the
   * insulation pass through here, so the two can never disagree about where
   * the wire runs.
   */
  const wirePath = (wire: Wire) => {
    const from = bench.terminals[wire.from];
    const to = bench.terminals[wire.to];
    return wire.bends.length > 0
      ? routeWireVia(from, wire.bends, to)
      : routeWire(from, to, lanes.get(wire.id) ?? 0);
  };

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
      style={{ cursor: 'default' }}
    >
      <defs>
        <pattern id="bench-grid" width={10.16} height={10.16} patternUnits="userSpaceOnUse">
          <path d="M 10.16 0 L 0 0 0 10.16" fill="none" stroke="#1e293b" strokeWidth={0.3} />
        </pattern>
      </defs>

      <HardwareDefs />

      <rect x={view.x} y={view.y} width={view.width} height={viewHeight} fill="url(#bench-grid)" />

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

      {/*
       * Each jumper is drawn twice: a dark casing that reads as the shadow the
       * wire casts, and the coloured insulation over it. Both take the same
       * route, so the corner radius stays put at any zoom.
       *
       * Drawn *after* the parts, not before. A jumper runs over the top of
       * whatever it crosses -- that is what a wire plugged into a breadboard
       * looks like from above -- and drawing it underneath let the opaque
       * breadboard paint straight over it, so a wire crossing the board simply
       * disappeared and read as broken.
       */}
      {/*
       * Each jumper is drawn twice: a dark casing that reads as the shadow the
       * wire casts on the board, and the coloured insulation over it. Both take
       * the same route, so the corner radius stays put at any zoom.
       */}
      <g data-layer="wires" pointerEvents="none">
        {bench.wires.map((wire) => (
          <path
            key={wire.id}
            d={wirePath(wire)}
            fill="none"
            stroke="#05080d"
            strokeWidth={1.6 / scale + 0.7}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.85}
          />
        ))}
        {bench.wires.map((wire) => (
          <path
            key={`${wire.id}-core`}
            d={wirePath(wire)}
            fill="none"
            stroke={wire.colour}
            strokeWidth={0.9 / scale + 0.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </g>

      {/*
       * An invisible, fatter copy of every wire, sitting above the drawn ones.
       *
       * The drawn wires are only a millimetre or so thick, which at working
       * zoom is a couple of pixels -- too thin to click reliably. This copy
       * takes the press so a wire can be clicked to insert a waypoint on it,
       * and carries the ids that identify which wire was hit.
       */}
      <g data-layer="wire-hit">
        {bench.wires.map((wire) => (
          <path
            key={`${wire.id}-hit`}
            d={wirePath(wire)}
            fill="none"
            stroke="transparent"
            strokeWidth={3.2}
            strokeLinecap="round"
            strokeLinejoin="round"
            data-wire-id={wire.id}
          />
        ))}
      </g>

      {/*
       * Draggable handles on a placed wire's waypoints, hidden while a jumper
       * is being drawn. Mid-route every click means "route", and a handle under
       * the cursor would make that unpredictable.
       *
       * Purple, to tell a waypoint from the sky-blue preview of a wire that is
       * still being drawn: the same dot means "committed corner" in one case and
       * "corner you are about to place" in the other, and colour is what
       * separates them at a glance.
       */}
      {wireAnchor === null && (
        <g data-layer="wire-handles">
          {bench.wires.map((wire) =>
            wire.bends.map((bend, index) => (
              <g key={`${wire.id}-bend-${index}`} data-wire-id={wire.id} data-bend-index={index}>
                {/* Generous invisible grab area around a small visible dot. */}
                <circle cx={bend.x} cy={bend.y} r={3 / scale + 0.6} fill="transparent" />
                <circle
                  cx={bend.x}
                  cy={bend.y}
                  r={1.2 / scale + 0.4}
                  fill={WAYPOINT_COLOUR}
                  stroke="#0b1220"
                  strokeWidth={0.25 / scale}
                />
                {/*
                 * The remove control, offset up and to the right of the dot so
                 * the two targets do not overlap.
                 *
                 * Off to one side rather than drawn *on* the waypoint because
                 * the dot is the drag handle: a delete button sitting under the
                 * cursor would make grabbing a waypoint to reshape it a
                 * coin-flip between the two, and reshaping is the common case.
                 * Only the selected wire carries one, so the bench is not
                 * blanketed in buttons for wires nobody is editing.
                 */}
                {wire.id === selectedWireId && (
                  <RemoveDot
                    x={bend.x + REMOVE_OFFSET_MM / scale}
                    y={bend.y - REMOVE_OFFSET_MM / scale}
                    scale={scale}
                    label={`Remove waypoint ${index + 1} of ${wire.bends.length}`}
                    onRemove={() => {
                      suppressedRemoveRef.current = true;
                      onRemoveWireBend(wire.id, index);
                    }}
                  />
                )}
              </g>
            )),
          )}
        </g>
      )}

      {/*
       * Endpoint handles on the selected wire, so its two contacts can be
       * dragged to another hole the way a Wokwi wire is.
       *
       * Only the selected wire, and never mid-route. Handles on every wire
       * would blanket the bench in dots that swallow the clicks meant for pins
       * underneath, and while a jumper is being drawn every click is routing
       * rather than editing.
       *
       * The visible dot takes the wire's own colour so the handle reads as
       * belonging to it, with a ring so the near-invisible colours in the
       * palette still show.
       */}
      {wireAnchor === null && selectedWireId !== null && (
        <g data-layer="wire-ends">
          {bench.wires
            .filter((wire) => wire.id === selectedWireId)
            .flatMap((wire) => (
              (['from', 'to'] as const).map((end) => {
                const terminal = bench.terminals[end === 'from' ? wire.from : wire.to];
                if (!terminal) return null;

                /*
                 * A handle the pointer cannot reach is a handle that does not
                 * exist. The starter bench wires the LED and both displays to
                 * columns near the breadboard's right-hand end, so the far end of
                 * a wire routinely sits past the edge of the initial view -- and
                 * an SVG element outside the viewBox is simply not painted.
                 *
                 * So a handle whose contact is off-screen is drawn at the view's
                 * edge instead, with the connecting stub showing which way the
                 * real end lies. Dragging it then moves the contact to wherever
                 * it is dropped, which is what the operator meant: pull the end
                 * in from off the board.
                 */
                const margin = 2.5;
                const offScreen =
                  terminal.x < view.x + margin ||
                  terminal.x > view.x + view.width - margin ||
                  terminal.y < view.y + margin ||
                  terminal.y > view.y + viewHeight - margin;
                const x = offScreen
                  ? Math.min(
                      Math.max(terminal.x, view.x + margin),
                      view.x + view.width - margin,
                    )
                  : terminal.x;
                const y = offScreen
                  ? Math.min(
                      Math.max(terminal.y, view.y + margin),
                      view.y + viewHeight - margin,
                    )
                  : terminal.y;

                return (
                  <g key={`${wire.id}-${end}`} data-wire-id={wire.id} data-wire-end={end}>
                    {offScreen && (
                      // The stub points at the contact that is out of view, so
                      // the handle reads as "this wire continues that way".
                      <line
                        x1={x}
                        y1={y}
                        x2={terminal.x}
                        y2={terminal.y}
                        stroke={wire.colour}
                        strokeWidth={0.5 / scale}
                        strokeDasharray={`${2 / scale} ${1.6 / scale}`}
                        opacity={0.6}
                      />
                    )}
                    <circle cx={x} cy={y} r={2.6 / scale + 0.6} fill="transparent" />
                    <circle
                      cx={x}
                      cy={y}
                      r={1.1 / scale + 0.3}
                      fill={wire.colour}
                      stroke="#38bdf8"
                      strokeWidth={0.3 / scale}
                    />
                  </g>
                );
              })
            ))}
        </g>
      )}

      {/*
       * The jumper being drawn. Once any waypoint is down it follows those and
       * stops taking a lane offset -- a hand-placed bend is an exact position,
       * and nudging it would mean the wire missed the point the operator
       * chose. With no bends it is still the automatic preview.
       */}
      {wireAnchor && pointerMm && (
        <path
          d={
            wireBends.length > 0
              ? routeWireVia(wireAnchor, wireBends, pointerMm)
              : routeWire(wireAnchor, pointerMm, draftLane)
          }
          fill="none"
          stroke="#38bdf8"
          strokeWidth={0.9 / scale + 0.4}
          strokeDasharray="2.2 1.6"
          strokeLinecap="round"
          pointerEvents="none"
        />
      )}

      {/*
       * Each placed waypoint, so the operator can see what they have committed
       * to and how many are queued up.
       */}
      <g data-layer="wire-bends" pointerEvents="none">
        {wireBends.map((bend, index) => (
          <circle
            key={`${bend.x}:${bend.y}:${index}`}
            cx={bend.x}
            cy={bend.y}
            r={1.1 / scale + 0.3}
            fill="#38bdf8"
            stroke="#0b1220"
            strokeWidth={0.2 / scale}
          />
        ))}
      </g>

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