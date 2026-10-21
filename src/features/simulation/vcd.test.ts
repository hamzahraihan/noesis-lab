import { describe, expect, it } from 'vitest';
import { toVcd } from './vcd';

/**
 * The capture as a VCD.
 *
 * The format is the point: a file this writes is a file PulseView reads, so
 * the tests are about the format rather than about the writer's own idea of
 * it.
 */
describe('the capture as a VCD', () => {
  it('names the signals and declares the timescale', () => {
    const vcd = toVcd([{ label: 'D2', samples: [{ t: 0, v: 0 }] }]);
    expect(vcd).toContain('$timescale 1 ms $end');
    expect(vcd).toContain('$var wire 1 ! D2 $end');
    expect(vcd).toContain('$enddefinitions $end');
  });

  it('writes the changes with the time they happened at', () => {
    const vcd = toVcd([
      {
        label: 'D2',
        samples: [
          { t: 0, v: 0 },
          { t: 10, v: 1 },
          { t: 20, v: 0 },
        ],
      },
    ]);
    expect(vcd).toContain('#0\n0!\n#10\n1!\n#20\n0!');
  });

  it('does not repeat a level that held', () => {
    const vcd = toVcd([
      {
        label: 'D2',
        samples: [
          { t: 0, v: 1 },
          { t: 5, v: 1 },
          { t: 10, v: 1 },
        ],
      },
    ]);
    expect(vcd.match(/1!/g)).toHaveLength(1);
  });

  it('gives every signal its own name and code', () => {
    const vcd = toVcd([
      { label: 'D2', samples: [{ t: 0, v: 0 }] },
      { label: 'D3', samples: [{ t: 0, v: 1 }] },
    ]);
    expect(vcd).toContain('$var wire 1 ! D2 $end');
    expect(vcd).toContain('$var wire 1 " D3 $end');
  });

  it('keeps the changes of two signals in time order', () => {
    const vcd = toVcd([
      {
        label: 'D2',
        samples: [
          { t: 0, v: 0 },
          { t: 20, v: 1 },
        ],
      },
      {
        label: 'D3',
        samples: [
          { t: 0, v: 0 },
          { t: 10, v: 1 },
        ],
      },
    ]);
    const times = [...vcd.matchAll(/^#(\d+)$/gm)].map((match) => match[1]);
    expect(times).toEqual(['0', '10', '20']);
  });

  it('makes a name a VCD can carry of a label it cannot', () => {
    const vcd = toVcd([{ label: 'pin 13 (D5)', samples: [{ t: 0, v: 0 }] }]);
    expect(vcd).toContain('$var wire 1 ! pin_13__D5_ $end');
  });

  it('writes a header for a capture with no signals', () => {
    const vcd = toVcd([]);
    expect(vcd).toContain('$enddefinitions $end');
  });
});
