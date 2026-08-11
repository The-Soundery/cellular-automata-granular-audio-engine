/**
 * Click probe, part 2 — investigation only, changes nothing.
 *
 * Part 1 found unsmoothed pan follow as the loudest suspect. This measures the
 * actual waveform discontinuity in the rendered signal and attributes each one
 * to the control event that caused it, then exercises the transient paths part 1
 * never touched: resetGrains, the master-gain fade-in, and voice-pool overload.
 *
 * Run: node scripts/probe-clicks2.mjs [--pattern id]
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
const SOURCE_DUR_SEC = 30;
const STEPS = 300;

const ARGV = process.argv.slice(2);
const ONLY = (() => {
  const i = ARGV.indexOf("--pattern");
  return i < 0 ? null : ARGV[i + 1];
})();

const db = (x) => 20 * Math.log10(Math.max(1e-12, x));
const fmt = (x, n = 2) => (Number.isFinite(x) ? x.toFixed(n) : "n/a");

function makeField() {
  return { width: W, height: H, r: new Float32Array(N), g: new Float32Array(N), b: new Float32Array(N) };
}
function quantize(f) {
  for (let i = 0; i < N; i++) {
    f.r[i] = Math.round(f.r[i] * 255) / 255;
    f.g[i] = Math.round(f.g[i] * 255) / 255;
    f.b[i] = Math.round(f.b[i] * 255) / 255;
  }
}
function send(proc, msg) {
  const h = proc.port.onmessage;
  if (typeof h === "function") h({ data: msg });
}
function recordScenario(pattern) {
  const obs = new FieldObserver(W, H);
  const sched = new GrainScheduler();
  sched.setSourceDurationSec(SOURCE_DUR_SEC);
  let prev = makeField(), cur = makeField();
  pattern.fill(prev, 0);
  quantize(prev);
  const steps = [];
  for (let step = 1; step <= STEPS; step++) {
    pattern.fill(cur, step);
    quantize(cur);
    const o = obs.observe(cur, prev);
    const batch = sched.step(o, cur, step * STEP_MS);
    steps.push({
      events: batch.events.map((e) => ({ ...e })),
      tracks: batch.tracks.map((t) => ({ ...t })),
    });
    const t = prev; prev = cur; cur = t;
  }
  return steps;
}

const pcm = makePink(FS * SOURCE_DUR_SEC);
const Processor = await loadWorkletClass(FS);

// ===========================================================================
// A. Attribute rendered discontinuities to control events
// ===========================================================================

function runAttributed(pattern) {
  const steps = recordScenario(pattern);
  const proc = new Processor();
  send(proc, { type: "source", sampleRate: FS, length: pcm.length, pcm });
  proc.masterGain = 1; proc.masterGainTarget = 1;
  proc.normGain = 1; proc.preScale = 1;

  /** Per-step summary of what applyTracks did to already-sounding voices. */
  let pending = null;
  const origApplyTracks = proc.applyTracks.bind(proc);
  proc.applyTracks = (tracks) => {
    const before = [];
    for (const v of proc.voices) {
      if (!v.active || v.regionId < 0) continue;
      before.push({ v, gL: v.gainL, gR: v.gainR, pan: v.pan, y: v.yNorm, sounding: v.sounding });
    }
    origApplyTracks(tracks);
    let worst = 0, worstInfo = null, nFlips = 0, sumStep = 0;
    for (const b of before) {
      if (!b.sounding) continue;
      const dL = Math.abs(b.v.gainL - b.gL);
      const dR = Math.abs(b.v.gainR - b.gR);
      const step = Math.max(dL, dR);
      sumStep += step;
      if (step > 0.2) nFlips++;
      if (step > worst) {
        worst = step;
        worstInfo = {
          regionId: b.v.regionId,
          panBefore: b.pan, panAfter: b.v.pan,
          trackDx: b.v.trackDx,
          amp: b.v.amp,
        };
      }
    }
    pending = { worst, worstInfo, nFlips, sumStep, nVoices: before.length };
  };

  const samples = [];       // mono, concatenated
  const marks = [];         // { sampleIndex, ...pending }
  let blockAcc = 0;

  for (let step = 0; step < steps.length; step++) {
    pending = null;
    send(proc, {
      type: "events",
      masterGain: MASTER_GAIN,
      events: steps[step].events,
      tracks: steps[step].tracks,
    });
    blockAcc += BPS;
    const nBlocks = Math.floor(blockAcc);
    blockAcc -= nBlocks;
    if (pending) marks.push({ sampleIndex: samples.length, step: step + 1, ...pending });
    for (let b = 0; b < nBlocks; b++) {
      const L = new Float32Array(BLOCK), R = new Float32Array(BLOCK);
      proc.process([], [[L, R]]);
      for (let i = 0; i < BLOCK; i++) samples.push(0.5 * (L[i] + R[i]));
    }
  }

  const x = Float32Array.from(samples);
  // Local scale of the first difference, measured over a 4096-sample window
  // that excludes the 256 samples around the event itself.
  function localDiffRms(centre) {
    let e = 0, n = 0;
    for (let i = Math.max(1, centre - 2048); i < Math.min(x.length, centre + 2048); i++) {
      if (Math.abs(i - centre) < 128) continue;
      const d = x[i] - x[i - 1];
      e += d * d; n++;
    }
    return n ? Math.sqrt(e / n) : 0;
  }
  function localRms(centre) {
    let e = 0, n = 0;
    for (let i = Math.max(0, centre - 2048); i < Math.min(x.length, centre + 2048); i++) {
      e += x[i] * x[i]; n++;
    }
    return n ? Math.sqrt(e / n) : 0;
  }

  const scored = [];
  for (const m of marks) {
    const k = m.sampleIndex;
    if (k < 1 || k >= x.length) continue;
    const d = Math.abs(x[k] - x[k - 1]);
    const s = localDiffRms(k);
    scored.push({ ...m, jump: d, diffRms: s, ratio: s > 0 ? d / s : 0, rms: localRms(k) });
  }
  scored.sort((a, b) => b.ratio - a.ratio);
  return { scored, x, marks };
}

