/**
 * Physical constants and unit helpers.
 *
 * The simulation runs entirely in SI base units (volt, ampere, ohm, farad,
 * second, metre). Engineering prefixes are a presentation concern and live in
 * `format.ts` -- keeping them out of the solver avoids unit-conversion bugs in
 * the physics, which is the one place they are expensive.
 */

/** Thermal voltage kT/q at 300 K, in volts. */
export const THERMAL_VOLTAGE = 0.025852;

/**
 * Internal gmin conductance, 1e-12 S = 1 TOhm. Ties every node to ground so
 * floating nets stay solvable without measurably perturbing a real circuit.
 */
export const GMIN = 1e-12;

/** Pull-up resistor value conventionally used for I2C on these boards. */
export const I2C_PULLUP_OHMS = 4700;

/** Copper resistivity at 20 degrees C, Ohm-metre. */
export const COPPER_RESISTIVITY = 1.68e-8;

/** Cross-sectional area in square millimetres for a given AWG conductor. */
export function awgAreaMm2(awg: number): number {
  // Standard AWG: diameter_mm = 0.127 * 92^((36 - AWG) / 39), area = pi/4 * d^2.
  const diameterMm = 0.127 * Math.pow(92, (36 - awg) / 39);
  return (Math.PI / 4) * diameterMm * diameterMm;
}

/**
 * Resistance of a length of AWG wire in ohms.
 *
 * Bench jumpers are deliberately kept in the netlist even though their
 * resistance is tiny. Voltage drops stay real, and a later "this rail is
 * shorted" fault report is grounded in an actual model rather than a
 * special case.
 */
export function wireResistanceOhms(awg: number, lengthMm: number): number {
  const lengthM = lengthMm / 1000;
  const areaM2 = awgAreaMm2(awg) * 1e-6;
  return (COPPER_RESISTIVITY * lengthM) / areaM2;
}
