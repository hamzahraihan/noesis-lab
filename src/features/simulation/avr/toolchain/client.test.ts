import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import type { FirmwareProject } from '@/features/simulation/firmware/project';
import {
  assembleProjectUnits,
  compileInWorker,
  compileProjectWithLibraries,
  mapGccError,
  mapGccErrorForUnits,
  type ProjectLibraryContext,
} from './client';

const lineMap = [
  { file: 'cfg.h', line: 1 },
  { file: 'main.ino', line: 1 },
  { file: 'main.ino', line: 2 },
  { file: 'main.ino', line: 3 },
];

describe('gcc error mapping', () => {
  it('maps a TU error frame back to its tab', () => {
    const err = mapGccError('HorangFirmware.cpp:3:5: error: \u2018appTick\u2019 was not declared', lineMap, 'main.ino');
    expect(err).toEqual({ tab: 'main.ino', line: 2, message: expect.stringContaining('appTick') });
  });

  it('degrades to capped raw text when unparseable', () => {
    const err = mapGccError('ld blew up\nsecond line', lineMap, 'main.ino');
    expect(err.tab).toBe('main.ino');
    expect(err.line).toBe(1);
  });
});

describe('multi-TU gcc error mapping', () => {
  it('maps a library TU frame to its file', () => {
    // lineMap is TU-line-indexed (TU line n -> lineMap[n - 1]), as packed by
    // packageSketch: the frame's TU line 12 resolves through entry 11.
    const lineMap = Array.from({ length: 12 }, (_, index) => ({ file: 'other.cpp', line: index + 1 }));
    lineMap[11] = { file: 'SevSeg/SevSeg.cpp', line: 12 };
    const err = mapGccErrorForUnits('/build/SevSeg.cpp:12:3: error: thing broke', [
      { unit: 'SevSeg.cpp', lineMap },
    ]);
    expect(err).toEqual({ tab: 'SevSeg/SevSeg.cpp', line: 12, message: expect.stringContaining('thing broke') });
  });

  it('falls back to the active file for frames from unknown units', () => {
    const err = mapGccErrorForUnits('/build/Other.cpp:1:1: error: boom', [
      { unit: 'SevSeg.cpp', lineMap: [{ file: 'SevSeg/SevSeg.cpp', line: 1 }] },
    ], 'main.ino');
    expect(err).toEqual({ tab: 'main.ino', line: 1, message: expect.stringContaining('boom') });
  });

  it('degrades to capped raw text when unparseable', () => {
    const err = mapGccErrorForUnits('ld blew up\nsecond line', [
      { unit: 'SevSeg.cpp', lineMap: [{ file: 'SevSeg/SevSeg.cpp', line: 1 }] },
    ], 'main.ino');
    expect(err.tab).toBe('main.ino');
    expect(err.line).toBe(1);
  });
});

const MY_LIB_SLOT = {
  id: 'm',
  name: 'MyLib',
  files: [
    { path: 'MyLib.h', content: '#pragma once\nint libAdd(int a, int b);\n' },
    { path: 'MyLib.cpp', content: '#include "MyLib.h"\nint libAdd(int a, int b){return a+b;}\n' },
  ],
} as const;

function slotProject(content: string): FirmwareProject {
  return {
    language: 'arduino-cpp',
    activeName: 'main.ino',
    files: [{ name: 'main.ino', content }],
    libraries: [{ name: 'custom:m', source: 'custom' }],
  } as unknown as FirmwareProject;
}

const SUPPORTED = new Set(['Arduino.h']);

function stubContext(overrides?: Partial<ProjectLibraryContext>): ProjectLibraryContext {
  return {
    slots: [{ id: 'm', name: 'MyLib', files: [...MY_LIB_SLOT.files] }],
    tier2: async () => {
      throw new Error('unexpected Tier-2 fetch');
    },
    ...overrides,
  };
}

