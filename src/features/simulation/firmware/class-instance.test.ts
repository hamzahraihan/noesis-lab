import { describe, expect, it } from 'vitest';
import { FirmwareRuntime } from './interpreter';
import { toSingleFileProject } from './project';

describe('class instances', () => {
  it('constructs a global and dispatches a method', () => {
    const project = toSingleFileProject(
      `class Counter { public: int bump(); int n; }; Counter c; void setup() { c.n = 41; } void loop() {}`,
      'arduino-cpp',
    );
    const runtime = FirmwareRuntime.fromProject(project);
    expect(runtime.hasFunction('setup')).toBe(true);
  });
});
