import { describe, expect, it } from 'vitest';
import { FirmwareDebugger } from '@/features/simulation';
import { boardOption } from '@/features/learn/boardRegistry';
import { Simulation } from './simulation';

/**
 * The bench's debugger, on the in-page path.
 *
 * The worker path has its own test, in the core that runs the sketch there;
 * this is the other half: the simulation that owns the bench, the stops and
 * the three questions a person asks of a stopped program.
 */
describe('the bench debugger', () => {
  const sketch = 'int blinks = 0;\nint other = 1;\nvoid setup() { blinks = 2; }\nvoid loop() {}\n';

  it('stops the sketch at a stop, and carries on when told to', () => {
    const sim = new Simulation(boardOption('uno').make());
    const watcher = new FirmwareDebugger();
    sim.attachDebugger(watcher);
    watcher.toggleBreakpoint('main.ino', 2);
    sim.loadFirmware(sketch, 'arduino-cpp');
    sim.start();

    sim.tick(0.016);

    expect(sim.debugPaused).toBe(true);
    expect(sim.debugFrame()?.line).toBe(2);
    // The names the program can see at the stop: the global it declared.
    expect(sim.debugFrame()?.variables).toContainEqual({
      name: 'blinks',
      value: '0',
      scope: 'global',
    });

    sim.resumeDebug();
    sim.tick(0.016);
    expect(sim.debugPaused).toBe(false);
  });

  it('steps the sketch to the next statement', () => {
    const sim = new Simulation(boardOption('uno').make());
    const watcher = new FirmwareDebugger();
    sim.attachDebugger(watcher);
    watcher.toggleBreakpoint('main.ino', 2);
    sim.loadFirmware(sketch, 'arduino-cpp');
    sim.start();

    sim.tick(0.016);
    expect(sim.debugFrame()?.line).toBe(2);

    sim.stepDebugInto();
    sim.tick(0.016);
    // The next statement the program runs: the one inside setup(), whose
    // declaration is not a statement of its own.
    expect(sim.debugFrame()?.line).toBe(3);
  });

  it('watches the sketch that is loaded after the debugger is attached', () => {
    const sim = new Simulation(boardOption('uno').make());
    const watcher = new FirmwareDebugger();
    sim.attachDebugger(watcher);
    watcher.toggleBreakpoint('main.ino', 2);
    // The sketch is loaded after the debugger was attached, which is the
    // order the bench does it in: the stops are set, then Run happens.
    sim.loadFirmware(sketch, 'arduino-cpp');
    sim.start();

    sim.tick(0.016);
    expect(sim.debugPaused).toBe(true);
  });
});
