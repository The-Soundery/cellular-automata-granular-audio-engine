/**
 * Click probe, part 3 — investigation only, changes nothing.
 *
 * Part 2 showed dense scenarios mask individual grain events. This isolates the
 * mechanisms with controlled single-grain tests where nothing can mask them,
 * then benchmarks the worklet against its realtime deadline.
 *
 * Run: node scripts/probe-clicks3.mjs
 */
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadWorkletClass, makePink } from "./lib/offline-worklet.mjs";

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
const DEADLINE_MS = (BLOCK / FS) * 1000;
const SOURCE_DUR_SEC = 30;

const db = (x) => 20 * Math.log10(Math.max(1e-12, x));
const fmt = (x, n = 2) => (Number.isFinite(x) ? x.toFixed(n) : "n/a");
const send = (proc, msg) => {
  const h = proc.port.onmessage;
  if (typeof h === "function") h({ data: msg });
};

const pcm = makePink(FS * SOURCE_DUR_SEC);
const Processor = await loadWorkletClass(FS);

function newProc() {
  const p = new Processor();
  send(p, { type: "source", sampleRate: FS, length: pcm.length, pcm });
  p.masterGain = 1; p.masterGainTarget = 1; p.normGain = 1; p.preScale = 1;
  return p;
}
/** Render n blocks, returning interleaved-free L/R plus mono. Gains pinned. */
function render(proc, n) {
  const L = [], R = [], M = [];
  for (let b = 0; b < n; b++) {
    const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
    proc.process([], [[l, r]]);
    proc.normGain = 1; proc.preScale = 1; proc.masterGain = 1;
    for (let i = 0; i < BLOCK; i++) { L.push(l[i]); R.push(r[i]); M.push(0.5 * (l[i] + r[i])); }
  }
  return { L, R, M };
}
function jumpAt(arr, k, span = 2048) {
  const d = Math.abs(arr[k] - arr[k - 1]);
  let e = 0, n = 0;
  for (let i = Math.max(1, k - span); i < Math.min(arr.length, k + span); i++) {
    if (Math.abs(i - k) < 4) continue;
    const dd = arr[i] - arr[i - 1];
    e += dd * dd; n++;
  }
  const s = n ? Math.sqrt(e / n) : 0;
  let re = 0, rn = 0;
  for (let i = Math.max(0, k - span); i < Math.min(arr.length, k + span); i++) { re += arr[i] * arr[i]; rn++; }
  return { jump: d, diffRms: s, ratio: s > 0 ? d / s : Infinity, rms: rn ? Math.sqrt(re / rn) : 0 };
}

const baseEvent = (over = {}) => ({
  x: 100, y: 64, r: 0.5, g: 0.3, b: 0.7,
  durationSec: 1.5, amplitude: 0.5, direction: 1,
  sampleCenter: 0.5, sampleHalf: 0.02, startOffsetSec: 0,
  q: 2, yNorm: 0.5, pan: 0,
  attackFrac: 0.2, releaseFrac: 0.2,
  regime: "calm", regionId: 0, trackDx: 0, trackDy: 0, readOffset: 0,
  ...over,
});
const track = (anchorX, anchorY = 64) => ([{
  regionId: 0, comX: anchorX, comY: anchorY,
  anchorX, anchorY, gridWidth: W, gridHeight: H,
}]);

