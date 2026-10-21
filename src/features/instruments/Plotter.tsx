/**
 * Serial plotter panel.
 *
 * Draws the numbers the sketch printed, over the samples it printed them
 * in. A plotter is the instrument for what a program *writes* rather than
 * for the voltage on a wire: a line that climbs is a reading that climbed,
 * and the shape of it is the thing a person learns to read.
 *
 * The serial monitor shows the same output as text; this is the same output
 * read as numbers, so the two panels never disagree about what was printed.
 * The x axis is the sample, not the second: the bench knows when a reading
 * was *taken* on a pin, but the serial output carries no time of its own, and
 * a plot that pretended otherwise would be lying about the sketch.
 */

import { useEffect, useMemo, useRef } from 'react';
import { plotFromSerial, plotToCsv } from '@/features/simulation';
import { ActivityLogIcon, DownloadIcon } from '@radix-ui/react-icons';
import { Button, CardTitle } from '@/components';
import { downloadText } from './download';

/** How many samples the plot shows at once. */
const WINDOW_SAMPLES = 200;

/** The canvas is drawn at this width and scaled to fit the panel. */
const CANVAS_WIDTH = 520;
const CANVAS_HEIGHT = 160;

/** The colours the channels are drawn in, in the order they are reported. */
const SERIES_COLOURS = ['#38bdf8', '#34d399', '#fbbf24', '#f472b6', '#fb923c', '#22d3ee'];

export interface PlotterProps {
  /** The serial output the sketch has produced, as the monitor received it. */
  lines: readonly string[];
}

export function Plotter({ lines }: PlotterProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const plot = useMemo(() => plotFromSerial(lines), [lines]);

  // No dependency list on purpose: the serial buffer is mutated in place as
  // the sketch runs, so its identity never changes and a memoised effect
  // would draw once and freeze.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const width = canvas.width;
    const height = canvas.height;
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#020617';
    context.fillRect(0, 0, width, height);

    // The range the readings fall in, over the window that is shown, with a
    // little air above and below so a flat line is still a line and not the
    // edge of the paper. An old reading that has fallen out of the window
    // does not squeeze the one that is on it.
    const shown = Math.min(plot.length, WINDOW_SAMPLES);
    const first = plot.length - shown;
    let low = Number.POSITIVE_INFINITY;
    let high = Number.NEGATIVE_INFINITY;
    for (const series of plot.series) {
      for (let step = first; step < plot.length; step++) {
        const value = series.values[step];
        if (value === undefined) continue;
        if (value < low) low = value;
        if (value > high) high = value;
      }
    }
    if (!Number.isFinite(low) || !Number.isFinite(high)) {
      low = 0;
      high = 1;
    }
    if (high === low) {
      high = low + 1;
      low -= 1;
    }
    const pad = (high - low) * 0.1;
    low -= pad;
    high += pad;

    // The graticule, so a reading has something to be read against.
    context.strokeStyle = '#1e293b';
    context.lineWidth = 1;
    for (let step = 0; step <= 4; step++) {
      const y = (step / 4) * height;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }

    if (shown < 2) return;
    plot.series.forEach((series, index) => {
      context.strokeStyle = SERIES_COLOURS[index % SERIES_COLOURS.length];
      context.lineWidth = 1.5;
      context.beginPath();
      for (let step = 0; step < shown; step++) {
        const value = series.values[first + step] ?? 0;
        const x = (step / (shown - 1)) * width;
        const y = height - ((value - low) / (high - low)) * height;
        if (step === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.stroke();
    });
    // The range, written down over the lines: an auto-scaled plot that says
    // nothing about its scale is a picture, not a reading.
    context.fillStyle = '#94a3b8';
    context.font = '9px monospace';
    context.fillText(String(Math.round(high - pad)), 4, 10);
    context.fillText(String(Math.round(low + pad)), 4, height - 3);
  });

  const range = plot.series.length > 0 ? `${plot.length} samples` : 'nothing plotted yet';

  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex items-center gap-2">
        <CardTitle className="flex flex-1 items-center gap-2">
          <ActivityLogIcon className="icon-sm text-[var(--hd-muted)]" aria-hidden="true" />
          Serial plotter
        </CardTitle>
        <span className="font-mono text-xs text-[var(--hd-faint)]">{range}</span>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => downloadText(plotToCsv(plot), 'noesis-plot.csv', 'text/csv')}
          disabled={plot.series.length === 0}
          title="Save the plot as a CSV table"
          aria-label="Save the plot as CSV"
        >
          <DownloadIcon className="icon-sm" aria-hidden="true" />
        </Button>
      </div>
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        className="w-full"
        aria-label="The numbers the sketch printed, over the samples it printed them in"
      />
      {plot.series.length > 1 && (
        <ul className="flex flex-wrap gap-3 font-mono text-xs text-[var(--hd-muted)]">
          {plot.series.map((series, index) => (
            <li key={series.name} className="flex items-center gap-1">
              <span
                className="inline-block h-2 w-2"
                style={{ background: SERIES_COLOURS[index % SERIES_COLOURS.length] }}
                aria-hidden="true"
              />
              {series.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
