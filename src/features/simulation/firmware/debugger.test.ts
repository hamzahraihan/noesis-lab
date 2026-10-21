import { describe, expect, it } from 'vitest';
import { FirmwareDebugger } from './debugger';
import { FirmwareRunner, type FirmwareServices } from './interpreter';
import { toSingleFileProject, type FirmwareProject } from './project';

/**
 * The debugger, at the level the bench sees it.
 *
 * A stop is a line in a file, and the program is held there until somebody
 * says to carry on. The tests below drive it the way the bench does: attach
 * a debugger, step the runner, and read where it stopped.
 */

function services(serial: string[] = []): FirmwareServices {
  return {
    nowMs: () => 0,
    pinMode: () => {},
    digitalWrite: () => {},
    digitalRead: () => 0,
    analogWrite: () => {},
    analogRead: () => 0,
    serialBegin: () => {},
    serialWrite: (text) => {
      serial.push(text);
    },
    wire: {
      begin: () => {},
      beginTransmission: () => {},
      write: () => 1,
      endTransmission: () => 0,
      requestFrom: () => 0,
      read: () => -1,
      available: () => 0,
    },
    spi: { begin: () => {}, transfer: () => 0, end: () => 0 },
  };
}

/** A runner with a debugger watching it. */
function watched(
  source: string | FirmwareProject,
  watcher: FirmwareDebugger,
  language: 'arduino-cpp' | 'python' = 'arduino-cpp',
): FirmwareRunner {
  const runner = new FirmwareRunner(source, services(), language);
  runner.runtime.attachDebugger(watcher);
  return runner;
}

/** Steps the runner until the debugger holds it, or until it runs out. */
function runTo(runner: FirmwareRunner, limit = 40): void {
  for (let step = 0; step < limit; step++) {
    if (runner.paused) return;
    if (runner.step() === null) return;
  }
}

const SKETCH = `int counter = 0;

void setup() {
  counter = 1;
  counter = 2;
}

void loop() {
  counter = counter + 1;
}
`;

describe('a breakpoint', () => {
  it('stops the program at its line, and says where it stopped', () => {
    const watcher = new FirmwareDebugger();
    watcher.toggleBreakpoint('main.ino', 5);
    const runner = watched(SKETCH, watcher);

    runTo(runner);

    expect(runner.paused).toBe(true);
    expect(runner.stoppedAt?.file).toBe('main.ino');
    expect(runner.stoppedAt?.line).toBe(5);
  });

  it('holds the program there until somebody says to carry on', () => {
    const watcher = new FirmwareDebugger();
    watcher.toggleBreakpoint('main.ino', 5);
    const runner = watched(SKETCH, watcher);

    runTo(runner);
    expect(runner.paused).toBe(true);
    // A stopped program is not a finished one, and it does not move on.
    expect(runner.done).toBe(false);
    expect(runner.step()).toBeNull();
    expect(runner.stoppedAt?.line).toBe(5);
  });

  it('carries on to the next stop when the program is let go', () => {
    const watcher = new FirmwareDebugger();
    watcher.toggleBreakpoint('main.ino', 5);
    watcher.toggleBreakpoint('main.ino', 9);
    const runner = watched(SKETCH, watcher);

    runTo(runner);
    expect(runner.stoppedAt?.line).toBe(5);

    runner.resume();
    runTo(runner);
    expect(runner.stoppedAt?.line).toBe(9);
  });

  it('shows the names the program can see where it stopped', () => {
    const watcher = new FirmwareDebugger();
    watcher.toggleBreakpoint('main.ino', 4);
    const runner = watched(
      `int counter = 0;\nvoid setup() {\n  int local = 7;\n  counter = local;\n}\n`,
      watcher,
    );

    runTo(runner);

    const variables = runner.stoppedAt?.variables ?? [];
    expect(variables).toContainEqual({ name: 'local', value: '7', scope: 'local' });
    expect(variables).toContainEqual({ name: 'counter', value: '0', scope: 'global' });
  });

  it('does not stop at a line in another file', () => {
    const watcher = new FirmwareDebugger();
    // Line 2 of the helper, not of the sketch that calls it.
    watcher.toggleBreakpoint('helpers.h', 2);
    const project: FirmwareProject = {
      language: 'arduino-cpp',
      activeName: 'main.ino',
      files: [
        {
          name: 'main.ino',
          content: '#include "helpers.h"\nvoid setup() { helper(); }\nvoid loop() {}\n',
        },
        { name: 'helpers.h', content: 'void helper() {\n  int x = 1;\n}\n' },
      ],
    };
    const runner = watched(project, watcher);

    runTo(runner);

    expect(runner.paused).toBe(true);
    expect(runner.stoppedAt?.file).toBe('helpers.h');
    expect(runner.stoppedAt?.line).toBe(2);
  });
});

describe('a step', () => {
  const CALLING = `void helper() {
  int x = 1;
}
void setup() {
  helper();
  int y = 2;
}
void loop() {}
`;

  it('steps over a call to the next statement of the same function', () => {
    const watcher = new FirmwareDebugger();
    watcher.toggleBreakpoint('main.ino', 5);
    const runner = watched(CALLING, watcher);

    runTo(runner);
    expect(runner.stoppedAt?.line).toBe(5);

    watcher.stepOver(1);
    runner.resume();
    runTo(runner);

    // The statement after the call, not the one inside it.
    expect(runner.stoppedAt?.line).toBe(6);
  });

  it('steps into a call to the first statement inside it', () => {
    const watcher = new FirmwareDebugger();
    watcher.toggleBreakpoint('main.ino', 5);
    const runner = watched(CALLING, watcher);

    runTo(runner);
    expect(runner.stoppedAt?.line).toBe(5);

    watcher.stepInto();
    runner.resume();
    runTo(runner);

    expect(runner.stoppedAt?.line).toBe(2);
  });
});

describe('a program nobody is watching', () => {
  it('runs without asking a question at every statement', () => {
    const runner = new FirmwareRunner(SKETCH, services(), 'arduino-cpp');
    for (let step = 0; step < 10; step++) {
      if (runner.step() === null) break;
    }
    expect(runner.paused).toBe(false);
  });
});

describe('the debugger itself', () => {
  it('turns a stop on and off with the same call', () => {
    const watcher = new FirmwareDebugger();
    expect(watcher.toggleBreakpoint('main.ino', 3)).toBe(true);
    expect(watcher.hasBreakpoint('main.ino', 3)).toBe(true);
    expect(watcher.toggleBreakpoint('main.ino', 3)).toBe(false);
    expect(watcher.hasBreakpoint('main.ino', 3)).toBe(false);
  });

  it('lists the stops it holds', () => {
    const watcher = new FirmwareDebugger();
    watcher.toggleBreakpoint('main.ino', 5);
    watcher.toggleBreakpoint('main.ino', 3);
    watcher.toggleBreakpoint('helpers.h', 1);
    expect(watcher.breakpoints()).toEqual([
      { file: 'main.ino', line: 3 },
      { file: 'main.ino', line: 5 },
      { file: 'helpers.h', line: 1 },
    ]);
  });
});

describe('a Python sketch', () => {
  it('stops at its line too', () => {
    const watcher = new FirmwareDebugger();
    watcher.toggleBreakpoint('main.py', 3);
    const runner = watched(
      toSingleFileProject('x = 1\ny = 2\nprint(x + y)\n', 'python'),
      watcher,
      'python',
    );

    runTo(runner);

    expect(runner.paused).toBe(true);
    expect(runner.stoppedAt?.line).toBe(3);
  });
});
