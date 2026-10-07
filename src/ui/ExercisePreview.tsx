/**
 * The finished build, as a static picture of the result.
 *
 * Every exercise — and every gallery build — already wires its completed
 * circuit through a `setup()`, which is what the bench loads and what the
 * tests run headless. The data comes from `previewBench`
 * (`exercise-preview-data.ts`); this file only draws it with the bench's
 * own renderers (`PartFootprint`, the wire router), framed on the parts the
 * build placed. What the learner sees here is what lands on the bench, down
 * to the wire colours — the one honest difference is that nothing is
 * powered, so LEDs sit unlit and the caption says so.
 *
 * Board and breadboard bodies are left out of the frame on purpose: the
 * breadboard alone draws the better part of a thousand holes, which is fine
 * once on an interactive bench and ruinous thirty times on the Learn index.
 * Jumpers are drawn whole and clipped by the frame, so a wire that runs back
 * to the board reads as continuing off-frame rather than as ending mid-air.
 */

import { useId, useMemo } from 'react';
import type { BoardId } from './boardRegistry';
import type { Exercise } from './exercises';
import { previewBench, previewFor, type ExercisePreviewData } from './exercise-preview-data';
import { PartFootprint } from '@/features/bench/footprints';
import { HardwareDefs } from '@/features/bench/hardware';
import { partTransform } from '@/features/bench/part-transform';
import type { Simulation } from '@/features/bench/simulation';

/**
 * The SVG body every finished-build picture shares, whatever built the bench.
 *
 * Split out so exercises and gallery projects draw through one code path:
 * one frame rule, one wire treatment, one grid. The data decides what is
 * drawn; this decides only how.
 */
function PreviewSvg({
  preview,
  label,
  className,
  fit = 'meet',
}: {
  preview: ExercisePreviewData;
  label: string;
  className?: string;
  fit?: 'meet' | 'slice';
}) {
  // Suffixed: pattern ids share the document across inline SVGs, and index
  // pages hold dozens of these at once.
  const gridId = `${useId().replace(/:/g, 'finished-grid')}`;
  const { frame } = preview;

  return (
    <svg
      className={className}
      viewBox={`${frame.x} ${frame.y} ${frame.width} ${frame.height}`}
      preserveAspectRatio={fit === 'slice' ? 'xMidYMid slice' : 'xMidYMid meet'}
      role="img"
      aria-label={label}
    >
      <defs>
        <pattern id={gridId} width={10.16} height={10.16} patternUnits="userSpaceOnUse">
          <path d="M 10.16 0 L 0 0 0 10.16" fill="none" stroke="#1e293b" strokeWidth={0.3} />
        </pattern>
      </defs>
      <HardwareDefs />
      <rect x={frame.x} y={frame.y} width={frame.width} height={frame.height} fill="#020617" />
      <rect x={frame.x} y={frame.y} width={frame.width} height={frame.height} fill={`url(#${gridId})`} />
      <g data-layer="parts">
        {preview.parts.map((part) => (
          <g key={part.id} transform={partTransform(part)}>
            <PartFootprint part={part} state={preview.state} />
          </g>
        ))}
      </g>
      <g data-layer="wires" pointerEvents="none">
        {preview.paths.map((wire) => (
          <path
            key={wire.id}
            d={wire.d}
            fill="none"
            stroke="#05080d"
            strokeWidth={1.7}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.85}
          />
        ))}
        {preview.paths.map((wire) => (
          <path
            key={`${wire.id}-core`}
            d={wire.d}
            fill="none"
            stroke={wire.colour}
            strokeWidth={0.9}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </g>
    </svg>
  );
}

/**
 * A non-interactive picture of the finished build.
 *
 * `fit="meet"` shows the whole circuit (lesson page); `fit="slice"` fills the
 * frame edge to edge for uniform card thumbs. Either way the SVG scales from
 * the content frame, so no pixel math leaks in.
 */
export function ExercisePreview({
  exercise,
  className,
  fit = 'meet',
}: {
  exercise: Exercise;
  className?: string;
  fit?: 'meet' | 'slice';
}) {
  const preview = useMemo(() => previewFor(exercise), [exercise]);
  return (
    <PreviewSvg preview={preview} label={`Finished wiring for ${exercise.title}`} className={className} fit={fit} />
  );
}

/**
 * The same picture for a gallery build: a board plus a wiring setup.
 *
 * The cache key namespaces the project and the board, so one project's Uno
 * wiring never serves as another board's image.
 */
export function GalleryPreview({
  board,
  setup,
  cacheKey,
  title,
  className,
  fit = 'meet',
}: {
  board: BoardId;
  setup: (simulation: Simulation) => void;
  cacheKey: string;
  title: string;
  className?: string;
  fit?: 'meet' | 'slice';
}) {
  const preview = useMemo(() => previewBench(board, setup, cacheKey), [board, setup, cacheKey]);
  return (
    <PreviewSvg preview={preview} label={`Finished wiring for ${title}`} className={className} fit={fit} />
  );
}
