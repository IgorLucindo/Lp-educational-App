# LP Teacher — Interactive Linear Programming Educator

An interactive educational website for learning **Linear Programming (LP)** and the **Simplex Method**.

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