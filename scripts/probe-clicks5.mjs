/**
 * Click probe, part 5 — investigation only, changes nothing.
 *
 * Hypothesis-free sweep: render long dense runs, find every outlier
 * sample-to-sample step in the output, then classify where each one landed
 * (block boundary / message boundary / grain onset / grain end / elsewhere).
 * This catches discontinuity sources the earlier targeted probes did not model.
 *
 * Run: node scripts/probe-clicks5.mjs
 */
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadWorkletClass, makePink, makeWhite } from "./lib/offline-worklet.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { FieldObserver } = await import(
  pathToFileURL(join(root, "src/field/FieldObserver.ts")).href
);
const { GrainScheduler, MASTER_GAIN } = await import(
  pathToFileURL(join(root, "src/field/GrainScheduler.ts")).href
);
const { TEST_PATTERNS } = await import(
  pathToFileURL(join(root, "src/field/TestPatterns.ts")).href
);

const W = 128, H = 128, N = W * H;
const FS = 48000, BLOCK = 128, STEP_MS = 1000 / 30;
const BPS = FS / 30 / BLOCK;
const SOURCE_DUR_SEC = 30;
const STEPS = 400;

const fmt = (x, n = 2) => (Number.isFinite(x) ? x.toFixed(n) : "n/a");
const send = (proc, msg) => {
  const h = proc.port.onmessage;
  if (typeof h === "function") h({ data: msg });
};

const pcm = makePink(FS * SOURCE_DUR_SEC);
const Processor = await loadWorkletClass(FS);

function run(patternId) {
  const pattern = TEST_PATTERNS.find((p) => p.id === patternId);
  if (!pattern) return null;
  const obs = new FieldObserver(W, H);
  const sched = new GrainScheduler();
  sched.setSourceDurationSec(SOURCE_DUR_SEC);
  const mk = () => ({ width: W, height: H, r: new Float32Array(N), g: new Float32Array(N), b: new Float32Array(N) });
  const q = (f) => { for (let i = 0; i < N; i++) { f.r[i] = Math.round(f.r[i] * 255) / 255; f.g[i] = Math.round(f.g[i] * 255) / 255; f.b[i] = Math.round(f.b[i] * 255) / 255; } };
  let prev = mk(), cur = mk();
  pattern.fill(prev, 0); q(prev);

  const proc = new Processor();
  send(proc, { type: "source", sampleRate: FS, length: pcm.length, pcm });
  proc.masterGain = 1; proc.masterGainTarget = 1; proc.normGain = 1; proc.preScale = 1;

  const L = [], R = [];
  const msgAt = new Set();     // sample index where an events message landed
  const onsetAt = new Set();   // sample index where a grain's first sample plays
  const endAt = new Set();     // sample index where a grain's last sample played
  let blockAcc = 0;

  // Track per-voice onset/end by watching age transitions each block.
  const wasSounding = new Array(128).fill(false);

  for (let step = 1; step <= STEPS; step++) {
    pattern.fill(cur, step); q(cur);
    const o = obs.observe(cur, prev);
    const batch = sched.step(o, cur, step * STEP_MS);
    msgAt.add(L.length);
    send(proc, { type: "events", masterGain: MASTER_GAIN, events: batch.events, tracks: batch.tracks });

    blockAcc += BPS;
    const nb = Math.floor(blockAcc); blockAcc -= nb;
    for (let b = 0; b < nb; b++) {
      const before = proc.voices.map((v) => v.active && v.delaySamples <= 0 && v.age > 0);
      const blockStart = L.length;
      const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
      proc.process([], [[l, r]]);
      for (let i = 0; i < BLOCK; i++) { L.push(l[i]); R.push(r[i]); }
      for (let vi = 0; vi < proc.voices.length; vi++) {
        const now = proc.voices[vi].active && proc.voices[vi].delaySamples <= 0 && proc.voices[vi].age > 0;
        if (!before[vi] && now) onsetAt.add(blockStart);
        if (before[vi] && !now) endAt.add(blockStart);
      }
    }
    const t = prev; prev = cur; cur = t;
  }

  return { L: Float32Array.from(L), R: Float32Array.from(R), msgAt, onsetAt, endAt };
}

