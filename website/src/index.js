import { LPGenerator }     from './classes/LPGenerator.js';
import { SimplexSolver }   from './classes/Solver.js';
import { GraphVisualizer } from './classes/GraphVisualizer.js';
import { AiTeacher }       from './classes/AiTeacher.js';
import { CommandManager }  from './classes/CommandManager.js';
import {
  CONSTRAINT_COLORS,
  formatConstraint,
  formatLPText,
  appendMessage,
  showTypingIndicator,
  removeTypingIndicator,
  updateStatus,
  autoResize,
} from './utils/utils.js';

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   App state
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
let currentLP     = null;
let currentResult = null;
let explainStep   = 0;      // index into solver.iterations for "Explain Next Step"
let aiInputLocked = false;

let settings = { numVars: 2, solutionType: 'unique', numConstraints: 4 };

/** Set to true (developer mode) to auto-save a simplex log on every Generate.
 *  First Generate will prompt once to select the logfiles/ folder; every subsequent
 *  Generate saves there silently (folder handle is remembered in IndexedDB). */
const DEBUGMODE = true;

let _logDirHandle = null;

// ── Minimal IndexedDB helpers for persisting the log-folder handle ──
function _idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('lp-teacher', 1);
    r.onupgradeneeded = e => e.target.result.createObjectStore('handles');
    r.onsuccess = e => res(e.target.result);
    r.onerror   = e => rej(e.target.error);
  });
}
async function _idbGet(key) {
  try { const db = await _idbOpen(); return await new Promise((res, rej) => { const r = db.transaction('handles').objectStore('handles').get(key); r.onsuccess = e => res(e.target.result); r.onerror = e => rej(e.target.error); }); } catch { return undefined; }
}
async function _idbPut(key, val) {
  try { const db = await _idbOpen(); await new Promise((res, rej) => { const r = db.transaction('handles', 'readwrite').objectStore('handles').put(val, key); r.onsuccess = () => res(); r.onerror = e => rej(e.target.error); }); } catch {}
}

/** On startup: silently restore log directory handle from IndexedDB if permission still exists. */
async function initLogDir() {
  if (!DEBUGMODE || !('showDirectoryPicker' in window)) return;
  const handle = await _idbGet('logDir');
  if (!handle) return;
  const perm = await handle.queryPermission({ mode: 'readwrite' }).catch(() => 'denied');
  if (perm === 'granted' || perm === 'prompt') _logDirHandle = handle;
}

const solver     = new SimplexSolver();
const visualizer = new GraphVisualizer('viz-container');
const aiTeacher  = new AiTeacher();

// Wire visualizer face/line hover → highlight the matching constraint row in the LP panel
visualizer.setConstraintHoverCallback((idx, entering) => {
  const row = document.querySelector(`.constraint-row[data-idx="${idx - 1}"]`);
  if (entering) row?.classList.add('highlighted');
  else          row?.classList.remove('highlighted');
});

const cmdManager = new CommandManager({
  visualizer,
  highlightConstraintDOM:  (n)  => highlightConstraintRow(n, true),
  highlightObjectiveDOM:   ()   => highlightObjectiveRow(true),
  resetHighlightsDOM:      ()   => { highlightConstraintRow(0, false); highlightObjectiveRow(false); },
  scrollSolverToStep:      (n)  => { /* no visible log â€” just advance explain step visually */ },
  animatePath:             ()   => animatePath(),
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   DOM refs
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
const lpBody          = document.getElementById('lp-body');
const lpStatusTag     = document.getElementById('lp-status-tag');
const generateBtn     = document.getElementById('generate-btn');
const optionsToggleBtn= document.getElementById('options-toggle-btn');
const optionsPanel    = document.getElementById('options-panel');
const explainNextBtn  = document.getElementById('explain-next-btn');
const aiMessages      = document.getElementById('ai-messages');
const aiInput         = document.getElementById('ai-input');
const aiSendBtn       = document.getElementById('ai-send');
const vizResetBtn     = document.getElementById('viz-reset-btn');
const vizHint         = document.getElementById('viz-hint');
const constraintCount = document.getElementById('constraint-count');
const ccLabel         = document.getElementById('constraint-count-val');

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   OPTIONS PANEL toggle
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
optionsToggleBtn?.addEventListener('click', () => {
  optionsPanel.classList.toggle('open');
  optionsToggleBtn.classList.toggle('active');
});

/* â”€â”€ Option buttons â”€â”€ */
document.querySelectorAll('.opt-btn[data-vars]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.opt-btn[data-vars]').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    settings.numVars = parseInt(btn.dataset.vars);
  });
});

