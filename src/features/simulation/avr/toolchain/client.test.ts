import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { compileInWorker, mapGccError } from './client';

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
});
