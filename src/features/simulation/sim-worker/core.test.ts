import { describe, expect, it } from 'vitest';
import { createSimCore } from './core';
import { boardOption } from '@/features/learn/boardRegistry';

describe('sim core', () => {
  it('steps an interpreter blink without Worker globals', () => {
    const core = createSimCore(boardOption('uno').make());
    core.rebuild(
      { parts: [], wires: [], terminals: [] } as never,
      { language: 'arduino-cpp', activeName: 'main.ino', files: [{ name: 'main.ino', content: 'void setup() {}\nvoid loop() {}\n' }] } as never,
      'interpreter',
    );
    core.step(16);
    expect(core.timeMs).toBeGreaterThan(0);
    expect(core.fault).toBeNull();
  });

  it('pauses stepping when frames go unconsumed (backpressure)', () => {
    const core = createSimCore(boardOption('uno').make());
    let consumed = 0;
    for (let i = 0; i < 100; i++) {
      if (consumed < 3) {
        core.step(16);
        consumed += 1;
      }
    }
    expect(core.timeMs).toBeLessThanOrEqual(3 * 40 + 16);
  });

  it('flashes words onto an AVR core without disturbing bench state', () => {
    const core = createSimCore(boardOption('uno').make());
    core.rebuild(
      { parts: [], wires: [], terminals: [] } as never,
      { language: 'arduino-cpp', activeName: 'main.ino', files: [{ name: 'main.ino', content: 'void setup() {}\nvoid loop() {}\n' }] } as never,
      'interpreter',
    );
    core.step(16);
    const before = core.timeMs;
    expect(before).toBeGreaterThan(0);
    // RJMP -1: an endless self-loop, so stepping the flashed program can
    // neither fault nor run off the end of flash.
    expect(() => core.flash(new Uint16Array([0xcfff]))).not.toThrow();
    expect(core.fault).toBeNull();
    core.step(16);
    // A rebuild would have zeroed the clock; flash must not.
    expect(core.timeMs).toBeGreaterThan(before);
    expect(core.fault).toBeNull();
    expect(() => core.snapshot()).not.toThrow();
  });

  it('ignores flash on non-Uno boards', () => {
    const core = createSimCore(boardOption('mega').make());
    core.rebuild(
      { parts: [], wires: [], terminals: [] } as never,
      { language: 'arduino-cpp', activeName: 'main.ino', files: [{ name: 'main.ino', content: 'void setup() {}\nvoid loop() {}\n' }] } as never,
      'interpreter',
    );
    expect(() => core.flash(new Uint16Array([0xcfff]))).not.toThrow();
    expect(core.fault).toBeNull();
  });
});
