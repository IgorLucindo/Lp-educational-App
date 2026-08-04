import * as THREE from 'three';
import { OrbitControls }   from 'three/addons/controls/OrbitControls.js';
import { ConvexGeometry }  from 'three/addons/geometries/ConvexGeometry.js';
import { CONSTRAINT_COLORS } from '../utils/utils.js';

/* ─── Geometric helpers ─────────────────────── */

/** Sutherland–Hodgman polygon clipping by one half-plane  a·x ≤ b */
function clipPolygon(poly, coeffs, rhs, tol = 1e-9) {
  if (poly.length === 0) return [];
  const inside = p => coeffs.reduce((s, c, i) => s + c * p[i], 0) <= rhs + tol;
  const lerp   = (p, q) => {
    const ap = coeffs.reduce((s, c, i) => s + c * p[i], 0);
    const aq = coeffs.reduce((s, c, i) => s + c * q[i], 0);
    const t  = (rhs - ap) / (aq - ap);
    return p.map((v, i) => v + t * (q[i] - v));
  };
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const curr = poly[i];
    const next = poly[(i + 1) % poly.length];
    const cIn  = inside(curr);
    const nIn  = inside(next);
    if (cIn)       out.push(curr);
    if (cIn !== nIn) out.push(lerp(curr, next));
  }
  return out;
}

/** Compute 2-D feasible polygon by clipping a bounding box */
function feasiblePolygon2D(lp, bound = 60) {
  const { constraints } = lp;
  let poly = [[0,0],[bound,0],[bound,bound],[0,bound]];

  // Non-negativity
  poly = clipPolygon(poly, [-1, 0], 0);
  poly = clipPolygon(poly, [0, -1], 0);

  for (const con of constraints) {
    const c = con.sense === '>=' ? con.coefficients.map(v => -v) : con.coefficients;
    const r = con.sense === '>=' ? -con.rhs : con.rhs;
    poly = clipPolygon(poly, c, r);
    if (poly.length === 0) return [];
  }
  return poly;
}

/** Compute all vertices (BFS) of the 2-D polytope */
function vertices2D(lp) {
  const { constraints } = lp;
  const all = [
    ...constraints,
    { coefficients: [-1, 0], sense: '<=', rhs: 0 },
    { coefficients: [0, -1], sense: '<=', rhs: 0 },
  ];

  const isFeas = pt => all.every(c => {
    const v = c.coefficients.reduce((s, a, i) => s + a * pt[i], 0);
    if (c.sense === '<=') return v <= c.rhs + 1e-6;
    if (c.sense === '>=') return v >= c.rhs - 1e-6;
    return Math.abs(v - c.rhs) < 1e-6;
  });

  const verts = [];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const [a1, a2] = all[i].coefficients;
      const [b1, b2] = all[j].coefficients;
      const det = a1 * b2 - a2 * b1;
      if (Math.abs(det) < 1e-10) continue;
      const x = (all[i].rhs * b2 - all[j].rhs * a2) / det;
      const y = (a1 * all[j].rhs - b1 * all[i].rhs) / det;
      if (isFeas([x, y])) verts.push([Math.max(0, x), Math.max(0, y)]);
    }
  }
  return dedupPoints2D(verts);
}

function dedupPoints2D(pts, tol = 1e-6) {
  const out = [];
  for (const p of pts) {
    if (!out.some(q => Math.hypot(p[0]-q[0], p[1]-q[1]) < tol)) out.push(p);
  }
  return out;
}

/** Compute all vertices of the 3-D polytope */
function vertices3D(lp) {
  const { constraints } = lp;
  const all = [
    ...constraints,
    { coefficients: [-1,0,0], sense: '<=', rhs: 0 },
    { coefficients: [0,-1,0], sense: '<=', rhs: 0 },
    { coefficients: [0,0,-1], sense: '<=', rhs: 0 },
  ];

  const isFeas = pt => all.every(c => {
    const v = c.coefficients.reduce((s, a, i) => s + a * pt[i], 0);
    if (c.sense === '<=') return v <= c.rhs + 1e-6;
    if (c.sense === '>=') return v >= c.rhs - 1e-6;
    return Math.abs(v - c.rhs) < 1e-6;
  });

  const verts = [];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      for (let k = j + 1; k < all.length; k++) {
        const A = [all[i].coefficients, all[j].coefficients, all[k].coefficients];
        const b = [all[i].rhs, all[j].rhs, all[k].rhs];
        const pt = solve3x3(A, b);
        if (pt && isFeas(pt)) {
          verts.push(pt.map(v => Math.max(0, v)));
        }
      }
    }
  }
  return dedupPoints3D(verts);
}

function dedupPoints3D(pts, tol = 1e-5) {
  const out = [];
  for (const p of pts) {
    if (!out.some(q => Math.hypot(p[0]-q[0], p[1]-q[1], p[2]-q[2]) < tol)) out.push(p);
  }
  return out;
}

/** Solve 3×3 linear system  A x = b (Cramer's rule) */
function solve3x3(A, b) {
  const det = (M) =>
    M[0][0]*(M[1][1]*M[2][2]-M[1][2]*M[2][1])
   -M[0][1]*(M[1][0]*M[2][2]-M[1][2]*M[2][0])
   +M[0][2]*(M[1][0]*M[2][1]-M[1][1]*M[2][0]);

  const d = det(A);
  if (Math.abs(d) < 1e-12) return null;
  const replace = (A, col, b) => A.map((row,i) => row.map((v,j) => j===col ? b[i] : v));
  return [0,1,2].map(col => det(replace(A, col, b)) / d);
}

/* ══════════════════════════════════════════
   GraphVisualizer
   ══════════════════════════════════════════ */

