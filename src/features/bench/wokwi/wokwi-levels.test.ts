import { describe, expect, it } from 'vitest';
import { headerPinLevel } from './wokwi';

describe('header pin level tags', () => {
  it('maps volts to HIGH/LOW at half logic level', () => {
    expect(headerPinLevel('gpio', 5, 5)).toBe('HIGH');
    expect(headerPinLevel('gpio', 2.5, 5)).toBe('HIGH');
    expect(headerPinLevel('gpio', 2.49, 5)).toBe('LOW');
    expect(headerPinLevel('adc', 3.3, 3.3)).toBe('HIGH');
    expect(headerPinLevel('adc', 0, 3.3)).toBe('LOW');
  });

  it('stays silent for rails and unknown pins', () => {
    expect(headerPinLevel('power', 5, 5)).toBeNull();
    expect(headerPinLevel('ground', 0, 5)).toBeNull();
    expect(headerPinLevel(undefined, 5, 5)).toBeNull();
  });
});
