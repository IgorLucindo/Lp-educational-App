import { formatLPText } from '../utils/utils.js';

/* ═══════════════════════════════════════════
   AiModel — thin wrapper around the Ollama REST API
   ═══════════════════════════════════════════ */
class AiModel {
  constructor(apiBase = 'http://localhost:11434', modelName = 'llama3.2') {
    this.apiBase   = apiBase;
    this.modelName = modelName;
  }

  /** Send a messages array to Ollama. Returns the assistant reply string. */
  async chat(messages) {
    const res = await fetch(`${this.apiBase}/api/chat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ model: this.modelName, messages, stream: false }),
    });
    if (!res.ok) throw new Error(`Ollama returned HTTP ${res.status}: ${res.statusText}`);
    const data = await res.json();
    return data.message?.content ?? '';
  }

  /** Check if Ollama is reachable and the model is available.
   *  Returns 'online' | 'missing' | 'offline' */
  async checkAvailability() {
    try {
      const res = await fetch(`${this.apiBase}/api/tags`);
      if (!res.ok) return 'offline';
      const data = await res.json();
      const found = (data.models ?? []).some(
        m => m.name === this.modelName || m.name.startsWith(this.modelName + ':')
      );
      return found ? 'online' : 'missing';
    } catch {
      return 'offline';
    }
  }
}

/* ═══════════════════════════════════════════
   AiTeacher — context-aware LP tutor
   ═══════════════════════════════════════════ */
export class AiTeacher extends AiModel {
  constructor() {
    super('http://localhost:11434', 'llama3.2');
    this.currentLP         = null;
    this.currentSolverLog  = '';
    this.currentStatus     = 'Not solved yet';
    this.history           = [];   // {role, content}[]
  }

  /**
   * Update the LP context (called whenever LP or solver changes).
   * Resets conversation history.
   */
  updateContext(lp, solverLog = '', status = 'Not solved yet') {
    this.currentLP        = lp;
    this.currentSolverLog = solverLog;
    this.currentStatus    = status;
    this.history          = [];   // fresh conversation with new context
  }

  /** Send a user message and get the AI response. */
  async ask(userMessage) {
    const system  = { role: 'system',    content: this._buildSystemPrompt() };
    const userMsg = { role: 'user',      content: userMessage };
    this.history.push(userMsg);

    const messages = [system, ...this.history];

    try {
      const reply = await this.chat(messages);
      this.history.push({ role: 'assistant', content: reply });
      return reply;
    } catch (err) {
      this.history.pop();   // rollback user message on error
      throw err;
    }
  }

  _buildSystemPrompt() {
    const lpText = this.currentLP
      ? formatLPText(this.currentLP)
      : 'No LP problem generated yet.';

    const logSnippet = this.currentSolverLog
      ? this.currentSolverLog.slice(-3000)  // keep last 3000 chars to avoid huge prompts
      : 'Solver has not been run yet.';

    return `\
You are an expert Linear Programming (LP) and Simplex Method tutor helping students learn optimization.

══ CURRENT LP PROBLEM ══
${lpText}

══ SOLVER STATUS ══
${this.currentStatus}

══ SOLVER LOG (latest portion) ══
${logSnippet}

══ YOUR ROLE ══
• Explain LP concepts and the simplex algorithm at a student level.
• Walk through simplex iterations step by step when asked.
• Make explanations interactive by embedding visualizer commands (see below).
• ONLY answer questions about LP, simplex, integer programming basics, or the current problem shown above.
• If asked about completely unrelated topics, politely decline and redirect.
• If a question requires expertise beyond LP theory (e.g., advanced research-level math), say you cannot answer reliably and suggest a professor or textbook.
• Never fabricate solver results — only reference what appears in the solver log above.

══ INTERACTIVE VISUALIZER COMMANDS ══
Embed any of these commands inline in your response to highlight elements:
  {highlight_constraint N}   → highlights constraint N in LP display and on the polytope
  {highlight_objective}      → highlights the objective function
  {highlight_vertex N}       → highlights vertex N on the polytope
  {show_step N}              → scrolls the solver log to iteration N
  {reset_highlights}         → clears all highlights
  {animate_path}             → animates the simplex path on the visualizer

Example usage in a sentence: "The first active constraint {highlight_constraint 1} cuts off the origin."

══ RESPONSE RULES ══
• Be concise, clear, and educational.
• Use proper LP notation: x₁, x₂, z = c·x, etc.
• Answer ONLY what was asked — do not continue the conversation yourself.
• Stop writing immediately after your answer is complete.
• Do NOT simulate a student follow-up or your own follow-up questions.
`;
  }
}