export class GraphVisualizer {
  /** @param {string} containerId  id of the .viz-body div */
  constructor(containerId) {
    this.container  = document.getElementById(containerId);
    this.mode       = null;   // '2d' | '3d'
    this.lp         = null;
    this.vertices   = [];
    this.feasPoly   = [];
    this.path       = [];     // simplex path (array of [x,y] or [x,y,z])
    this.highlighted = new Set(); // highlighted constraint indices (1-based)
    this.activeStep  = -1;    // highlighted simplex step vertex index

    // Option-points mode (Task 3)
    this._optionMode       = false;
    this._optionCurrent    = null;   // current vertex [x,y] or [x,y,z]
    this._optionPoints     = [];     // clickable candidate vertices
    this._onOptionSelect   = null;   // (point) => void
    this._optionSpheres    = [];     // Three.js meshes for 3D option points
    this._animFrame2D      = null;   // rAF id for 2D animation loop
    this._hoveredOptIdx    = -1;     // index into _optionPoints for hover highlight
    this._hoverPulseStart  = 0;      // timestamp when current hover began (for pulse)
    this._clickAnimIdx     = -1;     // index of last clicked option point
    this._clickAnimStart   = 0;
    this._clickAnimEnd     = 0;

    // 2D state
    this._canvas2d  = null;
    this._ctx       = null;
    this._scale     = 18;
    this._originX   = 40;
    this._originY   = 0;
    this._panStart  = null;
    this._panOrigin = null;

    // 3D state
    this._renderer  = null;
    this._scene     = null;
    this._camera    = null;
    this._controls  = null;
    this._animId    = null;
    this._faceMeshes = [];  // {mesh, mat, constraintIdx}
    this._pathLine  = null;
    this._stepSphere = null;
    this._planeMesh  = null;  // full-plane mesh shown on constraint hover
    this._hoveredFaceIdx   = null;  // 1-based constraint idx hovered in 3D
    this._hoveredFaceIdx2D = null;  // 1-based constraint idx hovered in 2D
    this._planeVisible = false;   // true only when LP-panel constraint is hovered
    this._planeForIdx  = null;    // which constraint the plane is for

    // Callback: (constraintIdx1Based, entering: bool) => void
    // Called when a face/line is hovered in the visualizer
    this._onConstraintHover = null;
  }

  /* ─── Public interface ─────────────────── */

  /** Register callback invoked when visualizer hover enters/leaves a constraint face/line.
   *  fn(constraintIdx1Based, entering: bool)
   */
  setConstraintHoverCallback(fn) {
    this._onConstraintHover = fn;
  }

  setLP(lp, vertexPath = []) {
    this.lp   = lp;
    this.path = vertexPath;
    this.highlighted.clear();
    this.activeStep = -1;
    this._hoveredFaceIdx   = null;
    this._hoveredFaceIdx2D = null;
    this._planeVisible = false;
    this._planeForIdx  = null;

    const numVars = lp.variables.length;
    const needed   = numVars === 2 ? '2d' : '3d';
    if (this.mode !== needed) {
      this._cleanup();
      needed === '2d' ? this._init2D() : this._init3D();
    }

    if (this.mode === '2d') {
      this.feasPoly = feasiblePolygon2D(lp);
      this.vertices = vertices2D(lp);
      this._draw2D();
    } else {
      this.vertices = vertices3D(lp);
      this._build3D();
    }
  }

  highlightConstraint(idx, showPlane = false) {   // idx 1-based
    if (showPlane) { this._planeVisible = true; this._planeForIdx = idx; }
    this.highlighted.add(idx);
    this._applyHighlights();
  }

  clearHighlight(idx, fromPanel = false) {
    if (idx === undefined) {
      this.highlighted.clear();
      if (fromPanel) { this._planeVisible = false; this._planeForIdx = null; }
    } else {
      this.highlighted.delete(idx);
      if (fromPanel && this._planeForIdx === idx) {
        this._planeVisible = false; this._planeForIdx = null;
      }
    }
    this._applyHighlights();
  }

  showStep(stepIdx) {
    this.activeStep = stepIdx;
    this._applyHighlights();
  }

  /**
   * Enter option-points mode: only the current vertex and the provided
   * option points are visible.  Clicking an option point fires onSelect(point).
   */
  setOptionPoints(currentPt, optionPoints, onSelect) {
    this._optionMode     = true;
    this._optionCurrent  = currentPt;
    this._optionPoints   = optionPoints;
    this._onOptionSelect = onSelect;
    if (this.mode === '2d') {
      this._draw2D();
    } else if (this.mode === '3d') {
      this._rebuildOptionSpheres3D();
    }
  }

  /** Leave option-points mode and restore normal vertex rendering. */
  clearOptionPoints() {
    this._optionMode    = false;
    this._optionCurrent = null;
    this._optionPoints  = [];
    this._onOptionSelect = null;
    this._hoveredOptIdx  = -1;
    this._clickAnimIdx   = -1;
    if (this.mode === '2d') {
      this._stopAnim2D();
      this._draw2D();
      if (this._canvas2d) this._canvas2d.style.cursor = '';
    } else if (this.mode === '3d') {
      this._removeOptionSpheres3D();
    }
  }

  // Runs a short animation loop for click ripple; stops automatically when done.
  _startAnim2D() {
    if (this._animFrame2D) return;
    const loop = () => {
      this._draw2D();
      if (performance.now() < this._clickAnimEnd || this._hoveredOptIdx >= 0) {
        this._animFrame2D = requestAnimationFrame(loop);
      } else {
        this._animFrame2D = null;
        this._clickAnimIdx = -1;
        this._draw2D();
      }
    };
    this._animFrame2D = requestAnimationFrame(loop);
  }

  _stopAnim2D() {
    if (this._animFrame2D) { cancelAnimationFrame(this._animFrame2D); this._animFrame2D = null; }
  }

  resetView() {
    if (this.mode === '2d') {
      this._fitView2D();
      this._draw2D();
    } else if (this._controls) {
      this._controls.reset();
    }
  }

  resize() {
    if (this.mode === '2d') {
      this._resizeCanvas2D();
      this._draw2D();
    } else if (this._renderer) {
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      this._renderer.setSize(w, h);
      this._camera.aspect = w / h;
      this._camera.updateProjectionMatrix();
    }
  }

  destroy() { this._cleanup(); }

  /* ─── 2D implementation ─────────────────── */

