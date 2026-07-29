import { fmt } from '../utils/utils.js';

/**
 * SimplexSolver — Big-M tableau-based simplex method.
 *
 * Handles:
 *   <=  constraints  →  add slack s_i  (basic)
 *   >=  constraints  →  subtract surplus s_i + add artificial a_i  (a_i basic)
 *   =   constraints  →  add artificial a_i  (basic)
 *
 * Maximization problem.  If 'min', negate objective.
 */
export class SimplexSolver {
  /** @param {number} M  Big-M penalty value */
  constructor(M = 1e6) {
    this.M          = M;
    this.lp         = null;
    this.tableau    = null;   // (m+1) × (totalVars+1)  last col = RHS
    this.basis      = null;   // int[m]  index into allVars
    this.allVars    = [];     // names for every column
    this.n          = 0;      // # decision vars
    this.m          = 0;      // # constraints
    this.numSlacks  = 0;
    this.numArt     = 0;
    this.totalVars  = 0;
    this.iterations = [];     // recorded states
    this.status     = 'idle'; // idle | running | optimal | infeasible | unbounded
    this.curIter    = 0;
    this._isMax     = true;
  }

  /* ─── Public API ─────────────────────────────── */

  /** Load and prepare an LP for solving. Returns this (chainable). */
  setup(lp) {
    this.lp         = lp;
    this.iterations = [];
    this.status     = 'idle';
    this.curIter    = 0;
    this._isMax     = lp.objective.type === 'max';

    const { objective, constraints, variables } = lp;
    const n = variables.length;
    const m = constraints.length;
    this.n  = n;
    this.m  = m;

    /* ── Classify constraints & assign slack/artificial columns ── */
    let si = 0;  // slack counter
    let ai = 0;  // artificial counter

    const info = constraints.map((con) => {
      let { coefficients, sense, rhs } = con;
      // Ensure RHS ≥ 0 (flip if needed)
      if (rhs < 0) {
        coefficients = coefficients.map(c => -c);
        rhs  = -rhs;
        sense = sense === '<=' ? '>=' : sense === '>=' ? '<=' : '=';
      }
      if (sense === '<=') {
        return { coefficients, rhs, sense, slackCoeff: +1, slackIdx: si++, artIdx: -1 };
      } else if (sense === '>=') {
        return { coefficients, rhs, sense, slackCoeff: -1, slackIdx: si++, artIdx: ai++ };
      } else { // '='
        return { coefficients, rhs, sense, slackCoeff:  0, slackIdx: -1,  artIdx: ai++ };
      }
    });

    this.numSlacks = si;
    this.numArt    = ai;
    const T = n + si + ai;  // total columns (excl. RHS)
    this.totalVars = T;

    /* ── Variable names ── */
    this.allVars = [
      ...variables,
      ...Array.from({ length: si }, (_, k) => `s${k + 1}`),
      ...Array.from({ length: ai }, (_, k) => `a${k + 1}`),
    ];

    /* ── Build tableau ── */
    const tab = Array.from({ length: m + 1 }, () => new Float64Array(T + 1));

    for (let i = 0; i < m; i++) {
      const inf = info[i];
      for (let j = 0; j < n; j++) tab[i][j] = inf.coefficients[j];
      if (inf.slackIdx >= 0) tab[i][n + inf.slackIdx] = inf.slackCoeff;
      if (inf.artIdx   >= 0) tab[i][n + si + inf.artIdx] = 1;
      tab[i][T] = inf.rhs;
    }

    /* ── Initial basis ── */
    const basis = new Int32Array(m);
    for (let i = 0; i < m; i++) {
      const inf = info[i];
      if (inf.artIdx >= 0) {
        basis[i] = n + si + inf.artIdx;  // artificial is basic
      } else {
        basis[i] = n + inf.slackIdx;     // slack is basic
      }
    }
    this.basis = basis;

    /* ── Objective row (z row = row m) ──
       For maximization: z row holds  c_j (for min-ratio check we store -c_j to detect negative) */
    for (let j = 0; j < n; j++) {
      tab[m][j] = this._isMax
        ? -objective.coefficients[j]
        :  objective.coefficients[j];
    }
    // Big-M penalty for artificials
    for (let k = 0; k < ai; k++) {
      tab[m][n + si + k] = this._isMax ? this.M : -this.M;
    }
    // Eliminate artificials from z row (they are basic with their RHS value)
    for (let i = 0; i < m; i++) {
      const inf = info[i];
      if (inf.artIdx >= 0) {
        const col = n + si + inf.artIdx;
        const mu  = tab[m][col];
        if (Math.abs(mu) > 1e-12) {
          for (let j = 0; j <= T; j++) tab[m][j] -= mu * tab[i][j];
        }
      }
    }

    this.tableau = tab;
    this._record('initial');
    return this;
  }

