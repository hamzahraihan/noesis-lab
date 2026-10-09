/**
 * Dense linear algebra for Modified Nodal Analysis.
 *
 * Bench circuits are small -- tens of nets, not thousands -- so a dense LU with
 * partial pivoting is both fast enough and far easier to trust than a sparse
 * solver. An MNA matrix for a typical breadboard is 20x20; that solves in
 * microseconds, several hundred times per simulated frame.
 */

export class SingularMatrixError extends Error {
  public readonly size: number;

  constructor(size: number) {
    super(`singular matrix of size ${size}`);
    this.name = 'SingularMatrixError';
    this.size = size;
  }
}

/**
 * In-place LU factorisation with partial pivoting, followed by solve.
 *
 * The matrix is copied on entry so callers can keep stamping into the same
 * buffer across Newton iterations -- the solver re-stamps and re-solves every
 * iteration rather than rebuilding state, which is the whole point of
 * Newton-Raphson here.
 */
export class LUDecomposition {
  private readonly lu: Float64Array;
  private readonly pivots: Int32Array;
  private readonly n: number;
  private singular = false;

  constructor(matrix: Float64Array, size: number, reuse?: { lu: Float64Array; pivots: Int32Array }) {
    this.n = size;
    if (reuse && reuse.lu.length >= size * size && reuse.pivots.length >= size) {
      // Hot path: copy into the shared buffers instead of allocating. The
      // copy is a memcpy either way; what it avoids is a size² heap object
      // per Newton iteration, which is what kept the GC from ever settling.
      this.lu = reuse.lu;
      this.lu.set(matrix.subarray(0, size * size));
      this.pivots = reuse.pivots;
    } else {
      this.lu = Float64Array.from(matrix);
      this.pivots = new Int32Array(size);
    }
    this.factor();
  }

  private factor(): void {
    const { lu, pivots, n } = this;

    for (let i = 0; i < n; i++) pivots[i] = i;

    for (let k = 0; k < n; k++) {
      // Partial pivoting: swap in the largest available pivot to keep the
      // elimination numerically stable. Exponential diode curves make this
      // load-bearing, not cosmetic.
      let pivotRow = k;
      let max = Math.abs(lu[k * n + k]);
      for (let i = k + 1; i < n; i++) {
        const candidate = Math.abs(lu[i * n + k]);
        if (candidate > max) {
          max = candidate;
          pivotRow = i;
        }
      }

      if (max < 1e-300) {
        this.singular = true;
        continue;
      }

      if (pivotRow !== k) {
        for (let j = 0; j < n; j++) {
          const tmp = lu[k * n + j];
          lu[k * n + j] = lu[pivotRow * n + j];
          lu[pivotRow * n + j] = tmp;
        }
        const p = pivots[k];
        pivots[k] = pivots[pivotRow];
        pivots[pivotRow] = p;
      }

      const pivot = lu[k * n + k];
      for (let i = k + 1; i < n; i++) {
        const factor = lu[i * n + k] / pivot;
        lu[i * n + k] = factor;
        if (factor === 0) continue;
        for (let j = k + 1; j < n; j++) {
          lu[i * n + j] -= factor * lu[k * n + j];
        }
      }
    }
  }

  /** True when the matrix had a (near-)zero pivot -- an unconnected net. */
  get isSingular(): boolean {
    return this.singular;
  }

  /** Solve A x = b. Writes into `out` when provided, otherwise allocates. */
  solve(rhs: Float64Array, out?: Float64Array): Float64Array {
    if (this.singular) throw new SingularMatrixError(this.n);

    const { lu, pivots, n } = this;
    const x = out ?? new Float64Array(n);

    for (let i = 0; i < n; i++) x[i] = rhs[pivots[i]];
    // Forward substitution through L (unit diagonal).
    for (let i = 1; i < n; i++) {
      let sum = x[i];
      for (let j = 0; j < i; j++) sum -= lu[i * n + j] * x[j];
      x[i] = sum;
    }
    // Back substitution through U.
    for (let i = n - 1; i >= 0; i--) {
      let sum = x[i];
      for (let j = i + 1; j < n; j++) sum -= lu[i * n + j] * x[j];
      x[i] = sum / lu[i * n + i];
    }

    return x;
  }
}