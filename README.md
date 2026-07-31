# 📖 LP Teacher — Interactive Linear Programming Educator

[![Open App](https://img.shields.io/badge/OPEN_APP-Lp_Teacher-2ea44f?style=for-the-badge)](https://igorlucindo.github.io/lp-teacher-APP/)

An interactive educational website for learning **Linear Programming (LP)** and the **Simplex Method**.

## ✨ Features

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

## 🚀 Interactive App

To make Linear Programming more accessible to students and non-technical audiences, we provide a web-based interactive educational app. This tool allows users to generate LP problems, visualize the feasible region and constraints, and step through the optimization process.

[![Open App](https://img.shields.io/badge/OPEN_APP-Lp_Teacher-2ea44f?style=for-the-badge)](https://igorlucindo.github.io/lp-teacher-APP/)

Users can interact with the problem directly to validate logical constraints and learn optimization theory with the help of an integrated AI tutor.