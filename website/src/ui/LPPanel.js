import { CONSTRAINT_COLORS, formatConstraint, fmt } from '../utils/utils.js';

/**
 * LPPanel — owns all LP problem display and inline editing UI.
 *
 * Deps injected via constructor:
 *   visualizer  — GraphVisualizer instance (for constraint hover)
 *   onLPChanged — called with (newLP) after any user edit
 */
export class LPPanel {
  constructor(bodyId, { visualizer, onLPChanged, settings, onGenerate }) {
    this.bodyEl        = document.getElementById(bodyId);
    this._visualizer   = visualizer;
    this._onLPChanged  = onLPChanged;
    this._settings     = settings ?? { numVars: 2, solutionType: 'unique', numConstraints: 4 };
    this._onGenerate   = onGenerate ?? (() => {});
    this._lp           = null;
    this._result       = null;
    this._render(); // show empty state on page load
  }

  /* ── Public API ── */

  render(lp, result) {
    this._lp     = lp;
    this._result = result;
    this._render();
  }

  /* ── Internal render ── */

  _render() {
    if (!this._lp) {
      const s = this._settings;
      const selV   = (n) => s.numVars === n       ? 'selected' : '';
      const selSol = (v) => s.solutionType === v   ? 'selected' : '';
      this.bodyEl.innerHTML = `
        <div class="lp-start">
          <div class="lp-start-hero">
            <div class="lp-start-icon"><i class="fas fa-chart-line"></i></div>
            <div class="lp-start-title">Linear Programming</div>
            <div class="lp-start-sub">Choose your settings, generate a problem, then guide simplex step by step.</div>
          </div>
          <button class="btn btn-generate lp-start-gen" id="lp-body-gen">
            <i class="fas fa-bolt"></i> Generate LP Problem
          </button>
          <div class="lp-start-opts">
            <div class="ctrl-group">
              <div class="ctrl-label">Variables</div>
              <div class="ctrl-row">
                <button class="opt-btn ${selV(2)}" data-bvars="2">2 variables</button>
                <button class="opt-btn ${selV(3)}" data-bvars="3">3 variables</button>
              </div>
            </div>
            <div class="ctrl-group">
              <div class="ctrl-label">Solution Type</div>
              <div class="ctrl-row">
                <button class="opt-btn ${selSol('unique')}"     data-bsol="unique">Unique</button>
                <button class="opt-btn ${selSol('multiple')}"   data-bsol="multiple">Multiple</button>
                <button class="opt-btn ${selSol('infeasible')}" data-bsol="infeasible">Infeasible</button>
              </div>
            </div>
            <div class="ctrl-group">
              <div class="ctrl-label">Constraints&nbsp;<span class="ctrl-count" id="lp-bcc-val">${s.numConstraints}</span></div>
              <input type="range" class="range-input" id="lp-bcc" min="2" max="8" value="${s.numConstraints}" />
            </div>
          </div>
        </div>`;

      document.getElementById('lp-body-gen')?.addEventListener('click', () => this._onGenerate());

      document.querySelectorAll('[data-bvars]').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('[data-bvars]').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          s.numVars = parseInt(btn.dataset.bvars);
          document.querySelectorAll('.opt-btn[data-vars]').forEach(b =>
            b.classList.toggle('selected', b.dataset.vars === btn.dataset.bvars));
        });
      });

      document.querySelectorAll('[data-bsol]').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('[data-bsol]').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          s.solutionType = btn.dataset.bsol;
          document.querySelectorAll('.opt-btn[data-sol]').forEach(b =>
            b.classList.toggle('selected', b.dataset.sol === btn.dataset.bsol));
        });
      });

      const bSlider = document.getElementById('lp-bcc');
      const bLabel  = document.getElementById('lp-bcc-val');
      bSlider?.addEventListener('input', () => {
        s.numConstraints = parseInt(bSlider.value);
        if (bLabel) bLabel.textContent = bSlider.value;
        const hSlider = document.getElementById('constraint-count');
        const hLabel  = document.getElementById('constraint-count-val');
        if (hSlider) hSlider.value = bSlider.value;
        if (hLabel)  hLabel.textContent = bSlider.value;
      });

      return;
    }

    const { objective, constraints, variables } = this._lp;

    /* Objective line */
    const objTerms = objective.coefficients.map((c, i) => {
      const sign = i === 0 ? (c < 0 ? '−' : '') : (c < 0 ? ' − ' : ' + ');
      const abs  = Math.abs(c);
      return `${sign}<span class="coeff">${abs === 1 ? '' : abs}</span><span class="obj-var">${variables[i]}</span>`;
    }).join('');

    const objHTML = `
      <div class="lp-obj-section">
        <div class="lp-section-label">Objective</div>
        <div class="lp-obj-line" id="lp-obj-row">
          <span class="obj-type">${objective.type.toUpperCase()}</span>
          ${objTerms}
          <div class="c-actions">
            <button class="btn-icon edit-obj-btn" title="Edit objective"><i class="fas fa-pen"></i></button>
          </div>
        </div>
      </div>`;

    const consHTML = constraints.map((con, i) => {
      const color = CONSTRAINT_COLORS[i % CONSTRAINT_COLORS.length];
      return `
        <li class="constraint-row" data-idx="${i}"
            style="--c-color:${color};--c-bg:var(--c${i+1}-bg, rgba(92,110,248,0.1))"
            title="Hover to highlight on visualizer">
          <span class="c-badge">${i + 1}</span>
          <span class="c-expr">${formatConstraint(con, variables)}</span>
          <div class="c-actions">
            <button class="btn-icon edit-btn" title="Edit"><i class="fas fa-pen"></i></button>
            <button class="btn-icon del-btn" title="Delete" style="color:var(--red)"><i class="fas fa-trash-alt"></i></button>
          </div>
        </li>`;
    }).join('');

    const nnHTML  = `<div class="lp-nn">${variables.join(', ')} ≥ 0</div>`;

    this.bodyEl.innerHTML = `
      ${objHTML}
      <div class="lp-constraints-section">
        <div class="lp-section-label">Constraints</div>
        <ul class="constraint-list" id="constraint-list">${consHTML}</ul>
        <button class="add-constraint-btn" id="add-con-btn">
          <i class="fas fa-plus"></i> Add constraint
        </button>
      </div>
      <div class="lp-nn-section">${nnHTML}</div>`;

    this._attachEvents();
  }

  _attachEvents() {
    /* Constraint list delegation */
    document.getElementById('constraint-list')?.addEventListener('click', e => this._conListClick(e));
    document.getElementById('add-con-btn')?.addEventListener('click', () => this._openConstraintEditor(-1));
    document.querySelector('.edit-obj-btn')?.addEventListener('click', () => this._openObjectiveEditor());

    /* Constraint row hover → visualizer highlight */
    document.querySelectorAll('.constraint-row').forEach(row => {
      row.addEventListener('mouseenter', () => {
        const idx = parseInt(row.dataset.idx) + 1;
        this._visualizer.highlightConstraint(idx, true);
        row.classList.add('highlighted');
      });
      row.addEventListener('mouseleave', () => {
        const idx = parseInt(row.dataset.idx) + 1;
        this._visualizer.clearHighlight(idx, true);
        row.classList.remove('highlighted');
      });
    });

    /* Objective row hover */
    const objRow = document.getElementById('lp-obj-row');
    objRow?.addEventListener('mouseenter', () => objRow.classList.add('highlighted'));
    objRow?.addEventListener('mouseleave', () => objRow.classList.remove('highlighted'));
  }

  /* ── Constraint list click handler ── */

  _conListClick(e) {
    const row = e.target.closest('.constraint-row');
    if (!row) return;
    const idx = parseInt(row.dataset.idx);
    if (e.target.closest('.edit-btn')) {
      this._openConstraintEditor(idx);
    } else if (e.target.closest('.del-btn')) {
      this._lp.constraints.splice(idx, 1);
      this._onLPChanged(this._lp);
    }
  }

  /* ── Objective editor ── */

  _openObjectiveEditor() {
    document.querySelector('.obj-editor')?.remove();
    const { objective, variables } = this._lp;

    const editor = document.createElement('div');
    editor.className = 'constraint-editor obj-editor';

    const varFields = objective.coefficients.map((c, i) => `
      <input type="number" class="coeff-in obj-coeff" data-vi="${i}" value="${c}" step="1" />
      <span class="var-lbl">${variables[i]}</span>
      ${i < variables.length - 1 ? '<span style="color:var(--text-muted)">+</span>' : ''}
    `).join('');

    editor.innerHTML = `
      <select class="sense-sel obj-type-sel">
        <option value="max" ${objective.type === 'max' ? 'selected' : ''}>max</option>
        <option value="min" ${objective.type === 'min' ? 'selected' : ''}>min</option>
      </select>
      <span class="op" style="font-family:var(--font-mono)">z =</span>
      ${varFields}
      <div class="editor-btns">
        <button class="btn-save obj-save">&#10003; Save</button>
        <button class="btn-cancel obj-cancel">&#10005;</button>
      </div>`;

    editor.querySelector('.obj-cancel').addEventListener('click', () => editor.remove());
    editor.querySelector('.obj-save').addEventListener('click', () => {
      const type   = editor.querySelector('.obj-type-sel').value;
      const coeffs = Array.from(editor.querySelectorAll('.obj-coeff'))
        .map(inp => parseFloat(inp.value) || 0);
      this._lp.objective = { type, coefficients: coeffs };
      this._onLPChanged(this._lp);
    });

    document.getElementById('lp-obj-row')?.after(editor);
    editor.querySelector('.obj-coeff')?.focus();
  }

  /* ── Constraint editor ── */

  _openConstraintEditor(idx) {
    document.querySelector('.constraint-editor')?.remove();
    const n   = this._lp ? this._lp.variables.length : 2;
    const con = idx >= 0 ? this._lp.constraints[idx] : {
      coefficients: Array(n).fill(1),
      sense: '<=',
      rhs: 10,
    };

    const editor = document.createElement('div');
    editor.className = 'constraint-editor';

    const varFields = con.coefficients.map((c, i) => `
      <input type="number" class="coeff-in" data-vi="${i}" value="${c}" step="1" />
      <span class="var-lbl">${this._lp.variables[i]}</span>
      ${i < n - 1 ? '<span style="color:var(--text-muted)">+</span>' : ''}
    `).join('');

    editor.innerHTML = `
      ${varFields}
      <select class="sense-sel">
        <option value="<=" ${con.sense === '<=' ? 'selected' : ''}>≤</option>
        <option value=">=" ${con.sense === '>=' ? 'selected' : ''}>≥</option>
        <option value="="  ${con.sense === '='  ? 'selected' : ''}>=</option>
      </select>
      <input type="number" class="rhs-in" value="${con.rhs}" step="1" />
      <div class="editor-btns">
        <button class="btn-save">&#10003; Save</button>
        <button class="btn-cancel">&#10005;</button>
      </div>`;

    editor.querySelector('.btn-cancel').addEventListener('click', () => editor.remove());
    editor.querySelector('.btn-save').addEventListener('click', () => {
      const coeffs = Array.from(editor.querySelectorAll('.coeff-in'))
        .map(inp => parseFloat(inp.value) || 0);
      const sense = editor.querySelector('.sense-sel').value;
      const rhs   = parseFloat(editor.querySelector('.rhs-in').value) || 0;
      if (idx >= 0) {
        this._lp.constraints[idx] = { coefficients: coeffs, sense, rhs };
      } else {
        if (!this._lp) return;
        this._lp.constraints.push({ coefficients: coeffs, sense, rhs });
      }
      this._onLPChanged(this._lp);
    });

    if (idx >= 0) {
      document.querySelector(`.constraint-row[data-idx="${idx}"]`)?.after(editor);
    } else {
      document.getElementById('add-con-btn')?.before(editor);
    }
    editor.querySelector('.coeff-in')?.focus();
  }

  /* ── Highlight helpers (used by CommandManager callbacks) ── */

  highlightConstraintRow(n, on) {
    if (n === 0 || !on) {
      document.querySelectorAll('.constraint-row').forEach(r => r.classList.remove('highlighted'));
      return;
    }
    document.querySelector(`.constraint-row[data-idx="${n - 1}"]`)?.classList.toggle('highlighted', on);
  }

  highlightObjectiveRow(on) {
    document.getElementById('lp-obj-row')?.classList.toggle('highlighted', on);
  }
}
