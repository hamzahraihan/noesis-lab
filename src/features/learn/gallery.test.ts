import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import {
  BH1750_LIGHT_KNOB,
  DS3231_TEMPERATURE_KNOB,
  MAX6675_TEMPERATURE_KNOB,
  MFRC522_CARD_KNOB,
  PART_CATALOGUE,
  SEGMENT_MAP,
  SevenSegment,
  SHT31_HUMIDITY_KNOB,
  SHT31_TEMPERATURE_KNOB,
  SUPPLY_VOLTAGE_KNOB,
  TMP102_TEMPERATURE_KNOB,
  Tm1637,
} from '@/features/parts';
import { boardOption } from './boardRegistry';
import {
  GALLERY,
  boardsFor,
  buildFor,
  firmwareForBuild,
  galleryById,
  type GalleryBuild,
} from './gallery';
import { wireFloorFor } from './generated/test-coverage';
import type { GalleryProjectId } from './gallery';
import { TIER2_MANIFEST } from '@/features/simulation';
import { previewBench } from './exercise-preview-data';
import { Simulation } from '@/features/bench/simulations/simulation';
import { pushWokwiState } from '@/features/bench/wokwi/wokwi';
import type { FootprintState } from '@/features/bench/wokwi/footprints';
import {
  FIVE_GLYPH,
  F_GLYPH,
  N_GLYPH,
  ONE_GLYPH,
  ZERO_GLYPH,
  convergeGlass,
  liveProbe,
} from './diagnostics/probes';

const CATALOGUE_NAMES = new Set(PART_CATALOGUE.map((entry) => entry.make().name));

/**
 * A bench for a build: the board the build runs on, with its circuit document
 * loaded onto it.
 *
 * The document carries the board and the breadboard, so nothing is placed here
 * -- `loadCircuit` restores the whole circuit, and a part placed before it
 * would be discarded by that restore. Loading is also where a broken document
 * surfaces: it returns its errors instead of a half-wired bench, and a test
 * carrying on from one would be asserting against the wrong circuit.
 */
function benchFor(build: GalleryBuild): Simulation {
  const definition = boardOption(build.board).make();
  const simulation = new Simulation(definition);
  const errors = simulation.loadCircuit(build.circuit);
  if (errors.length > 0) throw new Error(`${build.board}: ${errors.join('; ')}`);
  return simulation;
}

function partTerminals(simulation: Simulation): Set<number> {
  const ids = new Set<number>();
  for (const part of simulation.bench.parts) {
    for (const id of Object.values(part.terminals)) ids.add(id);
  }
  return ids;
}

/**
 * Whether the committed alarm HEX is on disk. The avr parity legs run the
 * same assertions against the flashed HEX; where the HEX is absent (e.g. an
 * environment whose install never fetched the toolchain) they skip with a
 * reason instead of weakening any assertion.
 */
function hexAvailable(): boolean {
  return existsSync(join(__dirname, '..', 'simulation', 'avr', 'hex', 'alarm-clock-uno.hex'));
}

/**
 * Whether the Tier-2 fetch path answers at all. The declared build runs from
 * the committed HEX, but its declarations name fetched libraries, so parity
 * means nothing on a bench that could never fetch them. Any HTTP answer
 * counts as reachable; only a network failure or timeout skips.
 */
async function tier2Reachable(): Promise<boolean> {
  try {
    const response = await fetch(TIER2_MANIFEST[0].url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000),
    });
    return response.status > 0;
  } catch {
    return false;
  }
}

/*
 * The gallery JSON is read as UTF-8 by the generator and by every tool that
 * rewrites it. A writer that treats those bytes as Windows-1252 leaves the file
 * parsable and the strings subtly wrong -- an em-dash becomes three characters --
 * and nothing downstream notices: the sketches still compile, and the only
 * consumer that hashes the text is the AVR hex manifest, whose drift is reported
 * as a hash mismatch two steps away from the cause. So the encoding is asserted
 * where the text enters the repo.
 */
describe('the gallery JSON encoding', () => {
  it('reads as UTF-8 and carries no double-encoded characters', () => {
    const source = readFileSync(join(__dirname, 'gallery-projects.json'), 'utf8');
    // A UTF-8 byte sequence decoded as Windows-1252 survives as these characters:
    // `Ã`/`Â` before a Latin-1 range char, or the three-character `â€…` run that an
    // em-dash, en-dash, quote or ellipsis becomes.
    expect(source).not.toMatch(/[ÃÂ][\u0080-\u00bf]/);
    expect(source).not.toMatch(/â€[\u0080-\u00bf\u2018-\u201d]/);
    // Every code point the file carries must be a real character, not a byte
    // value parked in the C1 range where no text belongs.
    const stray = [...source].filter((char) => {
      const code = char.codePointAt(0)!;
      return (code >= 0x80 && code <= 0x9f) || code === 0xfffd;
    });
    expect(stray).toEqual([]);
  });
});

