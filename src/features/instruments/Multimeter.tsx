/**
 * Multimeter panel.
 *
 * Shows the reading, the mode and the range, and says plainly when the
 * measurement is not trustworthy. A meter that reports a confident number
 * while the circuit is telling it something else would be the worst outcome.
 */
import type { BoardPin } from '@/features/parts';
import { AMP_RANGES, OHM_RANGES, type MeterMode, type MeterReading } from '@/features/simulation';
import { formatAmps, formatOhms, formatVolts } from '@/utils';
import { ExclamationTriangleIcon, MixerHorizontalIcon } from '@radix-ui/react-icons';
import {
  Button,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components';

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
        <CardTitle className="flex flex-1 items-center gap-2">
          <MixerHorizontalIcon className="icon-sm text-slate-500" aria-hidden="true" />
          Multimeter
        </CardTitle>
        <div className="flex gap-0.5 rounded-none border border-slate-800 bg-slate-950 p-0.5">
          {(Object.keys(MODE_LABELS) as MeterMode[]).map((candidate) => (
            <Button
              key={candidate}
              type="button"
              onClick={() => onMode(candidate)}
              aria-pressed={mode === candidate}
              size="sm"
              variant={mode === candidate ? 'default' : 'secondary'}
              className={
                mode === candidate
                  ? 'h-6 px-1.5 text-[11px] !bg-amber-400 !text-slate-900'
                  : 'h-6 px-1.5 text-[11px]'
              }
              title={`Measure ${MODE_LABELS[candidate] === 'V' ? 'voltage' : MODE_LABELS[candidate] === 'A' ? 'current' : 'resistance'}`}
            >
              {MODE_LABELS[candidate]}
            </Button>
          ))}
        </div>
      </div>

      {/*
       * The meter is the one panel whose job is a single number, so it is the
       * one place a display face is warranted. It carries the unit inline and
       * goes amber when the reading is not to be trusted.
       */}
      <div
        className={`rounded-none border bg-slate-950 px-3 py-2 text-center ${
          reading.valid ? 'border-slate-800' : 'border-amber-900/60'
        }`}
      >
        <span className="num font-mono text-2xl leading-none text-slate-100">
          {reading.valid ? formatReading(reading) : '--'}
        </span>
      </div>

      {reading.note && (
        <p className="flex items-start gap-1.5 text-[11px] leading-snug text-amber-300">
          <ExclamationTriangleIcon className="icon-sm mt-px shrink-0" aria-hidden="true" />
          {reading.note}
        </p>
      )}

      {ranges.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-500">Range</span>
          <Select value={rangeId} onValueChange={onRange}>
            <SelectTrigger className="h-6 flex-1 text-[11px]" aria-label="Meter range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ranges.map((range) => (
                <SelectItem key={range.id} value={range.id}>
                  {range.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <p className="text-[11px] text-slate-500">
        <span className="text-red-400">+</span> {redLabel}
        <span className="mx-1 text-slate-600">/</span>
        <span className="text-slate-300">−</span> {blackLabel}
      </p>
      <div className="flex items-center gap-1 text-[11px]">
        <Select
          value={redPinId ?? 'none'}
          onValueChange={(next) => onRedPin(next === 'none' ? null : next)}
        >
          <SelectTrigger className="h-6 min-w-0 flex-1 text-[11px]" aria-label="Red probe pin">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">+ not clipped</SelectItem>
            {pins.map((pin) => (
              <SelectItem key={pin.id} value={pin.id}>
                {pin.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={blackPinId ?? 'none'}
          onValueChange={(next) => onBlackPin(next === 'none' ? null : next)}
        >
          <SelectTrigger className="h-6 min-w-0 flex-1 text-[11px]" aria-label="Black probe pin">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">− ground</SelectItem>
            {pins.map((pin) => (
              <SelectItem key={pin.id} value={pin.id}>
                {pin.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {mode === 'amps' && (
        <p className="flex items-start gap-1.5 text-[11px] leading-snug text-slate-600">
          <ExclamationTriangleIcon className="icon-sm mt-px shrink-0" aria-hidden="true" />
          In series only. Across a rail this is a short circuit.
        </p>
      )}
      {mode === 'ohms' && (
        <p className="flex items-start gap-1.5 text-[11px] leading-snug text-slate-600">
          <ExclamationTriangleIcon className="icon-sm mt-px shrink-0" aria-hidden="true" />
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
