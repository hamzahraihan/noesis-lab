/**
 * Dense LU decomposition with partial pivoting.
 * Matches src/features/simulation/matrix.ts
 */

#include "solver.h"
#include <algorithm>
#include <cmath>
#include <cstring>

namespace solver {

/**
 * LUDecomposition - in-place LU factorisation with partial pivoting.
 *
 * The matrix is copied on entry so callers can keep stamping into the same
 * buffer across Newton iterations.
 */
struct LUDecomposition {
    double* lu;           // size * size
    int32_t* pivots;      // size
    int32_t n;
    bool singular;

    LUDecomposition(int32_t size, double* luBuffer, int32_t* pivotBuffer)
        : lu(luBuffer), pivots(pivotBuffer), n(size), singular(false) {}

    void factor(const double* matrix) {
        // Copy matrix to lu buffer
        std::memcpy(lu, matrix, static_cast<size_t>(n) * n * sizeof(double));

        for (int32_t i = 0; i < n; ++i) {
            pivots[i] = i;
        }

        for (int32_t k = 0; k < n; ++k) {
            // Partial pivoting: find largest pivot
            int32_t pivotRow = k;
            double maxVal = std::abs(lu[static_cast<size_t>(k) * n + k]);

            for (int32_t i = k + 1; i < n; ++i) {
                double candidate = std::abs(lu[static_cast<size_t>(i) * n + k]);
                if (candidate > maxVal) {
                    maxVal = candidate;
                    pivotRow = i;
                }
            }

            if (maxVal < 1e-300) {
                singular = true;
                continue;
            }

            if (pivotRow != k) {
                // Swap rows in LU
                for (int32_t j = 0; j < n; ++j) {
                    const size_t idx1 = static_cast<size_t>(k) * n + j;
                    const size_t idx2 = static_cast<size_t>(pivotRow) * n + j;
                    std::swap(lu[idx1], lu[idx2]);
                }
                // Swap pivots
                std::swap(pivots[k], pivots[pivotRow]);
            }

            const double pivot = lu[static_cast<size_t>(k) * n + k];
            for (int32_t i = k + 1; i < n; ++i) {
                const size_t ik = static_cast<size_t>(i) * n + k;
                const double factor = lu[ik] / pivot;
                lu[ik] = factor;
                if (factor == 0.0) continue;

                for (int32_t j = k + 1; j < n; ++j) {
                    const size_t ij = static_cast<size_t>(i) * n + j;
                    const size_t kj = static_cast<size_t>(k) * n + j;
                    lu[ij] -= factor * lu[kj];
                }
            }
        }
    }

    bool isSingular() const { return singular; }

    /**
     * Solve A x = b. Writes into `out` (must be pre-allocated size n).
     * Returns true on success, false if singular.
     */
    bool solve(const double* rhs, double* out) const {
        if (singular) return false;

        // Forward substitution with pivoting: x = P * b
        for (int32_t i = 0; i < n; ++i) {
            out[i] = rhs[pivots[i]];
        }

        // Forward substitution through L (unit diagonal)
        for (int32_t i = 1; i < n; ++i) {
            double sum = out[i];
            for (int32_t j = 0; j < i; ++j) {
                sum -= lu[static_cast<size_t>(i) * n + j] * out[j];
            }
            out[i] = sum;
        }

        // Back substitution through U
        for (int32_t i = n - 1; i >= 0; --i) {
            double sum = out[i];
            for (int32_t j = i + 1; j < n; ++j) {
                sum -= lu[static_cast<size_t>(i) * n + j] * out[j];
            }
            out[i] = sum / lu[static_cast<size_t>(i) * n + i];
        }

        return true;
    }
};

} // namespace solver