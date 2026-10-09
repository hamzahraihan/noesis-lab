import { describe, expect, it, vi } from 'vitest';
import type { FirmwareProject } from '@/features/simulation/firmware/project';
import { compileInWorker, compileProjectWithLibraries } from './client';

vi.mock('@horang-corp/avr-gcc-wasm', () => ({
  setAssetsBase: vi.fn(),
  buildFirmware: vi.fn(),
}));

vi.mock('./tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./tools')>();
  return { ...actual, buildProjectHex: vi.fn() };
});

describe('single-TU Node-path cancel', () => {
  it('rejects with compile cancelled when abort lands mid-compile', async () => {
    const toolchain = await import('@horang-corp/avr-gcc-wasm');
    const controller = new AbortController();
    let buildStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      buildStarted = resolve;
    });
    vi.mocked(toolchain.buildFirmware).mockImplementationOnce(
      () =>
        new Promise<{ hex: string }>((resolve) => {
          buildStarted();
          controller.signal.addEventListener(
            'abort',
            () => {
              resolve({ hex: ':00000001FF\n' });
            },
            { once: true },
          );
        }),
    );
    const pending = compileInWorker('void setup(){}\nvoid loop(){}\n', () => {}, controller.signal);
    await started;
    controller.abort();
    await expect(pending).rejects.toThrow('compile cancelled');
  });
});

describe('multi-TU Node-path cancel', () => {
  it('rejects with compile cancelled when abort lands mid-project-build', async () => {
    const tools = await import('./tools');
    const controller = new AbortController();
    let buildStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      buildStarted = resolve;
    });
    vi.mocked(tools.buildProjectHex).mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          buildStarted();
          controller.signal.addEventListener(
            'abort',
            () => {
              resolve(':00000001FF\n');
            },
            { once: true },
          );
        }),
    );
    const project = {
      language: 'arduino-cpp',
      activeName: 'main.ino',
      files: [{ name: 'main.ino', content: 'void setup(){}\nvoid loop(){}\n' }],
      libraries: [],
    } as unknown as FirmwareProject;
    const pending = compileProjectWithLibraries(
      project,
      {
        slots: [],
        tier2: async () => {
          throw new Error('unexpected Tier-2 fetch');
        },
      },
      () => {},
      controller.signal,
    );
    await started;
    controller.abort();
    await expect(pending).rejects.toThrow('compile cancelled');
  });
});