console.log("=== A. single tracked grain, region COM crosses the torus seam ===");
console.log("    (this is what a coherent structure drifting off one edge does)\n");
{
  const proc = newProc();
  // Grain sits 3 cells right of a COM at x=100 -> spawn pan from x=103.
  send(proc, {
    type: "events", masterGain: 1,
    events: [baseEvent({ x: 103, pan: (103 / 127) * 2 - 1, trackDx: 3, regionId: 0 })],
    tracks: track(100),
  });
  render(proc, 40); // let the attack finish so the grain is at full level

  const v = proc.voices.find((z) => z.active);
  const seq = [110, 120, 126, 0.5, 6];  // anchor wraps 126 -> 0.5
  for (const a of seq) {
    const panBefore = v.pan, gLbefore = v.gainL, gRbefore = v.gainR;
    const { M, L } = render(proc, 1);   // one block at the current anchor
    send(proc, { type: "track", tracks: track(a) });
    const after = render(proc, 2);
    const merged = M.concat(after.M);
    const k = M.length;               // first sample rendered under the new anchor
    const m = jumpAt(merged, k, 1024);
    console.log(
      `  anchor -> ${String(a).padStart(5)}   pan ${fmt(panBefore, 3).padStart(6)} -> ${fmt(v.pan, 3).padStart(6)}` +
      `   gainL ${fmt(gLbefore, 3)} -> ${fmt(v.gainL, 3)}` +
      `   panSaturated ${v.panSaturated}` +
      `   rendered jump ${fmt(m.jump, 4)} vs local rms ${fmt(m.rms, 4)}  ratio ${fmt(m.ratio, 1)}`,
    );
  }
  console.log("");
}

console.log("=== B. single tracked grain, region COM jumps vertically (Y -> bandpass) ===");
console.log("    (yNorm retunes the per-grain bandpass AND its compensation gain)\n");
{
  const proc = newProc();
  send(proc, {
    type: "events", masterGain: 1,
    events: [baseEvent({ x: 64, y: 100, pan: 0, trackDx: 0, trackDy: 36, regionId: 0, yNorm: 1 - 100 / 127 })],
    tracks: track(64, 64),
  });
  render(proc, 40);
  const v = proc.voices.find((z) => z.active);
  for (const ay of [64, 40, 10, 100, 64]) {
    const yBefore = v.yNorm;
    const { M } = render(proc, 1);
    send(proc, { type: "track", tracks: track(64, ay) });
    const after = render(proc, 2);
    const merged = M.concat(after.M);
    const m = jumpAt(merged, M.length, 1024);
    console.log(
      `  anchorY -> ${String(ay).padStart(3)}   yNorm ${fmt(yBefore, 3)} -> ${fmt(v.yNorm, 3)}` +
      `   bpGain now ${fmt(v.bpGain, 4)}` +
      `   rendered jump ${fmt(m.jump, 4)} vs local rms ${fmt(m.rms, 4)}  ratio ${fmt(m.ratio, 1)}`,
    );
  }
  console.log("");
}

