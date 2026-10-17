import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { createSimCore } from './core';
import { serialRing } from './protocol';
import { boardOption } from '@/features/learn/boardRegistry';
import type { Rp2040Assets } from '../rp2040/assets';

const FIRMWARE_PATH = 'src/features/simulation/rp2040/firmware/RPI_PICO-20260824-v1.29.0.uf2';
const haveFirmware = existsSync(FIRMWARE_PATH);

const require = createRequire(import.meta.url);
const littlefsPath = require.resolve('littlefs/dist/littlefs.wasm');

function bytesOf(path: string): ArrayBuffer {
  const buf = readFileSync(path);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function realAssets(): Promise<Rp2040Assets> {
  return Promise.resolve({ uf2: bytesOf(FIRMWARE_PATH), littlefsWasm: bytesOf(littlefsPath) });
}

const MAIN_PY = `import time
print('NOESIS-RP2040-WORKER')
while True:
    time.sleep_ms(10)
`;

function pythonProject(content = MAIN_PY): never {
  return {
    language: 'python',
    activeName: 'main.py',
    files: [{ name: 'main.py', content }],
  } as never;
}

const EMPTY_BENCH = { parts: [], wires: [], terminals: [] } as never;

function textOf(value: number[]): string {
  return new TextDecoder().decode(new Uint8Array(value));
}

describe.skipIf(!haveFirmware)('rp2040 attach', () => {
  it('boots the pinned firmware and prints from the mounted main.py', async () => {
    const core = createSimCore(boardOption('rp2040').make());
    core.rebuild(EMPTY_BENCH, pythonProject(), 'rp2040', false, undefined, realAssets);
    await vi.waitFor(() => expect(core.rp2040Attached).toBe(true), { timeout: 15000 });

    let serial = '';
    for (let frame = 0; frame < 60 && !serial.includes('NOESIS-RP2040-WORKER'); frame++) {
      core.step(16);
      serial += textOf(serialRing(core.snapshot()).drain());
    }

    expect(serial).toContain('NOESIS-RP2040-WORKER');
    expect(core.fault).toBeNull();
  }, 90_000);

  it('ignores an rp2040 execution on boards that cannot run it', () => {
    const fetcher = vi.fn(realAssets);
    const core = createSimCore(boardOption('uno').make());
    core.rebuild(EMPTY_BENCH, pythonProject(), 'rp2040', false, undefined, fetcher);
    expect(fetcher).not.toHaveBeenCalled();
    expect(core.rp2040Attached).toBe(false);
    expect(core.fault).toBeNull();
  });

  it('lands a failed asset fetch in the fault text', async () => {
    const core = createSimCore(boardOption('rp2040').make());
    core.rebuild(
      EMPTY_BENCH,
      pythonProject(),
      'rp2040',
      false,
      undefined,
      () => Promise.reject(new Error('assets offline')),
    );
    await vi.waitFor(() => expect(core.fault).toBe('assets offline'));
    expect(core.rp2040Attached).toBe(false);
  });

  it('never lands a stale attach after a rebuild moves on', async () => {
    let release!: (assets: Rp2040Assets) => void;
    const gate = new Promise<Rp2040Assets>((resolve) => {
      release = resolve;
    });
    const core = createSimCore(boardOption('rp2040').make());
    core.rebuild(EMPTY_BENCH, pythonProject(), 'rp2040', false, undefined, () => gate);
    core.rebuild(EMPTY_BENCH, pythonProject(), 'interpreter');
    release(await realAssets());
    await Promise.resolve();
    await Promise.resolve();
    expect(core.rp2040Attached).toBe(false);
    expect(core.fault).toBeNull();
  });
});
