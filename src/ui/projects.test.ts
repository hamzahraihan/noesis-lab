import { describe, expect, it } from 'vitest';
import { BOARDS, type BoardId } from './boardRegistry';
import { EXAMPLES } from './examples';
import { PROJECTS, projectFor } from './projects';

const EXAMPLE_IDS = new Set(EXAMPLES.map((example) => example.id));

describe('board projects', () => {
  it('covers every board exactly once', () => {
    const ids = PROJECTS.map((entry) => entry.board);
    expect(new Set(ids).size).toBe(BOARDS.length);
    for (const board of BOARDS) {
      expect(ids.filter((id) => id === board.id).length, board.id).toBe(1);
    }
  });

  it('finds each board project by id and nothing else', () => {
    for (const board of BOARDS) {
      expect(projectFor(board.id)?.board).toBe(board.id);
    }
  });

  it('names only examples that exist, and always says what running shows', () => {
    for (const entry of PROJECTS) {
      for (const id of entry.tryNext) {
        expect(EXAMPLE_IDS.has(id), `${entry.board} tryNext "${id}"`).toBe(true);
      }
      expect(entry.youWillSee.length, `${entry.board} youWillSee`).toBeGreaterThan(0);
      expect(entry.project.length, `${entry.board} project`).toBeGreaterThan(0);
      expect(entry.why.length, `${entry.board} why`).toBeGreaterThan(0);
    }
  });

  it('sends the Pi learner to the Python blink, not to C++ examples', () => {
    const pi = projectFor('raspberry-pi' as BoardId);
    expect(pi?.tryNext).toEqual([]);
  });
});
