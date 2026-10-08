import { describe, expect, it } from 'vitest';
import { parseFirmware, FirmwareSyntaxError } from './parser';
import { parsePython } from './python';

describe('file-aware errors', () => {
  it('prefixes the C++ file name', () => {
    try {
      parseFirmware('int 123broken;', 'helpers.h');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(FirmwareSyntaxError);
      expect((error as FirmwareSyntaxError).file).toBe('helpers.h');
      expect((error as Error).message).toContain('helpers.h');
    }
  });

  it('prefixes the Python file name', () => {
    try {
      parsePython('def broken(:\n  pass\n', 'helpers.py');
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toContain('helpers.py');
    }
  });
});
