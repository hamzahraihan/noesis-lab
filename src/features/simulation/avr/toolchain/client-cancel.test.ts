import { describe, expect, it, vi } from 'vitest';
import { compileInWorker } from './client';

vi.mock('@horang-corp/avr-gcc-wasm', () => ({
  setAssetsBase: vi.fn(),
  buildFirmware: vi.fn(),
}));

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
