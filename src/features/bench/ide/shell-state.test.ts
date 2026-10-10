// src/features/bench/ide/shell-state.test.ts
import { describe, expect, it } from 'vitest';
import { bottomTabForError, centerKeyForFile, isCircuitKey, nextActivity, repairCenterKey, resolveErrorCenter } from './shell-state';

describe('shell-state', () => {
  it('passes file names through as center keys', () => {
    expect(centerKeyForFile('sketch.ino')).toBe('sketch.ino');
  });
  it('detects the circuit key only for circuit', () => {
    expect(isCircuitKey('circuit')).toBe(true);
    expect(isCircuitKey('sketch.ino')).toBe(false);
  });
  it('opens problems on error, serial otherwise', () => {
    expect(bottomTabForError('sketch.ino:3 oops')).toBe('problems');
    expect(bottomTabForError(null)).toBe('serial');
    expect(bottomTabForError('')).toBe('serial');
  });
  it('toggles sidebar when re-clicking active activity', () => {
    expect(nextActivity('files', 'files', true)).toEqual({ activity: 'files', sidebarOpen: false });
    expect(nextActivity('files', 'components', false)).toEqual({ activity: 'components', sidebarOpen: true });
  });
  it('resolves an error head naming a project file to its center key', () => {
    expect(resolveErrorCenter('helpers.h', ['sketch.ino', 'helpers.h'])).toBe('helpers.h');
  });
  it('ignores error heads that name no project file', () => {
    expect(resolveErrorCenter('Servo', ['sketch.ino'])).toBeNull();
    expect(resolveErrorCenter('', ['sketch.ino'])).toBeNull();
  });
  it('repairs a stale center key to the fallback file', () => {
    expect(repairCenterKey('circuit', [{ name: 'a.ino' }], 'a.ino')).toBe('circuit');
    expect(repairCenterKey('a.ino', [{ name: 'a.ino' }], 'a.ino')).toBe('a.ino');
    expect(repairCenterKey('gone.h', [{ name: 'a.ino' }], 'a.ino')).toBe('a.ino');
  });
});
