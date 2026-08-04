import { LPGenerator }      from './classes/LPGenerator.js';
import { SimplexSolver }    from './classes/Solver.js';
import { GraphVisualizer }  from './classes/GraphVisualizer.js';
import { AiTeacher }        from './classes/AiTeacher.js';
import { CommandManager }   from './classes/CommandManager.js';
import { LPPanel }          from './ui/LPPanel.js';
import { AIPanel }          from './ui/AIPanel.js';
import { SimplexTableau }   from './ui/SimplexTableau.js';
import { updateStatus } from './utils/utils.js';

/* ══════════════════════════════════════════
   App state
   ══════════════════════════════════════════ */
let currentLP     = null;
let currentResult = null;
let settings      = { numVars: 2, solutionType: 'unique', numConstraints: 4 };

/* ══════════════════════════════════════════
   Class instances
   ══════════════════════════════════════════ */
const solver     = new SimplexSolver();
const visualizer = new GraphVisualizer('viz-container');
const aiTeacher  = new AiTeacher();
const tableau    = new SimplexTableau('tableau-container');

// Wire visualizer face/line hover → LP panel constraint highlight
visualizer.setConstraintHoverCallback((idx, entering) => {
  const row = document.querySelector(`.constraint-row[data-idx="${idx - 1}"]`);
  if (entering) row?.classList.add('highlighted');
  else          row?.classList.remove('highlighted');
});

const lpPanel = new LPPanel('lp-body', {
  visualizer,
  onLPChanged: handleLPChanged,
  settings,
  onGenerate: () => generateBtn?.click(),
});

const cmdManager = new CommandManager({
  visualizer,
  highlightConstraintDOM:  (n)  => lpPanel.highlightConstraintRow(n, true),
  highlightObjectiveDOM:   ()   => lpPanel.highlightObjectiveRow(true),
  resetHighlightsDOM:      ()   => { lpPanel.highlightConstraintRow(0, false); lpPanel.highlightObjectiveRow(false); },
  scrollSolverToStep:      ()   => {},
  animatePath:             ()   => animatePath(),
});

const aiPanel = new AIPanel({
  aiTeacher,
  cmdManager,
  onExplainClick: (step) => {
    // Sync visualizer step + tableau when "Explain" button fires
    const pathIdx = solver.getVertexPath().length > 0 ? step : -1;
    visualizer.showStep(Math.max(0, pathIdx));
    tableau.render(solver, step);
  },
});

/* ══════════════════════════════════════════
   DOM refs
   ══════════════════════════════════════════ */
const generateBtn      = document.getElementById('generate-btn');
const optionsToggleBtn = document.getElementById('options-toggle-btn');
const optionsPanel     = document.getElementById('options-panel');
const vizResetBtn      = document.getElementById('viz-reset-btn');
const vizHint          = document.getElementById('viz-hint');
const constraintCount  = document.getElementById('constraint-count');
const ccLabel          = document.getElementById('constraint-count-val');
const aiToggleBtn      = document.getElementById('ai-toggle-btn');
const aiFloat          = document.getElementById('ai-float');

/* ══════════════════════════════════════════
   AI TEACHER TOGGLE
   ══════════════════════════════════════════ */
let _aiFloatOpen = false;
aiToggleBtn?.addEventListener('click', () => {
  if (_aiFloatOpen) {
    aiFloat?.classList.add('closing');
    aiToggleBtn?.classList.remove('active');
    setTimeout(() => { aiFloat?.classList.remove('open', 'closing'); _aiFloatOpen = false; }, 200);
  } else {
    aiFloat?.classList.add('open');
    aiToggleBtn?.classList.add('active');
    _aiFloatOpen = true;
  }
});

/* Close AI float when clicking outside of it */
document.addEventListener('click', (e) => {
  if (_aiFloatOpen && aiFloat && aiToggleBtn
      && !aiFloat.contains(e.target) && !aiToggleBtn.contains(e.target)) {
    aiFloat.classList.add('closing');
    aiToggleBtn.classList.remove('active');
    setTimeout(() => { aiFloat.classList.remove('open', 'closing'); _aiFloatOpen = false; }, 200);
  }
});

/* ══════════════════════════════════════════
   OPTIONS PANEL
   ══════════════════════════════════════════ */
optionsToggleBtn?.addEventListener('click', () => {
  optionsPanel.classList.toggle('open');
  optionsToggleBtn.classList.toggle('active');
});

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

/* ══════════════════════════════════════════
   GENERATE
   ══════════════════════════════════════════ */
generateBtn?.addEventListener('click', async () => {
  optionsPanel?.classList.remove('open');
  optionsToggleBtn?.classList.remove('active');

  currentLP     = LPGenerator.generate(settings.numVars, settings.solutionType, settings.numConstraints);
  currentResult = null;

  solver.setup(currentLP).solve();
  currentResult = solver.getResult();

  afterSolve();
  aiPanel.sendAutoIntro();
});

/* ══════════════════════════════════════════
   LP changed (user edited constraint/objective)
   ══════════════════════════════════════════ */
function handleLPChanged(newLP) {
  currentLP = newLP;
  solver.setup(currentLP).solve();
  currentResult = solver.getResult();
  afterSolve();
}

/* ══════════════════════════════════════════
   After any (re)solve — update all panels
   ══════════════════════════════════════════ */
