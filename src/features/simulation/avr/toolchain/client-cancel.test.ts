import { describe, expect, it, vi } from 'vitest';
import type { FirmwareProject } from '@/features/simulation/firmware/project';
import { compileInWorker, compileProjectWithLibraries } from './client';

vi.mock('./tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./tools')>();
  return { ...actual, buildProject: vi.fn() };
});

/** A build that only settles when the caller's signal aborts. */
function abortingBuild(started: () => void, signal?: AbortSignal): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    started();
    signal?.addEventListener('abort', () => reject(new Error('compile cancelled')), {
      once: true,
    });
  });
}

describe('single-TU Node-path cancel', () => {
  it('rejects with compile cancelled when abort lands mid-compile', async () => {
    const tools = await import('./tools');
    const controller = new AbortController();
    let buildStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      buildStarted = resolve;
    });
    vi.mocked(tools.buildProject).mockImplementationOnce((_request, signal) =>
      abortingBuild(buildStarted, signal),
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
    vi.mocked(tools.buildProject).mockImplementationOnce((_request, signal) =>
      abortingBuild(buildStarted, signal),
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
