# LP Teacher — Interactive Linear Programming & Simplex Educator

An interactive educational website for learning **Linear Programming (LP)** and the **Simplex Method**. Built as a pure-frontend app with no build tools — just open `index.html`.

---

## Features

### LP Generator
- Generate random LP problems with **2 or 3 decision variables** and **up to 8 constraints**
- Choose solution type: **Unique optimum**, **Multiple optimal solutions**, or **Infeasible**
- Fully editable: add, edit, or remove any constraint inline

### Polytope Visualizer
- **2 variables** → interactive 2D canvas with constraint lines, feasible region shading, and vertex labels
- **3 variables** → 3D polytope rendered with Three.js — drag to rotate, scroll to zoom
- Hovering a constraint in the LP panel highlights its face/line in the visualizer
- Simplex path drawn as an animated arrow sequence on the visualizer

### Simplex Solver
- Big-M tableau-based simplex supporting `≤`, `≥`, and `=` constraints
- **Full log** of every iteration: tableau snapshots, entering/leaving variables, pivot element, ratio test
- **Step-by-step** mode — advance one iteration at a time
- Detects **infeasibility** and **unboundedness** automatically
- Log entries are color-coded: iterations in violet, optimal in green, infeasible in red

### AI Teacher
- Context-aware LP tutor powered by a **local Ollama model** (default: `llama3.2`)
- Receives the current LP problem and full solver log as context
- Supports **interactive visualizer commands** embedded in responses, e.g.:
  - `{highlight_constraint 2}` → highlights constraint 2 in LP panel and on polytope
  - `{show_step 3}` → scrolls solver log to iteration 3
  - `{animate_path}` → animates the simplex vertex path
  - `{reset_highlights}` → clears all highlights
- Politely declines off-topic questions

### Header
- Light / dark **theme toggle** (persisted in `localStorage`, respects system preference)
- Method selector: Simplex (active), Branch & Bound (coming soon), Interior Point (coming soon)
- Live AI connection status indicator

---

## Setup & Usage

### 1. Open the app

Just open `index.html` in a modern browser (Chrome 113+, Edge, Firefox 122+):

```
index.html
```

No server, no build step needed. Three.js and fonts load from CDN.

### 2. Install Ollama for the AI Teacher

1. Download and install **Ollama**: [https://ollama.com](https://ollama.com)
2. Pull the default model:
   ```bash
   ollama pull llama3.2
   ```
3. Ollama runs in the background automatically. The AI status indicator in the header turns green.

> The rest of the app (generator, solver, visualizer) works without Ollama.

---

## File Structure

```
Lp-educational-App/
├── index.html
├── README.md
└── website/
    ├── assets/images/
    ├── css/
    │   ├── vars.css        ← CSS custom properties (light & dark themes)
    │   ├── styles.css      ← Global/base styles
    │   ├── header.css      ← Header component
    │   └── main.css        ← Main layout & all component styles
    └── src/
        ├── toggleTheme.js  ← Theme toggle (non-module script)
        ├── index.js        ← App controller / entry point
        ├── classes/
        │   ├── LPGenerator.js     ← Random LP generation
        │   ├── Solver.js          ← Big-M simplex solver with full logging
        │   ├── GraphVisualizer.js ← 2D canvas + 3D Three.js polytope
        │   ├── AiTeacher.js       ← Ollama AI teacher with LP/solver context
        │   └── CommandManager.js  ← Parses {command arg} tokens from AI responses
        └── utils/
            └── utils.js    ← Shared helpers (formatting, DOM, colors)
```

---

## Technology Choices

| Concern | Choice | Reason |
|---|---|---|
| 3D rendering | [Three.js](https://threejs.org/) v0.160 (CDN) | ConvexGeometry + OrbitControls built-in |
| AI backend | [Ollama](https://ollama.com/) | Local inference, same pattern as `healthcare-chat-APP` |
| Default AI model | `llama3.2` | Small, fast, strong Q&A |
| Fonts | Inter + Fira Code (Google Fonts) | Clean UI + monospace for tableaux |
| Icons | Font Awesome 6 (CDN) | Consistent icon set |
| Build tooling | None | Pure ES modules, no bundler needed |

---

## About the AI Implementation

The AI teacher uses the **same Ollama REST API pattern** as the [`healthcare-chat-APP`](https://github.com/IgorLucindo/healthcare-chat-APP) — a `fetch` call to `http://localhost:11434/api/chat` with a messages array. The key differences:

1. The model is `llama3.2` (the standard general-purpose Ollama model) instead of the medical fine-tune
2. The system prompt includes the current LP problem, solver log, and a list of visualizer commands the AI can embed in its responses
3. The conversation history resets whenever the LP changes

### Online Deployment (no installer)

For a **fully online version** that anyone can use without installing anything, use **WebLLM**:

- Runs LLMs directly in the browser via WebGPU + WASM
- No server required — model downloads to the browser (~2–4 GB on first visit)
- Requires Chrome 113+ (WebGPU support)
- Library: [`@mlc-ai/web-llm`](https://github.com/mlc-ai/web-llm)

**Migration**: replace the `fetch(...)` call in `AiTeacher.js` with the WebLLM engine API. The rest of the architecture (system prompt, command parsing, context updates) stays exactly the same.

---

## Future Work

- [ ] Branch & Bound method
- [ ] Interior Point method
- [ ] WebLLM integration for online AI
- [ ] Export LP as `.lp` / `.mps` file
- [ ] Import LP from file
- [ ] Dual simplex visualization
- [ ] Sensitivity analysis panel
- [ ] Fine-tuned LP/simplex teaching model trained on solver log files
