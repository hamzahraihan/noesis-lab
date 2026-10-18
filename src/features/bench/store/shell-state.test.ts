// src/features/bench/store/shell-state.test.ts
import { describe, expect, it } from 'vitest';
import {
  bottomTabForError,
  centerKeyForFile,
  clampLayoutSizes,
  DEFAULT_LAYOUT,
  isCircuitKey,
  loadLayoutSizes,
  nextActivity,
  repairCenterKey,
  resolveErrorCenter,
  saveLayoutSizes,
} from './shell-state';

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
    expect(nextActivity('files', 'components', false)).toEqual({
      activity: 'components',
      sidebarOpen: true,
    });
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
  it('clamps each panel dimension into its limits', () => {
    expect(clampLayoutSizes({ sidebarWidth: 40, bottomHeight: 4000, railWidth: 240 })).toEqual({
      sidebarWidth: 176,
      bottomHeight: 560,
      railWidth: 240,
    });
  });
  it('caps the bottom panel at half the viewport when given', () => {
    expect(clampLayoutSizes({ ...DEFAULT_LAYOUT, bottomHeight: 500 }, 600).bottomHeight).toBe(300);
  });
  it('loads defaults on missing, corrupt, or partial saves', () => {
    expect(loadLayoutSizes(() => null)).toEqual(DEFAULT_LAYOUT);
    expect(loadLayoutSizes(() => '{broken')).toEqual(DEFAULT_LAYOUT);
    expect(loadLayoutSizes(() => JSON.stringify({ sidebarWidth: 300 }))).toEqual({
      ...DEFAULT_LAYOUT,
      sidebarWidth: 300,
    });
    expect(loadLayoutSizes(() => JSON.stringify({ sidebarWidth: 'wide' }))).toEqual(DEFAULT_LAYOUT);
  });
  it('round-trips sizes through save and load', () => {
    const backing = new Map<string, string>();
    const sizes = { sidebarWidth: 300, bottomHeight: 220, railWidth: 280 };
    saveLayoutSizes((k, v) => void backing.set(k, v), sizes);
    expect(loadLayoutSizes((k) => backing.get(k) ?? null)).toEqual(sizes);
  });
  it('clamps a tall persisted panel to half the viewport on load', () => {
    const read = () => JSON.stringify({ sidebarWidth: 256, bottomHeight: 478, railWidth: 240 });
    expect(clampLayoutSizes(loadLayoutSizes(read), 800).bottomHeight).toBe(400);
  });
});