function afterSolve() {
  const leftStack = document.querySelector('.left-stack');
  const mainGrid  = document.querySelector('.main-grid');

  // Render content first while lp-empty still clips the tableau to 46px,
  // then remove lp-empty so the max-height transition reveals the content.
  lpPanel.render(currentLP, currentResult);
  tableau.render(solver, 0);

  if (vizHint) {
    const m1 = `<img class="mouse-btn-img" src="website/assets/images/m1_key.svg" alt="M1">`;
    const m2 = `<img class="mouse-btn-img mouse-btn-m2" src="website/assets/images/m1_key.svg" alt="M2">`;
    vizHint.innerHTML = settings.numVars === 2
      ? `scroll to zoom &middot; ${m1} drag to pan`
      : `${m1} hold to rotate &nbsp;&middot;&nbsp; ${m2} hold to pan`;
  }

  leftStack?.classList.remove('lp-empty');
  mainGrid?.classList.remove('lp-empty');

  const path = solver.status === 'optimal' ? solver.getVertexPath() : [];
  visualizer.setLP(currentLP, path);

  refreshOptionPoints(0);

  const logText = solver.generateLog().map(l => l.text).join('\n');
  aiTeacher.updateContext(currentLP, logText, solver.status);
  aiPanel.setSolverState(solver, currentLP, currentResult);
}

/* ══════════════════════════════════════════
   Option points (Task 3)
   ══════════════════════════════════════════ */

/**
 * Show clickable option points adjacent to the vertex at stepIdx in the
 * solver path.  Students must click the point simplex will move to next.
 */
function refreshOptionPoints(stepIdx) {
  const path = solver.getVertexPath();

  if (!path.length || solver.status !== 'optimal') {
    visualizer.clearOptionPoints();
    return;
  }

  const currentPt = path[stepIdx] ?? path[0];

  if (stepIdx >= path.length - 1) {
    // Reached the end — highlight optimal, no more options
    visualizer.clearOptionPoints();
    visualizer.showStep(path.length - 1);
    return;
  }

  const optionPts = getAdjacentVertices(currentPt, visualizer.vertices, currentLP);

  visualizer.setOptionPoints(currentPt, optionPts, (clickedPt) => {
    const correctPt = path[stepIdx + 1];
    if (!correctPt) return;

    if (samePoint(clickedPt, correctPt)) {
      // Correct answer — unlock chat so student can now ask questions
      aiPanel.unlockChat();
      // Find iteration index where we arrive at this vertex
      const iterIdx = solver.iterations.findIndex(it =>
        it.solution && samePoint(
          currentLP.variables.map(v => it.solution.variables[v] ?? 0),
          correctPt,
        )
      );
      const displayIdx = iterIdx >= 0 ? iterIdx : stepIdx + 1;
      tableau.render(solver, displayIdx);
      aiPanel.advanceExplainStep();
      aiPanel.explainIteration(displayIdx);
      refreshOptionPoints(stepIdx + 1);
    } else {
      // Wrong — nudge student via AI
      const hintPrompt =
        `The student clicked the wrong vertex on the polyhedron. Give a short hint (1-2 sentences) ` +
        `about why simplex doesn't move there next, without revealing the correct answer.`;
      aiPanel.sendAutoMessage(hintPrompt);
    }
  });
}

function samePoint(a, b, tol = 1e-5) {
  if (!a || !b || a.length !== b.length) return false;
  return Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0)) < tol;
}

function getAdjacentVertices(currentPt, allVertices, lp) {
  const dim = currentPt.length;
  const allCons = [
    ...lp.constraints,
    { coefficients: dim === 2 ? [-1, 0] : [-1, 0, 0], sense: '<=', rhs: 0 },
    { coefficients: dim === 2 ? [0, -1] : [0, -1, 0], sense: '<=', rhs: 0 },
    ...(dim === 3 ? [{ coefficients: [0, 0, -1], sense: '<=', rhs: 0 }] : []),
  ];

  const isActive = (pt, con) =>
    Math.abs(con.coefficients.reduce((s, a, i) => s + a * pt[i], 0) - con.rhs) < 1e-5;

  const activeCons = allCons.filter(con => isActive(currentPt, con));
  const minShared  = dim === 2 ? 1 : 2;

  return allVertices.filter(v => {
    if (samePoint(v, currentPt)) return false;
    return activeCons.filter(con => isActive(v, con)).length >= minShared;
  });
}

/* ══════════════════════════════════════════
   Helpers
   ══════════════════════════════════════════ */
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

/* ══════════════════════════════════════════
   AI init
   ══════════════════════════════════════════ */
updateStatus('checking');

async function initializeAI() {
  try {
    await aiTeacher.init((p) => updateStatus(`loading: ${(p.progress * 100).toFixed(0)}%`));
    updateStatus('online');
  } catch (error) {
    console.error('Failed to load WebLLM:', error);
    updateStatus('offline');
    const msgs = document.getElementById('ai-messages');
    if (msgs) {
      const div = document.createElement('div');
      div.className = 'ai-msg assistant';
      div.innerHTML = `<div class="ai-avatar"><i class="fas fa-robot"></i></div>
        <div class="ai-bubble">Failed to load the AI model. Ensure you are on a modern browser.</div>`;
      msgs.appendChild(div);
    }
  }
}

initializeAI();