console.log("=== C. how many voices are actually sounding when the seam is crossed? ===");
{
  const pattern = TEST_PATTERNS.find((p) => p.id === "moving-bar");
  const obs = new FieldObserver(W, H);
  const sched = new GrainScheduler();
  sched.setSourceDurationSec(SOURCE_DUR_SEC);
  const mk = () => ({ width: W, height: H, r: new Float32Array(N), g: new Float32Array(N), b: new Float32Array(N) });
  const q = (f) => { for (let i = 0; i < N; i++) { f.r[i] = Math.round(f.r[i] * 255) / 255; f.g[i] = Math.round(f.g[i] * 255) / 255; f.b[i] = Math.round(f.b[i] * 255) / 255; } };
  let prev = mk(), cur = mk();
  pattern.fill(prev, 0); q(prev);

  const proc = newProc();
  let blockAcc = 0;
  const report = [];
  let lastAnchor = new Map();

  for (let step = 1; step <= 300; step++) {
    pattern.fill(cur, step); q(cur);
    const o = obs.observe(cur, prev);
    const batch = sched.step(o, cur, step * STEP_MS);

    // Detect a seam wrap in any track before delivering it.
    let wrapped = null;
    for (const t of batch.tracks) {
      const p = lastAnchor.get(t.regionId);
      if (p !== undefined && Math.abs(t.anchorX - p) > W / 2) {
        wrapped = { regionId: t.regionId, from: p, to: t.anchorX };
      }
      lastAnchor.set(t.regionId, t.anchorX);
    }

    let soundingBefore = 0, trackedSounding = 0;
    if (wrapped) {
      for (const v of proc.voices) {
        if (!v.active || v.delaySamples > 0 || v.age <= 0 || v.age >= v.duration) continue;
        soundingBefore++;
        if (v.regionId === wrapped.regionId) trackedSounding++;
      }
    }
    const panBefore = wrapped ? proc.voices.map((v) => v.pan) : null;

    send(proc, { type: "events", masterGain: MASTER_GAIN, events: batch.events, tracks: batch.tracks });

    if (wrapped) {
      let maxPanDelta = 0, nBig = 0;
      for (let i = 0; i < proc.voices.length; i++) {
        const v = proc.voices[i];
        if (!v.active || v.delaySamples > 0 || v.age <= 0 || v.age >= v.duration) continue;
        const d = Math.abs(v.pan - panBefore[i]);
        if (d > maxPanDelta) maxPanDelta = d;
        if (d > 0.5) nBig++;
      }
      report.push({ step, ...wrapped, soundingBefore, trackedSounding, maxPanDelta, nBig });
    }

    blockAcc += BPS;
    const nb = Math.floor(blockAcc); blockAcc -= nb;
    for (let b = 0; b < nb; b++) {
      const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
      proc.process([], [[l, r]]);
    }
    const t = prev; prev = cur; cur = t;
  }
  if (report.length === 0) {
    console.log("  no seam wraps observed in this pattern's track stream");
  }
  for (const r of report) {
    console.log(
      `  step ${String(r.step).padStart(3)}  region ${r.regionId}  anchorX ${fmt(r.from, 1)} -> ${fmt(r.to, 1)}` +
      `   sounding voices ${r.soundingBefore} (of which tracked ${r.trackedSounding})` +
      `   max |Δpan| ${fmt(r.maxPanDelta, 3)}   voices with |Δpan|>0.5: ${r.nBig}`,
    );
  }
  console.log("");
}

console.log("=== D. worklet CPU vs realtime deadline ===");
console.log(`    one 128-frame block must render in < ${fmt(DEADLINE_MS, 3)} ms\n`);
{
  const pattern = TEST_PATTERNS.find((p) => p.id === "chaos-blob-10pct");
  const obs = new FieldObserver(W, H);
  const sched = new GrainScheduler();
  sched.setSourceDurationSec(SOURCE_DUR_SEC);
  const mk = () => ({ width: W, height: H, r: new Float32Array(N), g: new Float32Array(N), b: new Float32Array(N) });
  const q = (f) => { for (let i = 0; i < N; i++) { f.r[i] = Math.round(f.r[i] * 255) / 255; f.g[i] = Math.round(f.g[i] * 255) / 255; f.b[i] = Math.round(f.b[i] * 255) / 255; } };
  let prev = mk(), cur = mk();
  pattern.fill(prev, 0); q(prev);
  const steps = [];
  for (let s = 1; s <= 200; s++) {
    pattern.fill(cur, s); q(cur);
    const o = obs.observe(cur, prev);
    const b = sched.step(o, cur, s * STEP_MS);
    steps.push({ events: b.events.map((e) => ({ ...e })), tracks: b.tracks.map((t) => ({ ...t })) });
    const t = prev; prev = cur; cur = t;
  }

  const proc = newProc();
  // Make emitStats do real work: the stub port swallows it, so count instead.
  let statsCalls = 0;
  const origEmit = proc.emitStats.bind(proc);
  proc.emitStats = (a, b) => { const before = proc.blockCounter % 8; origEmit(a, b); if (before === 0) statsCalls++; };

  const statsBlocks = [], plainBlocks = [], msgTimes = [];
  let blockAcc = 0, maxVoices = 0;
  const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);

  for (let s = 0; s < steps.length; s++) {
    const t0 = process.hrtime.bigint();
    send(proc, { type: "events", masterGain: MASTER_GAIN, events: steps[s].events, tracks: steps[s].tracks });
    msgTimes.push(Number(process.hrtime.bigint() - t0) / 1e6);
    blockAcc += BPS;
    const nb = Math.floor(blockAcc); blockAcc -= nb;
    for (let b = 0; b < nb; b++) {
      const isStats = proc.blockCounter % 8 === 0;
      const b0 = process.hrtime.bigint();
      proc.process([], [[l, r]]);
      const ms = Number(process.hrtime.bigint() - b0) / 1e6;
      if (s > 50) (isStats ? statsBlocks : plainBlocks).push(ms);
      let act = 0;
      for (const v of proc.voices) if (v.active) act++;
      if (act > maxVoices) maxVoices = act;
    }
  }
  const stat = (a) => {
    const s = [...a].sort((x, y) => x - y);
    return {
      p50: s[Math.floor(s.length * 0.5)] ?? 0,
      p99: s[Math.floor(s.length * 0.99)] ?? 0,
      max: s[s.length - 1] ?? 0,
    };
  };
  const P = stat(plainBlocks), S = stat(statsBlocks), Mm = stat(msgTimes);
  console.log(`  peak concurrent voices: ${maxVoices} (MAX_GRAINS=128, GRAIN_BUDGET=64)`);
  console.log(`  plain block  p50 ${fmt(P.p50, 3)} ms  p99 ${fmt(P.p99, 3)} ms  max ${fmt(P.max, 3)} ms` +
    `   = ${fmt((P.p50 / DEADLINE_MS) * 100, 1)}% / ${fmt((P.max / DEADLINE_MS) * 100, 1)}% of deadline`);
  console.log(`  emitStats block p50 ${fmt(S.p50, 3)} ms  p99 ${fmt(S.p99, 3)} ms  max ${fmt(S.max, 3)} ms` +
    `   = ${fmt((S.p50 / DEADLINE_MS) * 100, 1)}% / ${fmt((S.max / DEADLINE_MS) * 100, 1)}% of deadline`);
  console.log(`  message handling (spawnEvents + applyTracks) p50 ${fmt(Mm.p50, 3)} ms  max ${fmt(Mm.max, 3)} ms`);
  console.log(`  NOTE: node here has no structured clone and a no-op postMessage;`);
  console.log(`        the browser pays serialisation + GC on top of these numbers.\n`);
}

