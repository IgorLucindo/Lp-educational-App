/**
 * generateLogfiles.js — batch-generate simplex log files for random LP problems.
 *
 * Usage:  node generateLogfiles.js [n]
 *   n  number of problems to generate (default: 20)
 *
 * Output files land in ./logfiles/
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname }           from 'path';
import { fileURLToPath }           from 'url';

import { LPGenerator }  from './website/src/classes/LPGenerator.js';
import { SimplexSolver } from './website/src/classes/Solver.js';
import { formatLPText }  from './website/src/utils/utils.js';

const __dir = dirname(fileURLToPath(import.meta.url));

const SOLUTION_TYPES = ['unique', 'multiple', 'infeasible'];
const NUM_VARS_OPTS  = [2, 3];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(lo, hi) { return Math.floor(Math.random() * (hi - lo + 1)) + lo; }

function buildLog(lp, solver) {
  const header =
    `LP Simplex Log — ${new Date().toLocaleString()}\n` +
    `${'═'.repeat(60)}\n\n` +
    formatLPText(lp) +
    `\n${'═'.repeat(60)}\n\n`;

  const body = solver.generateLog().map(l => l.text).join('\n');
  return header + body;
}

function run(n) {
  const outDir = join(__dir, 'logfiles');
  mkdirSync(outDir, { recursive: true });

  let ok = 0, failed = 0;

  for (let i = 0; i < n; i++) {
    const numVars        = pick(NUM_VARS_OPTS);
    const solutionType   = pick(SOLUTION_TYPES);
    const numConstraints = randInt(2, 8);

    let lp;
    try {
      lp = LPGenerator.generate(numVars, solutionType, numConstraints);
    } catch (e) {
      console.warn(`  [${i + 1}] LPGenerator failed:`, e.message);
      failed++;
      continue;
    }

    const solver = new SimplexSolver();
    solver.setup(lp).solve();

    const ts    = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const label = `${numVars}v_${solutionType}_${numConstraints}c`;
    const fname = `simplex_${String(i + 1).padStart(3, '0')}_${label}_${ts}.txt`;
    const fpath = join(outDir, fname);

    try {
      writeFileSync(fpath, buildLog(lp, solver), 'utf8');
      console.log(`  [${i + 1}/${n}] ${fname}`);
      ok++;
    } catch (e) {
      console.warn(`  [${i + 1}] Write failed:`, e.message);
      failed++;
    }
  }

  console.log(`\nDone — ${ok} written, ${failed} failed.  Output: ${outDir}`);
}

const n = parseInt(process.argv[2] ?? '20', 10);
if (isNaN(n) || n < 1) {
  console.error('Usage: node generateLogfiles.js [n]  (n must be a positive integer)');
  process.exit(1);
}

console.log(`Generating ${n} LP log file(s)…\n`);
run(n);
