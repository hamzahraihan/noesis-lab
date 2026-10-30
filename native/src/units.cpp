/**
 * Physical constants and unit helpers.
 * Matches src/features/simulation/units.ts
 */

#include "solver.h"
#include <cmath>

namespace solver {

// Thermal voltage kT/q at 300 K, in volts.
constexpr double THERMAL_VOLTAGE = 0.025852;

// Internal gmin conductance, 1e-12 S = 1 TOhm.
constexpr double GMIN = 1e-12;

// Copper resistivity at 20 degrees C, Ohm-metre.
constexpr double COPPER_RESISTIVITY = 1.68e-8;

// Cross-sectional area in square millimetres for a given AWG conductor.
inline double awgAreaMm2(int awg) {
    // Standard AWG: diameter_mm = 0.127 * 92^((36 - AWG) / 39), area = pi/4 * d^2.
    const double diameterMm = 0.127 * std::pow(92.0, (36.0 - awg) / 39.0);
    return (M_PI / 4.0) * diameterMm * diameterMm;
}

// Resistance of a length of AWG wire in ohms.
inline double wireResistanceOhms(int awg, double lengthMm) {
    const double lengthM = lengthMm / 1000.0;
    const double areaM2 = awgAreaMm2(awg) * 1e-6;
    return (COPPER_RESISTIVITY * lengthM) / areaM2;
}

} // namespace solver