console.log("=== A. rendered discontinuity at each track update ===");
console.log("(jump = |x[k]-x[k-1]| at the sample the message lands on;");
console.log(" ratio = jump / local RMS of the first difference — >6 is a click)\n");

const patterns = ONLY ? [ONLY] : ["moving-bar", "glider-swarm", "two-blobs-merge", "bar-left"];
for (const id of patterns) {
  const pattern = TEST_PATTERNS.find((p) => p.id === id);
  if (!pattern) { console.log(`-- ${id}: not found`); continue; }
  const { scored } = runAttributed(pattern);
  const clicks = scored.filter((s) => s.ratio > 6);
  const bigClicks = scored.filter((s) => s.ratio > 12);
  console.log(`--- ${id} ---`);
  console.log(
    `  track updates: ${scored.length} over ${(STEPS / 30).toFixed(1)} s   ` +
    `ratio>6: ${clicks.length}   ratio>12: ${bigClicks.length}   ` +
    `(${(clicks.length / (STEPS / 30)).toFixed(1)} clicks/sec)`,
  );
  for (const s of scored.slice(0, 5)) {
    if (s.ratio < 3) break;
    const wi = s.worstInfo;
    console.log(
      `  step ${String(s.step).padStart(3)}  ratio ${fmt(s.ratio, 1).padStart(6)}  ` +
      `jump ${fmt(s.jump, 4)} (local rms ${fmt(s.rms, 4)})  ` +
      `voices moved ${String(s.nVoices).padStart(3)}, pan-gain steps >0.2: ${String(s.nFlips).padStart(3)}` +
      (wi ? `  worst: region ${wi.regionId} pan ${fmt(wi.panBefore, 3)} -> ${fmt(wi.panAfter, 3)}` : ""),
    );
  }
  console.log("");
}