document.querySelectorAll('.opt-btn[data-sol]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.opt-btn[data-sol]').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    settings.solutionType = btn.dataset.sol;
  });
});

constraintCount?.addEventListener('input', () => {
  settings.numConstraints = parseInt(constraintCount.value);
  if (ccLabel) ccLabel.textContent = constraintCount.value;
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   GENERATE â†’ auto-solve â†’ auto AI intro
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
generateBtn?.addEventListener('click', async () => {
  // Close options panel if open
  optionsPanel?.classList.remove('open');
  optionsToggleBtn?.classList.remove('active');

  currentLP     = LPGenerator.generate(settings.numVars, settings.solutionType, settings.numConstraints);
  currentResult = null;
  explainStep   = 0;

  // Auto-solve immediately
  solver.setup(currentLP).solve();
  currentResult = solver.getResult();

  // Auto-save simplex log (silently, if log folder is set)
  autoSaveLog();

  // Update LP display + visualizer
  renderLPPanel();
  setLPStatus(
    solver.status === 'optimal'    ? 'Optimal'    :
    solver.status === 'infeasible' ? 'Infeasible' :
    solver.status === 'unbounded'  ? 'Unbounded'  : 'Solved',
    solver.status
  );
  vizHint.innerHTML = settings.numVars === 2
    ? `scroll to zoom &middot; <kbd class="mouse-btn">L</kbd> drag to pan`
    : `<kbd class="mouse-btn">L</kbd> hold to rotate &nbsp;&middot;&nbsp; <kbd class="mouse-btn">R</kbd> hold to pan`;

  // Reset explain button
  updateExplainBtn();

  // Update AI context and send intro message
  updateAIContext();
  sendAutoAiIntro();
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   LP PANEL rendering
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

function renderLPPanel() {
  if (!currentLP) {
    lpBody.innerHTML = `<div class="lp-empty">
      <i class="fas fa-magic" style="font-size:2rem;color:var(--accent-light-fg);margin-bottom:10px"></i>
      <p>Click <strong>Generate</strong> to create an LP problem.</p>
    </div>`;
    return;
  }

  const { objective, constraints, variables } = currentLP;

  /* â”€â”€ Objective â”€â”€ */
  const objTerms = objective.coefficients.map((c, i) => {
    const sign  = i === 0 ? (c < 0 ? '\u2212' : '') : (c < 0 ? ' \u2212 ' : ' + ');
    const abs   = Math.abs(c);
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

  /* â”€â”€ Constraints â”€â”€ */
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

  const nnHTML = `<div class="lp-nn">${variables.join(', ')} \u2265 0</div>`;

  lpBody.innerHTML = `
    ${objHTML}
    <div class="lp-constraints-section">
      <div class="lp-section-label">Constraints</div>
      <ul class="constraint-list" id="constraint-list">${consHTML}</ul>
      <button class="add-constraint-btn" id="add-con-btn">
        <i class="fas fa-plus"></i> Add constraint
      </button>
    </div>
    <div class="lp-nn-section">${nnHTML}</div>
    ${renderSolutionBox()}`;

  /* â”€â”€ Event delegation â”€â”€ */
  document.getElementById('constraint-list')?.addEventListener('click', conListClick);
  document.getElementById('add-con-btn')?.addEventListener('click', () => openConstraintEditor(-1));
  document.querySelector('.edit-obj-btn')?.addEventListener('click', openObjectiveEditor);

  /* â”€â”€ Hover highlights â”€â”€ */
  document.querySelectorAll('.constraint-row').forEach(row => {
    row.addEventListener('mouseenter', () => {
      const idx = parseInt(row.dataset.idx) + 1;
      visualizer.highlightConstraint(idx, true);  // true → show constraint plane
      row.classList.add('highlighted');
    });
    row.addEventListener('mouseleave', () => {
      const idx = parseInt(row.dataset.idx) + 1;
      visualizer.clearHighlight(idx, true);  // true → hide constraint plane
      row.classList.remove('highlighted');
    });
  });

  document.getElementById('lp-obj-row')?.addEventListener('mouseenter', () =>
    document.getElementById('lp-obj-row')?.classList.add('highlighted'));
  document.getElementById('lp-obj-row')?.addEventListener('mouseleave', () =>
    document.getElementById('lp-obj-row')?.classList.remove('highlighted'));

  /* â”€â”€ Update visualizer â”€â”€ */
  const path = (currentResult?.status === 'optimal') ? solver.getVertexPath() : [];
  visualizer.setLP(currentLP, path);
}

function renderSolutionBox() {
  if (!currentResult) return '';
  const { status, solution } = currentResult;
  if (status === 'infeasible') {
    return `<div class="solution-box infeasible">
      <div class="solution-title">\u2717 Infeasible</div>
      <div>The constraints cannot all be satisfied simultaneously.</div>
    </div>`;
  }
  if (status === 'unbounded') {
    return `<div class="solution-box unbounded">
      <div class="solution-title">\u26a0 Unbounded</div>
      <div>The objective grows without limit.</div>
    </div>`;
  }
  if (status === 'optimal' && solution) {
    const vars = currentLP.variables.map(v =>
      `<div class="solution-val">${v} = ${(solution.variables[v] ?? 0).toFixed(4)}</div>`
    ).join('');
    return `<div class="solution-box">
      <div class="solution-title">\u2713 Optimal</div>
      ${vars}
      <div class="solution-val">z* = ${solution.objectiveValue?.toFixed(6)}</div>
    </div>`;
  }
  return '';
}
/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   OBJECTIVE EDITING
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

function openObjectiveEditor() {
  document.querySelector('.obj-editor')?.remove();
  const { objective, variables } = currentLP;

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
    currentLP.objective = { type, coefficients: coeffs };
    currentResult = null;         // clear result before re-render
    solver.status  = 'idle';
    aiTeacher.updateContext(null, '', 'Not solved yet');
    explainStep    = 0;
    updateExplainBtn();
    renderLPPanel();
  });

  document.getElementById('lp-obj-row')?.after(editor);
  editor.querySelector('.obj-coeff')?.focus();
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   CONSTRAINT EDITING
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

function conListClick(e) {
  const row = e.target.closest('.constraint-row');
  if (!row) return;
  const idx = parseInt(row.dataset.idx);

  if (e.target.closest('.edit-btn')) {
    openConstraintEditor(idx);
  } else if (e.target.closest('.del-btn')) {
    currentLP.constraints.splice(idx, 1);
    currentResult = null;         // clear BEFORE render to avoid stale path
    solver.status  = 'idle';
    explainStep    = 0;
    updateExplainBtn();
    aiTeacher.updateContext(null, '', 'Not solved yet');
    renderLPPanel();
  }
}

function openConstraintEditor(idx) {
  const n   = currentLP ? currentLP.variables.length : 2;
  const con = idx >= 0 ? currentLP.constraints[idx] : {
    coefficients: Array(n).fill(1),
    sense: '<=',
    rhs:   10,
  };

  document.querySelector('.constraint-editor')?.remove();

  const editor = document.createElement('div');
  editor.className = 'constraint-editor';

  const varFields = con.coefficients.map((c, i) => `
    <input type="number" class="coeff-in" data-vi="${i}" value="${c}" step="1" />
    <span class="var-lbl">${currentLP.variables[i]}</span>
    ${i < n - 1 ? '<span style="color:var(--text-muted)">+</span>' : ''}
  `).join('');

  editor.innerHTML = `
    ${varFields}
    <select class="sense-sel">
      <option value="<=" ${con.sense === '<=' ? 'selected' : ''}>\u2264</option>
      <option value=">=" ${con.sense === '>=' ? 'selected' : ''}>\u2265</option>
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
    const sense  = editor.querySelector('.sense-sel').value;
    const rhs    = parseFloat(editor.querySelector('.rhs-in').value) || 0;
    const newCon = { coefficients: coeffs, sense, rhs };

    if (idx >= 0) {
      currentLP.constraints[idx] = newCon;
    } else {
      if (!currentLP) return;
      currentLP.constraints.push(newCon);
    }
    currentResult = null;         // clear BEFORE render
    solver.status  = 'idle';
    explainStep    = 0;
    updateExplainBtn();
    aiTeacher.updateContext(null, '', 'Not solved yet');
    renderLPPanel();
  });

  if (idx >= 0) {
    document.querySelector(`.constraint-row[data-idx="${idx}"]`)?.after(editor);
  } else {
    document.getElementById('add-con-btn')?.before(editor);
  }
  editor.querySelector('.coeff-in')?.focus();
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   EXPLAIN NEXT STEP
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

explainNextBtn?.addEventListener('click', async () => {
  if (aiInputLocked) return;
  if (!solver.iterations.length || explainStep >= solver.iterations.length) return;

  const iter = solver.iterations[explainStep];
  const prompt = buildStepPrompt(iter);

  // Advance before async work so double-clicks don't re-trigger same step
  explainStep++;
  updateExplainBtn();

  // Highlight current simplex vertex on visualizer
  const pathIdx = solver.getVertexPath().length > 0 ? explainStep - 1 : -1;
  visualizer.showStep(Math.max(0, pathIdx));

  // Show step marker in chat
  appendExplainMarker(iter);

  await sendAutoAiMessage(prompt);
});

function buildStepPrompt(iter) {
  switch (iter.type) {
    case 'initial':
      return `Explain the initial simplex tableau for this LP. What is the initial basic feasible solution? Where is this point on the polyhedron? Why do we use slack variables to start?`;
    case 'pivot':
      return `Explain simplex iteration ${iter.iteration}: Why was ${iter.entering} chosen as the entering variable? Why was ${iter.leaving} the leaving variable (min ratio test)? What is the new basic feasible solution and what does this vertex look like on the polyhedron?`;
    case 'optimal':
      return `The simplex method has reached the optimal solution! Explain why this point is optimal (all reduced costs >= 0), what the optimal objective value means, and describe this corner geometrically on the polyhedron.`;
    case 'infeasible':
      return `The LP is infeasible. Explain what this means: the feasible region is empty. How did the Big-M method detect this? What does it look like geometrically?`;
    case 'unbounded':
      return `The LP is unbounded. Explain what this means geometrically (feasible region extends infinitely in the improving direction) and how the min-ratio test detected it (no positive denominator entries).`;
    default:
      return `Describe the current state of the simplex algorithm.`;
  }
}

function appendExplainMarker(iter) {
  const label =
    iter.type === 'initial'    ? 'Initial Setup' :
    iter.type === 'pivot'      ? `Iteration ${iter.iteration}` :
    iter.type === 'optimal'    ? 'Optimal Solution' :
    iter.type === 'infeasible' ? 'Infeasibility Analysis' :
    iter.type === 'unbounded'  ? 'Unbounded Case' : 'Next Step';

  const div = document.createElement('div');
  div.className = 'ai-explain-marker';
  div.innerHTML = `<i class="fas fa-chalkboard-teacher"></i> Explaining: <strong>${label}</strong>`;
  aiMessages.appendChild(div);
  aiMessages.scrollTop = aiMessages.scrollHeight;
}

function updateExplainBtn() {
  if (!explainNextBtn) return;

  if (!solver.iterations.length) {
    explainNextBtn.disabled = true;
    explainNextBtn.innerHTML = '<i class="fas fa-chalkboard-teacher"></i> Explain Next Step &rarr;';
    return;
  }

  if (explainStep >= solver.iterations.length) {
    explainNextBtn.disabled = true;
    explainNextBtn.innerHTML = '<i class="fas fa-check-circle"></i> All Steps Explained';
    return;
  }

  const next  = solver.iterations[explainStep];
  const label =
    next.type === 'initial'    ? 'Initial Setup' :
    next.type === 'pivot'      ? `Iteration ${next.iteration}` :
    next.type === 'optimal'    ? 'Optimal Solution' :
    next.type === 'infeasible' ? 'Infeasibility' :
    next.type === 'unbounded'  ? 'Unbounded Case' : 'Next Step';

  explainNextBtn.disabled = false;
  explainNextBtn.innerHTML =
    `<i class="fas fa-chalkboard-teacher"></i> Explain: ${label} &rarr;`;
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   AI â€” auto intro (after generate)
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

async function sendAutoAiIntro() {
  const { status, solution } = currentResult ?? {};
  const solInfo =
    status === 'optimal'
      ? `optimal solution found: z* = ${solution?.objectiveValue?.toFixed(4)}, ${currentLP.variables.map(v => `${v} = ${(solution.variables[v] ?? 0).toFixed(3)}`).join(', ')}`
      : status === 'infeasible' ? 'the LP is infeasible (empty feasible region)'
      : status === 'unbounded'  ? 'the LP is unbounded'
      : 'unknown status';

  const prompt =
    `Give a brief educational introduction to this LP problem (2-4 sentences): ` +
    `what type of LP it is, what the objective and constraints mean, and state the result (${solInfo}). ` +
    `End with: "Click 'Explain: Initial Setup ->' to start the simplex walkthrough!"`;

  await sendAutoAiMessage(prompt);
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   AI â€” shared auto-send (no user bubble)
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

async function sendAutoAiMessage(prompt) {
  aiInputLocked      = true;
  aiSendBtn.disabled = true;
  explainNextBtn && (explainNextBtn.disabled = true);

  showTypingIndicator(aiMessages);

  try {
    const raw   = await aiTeacher.ask(prompt);
    removeTypingIndicator();
    const clean = cmdManager.parseAndExecute(raw);
    appendMessage(aiMessages, 'assistant', clean);
  } catch (err) {
    removeTypingIndicator();
    const msg = err.message.includes('fetch')
      ? 'Could not reach the Ollama server. Make sure Ollama is running and <code>llama3.2</code> is available.'
      : `Error: ${err.message}`;
    appendMessage(aiMessages, 'assistant', `âš ï¸ ${msg}`);
    updateStatus('offline');
  } finally {
    aiInputLocked      = false;
    aiSendBtn.disabled = false;
    updateExplainBtn(); // re-enable if steps remain
  }
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   AI â€” manual user chat
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

aiSendBtn?.addEventListener('click', sendUserMessage);
aiInput?.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendUserMessage(); }
});
aiInput?.addEventListener('input', () => autoResize(aiInput));

async function sendUserMessage() {
  const text = aiInput.value.trim();
  if (!text || aiInputLocked) return;

  aiInput.value = '';
  autoResize(aiInput);
  aiInputLocked      = true;
  aiSendBtn.disabled = true;

  appendMessage(aiMessages, 'user', text);
  showTypingIndicator(aiMessages);

  try {
    const raw   = await aiTeacher.ask(text);
    removeTypingIndicator();
    const clean = cmdManager.parseAndExecute(raw);
    appendMessage(aiMessages, 'assistant', clean);
  } catch (err) {
    removeTypingIndicator();
    const msg = err.message.includes('fetch')
      ? 'Could not reach the Ollama server. Make sure Ollama is running and <code>llama3.2</code> is available.'
      : `Error: ${err.message}`;
    appendMessage(aiMessages, 'assistant', `âš ï¸ ${msg}`);
    updateStatus('offline');
  } finally {
    aiInputLocked      = false;
    aiSendBtn.disabled = false;
    aiInput.focus();
  }
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   LOG FILE — auto-saved on every Generate
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

async function autoSaveLog() {
  if (!DEBUGMODE || !currentLP || !currentResult) return;

  // First Generate: ask user to select the logfiles/ folder once.
  // After that (and in future sessions via IndexedDB), saves happen silently.
  if (!_logDirHandle) {
    if (!('showDirectoryPicker' in window)) return;
    try {
      _logDirHandle = await window.showDirectoryPicker({ id: 'lp-logfiles', mode: 'readwrite' });
      await _idbPut('logDir', _logDirHandle);
    } catch (e) {
      if (e.name !== 'AbortError') console.warn('Log folder not selected:', e);
      return;
    }
  }

  const ts      = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fname   = `simplex_${ts}.txt`;
  const header  = `LP Simplex Log -- ${new Date().toLocaleString()}\n` +
    `${'='.repeat(60)}\n\n` + formatLPText(currentLP) + '\n' +
    `${'='.repeat(60)}\n\n`;
  const content = header + solver.generateLog().map(l => l.text).join('\n');

  try {
    const fh = await _logDirHandle.getFileHandle(fname, { create: true });
    const wr = await fh.createWritable();
    await wr.write(content);
    await wr.close();
  } catch (e) {
    console.warn('Log save failed:', e);
    if (e.name === 'NotAllowedError') { _logDirHandle = null; await _idbPut('logDir', null); }
  }
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   Helpers
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

function updateAIContext() {
  if (!currentLP) return;
  const logText = solver.generateLog().map(l => l.text).join('\n');
  aiTeacher.updateContext(currentLP, logText, solver.status);
}

function setLPStatus(label, type) {
  if (!lpStatusTag) return;
  lpStatusTag.textContent = label;
  lpStatusTag.className   = 'tag ' + (
    type === 'optimal'    ? 'ok'    :
    type === 'infeasible' ? 'danger':
    type === 'unbounded'  ? 'warn'  : ''
  );
}

function highlightConstraintRow(n, on) {
  if (n === 0 || !on) {
    document.querySelectorAll('.constraint-row').forEach(r => r.classList.remove('highlighted'));
    return;
  }
  const row = document.querySelector(`.constraint-row[data-idx="${n - 1}"]`);
  row?.classList.toggle('highlighted', on);
}

function highlightObjectiveRow(on) {
  document.getElementById('lp-obj-row')?.classList.toggle('highlighted', on);
}

function animatePath() {
  const path = solver.getVertexPath();
  if (path.length < 2) return;
  let step = 0;
  const tick = () => {
    visualizer.showStep(step);
    step++;
    if (step < path.length) setTimeout(tick, 700);
    else setTimeout(() => visualizer.showStep(-1), 900);
  };
  tick();
}

vizResetBtn?.addEventListener('click', () => visualizer.resetView());
window.addEventListener('resize', () => visualizer.resize());

// Restore log directory from IndexedDB (session-persistent)
if (DEBUGMODE) initLogDir();

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   AI availability check on load
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
updateStatus('checking');
aiTeacher.checkAvailability().then(state => {
  updateStatus(state);
  if (state === 'missing') {
    appendMessage(aiMessages, 'assistant',
      'â„¹ï¸ Ollama is running but <strong>llama3.2</strong> is not installed.<br>' +
      'Run: <code>ollama pull llama3.2</code>, then refresh.'
    );
  } else if (state === 'offline') {
    appendMessage(aiMessages, 'assistant',
      'â„¹ï¸ Ollama is not running. The AI teacher requires it.<br>' +
      'Install: <a href="https://ollama.com" target="_blank">ollama.com</a><br>' +
      'Then: <code>ollama pull llama3.2</code>'
    );
  }
});

