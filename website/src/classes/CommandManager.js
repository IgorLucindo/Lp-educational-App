/**
 * CommandManager — parses and executes visualizer commands embedded in AI responses.
 *
 * Command syntax (embedded in text):   {command_name arg1 arg2}
 *
 * Available commands:
 *   {highlight_constraint N}   — highlight constraint N (1-based) in LP + polytope
 *   {highlight_objective}      — highlight the objective function row
 *   {highlight_vertex N}       — highlight vertex N on the polytope
 *   {show_step N}              — scroll solver log to iteration N and highlight it
 *   {reset_highlights}         — clear all highlights
 *   {animate_path}             — animate the simplex path on the visualizer
 */
export class CommandManager {
  /**
   * @param {object} handlers  { visualizer, highlightConstraintDOM, highlightObjectiveDOM,
   *                             scrollSolverToStep, resetHighlightsDOM }
   */
  constructor(handlers = {}) {
    this.handlers = handlers;
  }

  /** Register / update handler callbacks after construction */
  setHandlers(handlers) {
    Object.assign(this.handlers, handlers);
  }

  /**
   * Parse all commands from `text`, execute them, and return the cleaned text
   * (with command tokens removed for display).
   * @param {string} text
   * @returns {string} cleaned display text
   */
  parseAndExecute(text) {
    const CMD_RE = /\{(\w+)(?:\s+([^}]*))?\}/g;
    const clean  = text.replace(CMD_RE, (_, cmd, argsStr) => {
      const args = (argsStr ?? '').trim().split(/\s+/).filter(Boolean)
        .map(a => (isNaN(a) ? a : Number(a)));
      this._execute(cmd, args);
      return '';        // strip command token from displayed text
    });
    return clean.replace(/\s{2,}/g, ' ').trim();
  }

  _execute(cmd, args) {
    const h = this.handlers;
    switch (cmd) {
      case 'highlight_constraint':
        h.visualizer?.highlightConstraint(args[0]);
        h.highlightConstraintDOM?.(args[0]);
        break;

      case 'highlight_objective':
        h.highlightObjectiveDOM?.();
        break;

      case 'highlight_vertex':
        h.visualizer?.showStep(args[0]);
        break;

      case 'show_step':
        h.scrollSolverToStep?.(args[0]);
        break;

      case 'reset_highlights':
        h.visualizer?.clearHighlight();
        h.resetHighlightsDOM?.();
        break;

      case 'animate_path':
        h.animatePath?.();
        break;

      default:
        console.warn(`[CommandManager] Unknown command: ${cmd}`);
    }
  }
}