  /** Execute one simplex iteration. Returns {done, status, enteringVar?, leavingVar?} */
  step() {
    if (this.status !== 'idle' && this.status !== 'running') {
      return { done: true, status: this.status };
    }
    this.status = 'running';

    const { m, totalVars: T, tableau: tab, basis, allVars, n, numSlacks } = this;

    /* ── Select entering variable (most-negative reduced cost) ── */
    let pivCol  = -1;
    let minCost = -1e-9;
    for (let j = 0; j < T; j++) {
      if (tab[m][j] < minCost) { minCost = tab[m][j]; pivCol = j; }
    }

    if (pivCol === -1) {
      /* All reduced costs ≥ 0 → check if any artificial is still basic */
      for (let i = 0; i < m; i++) {
        const bv = basis[i];
        if (bv >= n + numSlacks && tab[i][T] > 1e-7) {
          this.status = 'infeasible';
          this._record('infeasible');
          return { done: true, status: 'infeasible' };
        }
      }
      this.status = 'optimal';
      this._record('optimal');
      return { done: true, status: 'optimal', solution: this._getSolution() };
    }

    /* ── Select leaving variable (min-ratio test) ── */
    let pivRow  = -1;
    let minRatio = Infinity;
    for (let i = 0; i < m; i++) {
      const elem = tab[i][pivCol];
      if (elem > 1e-9) {
        const ratio = tab[i][T] / elem;
        if (ratio < minRatio - 1e-12) { minRatio = ratio; pivRow = i; }
      }
    }

    if (pivRow === -1) {
      this.status = 'unbounded';
      this._record('unbounded');
      return { done: true, status: 'unbounded' };
    }

    /* ── Pivot ── */
    this.curIter++;
    const entering = allVars[pivCol];
    const leaving  = allVars[basis[pivRow]];
    const pivElem  = tab[pivRow][pivCol];

    // Normalize pivot row
    for (let j = 0; j <= T; j++) tab[pivRow][j] /= pivElem;
    // Eliminate pivot column from all other rows
    for (let i = 0; i <= m; i++) {
      if (i === pivRow) continue;
      const f = tab[i][pivCol];
      if (Math.abs(f) < 1e-12) continue;
      for (let j = 0; j <= T; j++) tab[i][j] -= f * tab[pivRow][j];
    }
    basis[pivRow] = pivCol;

    this._record('pivot', { entering, leaving, pivRow, pivCol, pivElem, minRatio });
    return { done: false, status: 'running', enteringVar: entering, leavingVar: leaving };
  }

  /** Run until optimal / infeasible / unbounded (max 200 iterations). Returns this. */
  solve() {
    let result;
    for (let k = 0; k < 200; k++) {
      result = this.step();
      if (result.done) break;
    }
    return this;
  }

  /** Return result object after solve(). */
  getResult() {
    const last = this.iterations[this.iterations.length - 1] ?? {};
    return {
      status:     this.status,
      solution:   last.solution ?? null,
      iterations: this.iterations,
      log:        this.generateLog(),
    };
  }

  /** Vertex sequence visited by simplex (for visualizer path). Returns number[][] */
  getVertexPath() {
    return this.iterations
      .filter(it => it.solution)
      .map(it => this.lp.variables.map(v => it.solution.variables[v] ?? 0));
  }

  /* ─── Log generation ─────────────────────────── */

