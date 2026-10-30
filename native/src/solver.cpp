/**
 * Modified Nodal Analysis solver with Newton-Raphson for nonlinear junctions.
 * Matches src/features/simulation/circuit.ts
 */

#include "solver.h"
#include "lu.cpp"
#include "units.cpp"
#include "elements.cpp"
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <unordered_map>
#include <vector>

namespace solver {

// Junction limit step - how far a junction's linearisation point may move per iteration.
// Matches JUNCTION_LIMIT_STEP_VOLTS = 3.5 in TS.
constexpr double JUNCTION_LIMIT_STEP_VOLTS = 3.5;

// Grow-only shared solve buffers. Sizes only ever grow to the largest bench seen.
struct SolveScratch {
    int32_t size = 0;
    std::vector<double> matrix;     // size * size
    std::vector<double> rhs;        // size
    std::vector<double> working;    // size
    std::vector<double> solved;     // size
    std::vector<double> lu;         // size * size
    std::vector<int32_t> pivots;    // size
    std::vector<double> prevStep;   // nodeCount

    void ensureSize(int32_t newSize) {
        if (size >= newSize) return;
        size = newSize;
        matrix.resize(static_cast<size_t>(size) * size);
        rhs.resize(size);
        working.resize(size);
        solved.resize(size);
        lu.resize(static_cast<size_t>(size) * size);
        pivots.resize(size);
    }

    void ensurePrevStep(int32_t nodeCount) {
        if (static_cast<int32_t>(prevStep.size()) >= nodeCount) return;
        prevStep.resize(nodeCount);
    }
};

// Thread-local scratch buffer (Wasm is single-threaded).
static SolveScratch g_scratch;

// Bias voltage across a diode element from working voltages.
static inline double junctionBias(const SolverElement& element, const double* working) {
    const double va = (element.a >= 0) ? working[element.a] : 0.0;
    const double vb = (element.b >= 0) ? working[element.b] : 0.0;
    return va - vb;
}

// Stamp conductance between two nets; ground contributes no row.
static inline void stampConductance(double* matrix, int32_t size, int32_t a, int32_t b, double siemens) {
    if (a >= 0) matrix[static_cast<size_t>(a) * size + a] += siemens;
    if (b >= 0) matrix[static_cast<size_t>(b) * size + b] += siemens;
    if (a >= 0 && b >= 0) {
        matrix[static_cast<size_t>(a) * size + b] -= siemens;
        matrix[static_cast<size_t>(b) * size + a] -= siemens;
    }
}

// Inject current into net a and draw from net b.
static inline void stampCurrentSource(double* rhs, int32_t a, int32_t b, double amps) {
    if (a >= 0) rhs[a] += amps;
    if (b >= 0) rhs[b] -= amps;
}

// Stamp a fixed voltage source. Branch current is unknown at row.
static inline void stampVoltageSource(double* matrix, double* rhs, int32_t size,
                                       int32_t a, int32_t b, int32_t row, double volts) {
    if (a >= 0) matrix[static_cast<size_t>(a) * size + row] += 1.0;
    if (b >= 0) matrix[static_cast<size_t>(b) * size + row] -= 1.0;
    if (a >= 0) matrix[static_cast<size_t>(row) * size + a] += 1.0;
    if (b >= 0) matrix[static_cast<size_t>(row) * size + b] -= 1.0;
    rhs[row] += volts;
}

} // namespace solver

// C API implementation