  _init2D() {
    this.mode = '2d';
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:100%;height:100%;display:block';
    this.container.appendChild(canvas);
    this._canvas2d = canvas;
    this._ctx      = canvas.getContext('2d');
    this._resizeCanvas2D();

    // Prevent context menu on canvas (consistent with 3D)
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    // Wheel zoom
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      this._scale  = Math.min(80, Math.max(5, this._scale * factor));
      this._draw2D();
    }, { passive: false });

    // Pan — use CSS class for cleaner cursor handling
    canvas.classList.add('viz-grab');
    canvas.addEventListener('mousedown', e => {
      canvas.classList.remove('viz-grab');
      canvas.classList.add('viz-grabbing');
      this._panStart  = { x: e.clientX, y: e.clientY };
      this._panOrigin = { x: this._originX, y: this._originY };
    });
    const onPanMove = e => {
      if (!this._panStart) return;
      this._originX = this._panOrigin.x + (e.clientX - this._panStart.x);
      this._originY = this._panOrigin.y + (e.clientY - this._panStart.y);
      this._draw2D();
    };
    const onPanUp = () => {
      this._panStart = null;
      if (canvas) { canvas.classList.remove('viz-grabbing'); canvas.classList.add('viz-grab'); }
    };
    window.addEventListener('mousemove', onPanMove);
    window.addEventListener('mouseup',   onPanUp);
    this._panMoveHandler = onPanMove;
    this._panUpHandler   = onPanUp;

    // Constraint line hover detection
    canvas.addEventListener('mousemove', e => this._onMouseMove2D(e));
    canvas.addEventListener('mouseleave', () => this._onMouseLeave2D());

    // Option-point click handling
    canvas.addEventListener('click', e => this._onCanvasClick2D(e));

    new ResizeObserver(() => this.resize()).observe(this.container);
  }

  _resizeCanvas2D() {
    const c  = this._canvas2d;
    const dpr = window.devicePixelRatio || 1;
    c.width  = this.container.clientWidth  * dpr;
    c.height = this.container.clientHeight * dpr;
    this._ctx.scale(dpr, dpr);
    this._originY = this.container.clientHeight - 40;
    if (this.lp) this._fitView2D();
  }

  _fitView2D() {
    const pts = this.vertices.length > 0 ? this.vertices : [[0, 0], [10, 10]];
    const maxX = Math.max(...pts.map(p => p[0]), 5);
    const maxY = Math.max(...pts.map(p => p[1]), 5);
    const W    = Math.max(50, this.container.clientWidth  - 70);
    const H    = Math.max(50, this.container.clientHeight - 70);
    this._scale   = Math.min(W / maxX, H / maxY) * 0.85;
    this._originX = 50;
    this._originY = this.container.clientHeight - 40;
  }

  /** World → canvas coordinates */
  _w2c(wx, wy) {
    return [
      this._originX + wx * this._scale,
      this._originY - wy * this._scale,
    ];
  }

  _draw2D() {
    if (!this._canvas2d || !this._ctx) return;
    if (this._scale <= 0) return; // container too small
    const ctx = this._ctx;
    const W   = this.container.clientWidth;
    const H   = this.container.clientHeight;

    ctx.clearRect(0, 0, W, H);
    if (!this.lp) return;

    const isDark = document.body.classList.contains('dark-theme');

    /* Grid */
    ctx.save();
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,20,0.05)';
    ctx.lineWidth   = 1;
    const gridStep = this._scale >= 10 ? 1 : 5;
    for (let v = 0; v * this._scale < W + 100; v += gridStep) {
      const [cx, cy] = this._w2c(v, 0);
      ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, H); ctx.stroke();
    }
    for (let v = 0; v * this._scale < H + 100; v += gridStep) {
      const [cx, cy] = this._w2c(0, v);
      ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(W, cy); ctx.stroke();
    }
    ctx.restore();

    /* Feasible region */
    if (this.feasPoly.length > 2) {
      ctx.save();
      ctx.beginPath();
      const [px, py] = this._w2c(...this.feasPoly[0]);
      ctx.moveTo(px, py);
      this.feasPoly.slice(1).forEach(p => { const [cx, cy] = this._w2c(...p); ctx.lineTo(cx, cy); });
      ctx.closePath();
      ctx.fillStyle   = isDark ? 'rgba(129,140,248,0.1)' : 'rgba(92,110,248,0.08)';
      ctx.fill();
      ctx.strokeStyle = isDark ? 'rgba(129,140,248,0.25)' : 'rgba(92,110,248,0.2)';
      ctx.lineWidth   = 1;
      ctx.stroke();
      ctx.restore();
    }

    /* Constraint lines */
    const { constraints, variables } = this.lp;
    constraints.forEach((con, i) => {
      const color  = CONSTRAINT_COLORS[i % CONSTRAINT_COLORS.length];
      const active = this.highlighted.has(i + 1);
      const alpha  = active ? 'ff' : '99';
      ctx.save();
      ctx.strokeStyle = color + alpha;
      ctx.lineWidth   = active ? 2.5 : 1.5;
      if (active) { ctx.shadowColor = color; ctx.shadowBlur = 6; }

      const [a, b] = con.coefficients;
      const rhs    = con.rhs;
      // Draw the line a*x + b*y = rhs across the canvas
      if (Math.abs(b) > 1e-9) {
        const x1 = -10, x2 = 80;
        const y1 = (rhs - a * x1) / b;
        const y2 = (rhs - a * x2) / b;
        const [cx1, cy1] = this._w2c(x1, y1);
        const [cx2, cy2] = this._w2c(x2, y2);
        ctx.beginPath(); ctx.moveTo(cx1, cy1); ctx.lineTo(cx2, cy2); ctx.stroke();
      } else if (Math.abs(a) > 1e-9) {
        const x = rhs / a;
        const [cx] = this._w2c(x, 0);
        ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, H); ctx.stroke();
      }
      ctx.restore();

      // Label
      if (b > 1e-9) {
        const lx = Math.min(40, rhs / a + 2);
        const ly = (rhs - a * lx) / b;
        const [lcx, lcy] = this._w2c(lx, ly);
        if (lcx > 0 && lcx < W && lcy > 0 && lcy < H) {
          ctx.save();
          ctx.fillStyle  = color;
          ctx.font       = 'bold 11px Inter,sans-serif';
          ctx.fillText(`(${i+1})`, lcx + 4, lcy - 4);
          ctx.restore();
        }
      }
    });

    /* Axes — drawn before vertices so dots render on top of axis lines */
    ctx.save();
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,20,0.3)';
    ctx.lineWidth   = 1.5;
    const [ox, oy] = this._w2c(0, 0);
    ctx.beginPath(); ctx.moveTo(ox, 0); ctx.lineTo(ox, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, oy); ctx.lineTo(W, oy); ctx.stroke();
    ctx.fillStyle = isDark ? '#6868a8' : '#9a9abc';
    ctx.font = '12px Inter,sans-serif';
    ctx.fillText(this.lp.variables[0], W - 20, oy - 5);
    ctx.fillText(this.lp.variables[1], ox + 5, 15);
    ctx.restore();

    /* Simplex path — hidden in option mode so the route doesn't reveal the answer */
    if (this.path.length > 1 && !this._optionMode) {
      ctx.save();
      ctx.strokeStyle = isDark ? '#fbbf24' : '#d97706';
      ctx.lineWidth   = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      const [px, py] = this._w2c(...this.path[0]);
      ctx.moveTo(px, py);
      this.path.slice(1).forEach(p => { const [cx, cy] = this._w2c(...p); ctx.lineTo(cx, cy); });
      ctx.stroke();
      ctx.restore();

      // Arrowheads — hidden in option mode so the user must guess the direction
      if (!this._optionMode) {
        this.path.forEach((pt, idx) => {
          if (idx === 0) return;
          const prev = this.path[idx - 1];
          const [x1,y1] = this._w2c(...prev);
          const [x2,y2] = this._w2c(...pt);
          this._drawArrow2D(ctx, x1, y1, x2, y2, isDark ? '#fbbf24' : '#d97706');
        });
      }
    }

    /* Vertices — option-points mode shows only current + options; normal shows all */
    if (this._optionMode) {
      // Current vertex (gold dot, no "you are here" text — user guesses the next direction)
      if (this._optionCurrent) {
        const [cx, cy] = this._w2c(...this._optionCurrent);
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, 8, 0, Math.PI * 2);
        ctx.fillStyle   = isDark ? '#fbbf24' : '#d97706';
        ctx.fill();
        ctx.strokeStyle = isDark ? '#0c0c1a' : '#fff';
        ctx.lineWidth   = 2;
        ctx.stroke();
        ctx.restore();
        const lbl = `(${this._optionCurrent.map(x => Math.round(x * 100) / 100).join(', ')})`;
        ctx.save();
        ctx.font      = 'bold 10px Fira Code,monospace';
        ctx.fillStyle = isDark ? '#fbbf24' : '#d97706';
        ctx.fillText(lbl, cx + 10, cy - 6);
        ctx.restore();
      }

      // Sine-wave pulse factor for hovered option point (scale + glow + arrow alpha)
      let hoverPulse = 0;
      if (this._hoveredOptIdx >= 0) {
        const elapsed = performance.now() - this._hoverPulseStart;
        hoverPulse = 0.5 + 0.5 * Math.sin((elapsed / 1500) * Math.PI * 2); // 0..1, 900ms period
      }

      // Hover preview arrow (semi-transparent, from current to hovered option point)
      if (this._hoveredOptIdx >= 0 && this._optionCurrent && this._optionPoints[this._hoveredOptIdx]) {
        const hPt = this._optionPoints[this._hoveredOptIdx];
        const [ax1, ay1] = this._w2c(...this._optionCurrent);
        const [ax2, ay2] = this._w2c(...hPt);
        const arrowAlpha = 0.5 + hoverPulse * 0.4;
        ctx.save();
        ctx.globalAlpha = arrowAlpha;
        ctx.strokeStyle = isDark ? '#818cf8' : '#5c6ef8';
        ctx.lineWidth   = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(ax1, ay1);
        ctx.lineTo(ax2, ay2);
        ctx.stroke();
        ctx.restore();
        ctx.save();
        ctx.globalAlpha = arrowAlpha;
        this._drawArrow2D(ctx, ax1, ay1, ax2, ay2, isDark ? '#818cf8' : '#5c6ef8');
        ctx.restore();
      }

      // Option points (clickable)
      this._optionPoints.forEach((v, i) => {
        const [cx, cy] = this._w2c(...v);
        if (cx < -10 || cx > W + 10 || cy < -10 || cy > H + 10) return;

        const isHovered = i === this._hoveredOptIdx;
        const radius = isHovered ? (9 + hoverPulse * 1) : 9; // 9..12

        // Click ripple
        if (i === this._clickAnimIdx && performance.now() < this._clickAnimEnd) {
          const progress = (performance.now() - this._clickAnimStart) / (this._clickAnimEnd - this._clickAnimStart);
          ctx.save();
          ctx.globalAlpha = 0.65 * (1 - progress);
          ctx.beginPath();
          ctx.arc(cx, cy, 9 + 24 * progress, 0, Math.PI * 2);
          ctx.strokeStyle = isDark ? '#818cf8' : '#5c6ef8';
          ctx.stroke();
          ctx.restore();
        }

        const glowBlur = isHovered ? (6 + hoverPulse * 14) : 6; // 6..20
        ctx.save();
        ctx.shadowBlur  = glowBlur;
        ctx.globalAlpha = isHovered ? (0.8 + hoverPulse * 0.2) : 1; // 0.8..1.0
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fillStyle = isHovered
          ? (isDark ? '#a5b4fc' : '#4a5ae6')
          : (isDark ? '#818cf8' : '#5c6ef8');
        ctx.fill();
        ctx.restore();

        // Border
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.strokeStyle = isDark ? 'rgba(232,232,255,0.9)' : '#ffffff';
        ctx.lineWidth   = 1.5;
        ctx.stroke();
        ctx.restore();

        // "?" label
        ctx.save();
        ctx.font         = `bold ${isHovered ? 10 : 8}px Inter,sans-serif`;
        ctx.fillStyle    = '#ffffff';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('?', cx, cy);
        ctx.restore();

        // Coordinate label
        const lbl = `(${v.map(x => Math.round(x * 100) / 100).join(', ')})`;
        ctx.save();
        ctx.font      = `${isHovered ? 'bold ' : ''}10px Fira Code,monospace`;
        ctx.fillStyle = isDark ? '#818cf8' : '#5c6ef8';
        ctx.globalAlpha = isHovered ? 1 : 0.8;
        ctx.fillText(lbl, cx + (isHovered ? 15 : 12), cy - 8);
        ctx.restore();
      });
    } else {
      this.vertices.forEach((v, idx) => {
        const isStep = idx === this.activeStep;
        const [cx, cy] = this._w2c(...v);
        if (cx < -10 || cx > W + 10 || cy < -10 || cy > H + 10) return;

        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, isStep ? 8 : 5, 0, Math.PI * 2);
        ctx.fillStyle   = isStep
          ? (isDark ? '#fbbf24' : '#d97706')
          : (isDark ? '#818cf8' : '#5c6ef8');
        ctx.fill();
        ctx.strokeStyle = isDark ? '#0c0c1a' : '#ffffff';
        ctx.lineWidth   = 2;
        ctx.stroke();
        ctx.restore();

        // Coordinate label
        const label = `(${v.map(x => Math.round(x * 100) / 100).join(', ')})`;
        ctx.save();
        ctx.font      = '10px Fira Code,monospace';
        ctx.fillStyle = isDark ? '#aaaace' : '#3c3c60';
        ctx.fillText(label, cx + 8, cy - 6);
        ctx.restore();
      });
    }   // end else (normal vertex mode)
  }

  _drawArrow2D(ctx, x1, y1, x2, y2, color) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx*dx + dy*dy);
    if (len < 2) return;
    const ux = dx/len, uy = dy/len;
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const hs = 7;  // head size
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(mx + ux * hs, my + uy * hs);
    ctx.lineTo(mx - ux * hs - uy * hs, my - uy * hs + ux * hs);
    ctx.lineTo(mx - ux * hs + uy * hs, my - uy * hs - ux * hs);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  _applyHighlights() {
    if (this.mode === '2d') {
      this._draw2D();
    } else {
      this._applyHighlights3D();
      // Plane shown only when hovering a constraint row in the LP panel, not on 3D face hover
      if (this._planeVisible && this._planeForIdx !== null) {
        this._showConstraintPlane(this._planeForIdx);
      } else {
        this._hideConstraintPlane();
      }
    }
  }

  /* ─── 3D implementation ─────────────────── */

  _init3D() {
    this.mode = '3d';
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;

    this._scene  = new THREE.Scene();
    this._scene.background = null;  // transparent → CSS handles bg

    this._camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 1000);
    this._camera.position.set(13, 10, 16);

    this._renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this._renderer.setSize(w, h);
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.setClearColor(0x000000, 0);
    this.container.appendChild(this._renderer.domElement);

    this._controls = new OrbitControls(this._camera, this._renderer.domElement);
    this._controls.enableDamping = true;
    this._controls.dampingFactor = 0.06;
    this._controls.minDistance   = 3;
    this._controls.maxDistance   = 100;

    // Lights
    this._scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const dl = new THREE.DirectionalLight(0xffffff, 0.8);
    dl.position.set(12, 18, 15);
    this._scene.add(dl);

    // Custom axis lines: e1 (x1, red), e2 (x2, green), e3 (x3, blue) — long & bold
    const axisLen = 22;
    const mkAxis = (dir, hex) => {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0,0,0), new THREE.Vector3(...dir.map(v => v * axisLen)),
      ]);
      return new THREE.Line(geo, new THREE.LineBasicMaterial({ color: hex }));
    };
    this._scene.add(mkAxis([1,0,0], 0xff4444));   // e1 red
    this._scene.add(mkAxis([0,1,0], 0x44dd44));   // e2 green
    this._scene.add(mkAxis([0,0,1], 0x4488ff));   // e3 blue — explicitly created

    // Subtle XZ-plane grid (more transparent, lower contrast)
    const grid = new THREE.GridHelper(40, 40, 0x444466, 0x222233);
    const gridMats = Array.isArray(grid.material) ? grid.material : [grid.material];
    gridMats.forEach(m => { m.transparent = true; m.opacity = 0.18; });
    this._scene.add(grid);

    // Group for all LP-specific meshes — cleared and rebuilt on each setLP call
    this._lpGroup = new THREE.Group();
    this._scene.add(this._lpGroup);

    // 3D cursor management
    const domEl = this._renderer.domElement;
    domEl.classList.add('viz-grab');
    domEl.addEventListener('mousedown', () => { domEl.classList.remove('viz-grab'); domEl.classList.add('viz-grabbing'); });
    const onUp3D = () => { if (this._renderer) { domEl.classList.remove('viz-grabbing'); domEl.classList.add('viz-grab'); } };
    window.addEventListener('mouseup', onUp3D);
    this._up3DHandler = onUp3D;

    // Face raycasting for hover highlights
    domEl.addEventListener('mousemove', e => this._onMouseMove3D(e));
    domEl.addEventListener('mouseleave', () => this._onMouseLeave3D());

    // Option-point click (3D raycasting)
    domEl.addEventListener('click', e => this._onCanvasClick3D(e));

    new ResizeObserver(() => this.resize()).observe(this.container);
    this._animate3D();
  }

  _animate3D() {
    this._animId = requestAnimationFrame(() => this._animate3D());
    this._controls?.update();
    this._renderer?.render(this._scene, this._camera);
  }

  _build3D() {
    if (!this._scene || !this._lpGroup) return;

    // Dispose and remove all previous LP meshes from the group
    while (this._lpGroup.children.length) {
      const child = this._lpGroup.children[0];
      child.geometry?.dispose();
      if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
      else child.material?.dispose();
      this._lpGroup.remove(child);
    }
    this._faceMeshes = [];
    this._pathLine   = null;
    this._stepSphere = null;
    this._hideConstraintPlane();
    this._hoveredFaceIdx = null;

    if (this.vertices.length < 4) return;

    const { constraints } = this.lp;

    /* ── Solid polytope hull ── */
    const threePts = this.vertices.map(v => new THREE.Vector3(v[0], v[1], v[2]));
    try {
      const hullGeo = new ConvexGeometry(threePts);
      const hullMat = new THREE.MeshPhongMaterial({
        color: 0x818cf8,
        transparent: true,
        opacity: 0.12,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const hull = new THREE.Mesh(hullGeo, hullMat);
      this._lpGroup.add(hull);
    } catch (_) {}

    /* ── Constraint faces ── */
    const allCons = [
      ...constraints,
      { coefficients: [-1,0,0], sense: '<=', rhs: 0 },
      { coefficients: [0,-1,0], sense: '<=', rhs: 0 },
      { coefficients: [0,0,-1], sense: '<=', rhs: 0 },
    ];

    allCons.forEach((con, ci) => {
      // Find vertices active on this face
      const active = this.vertices.filter(v =>
        Math.abs(con.coefficients.reduce((s,a,i) => s+a*v[i], 0) - con.rhs) < 1e-4
      );
      if (active.length < 3) return;

      // Sort by angle around centroid on the face plane
      const cx = active.reduce((s,v)=>s+v[0],0)/active.length;
      const cy = active.reduce((s,v)=>s+v[1],0)/active.length;
      const cz = active.reduce((s,v)=>s+v[2],0)/active.length;
      const norm = new THREE.Vector3(...con.coefficients).normalize();
      const ref  = new THREE.Vector3(1,0,0);
      if (Math.abs(norm.dot(ref)) > 0.9) ref.set(0,1,0);
      const u = new THREE.Vector3().crossVectors(norm, ref).normalize();
      const w = new THREE.Vector3().crossVectors(norm, u).normalize();

      const sorted = [...active].sort((a, b) => {
        const da = new THREE.Vector3(a[0]-cx, a[1]-cy, a[2]-cz);
        const db = new THREE.Vector3(b[0]-cx, b[1]-cy, b[2]-cz);
        return Math.atan2(da.dot(w), da.dot(u)) - Math.atan2(db.dot(w), db.dot(u));
      });

      // Triangle fan
      const positions = [];
      for (let k = 1; k < sorted.length - 1; k++) {
        [sorted[0], sorted[k], sorted[k+1]].forEach(p => positions.push(p[0], p[1], p[2]));
      }
      if (positions.length === 0) return;

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.computeVertexNormals();

      const isUserConstraint = ci < constraints.length;
      const colorHex = isUserConstraint
        ? parseInt(CONSTRAINT_COLORS[ci % CONSTRAINT_COLORS.length].slice(1), 16)
        : 0x888899;

      const mat = new THREE.MeshPhongMaterial({
        color: colorHex,
        transparent: true,
        opacity: isUserConstraint ? 0.42 : 0.2,
        side: THREE.DoubleSide,
        depthWrite: false,
        emissive: colorHex,
        emissiveIntensity: 0.08,
      });

      const mesh = new THREE.Mesh(geo, mat);
      this._lpGroup.add(mesh);
      this._faceMeshes.push({ mesh, mat, constraintIdx: isUserConstraint ? ci + 1 : -1 });
    });

    /* ── Wireframe edges ── */
    if (this.vertices.length >= 2) {
      try {
        const hullGeo2 = new ConvexGeometry(threePts);
        const edgesGeo = new THREE.EdgesGeometry(hullGeo2, 10);
        const edgesMat = new THREE.LineBasicMaterial({ color: 0x818cf8, linewidth: 1, transparent: true, opacity: 0.7 });
        this._lpGroup.add(new THREE.LineSegments(edgesGeo, edgesMat));
      } catch (_) {}
    }

    /* ── Vertex spheres — small and vibrant ── */
    this.vertices.forEach((v, idx) => {
      const geo = new THREE.SphereGeometry(0.06, 12, 12);
      const mat = new THREE.MeshPhongMaterial({
        color: 0x00eeff,
        emissive: 0x00aacc,
        emissiveIntensity: 0.6,
        shininess: 120,
      });
      const s = new THREE.Mesh(geo, mat);
      s.position.set(v[0], v[1], v[2]);
      s.userData.vertexIdx = idx;
      this._lpGroup.add(s);
    });

    /* ── Simplex path ── */
    this._buildPath3D();
    this._applyHighlights3D();
  }

  _buildPath3D() {
    if (this.path.length < 2) return;
    const pts = this.path.map(p => new THREE.Vector3(p[0], p[1], p[2]));
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: 0xf59e0b, linewidth: 2, transparent: true, opacity: 0.9 });
    this._pathLine = new THREE.Line(geo, mat);
    this._lpGroup.add(this._pathLine);
  }

  _applyHighlights3D() {
    this._faceMeshes.forEach(({ mesh, mat, constraintIdx }) => {
      const active = this.highlighted.has(constraintIdx);
      mat.opacity          = active ? 0.78 : (constraintIdx > 0 ? 0.42 : 0.2);
      mat.emissiveIntensity = active ? 0.25 : 0.08;
    });

    // Remove old step sphere from group
    if (this._stepSphere) {
      this._lpGroup?.remove(this._stepSphere);
      this._stepSphere.geometry?.dispose();
      this._stepSphere.material?.dispose();
      this._stepSphere = null;
    }
    if (this.activeStep >= 0 && this.path[this.activeStep]) {
      const pt  = this.path[this.activeStep];
      const geo = new THREE.SphereGeometry(0.3, 16, 16);
      const mat = new THREE.MeshPhongMaterial({ color: 0xf59e0b, emissive: 0x331100 });
      this._stepSphere = new THREE.Mesh(geo, mat);
      this._stepSphere.position.set(pt[0], pt[1], pt[2]);
      this._lpGroup?.add(this._stepSphere);
    }
  }

  /* ─── Constraint hover (2D) ──────────────── */

  _onMouseMove2D(e) {
    if (!this.lp || this._panStart) return;
    const rect = this._canvas2d.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    if (this._optionMode) {
      // Track option-point hover for cursor + preview arrow; still allow constraint hover below
      let newOptIdx = -1;
      this._optionPoints.forEach((pt, i) => {
        const [cx, cy] = this._w2c(...pt);
        if (Math.hypot(px - cx, py - cy) < 20) newOptIdx = i;
      });
      if (newOptIdx !== this._hoveredOptIdx) {
        this._hoveredOptIdx = newOptIdx;
        this._canvas2d.classList.toggle('opt-hover', newOptIdx >= 0);
        // Clear any active constraint hover when the cursor enters an option point
        if (newOptIdx >= 0 && this._hoveredFaceIdx2D !== null) {
          const old2d = this._hoveredFaceIdx2D;
          this._hoveredFaceIdx2D = null;
          this.clearHighlight(old2d);
          this._onConstraintHover?.(old2d, false);
        }
        if (newOptIdx >= 0) {
          this._hoverPulseStart = performance.now();
          this._startAnim2D();
        }
        this._draw2D();
      }
      if (this._hoveredOptIdx >= 0) return; // option point blocks constraint hover
    } else {
      this._canvas2d.classList.remove('opt-hover');
    }

    let newIdx = null;
    this.lp.constraints.forEach((con, i) => {
      if (this._distToLine2D(con, px, py) < 9) newIdx = i + 1;
    });

    if (newIdx === this._hoveredFaceIdx2D) return;
    const old = this._hoveredFaceIdx2D;
    this._hoveredFaceIdx2D = newIdx;
    if (old !== null) {
      this.clearHighlight(old);
      this._onConstraintHover?.(old, false);
    }
    if (newIdx !== null) {
      this.highlightConstraint(newIdx);
      this._onConstraintHover?.(newIdx, true);
    }
  }

  _onMouseLeave2D() {
    if (this._canvas2d) this._canvas2d.classList.remove('opt-hover');
    if (this._hoveredOptIdx >= 0) {
      this._hoveredOptIdx = -1;
      this._draw2D();
    }
    if (this._hoveredFaceIdx2D !== null) {
      this.clearHighlight(this._hoveredFaceIdx2D);
      this._onConstraintHover?.(this._hoveredFaceIdx2D, false);
      this._hoveredFaceIdx2D = null;
    }
  }

  /** Pixel distance from canvas point (px,py) to the drawn constraint line */
  _distToLine2D(con, px, py) {
    const [a, b] = con.coefficients;
    const rhs    = con.rhs;
    let x1w, y1w, x2w, y2w;
    if (Math.abs(b) > 1e-9) {
      x1w = -10; y1w = (rhs - a * x1w) / b;
      x2w =  80; y2w = (rhs - a * x2w) / b;
    } else if (Math.abs(a) > 1e-9) {
      x1w = rhs / a; y1w = -10;
      x2w = rhs / a; y2w =  80;
    } else return Infinity;
    const [cx1, cy1] = this._w2c(x1w, y1w);
    const [cx2, cy2] = this._w2c(x2w, y2w);
    const dx = cx2 - cx1, dy = cy2 - cy1;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-9) return Math.hypot(px - cx1, py - cy1);
    const t = Math.max(0, Math.min(1, ((px - cx1) * dx + (py - cy1) * dy) / len2));
    return Math.hypot(px - (cx1 + t * dx), py - (cy1 + t * dy));
  }

  /* ─── Constraint hover (3D) ──────────────── */

  _onMouseMove3D(e) {
    if (!this._scene || !this._camera || !this._faceMeshes.length) return;
    const domEl = this._renderer.domElement;
    const rect  = domEl.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left)  / rect.width)  * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(mouse, this._camera);
    const hits = ray.intersectObjects(this._faceMeshes.map(f => f.mesh));

    // Option-sphere cursor in 3D
    if (this._optionMode && this._optionSpheres.length) {
      const optHits = ray.intersectObjects(
        this._optionSpheres.filter(s => s.point !== null).map(s => s.mesh)
      );
      domEl.style.cursor = optHits.length ? 'pointer' : '';
    } else {
      domEl.style.cursor = '';
    }

    let newIdx = null;
    if (hits.length) {
      const hit  = hits[0].object;
      const face = this._faceMeshes.find(f => f.mesh === hit);
      if (face && face.constraintIdx >= 1) newIdx = face.constraintIdx;
    }

    if (newIdx === this._hoveredFaceIdx) return;
    const old = this._hoveredFaceIdx;
    this._hoveredFaceIdx = newIdx;
    if (old !== null) {
      this.clearHighlight(old);
      this._onConstraintHover?.(old, false);
    }
    if (newIdx !== null) {
      this.highlightConstraint(newIdx);
      this._onConstraintHover?.(newIdx, true);
    }
  }

  _onMouseLeave3D() {
    if (this._renderer) this._renderer.domElement.style.cursor = '';
    if (this._hoveredFaceIdx !== null) {
      this.clearHighlight(this._hoveredFaceIdx);
      this._onConstraintHover?.(this._hoveredFaceIdx, false);
      this._hoveredFaceIdx = null;
    }
  }

  /* ─── Option-point click handlers ───────── */

  _onCanvasClick2D(e) {
    if (!this._optionMode || !this._optionPoints.length) return;
    const rect = this._canvas2d.getBoundingClientRect();
    const px   = e.clientX - rect.left;
    const py   = e.clientY - rect.top;
    const idx  = this._optionPoints.findIndex(pt => {
      const [cx, cy] = this._w2c(...pt);
      return Math.hypot(px - cx, py - cy) < 20;
    });
    if (idx >= 0) {
      const pt = this._optionPoints[idx]; // capture before state changes
      this._clickAnimIdx   = idx;
      this._clickAnimStart = performance.now();
      this._clickAnimEnd   = this._clickAnimStart + 380;
      this._startAnim2D();
      // Delay callback so the ripple animation plays before the state is cleared
      setTimeout(() => this._onOptionSelect?.(pt), 380);
    }
  }

  _onCanvasClick3D(e) {
    if (!this._optionMode || !this._optionSpheres.length) return;
    const domEl = this._renderer.domElement;
    const rect  = domEl.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width)  * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(mouse, this._camera);
    const hits = ray.intersectObjects(this._optionSpheres.map(s => s.mesh));
    if (hits.length) {
      const idx = this._optionSpheres.findIndex(s => s.mesh === hits[0].object);
      if (idx >= 0) this._onOptionSelect?.(this._optionSpheres[idx].point);
    }
  }

  /* ─── 3D option-sphere management ─────── */

  _rebuildOptionSpheres3D() {
    this._removeOptionSpheres3D();
    if (!this._lpGroup) return;

    // Current-position sphere (gold)
    if (this._optionCurrent) {
      const geo = new THREE.SphereGeometry(0.28, 16, 16);
      const mat = new THREE.MeshPhongMaterial({ color: 0xf59e0b, emissive: 0x331100, emissiveIntensity: 0.5 });
      const s   = new THREE.Mesh(geo, mat);
      s.position.set(...this._optionCurrent);
      this._lpGroup.add(s);
      this._optionSpheres.push({ mesh: s, point: null }); // null = current, not clickable
    }

    // Option-point spheres (accent color, larger + clickable)
    this._optionPoints.forEach(pt => {
      const geo = new THREE.SphereGeometry(0.22, 16, 16);
      const mat = new THREE.MeshPhongMaterial({ color: 0x818cf8, emissive: 0x2222aa, emissiveIntensity: 0.4 });
      const s   = new THREE.Mesh(geo, mat);
      s.position.set(...pt);
      this._lpGroup.add(s);
      this._optionSpheres.push({ mesh: s, point: pt });
    });
  }

  _removeOptionSpheres3D() {
    this._optionSpheres.forEach(({ mesh }) => {
      mesh.geometry?.dispose();
      mesh.material?.dispose();
      this._lpGroup?.remove(mesh);
    });
    this._optionSpheres = [];
  }

  /* ─── Full constraint plane (3D) ─────────── */

  _showConstraintPlane(constraintIdx) {
    this._hideConstraintPlane();
    if (!this._lpGroup || !this.lp) return;
    const con = this.lp.constraints[constraintIdx - 1];
    if (!con) return;

    const coeffs = con.coefficients;
    const aDotA  = coeffs.reduce((s, v) => s + v * v, 0);
    if (aDotA < 1e-12) return;

    // ── Build local 2D axes for the plane ──
    const normal = new THREE.Vector3(...coeffs).normalize();
    const ref    = Math.abs(normal.x) < 0.9
      ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const uAxis  = ref.clone().sub(normal.clone().multiplyScalar(normal.dot(ref))).normalize();
    const vAxis  = normal.clone().cross(uAxis);

    // ── Find face vertices and project to local 2D to size the plane ──
    const faceVerts = this.vertices.filter(v =>
      Math.abs(coeffs.reduce((s, c, i) => s + c * v[i], 0) - con.rhs) < 1e-6
    );
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    faceVerts.forEach(v => {
      const p  = new THREE.Vector3(...v);
      const pu = p.dot(uAxis), pv = p.dot(vAxis);
      if (pu < minU) minU = pu; if (pu > maxU) maxU = pu;
      if (pv < minV) minV = pv; if (pv > maxV) maxV = pv;
    });
    const PAD = 2.5;
    const sW  = (isFinite(maxU) ? maxU - minU : 20) + PAD * 2;
    const sH  = (isFinite(maxV) ? maxV - minV : 20) + PAD * 2;

    // ── Center on face centroid ──
    const foot   = coeffs.map(c => c * con.rhs / aDotA);
    const center = faceVerts.length >= 2
      ? new THREE.Vector3(
          faceVerts.reduce((s, v) => s + v[0], 0) / faceVerts.length,
          faceVerts.reduce((s, v) => s + v[1], 0) / faceVerts.length,
          faceVerts.reduce((s, v) => s + v[2], 0) / faceVerts.length
        )
      : new THREE.Vector3(foot[0], foot[1] ?? 0, foot[2] ?? 0);

    // ── Canvas grid texture ──
    const hexStr = CONSTRAINT_COLORS[(constraintIdx - 1) % CONSTRAINT_COLORS.length];
    const hex    = parseInt(hexStr.slice(1), 16);
    const cr = (hex >> 16) & 0xff, cg = (hex >> 8) & 0xff, cb = hex & 0xff;
    const tSize = 256, cells = 6;
    const cvs   = document.createElement('canvas');
    cvs.width   = cvs.height = tSize;
    const c2d   = cvs.getContext('2d');
    c2d.fillStyle = `rgba(${cr},${cg},${cb},0.12)`;
    c2d.fillRect(0, 0, tSize, tSize);
    c2d.strokeStyle = `rgba(${cr},${cg},${cb},0.65)`;
    c2d.lineWidth   = 1.5;
    const gstep = tSize / cells;
    for (let i = 0; i <= cells; i++) {
      const p = i * gstep;
      c2d.beginPath(); c2d.moveTo(p, 0);     c2d.lineTo(p, tSize); c2d.stroke();
      c2d.beginPath(); c2d.moveTo(0, p);     c2d.lineTo(tSize, p); c2d.stroke();
    }
    const tex = new THREE.CanvasTexture(cvs);

    // ── Mesh ──
    const geo = new THREE.PlaneGeometry(sW, sH);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this._planeMesh = new THREE.Mesh(geo, mat);
    this._planeMesh.position.copy(center);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    this._planeMesh.quaternion.copy(q);
    this._lpGroup.add(this._planeMesh);
  }

  _hideConstraintPlane() {
    if (this._planeMesh) {
      this._planeMesh.geometry?.dispose();
      this._planeMesh.material?.map?.dispose();
      this._planeMesh.material?.dispose();
      this._lpGroup?.remove(this._planeMesh);
      this._planeMesh = null;
    }
  }

  /* ─── Cleanup ────────────────────────────── */

  _cleanup() {
    if (this.mode === '2d') {
      this._stopAnim2D();
      this._canvas2d?.remove();
      this._canvas2d = null;
      this._ctx      = null;
      this._panStart = null;
      if (this._panMoveHandler) window.removeEventListener('mousemove', this._panMoveHandler);
      if (this._panUpHandler)   window.removeEventListener('mouseup',   this._panUpHandler);
      this._panMoveHandler = null;
      this._panUpHandler   = null;
    } else if (this.mode === '3d') {
      if (this._animId) cancelAnimationFrame(this._animId);
      this._removeOptionSpheres3D();
      this._hideConstraintPlane();
      if (this._up3DHandler) window.removeEventListener('mouseup', this._up3DHandler);
      this._up3DHandler = null;
      this._renderer?.domElement.remove();
      this._renderer?.dispose();
      this._scene     = null;
      this._renderer  = null;
      this._camera    = null;
      this._controls  = null;
      this._faceMeshes = [];
    }
    this.mode = null;
  }
}
