import { describe, expect, it } from 'vitest';
import { plotFromSerial, plotToCsv } from './plot';

/**
 * The serial plot, at the level the bench sees it.
 *
 * The plot is the numbers a sketch prints, and nothing else: a line that is
 * text is the serial monitor's business, and a line that carries several
 * numbers is several channels at once.
 */
describe('the serial plot', () => {
  it('plots the numbers a sketch prints', () => {
    const plot = plotFromSerial(['1\n', '2\n', '3\n']);
    expect(plot.length).toBe(3);
    expect(plot.series).toEqual([{ name: 'value', values: [1, 2, 3] }]);
  });

  it('ignores the lines that are text', () => {
    const plot = plotFromSerial(['ESP32 online\n', '1\n', 'blink 2\n', '3\n']);
    expect(plot.length).toBe(2);
    expect(plot.series[0].values).toEqual([1, 3]);
  });

  it('plots several channels when a line carries several numbers', () => {
    const plot = plotFromSerial(['1\t2\n', '3\t4\n']);
    expect(plot.series.map((series) => series.name)).toEqual(['value', 'value 2']);
    expect(plot.series[0].values).toEqual([1, 3]);
    expect(plot.series[1].values).toEqual([2, 4]);
  });

  it('keeps the value a channel last held when a line leaves it out', () => {
    const plot = plotFromSerial(['1\t2\n', '3\n']);
    expect(plot.series[0].values).toEqual([1, 3]);
    // The second channel had nothing new to say, so it holds what it had.
    expect(plot.series[1].values).toEqual([2, 2]);
  });

  it('reads a number written without a newline after it', () => {
    const plot = plotFromSerial(['42']);
    expect(plot.series[0].values).toEqual([42]);
  });

  it('reads a fraction, and a negative one', () => {
    const plot = plotFromSerial(['3.5\n', '-2\n']);
    expect(plot.series[0].values).toEqual([3.5, -2]);
  });

  it('has no series at all when nothing was printed', () => {
    const plot = plotFromSerial(['ESP32 online\n', '']);
    expect(plot.series).toEqual([]);
    expect(plot.length).toBe(0);
  });
});

describe('the plot as a table', () => {
  it('names the channels in the header', () => {
    const csv = plotToCsv(plotFromSerial(['1\t2\n', '3\t4\n']));
    expect(csv).toBe('value,value 2\n1,2\n3,4');
  });

  it('is empty of samples when there were none', () => {
    // No channels, so no header: there is nothing to name.
    expect(plotToCsv(plotFromSerial([]))).toBe('');
  });
});