describe('the project gallery', () => {
  it('numbers every project uniquely and builds each at least once', () => {
    const ids = GALLERY.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of GALLERY) {
      expect(entry.builds.length, `${entry.id} builds`).toBeGreaterThan(0);
      expect(galleryById(entry.id)?.id).toBe(entry.id);
      for (const build of entry.builds) {
        expect(boardOption(build.board).id).toBe(build.board);
      }
    }
    expect(galleryById('nope')).toBeNull();
  });

  it('resolves builds per board and none where none exist', () => {
    for (const entry of GALLERY) {
      expect(boardsFor(entry)).toEqual([...new Set(entry.builds.map((build) => build.board))]);
      for (const board of boardsFor(entry)) {
        expect(buildFor(entry, board)?.board).toBe(board);
      }
      expect(buildFor(entry, 'mega')).toBeNull();
    }
    const alarm = galleryById('alarm-clock')!;
    expect(buildFor(alarm, 'uno')?.sketch).toBe(alarm.builds[0]!.sketch);
    expect(buildFor(alarm, 'uno', 'nope')).toBe(alarm.builds[0]!);
    // Unknown variant falls back to the default build (see plan Task 1 ruling).
    expect(buildFor(alarm, 'uno', 'library')).toBe(alarm.builds[1]!);
    // Both builds share one circuit: guards against wiring drift between them.
    expect(alarm.builds[1]!.circuit).toBe(alarm.builds[0]!.circuit);
  });

  it('names only parts the catalogue stocks or the circuit defines, and says what running shows', () => {
    for (const entry of GALLERY) {
      // A build may carry its own part definitions (behaviour parts), so the
      // list may name a part the catalogue does not stock: what it must name
      // is something the reader will actually find on the bench.
      const defined = new Set(
        entry.builds.flatMap((build) =>
          (build.circuit.definitions ?? []).map((definition) => definition.name),
        ),
      );
      for (const part of entry.parts) {
        expect(
          CATALOGUE_NAMES.has(part.name) || defined.has(part.name),
          `${entry.id} part "${part.name}"`,
        ).toBe(true);
        expect(part.qty).toBeGreaterThan(0);
      }
      expect(entry.working.length, `${entry.id} working`).toBeGreaterThan(0);
      expect(entry.blurb.length, `${entry.id} blurb`).toBeGreaterThan(0);
    }
  });

  it('parses every build sketch in its board language', () => {
    for (const entry of GALLERY) {
      for (const build of entry.builds) {
        const simulation = benchFor(build);
        simulation.loadFirmware(firmwareForBuild(build, boardOption(build.board).language));
        expect(
          simulation.firmwareError,
          `${entry.id}/${build.board}: ${simulation.firmwareError}`,
        ).toBeNull();
      }
    }
    const lib = buildFor(galleryById('alarm-clock')!, 'uno', 'library')!;
    expect(lib.execution).toBe('avr');
    /*
     * Live on the interpreter, not just parsed: the same glass, colon, and
     * button observables as the raw-GPIO build, driven through the SevSeg
     * and tone models instead of the raw multiplex tables. The build keeps
     * its `avr` flag — the HEX legs below still flash the committed library
     * HEX — but the interpreter no longer rejects it, retiring the AVR-only
     * contract.
     */
    const libSim = benchFor(lib);
    libSim.loadFirmware(firmwareForBuild(lib, 'arduino-cpp'));
    expect(libSim.firmwareError, 'library build firmware').toBeNull();
    libSim.start();
    const segPart = (): NonNullable<ReturnType<Simulation['bench']['parts']['find']>> =>
      // Resolved per frame: the part list is stable, but looking it up
      // here keeps the sampling loop honest about what is on the bench.
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      libSim.bench.parts.find((p) => p.definition.id === '7segment-4digit')!;
    const glass = (): string => {
      const ctrl = libSim.displayControllers().get(segPart().id) as unknown as SevenSegment;
      return ctrl.getText();
    };
    // D2-D5 are the four digit commons; SevSeg's refreshDisplay multiplexes
    // one digit per loop pass, the way the raw dspRefresh does. The colon
    // blinks once a second beside them, driven straight from the RTC second.
    // Frames are dear here — the delay-free sketch fragments each one into
    // hundreds of settles — so the blink is sampled across millisecond jumps
    // (the moves-leg technique) instead of wall-clocked frames. Samples retry
    // until both parities have been observed (bounded): firmware loop phase
    // vs sample instants is arbitrary — any loop-cost change re-rolls it —
    // so a fixed 4-sample script can sit inside one parity even while the
    // blink itself runs fine. Only a truly stuck colon exhausts the retries.
    let digitSeenHigh = false;
    const colonSamples: boolean[] = [];
    const sampleColon = (): void => {
      const probe = {
        values: [] as number[],
        digits: 0,
        colon: false,
        colonValue: false,
      } as unknown as HTMLElement;
      pushWokwiState(probe, segPart().definition, segPart(), {
        pinVolts: libSim.pinVoltages(),
        displays: libSim.displayControllers(),
      } as unknown as FootprintState);
      colonSamples.push((probe as unknown as { colonValue: boolean }).colonValue);
    };
    const runFrames = (frames: number): void => {
      for (let frame = 0; frame < frames; frame++) {
        libSim.tick(0.05);
        for (const gpio of [2, 3, 4, 5]) {
          if (libSim.engine.readDigital(gpio)) digitSeenHigh = true;
        }
      }
    };
    // Colon blink: drive the RTC to a known even second, await the lit
    // colon, then step a second forward and await it dark (all bounded).
    // Fixed scripts sit inside one parity whenever firmware loop phase
    // misaligns with sample instants, so this asserts tracking instead of
    // luck: only a truly stuck colon exhausts the caps.
    const awaitColon = (want: boolean, frames: number): boolean => {
      for (let frame = 0; frame < frames; frame++) {
        libSim.tick(0.05);
        sampleColon();
        if (colonSamples[colonSamples.length - 1] === want) return true;
      }
      return false;
    };
    runFrames(5);
    sampleColon();
    // Land just inside the next even second, then a second later.
    libSim.engine.timeMs += ((2000 - (libSim.engine.timeMs % 2000)) % 2000) + 300;
    expect(awaitColon(true, 40), 'colon lights on an even second').toBe(true);
    libSim.engine.timeMs += 1000;
    expect(awaitColon(false, 40), 'colon darkens on an odd second').toBe(true);
    expect(digitSeenHigh, 'library build multiplexes its digits').toBe(true);
    expect(new Set(colonSamples), 'library build colon blinks once a second').toEqual(
      new Set([false, true]),
    );
    // The bench starts at 15:00, so the digits hold '1', '5', '0', '0'.
    const element = {
      values: [] as number[],
      digits: 0,
      colon: false,
      colonValue: false,
    } as unknown as HTMLElement;
    pushWokwiState(element, segPart().definition, segPart(), {
      pinVolts: libSim.pinVoltages(),
      displays: libSim.displayControllers(),
    } as unknown as FootprintState);
    const values = (element as unknown as { values: number[] }).values;
    expect(values).toHaveLength(32);
    const afternoon = [ONE_GLYPH, FIVE_GLYPH, ZERO_GLYPH, ZERO_GLYPH];
    for (let d = 0; d < 4; d++) {
      expect(values.slice(d * 8, d * 8 + 8), `library build digit ${d + 1} shows 1500`).toEqual(
        afternoon[d],
      );
    }
    expect((element as unknown as { colon: boolean }).colon, 'library build colon enabled').toBe(
      true,
    );
    // Buttons rest HIGH on their pull-ups; the disarmed buzzer rests LOW.
    expect(libSim.engine.readDigital(14), 'library build hours button released').toBe(true);
    expect(libSim.engine.readDigital(15), 'library build minutes button released').toBe(true);
    expect(libSim.engine.readDigital(16), 'library build alarm button released').toBe(true);
    expect(libSim.engine.readDigital(17), 'library build buzzer silent while disarmed').toBe(false);
    // A minute of RTC time moves the minute digits through the SevSeg text
    // path, the way the AVR HEX leg proves below.
    expect(glass(), 'library build idles at 15:00').toBe('1500');
    libSim.engine.timeMs += 61000;
    runFrames(5);
    expect(glass(), 'library build shows 15:01 a minute later').toBe('1501');
    // An Alarm tap disarms the pre-armed clock: the toggle saves NVRAM over
    // writes and the glass switches to the setChars status view. The button
    // stays held through the sampling so the 1000 ms status window cannot
    // lapse mid-probe, mirroring the AVR status leg. The bus log caps at 200
    // transfers while every loop pass polls the clock, so the save is
    // latched frame by frame instead of read back at the end.
    const alarmButton = libSim.bench.parts.filter(
      (p) => p.definition.name === 'Tactile Button',
    )[2]!;
    libSim.clearBusLog();
    libSim.setPressed(alarmButton.id, true);
    let saved = false;
    for (let frame = 0; frame < 6; frame++) {
      libSim.tick(0.05);
      for (const gpio of [2, 3, 4, 5]) {
        if (libSim.engine.readDigital(gpio)) digitSeenHigh = true;
      }
      saved =
        saved ||
        libSim
          .busLines()
          .some(
            (entry) =>
              entry.bus === 'i2c' &&
              entry.address === 0x68 &&
              entry.bytes.length === 2 &&
              entry.bytes[0] === 8 &&
              entry.bytes[1] === 0,
          );
    }
    const statusProbe = {
      values: [] as number[],
      digits: 0,
      colon: false,
      colonValue: false,
    } as unknown as HTMLElement;
    pushWokwiState(statusProbe, segPart().definition, segPart(), {
      pinVolts: libSim.pinVoltages(),
      displays: libSim.displayControllers(),
    } as unknown as FootprintState);
    const statusValues = (statusProbe as unknown as { values: number[] }).values;
    // Blank digits keep stale bits from the 15:00 view, so only the
    // driven digits are asserted: ' ' stays blank, 'o' renders as 'O' (the
    // same segments as '0'), 'F' lights A/F/G/E.
    expect(statusValues.slice(1 * 8, 2 * 8), 'library build status shows O').toEqual(ZERO_GLYPH);
    expect(statusValues.slice(2 * 8, 3 * 8), 'library build status shows F').toEqual(F_GLYPH);
    libSim.setPressed(alarmButton.id, false);
    // Past the 1000 ms status window by jump rather than by frames (see the
    // colon note above): the status lapses back into the clock view —
    // disarmed shows the clock, which the minute jump above already moved
    // to 15:01 — so the glass reads the clock again.
    libSim.engine.timeMs += 1500;
    runFrames(5);
    expect(libSim.firmwareError, 'library build still runs after the tap').toBeNull();
    expect(glass(), 'library build returns to the clock view').toBe('1501');
    expect(saved, 'library build saves the disarm over I2C').toBe(true);
  }, 120_000);

  it('runs the alarm library build on the interpreter', () => {
    const build = buildFor(galleryById('alarm-clock')!, 'uno', 'library')!;
    const simulation = benchFor(build);
    simulation.loadFirmware(firmwareForBuild(build, 'arduino-cpp'));
    expect(simulation.firmwareError, 'library build firmware').toBeNull();
  });

  it('loads every build circuit onto its board bench', () => {
    for (const entry of GALLERY) {
      for (const build of entry.builds) {
        const key = `${entry.id}/${build.board}`;
        // `benchFor` throws on a document that will not compile, so a bench
        // reaching the assertions below is one the operator would be given.
        const simulation = benchFor(build);
        expect(
          simulation.bench.parts.some(
            (part) => part.definition.id === simulation.mcu.definition.id,
          ),
          `${key} board`,
        ).toBe(true);
        expect(simulation.bench.wires.length, `${key} wires`).toBeGreaterThanOrEqual(
          wireFloorFor(entry.id as GalleryProjectId),
        );
        const real = partTerminals(simulation);
        const touched = new Set<number>();
        for (const wire of simulation.bench.wires) {
          expect(real.has(wire.from), `${key} wire from`).toBe(true);
          expect(real.has(wire.to), `${key} wire to`).toBe(true);
          touched.add(wire.from);
          touched.add(wire.to);
        }
        for (const part of entry.parts) {
          const placed = simulation.bench.parts.filter(
            (p) => p.definition.name === part.name,
          ).length;
          expect(placed, `${key} "${part.name}" qty`).toBeGreaterThanOrEqual(part.qty);
        }
        for (const part of simulation.bench.parts) {
          const kind = part.definition.component.kind;
          if (kind === 'mcu' || kind === 'breadboard') continue;
          const wired = Object.values(part.terminals).some((id) => touched.has(id));
          expect(wired, `${key} "${part.definition.name}" wired`).toBe(true);
        }
      }
    }
  });

  it('frames every project preview on real content', () => {
    for (const entry of GALLERY) {
      for (const build of entry.builds) {
        const preview = previewBench(
          build.board,
          build.circuit,
          `gallery:${build.board}:${entry.id}`,
        );
        expect(preview.parts.length, `${entry.id} parts`).toBeGreaterThan(0);
        expect(preview.paths.length, `${entry.id} paths`).toBeGreaterThan(0);
      }
    }
  });

  it('opens with the alarm clock', () => {
    expect(galleryById('alarm-clock')?.title).toBe('Alarm Clock with RTC');
  });

  it('locks digits behind the safe', () => {
    expect(galleryById('safe')?.title).toBe('Electronic Safe');
  });

  it('sweeps the dashboard horn', () => {
    expect(galleryById('dashboard')?.title).toBe('Servo Dashboard');
  });

  it('beeps at the parking sensor', () => {
    expect(galleryById('parking')?.title).toBe('Parking Sensor');
  });

  it('logs the weather station', () => {
    expect(galleryById('weather')?.title).toBe('Weather Station');
  });

  it('times the reaction game', () => {
    expect(galleryById('reaction')?.title).toBe('Reaction Timer');
  });

  it('declares SevSeg and RTClib on the alarm build, unpinned', () => {
    const build = galleryById('alarm-clock')!.builds[0]!;
    expect(build.libraries).toEqual([
      { name: 'SevSeg', source: 'provided' },
      { name: 'RTClib', source: 'provided' },
    ]);
    // The bench project carries the declarations; versions unpinned means the
    // manifest defaults apply at fetch time.
    expect(firmwareForBuild(build, 'arduino-cpp').libraries).toEqual(build.libraries);
  });

  it('declares no libraries on the raw builds', () => {
    for (const id of ['safe', 'dashboard', 'parking', 'weather', 'reaction'] as const) {
      expect(galleryById(id)!.builds[0]!.libraries, `${id} declares no libraries`).toEqual([]);
    }
  });

  /*
   * Live parity for the library-declared alarm build: the same glass, colon,
   * and serial observables as the raw-GPIO build, running under `execution
   * avr` with the declared libraries attached. Gated three ways — toolchain,
   * Tier-2 fetch, committed HEX — with a skip-with-reason for each, the same
   * pattern the other avr legs use.
   */
  it('runs the library-declared alarm build', async () => {
    let pkg: string | null = null;
    try {
      pkg = createRequire(import.meta.url).resolve('@horang-corp/avr-gcc-wasm/package.json');
    } catch {
      /* fall through to skip */
    }
    if (!pkg) {
      console.warn('SKIP avr parity: toolchain absent');
      return;
    }
    if (!hexAvailable()) {
      console.warn('SKIP avr parity: no HEX');
      return;
    }
    if (!(await tier2Reachable())) {
      console.warn('SKIP avr parity: Tier-2 fetch unreachable');
      return;
    }
    const build = galleryById('alarm-clock')!.builds[0]!;
    const simulation = benchFor(build);
    simulation.execution = 'avr';
    const firmware = firmwareForBuild(build, 'arduino-cpp');
    expect(firmware.libraries, 'alarm build declares its libraries').toEqual([
      { name: 'SevSeg', source: 'provided' },
      { name: 'RTClib', source: 'provided' },
    ]);
    simulation.loadFirmware(firmware);
    expect(simulation.firmwareError, 'alarm-clock firmware').toBeNull();
    simulation.start();
    const glass = (): string => {
      const seg = simulation.bench.parts.find((p) => p.definition.id === '7segment-4digit')!;
      const ctrl = simulation.displayControllers().get(seg.id) as unknown as SevenSegment;
      return ctrl.getText();
    };
    // The glass itself, sampled like the live LCD leg: the digits hold
    // '1', '5', '0', '0' at 15:00. The colon is driven to a known even
    // second and awaited lit, then stepped a second forward and awaited
    // dark (all bounded): fixed scripts sit inside one parity whenever
    // firmware loop phase misaligns with sample instants, so this asserts
    // tracking instead of luck.
    const colonSamples: boolean[] = [];
    const sampleColonRaw = (): void => {
      const segPart = simulation.bench.parts.find((p) => p.definition.id === '7segment-4digit')!;
      const probe = {
        values: [] as number[],
        digits: 0,
        colon: false,
        colonValue: false,
      } as unknown as HTMLElement;
      pushWokwiState(probe, segPart.definition, segPart, {
        pinVolts: simulation.pinVoltages(),
        displays: simulation.displayControllers(),
      } as unknown as FootprintState);
      colonSamples.push((probe as unknown as { colonValue: boolean }).colonValue);
    };
    const awaitColonRaw = (want: boolean, frames: number): boolean => {
      for (let frame = 0; frame < frames; frame++) {
        simulation.tick(0.05);
        sampleColonRaw();
        if (colonSamples[colonSamples.length - 1] === want) return true;
      }
      return false;
    };
    for (let frame = 0; frame < 120; frame++) simulation.tick(0.05);
    simulation.engine.timeMs += ((2000 - (simulation.engine.timeMs % 2000)) % 2000) + 300;
    expect(awaitColonRaw(true, 60), 'declared build colon lights on an even second').toBe(true);
    simulation.engine.timeMs += 1000;
    expect(awaitColonRaw(false, 60), 'declared build colon darkens on an odd second').toBe(true);
    // The digits themselves must move: 15:00, then one minute later.
    for (let frame = 0; frame < 30; frame++) simulation.tick(0.05);
    expect(glass(), 'declared build idles at 15:00').toBe('1500');
    simulation.engine.timeMs += 61000;
    for (let frame = 0; frame < 12; frame++) simulation.tick(0.05);
    expect(glass(), 'declared build shows 15:01 a minute later').toBe('1501');
    // The serial log carries one t=H:M:S line per loop: the seconds in them
    // must advance, proving the RTC ticks under the display.
    const seconds = [
      ...simulation
        .serialLines()
        .join('')
        .matchAll(/t=\d+:\d+:(\d+)/g),
    ].map((match) => Number(match[1]));
    expect(new Set(seconds).size, 'declared build clock ticks').toBeGreaterThan(1);
  }, 180_000);

  /*
   * Live Tier-2 runtime proof: a NEW fixture sketch (the gallery sketch above
   * stays raw-GPIO) that includes the recorded Tier-2 headers, instantiates
   * their objects, and calls their API every loop — SevSeg multiplexing plus
   * an RTC read. Every name used exists in the recorded sources (SevSeg
   * 3.7.0: `SevSeg`, `begin(COMMON_ANODE, ...)`, `setNumber`,
   * `refreshDisplay`; RTClib 2.1.4: `RTC_DS1307`, `begin`, `now`, `DateTime`
   * `hour`/`minute`). The bench reuses the alarm wiring so the digit commons
   * sit on D2-D5. Gated on toolchain + Tier-2 fetch with the same
   * skip-with-reason pattern; on skip the test passes vacuously.
   */
  it('runs a Tier-2 SevSeg+RTClib fixture live on the bench', async () => {
    let pkg: string | null = null;
    try {
      pkg = createRequire(import.meta.url).resolve('@horang-corp/avr-gcc-wasm/package.json');
    } catch {
      /* fall through to skip */
    }
    if (!pkg) {
      console.warn('SKIP Tier-2 fixture: toolchain absent');
      return;
    }
    if (!(await tier2Reachable())) {
      console.warn('SKIP Tier-2 fixture: Tier-2 fetch unreachable');
      return;
    }
    const alarmCircuit = galleryById('alarm-clock')!.builds[0]!.circuit;
    const simulation = benchFor(galleryById('alarm-clock')!.builds[0]!);
    simulation.execution = 'avr';
    const fixture = `#include <Arduino.h>
#include <Wire.h>
#include <SevSeg.h>
#include <RTClib.h>

SevSeg sevseg;
RTC_DS1307 rtc;

byte digitPins[4] = {2, 3, 4, 5};
byte segmentPins[8] = {6, 7, 8, 9, 10, 11, 12, 13};

void setup() {
  Wire.begin();
  rtc.begin();
  sevseg.begin(COMMON_ANODE, 4, digitPins, segmentPins, false, false, false);
  sevseg.setBrightness(90);
}

void loop() {
  DateTime t = rtc.now();
  sevseg.setNumber(t.hour() * 100 + t.minute());
  sevseg.refreshDisplay();
}
`;
    const firmware = firmwareForBuild(
      {
        board: 'uno',
        circuit: alarmCircuit,
        sketch: fixture,
        libraries: [
          { name: 'SevSeg', source: 'provided' },
          { name: 'RTClib', source: 'provided' },
        ],
      },
      'arduino-cpp',
    );
    await simulation.compileAndRun(firmware);
    expect(simulation.compileState, 'Tier-2 fixture compiles').toBe('ready');
    expect(simulation.firmwareError, 'Tier-2 fixture firmware').toBeNull();
    simulation.start();
    // D2-D5 are the four digit commons; COMMON_ANODE drives the selected
    // digit HIGH, sampled the same way as the raw-GPIO multiplexing legs.
    let digitSeenHigh = false;
    for (let frame = 0; frame < 120; frame++) {
      simulation.tick(0.05);
      if (simulation.firmwareError !== null) break;
      for (const gpio of [2, 3, 4, 5]) {
        if (simulation.engine.readDigital(gpio)) digitSeenHigh = true;
      }
    }
    expect(digitSeenHigh, 'Tier-2 SevSeg multiplexes its digits').toBe(true);
    expect(simulation.firmwareError, 'Tier-2 fixture runs without fault').toBeNull();
    // Budget: a cold Tier-2 build compiles eight translation units through
    // the wasm toolchain (measured ~2 min, not seconds); the browser reuses
    // its versioned cache across sessions, Node rebuilds every run.
  }, 1_500_000);

  /*
   * Live on the bench, not just wired: the glass must show the project's own
   * text and keep showing new text as time moves. This is the test that would
   * have caught the D2 pin collision (blank/garbled LCD) and the frozen RTC
   * (a clock that never ticks) before any learner did.
   *
   * The alarm clock drives a multiplexed 7-segment display straight from GPIO
   * rather than through a text controller, so the test watches the solved
   * nets instead: the last-driven digit common stays high through the delay,
   * and the serial log proves the RTC is ticking underneath it.
   */
  it('runs each LCD project live on the bench', () => {
    for (const execution of ['interpreter', 'avr'] as const) {
      for (const id of ['alarm-clock', 'weather'] as const) {
        const entry = galleryById(id)!;
        const build = entry.builds[0];
        if (execution === 'avr' && !hexAvailable()) {
          console.warn('SKIP avr parity: no HEX');
          continue;
        }
        const simulation = benchFor(build);
        simulation.execution = execution;
        simulation.loadFirmware(firmwareForBuild(build, 'arduino-cpp'));
        expect(simulation.firmwareError, `${id} firmware`).toBeNull();
        simulation.start();
        if (id === 'alarm-clock') {
          let digitSeenHigh = false;
          const segPartEarly = (): NonNullable<ReturnType<Simulation['bench']['parts']['find']>> =>
            // Resolved per frame: the part list is stable, but looking it up
            // here keeps the sampling loop honest about what is on the bench.
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            simulation.bench.parts.find((p) => p.definition.id === '7segment-4digit')!;
          const colonSamples: boolean[] = [];
          for (let frame = 0; frame < 120; frame++) {
            simulation.tick(0.05);
            // D2-D5 are the four digit commons; the last-driven one persists
            // HIGH through the end-of-loop delay.
            for (const gpio of [2, 3, 4, 5]) {
              if (simulation.engine.readDigital(gpio)) digitSeenHigh = true;
            }
            if (frame % 20 === 19) {
              const probe = {
                values: [] as number[],
                digits: 0,
                colon: false,
                colonValue: false,
              } as unknown as HTMLElement;
              pushWokwiState(probe, segPartEarly().definition, segPartEarly(), {
                pinVolts: simulation.pinVoltages(),
                displays: simulation.displayControllers(),
              } as unknown as FootprintState);
              const target = probe as unknown as { colonValue: boolean };
              colonSamples.push(target.colonValue);
            }
          }
          expect(digitSeenHigh, `${id} multiplexes its digits`).toBe(true);
          // The glass itself: push the solved state into the Wokwi element and
          // read back all four digits. The bench starts at 15:00, so the digits
          // hold '1', '5', '0', '0'. The colon blinks once a second beside them.
          const segPart = simulation.bench.parts.find(
            (p) => p.definition.id === '7segment-4digit',
          )!;
          const element = {
            values: [] as number[],
            digits: 0,
            colon: false,
            colonValue: false,
          } as unknown as HTMLElement;
          pushWokwiState(element, segPart.definition, segPart, {
            pinVolts: simulation.pinVoltages(),
            displays: simulation.displayControllers(),
          } as unknown as FootprintState);
          const values = (element as unknown as { values: number[] }).values;
          expect(values).toHaveLength(32);
          const afternoon = [ONE_GLYPH, FIVE_GLYPH, ZERO_GLYPH, ZERO_GLYPH];
          for (let d = 0; d < 4; d++) {
            const slice = values.slice(d * 8, d * 8 + 8);
            expect(slice, `${id} digit ${d + 1} shows 1500`).toEqual(afternoon[d]);
          }
          const colonState = element as unknown as { colon: boolean; colonValue: boolean };
          expect(colonState.colon, `${id} colon enabled`).toBe(true);
          // The blink proves the glass moves every second, not just once a minute.
          expect(new Set(colonSamples), `${id} colon blinks once a second`).toEqual(
            new Set([false, true]),
          );
          // Buttons rest HIGH on their pull-ups; the disarmed buzzer rests LOW.
          expect(simulation.engine.readDigital(14), `${id} hours button released`).toBe(true);
          expect(simulation.engine.readDigital(15), `${id} minutes button released`).toBe(true);
          expect(simulation.engine.readDigital(16), `${id} alarm button released`).toBe(true);
          expect(
            simulation.engine.readDigital(17),
            `${id} buzzer silent while armed but not due`,
          ).toBe(false);
          // The serial log carries one t=H:M:S line per loop: the seconds in
          // them must advance, proving the RTC ticks under the display.
          const seconds = [
            ...simulation
              .serialLines()
              .join('')
              .matchAll(/t=\d+:\d+:(\d+)/g),
          ].map((match) => Number(match[1]));
          expect(new Set(seconds).size, `${id} clock ticks`).toBeGreaterThan(1);
          // A tap on Alarm exercises the multi-file path end to end: the
          // button module's release verdict, the clock module's toggle plus
          // NVRAM save over real I2C writes, and the status view switch.
          const alarmButton = simulation.bench.parts.filter(
            (p) => p.definition.name === 'Tactile Button',
          )[2]!;
          simulation.setPressed(alarmButton.id, true);
          for (let frame = 0; frame < 12; frame++) simulation.tick(0.05);
          simulation.setPressed(alarmButton.id, false);
          for (let frame = 0; frame < 12; frame++) simulation.tick(0.05);
          expect(simulation.firmwareError, `${id} still runs after the tap`).toBeNull();
          expect(
            simulation.serialLines().join(''),
            `${id} alarm toggles on a short press`,
          ).toContain('alarm toggled');
          continue;
        }
        const glasses: string[] = [];
        for (let frame = 0; frame < 120; frame++) {
          simulation.tick(0.05);
          if (frame % 40 === 39) {
            const lcd = [...simulation.lcdModels().values()][0];
            glasses.push(lcd ? lcd.text() : '');
          }
        }
        for (const glass of glasses) {
          expect(glass, `${id} glass shows readings`).toMatch(/t \d/);
          expect(glass, `${id} glass shows humidity`).toMatch(/rh \d/);
        }
      }
    }
    // Budget covers the newly-live avr legs: cycle-accurate 16 MHz
    // simulation of 120 frames x 4 combos costs ~40 s solo, more under
    // full-suite load (the 60 s budget dates from when avr legs skipped).
  }, 180_000);

  /*
   * The digits themselves must move — over RTC time and under the buttons.
   * Idle glass, DP blink and serial ticks all passed while the numbers never
   * budged, which is exactly the reported symptom, so this test watches the
   * decoded text: 15:00, one minute later, then an Hour tap on top.
   */
  it('runs the scripted probe live: the knob is the sensor', async () => {
    const build = galleryById('soil-probe')!.builds[0]!;
    const simulation = benchFor(build);
    simulation.execution = 'interpreter';
    await simulation.scriptedReady();
    simulation.loadFirmware(firmwareForBuild(build, 'arduino-cpp'));
    expect(simulation.firmwareError).toBeNull();
    simulation.start();

    const readPercent = (): number => {
      const matches = [
        ...simulation
          .serialLines()
          .join('')
          .matchAll(/moisture (\d+)%/g),
      ];
      return Number(matches.at(-1)![1]);
    };
    const run = (seconds: number): void => {
      for (let i = 0; i < seconds * 20; i++) simulation.tick(0.05);
    };

    // The safe state first: the runtime is installed, so the divider carries
    // the knob's default (40) and the ADC reads it back through the sketch.
    run(1.5);
    expect(readPercent()).toBeGreaterThan(30);
    expect(readPercent()).toBeLessThan(50);

    // Turn the operator's knob: same part, same wire, a different answer.
    const probe = simulation.bench.parts.find((part) => part.definition.id === 'soil-probe')!;
    const knob = probe.definition.knobs![0]!;
    simulation.setKnob(probe.id, knob, 10);
    run(1.5);
    expect(readPercent()).toBeLessThan(20);
  }, 60_000);

  it('runs the instrument bench live: three instruments on one bus', () => {
    const build = galleryById('instrument-bench')!.builds[0]!;
    const simulation = benchFor(build);
    simulation.execution = 'interpreter';
    simulation.loadFirmware(firmwareForBuild(build, 'arduino-cpp'));
    expect(simulation.firmwareError).toBeNull();
    simulation.start();

    // The sketch reads for a second before its first line, so the bench has
    // to run for longer than that.
    for (let i = 0; i < 60; i++) simulation.tick(0.05);
    // Serial.print fragments concatenate; only println breaks the line, so
    // the stream is joined the way the monitor joins it.
    const log = simulation.serialLines().join('');

    /*
     * The barometer reports raw counts and the sketch does the datasheet's
     * arithmetic, so what it prints is what the operator dialled in.
     */
    expect(log).toContain('barometer 1013 hPa');
    expect(log).toContain('temperature 20.0 C');
    /*
     * The monitor's own registers: the current, the voltage across its
     * shunt, the bus it watches and the power, all read over the bus.
     */
    expect(log).toContain('monitor 100 mA');
    expect(log).toContain('shunt 10 mV');
    expect(log).toContain('bus 5 V');
    expect(log).toContain('power 500 mW');
    // The converter is pointed at channel zero, which is at zero volts.
    expect(log).toContain('converter 0 counts');
  }, 60_000);

  it('runs the environment bench live: three sensors on one bus', () => {
    const build = galleryById('environment-bench')!.builds[0]!;
    const simulation = benchFor(build);
    simulation.execution = 'interpreter';
    simulation.loadFirmware(firmwareForBuild(build, 'arduino-cpp'));
    expect(simulation.firmwareError).toBeNull();
    simulation.start();

    for (let i = 0; i < 60; i++) simulation.tick(0.05);
    const log = (): string => simulation.serialLines().join('');
    const first = log();
    expect(first).toContain('light 250 lx');
    expect(first).toContain('tmp102 21.00 C');
    expect(first).toContain('sht31 21.00 C');
    expect(first).toContain('humidity 45.0 %');
    expect(first).toContain('crc ok');

    // Each sensor's own knob is the air or the light on the bench: turning
    // them changes what the next conversion reports, not what the sketch
    // assumes. The line is assembled from three independent protocols.
    const part = (id: string) =>
      simulation.bench.parts.find((candidate) => candidate.definition.id === id)!;
    simulation.setKnob(part('bh1750-light').id, BH1750_LIGHT_KNOB, 500);
    simulation.setKnob(part('tmp102-temperature').id, TMP102_TEMPERATURE_KNOB, 30);
    simulation.setKnob(part('sht31-temp-humidity').id, SHT31_TEMPERATURE_KNOB, 30);
    simulation.setKnob(part('sht31-temp-humidity').id, SHT31_HUMIDITY_KNOB, 60);

    // The serial buffer is a rolling window of 400 chunks. Once it is full its
    // joined length stops growing, so a character offset taken before the
    // ticks slices to the empty string. Read the window itself and compare it
    // with what it held before the knobs turned.
    const before = log();
    for (let i = 0; i < 60; i++) simulation.tick(0.05);
    const tail = log();
    expect(before).not.toContain('light 500 lx');
    expect(tail).toContain('light 500 lx');
    expect(tail).toContain('tmp102 30.00 C');
    expect(tail).toContain('sht31 30.00 C');
    expect(tail).toContain('humidity 60.0 %');
    expect(tail).toContain('crc ok');
  }, 60_000);

  it('answers a card on the SPI bus, and times out without one', () => {
    const build = galleryById('rfid')!.builds[0]!;
    const simulation = benchFor(build);
    simulation.execution = 'interpreter';
    simulation.loadFirmware(firmwareForBuild(build, 'arduino-cpp'));
    expect(simulation.firmwareError).toBeNull();
    simulation.start();

    for (let i = 0; i < 30; i++) simulation.tick(0.05);
    const log = (): string => simulation.serialLines().join('');

    // The version register is a read transaction: address out, byte back.
    expect(log()).toContain('version 92');
    expect(log()).toContain('no card');

    const reader = simulation.bench.parts.find(
      (part) => part.definition.component.kind === 'rc522',
    )!;
    simulation.setKnob(reader.id, MFRC522_CARD_KNOB, 1);
    for (let i = 0; i < 30; i++) simulation.tick(0.05);
    expect(log(), 'the card\u2019s ATQA').toContain('card 4 0');

    simulation.setKnob(reader.id, MFRC522_CARD_KNOB, 0);
    const before = log().length;
    for (let i = 0; i < 30; i++) simulation.tick(0.05);
    expect(log().slice(before), 'the field is empty again').toContain('no card');
  }, 60_000);

  it('counts the seconds on the four-digit display', () => {
    const build = galleryById('tm1637')!.builds[0]!;
    const simulation = benchFor(build);
    simulation.execution = 'interpreter';
    simulation.loadFirmware(firmwareForBuild(build, 'arduino-cpp'));
    expect(simulation.firmwareError).toBeNull();
    simulation.start();

    const module = simulation.bench.parts.find(
      (part) => part.definition.component.kind === 'tm1637',
    )!;
    for (let i = 0; i < 40; i++) simulation.tick(0.05);

    const display = simulation.displayControllers().get(module.id);
    expect(display).toBeInstanceOf(Tm1637);
    const glass = display as Tm1637;
    expect(glass.lit, 'the glass is lit').toBe(true);

    // The glass and the log have to agree: the last digit is the second the
    // sketch reported.
    const log = simulation.serialLines().join('');
    const reported = /t\+(\d+)/.exec(log);
    expect(reported, 'the sketch reported a time').not.toBeNull();
    const seconds = Number(reported![1]);
    expect(glass.digits[3], 'the last digit').toBe(SEGMENT_MAP[String(seconds % 10)]);
  }, 60_000);

  it('turns the motor one step per pulse', () => {
    const build = galleryById('a4988')!.builds[0]!;
    const simulation = benchFor(build);
    simulation.execution = 'interpreter';
    simulation.loadFirmware(firmwareForBuild(build, 'arduino-cpp'));
    expect(simulation.firmwareError).toBeNull();
    simulation.start();

    const motor = simulation.bench.parts.find(
      (part) => part.definition.component.kind === 'stepper',
    )!;
    let peak = 0;
    for (let i = 0; i < 60; i++) {
      simulation.tick(0.05);
      peak = Math.max(peak, simulation.engine.stepperAngle(motor.id));
    }
    expect(peak, 'the motor moved').toBeGreaterThan(0);

    // The shaft stands where the steps the sketch counted have taken it.
    // The sketch ramps 1..20 and back down, so the report that describes where
    // the shaft ended up is the last one, not the first.
    const log = simulation.serialLines().join('');
    const reported = [...log.matchAll(/step (-?\d+)/g)].at(-1);
    expect(reported, 'the sketch reported a step').toBeDefined();
    const expected = Number(reported![1]) * 7.5;
    expect(
      Math.abs(simulation.engine.stepperAngle(motor.id) - expected),
      'the shaft agrees with the count',
    ).toBeLessThan(15);
  }, 60_000);

  it('runs the motor on the supply, not on the board', () => {
    const build = galleryById('a4988')!.builds[0]!;
    const simulation = benchFor(build);
    simulation.execution = 'interpreter';
    simulation.loadFirmware(firmwareForBuild(build, 'arduino-cpp'));
    expect(simulation.firmwareError).toBeNull();
    simulation.start();

    const motor = simulation.bench.parts.find(
      (part) => part.definition.component.kind === 'stepper',
    )!;
    const supply = simulation.bench.parts.find(
      (part) => part.definition.component.kind === 'power-supply',
    )!;
    const voltsOn = (pin: string): number => {
      const net = simulation.engine.currentNetlist.pinNode.get(`${motor.id}:${pin}`);
      return net === undefined ? 0 : simulation.engine.voltageOfNet(net);
    };
    // The windings are driven one way at a time, so this is a peak.
    let peak = 0;
    for (let i = 0; i < 30; i++) {
      simulation.tick(0.05);
      peak = Math.max(peak, Math.abs(voltsOn('A+') - voltsOn('A-')));
    }
    const volts = simulation.controls.knob(supply.id, SUPPLY_VOLTAGE_KNOB);
    expect(Math.abs(peak - volts), 'the windings see the supply').toBeLessThan(0.5);
  }, 60_000);

  it('turns one full step in sixteen microsteps', () => {
    const build = galleryById('microstep')!.builds[0]!;
    const simulation = benchFor(build);
    simulation.execution = 'interpreter';
    simulation.loadFirmware(firmwareForBuild(build, 'arduino-cpp'));
    expect(simulation.firmwareError).toBeNull();
    simulation.start();

    const motor = simulation.bench.parts.find(
      (part) => part.definition.component.kind === 'stepper',
    )!;
    const supply = simulation.bench.parts.find(
      (part) => part.definition.component.kind === 'power-supply',
    )!;
    const voltsOn = (pin: string): number => {
      const net = simulation.engine.currentNetlist.pinNode.get(`${motor.id}:${pin}`);
      return net === undefined ? 0 : simulation.engine.voltageOfNet(net);
    };
    const volts = simulation.controls.knob(supply.id, SUPPLY_VOLTAGE_KNOB);

    let peak = 0;
    let fractional = false;
    // The sketch logs after the forward sixteen and again after the return.
    // Stop on the second log so the shaft is still at home; the loop's
    // half-second pause keeps the next cycle out of the sample.
    for (let frame = 0; frame < 200; frame++) {
      simulation.tick(0.05);
      peak = Math.max(peak, simulation.engine.stepperAngle(motor.id));
      const across = Math.abs(voltsOn('A+') - voltsOn('A-'));
      if (across > volts * 0.1 && across < volts * 0.9) fractional = true;
      const seen = simulation.serialLines().join('');
      if (seen.includes('microstep 16') && seen.includes('microstep 0')) break;
    }

    const log = simulation.serialLines().join('');
    expect(log).toContain('microstep 16');
    expect(log).toContain('microstep 0');
    expect(peak, 'sixteen pulses are one full step').toBeGreaterThan(7.5 - 0.6);
    expect(peak, 'sixteen pulses are one full step').toBeLessThan(7.5 + 0.6);
    expect(simulation.engine.stepperAngle(motor.id), 'the shaft returned').toBeCloseTo(0, 1);
    expect(fractional, 'the winding sees an average, not a rail').toBe(true);
  }, 60_000);

  it('keeps the count in the memory', () => {
    const build = galleryById('eeprom24lc256')!.builds[0]!;
    const simulation = benchFor(build);
    simulation.execution = 'interpreter';
    simulation.loadFirmware(firmwareForBuild(build, 'arduino-cpp'));
    expect(simulation.firmwareError).toBeNull();
    simulation.start();

    for (let i = 0; i < 60; i++) simulation.tick(0.05);

    // The count climbs by one every time, which is the proof that the
    // memory kept it: a chip that forgot would start the count again.
    const log = simulation.serialLines().join('');
    const counts = [...log.matchAll(/count (\d+)/g)].map((match) => Number(match[1]));
    expect(counts.length, 'the sketch reported a count').toBeGreaterThan(1);
    for (let index = 1; index < counts.length; index++) {
      expect(counts[index], 'the count climbs by one').toBe(counts[index - 1]! + 1);
    }
  }, 60_000);

  it('shows the count in binary on eight lights', () => {
    const build = galleryById('pcf8574')!.builds[0]!;
    const simulation = benchFor(build);
    simulation.execution = 'interpreter';
    simulation.loadFirmware(firmwareForBuild(build, 'arduino-cpp'));
    expect(simulation.firmwareError).toBeNull();
    simulation.start();

    const leds = simulation.bench.parts.filter((part) => part.definition.id === 'led-red');
    expect(leds.length).toBe(8);
    for (let i = 0; i < 60; i++) simulation.tick(0.05);

    // The lights are the byte the sketch wrote, one bit each.
    const log = simulation.serialLines().join('');
    const reported = /count (\d+)/.exec(log);
    expect(reported, 'the sketch reported a count').not.toBeNull();
    const value = Number(reported![1]);
    for (const [bit, led] of leds.entries()) {
      const net = simulation.engine.currentNetlist.pinNode.get(`${led.id}:A`);
      const volts = net === undefined ? 0 : simulation.engine.voltageOfNet(net);
      expect(volts > 1, `light ${bit} matches bit ${bit} of ${value}`).toBe(
        ((value >> bit) & 1) === 1,
      );
    }
  }, 60_000);

  it('shows a sixteen-bit count on sixteen lights', () => {
    const build = galleryById('mcp23017')!.builds[0]!;
    const simulation = benchFor(build);
    simulation.execution = 'interpreter';
    simulation.loadFirmware(firmwareForBuild(build, 'arduino-cpp'));
    expect(simulation.firmwareError).toBeNull();
    simulation.start();

    const leds = simulation.bench.parts.filter((part) => part.definition.id === 'led-red');
    expect(leds.length).toBe(16);
    for (let i = 0; i < 60; i++) simulation.tick(0.05);

    // The last number the sketch printed is the one the two latches hold.
    const log = simulation.serialLines().join('');
    const counts = [...log.matchAll(/count (\d+)/g)].map((match) => Number(match[1]));
    expect(counts.length, 'the sketch reported a count').toBeGreaterThan(1);
    const value = counts[counts.length - 1]!;
    for (const [bit, led] of leds.entries()) {
      const net = simulation.engine.currentNetlist.pinNode.get(`${led.id}:anode`);
      const volts = net === undefined ? 0 : simulation.engine.voltageOfNet(net);
      expect(volts > 1, `light ${bit} matches bit ${bit} of ${value}`).toBe(
        ((value >> bit) & 1) === 1,
      );
    }
  }, 60_000);

  it('wakes on INTA when a button on an expander port moves', () => {
    const build = galleryById('expander-interrupt')!.builds[0]!;
    const simulation = benchFor(build);
    simulation.execution = 'interpreter';
    simulation.loadFirmware(firmwareForBuild(build, 'arduino-cpp'));
    expect(simulation.firmwareError).toBeNull();
    simulation.start();

    const button = simulation.bench.parts.find((part) => part.definition.id === 'button-tactile')!;
    const led = simulation.bench.parts.find((part) => part.definition.id === 'led-red')!;
    const lit = (): boolean => {
      const net = simulation.engine.currentNetlist.pinNode.get(`${led.id}:anode`);
      return (net === undefined ? 0 : simulation.engine.voltageOfNet(net)) > 1;
    };

    for (let frame = 0; frame < 20; frame++) simulation.tick(0.05);
    const setupLog = simulation.serialLines().join('');
    expect(setupLog, 'the sketch says what it is watching').toContain('watching PA0');
    // The pull-up coming up is an edge on the port, and the sketch clears it
    // before it starts watching: a bench that reported it would be reporting
    // its own setup as a press.
    expect(setupLog, 'setup is not a press').not.toContain('pressed');
    expect(lit(), 'the light starts dark').toBe(false);

    simulation.setPressed(button.id, true);
    for (let frame = 0; frame < 40; frame++) simulation.tick(0.05);
    const pressedLog = simulation.serialLines().join('');
    expect(pressedLog, 'the press came in through INTA').toContain('pressed');
    expect(lit(), 'the press lit the light').toBe(true);

    simulation.setPressed(button.id, false);
    for (let frame = 0; frame < 40; frame++) simulation.tick(0.05);
    expect(simulation.serialLines().join(''), 'the release came in the same way').toContain(
      'released',
    );
    expect(lit(), 'the release put the light out').toBe(false);
  }, 60_000);

  it('dims sixteen lights in sixteenths of a PWM frame', () => {
    const build = galleryById('pca9685')!.builds[0]!;
    const simulation = benchFor(build);
    simulation.execution = 'interpreter';
    simulation.loadFirmware(firmwareForBuild(build, 'arduino-cpp'));
    expect(simulation.firmwareError).toBeNull();
    simulation.start();

    const leds = simulation.bench.parts.filter((part) => part.definition.id === 'led-red');
    expect(leds.length).toBe(16);
    for (let frame = 0; frame < 20; frame++) simulation.tick(0.05);
    expect(simulation.serialLines().join('')).toContain('sixteen levels');

    // A whole 50 Hz frame is about 20 ms. Sampling it at 0.25 ms gives each
    // sixteenth five high samples, and the full-on channel every sample.
    const samples = 80;
    const highs = new Array<number>(16).fill(0);
    for (let sample = 0; sample < samples; sample++) {
      simulation.tick(0.00025);
      for (const [channel, led] of leds.entries()) {
        const net = simulation.engine.currentNetlist.pinNode.get(`${led.id}:anode`);
        const volts = net === undefined ? 0 : simulation.engine.voltageOfNet(net);
        if (volts > 1) highs[channel] += 1;
      }
    }

    for (let channel = 0; channel < 16; channel++) {
      const expected = ((channel + 1) / 16) * samples;
      expect(
        Math.abs(highs[channel]! - expected),
        `light ${channel} was high for ${highs[channel]} of ${samples} samples`,
      ).toBeLessThanOrEqual(2);
    }
  }, 60_000);

  it('sets a clock that lost power, then keeps time', () => {
    const build = galleryById('ds3231')!.builds[0]!;
    const simulation = benchFor(build);
    simulation.execution = 'interpreter';
    simulation.loadFirmware(firmwareForBuild(build, 'arduino-cpp'));
    expect(simulation.firmwareError).toBeNull();
    simulation.start();

    const clock = simulation.bench.parts.find(
      (part) =>
        part.definition.component.kind === 'i2c-sensor' &&
        part.definition.component.device === 'ds3231',
    )!;
    const led = simulation.bench.parts.find((part) => part.definition.id === 'led-red')!;
    const litStates = new Set<boolean>();
    for (let i = 0; i < 60; i++) {
      simulation.tick(0.05);
      const net = simulation.engine.currentNetlist.pinNode.get(`${led.id}:anode`);
      litStates.add((net === undefined ? 0 : simulation.engine.voltageOfNet(net)) > 1);
    }

    // The flag is cleared by setting the time, and the sketch reports both.
    const log = simulation.serialLines().join('');
    expect(log).toContain('lost power');
    expect(log).toContain('clock set');
    expect(log).toContain('time 20261024 9:30:0');

    // The thermometer answers on the same bus, in quarter-degree steps.
    const reported = /celsius ([\d.-]+)/.exec(log);
    expect(reported, 'the sketch reported a reading').not.toBeNull();
    const die = simulation.controls.knob(clock.id, DS3231_TEMPERATURE_KNOB);
    expect(Math.abs(Number(reported![1]) - die), 'the reading is the die temperature').toBeLessThan(
      0.25,
    );

    // The seconds register drives the light, so both halves of a second appear.
    expect(litStates.size, 'the light toggles with the seconds').toBe(2);
  }, 60_000);

  it('reads the probe temperature over the bus', () => {
    const build = galleryById('max6675')!.builds[0]!;
    const simulation = benchFor(build);
    simulation.execution = 'interpreter';
    simulation.loadFirmware(firmwareForBuild(build, 'arduino-cpp'));
    expect(simulation.firmwareError).toBeNull();
    simulation.start();

    const module = simulation.bench.parts.find(
      (part) => part.definition.component.kind === 'thermocouple',
    )!;
    for (let i = 0; i < 30; i++) simulation.tick(0.05);

    // The reading comes back over the bus, in quarter-degree steps.
    const log = simulation.serialLines().join('');
    const reported = /celsius ([\d.]+)/.exec(log);
    expect(reported, 'the sketch reported a reading').not.toBeNull();
    const probe = simulation.controls.knob(module.id, MAX6675_TEMPERATURE_KNOB);
    expect(Math.abs(Number(reported![1]) - probe), 'the reading is the probe\u2019s').toBeLessThan(
      0.25,
    );
  }, 60_000);

  it('makes a voltage the board can read back', () => {
    const build = galleryById('mcp4725')!.builds[0]!;
    const simulation = benchFor(build);
    simulation.execution = 'interpreter';
    simulation.loadFirmware(firmwareForBuild(build, 'arduino-cpp'));
    expect(simulation.firmwareError).toBeNull();
    simulation.start();

    const converter = simulation.bench.parts.find(
      (part) => part.definition.component.kind === 'dac',
    )!;
    const net = simulation.engine.currentNetlist.pinNode.get(`${converter.id}:AOUT`);
    const output = (): number => (net === undefined ? 0 : simulation.engine.voltageOfNet(net));
    const first = output();
    for (let i = 0; i < 60; i++) simulation.tick(0.05);

    // The sketch walks the output up a ramp, so it has to have moved.
    expect(Math.abs(output() - first), 'the output moved').toBeGreaterThan(0.2);

    // And the board has to have read the voltage the code asks for.
    const log = simulation.serialLines().join('');
    const matches = [...log.matchAll(/code (\d+) reads (\d+)/g)];
    expect(matches.length, 'the sketch reported a reading').toBeGreaterThan(0);
    const last = matches[matches.length - 1]!;
    const code = Number(last[1]);
    const counts = Number(last[2]);
    expect(Math.abs(counts - (code / 4095) * 1023), 'the board read the voltage').toBeLessThan(24);
  }, 60_000);

  it('moves the alarm-clock digits over time and on button taps', () => {
    for (const execution of ['interpreter', 'avr'] as const) {
      const build = galleryById('alarm-clock')!.builds[0];
      if (execution === 'avr' && !hexAvailable()) {
        console.warn('SKIP avr parity: no HEX');
        continue;
      }
      const simulation = benchFor(build);
      simulation.execution = execution;
      simulation.loadFirmware(firmwareForBuild(build, 'arduino-cpp'));
      expect(simulation.firmwareError, 'alarm-clock firmware').toBeNull();
      simulation.start();
      const glass = (): string => {
        const seg = simulation.bench.parts.find((p) => p.definition.id === '7segment-4digit')!;
        const ctrl = simulation.displayControllers().get(seg.id) as unknown as SevenSegment;
        return ctrl.getText();
      };
      for (let frame = 0; frame < 30; frame++) simulation.tick(0.05);
      expect(glass(), 'idle shows 15:00').toBe('1500');
      // A minute of RTC time must move the minute digits.
      simulation.engine.timeMs += 61000;
      for (let frame = 0; frame < 12; frame++) simulation.tick(0.05);
      expect(glass(), 'a minute later shows 15:01').toBe('1501');
      // An Hour tap retunes the shown time through the persisted offset. The
      // hold may additionally trip one auto-repeat tick, so either +1 or +2.
      const hours = simulation.bench.parts.filter(
        (p) => p.definition.name === 'Tactile Button',
      )[0]!;
      simulation.setPressed(hours.id, true);
      for (let frame = 0; frame < 12; frame++) simulation.tick(0.05);
      simulation.setPressed(hours.id, false);
      for (let frame = 0; frame < 22; frame++) simulation.tick(0.05);
      expect(glass(), 'hour tap moves the hour digits').toMatch(/^1[67]01$/);
    }
  }, 60_000);

  /*
   * Live AVR legs for the alarm library build (Task 2's AVR-only entry:
   * verbatim urish sources with SevSeg/RTClib, flashed from the committed
   * library HEX). Same simulation shape and helpers as the raw legs above —
   * execution `avr`, so the committed HEX owns the stepping — gated on the
   * HEX with the file's skip pattern.
   *
   * Two adaptations the bench forces, both verified by execution (see the
   * Task 8 report): the interpreter now parses the same sources (Task 5
   * retired the AVR-only contract), so firmwareError is null while the HEX
   * runs underneath — a fault would overwrite it with its own message, so
   * null standing also proves no fault; and the SevSeg multiplex cycles
   * segments rather than digits, so decoded digits are accumulated over full
   * multiplex frames instead of read off the edge-latched glass. The colon,
   * DP, buzzer, and worker legs are verbatim: those pins are driven
   * directly, not multiplexed.
   */
  it('runs the alarm library build live (AVR)', () => {
    const libHex = join(__dirname, '..', 'simulation', 'avr', 'hex', 'alarm-clock-lib-uno.hex');
    if (!hexAvailable() || !existsSync(libHex)) {
      console.warn('SKIP library build live: no HEX');
      return;
    }
    const build = buildFor(galleryById('alarm-clock')!, 'uno', 'library')!;
    const board = boardOption('uno').make();
    const simulation = new Simulation(board);
    simulation.execution = 'avr';
    simulation.loadCircuit(build.circuit);
    simulation.loadFirmware(firmwareForBuild(build, 'arduino-cpp'));
    // Execution `avr`: the committed HEX runs underneath while the
    // interpreter parses the same sources alongside. A fault would overwrite
    // this with its own message, so null standing also proves no fault.
    expect(simulation.firmwareError, 'library build runs the HEX without fault').toBeNull();
    simulation.start();
    const glassProbe = liveProbe(simulation);
    for (let frame = 0; frame < 30; frame++) simulation.tick(0.05);
    const afternoon = convergeGlass(glassProbe, 70);
    expect(afternoon.converged, 'library build multiplex settles at 15:00').toBe(true);
    expect(afternoon.glyphs, 'library build idles at 15:00').toEqual([
      ONE_GLYPH,
      FIVE_GLYPH,
      ZERO_GLYPH,
      ZERO_GLYPH,
    ]);
    simulation.engine.timeMs += 61000;
    // The AVR core needs ~2 s of simulated time to read the jumped RTC and
    // refresh the SevSeg buffer plus the persistence window: 12 frames left
    // the glass on the pre-jump view, whose union ("1500") is a superset of
    // "1501" and can never converge to the new digit.
    for (let frame = 0; frame < 45; frame++) simulation.tick(0.05);
    const minute = convergeGlass(glassProbe, 70);
    expect(minute.converged, 'library build multiplex settles a minute later').toBe(true);
    expect(minute.glyphs, 'library build shows 15:01 a minute later').toEqual([
      ONE_GLYPH,
      FIVE_GLYPH,
      ZERO_GLYPH,
      ONE_GLYPH,
    ]);
    // Colon blinks: drive the RTC to a known even second, await the lit
    // colon, then step a second forward and await it dark (all bounded).
    // Fixed scripts sit inside one parity whenever firmware loop phase
    // misaligns with sample instants, so this asserts tracking instead of
    // luck: only a truly stuck colon exhausts the caps.
    const segPart = simulation.bench.parts.find((p) => p.definition.id === '7segment-4digit')!;
    const colonSamples: boolean[] = [];
    const sampleColonAt = (): void => {
      const probe = {
        values: [] as number[],
        digits: 0,
        colon: false,
        colonValue: false,
      } as unknown as HTMLElement;
      pushWokwiState(probe, segPart.definition, segPart, {
        pinVolts: simulation.pinVoltages(),
        displays: simulation.displayControllers(),
      } as unknown as FootprintState);
      colonSamples.push((probe as unknown as { colonValue: boolean }).colonValue);
    };
    const awaitColon = (want: boolean, frames: number): boolean => {
      for (let frame = 0; frame < frames; frame++) {
        simulation.tick(0.05);
        sampleColonAt();
        if (colonSamples[colonSamples.length - 1] === want) return true;
      }
      return false;
    };
    simulation.engine.timeMs += ((2000 - (simulation.engine.timeMs % 2000)) % 2000) + 300;
    expect(awaitColon(true, 60), 'colon lights on an even second').toBe(true);
    simulation.engine.timeMs += 1000;
    expect(awaitColon(false, 60), 'colon darkens on an odd second').toBe(true);
    expect(new Set(colonSamples), 'library colon blinks').toEqual(new Set([false, true]));
    // DP slice stays dark: SevSeg begun with 7 segment pins.
    const element = {
      values: [] as number[],
      digits: 0,
      colon: false,
      colonValue: false,
    } as unknown as HTMLElement;
    pushWokwiState(element, segPart.definition, segPart, {
      pinVolts: simulation.pinVoltages(),
      displays: simulation.displayControllers(),
    } as unknown as FootprintState);
    const values = (element as unknown as { values: number[] }).values;
    expect(values).toHaveLength(32);
    for (let d = 0; d < 4; d++) expect(values.slice(d * 8 + 7, d * 8 + 8)).toEqual([0]);
  }, 180_000);

  /*
   * Status view + NVRAM + buzzer for the library build: a short Alarm press
   * arms the clock (toggleAlarm saves over real I2C writes), the glass
   * switches to the setChars status view, an MCU reset proves the NVRAM
   * round-trip (the clock comes back armed), and with the alarm due the
   * siren drives A3 — liveness across samples, never exact timing.
   *
   * Two bench facts shape the choreography. First, setPressed rebuilds the
   * bench and recreates the RTC model, wiping its RAM — so the button stays
   * held from the arming press until the rebooted clock has been read back;
   * only then is it released. Second, with the button held through the
   * reset, the rebooted clock toggles straight back off (the held edge
   * reads as a fresh press), landing in the status view: " off" proves the
   * save survived, while a wiped NVRAM would boot disarmed and show " on".
   */
  it('runs the alarm library build live status, NVRAM, and buzzer (AVR)', () => {
    const libHex = join(__dirname, '..', 'simulation', 'avr', 'hex', 'alarm-clock-lib-uno.hex');
    if (!hexAvailable() || !existsSync(libHex)) {
      console.warn('SKIP library build live: no HEX');
      return;
    }
    const build = buildFor(galleryById('alarm-clock')!, 'uno', 'library')!;
    const board = boardOption('uno').make();
    const simulation = new Simulation(board);
    simulation.execution = 'avr';
    simulation.loadCircuit(build.circuit);
    simulation.loadFirmware(firmwareForBuild(build, 'arduino-cpp'));
    expect(simulation.firmwareError, 'library build runs the HEX without fault').toBeNull();
    simulation.start();
    const glassProbe = liveProbe(simulation);
    const alarmButton = simulation.bench.parts.filter(
      (p) => p.definition.name === 'Tactile Button',
    )[2]!;
    // Fresh NVRAM starts disarmed (zeroed model NVRAM ⇒ DISABLED per
    // Clock::begin): the buzzer rests LOW before anything is armed.
    for (let frame = 0; frame < 8; frame++) simulation.tick(0.05);
    expect(
      simulation.engine.readDigital(17),
      'library build buzzer silent while armed but not due',
    ).toBe(false);
    // Disarming press: the pre-armed clock toggles off, saving NVRAM over
    // glass switches to the setChars status view — the SevSeg API the
    // fixture never covers. ALARM_STATUS_DISPLAY_TIME is 1000 ms firmware,
    // which runs ahead of simulated time, so the stable window is ~200-600 ms
    // after the press: 200 ms of pre-wait covers the 100 ms debounce plus the
    // persistence window, and the 400 ms converge ends at ~600 ms, before the
    // lapse. ' ' stays blank, 'o' renders as 'O' (same segments as '0'), 'F'
    // lights A/F/G/E. Blank digits decay to blank, so only the driven digits
    // are asserted. The button stays held past the reset.
    simulation.setPressed(alarmButton.id, true);
    for (let frame = 0; frame < 20; frame++) simulation.tick(0.01);
    const status = convergeGlass(glassProbe, 40);
    expect(status.converged, 'library build status view settles').toBe(true);
    expect(status.glyphs[1], 'library build status shows O').toEqual(ZERO_GLYPH);
    expect(status.glyphs[2], 'library build status shows F').toEqual(F_GLYPH);
    expect(simulation.firmwareError, 'library build still runs after the tap').toBeNull();
    // Tap again to re-arm: the reset below boots armed only if the saved
    // state is armed, which is what gives the read-back proof its power (a
    // wiped NVRAM would boot disarmed either way).
    simulation.setPressed(alarmButton.id, false);
    for (let frame = 0; frame < 8; frame++) simulation.tick(0.05);
    simulation.setPressed(alarmButton.id, true);
    for (let frame = 0; frame < 20; frame++) simulation.tick(0.01);
    const rearmedStatus = convergeGlass(glassProbe, 40);
    expect(rearmedStatus.converged, 'library build re-arm status settles').toBe(true);
    expect(rearmedStatus.glyphs[1], 'library build re-arm shows O').toEqual(ZERO_GLYPH);
    expect(rearmedStatus.glyphs[2], 'library build re-arm shows n').toEqual(N_GLYPH);
    // NVRAM round-trip: reset the MCU core — setup() reruns and Clock::begin()
    // rereads the DS1307's RAM, which the reset preserves (only a rebuild
    // recreates the model). The held edge toggles the rebooted clock straight
    // back off, so " off" (blank, 'O', 'F', 'F') proves the save survived —
    // a wiped NVRAM would boot disarmed and show " on".
    const core = (simulation as unknown as { avrBackend: { reset(): void } | null }).avrBackend;
    expect(core, 'library build AVR core flashed').not.toBeNull();
    core!.reset();
    for (let frame = 0; frame < 8; frame++) simulation.tick(0.05);
    const rearmed = convergeGlass(glassProbe, 60);
    expect(rearmed.converged, 'library build second status view settles').toBe(true);
    expect(rearmed.glyphs[1], 'library build NVRAM persists the arm (O)').toEqual(ZERO_GLYPH);
    expect(rearmed.glyphs[2], 'library build NVRAM persists the arm (F)').toEqual(F_GLYPH);
    expect(rearmed.glyphs[3], 'library build NVRAM persists the arm (F)').toEqual(F_GLYPH);
    expect(simulation.firmwareError, 'library build still runs after reset').toBeNull();
    // Release only now that the read-back is proven. Releasing rebuilds the
    // bench and recreates the RTC model — but the declarative seed re-arms
    // 15:10 on every rebuild, so the clock stays armed; the manual staging
    // below keeps the siren leg independent of that either way. The
    // firmware's own saves already went out over real I2C (asserted on the
    // bus log below), and the reboot read-back above proved the model side.
    // For the siren leg, stage an armed save directly (the same two bytes
    // toggleAlarm emits) and reset: the rebooted clock boots armed with no
    // button choreography in the way, sees the due alarm, and rings.
    simulation.setPressed(alarmButton.id, false);
    for (let frame = 0; frame < 8; frame++) simulation.tick(0.05);
    const saves = simulation
      .busLines()
      .filter((entry) => entry.bus === 'i2c' && entry.address === 0x68)
      .map((entry) => [...entry.bytes]);
    expect(saves, 'library build saves the disarm over I2C').toContainEqual([8, 0]);
    expect(saves, 'library build saves the re-arm over I2C').toContainEqual([8, 1]);
    expect(simulation.engine.writeI2C(0x68, 0x08, true), 'library build NVRAM staged').toBe(true);
    expect(simulation.engine.writeI2C(0x68, 0x01, false), 'library build NVRAM staged').toBe(true);
    core!.reset();
    for (let frame = 0; frame < 10; frame++) simulation.tick(0.05);
    // Jump RELATIVE, not absolute: the sketch owns the clock, so setTime
    // advances the decoded registers by the host delta — an absolute
    // assignment would add ~15 h on top of the 15:00 base and leave the
    // alarm minute behind. Base seconds stay single-digit here, so +611 s
    // lands inside 15:10.
    simulation.engine.timeMs += 611000;
    for (let frame = 0; frame < 10; frame++) simulation.tick(0.05);
    // Live buzzer: the staged save arms 15:10 — jump the RTC just past it
    // so the rebooted clock walks straight into the alarm state and the
    // siren drives A3: liveness across samples, never exact timing.
    // Jump RELATIVE, not absolute: the sketch owns the clock, so setTime
    // advances the decoded registers by the host delta — an absolute
    // assignment would add ~15 h on top of the 15:00 base and leave the
    // alarm minute behind. Base seconds stay single-digit here, so +611 s
    // lands inside 15:10.
    simulation.engine.timeMs += 611000;
    let buzzerSeenHigh = false;
    for (let frame = 0; frame < 25; frame++) {
      simulation.tick(0.05);
      if (simulation.engine.readDigital(17)) buzzerSeenHigh = true;
    }
    expect(buzzerSeenHigh, 'library build buzzer rings while the alarm is due').toBe(true);
    expect(simulation.firmwareError, 'library build still runs while ringing').toBeNull();
  }, 180_000);

  /*
   * Worker-compile leg for the library build: the committed HEX proves the
   * recorded sources built once, but only a live worker compile proves the
   * gallery sources plus their declared libraries still compile now. Mirrors
   * the Tier-2 fixture shape (toolchain + Tier-2 gates, 1_500_000 budget):
   * compileAndRun → compileState 'ready', firmwareError null, then ticks
   * without fault.
   */
  it('runs the alarm library build live worker compile (AVR Tier-2)', async () => {
    let pkg: string | null = null;
    try {
      pkg = createRequire(import.meta.url).resolve('@horang-corp/avr-gcc-wasm/package.json');
    } catch {
      /* fall through to skip */
    }
    if (!pkg) {
      console.warn('SKIP library build worker compile: toolchain absent');
      return;
    }
    if (!(await tier2Reachable())) {
      console.warn('SKIP library build worker compile: Tier-2 fetch unreachable');
      return;
    }
    const libBuild = buildFor(galleryById('alarm-clock')!, 'uno', 'library')!;
    const simulation = benchFor(libBuild);
    simulation.execution = 'avr';
    await simulation.compileAndRun(firmwareForBuild(libBuild, 'arduino-cpp'));
    expect(simulation.compileState, 'library build compiles').toBe('ready');
    expect(simulation.firmwareError, 'library build firmware').toBeNull();
    simulation.start();
    for (let frame = 0; frame < 12; frame++) simulation.tick(0.05);
    expect(simulation.firmwareError, 'library build runs without fault').toBeNull();
    // Budget: a cold Tier-2 build compiles the firmware TU plus the SevSeg
    // and RTClib TUs through the wasm toolchain (measured in minutes, not
    // seconds); the browser reuses its versioned cache across sessions, Node
    // rebuilds every run.
  }, 1_500_000);
});

