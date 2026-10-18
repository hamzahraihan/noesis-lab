// Live Library Manager proof: install a small real index library through the
// production path and call it on the AVR core.
//
// Gated: needs the toolchain package plus live network for the Arduino index,
// the library archive, and the toolchain CDN. Without any of them the test
// SKIPs with a reason (same gated pattern as the toolchain live tests) — it
// never fails offline. With network it must RAN, not skip.
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { arduinoUnoR3 } from '@/features/parts/boards';
import { Simulation } from '@/features/bench/simulations/simulation';
import { toSingleFileProject, type FirmwareProject } from '../firmware/project';
import { fetchIndex } from './libraries/index';
import { selectIndexRelease } from './libraries/index-build';
import { MemoryBackend } from './toolchain/cache';
import { createProjectLibraryContext } from './toolchain/client';
import type { AvrBackend } from './core';

// One library call per loop (the Tier-2 fixture shape): the debouncer updates
// while the sketch itself blinks D13, so GPIO activity plus a fault-free core
// proves the installed library linked and runs.
const SKETCH = `#include <Arduino.h>
#include <Bounce2.h>
Bounce button;
void setup() {
  pinMode(13, OUTPUT);
  button.attach(2, INPUT_PULLUP);
}
void loop() {
  button.update();
  digitalWrite(13, ((millis() / 60) % 2) ? HIGH : LOW);
  delay(5);
}
`;

describe('library manager live proof', () => {
  it('installs a small real library and calls it on the core', async () => {
    let pkg: string | null = null;
    try {
      pkg = createRequire(import.meta.url).resolve('@horang-corp/avr-gcc-wasm/package.json');
    } catch {
      /* fall through to skip */
    }
    if (!pkg) {
      console.warn('SKIP: toolchain absent');
      return;
    }
    let rows;
    try {
      rows = await fetchIndex({ store: new MemoryBackend(), fetchFn: fetch });
    } catch (error) {
      console.warn(
        `SKIP: library index unreachable (${error instanceof Error ? error.message : String(error)})`,
      );
      return;
    }
    const found = rows.find((lib) => lib.name === 'Bounce2') ?? null;
    if (found === null) throw new Error('live proof needs Bounce2 in the Arduino index');
    const release = selectIndexRelease(found);
    if (release === null) throw new Error('live proof needs a Bounce2 release in the index');
    expect(found.providesIncludes).toContain('Bounce2.h');

    // Install through the production index hook: index fetch, SHA-256 verify,
    // per-TU compile, versioned cache — the same entry Run uses.
    const context = createProjectLibraryContext([]);
    if (context.index === undefined) throw new Error('live proof needs the production index build');
    const built = await context.index('Bounce2', release.version);
    const headerNames = [...built.headers.keys()];
    expect(headerNames).toContain('Bounce2.h');
    const headerText = new TextDecoder().decode(built.headers.get('Bounce2.h'));
    if (!headerText.includes('attach') || !headerText.includes('update')) {
      throw new Error('live proof needs Bounce2.attach/update in the installed header');
    }

    // Serve the just-built objects the way a cache hit would, then compile a
    // sketch calling one API and run it on a live core.
    const simulation = new Simulation(arduinoUnoR3(), {
      indexInstalled: new Map([['Bounce2', { headers: headerNames }]]),
      indexBuild: async () => built,
    });
    simulation.execution = 'avr';
    const project = {
      ...toSingleFileProject(SKETCH, 'arduino-cpp'),
      libraries: [{ name: 'Bounce2', source: 'index', version: release.version }],
    } as FirmwareProject;
    await simulation.compileAndRun(project);
    expect(simulation.compileState).toBe('ready');
    expect(simulation.firmwareError).toBeNull();
    const backend = (simulation as unknown as { avrBackend: AvrBackend | null }).avrBackend;
    expect(backend, 'fresh HEX flashes onto a live core').not.toBeNull();
    const pinId = simulation.mcu.pinIdForGpio(13);
    expect(pinId).toBeDefined();
    const seen = new Set<number>();
    for (let step = 0; step < 60 && seen.size < 2; step += 1) {
      backend!.step(10);
      seen.add(simulation.mcu.configurationOf(pinId!).duty);
    }
    expect(seen.has(0) && seen.has(1), 'D13 blinks while the library updates').toBe(true);
    expect(backend!.fault, 'no core fault surfaces').toBeNull();
  }, 180_000);
});
