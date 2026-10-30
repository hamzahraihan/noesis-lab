/**
 * Circuit Solver C API
 *
 * Modified Nodal Analysis solver with Newton-Raphson for nonlinear junctions
 * and LU decomposition matrix factorization.
 *
 * Compiled to WebAssembly via Emscripten.
 */

#ifndef SOLVER_H
#define SOLVER_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Element kinds in the SPICE netlist vocabulary.
 * Matches the TypeScript Element.kind enum.
 */
typedef enum {
    SOLVER_ELEMENT_RESISTOR = 0,
    SOLVER_ELEMENT_VOLTAGE_SOURCE = 1,
    SOLVER_ELEMENT_CURRENT_SOURCE = 2,
    SOLVER_ELEMENT_CAPACITOR = 3,
    SOLVER_ELEMENT_DIODE = 4,
    SOLVER_ELEMENT_GROUND = 5
} SolverElementKind;

/**
 * Diode profile - datasheet parameters for a junction.
 * Describing the part by forward voltage and rated current keeps the model honest.
 */
typedef struct {
    double forwardVolts;    // Forward voltage at rated current
    double ratedAmps;       // Rated current
    double seriesOhms;      // Bulk and lead resistance
    double ideality;        // Ideality factor n (~1 for silicon, ~2 for LED)
    double leakageAmps;     // Reverse leakage current
    double breakdownVolts;  // Reverse breakdown voltage
    double breakdownAmps;   // Current at breakdown
} SolverDiodeProfile;

/**
 * Circuit element - flat structure for Wasm marshalling.
 * All fields present; unused fields are zero for each kind.
 */
typedef struct {
    SolverElementKind kind;
    int32_t a;              // Net index (>=0) or GROUND (-1)
    int32_t b;              // Net index (>=0) or GROUND (-1)

    // Resistor
    double ohms;

    // Voltage source
    double volts;

    // Current source
    double amps;

    // Capacitor
    double farads;

    // Diode
    SolverDiodeProfile profile;
} SolverElement;

/**
 * Solver options.
 */
typedef struct {
    int32_t nodeCount;      // Number of real, probe-able nets
    double dtSeconds;       // Timestep in seconds (for capacitors)
    const double* previousVoltages;  // Node voltages from previous timestep (size nodeCount), or NULL
    int32_t maxIterations;  // Newton-Raphson max iterations (default 100)
    double tolerance;       // Convergence threshold in volts (default 1e-7)
} SolverOptions;

/**
 * Solver solution output.
 * The caller must free the returned voltages array with solver_free_solution().
 */
typedef struct {
    double* voltages;       // Net voltages in volts, size = nodeCount
    double* sourceCurrents; // Branch current for each voltage source, size = sourceCount
    int32_t sourceCount;    // Number of voltage sources
    int32_t converged;      // 1 if converged, 0 otherwise
    int32_t iterations;     // Number of Newton iterations performed
} SolverSolution;

/**
 * Error codes.
 */
typedef enum {
    SOLVER_OK = 0,
    SOLVER_ERROR_SINGULAR_MATRIX = 1,
    SOLVER_ERROR_INVALID_INPUT = 2,
    SOLVER_ERROR_ALLOCATION_FAILED = 3
} SolverError;

/**
 * Solve a circuit using Modified Nodal Analysis with Newton-Raphson.
 *
 * @param elements        Array of elements
 * @param elementCount    Number of elements
 * @param options         Solver options
 * @param outSolution     Output solution (must be freed with solver_free_solution)
 * @return                Error code
 */
SolverError solver_solve(
    const SolverElement* elements,
    int32_t elementCount,
    const SolverOptions* options,
    SolverSolution* outSolution
);

/**
 * Free memory allocated by solver_solve().
 */
void solver_free_solution(SolverSolution* solution);

/**
 * Compute current through a two-terminal element from a solution.
 * Returns current in amps, positive from a to b.
 */
double solver_element_current(const SolverElement* element, const SolverSolution* solution);

/**
 * Ground constant - matches TypeScript GROUND = -1.
 */
#define SOLVER_GROUND -1

#ifdef __cplusplus
}
#endif

#endif // SOLVER_H