import { varName } from '../utils/utils.js';

/**
 * LPGenerator — creates random LP problems with 2 or 3 variables.
 *
 * LP object structure:
 * {
 *   objective:   { type: 'max'|'min', coefficients: number[] },
 *   constraints: [{ coefficients: number[], sense: '<='|'>='|'=', rhs: number }],
 *   variables:   string[]   // e.g. ['x₁','x₂'] or ['x₁','x₂','x₃']
 * }
 */
export class LPGenerator {
  /** Random integer in [lo, hi] */
  static _r(lo, hi) {
    return Math.floor(Math.random() * (hi - lo + 1)) + lo;
  }

  /**
   * Generate a random LP.
   * @param {number} numVars        2 or 3
   * @param {'unique'|'multiple'|'infeasible'} solutionType
   * @param {number} numConstraints 2–8
   */
  static generate(numVars = 2, solutionType = 'unique', numConstraints = 4) {
    numConstraints = Math.min(Math.max(numConstraints, 2), 8);
    numVars        = numVars === 3 ? 3 : 2;

    const variables = Array.from({ length: numVars }, (_, i) => varName(i));

    switch (solutionType) {
      case 'multiple':   return LPGenerator._multiple(variables, numConstraints);
      case 'infeasible': return LPGenerator._infeasible(variables, numConstraints);
      default:           return LPGenerator._unique(variables, numConstraints);
    }
  }

  /** LP with a single unique optimal vertex */
  static _unique(variables, m) {
    const n   = variables.length;
    const obj = Array.from({ length: n }, () => LPGenerator._r(1, 6));

    // Start with m random constraints
    let constraints = Array.from({ length: m }, () => ({
      coefficients: Array.from({ length: n }, () => LPGenerator._r(1, 5)),
      sense: '<=',
      rhs: LPGenerator._r(10, 40),
    }));

    // Iteratively replace redundant constraints.
    // On each outer pass we scan all constraints; whenever one is redundant we
    // replace it with a *smart* candidate that is guaranteed to cut at least one
    // vertex of the remaining polytope.  We restart the inner scan after every
    // replacement to catch cascading redundancy immediately.
    // The outer loop exits only when a complete scan finds nothing to replace.
    for (let outerIter = 0; outerIter < 120; outerIter++) {
      let madeChange = false;
      for (let i = 0; i < constraints.length; i++) {
        if (!LPGenerator._isRedundant(constraints, i, n)) continue;
        const others = constraints.filter((_, j) => j !== i);
        constraints[i] = LPGenerator._smartReplace(others, n);
        madeChange = true;
        break;   // restart inner scan from i=0 to catch new cascades
      }
      if (!madeChange) break;  // all constraints are non-redundant
    }

    return { objective: { type: 'max', coefficients: obj }, constraints, variables };
  }

  /**
   * Generate a constraint that is non-redundant w.r.t. `others` by construction:
   * pick a random normal direction, find the range of the LP value at the vertices
   * of `others`, then set the RHS strictly inside that range.
   */
  static _smartReplace(others, n) {
    const verts = n === 3 ? LPGenerator._vertices3D(others) : LPGenerator._vertices2D(others);
    if (verts.length >= 2) {
      for (let attempt = 0; attempt < 60; attempt++) {
        const coeffs = Array.from({ length: n }, () => LPGenerator._r(1, 5));
        const vals   = verts.map(v => coeffs.reduce((s, a, i) => s + a * v[i], 0));
        const lo = Math.min(...vals);
        const hi = Math.max(...vals);
        if (hi - lo < 2) continue;            // not enough spread for a clean integer rhs
        // Ensure rhs >= 5 to avoid degenerate near-zero constraints (origin is always
        // a vertex so lo=0 would otherwise allow rhs=0 which makes all others redundant)
        const rhsLo = Math.max(5, Math.ceil(lo) + 1);
        const rhsHi = Math.floor(hi) - 1;
        if (rhsLo > rhsHi) continue;
        const rhs = LPGenerator._r(rhsLo, rhsHi);
        if (rhs >= rhsLo && rhs <= rhsHi)
          return { coefficients: coeffs, sense: '<=', rhs };
      }
    }
    // Fallback: plain random (might still be redundant; outer loop will re-detect)
    return {
      coefficients: Array.from({ length: n }, () => LPGenerator._r(1, 5)),
      sense: '<=',
      rhs: LPGenerator._r(10, 40),
    };
  }

  /** LP with multiple optimal solutions (objective parallel to one constraint face) */
  static _multiple(variables, m) {
    const lp  = LPGenerator._unique(variables, m);
    // Pick a random constraint and align the objective with it
    const idx = LPGenerator._r(0, lp.constraints.length - 1);
    const con = lp.constraints[idx];
    lp.objective.coefficients = [...con.coefficients];
    return lp;
  }

