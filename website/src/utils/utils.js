/* utils.js — shared DOM helpers */

/** Constraint color palette (index 0–7 → constraints 1–8) */
export const CONSTRAINT_COLORS = [
  '#f43f5e','#f97316','#eab308','#16a34a',
  '#0891b2','#2563eb','#7c3aed','#db2777',
];

/** CSS variable names for constraint colors */
export const CONSTRAINT_CSS_VARS = [
  '--c1','--c2','--c3','--c4','--c5','--c6','--c7','--c8',
];

/** Format a number nicely (trim trailing zeros) */
export function fmt(n, decimals = 4) {
  if (!isFinite(n)) return '?';
  const s = n.toFixed(decimals);
  // Remove trailing zeros after decimal point
  return s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

/** Format a variable name with subscript (x₁, x₂, x₃) */
export function varName(i) {
  const subs = ['₁','₂','₃','₄','₅'];
  return `x${subs[i] ?? (i + 1)}`;
}

/** Format an LP constraint as a readable string */
export function formatConstraint(con, variables) {
  let terms = [];
  con.coefficients.forEach((c, i) => {
    if (Math.abs(c) < 1e-10) return;
    const sign  = terms.length === 0 ? (c < 0 ? '−' : '') : (c < 0 ? ' − ' : ' + ');
    const absC  = Math.abs(c);
    const coeff = absC === 1 ? '' : fmt(absC, 2);
    terms.push(`${sign}${coeff}${variables[i]}`);
  });
  if (terms.length === 0) terms.push('0');
  const sense = con.sense === '<=' ? '≤' : con.sense === '>=' ? '≥' : '=';
  return `${terms.join('')} ${sense} ${fmt(con.rhs, 2)}`;
}

/** Format the LP as plain text (used by AI system prompt) */
export function formatLPText(lp) {
  const { objective, constraints, variables } = lp;
  const objTerms = objective.coefficients
    .map((c, i) => {
      const sign  = i === 0 ? (c < 0 ? '−' : '') : (c < 0 ? ' − ' : ' + ');
      const absC  = Math.abs(c);
      return `${sign}${absC === 1 ? '' : absC}${variables[i]}`;
    }).join('');

  let s = `${objective.type === 'max' ? 'Maximize' : 'Minimize'}  z = ${objTerms}\n`;
  s += 'Subject to:\n';
  constraints.forEach((con, i) => {
    s += `  (${i + 1})  ${formatConstraint(con, variables)}\n`;
  });
  s += `  ${variables.join(', ')} ≥ 0\n`;
  return s;
}

/* ── Chat DOM helpers ── */

/**
 * Append a message bubble to the chat container.
 * @param {HTMLElement} container
 * @param {'user'|'assistant'} role
 * @param {string} html  - content (may contain HTML)
 */
export function appendMessage(container, role, html) {
  const wrap = document.createElement('div');
  wrap.className = `ai-msg ${role}`;

  if (role === 'assistant') {
    const avatar = document.createElement('div');
    avatar.className = 'ai-avatar';
    avatar.innerHTML = '<i class="fas fa-robot"></i>';
    wrap.appendChild(avatar);
  }

  const bubble = document.createElement('div');
  bubble.className = 'ai-bubble';
  bubble.innerHTML = html.replace(/\n/g, '<br>');
  wrap.appendChild(bubble);

  container.appendChild(wrap);
  container.scrollTop = container.scrollHeight;
  return wrap;
}

/** Show animated typing indicator */
export function showTypingIndicator(container) {
  const wrap = document.createElement('div');
  wrap.className = 'ai-msg assistant';
  wrap.id = 'ai-typing-indicator';

  const avatar = document.createElement('div');
  avatar.className = 'ai-avatar';
  avatar.innerHTML = '<i class="fas fa-robot"></i>';

  const bubble = document.createElement('div');
  bubble.className = 'ai-bubble ai-typing-bubble';
  const typing = document.createElement('div');
  typing.className = 'ai-typing';
  for (let i = 0; i < 3; i++) {
    const dot = document.createElement('div');
    dot.className = 'ai-typing-dot';
    typing.appendChild(dot);
  }
  bubble.appendChild(typing);

  wrap.appendChild(avatar);
  wrap.appendChild(bubble);
  container.appendChild(wrap);
  container.scrollTop = container.scrollHeight;
}

/** Remove typing indicator */
export function removeTypingIndicator() {
  document.getElementById('ai-typing-indicator')?.remove();
}

/**
 * Update AI status indicators.
 * @param {string} state 'online'|'offline'|'missing'|'checking'
 */
export function updateStatus(state) {
  const labels = { online: 'Online', offline: 'Offline', missing: 'Model missing', checking: 'Checking…' };
  ['', '-2'].forEach(suffix => {
    const dot   = document.getElementById(`ai-status-dot${suffix}`   ) ?? document.getElementById(`ai-dot${suffix}`);
    const label = document.getElementById(`ai-status-label${suffix}`) ?? document.getElementById(`ai-label${suffix}`);
    if (dot)   { dot.className = `status-dot ${state}`; }
    if (label) { label.textContent = labels[state] ?? state; }
  });
}

/** Auto-resize a textarea */
export function autoResize(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 100) + 'px';
}