describe('avr wasm opt-in', () => {
  it('opts in library (avr) builds only', () => {
    const project = galleryById('alarm-clock')!;
    const library = buildFor(project, 'uno', 'library')!;
    const raw = buildFor(project, 'uno')!;
    const optsIn = (execution: string | undefined): boolean => execution === 'avr';
    expect(optsIn(library.execution)).toBe(true);
    expect(optsIn(raw.execution)).toBe(false);
    expect(optsIn(undefined)).toBe(false);
  });
});

describe('part names', () => {
  it('seeds the alarm buttons Hours/Minutes/Alarm and renames round-trip', () => {
    const alarm = galleryById('alarm-clock')!;
    const sim = benchFor(alarm.builds[0]!);
    const buttons = sim.bench.parts.filter((p) => p.definition.id === 'button-tactile');
    expect(buttons).toHaveLength(3);
    expect(buttons.map((b) => sim.partName(b.id)).sort()).toEqual(['Alarm', 'Hours', 'Minutes']);
    const byName = new Map(buttons.map((b) => [sim.partName(b.id), b]));
    expect(byName.get('Alarm')!.capColour).toBe('#ef4444');
    expect(byName.get('Hours')!.capColour).toBe('#22c55e');
    expect(byName.get('Minutes')!.capColour).toBe('#22c55e');
    const first = buttons[0]!;
    sim.renamePart(first.id, '  Snooze  ');
    expect(sim.partName(first.id)).toBe('Snooze');
    sim.renamePart(first.id, '   ');
    expect(sim.partName(first.id)).toBeNull();
  });
});