/**
 * Outlier sweep on one channel: flag samples whose first difference is far
 * beyond the locally expected magnitude. Local scale from a 4096-sample
 * running window so a loud passage does not swamp a quiet one.
 */
function sweep(x, { k = 8, absFloorRel = 0.05 } = {}) {
  const n = x.length;
  const d = new Float32Array(n);
  for (let i = 1; i < n; i++) d[i] = x[i] - x[i - 1];

  // Running mean-square of d over a 4096 window via prefix sums.
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + d[i] * d[i];
  const preX = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) preX[i + 1] = preX[i] + x[i] * x[i];
  const HALF = 2048;

  let globalRms = Math.sqrt(preX[n] / n);
  const hits = [];
  for (let i = 1; i < n; i++) {
    const lo = Math.max(0, i - HALF), hi = Math.min(n, i + HALF);
    const scale = Math.sqrt((pre[hi] - pre[lo]) / (hi - lo));
    if (scale <= 0) continue;
    const ratio = Math.abs(d[i]) / scale;
    if (ratio > k && Math.abs(d[i]) > absFloorRel * globalRms) {
      hits.push({ i, d: d[i], ratio, scale });
    }
  }
  return { hits, globalRms };
}

function classify(hits, marks) {
  const { msgAt, onsetAt, endAt } = marks;
  const counts = { blockBoundary: 0, message: 0, onset: 0, end: 0, other: 0 };
  const examples = [];
  for (const h of hits) {
    const atBlock = h.i % BLOCK === 0;
    // A message lands at a block start; onsets/ends are recorded at block start.
    let tag;
    if (msgAt.has(h.i)) tag = "message";
    else if (onsetAt.has(h.i)) tag = "onset";
    else if (endAt.has(h.i)) tag = "end";
    else if (atBlock) tag = "blockBoundary";
    else tag = "other";
    counts[tag === "message" ? "message" : tag === "onset" ? "onset" : tag === "end" ? "end" : tag === "blockBoundary" ? "blockBoundary" : "other"]++;
    if (examples.length < 6) examples.push({ ...h, tag });
  }
  return { counts, examples };
}

const SCENARIOS = ["chaos-blob-10pct", "moving-bar", "glider-swarm", "full-flicker", "two-blobs-merge", "pulse-calm", "osc-field"];

console.log("=== full-signal outlier sweep ===");
console.log("flag: |x[i]-x[i-1]| > 8 x local first-difference RMS (4096-sample window)");
console.log("a clean granular bed should produce essentially zero hits\n");

for (const id of SCENARIOS) {
  const r = run(id);
  if (!r) { console.log(`-- ${id}: not found`); continue; }
  const secs = r.L.length / FS;
  const sL = sweep(r.L), sR = sweep(r.R);
  const cL = classify(sL.hits, r), cR = classify(sR.hits, r);
  const total = sL.hits.length + sR.hits.length;
  console.log(`--- ${id} (${fmt(secs, 1)} s rendered) ---`);
  console.log(
    `  outliers: L ${sL.hits.length}, R ${sR.hits.length}  ` +
    `= ${fmt(total / secs / 2, 2)} per channel-second`,
  );
  const merged = {};
  for (const k of Object.keys(cL.counts)) merged[k] = cL.counts[k] + cR.counts[k];
  console.log(`  by cause: ${Object.entries(merged).map(([k, v]) => `${k}=${v}`).join("  ")}`);
  const worst = [...sL.hits, ...sR.hits].sort((a, b) => b.ratio - a.ratio).slice(0, 3);
  for (const w of worst) {
    const atBlock = w.i % BLOCK === 0;
    const tag = r.msgAt.has(w.i) ? "message" : r.onsetAt.has(w.i) ? "onset" : r.endAt.has(w.i) ? "end" : atBlock ? "blockBoundary" : "mid-block";
    console.log(`    t=${fmt(w.i / FS, 3)}s  step ${fmt(Math.abs(w.d), 5)}  ratio ${fmt(w.ratio, 1)}  ${tag}`);
  }
  console.log("");
}
