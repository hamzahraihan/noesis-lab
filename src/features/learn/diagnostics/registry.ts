/**
 * Per-project check registry for the gallery smoke harness.
 *
 * Each entry pairs a gallery id × build with the scripted checks that prove
 * the build still runs, plus a factory that wraps a real `Simulation` into a
 * `CountingSim`. Check contents mirror the gallery legs in
 * `src/features/learn/gallery.test.ts` with identical tick counts and
 * margins; where a leg needs bench-deep access (`pushWokwiState` colon
 * sampling, the I2C bus log, LCD models, part knobs) the check asserts the
 * same behavior through the `HarnessSim` accessors instead, and the report
 * notes the substitution. The registry never touches the mounted bench,
 * editor state, or localStorage.
 */

import { Simulation } from '@/features/bench';
import { Max7219, MFRC522_CARD_KNOB, Pcd8544, Tm1637 } from '@/features/parts';
// Boundary-explicit: learn → simulation value edges are outside the gate's forbidden set (bench|instruments → learn, parts → simulation, shared → features); verified by `node scripts/check-boundaries.mjs`.
import {
  hexForSourcesHash,
  sourcesHashForProject,
  type FirmwareProject,
} from '@/features/simulation';
import { boardOption } from '../boardRegistry';
import { firmwareForBuild, GALLERY, type GalleryBuild } from '../gallery';
import { liveProbe } from './probes';
import type { CheckDef, CountingSim } from './harness';
import { getPartDefinitionPins } from './harness';
import { CHECKS_MAP } from '../generated/checks-map';
import type { GalleryProjectId } from '../gallery';

export interface RegistryEntry {
  readonly projectId: string;
  readonly buildLabel: string;
  readonly makeSim: () => CountingSim;
  readonly checks: CheckDef[];
  readonly extendedCapMs?: number;
}

/** Compile failures naming an unreachable backend record `skip`, not `fail`. */
const OFFLINE_RE = /offline|network|fetch failed|Tier-2.*unreachable/i;

/**
 * A real sim for one gallery build, wrapped into a `CountingSim` with the
 * harness adapter mapping: `tick` sums `d * 1000` into `simMs()`, `glass`
 * reads through `liveProbe`, buttons resolve by placement order, time jumps
 * move the engine clock, serial/GPIO read straight through, and the AVR
 * helpers expose the core, the siren-leg NVRAM staging, and the HEX-gated
 * worker compile.
 */
