/**
 * SimplexTableau — renders the current simplex tableau in a DOM container.
 * Caller provides the solver and an iteration index; this class handles display only.
 */
export class SimplexTableau {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this._currentIdx = 0;
  }

  /** Render solver iteration at iterIdx (defaults to current internal index). */
  render(solver, iterIdx) {
    if (!this.container) return;
    if (!solver?.iterations?.length) { this._showEmpty(); return; }

    const idx = Math.max(0, Math.min(iterIdx ?? this._currentIdx, solver.iterations.length - 1));
    this._currentIdx = idx;
    const iter    = solver.iterations[idx];
    const allVars = solver.allVars;
    const T       = solver.totalVars;
    const m       = iter.tableau.length - 1;   // # constraint rows

    /* ── Column headers ── */
    const colHeaders = allVars.slice(0, T).map((v, j) => {
      const cls = iter.type === 'pivot' && j === iter.pivCol ? 'class="tc-piv-col"' : '';
      return `<th ${cls}>${v}</th>`;
    }).join('');

    /* ── Data rows ── */
    const bodyRows = iter.tableau.map((row, i) => {
      const label = i === m ? 'z' : allVars[iter.basis[i]];
      const cells = row.slice(0, T + 1).map((val, j) => {
        let cls = '';
        if (iter.type === 'pivot') {
          if      (i === iter.pivRow && j === iter.pivCol) cls = 'tc-piv-elem';
          else if (i === iter.pivRow)                      cls = 'tc-piv-row';
          else if (j === iter.pivCol)                      cls = 'tc-piv-col';
        }
        return `<td${cls ? ` class="${cls}"` : ''}>${fmtCell(val)}</td>`;
      }).join('');
      return `<tr><th>${label}</th>${cells}</tr>`;
    }).join('');

    /* ── Footer ── */
    const sol  = iter.solution;
    const vars = solver.lp?.variables ?? [];
    const corner = sol ? `(${vars.map(v => fmtShort(sol.variables[v] ?? 0)).join(', ')})` : '';
    const zVal   = sol ? `z = ${fmtShort(sol.objectiveValue ?? 0)}` : '';
    const label  =
      iter.type === 'initial'    ? 'Iteration 0' :
      iter.type === 'pivot'      ? `Iteration ${iter.iteration}` :
      iter.type === 'optimal'    ? 'Optimal' :
      iter.type === 'infeasible' ? 'Infeasible' : 'Unbounded';

    this.container.innerHTML = `
      <div class="tableau-scroll">
        <table class="simplex-tab">
          <thead>
            <tr>
              <th></th>${colHeaders}<th>rhs</th>
            </tr>
          </thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>
      <div class="tableau-footer">
        <span class="tf-iter">${label}</span>
        ${corner ? `<span class="tf-corner">${corner}</span>` : ''}
        ${zVal   ? `<span class="tf-z">${zVal}</span>` : ''}
      </div>`;
  }

  clear() { this._showEmpty(); }

  _showEmpty() {
    if (!this.container) return;
    this.container.innerHTML = `
      <div class="tableau-empty">
        <i class="fas fa-table"></i>
        <p>Generate an LP to see the simplex tableau.</p>
      </div>`;
  }
}

/* ── Formatting helpers ── */

function fmtCell(val) {
  if (Math.abs(val) < 1e-9) return '0';
  const r = Math.round(val * 1e4) / 1e4;
  if (Math.abs(r) >= 1e5) return r.toExponential(1);
  const s = r.toString();
  const dot = s.indexOf('.');
  if (dot >= 0 && s.length - dot > 5) return r.toFixed(4).replace(/\.?0+$/, '');
  return s;
}

function fmtShort(val) {
  const r = Math.round(val * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/\.?0+$/, '');
}