extern "C" SolverError solver_solve(
    const SolverElement* elements,
    int32_t elementCount,
    const SolverOptions* options,
    SolverSolution* outSolution
) {
    using namespace solver;

    if (!elements || elementCount <= 0 || !options || !outSolution) {
        return SOLVER_ERROR_INVALID_INPUT;
    }

    const int32_t nodeCount = options->nodeCount;
    if (nodeCount < 0) return SOLVER_ERROR_INVALID_INPUT;

    const int32_t maxIterations = (options->maxIterations > 0) ? options->maxIterations : 100;
    const double tolerance = (options->tolerance > 0) ? options->tolerance : 1e-7;
    const double dt = (options->dtSeconds > 0) ? options->dtSeconds : 1e-4;

    // Count voltage sources to determine matrix size
    int32_t sourceCount = 0;
    for (int32_t i = 0; i < elementCount; ++i) {
        if (elements[i].kind == SOLVER_ELEMENT_VOLTAGE_SOURCE) {
            ++sourceCount;
        }
    }

    const int32_t size = nodeCount + sourceCount;
    g_scratch.ensureSize(size);
    g_scratch.ensurePrevStep(nodeCount);

    // Map voltage source elements to their branch row indices
    std::vector<int32_t> sourceRows(elementCount, -1);
    int32_t srcIdx = 0;
    for (int32_t i = 0; i < elementCount; ++i) {
        if (elements[i].kind == SOLVER_ELEMENT_VOLTAGE_SOURCE) {
            sourceRows[i] = nodeCount + srcIdx;
            ++srcIdx;
        }
    }

    // Previous step voltages (for capacitor companion models)
    const double* previousStep = options->previousVoltages ? options->previousVoltages : g_scratch.prevStep.data();
    if (!options->previousVoltages) {
        std::fill(g_scratch.prevStep.begin(), g_scratch.prevStep.begin() + nodeCount, 0.0);
    }

    // Working voltages (size = nodeCount + sourceCount)
    std::fill(g_scratch.working.begin(), g_scratch.working.begin() + size, 0.0);
    if (options->previousVoltages) {
        std::copy(options->previousVoltages, options->previousVoltages + nodeCount, g_scratch.working.begin());
    }

    // Per-junction clamp limits, carried across Newton iterations.
    // Use a simple array indexed by element index for diodes.
    std::vector<double> junctionLimits(elementCount, 0.0);
    std::vector<char> junctionHasLimit(elementCount, 0);

    int32_t iterations = 0;
    int32_t converged = 0;

    for (int32_t iteration = 1; iteration <= maxIterations; ++iteration) {
        // Clear matrix and RHS
        std::fill(g_scratch.matrix.begin(), g_scratch.matrix.begin() + static_cast<size_t>(size) * size, 0.0);
        std::fill(g_scratch.rhs.begin(), g_scratch.rhs.begin() + size, 0.0);
        iterations = iteration;

        bool limitingActive = false;

        // GMIN to ground for every net (keeps matrix non-singular)
        for (int32_t net = 0; net < nodeCount; ++net) {
            stampConductance(g_scratch.matrix.data(), size, net, SOLVER_GROUND, GMIN);
        }

        // Stamp all elements
        for (int32_t i = 0; i < elementCount; ++i) {
            const SolverElement& element = elements[i];

            switch (element.kind) {
                case SOLVER_ELEMENT_RESISTOR: {
                    stampConductance(g_scratch.matrix.data(), size, element.a, element.b, 1.0 / element.ohms);
                    break;
                }

                case SOLVER_ELEMENT_CURRENT_SOURCE: {
                    stampCurrentSource(g_scratch.rhs.data(), element.a, element.b, element.amps);
                    break;
                }

                case SOLVER_ELEMENT_VOLTAGE_SOURCE: {
                    int32_t row = sourceRows[i];
                    if (row >= 0) {
                        stampVoltageSource(g_scratch.matrix.data(), g_scratch.rhs.data(), size,
                                           element.a, element.b, row, element.volts);
                    }
                    break;
                }

                case SOLVER_ELEMENT_CAPACITOR: {
                    // Backward Euler companion: I = (C/dt) * (V - Vprev)
                    const double siemens = element.farads / dt;
                    const double prior =
                        (element.a >= 0 ? previousStep[element.a] : 0.0) -
                        (element.b >= 0 ? previousStep[element.b] : 0.0);
                    stampConductance(g_scratch.matrix.data(), size, element.a, element.b, siemens);
                    stampCurrentSource(g_scratch.rhs.data(), element.a, element.b, siemens * prior);
                    break;
                }

                case SOLVER_ELEMENT_DIODE: {
                    const double bias = junctionBias(element, g_scratch.working.data());

                    double operatingVoltage;
                    if (!junctionHasLimit[i]) {
                        operatingVoltage = bias;
                        junctionHasLimit[i] = 1;
                    } else {
                        const double priorLimit = junctionLimits[i];
                        operatingVoltage = std::max(
                            std::min(bias, priorLimit + JUNCTION_LIMIT_STEP_VOLTS),
                            priorLimit - JUNCTION_LIMIT_STEP_VOLTS
                        );
                        if (operatingVoltage != bias) limitingActive = true;
                    }
                    junctionLimits[i] = operatingVoltage;

                    // Linearise diode at operating point
                    double amps, siemens;
                    solver::solver_linearise_diode(operatingVoltage, const_cast<SolverDiodeProfile*>(&element.profile), &amps, &siemens);

                    // Device current: siemens * v + (amps - siemens * operatingVoltage)
                    // stampCurrentSource expects current injected into a, drawn from b
                    stampConductance(g_scratch.matrix.data(), size, element.a, element.b, siemens);
                    stampCurrentSource(g_scratch.rhs.data(), element.a, element.b, siemens * operatingVoltage - amps);
                    break;
                }

                case SOLVER_ELEMENT_GROUND:
                    // Ground elements are handled by netlist extraction, not stamped here
                    break;
            }
        }

        // Solve the linear system
        LUDecomposition lu(size, g_scratch.lu.data(), g_scratch.pivots.data());
        lu.factor(g_scratch.matrix.data());

        if (lu.isSingular()) {
            // Return non-converged solution
            outSolution->voltages = static_cast<double*>(std::malloc(static_cast<size_t>(nodeCount) * sizeof(double)));
            outSolution->sourceCurrents = static_cast<double*>(std::malloc(static_cast<size_t>(sourceCount) * sizeof(double)));
            outSolution->sourceCount = sourceCount;
            outSolution->converged = 0;
            outSolution->iterations = iterations;

            if (outSolution->voltages) {
                std::copy(g_scratch.working.begin(), g_scratch.working.begin() + nodeCount, outSolution->voltages);
            }
            if (outSolution->sourceCurrents) {
                for (int32_t i = 0; i < sourceCount; ++i) {
                    outSolution->sourceCurrents[i] = g_scratch.working[nodeCount + i];
                }
            }
            return SOLVER_ERROR_SINGULAR_MATRIX;
        }

        if (!lu.solve(g_scratch.rhs.data(), g_scratch.solved.data())) {
            return SOLVER_ERROR_SINGULAR_MATRIX;
        }

        // Check convergence
        double delta = 0.0;
        for (int32_t i = 0; i < nodeCount; ++i) {
            delta = std::max(delta, std::abs(g_scratch.solved[i] - g_scratch.working[i]));
        }

        // Update working voltages
        std::copy(g_scratch.solved.begin(), g_scratch.solved.begin() + size, g_scratch.working.begin());

        if (delta < tolerance && !limitingActive) {
            converged = 1;
            break;
        }
    }

    // Re-seed junction limits from actual converged biases
    for (int32_t i = 0; i < elementCount; ++i) {
        if (elements[i].kind == SOLVER_ELEMENT_DIODE && junctionHasLimit[i]) {
            junctionLimits[i] = junctionBias(elements[i], g_scratch.working.data());
        }
    }

    // Allocate output
    outSolution->voltages = static_cast<double*>(std::malloc(static_cast<size_t>(nodeCount) * sizeof(double)));
    outSolution->sourceCurrents = static_cast<double*>(std::malloc(static_cast<size_t>(sourceCount) * sizeof(double)));
    outSolution->sourceCount = sourceCount;
    outSolution->converged = converged;
    outSolution->iterations = iterations;

    if (!outSolution->voltages || !outSolution->sourceCurrents) {
        if (outSolution->voltages) std::free(outSolution->voltages);
        if (outSolution->sourceCurrents) std::free(outSolution->sourceCurrents);
        return SOLVER_ERROR_ALLOCATION_FAILED;
    }

    // Copy voltages
    std::copy(g_scratch.working.begin(), g_scratch.working.begin() + nodeCount, outSolution->voltages);

    // Copy source currents
    for (int32_t i = 0; i < sourceCount; ++i) {
        outSolution->sourceCurrents[i] = g_scratch.working[nodeCount + i];
    }

    return SOLVER_OK;
}

