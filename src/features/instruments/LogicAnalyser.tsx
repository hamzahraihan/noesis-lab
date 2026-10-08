/**
 * Logic analyser panel.
 *
 * Where the scope answers "what voltage", this answers "what level": every
 * analysed pin gets a lane and the trace is drawn as the square wave the pin
 * actually produced, sampled from the solver rather than from anything the
 * firmware says it wrote.
 *
 * The lanes are drawn on one canvas rather than one each because a capture of
 * six pins at a hundred milliseconds apiece is only readable when their edges
 * line up -- which is the entire reason to look at several pins at once.
 */

import { useEffect, useRef } from 'react';
import type { BoardPin } from '@/features/parts';
import type { TraceSample } from '@/features/simulation';
import { Crosshair1Icon, StopwatchIcon } from '@radix-ui/react-icons';
import { Button, CardTitle } from '@/components';

/** Simulated milliseconds shown across the capture. */
const WINDOW_MS = 100;


/** Enough lanes to fill the panel; past this the lanes stop being readable. */
const MAX_LANES = 8;

const PIN_COLOURS = [
  '#38bdf8',
  '#34d399',
  '#fbbf24',
  '#f472b6',
  '#fb923c',
  '#22d3ee',
  '#f87171',
];

/** Lane height in CSS pixels, set explicitly so a narrow panel squashes the
 *  trace rather than flattening it into nothing. */
const LANE_PX = 30;

/** The canvas is drawn at this width and scaled to fit the panel. */
const CANVAS_WIDTH = 520;

export interface LogicAnalyserProps {
  /** Pins the operator may capture, already filtered to signal-carrying ones. */
  pins: readonly BoardPin[];
  traces: ReadonlyArray<{ label: string; samples: TraceSample[] }>;
  logicVolts: number;
  onTogglePin(pinId: string): void;
  isCapturing(pinId: string): boolean;
}

export function LogicAnalyser({
  pins,
  traces,
  logicVolts,
  onTogglePin,
  isCapturing,
}: LogicAnalyserProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const capturing = traces.map((trace, index) => ({ ...trace, colour: PIN_COLOURS[index % PIN_COLOURS.length] }));

  // No dependency list, for the same reason the scope has none: the capture
  // buffer is mutated in place as the engine solves, so its identity never
  // changes and a memoised effect would draw once and freeze.
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

    const lanes = Math.max(capturing.length, 1);
    const laneHeight = Math.min(LANE_PX, height / lanes);

    // The window is anchored to the newest sample on the bench, not to now: a
    // stopped sketch's last edge is what an operator came back to look at.
    const newest = Math.max(0, ...capturing.map((trace) => trace.samples.at(-1)?.t ?? 0));
    const start = newest - WINDOW_MS;
    const xOf = (timeMs: number) => ((timeMs - start) / WINDOW_MS) * width;

    capturing.forEach((trace, lane) => {
      const top = lane * laneHeight;
      const low = top + laneHeight - 5;
      const high = top + 5;

      context.fillStyle = '#0f172a';
      context.fillRect(0, top, width, laneHeight);
      context.strokeStyle = '#1e293b';
      context.beginPath();
      context.moveTo(0, low);
      context.lineTo(width, low);
      context.stroke();

      context.fillStyle = trace.colour;
      context.font = '9px monospace';
      context.fillText(trace.label, 4, top + 9);

      if (trace.samples.length < 2) return;
      const threshold = logicVolts / 2;

      /*
       * A digital trace is the line between levels, not between samples: two
       * samples either side of an edge are joined by a vertical one, which is
       * the whole difference between a clock and a staircase.
       */
      let level = trace.samples[0].v >= threshold;
      context.strokeStyle = trace.colour;
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(xOf(trace.samples[0].t), level ? high : low);
      for (const sample of trace.samples.slice(1)) {
        const nextLevel = sample.v >= threshold;
        const x = xOf(sample.t);
        if (nextLevel !== level) {
          context.lineTo(x, level ? high : low);
          context.lineTo(x, nextLevel ? high : low);
          level = nextLevel;
        }
        context.lineTo(x, level ? high : low);
      }
      context.stroke();
    });
  });

  return (
    <section className="border-b border-slate-800">
      <div className="flex items-center gap-2 px-3 pt-2">
        <CardTitle className="flex flex-1 items-center gap-2">
          <StopwatchIcon className="icon-sm text-slate-500" aria-hidden="true" />
          Logic analyser
        </CardTitle>
        <span className="num text-[10px] text-slate-600">{WINDOW_MS} ms</span>
      </div>

      <div className="relative px-3">
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={Math.max(LANE_PX, capturing.length * LANE_PX)}
          className="w-full rounded border border-slate-800 bg-slate-950"
          style={{ height: Math.max(LANE_PX, capturing.length * LANE_PX) }}
        />
        {capturing.length === 0 && (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center gap-1.5 px-3 text-center text-[11px] text-slate-600">
            <Crosshair1Icon className="icon-sm shrink-0" aria-hidden="true" />
            Pick a pin below to capture its level.
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-1 p-3">
        {pins.map((pin) => {
          const on = isCapturing(pin.id);
          const full = !on && capturing.length >= MAX_LANES;
          return (
            <Button
              key={pin.id}
              type="button"
              disabled={full}
              onClick={() => onTogglePin(pin.id)}
              aria-pressed={on}
              size="sm"
              variant={on ? 'default' : 'secondary'}
              className="h-6 px-2 text-[11px]"
              title={full ? `Capture is full: ${MAX_LANES} lanes is as many as stay readable` : undefined}
            >
              {pin.label}
            </Button>
          );
        })}
      </div>
    </section>
  );
}