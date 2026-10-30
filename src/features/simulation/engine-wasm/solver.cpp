/**
 * Modified Nodal Analysis solver, C++ port of `circuit.ts` + `matrix.ts`.
 *
 * The shared runtime (heap, diode curves, string helpers) lives in engine.cpp;
 * this file is only the solver: stamping, Newton-Raphson, dense LU and the
 * result accessors. See engine.h for the ABI and solver.ts for the host side.
 *
 * Conventions are the TypeScript solver's:
 *   - net index -1 is the 0 V reference and has no matrix row;
 *   - positive current into a node is injected from outside that node;
 *   - a voltage-source branch current is positive flowing into its `a`.
 */

#include "engine.h"

using namespace engine;

namespace {

struct Scratch {
  int32_t size = 0;
  int32_t element_capacity = 0;
  int32_t source_capacity = 0;

  double* matrix = nullptr;
  double* rhs = nullptr;
  double* working = nullptr;
  double* solved = nullptr;
  double* previous_step = nullptr;
  double* lu = nullptr;
  int32_t* pivots = nullptr;

  double* source_currents = nullptr;
  int32_t* branch_row = nullptr;
  double* junction_limit = nullptr;
  uint8_t* junction_has = nullptr;

  int32_t iterations = 0;
};

Scratch scratch;

bool ensure_scratch(int32_t size, int32_t element_count, int32_t source_count) {
  if (size > scratch.size) {
    const uint32_t cells = static_cast<uint32_t>(size) * static_cast<uint32_t>(size);
    double* matrix = reinterpret_cast<double*>(alloc_bytes(cells * sizeof(double)));
    double* rhs = reinterpret_cast<double*>(alloc_bytes(static_cast<uint32_t>(size) * sizeof(double)));
    double* working =
        reinterpret_cast<double*>(alloc_bytes(static_cast<uint32_t>(size) * sizeof(double)));
    double* solved =
        reinterpret_cast<double*>(alloc_bytes(static_cast<uint32_t>(size) * sizeof(double)));
    double* previous_step =
        reinterpret_cast<double*>(alloc_bytes(static_cast<uint32_t>(size) * sizeof(double)));
    double* lu = reinterpret_cast<double*>(alloc_bytes(cells * sizeof(double)));
    int32_t* pivots =
        reinterpret_cast<int32_t*>(alloc_bytes(static_cast<uint32_t>(size) * sizeof(int32_t)));
    if (matrix == nullptr || rhs == nullptr || working == nullptr || solved == nullptr ||
        previous_step == nullptr || lu == nullptr || pivots == nullptr) {
      return false;
    }
    scratch.matrix = matrix;
    scratch.rhs = rhs;
    scratch.working = working;
    scratch.solved = solved;
    scratch.previous_step = previous_step;
    scratch.lu = lu;
    scratch.pivots = pivots;
    scratch.size = size;
  }

  if (element_count > scratch.element_capacity) {
    int32_t* branch_row =
        reinterpret_cast<int32_t*>(alloc_bytes(static_cast<uint32_t>(element_count) * sizeof(int32_t)));
    double* junction_limit =
        reinterpret_cast<double*>(alloc_bytes(static_cast<uint32_t>(element_count) * sizeof(double)));
    uint8_t* junction_has =
        reinterpret_cast<uint8_t*>(alloc_bytes(static_cast<uint32_t>(element_count)));
    if (branch_row == nullptr || junction_limit == nullptr || junction_has == nullptr) {
      return false;
    }
    scratch.branch_row = branch_row;
    scratch.junction_limit = junction_limit;
    scratch.junction_has = junction_has;
    scratch.element_capacity = element_count;
  }

  if (source_count > scratch.source_capacity) {
    double* source_currents =
        reinterpret_cast<double*>(alloc_bytes(static_cast<uint32_t>(source_count) * sizeof(double)));
    if (source_currents == nullptr) return false;
    scratch.source_currents = source_currents;
    scratch.source_capacity = source_count;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Stamps (port of circuit.ts)
// ---------------------------------------------------------------------------

inline void stamp_conductance(double* matrix, int32_t size, int32_t a, int32_t b, double siemens) {
  if (a >= 0) matrix[a * size + a] += siemens;
  if (b >= 0) matrix[b * size + b] += siemens;
  if (a >= 0 && b >= 0) {
    matrix[a * size + b] -= siemens;
    matrix[b * size + a] -= siemens;
  }
}

inline void stamp_current_source(double* rhs, int32_t a, int32_t b, double amps) {
  if (a >= 0) rhs[a] += amps;
  if (b >= 0) rhs[b] -= amps;
}

inline void stamp_voltage_source(
    double* matrix,
    double* rhs,
    int32_t size,
    int32_t a,
    int32_t b,
    int32_t row,
    double volts) {
  if (a >= 0) matrix[a * size + row] += 1;
  if (b >= 0) matrix[b * size + row] -= 1;
  if (a >= 0) matrix[row * size + a] += 1;
  if (b >= 0) matrix[row * size + b] -= 1;
  rhs[row] += volts;
}

// ---------------------------------------------------------------------------
// Dense LU with partial pivoting (port of matrix.ts)
// ---------------------------------------------------------------------------

bool factor(const double* matrix, int32_t n, double* lu, int32_t* pivots) {
  for (int32_t i = 0; i < n; i++) pivots[i] = i;
  for (int32_t i = 0; i < n * n; i++) lu[i] = matrix[i];

  bool singular = false;
  for (int32_t k = 0; k < n; k++) {
    int32_t pivot_row = k;
    double max = __builtin_fabs(lu[k * n + k]);
    for (int32_t i = k + 1; i < n; i++) {
      const double candidate = __builtin_fabs(lu[i * n + k]);
      if (candidate > max) {
        max = candidate;
        pivot_row = i;
      }
    }

    if (max < 1e-300) {
      singular = true;
      continue;
    }

    if (pivot_row != k) {
      for (int32_t j = 0; j < n; j++) {
        const double tmp = lu[k * n + j];
        lu[k * n + j] = lu[pivot_row * n + j];
        lu[pivot_row * n + j] = tmp;
      }
      const int32_t p = pivots[k];
      pivots[k] = pivots[pivot_row];
      pivots[pivot_row] = p;
    }

    const double pivot = lu[k * n + k];
    for (int32_t i = k + 1; i < n; i++) {
      const double f = lu[i * n + k] / pivot;
      lu[i * n + k] = f;
      if (f == 0) continue;
      for (int32_t j = k + 1; j < n; j++) lu[i * n + j] -= f * lu[k * n + j];
    }
  }
  return singular;
}

void solve_lu(const double* lu, const int32_t* pivots, const double* rhs, double* x, int32_t n) {
  for (int32_t i = 0; i < n; i++) x[i] = rhs[pivots[i]];
  for (int32_t i = 1; i < n; i++) {
    double sum = x[i];
    for (int32_t j = 0; j < i; j++) sum -= lu[i * n + j] * x[j];
    x[i] = sum;
  }
  for (int32_t i = n - 1; i >= 0; i--) {
    double sum = x[i];
    for (int32_t j = i + 1; j < n; j++) sum -= lu[i * n + j] * x[j];
    x[i] = sum / lu[i * n + i];
  }
}

void fill_source_currents(const ElementIn* elements, int32_t element_count) {
  int32_t source = 0;
  for (int32_t i = 0; i < element_count; i++) {
    if (elements[i].kind != KIND_VOLTAGE_SOURCE) continue;
    const int32_t row = scratch.branch_row[i];
    scratch.source_currents[source++] = row >= 0 ? scratch.working[row] : 0.0;
  }
}

}  // namespace

extern "C" int32_t solve(
    const ElementIn* elements,
    int32_t element_count,
    int32_t node_count,
    double dt,
    const double* previous,
    int32_t previous_count,
    int32_t max_iterations,
    double tolerance) {
  if (element_count < 0 || node_count < 0 || max_iterations < 0) return -2;
  if (element_count > 0 && elements == nullptr) return -2;

  int32_t source_count = 0;
  for (int32_t i = 0; i < element_count; i++) {
    if (elements[i].kind == KIND_VOLTAGE_SOURCE) source_count++;
  }
  const int32_t size = node_count + source_count;
  if (!ensure_scratch(size, element_count, source_count)) return -2;

  int32_t source = 0;
  for (int32_t i = 0; i < element_count; i++) {
    scratch.branch_row[i] = -1;
    scratch.junction_has[i] = 0;
    scratch.junction_limit[i] = 0;
    if (elements[i].kind == KIND_VOLTAGE_SOURCE) {
      scratch.branch_row[i] = node_count + source;
      source++;
    }
  }

  double* const matrix = scratch.matrix;
  double* const rhs = scratch.rhs;
  double* const working = scratch.working;
  double* const solved = scratch.solved;

  for (int32_t i = 0; i < size; i++) working[i] = 0;
  for (int32_t i = 0; i < node_count; i++) {
    scratch.previous_step[i] = previous != nullptr && i < previous_count ? previous[i] : 0;
  }
  if (previous != nullptr && previous_count > 0) {
    const int32_t copy_count = previous_count < size ? previous_count : size;
    for (int32_t i = 0; i < copy_count; i++) working[i] = previous[i];
  }

  bool converged = false;
  int32_t iterations = 0;

  for (int32_t iteration = 1; iteration <= max_iterations; iteration++) {
    iterations = iteration;
    for (int32_t i = 0; i < size * size; i++) matrix[i] = 0;
    for (int32_t i = 0; i < size; i++) rhs[i] = 0;

    bool limiting_active = false;

    for (int32_t net = 0; net < node_count; net++) {
      stamp_conductance(matrix, size, net, -1, GMIN);
    }

    for (int32_t ei = 0; ei < element_count; ei++) {
      const ElementIn& element = elements[ei];
      switch (element.kind) {
        case KIND_RESISTOR:
          stamp_conductance(matrix, size, element.a, element.b, 1.0 / element.value);
          break;

        case KIND_CURRENT_SOURCE:
          stamp_current_source(rhs, element.a, element.b, element.value);
          break;

        case KIND_VOLTAGE_SOURCE: {
          const int32_t row = scratch.branch_row[ei];
          if (row >= 0) {
            stamp_voltage_source(matrix, rhs, size, element.a, element.b, row, element.value);
          }
          break;
        }

        case KIND_CAPACITOR: {
          const double siemens = element.value / dt;
          const double prior = (element.a >= 0 ? scratch.previous_step[element.a] : 0) -
                               (element.b >= 0 ? scratch.previous_step[element.b] : 0);
          stamp_conductance(matrix, size, element.a, element.b, siemens);
          stamp_current_source(rhs, element.a, element.b, siemens * prior);
          break;
        }

        case KIND_DIODE: {
          const double bias = (element.a >= 0 ? working[element.a] : 0) -
                              (element.b >= 0 ? working[element.b] : 0);
          double operating = bias;
          if (scratch.junction_has[ei]) {
            const double prior = scratch.junction_limit[ei];
            const double lower = prior - JUNCTION_LIMIT_STEP_VOLTS;
            const double upper = prior + JUNCTION_LIMIT_STEP_VOLTS;
            operating = bias < lower ? lower : (bias > upper ? upper : bias);
            if (operating != bias) limiting_active = true;
          }
          scratch.junction_has[ei] = 1;
          scratch.junction_limit[ei] = operating;

          const Linear linear = linearise_diode(operating, element.profile);
          stamp_conductance(matrix, size, element.a, element.b, linear.siemens);
          stamp_current_source(
              rhs, element.a, element.b, linear.siemens * operating - linear.amps);
          break;
        }

        default:
          break;
      }
    }

    if (factor(matrix, size, scratch.lu, scratch.pivots)) {
      scratch.iterations = iterations;
      fill_source_currents(elements, element_count);
      return -1;
    }
    solve_lu(scratch.lu, scratch.pivots, rhs, solved, size);

    double delta = 0;
    for (int32_t i = 0; i < node_count; i++) {
      const double step = __builtin_fabs(solved[i] - working[i]);
      if (step > delta) delta = step;
    }
    for (int32_t i = 0; i < size; i++) working[i] = solved[i];

    if (delta < tolerance && !limiting_active) {
      converged = true;
      break;
    }
  }

  scratch.iterations = iterations;
  fill_source_currents(elements, element_count);
  return converged ? 1 : 0;
}

extern "C" uint32_t result_voltages() {
  return reinterpret_cast<uint32_t>(scratch.working);
}

extern "C" uint32_t result_source_currents() {
  return reinterpret_cast<uint32_t>(scratch.source_currents);
}

extern "C" int32_t result_iterations() { return scratch.iterations; }

extern "C" double element_current(
    int32_t index,
    const ElementIn* elements,
    int32_t element_count,
    const double* volts,
    int32_t node_count) {
  if (index < 0 || index >= element_count || elements == nullptr) return 0;
  const ElementIn& element = elements[index];
  if (element.kind == KIND_GROUND) return 0;

  const double voltage_a =
      element.a >= 0 && element.a < node_count && volts != nullptr ? volts[element.a] : 0;
  const double voltage_b =
      element.b >= 0 && element.b < node_count && volts != nullptr ? volts[element.b] : 0;

  switch (element.kind) {
    case KIND_RESISTOR:
      return (voltage_a - voltage_b) / element.value;
    case KIND_CURRENT_SOURCE:
      return element.value;
    case KIND_VOLTAGE_SOURCE:
      return 0;
    case KIND_CAPACITOR:
      return 0;
    case KIND_DIODE:
      return linearise_diode(voltage_a - voltage_b, element.profile).amps;
    default:
      return 0;
  }
}