function makeSimFor(build: GalleryBuild, project: FirmwareProject): () => CountingSim {
  return () => {
    const board = boardOption(build.board).make();
    const sim = new Simulation(board);
    /*
     * The RP2040 engine and the emulated ESP32 live in the simulation worker;
     * this harness runs a bench in-page. Running either build on the
     * interpreter here would be the silently-wrong engine, so it refuses
     * instead of pretending.
     */
    if (build.execution === 'rp2040') {
      throw new Error('rp2040 builds run in the simulation worker, not in-page');
    }
    if (build.execution === 'esp32') {
      throw new Error('esp32 builds run in the simulation worker, not in-page');
    }
    if (build.execution === 'esp32-machine') {
      throw new Error('esp32-machine builds run in the simulation worker, not in-page');
    }
    sim.execution = build.execution ?? 'interpreter';
    sim.loadCircuit(build.circuit);
    sim.loadFirmware(project);
    sim.start();
    let total = 0;
    let tickCount = 0;
    return {
      tick: (wallDeltaSeconds: number) => {
        sim.tick(wallDeltaSeconds);
        total += wallDeltaSeconds * 1000;
        tickCount += 1;
      },
      simMs: () => total,
      ticks: () => tickCount,
      glass: () => liveProbe(sim).readGlass(),
      pressButton: (index: number, down: boolean) => {
        const target = sim.bench.parts.filter((p) => p.definition.name === 'Tactile Button')[index];
        if (target !== undefined) sim.setPressed(target.id, down);
      },
      jumpTimeMs: (ms: number) => {
        sim.engine.timeMs += ms;
      },
      serialText: () => sim.serialLines().join(''),
      scriptedReady: () => sim.scriptedReady(),
      readGpio: (gpio: number) => sim.engine.readDigital(gpio),
      partVolts: (partId: string, pinId: string) => {
        const validPins = getPartDefinitionPins(sim, partId);
        if (validPins === undefined) {
          throw new Error(`Part '${partId}' not found`);
        }
        if (!validPins.includes(pinId)) {
          throw new Error(
            `Pin '${pinId}' not found in part definition for '${partId}'. ` +
            `Valid pins: ${validPins.join(', ')}`
          );
        }
        const net = sim.engine.currentNetlist.pinNode.get(`${partId}:${pinId}`);
        return net === undefined ? 0 : sim.engine.voltageOfNet(net);
      },
      knob: (partId: string, knobId: string) => {
        const part = sim.bench.parts.find((candidate) => candidate.id === partId);
        const spec = part?.definition.knobs?.find((knob) => knob.id === knobId);
        return part && spec ? sim.controls.knob(part.id, spec) : 0;
      },
      stepperAngle: (partId: string) => sim.engine.stepperAngle(partId),
      tm1637: (partId: string) => {
        const controller = sim.engine.displayController(partId);
        return controller instanceof Tm1637 ? controller : undefined;
      },
      matrix: (partId: string) => {
        const controller = sim.engine.displayController(partId);
        return controller instanceof Max7219 ? controller : undefined;
      },
      panel: (partId: string) => {
        const controller = sim.engine.displayController(partId);
        return controller instanceof Pcd8544 ? controller : undefined;
      },
      resetAvrCore: () => {
        const core = (sim as unknown as { avrBackend: { reset(): void } | null }).avrBackend;
        if (core === null) return false;
        core.reset();
        return true;
      },
      stageArmedAlarm: () => {
        sim.engine.writeI2C(0x68, 0x08, true);
        sim.engine.writeI2C(0x68, 0x01, false);
      },
      setCard: (present: boolean) => {
        const reader = sim.bench.parts.find((part) => part.definition.component.kind === 'rc522');
        if (reader !== undefined) {
          sim.setKnob(reader.id, MFRC522_CARD_KNOB, present ? 1 : 0);
        }
      },
      tryCompile: async () => {
        if (hexForSourcesHash(sourcesHashForProject(project)) === null) {
          return { status: 'skip', detail: 'no committed HEX' };
        }
        try {
          await sim.compileAndRun(project);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          return OFFLINE_RE.test(detail) ? { status: 'skip', detail } : { status: 'fail', detail };
        }
        if (sim.compileState === 'ready') return { status: 'ready' };
        const detail =
          typeof sim.compileState === 'object' && sim.compileState !== null
            ? sim.compileState.error
            : `compileState ${String(sim.compileState)}`;
        return OFFLINE_RE.test(detail) ? { status: 'skip', detail } : { status: 'fail', detail };
      },
    };
  };
}


function checksFor(projectId: string, build: GalleryBuild): CheckDef[] {
  const factory = CHECKS_MAP[projectId as GalleryProjectId];
  if (!factory) return [];
  return factory(build);
}

export function buildRegistry(): RegistryEntry[] {
  return GALLERY.flatMap((entry) =>
    entry.builds.map((build) => {
      const project = firmwareForBuild(build, boardOption(build.board).language);
      return {
        projectId: entry.id,
        buildLabel: build.variant === undefined ? build.board : `${build.board}:${build.variant}`,
        makeSim: makeSimFor(build, project),
        checks: checksFor(entry.id, build),
        // The AVR worker compile measures ~150 s, over the 120 s runner default.
        extendedCapMs:
          entry.id === 'alarm-clock' && build.variant === 'library' ? 1_600_000 : undefined,
      };
    }),
  );
}

export * from './checks';
