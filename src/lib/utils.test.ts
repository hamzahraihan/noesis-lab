import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('merges class lists', () => {
    expect(cn('px-2', 'py-1')).toBe('px-2 py-1');
  });

  it('tailwind-merge resolves conflicting utilities', () => {
    expect(cn('bg-slate-800', 'bg-slate-700')).toBe('bg-slate-700');
  });

  it('ignores falsy conditional entries', () => {
    const showAccent = false;
    expect(cn('ctl', showAccent && 'ctl-accent', undefined, 'h-7')).toBe('ctl h-7');
  });
});
