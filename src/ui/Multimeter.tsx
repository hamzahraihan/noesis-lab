/**
 * Multimeter panel.
 *
 * Shows the reading, the mode and the range, and says plainly when the
 * measurement is not trustworthy. A meter that reports a confident number
 * while the circuit is telling it something else would be the worst outcome.
 */
import type { BoardPin } from '../sim/catalog';
import { AMP_RANGES, OHM_RANGES, type MeterMode, type MeterReading } from '../sim/multimeter';
import { formatAmps, formatOhms, formatVolts } from './format';

export interface MultimeterPanelProps {
  mode: MeterMode;
  reading: MeterReading;
  onMode(mode: MeterMode): void;
  redLabel: string;
  blackLabel: string;
  pins: readonly BoardPin[];
  redPinId: string | null;
  blackPinId: string | null;
  onRedPin(pinId: string | null): void;
  onBlackPin(pinId: string | null): void;
  /** Id of the range currently selected for this mode. */
  rangeId: string;
  onRange(rangeId: string): void;
}

const MODE_LABELS: Readonly<Record<MeterMode, string>> = {
  volts: 'V',
  amps: 'A',
  ohms: 'Ω',
};

export function MultimeterPanel({
  mode,
  reading,
  redLabel,
  blackLabel,
  pins,
  redPinId,
  blackPinId,
  onRedPin,
  onBlackPin,
  onMode,
  onRange,
  rangeId,
}: MultimeterPanelProps) {
  const ranges = mode === 'amps' ? AMP_RANGES : mode === 'ohms' ? OHM_RANGES : [];

  return (
    <div className="flex flex-col gap-2 border-t border-slate-800 p-3">
      <div className="flex items-center gap-2">
        <h3 className="flex-1 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
          Multimeter
        </h3>
        <div className="flex gap-1">
          {(Object.keys(MODE_LABELS) as MeterMode[]).map((candidate) => (
            <button
              key={candidate}
              type="button"
              onClick={() => onMode(candidate)}
              className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
                mode === candidate
                  ? 'bg-amber-400 text-slate-900'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {MODE_LABELS[candidate]}
            </button>
          ))}

        </div>
      </div>

      <div className="rounded bg-slate-950 px-3 py-2 text-center font-mono text-2xl tabular-nums">
        {reading.valid ? formatReading(reading) : '--'}
      </div>

      {reading.note && (
        <p className="text-[11px] text-amber-300">{reading.note}</p>
      )}

      {ranges.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-500">Range</span>
          <select
            value={rangeId}
            onChange={(event) => onRange(event.target.value)}
            className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-200"
          >
            {ranges.map((range) => (
              <option key={range.id} value={range.id}>
                {range.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <p className="text-[11px] text-slate-500">
        <span className="text-red-400">+</span> {redLabel}
        <span className="mx-1 text-slate-600">/</span>
        <span className="text-slate-300">−</span> {blackLabel}
      </p>
      <div className="flex items-center gap-1 text-[11px]">
        <select
          value={redPinId ?? ''}
          onChange={(event) => onRedPin(event.target.value || null)}
          className="min-w-0 flex-1 rounded bg-slate-800 px-1 py-0.5 text-slate-200"
        >
          <option value="">+ not clipped</option>
          {pins.map((pin) => (
            <option key={pin.id} value={pin.id}>{pin.label}</option>
          ))}
        </select>
        <select
          value={blackPinId ?? ''}
          onChange={(event) => onBlackPin(event.target.value || null)}
          className="min-w-0 flex-1 rounded bg-slate-800 px-1 py-0.5 text-slate-200"
        >
          <option value="">− ground</option>
          {pins.map((pin) => (
            <option key={pin.id} value={pin.id}>{pin.label}</option>
          ))}
        </select>
      </div>

      {mode === 'amps' && (
        <p className="text-[11px] text-slate-600">
          In series only. Across a rail this is a short circuit.
        </p>
      )}
      {mode === 'ohms' && (
        <p className="text-[11px] text-slate-600">
          Power the circuit down first, or the reading is meaningless.
        </p>
      )}
    </div>
  );
}
function formatReading(reading: MeterReading): string {
  if (reading.unit === 'V') return formatVolts(reading.value, 3);
  if (reading.unit === 'A') return formatAmps(reading.value);
  return formatOhms(reading.value);
}