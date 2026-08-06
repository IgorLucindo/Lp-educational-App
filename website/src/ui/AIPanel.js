import {
  appendMessage,
  showTypingIndicator,
  removeTypingIndicator,
  updateStatus,
  autoResize,
} from '../utils/utils.js';

/** Format a number compactly for local explanation messages. */
function fmtNum(v) {
  if (v == null || !isFinite(v)) return '?';
  const r = Math.round(v * 1000) / 1000;
  return Number.isInteger(r) ? String(r) : r.toFixed(3).replace(/\.?0+$/, '');
}

/**
 * AIPanel — owns all AI teacher interaction and explain-step UI.
 *
 * Deps:
 *   aiTeacher, cmdManager   — AI and command parsing instances
 *   onExplainClick(step)    — called when "Explain Next Step" is clicked;
 *                             receives the current explainStep BEFORE increment
 */
export class AIPanel {
  constructor({ aiTeacher, cmdManager, onExplainClick }) {
    this._aiTeacher      = aiTeacher;
    this._cmdManager     = cmdManager;
    this._onExplainClick = onExplainClick;

    this._aiMessages    = document.getElementById('ai-messages');
    this._aiInput       = document.getElementById('ai-input');
    this._aiSendBtn     = document.getElementById('ai-send');
    this._locked        = false;
    this._hasAnswered   = false;
    this._solver        = null;
    this._lp            = null;
    this._result        = null;
    this._explainStep   = 0;

    this._bindEvents();
    this._lockInput();  // chat disabled until student clicks an option point
  }

  /* ── Public API ── */

  /** Update solver/LP state so prompts can be built correctly. */
  setSolverState(solver, lp, result) {
    this._solver = solver;
    this._lp     = lp;
    this._result = result;
    this._explainStep = 0;
    this._hasAnswered = false;
    this._lockInput();
    this.updateExplainBtn();
  }

  /** Called by orchestrator after the student's first correct option-point click. */
  unlockChat() {
    this._hasAnswered = true;
    if (this._aiInput) {
      this._aiInput.disabled = false;
      this._aiInput.placeholder = 'Ask about the LP or simplex steps...';
    }
    if (!this._locked && this._aiSendBtn) this._aiSendBtn.disabled = false;
  }

  get explainStep() { return this._explainStep; }

  /** Advance explain step externally (e.g. after correct option point click). */
  advanceExplainStep() {
    if (this._solver && this._explainStep < this._solver.iterations.length) {
      this._explainStep++;
      this.updateExplainBtn();
    }
  }

  /** Show a static intro message — does NOT call the AI model. */
  async sendAutoIntro() {
    const { status } = this._result ?? {};
    const vars  = this._lp?.variables ?? [];
    const nCons = this._lp?.constraints?.length ?? 0;
    const statusLine =
      status === 'infeasible' ? '<br>✗ Infeasible — the feasible region is empty.'
        : status === 'unbounded'  ? '<br>⚠ Unbounded — the objective grows without limit.'
        : '';

    this._appendLocalMessage(
      `<b>New LP generated</b> — ${vars.length} variable${vars.length !== 1 ? 's' : ''}, ${nCons} constraints.${statusLine}<br><br>` +
      `👆 <b>Click a highlighted vertex</b> on the polyhedron to step through simplex. ` +
      `Once you've tried answering, the chat unlocks for questions!`
    );
  }

  /** Show a local (non-LLM) explanation of the iteration. */
  async explainIteration(iterIdx) {
    if (!this._solver?.iterations[iterIdx]) return;
    const iter = this._solver.iterations[iterIdx];
    this._appendExplainMarker(iter);
    this._appendLocalMessage(this._buildLocalExplanation(iter));
  }

  updateExplainBtn() {
    if (!this._explainBtn) return;
    const iters = this._solver?.iterations ?? [];
    if (!iters.length) {
      this._explainBtn.disabled = true;
      this._explainBtn.innerHTML = '<i class="fas fa-chalkboard-teacher"></i> Explain Next Step &rarr;';
      return;
    }
    if (this._explainStep >= iters.length) {
      this._explainBtn.disabled = true;
      this._explainBtn.innerHTML = '<i class="fas fa-check-circle"></i> All Steps Explained';
      return;
    }
    const next  = iters[this._explainStep];
    const label =
      next.type === 'initial'    ? 'Initial Setup' :
      next.type === 'pivot'      ? `Iteration ${next.iteration}` :
      next.type === 'optimal'    ? 'Optimal Solution' :
      next.type === 'infeasible' ? 'Infeasibility' :
      next.type === 'unbounded'  ? 'Unbounded Case' : 'Next Step';
    this._explainBtn.disabled = false;
    this._explainBtn.innerHTML = `<i class="fas fa-chalkboard-teacher"></i> Explain: ${label} &rarr;`;
  }

  get isLocked() { return this._locked; }

