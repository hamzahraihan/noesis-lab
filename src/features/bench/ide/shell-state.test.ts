// src/features/bench/ide/shell-state.test.ts
import { describe, expect, it } from 'vitest';
import { bottomTabForError, centerKeyForFile, isCircuitKey, nextActivity } from './shell-state';

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
});
