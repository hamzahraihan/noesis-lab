import { describe, expect, it } from 'vitest';
import { EXERCISES } from './exercises';
import { previewFor } from './exercise-preview-data';

/**
 * The finished-build previews have to be pictures of something, not just
 * present. Every exercise already proves its setup runs in `exercises.test`,
 * so these check the part that test cannot see: that the preview frames a
 * real region of placed parts and draws every jumper as a path.
 */

describe('exercise previews', () => {
  it('builds a finished build for every exercise without throwing', () => {
    for (const exercise of EXERCISES) {
      expect(() => previewFor(exercise), `${exercise.id} preview`).not.toThrow();
    }
  });

  it('frames a non-empty region of the parts the exercise placed', () => {
    for (const exercise of EXERCISES) {
      const preview = previewFor(exercise);
      expect(preview.parts.length, `${exercise.id} parts`).toBeGreaterThan(0);
      expect(preview.frame.width, `${exercise.id} frame width`).toBeGreaterThan(0);
      expect(preview.frame.height, `${exercise.id} frame height`).toBeGreaterThan(0);
    }
  });

  it('draws every jumper as a non-empty path', () => {
    for (const exercise of EXERCISES) {
      const preview = previewFor(exercise);
      expect(preview.paths.length, `${exercise.id} paths`).toBeGreaterThan(0);
      for (const path of preview.paths) {
        expect(path.d.length, `${exercise.id} wire ${path.id}`).toBeGreaterThan(0);
      }
    }
  });

  it('builds each exercise once per session', () => {
    for (const exercise of EXERCISES) {
      expect(previewFor(exercise), `${exercise.id} cache`).toBe(previewFor(exercise));
    }
  });
});
