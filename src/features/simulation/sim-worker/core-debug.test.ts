import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { boardOption } from '@/features/learn/boardRegistry';
import type { FirmwareProject } from '../firmware/project';
import { compileInWorker } from '../avr/toolchain/client';
import { packageSketch } from '../avr/packager';
import type { CompiledDebugInfo } from '../avr/debug/lines';
import { createSimCore } from './core';

const bench = { parts: [], wires: [], terminals: [] } as never;
const sketch = {
  language: 'arduino-cpp',
  activeName: 'main.ino',
  files: [{ name: 'main.ino', content: 'void setup() {}\nvoid loop() {}\n' }],
} as never;

/** NOPs; long enough that a slice never reaches the end of flash. */
function nops(count = 64): Uint16Array {
  return new Uint16Array(count);
}

/** RCALL +1 (pc0 -> pc2), NOP, RET, then NOPs. */
function callProgram(): Uint16Array {
  const words = nops();
  words[0] = 0xd001;
  words[2] = 0x0000;
  words[3] = 0x9508;
  return words;
}

const straightLines: CompiledDebugInfo = {
  lines: [
    { pc: 0, file: 'main.ino', line: 1 },
    { pc: 1, file: 'main.ino', line: 2 },
  ],
};

const callLines: CompiledDebugInfo = {
  lines: [
    { pc: 0, file: 'main.ino', line: 1 },
    { pc: 1, file: 'main.ino', line: 4 },
    { pc: 2, file: 'main.ino', line: 2 },
    { pc: 3, file: 'main.ino', line: 3 },
  ],
};

describe('worker core compiled debugging', () => {
  it('reports the actual debug backend, including an interpreter fallback', () => {
    const core = createSimCore(boardOption('uno').make());
    core.rebuild(bench, sketch, 'interpreter');
    expect(core.debugWatchable()).toBe(true);
    expect(core.debugCompiled()).toBe(false);

    core.flash(nops(4096), straightLines);
    expect(core.debugWatchable()).toBe(true);
    expect(core.debugCompiled()).toBe(true);

    const bundledOnly = createSimCore(boardOption('uno').make());
    bundledOnly.rebuild(bench, sketch, 'interpreter');
    bundledOnly.flash(nops(4096));
    expect(bundledOnly.debugWatchable()).toBe(false);
    expect(bundledOnly.debugCompiled()).toBe(true);

    const fallback = createSimCore(boardOption('uno').make());
    fallback.rebuild(bench, sketch, 'avr');
    expect(fallback.debugWatchable()).toBe(true);
    expect(fallback.debugCompiled()).toBe(false);
  });

  it('flashes compiled firmware and stops at a mapped source line', () => {
    const core = createSimCore(boardOption('uno').make());
    core.rebuild(bench, sketch, 'interpreter');
    core.flash(nops(4096), straightLines);
    core.setStops([{ file: 'main.ino', line: 2 }]);

    core.step(0.1);

    expect(core.debugPaused()).toBe(true);
    const frame = core.debugFrame();
    expect(frame?.file).toBe('main.ino');
    expect(frame?.line).toBe(2);
    expect(frame?.compiled).toBe(true);
    // Word 1 is byte address 2, the address a GDB user reads.
    expect(frame?.pc).toBe(2);
    expect(frame?.registers?.map((register) => register.name)).toEqual(
      expect.arrayContaining(['r0', 'r31', 'SP', 'SREG', 'PC']),
    );

    core.resumeDebug();
    core.step(0.1);
    expect(core.debugPaused()).toBe(false);
  });

  it('steps compiled firmware into the next mapped line', () => {
    const core = createSimCore(boardOption('uno').make());
    core.rebuild(bench, sketch, 'interpreter');
    core.flash(callProgram(), callLines);
    core.setStops([{ file: 'main.ino', line: 1 }]);
    core.step(1);
    expect(core.debugFrame()?.line).toBe(1);

    core.stepDebug('into');
    core.step(1);

    expect(core.debugPaused()).toBe(true);
    expect(core.debugFrame()?.line).toBe(2);
  });

  it('stops and steps over a call in a sketch built by the real toolchain', async () => {
    let toolchain: string | null = null;
    try {
      toolchain = createRequire(import.meta.url).resolve('@horang-corp/avr-gcc-wasm/package.json');
    } catch {
      /* fall through to skip */
    }
    if (!toolchain) {
      console.warn('SKIP: toolchain absent');
      return;
    }
    const project = {
      language: 'arduino-cpp',
      activeName: 'main.ino',
      files: [
        {
          name: 'main.ino',
          content:
            '#include <Arduino.h>\nvoid setup() {\n  pinMode(LED_BUILTIN, OUTPUT);\n}\nvoid loop() {\n  delay(100);\n  digitalWrite(LED_BUILTIN, HIGH);\n}\n',
        },
      ],
    } as FirmwareProject;
    const packed = packageSketch(project);
    const compiled = await compileInWorker(
      packed.source,
      () => {},
      new AbortController().signal,
      packed.lineMap,
    );
    expect(compiled.debug?.lines.length).toBeGreaterThan(0);
    expect(
      compiled.debug?.lines.some((row) => row.file === 'main.ino' && row.line === 6),
    ).toBe(true);

    const core = createSimCore(boardOption('uno').make());
    core.rebuild(bench, project as never, 'interpreter');
    core.flash(compiled.hex, compiled.debug);
    core.setStops([{ file: 'main.ino', line: 6 }]);
    for (let slice = 0; slice < 40 && !core.debugPaused(); slice += 1) core.step(10);

    expect(core.debugPaused()).toBe(true);
    expect(core.debugFrame()?.file).toBe('main.ino');
    expect(core.debugFrame()?.line).toBe(6);
    expect(core.debugFrame()?.compiled).toBe(true);
    expect(core.debugFrame()?.registers?.length).toBeGreaterThanOrEqual(35);

    core.stepDebug('over');
    for (let slice = 0; slice < 20 && !core.debugPaused(); slice += 1) core.step(10);
    expect(core.debugPaused()).toBe(true);
    expect(core.debugFrame()?.line).toBe(7);
  }, 180_000);
});