  /** LP that is infeasible */
  static _infeasible(variables, m) {
    const lp = LPGenerator._unique(variables, Math.min(m, 7));
    // Add a constraint that forces the sum of variables to be very large
    const n  = variables.length;
    lp.constraints.push({
      coefficients: Array(n).fill(1),
      sense: '>=',
      rhs: 500,          // clearly contradicts the <= constraints with small rhs
    });
    return lp;
  }

  // ─────────────────────────────────────────────────────────────
  //  Redundancy helpers
  // ─────────────────────────────────────────────────────────────

  /**
   * Returns true if cons[idx] is redundant given all other constraints + x ≥ 0.
   * A constraint is redundant when every vertex of the polytope formed by the
   * remaining constraints already satisfies it (it never "cuts" anything).
   */
  static _isRedundant(cons, idx, n) {
    const others = cons.filter((_, i) => i !== idx);
    const verts  = n === 3
      ? LPGenerator._vertices3D(others)
      : LPGenerator._vertices2D(others);
    if (verts.length === 0) return false;   // unbounded / indeterminate → keep it
    const con = cons[idx];
    return verts.every(v =>
      con.coefficients.reduce((s, a, i) => s + a * v[i], 0) <= con.rhs + 1e-9
    );
  }

  /**
   * All vertices of the 2-D polytope {cons (all ≤) ∩ x₁,x₂ ≥ 0}.
   * Vertices are found as intersections of every pair of boundary hyperplanes.
   */
  static _vertices2D(cons) {
    const all = [
      ...cons,
      { coefficients: [-1, 0], rhs: 0 },   // x₁ ≥ 0
      { coefficients: [0, -1], rhs: 0 },   // x₂ ≥ 0
    ];
    const TOL   = 1e-9;
    const verts = [];
    for (let i = 0; i < all.length - 1; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const [ai, bi] = [all[i].coefficients, all[i].rhs];
        const [aj, bj] = [all[j].coefficients, all[j].rhs];
        const det = ai[0] * aj[1] - ai[1] * aj[0];
        if (Math.abs(det) < TOL) continue;
        const x1 = (bi * aj[1] - bj * ai[1]) / det;
        const x2 = (ai[0] * bj - aj[0] * bi) / det;
        if (all.every(c => c.coefficients[0] * x1 + c.coefficients[1] * x2 <= c.rhs + TOL)) {
          verts.push([x1, x2]);
        }
      }
    }
    return verts;
  }

  /**
   * All vertices of the 3-D polytope {cons (all ≤) ∩ x₁,x₂,x₃ ≥ 0}.
   * Vertices are found as intersections of every triple of boundary hyperplanes.
   */
  static _vertices3D(cons) {
    const all = [
      ...cons,
      { coefficients: [-1, 0, 0], rhs: 0 },
      { coefficients: [0, -1, 0], rhs: 0 },
      { coefficients: [0, 0, -1], rhs: 0 },
    ];
    const TOL   = 1e-9;
    const verts = [];
    for (let i = 0; i < all.length - 2; i++) {
      for (let j = i + 1; j < all.length - 1; j++) {
        for (let k = j + 1; k < all.length; k++) {
          const A = [all[i].coefficients, all[j].coefficients, all[k].coefficients];
          const b = [all[i].rhs,          all[j].rhs,          all[k].rhs];
          const x = LPGenerator._solve3x3(A, b);
          if (!x) continue;
          if (all.every(c =>
            c.coefficients[0] * x[0] +
            c.coefficients[1] * x[1] +
            c.coefficients[2] * x[2] <= c.rhs + TOL
          )) {
            verts.push(x);
          }
        }
      }
    }
    return verts;
  }

  /** Solve 3×3 linear system Ax = b via Cramer's rule; returns null if singular. */
  static _solve3x3(A, b) {
    const det3 = (m) =>
      m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
      - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
      + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const D = det3(A);
    if (Math.abs(D) < 1e-9) return null;
    return [
      det3([[b[0], A[0][1], A[0][2]], [b[1], A[1][1], A[1][2]], [b[2], A[2][1], A[2][2]]]) / D,
      det3([[A[0][0], b[0], A[0][2]], [A[1][0], b[1], A[1][2]], [A[2][0], b[2], A[2][2]]]) / D,
      det3([[A[0][0], A[0][1], b[0]], [A[1][0], A[1][1], b[1]], [A[2][0], A[2][1], b[2]]]) / D,
    ];
  }

  /**
   * Deep-clone an LP object.
   */
  static clone(lp) {
    return {
      objective: {
        type: lp.objective.type,
        coefficients: [...lp.objective.coefficients],
      },
      constraints: lp.constraints.map(c => ({
        coefficients: [...c.coefficients],
        sense: c.sense,
        rhs:   c.rhs,
      })),
      variables: [...lp.variables],
    };
  }
}