extern "C" void solver_free_solution(SolverSolution* solution) {
    if (!solution) return;
    if (solution->voltages) {
        std::free(solution->voltages);
        solution->voltages = nullptr;
    }
    if (solution->sourceCurrents) {
        std::free(solution->sourceCurrents);
        solution->sourceCurrents = nullptr;
    }
    solution->sourceCount = 0;
    solution->converged = 0;
    solution->iterations = 0;
}

extern "C" double solver_element_current(const SolverElement* element, const SolverSolution* solution) {
    if (!element || !solution) return 0.0;

    const double voltageA = (element->a >= 0) ? solution->voltages[element->a] : 0.0;
    const double voltageB = (element->b >= 0) ? solution->voltages[element->b] : 0.0;

    switch (element->kind) {
        case SOLVER_ELEMENT_RESISTOR:
            return (voltageA - voltageB) / element->ohms;

        case SOLVER_ELEMENT_CURRENT_SOURCE:
            return element->amps;

        case SOLVER_ELEMENT_VOLTAGE_SOURCE:
            return 0.0; // Not recoverable from instantaneous solution

        case SOLVER_ELEMENT_CAPACITOR:
            return 0.0; // Not recoverable from companion model

        case SOLVER_ELEMENT_DIODE: {
            double amps, siemens;
            solver::solver_linearise_diode(voltageA - voltageB, const_cast<SolverDiodeProfile*>(&element->profile), &amps, &siemens);
            return amps;
        }

        case SOLVER_ELEMENT_GROUND:
        default:
            return 0.0;
    }
}