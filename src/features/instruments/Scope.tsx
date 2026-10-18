/**
 * Oscilloscope panel.
 *
 * Draws the trace the engine actually captured, and measures it the way an
 * instrument would rather than trusting the firmware's own account of what it
 * asked for. The point of putting a scope next to a sketch is catching the gap
 * between the two.
 */

import { useEffect, useRef } from 'react';
import {
  decodeUart,
  measureDutyCycle,
  measureFrequency,
  type TraceSample,
} from '@/features/simulation';
import type { BoardPin } from '@/features/parts';
import { ActivityLogIcon, Crosshair1Icon, StopwatchIcon } from '@radix-ui/react-icons';
import {
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components';

const TRACE_HEIGHT_MM = 60;
/** Simulated milliseconds shown across the trace. */
const WINDOW_MS = 30;

export interface ScopePanelProps {
  pins: readonly BoardPin[];
  probePinId: string | null;
  samples: TraceSample[];
  logicVolts: number;
  baud: number;
  onProbe(pinId: string | null): void;
  onBaud(baud: number): void;
}

const BAUD_RATES = [300, 1200, 2400, 9600, 19200, 38400, 115200];

export function ScopePanel({
  pins,
  probePinId,
  samples,
  logicVolts,
  baud,
  onProbe,
  onBaud,
}: ScopePanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // No dependency list on purpose: the trace buffer is mutated in place as the
  // engine solves, so its identity never changes and a memoised effect would
  // draw once and freeze.
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

    // Graticule at every volt, so a reading has something to be read against.
    context.strokeStyle = '#1e293b';
    context.lineWidth = 1;
    for (let volt = 0; volt <= logicVolts; volt++) {
      const y = height - (volt / logicVolts) * height;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }

    if (samples.length < 2) return;
    const last = samples[samples.length - 1].t;
    const visible = samples.filter((sample) => sample.t >= last - WINDOW_MS);
    if (visible.length < 2) return;

    context.strokeStyle = '#38bdf8';
    context.lineWidth = 1.5;
    context.beginPath();
    visible.forEach((sample, index) => {
      const x = ((sample.t - (last - WINDOW_MS)) / WINDOW_MS) * width;
      const y = height - (Math.min(sample.v, logicVolts) / logicVolts) * height;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
  });

  const frequency = measureFrequency(samples, logicVolts);
  const duty = measureDutyCycle(samples, logicVolts);
  const decoded = decodeUart(samples, baud, logicVolts);
  const ascii = decoded
    .map(({ byte }) => (byte >= 32 && byte < 127 ? String.fromCharCode(byte) : '.'))
    .join('');

  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex items-center gap-2">
        <CardTitle className="flex flex-1 items-center gap-2">
          <ActivityLogIcon className="icon-sm text-slate-500" aria-hidden="true" />
          Oscilloscope
        </CardTitle>
        <Select
          value={probePinId ?? 'none'}
          onValueChange={(next) => onProbe(next === 'none' ? null : next)}
        >
          <SelectTrigger className="h-6 max-w-28 text-[11px]" aria-label="Probe pin">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No probe</SelectItem>
            {pins.map((pin) => (
              <SelectItem key={pin.id} value={pin.id}>
                {pin.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="relative">
        <canvas
          ref={canvasRef}
          width={520}
          height={TRACE_HEIGHT_MM}
          className="w-full rounded-none border border-slate-800 bg-slate-950"
        />
        {!probePinId && (
          // The trace area is a fixed 60 mm tall, so this is a single line that
          // fits inside it. The earlier two-line copy overflowed and painted
          // over the UART readout underneath.
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center gap-1.5 px-2 text-center text-[11px] text-slate-600">
            <Crosshair1Icon className="icon-sm shrink-0" aria-hidden="true" />
            Clip the probe onto a pin to capture its voltage.
          </p>
        )}
      </div>

      {probePinId ? (
        <dl className="grid grid-cols-3 gap-1 text-[11px]">
          <Reading label="Freq" value={frequency > 0 ? `${frequency.toFixed(0)} Hz` : '--'} />
          <Reading label="Duty" value={`${duty.toFixed(0)}%`} />
          <Reading label="Samples" value={String(samples.length)} />
        </dl>
      ) : null}

      <div className="flex items-center gap-2">
        <StopwatchIcon className="icon-sm shrink-0 text-slate-500" aria-hidden="true" />
        <Select value={String(baud)} onValueChange={(next) => onBaud(Number(next))}>
          <SelectTrigger className="h-6 w-20 shrink-0 text-[11px]" aria-label="UART baud rate">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BAUD_RATES.map((rate) => (
              <SelectItem key={rate} value={String(rate)}>
                {rate}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="truncate font-mono text-[11px] text-emerald-300">
          {decoded.length > 0 ? ascii : '--'}
        </span>
      </div>
    </div>
  );
}

function Reading({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="tabular-nums text-slate-200">{value}</dd>
    </div>
  );
}