  /** Returns array of {type, text} lines for the solver log display. */
  generateLog() {
    const lines = [];
    const { allVars, n, totalVars: T } = this;

    this.iterations.forEach(it => {
      switch (it.type) {
        case 'initial':
          lines.push({ type: 'log-header', text: '═══ INITIAL TABLEAU ═══' });
          lines.push(...this._tableauLines(it));
          lines.push({ type: 'log-info', text: `Basis: { ${it.basis.map(i => allVars[i]).join(', ')} }` });
          lines.push({ type: 'log-info', text: `Initial BFS: ${this._solText(it)}` });
          break;

        case 'pivot':
          lines.push({ type: 'log-iter-hdr', text: `── Iteration ${it.iteration} ──` });
          lines.push({ type: 'log-pivot', text: `  Entering variable : ${it.entering}   (reduced cost = ${fmt(it.reducedCost, 4)})` });
          lines.push({ type: 'log-pivot', text: `  Leaving  variable : ${it.leaving}   (min ratio = ${fmt(it.minRatio, 4)})` });
          lines.push({ type: 'log-pivot', text: `  Pivot element     : ${fmt(it.pivElem, 4)}  at row ${it.pivRow + 1}, col ${it.pivCol + 1}` });
          lines.push(...this._tableauLines(it));
          lines.push({ type: 'log-info', text: `  BFS: ${this._solText(it)}` });
          break;

        case 'optimal':
          lines.push({ type: 'log-optimal', text: '✓ OPTIMAL SOLUTION FOUND' });
          lines.push({ type: 'log-optimal', text: `  ${this._solText(it)}` });
          lines.push({ type: 'log-optimal', text: `  z* = ${fmt(it.solution?.objectiveValue ?? 0, 6)}` });
          break;

        case 'infeasible':
          lines.push({ type: 'log-infeasible', text: '✗ INFEASIBLE — No feasible solution exists.' });
          lines.push({ type: 'log-infeasible', text: '  The constraints cannot all be satisfied simultaneously.' });
          break;

        case 'unbounded':
          lines.push({ type: 'log-unbounded', text: '⚠ UNBOUNDED — The objective grows without limit.' });
          lines.push({ type: 'log-unbounded', text: '  The feasible region extends to infinity in the improving direction.' });
          break;
      }
    });

    return lines;
  }

  /* ─── Private helpers ────────────────────────── */

  _record(type, extra = {}) {
    const { m, totalVars: T, allVars, basis } = this;
    const entry = {
      type,
      iteration: this.curIter,
      // Snapshot tableau (rows as regular arrays)
      tableau: Array.from(this.tableau, r => Array.from(r)),
      basis:   Array.from(basis),
      ...extra,
    };
    // Add reduced cost of entering var if pivot
    if (type === 'pivot' && extra.pivCol !== undefined) {
      entry.reducedCost = this.iterations.length > 0
        ? entry.tableau[m][extra.pivCol]   // before pivot was applied? No—after, it's 0
        : 0;
      // Re-read from the snapshot taken before this pivot
      // Actually store it from prev iteration's tab
      const prevIter = this.iterations[this.iterations.length - 1];
      entry.reducedCost = prevIter ? prevIter.tableau[m][extra.pivCol] : 0;
    }
    // Current solution
    entry.solution = this._getSolution();
    this.iterations.push(entry);
    return entry;
  }

  _getSolution() {
    const { m, n, totalVars: T, allVars, basis, tableau: tab, _isMax } = this;
    const vars = {};
    allVars.slice(0, n).forEach(v => vars[v] = 0);
    for (let i = 0; i < m; i++) {
      const bv = basis[i];
      if (bv < n) vars[allVars[bv]] = Math.max(0, tab[i][T]);
    }
    const zRow = tab[m][T];
    return {
      variables: vars,
      objectiveValue: _isMax ? zRow : -zRow,
    };
  }

  _solText(it) {
    if (!it.solution) return '–';
    const sol = it.solution;
    const parts = this.lp.variables.map(v => `${v} = ${fmt(sol.variables[v] ?? 0, 4)}`);
    return parts.join(',  ');
  }

  _tableauLines(it) {
    const { allVars, totalVars: T } = this;
    const tab   = it.tableau;
    const basis = it.basis;
    const m     = this.m;

    const colW  = 8;
    const rhsW  = 8;
    const hdr   = '  Basis | ' + allVars.slice(0, T).map(v => v.padStart(colW)).join('') + ' | ' + 'RHS'.padStart(rhsW);
    const sep   = '  ' + '─'.repeat(hdr.length - 2);

    const lines = [
      { type: 'log-tableau', text: hdr },
      { type: 'log-tableau', text: sep },
    ];

    for (let i = 0; i < m; i++) {
      let row = `  ${allVars[basis[i]].padEnd(5)} | `;
      for (let j = 0; j < T; j++) row += fmt(tab[i][j], 3).padStart(colW);
      row += ' | ' + fmt(tab[i][T], 3).padStart(rhsW);
      lines.push({ type: 'log-tableau', text: row });
    }
    lines.push({ type: 'log-tableau', text: sep });
    let zRow = `  ${'z'.padEnd(5)} | `;
    for (let j = 0; j < T; j++) zRow += fmt(tab[m][j], 3).padStart(colW);
    zRow += ' | ' + fmt(tab[m][T], 3).padStart(rhsW);
    lines.push({ type: 'log-tableau', text: zRow });
    lines.push({ type: 'log-tableau', text: '' });

    return lines;
  }
}