describe('alarm RTC preset', () => {
  it('seeds 15:00 with the alarm armed for 15:10', () => {
    const sim = benchFor(galleryById('alarm-clock')!.builds[0]!);
    const rtcId = sim.bench.parts.find((p) => p.definition.id === 'ds1307-rtc')!.id;
    const device = sim.engine.i2cDevice(rtcId) as unknown as {
      receive(byte: number, isControl: boolean): boolean;
      read(count: number): readonly number[];
    };
    device.receive(0x00, true);
    expect([...device.read(3)]).toEqual([0x00, 0x00, 0x15]);
    device.receive(0x08, true);
    expect([...device.read(3)]).toEqual([1, 15, 10]);
  });
});

describe('alarm wiring paths', () => {
  it('routes no jumper through a part it does not terminate on', async () => {
    const { routeWireViaCorners } = await import('@/features/bench/wiring/wire-route');
    const sim = benchFor(galleryById('alarm-clock')!.builds[0]!);
    type Box = { x0: number; y0: number; x1: number; y1: number; id: string };
    const boxes: Box[] = sim.bench.parts.map((p) => {
      const def = p.definition as unknown as { widthMm: number; heightMm: number };
      return { x0: p.x, y0: p.y, x1: p.x + def.widthMm, y1: p.y + def.heightMm, id: p.id };
    });
    const terminals = sim.bench.terminals;
    const crosses = (ax: number, ay: number, bx: number, by: number, box: Box): boolean => {
      // Shrunk box: grazes along an edge do not count, crossings do.
      const x0 = box.x0 + 0.4;
      const y0 = box.y0 + 0.4;
      const x1 = box.x1 - 0.4;
      const y1 = box.y1 - 0.4;
      if (x0 >= x1 || y0 >= y1) return false;
      const inside = (x: number, y: number): boolean => x > x0 && x < x1 && y > y0 && y < y1;
      if (inside(ax, ay) || inside(bx, by)) return true;
      const orient = (
        px: number,
        py: number,
        qx: number,
        qy: number,
        rx: number,
        ry: number,
      ): number => Math.sign((qy - py) * (rx - qx) - (qx - px) * (ry - qy));
      const intersect = (cx: number, cy: number, dx: number, dy: number): boolean => {
        const o1 = orient(ax, ay, bx, by, cx, cy);
        const o2 = orient(ax, ay, bx, by, dx, dy);
        const o3 = orient(cx, cy, dx, dy, ax, ay);
        const o4 = orient(cx, cy, dx, dy, bx, by);
        return o1 !== o2 && o3 !== o4;
      };
      return (
        intersect(x0, y0, x1, y0) ||
        intersect(x1, y0, x1, y1) ||
        intersect(x1, y1, x0, y1) ||
        intersect(x0, y1, x0, y0)
      );
    };
    for (const wire of sim.bench.wires) {
      const a = terminals[wire.from]!;
      const b = terminals[wire.to]!;
      const corners = routeWireViaCorners(a, wire.bends, b);
      // A wire must touch its own endpoint parts: any part containing an
      // endpoint (with margin) is excluded for that wire.
      const owned = new Set(
        boxes
          .filter((box) => {
            const near = (x: number, y: number): boolean =>
              x > box.x0 - 1 && x < box.x1 + 1 && y > box.y0 - 1 && y < box.y1 + 1;
            return near(a.x, a.y) || near(b.x, b.y);
          })
          .map((box) => box.id),
      );
      for (let i = 0; i + 1 < corners.length; i++) {
        const p = corners[i]!;
        const q = corners[i + 1]!;
        for (const box of boxes) {
          if (owned.has(box.id)) continue;
          expect(
            crosses(p.x, p.y, q.x, q.y, box),
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            `wire ${wire.id} crosses ${sim.bench.parts.find((part) => part.id === box.id)!.definition.id}`,
          ).toBe(false);
        }
      }
    }
  });

  /*
   * The one build that reaches a real host, and the only one allowed to.
   *
   * Bridging is opt-in per build because a fetch leaves the machine: this leg is
   * what keeps that a deliberate decision rather than something a later build
   * picks up by accident.
   */
  describe('the live project', () => {
    it('is the only build that opted into the live network', () => {
      const live = GALLERY.filter((project) =>
        project.builds.some((build) => build.network === 'live'),
      );
      expect(live.map((project) => project.id)).toEqual(['live-weather']);
    });

    it('names a real host in its sketch, on a board its document carries', () => {
      const build = buildFor(galleryById('live-weather')!, 'esp32');
      expect(build).not.toBeNull();
      expect(build!.network).toBe('live');
      expect(build!.sketch).toContain('weather.noesis');
      expect(build!.circuit.parts.some((part) => part.type === 'esp32-devkit-v1')).toBe(true);
      // A document names one board, so the project is offered where it runs.
      expect(buildFor(galleryById('live-weather')!, 'uno')).toBeNull();
    });
  });
});
