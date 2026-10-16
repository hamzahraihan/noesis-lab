import { describe, expect, it } from 'vitest';
import { toSingleFileProject } from '@/features/simulation';
import { canResumeRun, type RunSession } from './run-session';

/** A recorded run, with any field overridable to model one change. */
function session(overrides: Partial<RunSession> = {}): RunSession {
  return {
    project: toSingleFileProject('void setup() {}\nvoid loop() {}\n', 'arduino-cpp'),
    backend: 'avr',
    benchRevision: 3,
    owner: 'worker',
    ...overrides,
  };
}

describe('run session resume', () => {
  it('resumes when nothing changed since the last run', () => {
    const recorded = session();
    expect(canResumeRun(recorded, { ...recorded })).toBe(true);
  });

  it('never resumes without a recorded run', () => {
    expect(canResumeRun(null, session())).toBe(false);
  });

  it('reloads after a sketch edit', () => {
    const recorded = session();
    // Every edit produces a fresh project object, so identity is the signal.
    expect(canResumeRun(recorded, { ...recorded, project: session().project })).toBe(false);
  });

  it('reloads when the backend selection changes', () => {
    const recorded = session();
    expect(canResumeRun(recorded, { ...recorded, backend: 'interpreter' })).toBe(false);
  });

  it('reloads after a structural wiring edit', () => {
    const recorded = session();
    expect(canResumeRun(recorded, { ...recorded, benchRevision: 4 })).toBe(false);
  });

  it('reloads when the owning backend changes', () => {
    const recorded = session();
    expect(canResumeRun(recorded, { ...recorded, owner: 'in-page' })).toBe(false);
  });
});