// ===========================================================================
// B. resetGrains transient
// ===========================================================================
console.log("=== B. resetGrains fade-then-clear ===");
{
  const pattern = TEST_PATTERNS.find((p) => p.id === "chaos-blob-10pct");
  const steps = recordScenario(pattern);
  const proc = new Processor();
  send(proc, { type: "source", sampleRate: FS, length: pcm.length, pcm });
  proc.masterGain = 1; proc.masterGainTarget = 1; proc.normGain = 1; proc.preScale = 1;

  const out = [];
  const render = (n) => {
    for (let b = 0; b < n; b++) {
      const L = new Float32Array(BLOCK), R = new Float32Array(BLOCK);
      proc.process([], [[L, R]]);
      for (let i = 0; i < BLOCK; i++) out.push(0.5 * (L[i] + R[i]));
    }
  };
  for (let step = 0; step < 200; step++) {
    send(proc, { type: "events", masterGain: MASTER_GAIN, events: steps[step].events, tracks: steps[step].tracks });
    render(12);
  }
  const beforeIdx = out.length;
  let preRms = 0;
  for (let i = beforeIdx - 4096; i < beforeIdx; i++) preRms += out[i] * out[i];
  preRms = Math.sqrt(preRms / 4096);

  send(proc, { type: "resetGrains" });
  render(14); // 10 fade blocks + margin

  // Find the hard-clear sample: last non-zero before the run of zeros.
  let clearIdx = -1;
  for (let i = out.length - 1; i > beforeIdx; i--) {
    if (out[i] !== 0) { clearIdx = i; break; }
  }
  const residual = clearIdx >= 0 ? Math.abs(out[clearIdx]) : 0;
  let tailRms = 0, tn = 0;
  for (let i = Math.max(beforeIdx, clearIdx - 256); i <= clearIdx; i++) { tailRms += out[i] * out[i]; tn++; }
  tailRms = tn ? Math.sqrt(tailRms / tn) : 0;

  console.log(`  pre-reset RMS            ${fmt(preRms, 5)}  (${fmt(db(preRms), 1)} dBFS)`);
  console.log(`  RMS in last 256 samples  ${fmt(tailRms, 5)}  (${fmt(db(tailRms), 1)} dBFS)`);
  console.log(`  amplitude at hard clear  ${fmt(residual, 5)}  (${fmt(db(residual), 1)} dBFS, ` +
    `${fmt(db(residual) - db(preRms), 1)} dB below programme)`);
  console.log(`  fade length              ${((14 * BLOCK) / FS * 1000).toFixed(1)} ms window, 10 blocks of decay = ${((10 * BLOCK) / FS * 1000).toFixed(1)} ms\n`);
}

// ===========================================================================
// C. master gain fade-in from enable
// ===========================================================================
console.log("=== C. masterGain fade-in (GAIN_SMOOTH per block, not per sample) ===");
{
  const proc = new Processor();
  send(proc, { type: "source", sampleRate: FS, length: pcm.length, pcm });
  // Fresh processor: masterGain starts at 0, target arrives with first batch.
  const pattern = TEST_PATTERNS.find((p) => p.id === "chaos-blob-10pct");
  const steps = recordScenario(pattern);
  const gains = [];
  let blockAcc = 0;
  for (let step = 0; step < 12; step++) {
    send(proc, { type: "events", masterGain: MASTER_GAIN, events: steps[step].events, tracks: steps[step].tracks });
    blockAcc += BPS;
    const nBlocks = Math.floor(blockAcc); blockAcc -= nBlocks;
    for (let b = 0; b < nBlocks; b++) {
      const L = new Float32Array(BLOCK), R = new Float32Array(BLOCK);
      proc.process([], [[L, R]]);
      gains.push(proc.masterGain);
    }
  }
  let worst = 0, worstAt = 0;
  for (let i = 1; i < gains.length; i++) {
    const d = Math.abs(db(Math.max(1e-9, gains[i]) / Math.max(1e-9, gains[i - 1])));
    if (d > worst && gains[i] > 0.02) { worst = d; worstAt = i; }
  }
  console.log(`  first 8 block gains: ${gains.slice(0, 8).map((g) => fmt(g, 4)).join(", ")}`);
  console.log(`  reaches 0.95 after ${gains.findIndex((g) => g > 0.95)} blocks ` +
    `(${((gains.findIndex((g) => g > 0.95) * BLOCK) / FS * 1000).toFixed(0)} ms)`);
  console.log(`  worst single-boundary gain step above -34 dBFS: ${fmt(worst, 2)} dB at block ${worstAt}\n`);
}

