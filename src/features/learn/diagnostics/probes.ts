import type { Simulation } from '@/features/bench';
import type { SevenSegment } from '@/features/parts';

export const ZERO_GLYPH: readonly number[] = [1, 1, 1, 1, 1, 1, 0, 0];
export const ONE_GLYPH: readonly number[] = [0, 1, 1, 0, 0, 0, 0, 0];
export const N_GLYPH: readonly number[] = [0, 0, 1, 0, 1, 0, 1, 0];
export const F_GLYPH: readonly number[] = [1, 0, 0, 0, 1, 1, 1, 0];

export interface GlassFrame {
  readonly glyphs: number[][];
  readonly colon: boolean;
  readonly text: string;
}

export interface ProbeSim {
  tick(wallDeltaSeconds: number): void;
  readGlass(): GlassFrame;
}

export function liveProbe(simulation: Simulation): ProbeSim {
  return {
    tick: (wallDeltaSeconds: number) => simulation.tick(wallDeltaSeconds),
    readGlass: () => snapshotOf(simulation),
  };
}

function snapshotOf(simulation: Simulation): GlassFrame {
  const seg = simulation.bench.parts.find((p) => p.definition.id === '7segment-4digit');
  if (!seg) return { glyphs: [], colon: false, text: '' };
  const controller = simulation.displayControllers().get(seg.id) as unknown as
    | SevenSegment
    | undefined;
  if (!controller) return { glyphs: [], colon: false, text: '' };
  const patterns = controller.patterns();
  const glyphs = Array.from({ length: controller.digitCount }, (_, digit) => {
    const byte = patterns[digit] ?? 0;
    return Array.from({ length: 8 }, (_, index) => (byte >> index) & 1);
  });
  return { glyphs, colon: controller.colonLit, text: controller.getText() };
}

export function snapshotGlass(probe: ProbeSim): GlassFrame {
  return probe.readGlass();
}

export function convergeGlass(probe: ProbeSim, maxTicks: number): { glyphs: number[][]; converged: boolean } {
  const lit: number[][] = [0, 1, 2, 3].map(() => [0, 0, 0, 0, 0, 0, 0, 0]);
  let stable = 0;
  let converged = false;
  for (let frame = 0; frame < maxTicks; frame++) {
    probe.tick(0.01);
    const frame_ = probe.readGlass();
    let changed = false;
    for (let d = 0; d < 4; d++) {
      for (let s = 0; s < 8; s++) {
        if ((frame_.glyphs[d]?.[s] ?? 0) === 1 && lit[d]![s] === 0) {
          lit[d]![s] = 1;
          changed = true;
        }
      }
    }
    stable = changed ? 0 : stable + 1;
    if (stable >= 14 && frame >= 30) {
      converged = true;
      break;
    }
  }
  return { glyphs: lit, converged };
}
