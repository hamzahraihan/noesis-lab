/**
 * The finished build, as a static picture of the result.
 *
 * Every exercise already wires its completed circuit through `setup()`, which
 * is what the bench loads — and what the tests run headless. The data comes
 * from `previewFor` (`exercise-preview-data.ts`); this file only draws it
 * with the bench's own renderers (`PartFootprint`, the wire router), framed
 * on the parts the exercise placed. What the learner sees here is what lands
 * on the bench, down to the wire colours — the one honest difference is that
 * nothing is powered, so LEDs sit unlit and the caption says so.
 *
 * Board and breadboard bodies are left out of the frame on purpose: the
 * breadboard alone draws the better part of a thousand holes, which is fine
 * once on an interactive bench and ruinous thirty times on the Learn index.
 * Jumpers are drawn whole and clipped by the frame, so a wire that runs back
 * to the board reads as continuing off-frame rather than as ending mid-air.
 */

import { useId, useMemo } from 'react';
import type { Exercise } from './exercises';
import { previewFor } from './exercise-preview-data';
import { PartFootprint } from './footprints';
import { HardwareDefs } from './hardware';
import { partTransform } from './part-transform';

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
  // Suffixed: pattern ids share the document across inline SVGs, and the
  // Learn index holds thirty of these at once.
  const gridId = `${useId().replace(/:/g, 'finished-grid')}`;
  const { frame } = preview;

  return (
    <svg
      className={className}
      viewBox={`${frame.x} ${frame.y} ${frame.width} ${frame.height}`}
      preserveAspectRatio={fit === 'slice' ? 'xMidYMid slice' : 'xMidYMid meet'}
      role="img"
      aria-label={`Finished wiring for ${exercise.title}`}
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
