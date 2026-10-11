import { describe, expect, it } from 'vitest';
import { parseFirmware } from './parser';

describe('class declarations', () => {
  it('parses a minimal Button shape', () => {
    const program = parseFirmware(
      `class Button { public: Button(uint8_t pin); bool pressed(); private: uint8_t _pin; };`,
      'button.h',
    );
    expect(program.classes.get('Button')?.methods.has('pressed')).toBe(true);
    expect(program.classes.get('Button')?.fields.map((f) => f.name)).toContain('_pin');
  });
});
