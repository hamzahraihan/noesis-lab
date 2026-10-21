/**
 * The serial plot: the numbers a sketch prints, over the samples it printed.
 *
 * A plotter is a bench instrument for what a program *writes* rather than for
 * the voltage on a wire: a sketch that prints a reading every second draws a
 * line, and the line is the thing a person learns to read. Wokwi's plotter
 * works this way, and so does this one.
 *
 * A line is a sample when it is a number, or several numbers separated by
 * tabs or commas -- the shape a sketch prints when it reports more than one
 * reading at a time. A line that is anything else is text, and the serial
 * monitor is where text belongs.
 */

/** One channel of the plot: a name and the value it held at each sample. */
export interface PlotSeries {
  readonly name: string;
  readonly values: readonly number[];
}

/** The plot, as the panel draws it. */
export interface PlotData {
  readonly series: readonly PlotSeries[];
  /** How many samples the plot holds; the x axis runs from 0 to this. */
  readonly length: number;
}

/** The names the channels carry, in the order a sketch reports them. */
function channelName(channel: number): string {
  return channel === 0 ? 'value' : `value ${channel + 1}`;
}

/**
 * The numbers a serial output carries, as a plot.
 *
 * A channel that a line did not report keeps the value it last held, so a
 * sketch that prints one reading on one line and two on the next draws two
 * lines rather than one line with a gap in it.
 */
export function plotFromSerial(lines: readonly string[]): PlotData {
  const rows: number[][] = [];
  let channels = 0;
  for (const chunk of lines) {
    for (const line of chunk.split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      const parts = trimmed.split(/[\t,]/).map((part) => part.trim());
      const numbers: number[] = [];
      for (const part of parts) {
        const value = Number(part);
        if (part === '' || !Number.isFinite(value)) {
          numbers.length = 0;
          break;
        }
        numbers.push(value);
      }
      // Not a number: text, and the serial monitor is where text belongs.
      if (numbers.length === 0) continue;
      rows.push(numbers);
      if (numbers.length > channels) channels = numbers.length;
    }
  }
  const series: PlotSeries[] = [];
  for (let channel = 0; channel < channels; channel++) {
    let held = 0;
    const values = rows.map((row) => {
      const value = row[channel];
      if (value !== undefined) held = value;
      return held;
    });
    series.push({ name: channelName(channel), values });
  }
  return { series, length: rows.length };
}

/**
 * The plot as CSV, one row per sample and one column per channel.
 *
 * The header names the channels, so a spreadsheet reads the file as a table
 * rather than as two columns of numbers.
 */
export function plotToCsv(plot: PlotData): string {
  const lines = [plot.series.map((series) => series.name).join(',')];
  for (let sample = 0; sample < plot.length; sample++) {
    lines.push(plot.series.map((series) => String(series.values[sample] ?? '')).join(','));
  }
  return lines.join('\n');
}
