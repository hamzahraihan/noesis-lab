/**
 * Bus monitor panel.
 *
 * A logic analyser shows the pins; this shows what went *over* them. Every I2C
 * and SPI transfer the sketch made is listed with its address, its bytes and
 * whether anything answered -- which is the fastest way to see the mistake where
 * a device was wired to the wrong pins and the writes are going nowhere.
 */

import { memo, useEffect, useRef } from 'react';
import type { BusEntry } from '@/features/simulation';
import { EraserIcon, SewingPinIcon } from '@radix-ui/react-icons';
import { Button, CardTitle } from '@/components';

/** How many bytes one line shows before it elides the rest. */
const BYTES_PER_LINE = 8;

/**
 * How many transfers reach the DOM. The full log stays in state (and clears
 * from the header action); the list pins to the newest entry anyway.
 */
const VISIBLE_ENTRIES = 50;

export interface BusMonitorProps {
  entries: readonly BusEntry[];
  onClear(): void;
}

/**
 * The bus log, memoised like the serial monitor: entries keep their identity
 * until a transfer lands, so idle frames skip 200 rows of diodes and spans.
 */
export const BusMonitor = memo(function BusMonitor({ entries, onClear }: BusMonitorProps) {
  const listRef = useRef<HTMLUListElement>(null);

  // Follows the newest transfer, the way a terminal does. Pinned to the bottom
  // only while the operator is already there: scrolling back to read something
  // should not be undone by the next frame.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 24;
    if (atBottom) list.scrollTop = list.scrollHeight;
  }, [entries]);

  return (
    <section className="border-b border-[var(--hd-border)]">
      <div className="flex items-center gap-2 px-3 py-2">
        <CardTitle className="flex flex-1 items-center gap-2">
          <SewingPinIcon className="icon-sm text-[var(--hd-muted)]" aria-hidden="true" />
          Bus monitor
        </CardTitle>
        <Button
          type="button"
          onClick={onClear}
          variant="secondary"
          size="icon-sm"
          title="Clear the log"
          aria-label="Clear the bus log"
        >
          <EraserIcon className="icon" aria-hidden="true" />
        </Button>
      </div>

      <ul
        ref={listRef}
        className="max-h-48 overflow-y-auto px-3 pb-3 font-mono text-xs leading-relaxed"
      >
        {entries.length === 0 ? (
          <li className="font-sans text-[var(--hd-faint)]">
            Nothing yet. Wire.beginTransmission and SPI.transfer land here as the sketch makes them.
          </li>
        ) : (
          entries.slice(-VISIBLE_ENTRIES).map((entry, index) => (
            <li key={`${entry.timeMs}-${index}`} className="flex gap-2 whitespace-pre">
              <span className="num shrink-0 text-[var(--hd-faint)]">{formatTime(entry.timeMs)}</span>
              <span
                className={
                  entry.bus === 'i2c' ? 'shrink-0 text-[var(--hd-warn)]' : 'shrink-0 text-[var(--hd-accent)]'
                }
              >
                {entry.bus === 'i2c' ? 'I2C' : 'SPI'}
              </span>
              {entry.address !== null && (
                <span className="shrink-0 text-[var(--hd-muted)]">
                  0x{entry.address.toString(16).padStart(2, '0')}
                </span>
              )}
              <span className="truncate text-[var(--hd-text)]">{formatBytes(entry.bytes)}</span>
              <span
                className={
                  entry.acknowledged ? 'shrink-0 text-emerald-500' : 'shrink-0 text-rose-500'
                }
              >
                {entry.acknowledged ? 'ACK' : 'NACK'}
              </span>
              <span className="num shrink-0 text-[var(--hd-faint)]">{formatMicros(entry.micros)}</span>
            </li>
          ))
        )}
      </ul>
    </section>
  );
});

/** Bytes as hex, elided once a transfer is longer than one screenful. */
function formatBytes(bytes: readonly number[]): string {
  if (bytes.length === 0) return '--';
  const shown = bytes.slice(0, BYTES_PER_LINE).map((byte) => byte.toString(16).padStart(2, '0'));
  return (
    shown.join(' ') + (bytes.length > BYTES_PER_LINE ? ` +${bytes.length - BYTES_PER_LINE}` : '')
  );
}

/** Simulated milliseconds, which grow without bound, so they are trimmed. */
function formatTime(timeMs: number): string {
  return `${(timeMs / 1000).toFixed(2).padStart(6, '0')}s`;
}

/** Bus time, which is microseconds and rarely more than a millisecond. */
function formatMicros(micros: number): string {
  return micros >= 1000 ? `${(micros / 1000).toFixed(2)}ms` : `${micros.toFixed(0)}us`;
}