// ===========================================================================
// D. voice-pool overload / stealing
// ===========================================================================
console.log("=== D. voice-pool overload (MAX_GRAINS=128 vs GRAIN_BUDGET=64) ===");
{
  const proc = new Processor();
  send(proc, { type: "source", sampleRate: FS, length: pcm.length, pcm });
  proc.masterGain = 1; proc.masterGainTarget = 1; proc.normGain = 1; proc.preScale = 1;

  const mkEvent = (i) => ({
    x: i % 128, y: (i * 7) % 128, r: 0.5, g: 0.3, b: 0.7,
    durationSec: 2.0, amplitude: 0.125, direction: 1,
    sampleCenter: 0.5, sampleHalf: 0.05, startOffsetSec: 0,
    q: 2, yNorm: 0.5, pan: 0,
    attackFrac: 0.3, releaseFrac: 0.3,
    regime: "chaos", regionId: -1, trackDx: 0, trackDy: 0, readOffset: 0,
  });

  // Fill the pool, let attacks get underway, then force stealing.
  send(proc, { type: "events", masterGain: 1, events: Array.from({ length: 128 }, (_, i) => mkEvent(i)), tracks: [] });
  const out = [];
  const render = (n) => {
    for (let b = 0; b < n; b++) {
      const L = new Float32Array(BLOCK), R = new Float32Array(BLOCK);
      proc.process([], [[L, R]]);
      proc.normGain = 1; proc.preScale = 1;
      for (let i = 0; i < BLOCK; i++) out.push(0.5 * (L[i] + R[i]));
    }
  };
  render(20); // ~53 ms in: grains are ~9% through a 2 s attack of 0.3*2s = 600 ms

  // Snapshot the victim's envelope either side of the forced release.
  let victim = null, oldestAge = -1;
  for (const v of proc.voices) {
    if (v.regime === "chaos" && v.age > oldestAge) { oldestAge = v.age; victim = v; }
  }
  const envBefore = proc.envelopeAt(victim);
  const attackNBefore = victim.attackN;
  send(proc, { type: "events", masterGain: 1, events: [mkEvent(999)], tracks: [] });
  const envAfter = proc.envelopeAt(victim);

  console.log(`  pool full? free voices = ${proc.voices.filter((v) => !v.active).length}`);
  console.log(`  victim age ${victim.age} samples, attackN ${attackNBefore} -> ${victim.attackN}, duration -> ${victim.duration}`);
  console.log(`  envelope at steal: ${fmt(envBefore, 5)} -> ${fmt(envAfter, 5)}  ` +
    `(${fmt(db(Math.max(1e-9, envAfter) / Math.max(1e-9, envBefore)), 1)} dB instantaneous jump)`);
  const beforeIdx = out.length;
  render(4);
  let jump = 0;
  for (let i = beforeIdx; i < Math.min(out.length, beforeIdx + 8); i++) {
    jump = Math.max(jump, Math.abs(out[i] - out[i - 1]));
  }
  let lrms = 0;
  for (let i = beforeIdx - 2048; i < beforeIdx; i++) lrms += out[i] * out[i];
  lrms = Math.sqrt(lrms / 2048);
  console.log(`  rendered jump at steal ${fmt(jump, 5)} vs local RMS ${fmt(lrms, 5)}`);
  console.log(`  NOTE: with GRAIN_BUDGET=64 the scheduler cannot fill 128 voices, so this`);
  console.log(`        path only opens if the pool is filled by another route.\n`);
}

// ===========================================================================
// E. realtime-thread allocation in emitStats
// ===========================================================================
console.log("=== E. audio-thread allocation rate (emitStats) ===");
{
  const statsPerSec = FS / BLOCK / 8;
  console.log(`  emitStats runs every 8 blocks = ${fmt(statsPerSec, 1)} times/sec`);
  console.log(`  each call builds 1 array + up to 128 object literals + 1 structured clone`);
  console.log(`  => up to ${Math.round(statsPerSec * 128).toLocaleString()} objects/sec allocated on the audio thread`);
  console.log(`  applyTracks additionally allocates 1 Map + 1 object per region, per message (~30/sec)\n`);
}
