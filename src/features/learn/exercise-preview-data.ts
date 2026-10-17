/**
 * The data behind the finished-build previews.
 *
 * Kept out of `ExercisePreview.tsx` on purpose: a file that exports a
 * component and a builder trips the fast-refresh rule, and the builder is
 * plain model work with no JSX in it.
 */

import type { Bench, CircuitDocument, PartInstance } from '@/features/simulation';
import { boardOption, type BoardId } from './boardRegistry';
import { exerciseBoard, type Exercise } from './exercises';
import type { FootprintState } from '@/features/bench';
import { Simulation } from '@/features/bench';
import { artworkBox } from '@/features/bench';
import { routeWire, routeWireVia, wireLanes } from '@/features/bench';

/** Padding around the built circuit, in millimetres. */
const FRAME_PAD_MM = 10;

/** What one finished build draws as: its parts, its jumpers, and its frame. */
export interface ExercisePreviewData {
  readonly bench: Bench;
  readonly state: FootprintState;
  /** The exercise's own parts — everything but the board and the breadboard. */
  readonly parts: readonly PartInstance[];
  readonly frame: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly paths: readonly { readonly id: string; readonly d: string; readonly colour: string }[];
}

/**
 * The finished bench for a circuit, built once and then kept.
 *
 * Simulations are cheap to hold but not free to build — each routed jumper
 * re-solves — and gallery and Learn pages show many builds at once. The
 * cache means each build pays that once per session, and the returned bench
 * is never mutated afterwards, so sharing it is safe. Keys are namespaced
 * (`exercise:`, `gallery:`) so the two domains never collide.
 */
const previewCache = new Map<string, ExercisePreviewData>();

export function previewBench(
  board: BoardId,
  circuit: CircuitDocument,
  cacheKey: string,
): ExercisePreviewData {
  const cached = previewCache.get(cacheKey);
  if (cached) return cached;

  const definition = boardOption(board).make();
  const simulation = new Simulation(definition);
  const errors = simulation.loadCircuit(circuit);
  if (errors.length > 0) {
    // A shipped circuit that will not compile is a broken data file, not a
    // build the preview can draw around; `parseCircuit` at import is the first
    // gate and this is the one that would catch a document assembled wrongly.
    throw new Error(`${cacheKey}: ${errors.join('; ')}`);
  }

  const bench = simulation.bench;
  const parts = bench.parts.filter(
    (part) => part.definition.component.kind !== 'mcu' && part.definition.component.kind !== 'breadboard',
  );
  const state: FootprintState = {
    pinVolts: simulation.pinVoltages(),
    displays: simulation.displayControllers(),
    servos: simulation.servoModels(),
    steppers: simulation.stepperAngles(),
    pixels: simulation.pixelColors(),
    lcds: simulation.lcdModels(),
    controls: simulation.controls,
    parts: bench.parts.length,
  };

  // The same routes the bench draws: hand-bent wires through their bends,
  // the rest on their automatic lanes.
  const lanes = wireLanes(
    bench.wires.map((wire) => ({
      id: wire.id,
      from: bench.terminals[wire.from],
      to: bench.terminals[wire.to],
    })),
  );
  const paths = bench.wires.map((wire) => {
    const from = bench.terminals[wire.from];
    const to = bench.terminals[wire.to];
    return {
      id: wire.id,
      d: wire.bends.length > 0 ? routeWireVia(from, wire.bends, to) : routeWire(from, to, lanes.get(wire.id) ?? 0),
      colour: wire.colour,
    };
  });

  // Frame the parts the exercise placed. Setups put parts down unrotated, so
  // the artwork box is the painted extent.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const part of parts) {
    const art = artworkBox(part.definition, part.rotation);
    minX = Math.min(minX, part.x + art.dx);
    minY = Math.min(minY, part.y + art.dy);
    maxX = Math.max(maxX, part.x + art.dx + art.widthMm);
    maxY = Math.max(maxY, part.y + art.dy + art.heightMm);
  }
  const frame =
    parts.length === 0
      ? { x: 0, y: 0, width: 100, height: 60 }
      : {
          x: minX - FRAME_PAD_MM,
          y: minY - FRAME_PAD_MM,
          width: maxX - minX + FRAME_PAD_MM * 2,
          height: maxY - minY + FRAME_PAD_MM * 2,
        };

  const built: ExercisePreviewData = { bench, state, parts, frame, paths };
  previewCache.set(cacheKey, built);
  return built;
}

export function previewFor(exercise: Exercise): ExercisePreviewData {
  return previewBench(exerciseBoard(exercise), exercise.circuit, `exercise:${exercise.id}`);
}
