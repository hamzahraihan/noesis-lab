/**
 *
 * Side panels: the parts palette, the inspector, the firmware editor and the
 * serial monitor.
 *
 * Each is deliberately plain. The bench is the thing worth looking at; these
 * panels are instruments, and an instrument that needs explaining is a bad one.
 */

import Editor from '@monaco-editor/react';
import { FIRMWARE_LANGUAGE, FIRMWARE_THEME } from './monaco-setup';
import { useEffect, useMemo, useRef } from 'react';
import type { PartDefinition } from '../sim/catalog';
import type { PartInstance } from '../sim/bench';
import { PART_CATALOGUE, type CatalogueEntry } from '../sim/catalogue';
import { PartPreview } from './PartPreview';
import { formatOhms, formatVolts } from './format';

// ---------------------------------------------------------------------------

/**
 * The parts you reach for every time, drawn from the shared catalogue.
 *
 * This is deliberately a short list. The browser behind the header button has
 * everything; a palette that listed all of it would just be a worse browser.
 */
const QUICK_PARTS: readonly string[] = [
  'resistor-220',
  'resistor-10000',
  'led-red',
  'led-green',
  'potentiometer-10000',
  'button-tactile',
];

export function PartPalette({
  onPlace,
  onBrowse,
}: {
  onPlace: (definition: PartDefinition, entry: CatalogueEntry) => void;
  onBrowse(): void;
}) {
  const quick = useMemo(
    () =>
      QUICK_PARTS.map((id) => PART_CATALOGUE.find((entry) => entry.id === id)).filter(
        (entry): entry is CatalogueEntry => entry !== undefined,
      ),
    [],
  );

  return (
    <section className="flex flex-col gap-1">
      <h2 className="px-3 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
        Quick parts
      </h2>
      {quick.map((entry) => (
        <PaletteRow key={entry.id} entry={entry} onPlace={onPlace} />
      ))}
      <button
        type="button"
        onClick={onBrowse}
        className="mx-2 mt-2 rounded-md border border-slate-700 px-3 py-1.5 text-left text-sm text-slate-300 transition-colors hover:border-sky-600 hover:text-sky-300"
      >
        Browse all components…
      </button>
    </section>
  );
}

