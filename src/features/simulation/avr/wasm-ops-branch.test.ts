import { describe, expect, it } from 'vitest';
import { branch_taken, skip_width } from './wasm/ops-branch-stub';

describe('branch helpers', () => {
  it('reads only its own flag bit', () => {
    expect(branch_taken(0x02, 0)).toBe(true);
    expect(branch_taken(0xfd, 0)).toBe(false);
    expect(branch_taken(0x01, 2)).toBe(true);
    expect(branch_taken(0xfe, 2)).toBe(false);
    expect(branch_taken(0xff, 1)).toBe(false);
    expect(branch_taken(0x00, 3)).toBe(true);
  });

  it('widths 32-bit instructions as 2 words', () => {
    expect(skip_width(0x940c)).toBe(2);
    expect(skip_width(0x940e)).toBe(2);
    expect(skip_width(0x0000)).toBe(1);
    expect(skip_width(0xc001)).toBe(1);
  });
});
