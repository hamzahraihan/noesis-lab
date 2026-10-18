/**
 * Engineering-notation formatting for instrument readouts.
 *
 * The simulation works in SI base units; nobody wants to read 0.0000042 A on a
 * multimeter. Everything a user sees goes through here so prefix handling stays
 * in one place and rounding never disagrees between the inspector, the
 * multimeter and the serial plotter.
 */

interface Prefix {
  readonly symbol: string;
  readonly factor: number;
}

const PREFIXES: readonly Prefix[] = [
  { symbol: 'p', factor: 1e-12 },
  { symbol: 'n', factor: 1e-9 },
  { symbol: 'µ', factor: 1e-6 },
  { symbol: 'm', factor: 1e-3 },
  { symbol: '', factor: 1 },
  { symbol: 'k', factor: 1e3 },
  { symbol: 'M', factor: 1e6 },
  { symbol: 'G', factor: 1e9 },
];

/** Largest prefix that leaves the scaled value at or above 1. */
function prefixFor(magnitude: number): Prefix {
  let chosen: Prefix = PREFIXES[PREFIXES.length - 1];
  for (const candidate of PREFIXES) {
    if (magnitude / candidate.factor >= 1) chosen = candidate;
  }
  return chosen;
}

/** Formats with an engineering prefix, keeping `significantDigits` of them. */
export function withPrefix(value: number, unit: string, significantDigits = 3): string {
  if (!Number.isFinite(value)) return `${value > 0 ? '+∞' : '-∞'} ${unit}`;
  if (value === 0) return `0 ${unit}`;

  const prefix = prefixFor(Math.abs(value));
  const scaled = value / prefix.factor;
  const decimals = Math.max(
    0,
    Math.min(significantDigits - 1 - Math.floor(Math.log10(Math.abs(scaled))), 3),
  );
  return `${trimZeros(scaled.toFixed(decimals))} ${prefix.symbol}${unit}`;
}

export function formatVolts(value: number, decimals?: number): string {
  if (decimals !== undefined) return `${value.toFixed(decimals)} V`;
  if (Math.abs(value) < 1e-4) return '0 V';
  return withPrefix(value, 'V');
}

export function formatAmps(value: number): string {
  return withPrefix(value, 'A');
}

export function formatOhms(value: number): string {
  if (value >= 1e6) return `${trimZeros((value / 1e6).toFixed(2))} MΩ`;
  if (value >= 1e3) return `${trimZeros((value / 1e3).toFixed(2))} kΩ`;
  return `${trimZeros(value.toFixed(1))} Ω`;
}

export function formatFarads(value: number): string {
  if (value >= 1e-3) return `${trimZeros((value * 1e3).toFixed(0))} mF`;
  if (value >= 1e-6) return `${trimZeros((value * 1e6).toFixed(0))} µF`;
  if (value >= 1e-9) return `${trimZeros((value * 1e9).toFixed(0))} nF`;
  return `${trimZeros((value * 1e12).toFixed(0))} pF`;
}

/** Millimetres, the bench's world unit, for distances shown in the UI. */
export function formatMm(value: number): string {
  return `${trimZeros(value.toFixed(1))} mm`;
}

function trimZeros(text: string): string {
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}