  /** Send an automated message that calls the LLM. Public for orchestrator use. */
  async sendAutoMessage(prompt) {
    return this._sendAutoMessage(prompt);
  }

  /* ── Private event binding ── */

  _bindEvents() {
    this._aiSendBtn?.addEventListener('click', () => this._sendUserMessage());
    this._aiInput?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._sendUserMessage(); }
    });
    this._aiInput?.addEventListener('input', () => autoResize(this._aiInput));
  }

  /* ── Internal send helpers ── */

  async _sendAutoMessage(prompt) {
    this._setLocked(true);
    showTypingIndicator(this._aiMessages);
    try {
      const raw   = await this._aiTeacher.ask(prompt);
      removeTypingIndicator();
      const clean = this._cmdManager.parseAndExecute(raw);
      appendMessage(this._aiMessages, 'assistant', clean);
    } catch (err) {
      removeTypingIndicator();
      const msg = err.message.includes('fetch')
        ? 'Could not reach the AI server. Make sure it is running.'
        : `Error: ${err.message}`;
      appendMessage(this._aiMessages, 'assistant', `⚠️ ${msg}`);
      updateStatus('offline');
    } finally {
      this._setLocked(false);
      this.updateExplainBtn();
    }
  }

  async _sendUserMessage() {
    const text = this._aiInput?.value?.trim();
    if (!text || this._locked || !this._hasAnswered) return;

    this._aiInput.value = '';
    autoResize(this._aiInput);
    appendMessage(this._aiMessages, 'user', text);
    await this._sendAutoMessage(text);
    this._aiInput?.focus();
  }

  _lockInput() {
    if (this._aiInput) {
      this._aiInput.disabled = true;
      this._aiInput.placeholder = 'Click a vertex on the polyhedron first…';
    }
    if (this._aiSendBtn) this._aiSendBtn.disabled = true;
  }

  _setLocked(val) {
    this._locked = val;
    if (this._aiSendBtn) this._aiSendBtn.disabled = val || !this._hasAnswered;
  }

  _appendExplainMarker(iter) {
    const label =
      iter.type === 'initial'    ? 'Initial Setup' :
      iter.type === 'pivot'      ? `Iteration ${iter.iteration}` :
      iter.type === 'optimal'    ? 'Optimal Solution' :
      iter.type === 'infeasible' ? 'Infeasibility Analysis' :
      iter.type === 'unbounded'  ? 'Unbounded Case' : 'Next Step';
    const div = document.createElement('div');
    div.className = 'ai-explain-marker';
    div.innerHTML = `<i class="fas fa-chalkboard-teacher"></i> Explaining: <strong>${label}</strong>`;
    this._aiMessages.appendChild(div);
    this._aiMessages.scrollTop = this._aiMessages.scrollHeight;
  }

  /** Append a pre-built HTML message as assistant without calling the LLM. */
  _appendLocalMessage(html) {
    appendMessage(this._aiMessages, 'assistant', html);
  }

  /** Build a data-driven local explanation of an iteration (no LLM). */
  _buildLocalExplanation(iter) {
    const vars   = this._lp?.variables ?? [];
    const sol    = iter.solution;
    const corner = sol && vars.length
      ? vars.map(v => `${v}=${fmtNum(sol.variables[v] ?? 0)}`).join(', ')
      : '';
    const zStr = sol ? `z = ${fmtNum(sol.objectiveValue ?? 0)}` : '';

    switch (iter.type) {
      case 'initial':
        return `<b>Initial tableau</b><br>` +
          `Simplex starts at the origin corner${corner ? ` (${corner})` : ''}` +
          `${zStr ? `, ${zStr}` : ''}.<br>` +
          `Slack variables convert each ≤ constraint into an equality; the initial basis is all slacks.`;
      case 'pivot':
        return `<b>Iteration ${iter.iteration}</b><br>` +
          `<b>Entering:</b> ${iter.entering} (reduced cost ${fmtNum(iter.reducedCost)})<br>` +
          `<b>Leaving:</b> ${iter.leaving} (min-ratio = ${fmtNum(iter.minRatio)})<br>` +
          `New corner${corner ? ` (${corner})` : ''}${zStr ? `, ${zStr}` : ''}.`;
      case 'optimal':
        return `<b>✓ Optimal!</b><br>` +
          `All reduced costs ≥ 0 — no pivot improves the objective.<br>` +
          `${corner ? `Optimal corner: (${corner}), ` : ''}${zStr}.`;
      case 'infeasible':
        return `<b>✗ Infeasible</b><br>` +
          `An artificial variable remains basic with value &gt; 0 — the feasible region is empty.`;
      case 'unbounded':
        return `<b>⚠ Unbounded</b><br>` +
          `The min-ratio test found no valid leaving variable — the objective grows without bound.`;
      default:
        return 'Simplex step completed.';
    }
  }
}
