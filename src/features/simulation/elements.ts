/**
 * Circuit elements in the SPICE netlist vocabulary.
 *
 * Nets are plain integers; `GROUND` is the sentinel for the 0 V reference and is
 * never given a matrix row.
 */

import { THERMAL_VOLTAGE } from './units';

export const GROUND = -1;

export interface Resistor {
  readonly kind: 'resistor';
  readonly a: number;
  readonly b: number;
  readonly ohms: number;
  readonly label?: string;
}

export interface VoltageSource {
  readonly kind: 'voltageSource';
  readonly a: number;
  readonly b: number;
  readonly volts: number;
  readonly label?: string;
}

export interface CurrentSource {
  readonly kind: 'currentSource';
  /** Positive current is injected into `a` and drawn from `b`. */
  readonly a: number;
  readonly b: number;
  readonly amps: number;
  readonly label?: string;
}

export interface Capacitor {
  readonly kind: 'capacitor';
  readonly a: number;
  readonly b: number;
  readonly farads: number;
  readonly label?: string;
}

export interface Diode {
  readonly kind: 'diode';
  readonly a: number;
  readonly b: number;
  readonly profile: DiodeProfile;
  readonly label?: string;
}

export interface GroundElement {
  readonly kind: 'ground';
  readonly node: number;
}

export type Element = Resistor | VoltageSource | CurrentSource | Capacitor | Diode | GroundElement;

/**
 * Datasheet parameters for a junction.
 *
 * Describing the part by forward voltage and rated current -- the two numbers a
 * real LED datasheet leads with -- keeps the model honest: the generated curve
 * passes through that exact point rather than merely near it.
 */
export interface DiodeProfile {
  readonly forwardVolts: number;
  readonly ratedAmps: number;
  /** Bulk and lead resistance, ohms. Sets the slope at high forward current. */
  readonly seriesOhms: number;
  /** Ideality factor n; ~1 for silicon, ~2 for an LED. */
  readonly ideality: number;
  readonly leakageAmps: number;
  readonly breakdownVolts: number;
  readonly breakdownAmps: number;
}

interface CurvePoint {
  readonly volts: number;
  readonly amps: number;
}

/**
 * Current samples across the forward characteristic, as multiples of the rated
 * current. Spans three orders of magnitude either side of the datasheet point so
 * the sub-threshold knee stays visually "off" and the high-current shoulder
 * stays finite.
 */
const FORWARD_SAMPLE_MULTIPLIERS = [1e-4, 3e-4, 1e-3, 3e-3, 0.01, 0.03, 0.1, 0.3, 1, 3];

/**
 * Builds the piecewise-linear transfer curve for a profile.
 *
 * Each forward point comes from solving the junction plus its series resistance
 * together -- V_terminal = n*Vt*ln(I/Is + 1) + I*Rs -- with Is calibrated so the
 * curve lands exactly on the datasheet point. Sampling that onto straight
 * segments keeps the exponential's shape while giving Newton a linear element
 * to converge on, which is the whole reason an exponential model was unusable
 * here: its tangent line goes negative below the knee and makes the linearised
 * circuit unstable.
 *
 * Reverse points are hand-placed: flat leakage up to breakdown, then a steep
 * knee, so an LED driven backwards visibly dies instead of quietly blocking.
 */
function buildCurve(profile: DiodeProfile): CurvePoint[] {
  const thermalScale = profile.ideality * THERMAL_VOLTAGE;
  const { seriesOhms: rs } = profile;
  const saturationAmps =
    profile.ratedAmps * Math.exp(-(profile.forwardVolts - profile.ratedAmps * rs) / thermalScale);

  const points: CurvePoint[] = [
    { volts: -(profile.breakdownVolts + 0.5), amps: -profile.breakdownAmps },
    { volts: -profile.breakdownVolts, amps: -profile.leakageAmps },
    { volts: 0, amps: 0 },
  ];

  for (const multiplier of FORWARD_SAMPLE_MULTIPLIERS) {
    const amps = profile.ratedAmps * multiplier;
    const junctionVolts = thermalScale * Math.log1p(amps / saturationAmps);
    points.push({ volts: junctionVolts + amps * rs, amps });
  }

  return points;
}

// Keyed by profile object identity: the catalogue hands out a fixed set of
// module-level constants, so this fills once and never grows.
const curveCache = new Map<DiodeProfile, readonly CurvePoint[]>();

function curveFor(profile: DiodeProfile): readonly CurvePoint[] {
  const cached = curveCache.get(profile);
  if (cached) return cached;
  const built = buildCurve(profile);
  curveCache.set(profile, built);
  return built;
}

/**
 * Current and dI/dV of the piecewise-linear junction at a given bias.
 *
 * The slope returned is that of whichever segment the bias lands in, which is
 * what Newton needs; because the curve is continuous, the linearisation meets
 * the true characteristic exactly at the bias point.
 */
export function lineariseDiode(
  voltageAcross: number,
  profile: DiodeProfile,
): { amps: number; siemens: number } {
  const curve = curveFor(profile);
  const last = curve.length - 1;

  const segment = (lower: CurvePoint, upper: CurvePoint) => {
    const siemens = (upper.amps - lower.amps) / (upper.volts - lower.volts);
    return { amps: lower.amps + siemens * (voltageAcross - lower.volts), siemens };
  };

  if (voltageAcross <= curve[0].volts) return segment(curve[0], curve[1]);
  if (voltageAcross >= curve[last].volts) return segment(curve[last - 1], curve[last]);

  for (let i = 0; i < last; i++) {
    if (voltageAcross >= curve[i].volts && voltageAcross <= curve[i + 1].volts) {
      return segment(curve[i], curve[i + 1]);
    }
  }

  return { amps: 0, siemens: 0 };
}
