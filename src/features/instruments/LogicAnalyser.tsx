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
import {
  decodeI2c,
  decodeSpi,
  toVcd,
  type I2cEvent,
  type SpiEvent,
  type TraceSample,
} from '@/features/simulation';
import { Crosshair1Icon, DownloadIcon, StopwatchIcon } from '@radix-ui/react-icons';
import {
  Button,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components';
import type { BusDecodeState, DecodeMode } from './bus-decode';
import { downloadText } from './download';

/** Simulated milliseconds shown across the capture. */
const WINDOW_MS = 100;

/** Enough lanes to fill the panel; past this the lanes stop being readable. */
const MAX_LANES = 8;

const PIN_COLOURS = ['#38bdf8', '#34d399', '#fbbf24', '#f472b6', '#fb923c', '#22d3ee', '#f87171'];

/** Lane height in CSS pixels, set explicitly so a narrow panel squashes the
 *  trace rather than flattening it into nothing. */
const LANE_PX = 30;

/** The canvas is drawn at this width and scaled to fit the panel. */
const CANVAS_WIDTH = 520;

/** Height of the decoded-transaction band drawn above the lanes. */
const DECODE_PX = 40;

/** The labels an operator most likely wired to each bus line, tried in order. */
const SPI_HINTS = {
  sck: /(sck|sclk|\b13\b|\b52\b)/i,
  mosi: /(mosi|\b11\b|\b51\b)/i,
  miso: /(miso|\b12\b|\b50\b)/i,
  cs: /(\bss\b|\bss0\b|\bcs\b|\bcs0\b|\b10\b|\b53\b)/i,
};
const I2C_HINTS = {
  sda: /(sda|\ba4\b|\b20\b)/i,
  scl: /(scl|\ba5\b|\b21\b)/i,
};

function hex(value: number): string {
  return `0x${value.toString(16).padStart(2, '0').toUpperCase()}`;
}

/** One decoded event as a chip: short text and a tint that says what kind of thing it is. */
function chipFor(event: SpiEvent | I2cEvent): { text: string; tint: string } {
  switch (event.type) {
    case 'frame-start':
      return { text: 'CS▼', tint: '#fbbf24' };
    case 'frame-end':
      return { text: 'CS▲', tint: '#fbbf24' };
    case 'start':
      return { text: 'START', tint: '#fbbf24' };
    case 'repeated-start':
      return { text: 'R-START', tint: '#fbbf24' };
    case 'address':
      return {
        text: `${hex(event.value ?? 0)} ${event.read ? 'R' : 'W'}`,
        tint: '#e2e8f0',
      };
    case 'data':
      return { text: hex(event.value ?? 0), tint: '#e2e8f0' };
    case 'ack':
      return { text: 'ACK', tint: '#34d399' };
    case 'nack':
      return { text: 'NAK', tint: '#f87171' };
    case 'stop':
      return { text: 'STOP', tint: '#fbbf24' };
    case 'byte':
      return {
        text: hex(event.value ?? 0),
        tint: event.line === 'miso' ? '#7dd3fc' : '#e2e8f0',
      };
  }
}

/** One decoded event as a line of the readout: the capture time and what it was. */
function lineFor(event: SpiEvent | I2cEvent): string {
  const time = `${event.t.toFixed(2)} ms`;
  switch (event.type) {
    case 'frame-start':
      return `${time}  CS falls — frame opens`;
    case 'frame-end':
      return `${time}  CS rises — frame closes`;
    case 'byte':
      return `${time}  ${event.line === 'miso' ? 'MISO' : 'MOSI'} ${hex(event.value ?? 0)}`;
    case 'start':
      return `${time}  START`;
    case 'repeated-start':
      return `${time}  repeated START`;
    case 'address':
      return `${time}  address ${hex(event.value ?? 0)} ${event.read ? 'read' : 'write'}`;
    case 'data':
      return `${time}  data ${hex(event.value ?? 0)}`;
    case 'ack':
      return `${time}  ACK`;
    case 'nack':
      return `${time}  NAK (no answer)`;
    case 'stop':
      return `${time}  STOP`;
  }
}

export interface LogicAnalyserProps {
  /** Pins the operator may capture, already filtered to signal-carrying ones. */
  pins: readonly BoardPin[];
  traces: ReadonlyArray<{ label: string; samples: TraceSample[] }>;
  logicVolts: number;
  onTogglePin(pinId: string): void;
  isCapturing(pinId: string): boolean;
  /** The decode configuration; the bench owns it so it survives tab switches. */
  decode: BusDecodeState;
  onDecode(next: BusDecodeState): void;
}

export function LogicAnalyser({
  pins,
  traces,
  logicVolts,
  onTogglePin,
  isCapturing,
  decode,
  onDecode,
}: LogicAnalyserProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const capturing = traces.map((trace, index) => ({
    ...trace,
    colour: PIN_COLOURS[index % PIN_COLOURS.length],
  }));
  const { mode: decodeMode, spiSck, spiMosi, spiMiso, spiCs, i2cSda, i2cScl } = decode;

  const laneLabels = capturing.map((trace) => trace.label);
  const firstMatch = (pattern: RegExp): string =>
    laneLabels.find((label) => pattern.test(label)) ?? '';
  const selectMode = (mode: DecodeMode): void => {
    const next = { ...decode, mode };
    if (mode === 'spi') {
      next.spiSck = decode.spiSck || firstMatch(SPI_HINTS.sck);
      next.spiMosi = decode.spiMosi || firstMatch(SPI_HINTS.mosi);
      next.spiMiso = decode.spiMiso || firstMatch(SPI_HINTS.miso);
      next.spiCs = decode.spiCs || firstMatch(SPI_HINTS.cs);
    } else if (mode === 'i2c') {
      next.i2cSda = decode.i2cSda || firstMatch(I2C_HINTS.sda);
      next.i2cScl = decode.i2cScl || firstMatch(I2C_HINTS.scl);
    }
    onDecode(next);
  };

  const traceFor = (label: string): TraceSample[] | undefined =>
    capturing.find((trace) => trace.label === label)?.samples;

  // Decoding runs over the same capture the lanes draw, so what the band says
  // is what the waveform shows -- including the bits the firmware never sent.
  const decodeEvents: readonly (SpiEvent | I2cEvent)[] =
    decodeMode === 'spi'
      ? (() => {
          const sck = spiSck ? traceFor(spiSck) : undefined;
          if (!sck) return [];
          return decodeSpi(
            {
              sck,
              cs: spiCs ? traceFor(spiCs) : undefined,
              mosi: spiMosi ? traceFor(spiMosi) : undefined,
              miso: spiMiso ? traceFor(spiMiso) : undefined,
            },
            logicVolts,
          );
        })()
      : decodeMode === 'i2c'
        ? (() => {
            const sda = i2cSda ? traceFor(i2cSda) : undefined;
            const scl = i2cScl ? traceFor(i2cScl) : undefined;
            if (!sda || !scl) return [];
            return decodeI2c({ sda, scl }, logicVolts);
          })()
        : [];
  const decodeBand = decodeMode !== 'none' ? DECODE_PX : 0;

  const decodeUnassigned =
    decodeMode === 'spi'
      ? spiSck === ''
      : decodeMode === 'i2c'
        ? i2cSda === '' || i2cScl === ''
        : false;
  const decodeHint = decodeUnassigned
    ? 'Assign the bus lanes below to decode.'
    : 'No traffic decoded on the selected lanes yet.';

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

    if (decodeBand > 0) {
      context.fillStyle = '#0f172a';
      context.fillRect(0, 0, width, decodeBand);
      context.strokeStyle = '#1e293b';
      context.beginPath();
      context.moveTo(0, decodeBand - 0.5);
      context.lineTo(width, decodeBand - 0.5);
      context.stroke();

      context.fillStyle = '#64748b';
      context.font = '9px monospace';
      context.fillText(decodeMode === 'spi' ? 'SPI' : 'I²C', 4, 12);

      /*
       * The decoded stream as chips, left to right in capture order. Exact
       * milliseconds live in the readout below the canvas; here the point is
       * the shape of the transaction, one glance long.
       */
      let chipX = 34;
      let shown = 0;
      for (const event of decodeEvents) {
        const chip = chipFor(event);
        const chipWidth = context.measureText(chip.text).width + 10;
        if (chipX + chipWidth > width - 16) break;
        context.fillStyle = '#1e293b';
        context.fillRect(chipX, 4, chipWidth, 15);
        context.fillStyle = chip.tint;
        context.fillText(chip.text, chipX + 5, 15);
        chipX += chipWidth + 4;
        shown++;
      }
      if (shown < decodeEvents.length) {
        context.fillStyle = '#64748b';
        context.fillText(`+${decodeEvents.length - shown}`, width - 16, 15);
      }
      context.fillStyle = '#475569';
      context.fillText(decodeEvents.length > 0 ? `${decodeEvents.length} events` : decodeHint, 4, 33);
    }

    const laneCount = Math.max(capturing.length, 1);
    const laneHeight = Math.min(LANE_PX, (height - decodeBand) / laneCount);

    // The window is anchored to the newest sample on the bench, not to now: a
    // stopped sketch's last edge is what an operator came back to look at.
    const newest = Math.max(0, ...capturing.map((trace) => trace.samples.at(-1)?.t ?? 0));
    const start = newest - WINDOW_MS;
    const xOf = (timeMs: number) => ((timeMs - start) / WINDOW_MS) * width;

    capturing.forEach((trace, lane) => {
      const top = decodeBand + lane * laneHeight;
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

  const laneSelect = (ariaLabel: string, value: string, onChange: (next: string) => void) => (
    <Select value={value || 'none'} onValueChange={(next) => onChange(next === 'none' ? '' : next)}>
      <SelectTrigger className="h-6 w-20 text-[10px]" aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">—</SelectItem>
        {laneLabels.map((label) => (
          <SelectItem key={label} value={label}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <section className="border-b border-[var(--hd-border)]">
      <div className="flex items-center gap-2 px-3 pt-2">
        <CardTitle className="flex flex-1 items-center gap-2">
          <StopwatchIcon className="icon-sm text-[var(--hd-muted)]" aria-hidden="true" />
          Logic analyser
        </CardTitle>
        <span className="num text-xs text-[var(--hd-faint)]">{WINDOW_MS} ms</span>
        <Select value={decodeMode} onValueChange={(next) => selectMode(next as DecodeMode)}>
          <SelectTrigger className="h-6 w-24 text-xs" aria-label="Decode a bus">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No decode</SelectItem>
            <SelectItem value="spi">SPI</SelectItem>
            <SelectItem value="i2c">I²C</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => downloadText(toVcd(traces), 'noesis-capture.vcd', 'text/plain')}
          disabled={traces.length === 0}
          title="Save the capture as a VCD file, which PulseView reads"
          aria-label="Save the capture as VCD"
        >
          <DownloadIcon className="icon-sm" aria-hidden="true" />
        </Button>
      </div>

      <div className="relative px-3">
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={Math.max(LANE_PX, capturing.length * LANE_PX) + decodeBand}
          className="w-full rounded-none border border-[var(--hd-border)] bg-[var(--hd-bg-deep)]"
          style={{ height: Math.max(LANE_PX, capturing.length * LANE_PX) + decodeBand }}
        />
        {capturing.length === 0 && (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center gap-1.5 px-3 text-center text-xs text-[var(--hd-faint)]">
            <Crosshair1Icon className="icon-sm shrink-0" aria-hidden="true" />
            Pick a pin below to capture its level.
          </p>
        )}
      </div>

      {decodeMode !== 'none' && (
        <div className="border-t border-[var(--hd-border)] px-3 py-2">
          <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {decodeMode === 'spi' ? (
              <>
                <span className="flex items-center gap-1 text-[10px] text-[var(--hd-faint)]">
                  SCK {laneSelect('SPI clock lane', spiSck, (v) => onDecode({ ...decode, spiSck: v }))}
                </span>
                <span className="flex items-center gap-1 text-[10px] text-[var(--hd-faint)]">
                  MOSI {laneSelect('SPI MOSI lane', spiMosi, (v) => onDecode({ ...decode, spiMosi: v }))}
                </span>
                <span className="flex items-center gap-1 text-[10px] text-[var(--hd-faint)]">
                  MISO {laneSelect('SPI MISO lane', spiMiso, (v) => onDecode({ ...decode, spiMiso: v }))}
                </span>
                <span className="flex items-center gap-1 text-[10px] text-[var(--hd-faint)]">
                  CS {laneSelect('SPI chip-select lane', spiCs, (v) => onDecode({ ...decode, spiCs: v }))}
                </span>
              </>
            ) : (
              <>
                <span className="flex items-center gap-1 text-[10px] text-[var(--hd-faint)]">
                  SDA {laneSelect('I²C data lane', i2cSda, (v) => onDecode({ ...decode, i2cSda: v }))}
                </span>
                <span className="flex items-center gap-1 text-[10px] text-[var(--hd-faint)]">
                  SCL {laneSelect('I²C clock lane', i2cScl, (v) => onDecode({ ...decode, i2cScl: v }))}
                </span>
              </>
            )}
          </div>
          <div className="num max-h-24 overflow-auto whitespace-pre-wrap rounded border border-[var(--hd-border)] bg-[var(--hd-bg-deep)] p-1.5 text-[10px] leading-4 text-[var(--hd-faint)]">
            {decodeEvents.length > 0
              ? decodeEvents.map(lineFor).join('\n')
              : decodeHint}
          </div>
        </div>
      )}

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
              className="h-6 px-2 text-xs"
              title={
                full ? `Capture is full: ${MAX_LANES} lanes is as many as stay readable` : undefined
              }
            >
              {pin.label}
            </Button>
          );
        })}
      </div>
    </section>
  );
}
