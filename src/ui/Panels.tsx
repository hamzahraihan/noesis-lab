/**
 * Side panels: the parts palette, the inspector, the firmware editor and the
 * serial monitor.
 *
 * Each is deliberately plain. The bench is the thing worth looking at; these
 * panels are instruments, and an instrument that needs explaining is a bad one.
 */

import { useEffect, useRef } from 'react';
import type { PartDefinition } from '../sim/catalog';
import type { PartInstance } from '../sim/bench';
import { ledDefinition, potentiometerDefinition, resistorDefinition } from '../sim/passives';
import { DIODE_PROFILES } from '../sim/elements';
import { formatOhms, formatVolts } from './format';

// ---------------------------------------------------------------------------

export interface PaletteItem {
  readonly label: string;
  readonly make: () => PartDefinition;
}
/** What you can drop onto the bench. Boards themselves are placed as a pair. */
const PALETTE: readonly PaletteItem[] = [
  { label: '220 Ω resistor', make: () => resistorDefinition(220) },
  { label: '330 Ω resistor', make: () => resistorDefinition(330) },
  { label: '1 kΩ resistor', make: () => resistorDefinition(1000) },
  { label: '10 kΩ resistor', make: () => resistorDefinition(10_000) },
  { label: 'Red LED', make: () => ledDefinition(DIODE_PROFILES.red, 'Red') },
  { label: 'Green LED', make: () => ledDefinition(DIODE_PROFILES.green, 'Green') },
  { label: 'Blue LED', make: () => ledDefinition(DIODE_PROFILES.blue, 'Blue') },
  { label: '10 kΩ pot', make: () => potentiometerDefinition(10_000) },
];

export function PartPalette({ onPlace }: { onPlace: (definition: PartDefinition) => void }) {
  return (
    <section className="flex flex-col gap-1">
      <h2 className="px-3 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
        Parts
      </h2>
      {PALETTE.map((item) => (
        <button
          key={item.label}
          type="button"
          onClick={() => onPlace(item.make())}
          className="mx-2 rounded-md px-3 py-1.5 text-left text-sm text-slate-200 transition-colors hover:bg-slate-700"
        >
          {item.label}
        </button>
      ))}
    </section>
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
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          spellCheck={false}
          className="min-h-0 flex-1 resize-none bg-slate-950 p-3 font-mono text-xs leading-relaxed text-slate-200 outline-none"
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