describe('project assembly', () => {
  it('assembles firmware plus custom slot units with merged headers', async () => {
    const assembled = await assembleProjectUnits(
      slotProject('#include <Arduino.h>\n#include <MyLib.h>\nvoid setup(){}\nvoid loop(){}\n'),
      stubContext(),
      SUPPORTED,
    );
    expect(assembled.units.map((unit) => unit.name)).toEqual(['HorangFirmware.cpp', 'MyLib.cpp']);
    expect(assembled.prebuiltObjects).toEqual([]);
    expect(assembled.units[0]?.headers.get('MyLib.h')).toContain('libAdd');
    expect(assembled.unitMaps[1]).toEqual({
      unit: 'MyLib.cpp',
      lineMap: [
        { file: 'MyLib.cpp', line: 1 },
        { file: 'MyLib.cpp', line: 2 },
      ],
    });
    expect(assembled.warnings).toEqual([]);
  });

  it('refuses invalid declarations before fetching anything', async () => {
    let fetches = 0;
    const project = {
      language: 'arduino-cpp',
      activeName: 'main.ino',
      files: [{ name: 'main.ino', content: 'void setup(){}\nvoid loop(){}\n' }],
      libraries: [{ name: 'Nope', source: 'provided' }],
    } as unknown as FirmwareProject;
    await expect(
      assembleProjectUnits(project, stubContext({ tier2: async () => {
        fetches += 1;
        throw new Error('unexpected Tier-2 fetch');
      } }), SUPPORTED),
    ).rejects.toThrow(/unknown provided library/);
    expect(fetches).toBe(0);
  });

  it('refuses unbundled angle includes after merging declared headers', async () => {
    await expect(
      assembleProjectUnits(
        slotProject('#include <Arduino.h>\n#include <NopeLib.h>\nvoid setup(){}\nvoid loop(){}\n'),
        stubContext(),
        SUPPORTED,
      ),
    ).rejects.toThrow(/library <NopeLib\.h> is not bundled/);
  });

  it('merges Tier-2 objects and headers for declared Tier-2 libraries', async () => {
    const encoder = new TextEncoder();
    const project = {
      language: 'arduino-cpp',
      activeName: 'main.ino',
      files: [{ name: 'main.ino', content: '#include <Arduino.h>\n#include <SevSeg.h>\nvoid setup(){}\nvoid loop(){}\n' }],
      libraries: [{ name: 'SevSeg', source: 'provided' }],
    } as unknown as FirmwareProject;
    const assembled = await assembleProjectUnits(
      project,
      stubContext({
        slots: [],
        tier2: async () => ({
          objects: new Map([['SevSeg.o', new Uint8Array([7])]]),
          headers: new Map([['SevSeg.h', encoder.encode('#pragma once\n')]]),
        }),
      }),
      SUPPORTED,
    );
    expect(assembled.units.map((unit) => unit.name)).toEqual(['HorangFirmware.cpp']);
    expect(assembled.prebuiltObjects).toHaveLength(1);
    expect(assembled.units[0]?.headers.get('SevSeg.h')).toBe('#pragma once\n');
  });
});

describe('avr compile client', () => {
  it('compiles Blink to a bootable HEX in-worker', async () => {
    let pkg: string | null = null;
    try {
      pkg = createRequire(import.meta.url).resolve('@horang-corp/avr-gcc-wasm/package.json');
    } catch { /* fall through to skip */ }
    if (!pkg) {
      console.warn('SKIP: toolchain absent');
      return;
    }
    const { hex } = await compileInWorker('#include <Arduino.h>\nvoid setup(){}\nvoid loop(){}\n', () => {}, new AbortController().signal);
    expect(hex.length).toBeGreaterThan(0);
  }, 120_000);

  it('rejects unbundled libraries before compiling', async () => {
    await expect(
      compileInWorker('#include <Arduino.h>\n#include <NopeLib.h>\nvoid setup(){}\nvoid loop(){}\n', () => {}, new AbortController().signal),
    ).rejects.toThrow(/not bundled/);
  });

  it('reports the counted supported-header set size', async () => {
    const outcome = await compileInWorker('#include <NopeLib.h>\nvoid setup(){}\nvoid loop(){}\n', () => {}, new AbortController().signal).then(
      () => { throw new Error('expected a bundled-library rejection'); },
      (error: Error) => error,
    );
    expect(outcome.message).toMatch(/library <NopeLib\.h> is not bundled \(see (\d+) supported headers\)/);
  });

  it('links a custom-slot TU across translation units', async () => {
    let pkg: string | null = null;
    try {
      pkg = createRequire(import.meta.url).resolve('@horang-corp/avr-gcc-wasm/package.json');
    } catch { /* fall through to skip */ }
    if (!pkg) {
      console.warn('SKIP: toolchain absent');
      return;
    }
    const project = slotProject(
      '#include <Arduino.h>\n#include <MyLib.h>\nvoid setup(){int x=libAdd(1,2);(void)x;}\nvoid loop(){}\n',
    );
    const { hex } = await compileProjectWithLibraries(project, stubContext(), () => {}, new AbortController().signal);
    expect(hex.length).toBeGreaterThan(0);
  }, 120_000);
});
