/**
 * Circuit elements - diode linearisation and element stamping helpers.
 * Matches src/features/simulation/elements.ts
 */

#include "solver.h"
#include <algorithm>
#include <cmath>
#include <vector>
#include <unordered_map>

namespace solver {

// Piecewise-linear curve point for diode characteristic.
struct CurvePoint {
    double volts;
    double amps;
};

using Curve = std::vector<CurvePoint>;

// Forward sample multipliers - spans three orders of magnitude either side
// of the datasheet point so the sub-threshold knee stays visually "off"
// and the high-current shoulder stays finite.
constexpr double FORWARD_SAMPLE_MULTIPLIERS[] = {
    1e-4, 3e-4, 1e-3, 3e-3, 0.01, 0.03, 0.1, 0.3, 1.0, 3.0
};
constexpr size_t FORWARD_SAMPLE_COUNT = sizeof(FORWARD_SAMPLE_MULTIPLIERS) / sizeof(FORWARD_SAMPLE_MULTIPLIERS[0]);

// Cache key for diode profiles - hash of profile fields.
// Since profiles are module-level constants in TS, we use a simple hash.
struct ProfileKey {
    uint64_t hash;

    bool operator==(const ProfileKey& other) const {
        return hash == other.hash;
    }
};

struct ProfileHash {
    size_t operator()(const ProfileKey& key) const noexcept {
        return static_cast<size_t>(key.hash);
    }
};

// Build the piecewise-linear transfer curve for a profile.
// Each forward point comes from solving the junction plus its series resistance
// together: V_terminal = n*Vt*ln(I/Is + 1) + I*Rs
// with Is calibrated so the curve lands exactly on the datasheet point.
static Curve buildCurve(const SolverDiodeProfile& profile) {
    const double thermalScale = profile.ideality * THERMAL_VOLTAGE;
    const double rs = profile.seriesOhms;

    // Calibrate saturation current so curve hits the datasheet point exactly.
    const double saturationAmps = profile.ratedAmps *
        std::exp(-(profile.forwardVolts - profile.ratedAmps * rs) / thermalScale);

    Curve points;
    points.reserve(3 + FORWARD_SAMPLE_COUNT + 2); // reverse + zero + forward + extras

    // Reverse breakdown region
    points.push_back({-(profile.breakdownVolts + 0.5), -profile.breakdownAmps});
    points.push_back({-profile.breakdownVolts, -profile.leakageAmps});
    points.push_back({0.0, 0.0});

    // Forward characteristic samples
    for (size_t i = 0; i < FORWARD_SAMPLE_COUNT; ++i) {
        const double amps = profile.ratedAmps * FORWARD_SAMPLE_MULTIPLIERS[i];
        const double junctionVolts = thermalScale * std::log1p(amps / saturationAmps);
        points.push_back({junctionVolts + amps * rs, amps});
    }

    return points;
}

// Simple hash for SolverDiodeProfile to use as cache key.
static uint64_t hashProfile(const SolverDiodeProfile& profile) {
    // Combine fields into a 64-bit hash
    uint64_t h = 1469598103934665603ull; // FNV offset basis
    auto mix = [&h](double v) {
        uint64_t bits = *reinterpret_cast<const uint64_t*>(&v);
        h ^= bits;
        h *= 1099511628211ull; // FNV prime
    };
    mix(profile.forwardVolts);
    mix(profile.ratedAmps);
    mix(profile.seriesOhms);
    mix(profile.ideality);
    mix(profile.leakageAmps);
    mix(profile.breakdownVolts);
    mix(profile.breakdownAmps);
    return h;
}

// Thread-local curve cache (Wasm is single-threaded).
static std::unordered_map<ProfileKey, Curve, ProfileHash> curveCache;

static const Curve& getCurve(const SolverDiodeProfile& profile) {
    const ProfileKey key{hashProfile(profile)};
    auto it = curveCache.find(key);
    if (it != curveCache.end()) {
        return it->second;
    }
    Curve curve = buildCurve(profile);
    auto [newIt, _] = curveCache.emplace(key, std::move(curve));
    return newIt->second;
}

// Linear interpolation between two curve points.
static inline void interpolate(const CurvePoint& lower, const CurvePoint& upper,
                               double voltage, double& outAmps, double& outSiemens) {
    const double siemens = (upper.amps - lower.amps) / (upper.volts - lower.volts);
    outAmps = lower.amps + siemens * (voltage - lower.volts);
    outSiemens = siemens;
}

/**
 * Current and dI/dV of the piecewise-linear junction at a given bias.
 * Matches TypeScript lineariseDiode().
 */
extern "C" void solver_linearise_diode(double voltageAcross,
                                        const SolverDiodeProfile* profile,
                                        double* outAmps,
                                        double* outSiemens) {
    const Curve& curve = getCurve(*profile);
    const size_t last = curve.size() - 1;

    if (voltageAcross <= curve[0].volts) {
        interpolate(curve[0], curve[1], voltageAcross, *outAmps, *outSiemens);
        return;
    }
    if (voltageAcross >= curve[last].volts) {
        interpolate(curve[last - 1], curve[last], voltageAcross, *outAmps, *outSiemens);
        return;
    }

    for (size_t i = 0; i < last; ++i) {
        if (voltageAcross >= curve[i].volts && voltageAcross <= curve[i + 1].volts) {
            interpolate(curve[i], curve[i + 1], voltageAcross, *outAmps, *outSiemens);
            return;
        }
    }

    // Should not reach here, but safe fallback
    *outAmps = 0.0;
    *outSiemens = 0.0;
}

} // namespace solver