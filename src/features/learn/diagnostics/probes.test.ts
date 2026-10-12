import { describe, expect, it } from 'vitest';
import { ONE_GLYPH, ZERO_GLYPH, convergeGlass, liveProbe, type ProbeSim } from './probes';
import { boardOption } from '../boardRegistry';
import { firmwareForBuild, galleryById } from '../gallery';
import { Simulation } from '@/features/bench';
import { breadboardDefinition } from '@/features/parts';
import { pushWokwiState } from '@/features/bench/wokwi/wokwi';
import type { FootprintState } from '@/features/bench/wokwi/footprints';

function tinyAlarmSim(): Simulation {
  const build = galleryById('alarm-clock')!.builds[0]!;
  const board = boardOption('uno').make();
  const simulation = new Simulation(board);
  simulation.addPart(board, 0, 0);
  simulation.addPart(breadboardDefinition(), 230, 0);
  build.setup(simulation);
  simulation.loadFirmware(firmwareForBuild(build, 'arduino-cpp'));
  simulation.start();
  for (let frame = 0; frame < 5; frame++) simulation.tick(0.05);
  return simulation;
}

describe('probes', () => {
  it('snapshots midnight zeros on a fresh interpreter sim', () => {
    const snap = liveProbe(tinyAlarmSim()).readGlass();
    expect(snap.glyphs).toEqual([ZERO_GLYPH, ZERO_GLYPH, ZERO_GLYPH, ZERO_GLYPH]);
  });

  it('matches the Wokwi values rendering bit for bit', () => {
    const simulation = tinyAlarmSim();
    const seg = simulation.bench.parts.find((p) => p.definition.id === '7segment-4digit')!;
    const probe = { values: [] as number[], digits: 0, colon: false, colonValue: false } as unknown as HTMLElement;
    pushWokwiState(probe, seg.definition, seg, {
      pinVolts: simulation.pinVoltages(),
      displays: simulation.displayControllers(),
    } as unknown as FootprintState);
    const values = (probe as unknown as { values: number[] }).values;
    const snap = liveProbe(simulation).readGlass();
    for (let d = 0; d < 4; d++) {
      expect([...values.slice(d * 8, d * 8 + 8)]).toEqual([...(snap.glyphs[d] ?? [])]);
    }
    expect(values).toHaveLength(32);
    expect(ONE_GLYPH).toEqual([0, 1, 1, 0, 0, 0, 0, 0]);
  });

  it('unions scripted single-segment slices into the converged full pattern', () => {
    // Live segment-multiplex parity stays covered by the AVR legs; this is the deterministic unit mirror.
    const full = [...ZERO_GLYPH];
    const blank = [0, 0, 0, 0, 0, 0, 0, 0];
    const frames: number[][][] = [];
    for (let segment = 0; segment < 8; segment++) {
      if (full[segment] !== 1) continue;
      frames.push(
        Array.from({ length: 4 }, () =>
          Array.from({ length: 8 }, (_, index) => (index === segment ? 1 : 0)),
        ),
      );
    }
    for (let frame = 0; frame < 40; frame++) {
      frames.push(Array.from({ length: 4 }, () => [...full]));
    }
    let cursor = -1;
    const probe: ProbeSim = {
      tick: () => {
        cursor += 1;
      },
      readGlass: () => ({
        glyphs: (frames[Math.min(Math.max(cursor, 0), frames.length - 1)] ?? [blank, blank, blank, blank]).map(
          (glyph) => [...glyph],
        ),
        colon: false,
        text: '',
      }),
    };
    const { glyphs, converged } = convergeGlass(probe, 80);
    expect(converged).toBe(true);
    expect(glyphs).toEqual([[...ZERO_GLYPH], [...ZERO_GLYPH], [...ZERO_GLYPH], [...ZERO_GLYPH]]);
  });
});