console.log("=== E. ping-pong window geometry ===");
{
  const pattern = TEST_PATTERNS.find((p) => p.id === "chaos-blob-10pct");
  const obs = new FieldObserver(W, H);
  const sched = new GrainScheduler();
  sched.setSourceDurationSec(SOURCE_DUR_SEC);
  const mk = () => ({ width: W, height: H, r: new Float32Array(N), g: new Float32Array(N), b: new Float32Array(N) });
  const q = (f) => { for (let i = 0; i < N; i++) { f.r[i] = Math.round(f.r[i] * 255) / 255; f.g[i] = Math.round(f.g[i] * 255) / 255; f.b[i] = Math.round(f.b[i] * 255) / 255; } };
  let prev = mk(), cur = mk();
  pattern.fill(prev, 0); q(prev);
  let minHalfSec = Infinity, maxBouncesPerGrain = 0, nEv = 0;
  for (let s = 1; s <= 200; s++) {
    pattern.fill(cur, s); q(cur);
    const o = obs.observe(cur, prev);
    const b = sched.step(o, cur, s * STEP_MS);
    for (const e of b.events) {
      nEv++;
      const halfSec = e.sampleHalf * SOURCE_DUR_SEC;
      if (halfSec < minHalfSec) minHalfSec = halfSec;
      const bounces = e.durationSec / (2 * halfSec);
      if (bounces > maxBouncesPerGrain) maxBouncesPerGrain = bounces;
    }
    const t = prev; prev = cur; cur = t;
  }
  console.log(`  ${nEv} events: narrowest window half-width ${fmt(minHalfSec * 1000, 1)} ms` +
    ` -> ping-pong reversal every ${fmt(minHalfSec * 2 * 1000, 1)} ms (${fmt(1 / (minHalfSec * 2), 1)} Hz)`);
  console.log(`  most reversals within one grain: ${fmt(maxBouncesPerGrain, 0)}`);
  console.log(`  each reversal is a slope discontinuity in the read pointer, not an amplitude step\n`);
}
