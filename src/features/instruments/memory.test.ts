import { describe, expect, it } from 'vitest';
import { memoryRows } from './memory';

describe('memoryRows', () => {
  it('renders eight bytes per row with an ASCII column', () => {
    const bytes = Array.from({ length: 20 }, (_, index) => index);
    const rows = memoryRows({ start: 0x100, bytes }, 0x104);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      address: 0x100,
      hex: '00 01 02 03 04 05 06 07',
      ascii: '........',
      hasSp: true,
    });
    expect(rows[0]?.hasSp).toBe(true);
    expect(rows[1]?.hasSp).toBe(false);
    expect(rows[2]?.ascii).toBe('....');
  });

  it('prints printable ASCII', () => {
    const bytes = Array.from('Noesis', (char) => char.charCodeAt(0));
    expect(memoryRows({ start: 0x100, bytes })[0]?.ascii).toBe('Noesis');
  });
});