function PaletteRow({
  entry,
  onPlace,
}: {
  entry: CatalogueEntry;
  onPlace: (definition: PartDefinition, entry: CatalogueEntry) => void;
}) {
  const definition = useMemo(() => entry.make(), [entry]);
  return (
    <button
      type="button"
      onClick={() => onPlace(definition, entry)}
      className="mx-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-slate-200 transition-colors hover:bg-slate-700"
    >
      <PartPreview definition={definition} className="h-7 w-9 shrink-0" />
      <span className="truncate">{entry.name}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------


export interface InspectorProps {
  part: PartInstance | null;
  pinVoltages: ReadonlyMap<string, number>;
  pressed: boolean;
  potPosition: number;
  onDelete(): void;
  onTogglePressed(pressed: boolean): void;
  onSetPot(fraction: number): void;
}

export function Inspector({
  part,
  pinVoltages,
  pressed,
  potPosition,
  onDelete,
  onTogglePressed,
  onSetPot,
}: InspectorProps) {
  if (!part) {
    return (
      <div className="p-4 text-sm text-slate-400">
        Select a part to inspect it, or turn on the wire tool and click two holes.
      </div>
    );
  }

  const { definition } = part;
  const isButton = definition.component.kind === 'button';
  const isPot = definition.component.kind === 'potentiometer';
  // Only pins that carry a silkscreen label are worth a voltage readout; a
  // resistor's two leads would otherwise render an empty section header.
  const labelledPins = definition.pins.filter((pin) => pin.label !== '').slice(0, 32);

  return (
    <div className="flex flex-col gap-3 p-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-100">{definition.name}</h2>
        <p className="text-xs text-slate-500">{definition.id}</p>
      </div>

      <dl className="flex flex-col gap-1 text-xs">
        <Row label="Pins" value={String(definition.pins.length)} />
        <Row label="Footprint" value={`${definition.widthMm} × ${definition.heightMm} mm`} />
        {definition.component.kind === 'resistor' && (
          <Row label="Resistance" value={formatOhms(definition.component.ohms)} />
        )}
        {definition.component.kind === 'led' && (
          <Row label="Forward voltage" value={`${definition.component.profile.forwardVolts} V`} />
        )}
      </dl>

      {labelledPins.length > 0 && (
        <div>
          <h3 className="mb-1 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
            Pin voltages
          </h3>
          <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
            {labelledPins.map((pin) => (
              <li key={pin.id} className="flex justify-between gap-2">
                <span className="truncate text-slate-500">{pin.label}</span>
                <span className="tabular-nums text-slate-200">
                  {formatVolts(pinVoltages.get(`${part.id}:${pin.id}`) ?? 0)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {isButton && (
        <button
          type="button"
          onMouseDown={() => onTogglePressed(true)}
          onMouseUp={() => onTogglePressed(false)}
          onMouseLeave={() => onTogglePressed(false)}
          className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
            pressed
              ? 'bg-amber-400 text-slate-900'
              : 'bg-slate-700 text-slate-100 hover:bg-slate-600'
          }`}
        >
          {pressed ? 'Pressed' : 'Press and hold'}
        </button>
      )}

      {isPot && (
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Wiper {Math.round(potPosition * 100)}%
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={potPosition}
            onChange={(event) => onSetPot(Number(event.target.value))}
            className="w-full accent-sky-400"
          />
        </label>
      )}

      <button
        type="button"
        onClick={onDelete}
        className="mt-2 rounded-md border border-red-900 px-3 py-1.5 text-sm text-red-300 transition-colors hover:bg-red-950"
      >
        Remove part
      </button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-200 tabular-nums">{value}</dd>
    </div>
  );
}

export function SerialMonitor({ lines }: { lines: readonly string[] }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [lines]);

  return (
    <div className="flex h-full flex-col">
      <h3 className="border-b border-slate-800 px-3 py-1.5 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
        Serial Monitor
      </h3>
      <div className="flex-1 overflow-y-auto px-3 py-2 font-mono text-xs whitespace-pre-wrap text-emerald-300">
        {lines.length === 0 ? (
          <span className="text-slate-600">no output yet</span>
        ) : (
          // Serial.print fragments concatenate; only println breaks the line,
          // so the stream is joined before rendering rather than split per write.
          lines.join('')
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function FirmwareEditor({
  value,
  error,
  expanded,
  onToggle,
  onChange,
  onRun,
  onReset,
  running,
}: {
  value: string;
  error: string | null;
  /** Whether the editor body is showing under its header. */
  expanded: boolean;
  onToggle(): void;
  onChange(next: string): void;
  onRun(): void;
  onReset(): void;
  running: boolean;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-slate-800 px-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-slate-400 uppercase transition-colors hover:text-slate-200"
        >
          <span
            aria-hidden="true"
            className={`text-slate-500 transition-transform ${expanded ? 'rotate-90' : ''}`}
          >
            &#9656;
          </span>
          Firmware
        </button>
        <span className="flex-1" />
        <button
          type="button"
          onClick={running ? onReset : onRun}
          className="rounded bg-sky-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-sky-500"
        >
          {running ? 'Reset' : 'Run'}
        </button>
      </div>

      {expanded && (
        <Editor
          height="100%"
          language={FIRMWARE_LANGUAGE}
          theme={FIRMWARE_THEME}
          value={value}
          onChange={(next) => onChange(next ?? '')}
          options={{
            minimap: { enabled: false },
            fontSize: 12,
            lineHeight: 19,
            fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
            scrollBeyondLastLine: false,
            smoothScrolling: true,
            cursorBlinking: 'smooth',
            padding: { top: 10, bottom: 10 },
            renderLineHighlight: 'none',
            automaticLayout: true,
            tabSize: 2,
            wordWrap: 'off',
          }}
        />
      )}

      {error && (
        <p className="shrink-0 border-t border-red-900 bg-red-950 px-3 py-1.5 text-xs text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function StatusBar({
  timeMs,
  running,
  netCount,
}: {
  timeMs: number;
  running: boolean;
  netCount: number;
}) {
  return (
    <footer className="flex items-center gap-4 border-t border-slate-800 bg-slate-900 px-4 py-1.5 text-xs text-slate-400">
      <span
        className={`inline-block size-2 rounded-full ${running ? 'bg-emerald-400' : 'bg-slate-600'}`}
      />
      <span>{running ? 'Running' : 'Stopped'}</span>
      <span className="tabular-nums">t = {timeMs.toFixed(0)} ms</span>
      <span className="tabular-nums">{netCount} nets</span>
      <span className="ml-auto text-slate-600">
        Drag to move · wheel to zoom · shift-drag to pan
      </span>
    </footer>
  );
}
