/**
 * Click / discontinuity probe — investigation only, changes nothing.
 *
 * Drives FieldObserver → GrainScheduler → the real public/grain-processor.js
 * offline and measures every mechanism that can produce a sample-to-sample
 * amplitude step:
 *
 *   1. Block-rate gain staircase (masterGain × preScale × normGain).
 *   2. Per-voice pan / bandpass-gain jumps applied by applyTracks (no smoothing).
 *   3. Envelope jumps caused by voice stealing in allocVoice.
 *   4. Grain envelope endpoints (should be exactly 0 at both ends).
 *   5. Region anchor teleports in the scheduler's track stream.
 *
 * Run: node scripts/probe-clicks.mjs [--pattern id] [--source white|pink]
 */
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadWorkletClass, makeWhite, makePink } from "./lib/offline-worklet.mjs";

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

const W = 128;
const H = 128;
const N = W * H;
const FS = 48000;
const BLOCK = 128;
const STEP_MS = 1000 / 30;
const BLOCKS_PER_STEP_EXACT = FS / 30 / BLOCK; // 12.5
const SOURCE_DUR_SEC = 30;
const SOURCE_LEN = FS * SOURCE_DUR_SEC;
const STEPS = 300;
const MEASURE_FROM = 120;

const ARGV = process.argv.slice(2);
function arg(name, fallback) {
  const i = ARGV.indexOf(name);
  return i < 0 ? fallback : (ARGV[i + 1] ?? fallback);
}
const SOURCE = arg("--source", "pink");
const ONLY = arg("--pattern", null);

const SCENARIOS = ONLY
  ? [ONLY]
  : [
      "chaos-blob-10pct",
      "full-flicker",
      "glider-swarm",
      "moving-bar",
      "two-blobs-merge",
      "osc-field",
      "breathing-uniform",
    ];

function db(x) {
  return 20 * Math.log10(Math.max(1e-12, x));
}
function fmt(x, n = 2) {
  return Number.isFinite(x) ? x.toFixed(n) : "n/a";
}
function pct(sorted, p) {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)));
  return sorted[i];
}
function makeField() {
  return {
    width: W,
    height: H,
    r: new Float32Array(N),
    g: new Float32Array(N),
    b: new Float32Array(N),
  };
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

/** Replicates the worklet's Y→cutoff→bpGain law so we can predict jumps. */
const FILT_FMIN = 80;
const FILT_FMAX = 12000;
const Q_REF = 2.0;
const FC_REF = Math.sqrt(FILT_FMIN * FILT_FMAX);
function bpGainFor(yNorm, q) {
  const y = Math.max(0, Math.min(1, yNorm));
  const qq = Math.max(0.5, q);
  let fc = FILT_FMIN * Math.pow(FILT_FMAX / FILT_FMIN, y);
  const fcMax = 0.45 * FS;
  if (fc > fcMax) fc = fcMax;
  return (Math.sqrt(qq / Q_REF) / qq) * Math.sqrt(FC_REF / fc);
}
function equalPower(pan) {
  const p = Math.max(-1, Math.min(1, pan));
  const a = ((p + 1) * 0.5 * Math.PI) / 2;
  return { gainL: Math.cos(a), gainR: Math.sin(a) };
}

/** Run observer→scheduler once so every variant replays an identical stream. */
function recordScenario(pattern) {
  const obs = new FieldObserver(W, H);
  const sched = new GrainScheduler();
  sched.setSourceDurationSec(SOURCE_DUR_SEC);
  let prev = makeField();
  let cur = makeField();
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
    const t = prev;
    prev = cur;
    cur = t;
  }
  return steps;
}

/**
 * Replay a recorded stream into a fresh processor.
 * @param opts.gainMode "chain" (untouched) | "unity" (all three gains pinned to 1)
 * @param opts.sendTracks whether to deliver the per-step region tracks
 */
function replay(Processor, pcm, steps, opts) {
  const { gainMode = "chain", sendTracks = true } = opts;
  const proc = new Processor();
  send(proc, { type: "source", sampleRate: FS, length: pcm.length, pcm });
  proc.masterGain = 1;
  proc.masterGainTarget = 1;
  proc.normGain = 1;
  proc.preScale = 1;

  // --- instrumentation -----------------------------------------------------
  const trackJumpsDb = [];   // per-voice |Δ(pan gain × bpGain)| in dB
  const panJumpsDb = [];     // pan component only
  const specJumpsDb = [];    // bandpass-gain component only
  const stealEnvJumps = [];  // envelope ratio at forced-release steal
  let steals = 0;
  let droppedEvents = 0;
  let minAttackSamples = Infinity;
  let maxEnvStart = 0;
  let maxEnvEnd = 0;

  const origApplyTracks = proc.applyTracks.bind(proc);
  proc.applyTracks = (tracks) => {
    const before = [];
    for (const v of proc.voices) {
      if (!v.active || v.regionId < 0) continue;
      before.push([v, v.gainL, v.gainR, bpGainFor(v.yNorm, v.q)]);
    }
    origApplyTracks(tracks);
    for (const [v, gL, gR, bp] of before) {
      const bp2 = bpGainFor(v.yNorm, v.q);
      const panL = db(Math.max(1e-6, v.gainL) / Math.max(1e-6, gL));
      const panR = db(Math.max(1e-6, v.gainR) / Math.max(1e-6, gR));
      const spec = db(bp2 / bp);
      const worstPan = Math.abs(panL) > Math.abs(panR) ? panL : panR;
      panJumpsDb.push(Math.abs(worstPan));
      specJumpsDb.push(Math.abs(spec));
      trackJumpsDb.push(Math.abs(worstPan + spec));
    }
  };

  const origAlloc = proc.allocVoice.bind(proc);
  proc.allocVoice = () => {
    const anyFree = proc.voices.some((v) => !v.active);
    if (anyFree) return origAlloc();
    // Full pool: capture the victim's envelope either side of the steal.
    let victim = null;
    let oldestAge = -1;
    for (const v of proc.voices) {
      if (v.regime === "chaos" && v.age > oldestAge) {
        oldestAge = v.age;
        victim = v;
      }
    }
    const envBefore = victim ? proc.envelopeAt(victim) : null;
    const got = origAlloc();
    if (!got) {
      droppedEvents++;
      if (victim && envBefore !== null) {
        steals++;
        const envAfter = proc.envelopeAt(victim);
        stealEnvJumps.push(db(Math.max(1e-6, envAfter) / Math.max(1e-6, envBefore)));
      }
    }
    return got;
  };

  const origSpawn = proc.spawnEvents.bind(proc);
  proc.spawnEvents = (list) => {
    const before = proc.voices.map((v) => v.active);
    origSpawn(list);
    for (let i = 0; i < proc.voices.length; i++) {
      const v = proc.voices[i];
      if (before[i] || !v.active) continue;
      if (v.attackN < minAttackSamples) minAttackSamples = v.attackN;
      const savedAge = v.age;
      v.age = 0;
      maxEnvStart = Math.max(maxEnvStart, proc.envelopeAt(v));
      v.age = v.duration - 1;
      maxEnvEnd = Math.max(maxEnvEnd, proc.envelopeAt(v));
      v.age = savedAge;
    }
  };

  // --- render --------------------------------------------------------------
  const gains = [];       // per-block masterGain × preScale × normGain
  const chunks = [];      // per-block mono mix (post softClip)
  let blockAcc = 0;

  for (let step = 0; step < steps.length; step++) {
    const batch = steps[step];
    send(proc, {
      type: "events",
      masterGain: MASTER_GAIN,
      events: batch.events,
      tracks: sendTracks ? batch.tracks : [],
    });
    blockAcc += BLOCKS_PER_STEP_EXACT;
    const nBlocks = Math.floor(blockAcc);
    blockAcc -= nBlocks;

    for (let b = 0; b < nBlocks; b++) {
      if (gainMode === "unity") {
        proc.masterGain = 1;
        proc.masterGainTarget = 1;
        proc.normGain = 1;
        proc.preScale = 1;
      }
      const L = new Float32Array(BLOCK);
      const R = new Float32Array(BLOCK);
      proc.process([], [[L, R]]);
      if (gainMode === "unity") {
        proc.normGain = 1;
        proc.preScale = 1;
      }
      if (step >= MEASURE_FROM) {
        const mono = new Float32Array(BLOCK);
        for (let i = 0; i < BLOCK; i++) mono[i] = 0.5 * (L[i] + R[i]);
        chunks.push(mono);
        gains.push(proc.masterGain * proc.preScale * proc.normGain);
      }
    }
  }

  const samples = new Float32Array(chunks.length * BLOCK);
  chunks.forEach((c, i) => samples.set(c, i * BLOCK));

  return {
    samples,
    gains,
    trackJumpsDb,
    panJumpsDb,
    specJumpsDb,
    stealEnvJumps,
    steals,
    droppedEvents,
    minAttackSamples,
    maxEnvStart,
    maxEnvEnd,
  };
}

/**
 * Given the gain-free grain bed M and the per-block gain staircase G,
 * quantify what the staircase adds versus a sample-accurate ramp of the
 * same gain trajectory (i.e. the artifact a per-sample ramp would remove).
 */
function staircaseResidual(bed, gains) {
  const n = Math.min(bed.length, gains.length * BLOCK);
  let residEnergy = 0;
  let outEnergy = 0;
  let worstStep = 0;
  let worstStepDb = 0;
  const stepDbs = [];

  for (let b = 0; b < gains.length; b++) {
    const g = gains[b];
    const gPrev = b > 0 ? gains[b - 1] : g;
    const gNext = b + 1 < gains.length ? gains[b + 1] : g;
    if (b > 0) {
      const d = Math.abs(db(g / gPrev));
      stepDbs.push(d);
      if (d > worstStepDb) worstStepDb = d;
    }
    for (let i = 0; i < BLOCK; i++) {
      const idx = b * BLOCK + i;
      if (idx >= n) break;
      // Sample-accurate reference: ramp from the midpoint of the previous
      // block's gain to the midpoint of the next, i.e. what a de-zippered
      // implementation of the same control signal would apply.
      const t = (i + 0.5) / BLOCK;
      const gLin =
        t < 0.5
          ? gPrev + (g - gPrev) * (t + 0.5)
          : g + (gNext - g) * (t - 0.5);
      const a = bed[idx] * g;
      const r = a - bed[idx] * gLin;
      residEnergy += r * r;
      outEnergy += a * a;
      const stepAbs = Math.abs(bed[idx]) * Math.abs(g - gPrev);
      if (i === 0 && stepAbs > worstStep) worstStep = stepAbs;
    }
  }
  stepDbs.sort((a, b) => a - b);
  return {
    residDb: db(Math.sqrt(residEnergy / Math.max(1, n))) -
      db(Math.sqrt(outEnergy / Math.max(1, n))),
    worstStepDb,
    p99StepDb: pct(stepDbs, 0.99),
    medStepDb: pct(stepDbs, 0.5),
    stepsOver0p5dB: stepDbs.filter((d) => d > 0.5).length,
    stepsOver1dB: stepDbs.filter((d) => d > 1).length,
    nBoundaries: stepDbs.length,
    worstAbsStep: worstStep,
  };
}

/** Scheduler-side: how far does a region's follow anchor teleport per step? */
function anchorTeleports(steps) {
  const last = new Map();
  const jumps = [];
  let born = 0;
  for (let s = 0; s < steps.length; s++) {
    for (const t of steps[s].tracks) {
      const prev = last.get(t.regionId);
      if (prev) {
        const dx = Math.abs(t.anchorX - prev.anchorX);
        const dy = Math.abs(t.anchorY - prev.anchorY);
        jumps.push(Math.max(dx, dy));
      } else {
        born++;
      }
      last.set(t.regionId, { anchorX: t.anchorX, anchorY: t.anchorY });
    }
  }
  jumps.sort((a, b) => a - b);
  return {
    n: jumps.length,
    born,
    max: jumps.length ? jumps[jumps.length - 1] : 0,
    p99: pct(jumps, 0.99),
    over8cells: jumps.filter((j) => j > 8).length,
  };
}

// ---------------------------------------------------------------------------

const pcm = SOURCE === "white" ? makeWhite(SOURCE_LEN) : makePink(SOURCE_LEN);
const Processor = await loadWorkletClass(FS);

console.log(
  `probe-clicks — source=${SOURCE} steps=${STEPS} measureFrom=${MEASURE_FROM} fs=${FS} block=${BLOCK}`,
);
console.log(
  `block boundary rate = ${(FS / BLOCK).toFixed(1)} Hz (any per-block gain step lands here)\n`,
);

for (const id of SCENARIOS) {
  const pattern = TEST_PATTERNS.find((p) => p.id === id);
  if (!pattern) {
    console.log(`-- ${id}: NOT FOUND, skipping`);
    continue;
  }
  const steps = recordScenario(pattern);
  const chain = replay(Processor, pcm, steps, { gainMode: "chain" });
  const bed = replay(Processor, pcm, steps, { gainMode: "unity" });
  const noTracks = replay(Processor, pcm, steps, {
    gainMode: "chain",
    sendTracks: false,
  });
  const stair = staircaseResidual(bed.samples, chain.gains);
  const anchors = anchorTeleports(steps);

  const panSorted = [...chain.panJumpsDb].sort((a, b) => a - b);
  const specSorted = [...chain.specJumpsDb].sort((a, b) => a - b);
  const bothSorted = [...chain.trackJumpsDb].sort((a, b) => a - b);

  // Difference between "tracks delivered" and "tracks withheld" isolates the
  // audible contribution of the unsmoothed pan / spectrum follow.
  let diffEnergy = 0;
  let refEnergy = 0;
  const nd = Math.min(chain.samples.length, noTracks.samples.length);
  for (let i = 0; i < nd; i++) {
    const d = chain.samples[i] - noTracks.samples[i];
    diffEnergy += d * d;
    refEnergy += chain.samples[i] * chain.samples[i];
  }

  console.log(`=== ${id} ===`);
  console.log(
    `  [1] block-gain staircase: median step ${fmt(stair.medStepDb, 3)} dB, ` +
      `p99 ${fmt(stair.p99StepDb, 3)} dB, worst ${fmt(stair.worstStepDb, 3)} dB`,
  );
  console.log(
    `      boundaries >0.5 dB: ${stair.stepsOver0p5dB}/${stair.nBoundaries}` +
      `   >1.0 dB: ${stair.stepsOver1dB}/${stair.nBoundaries}`,
  );
  console.log(
    `      zipper residual vs sample-accurate ramp: ${fmt(stair.residDb, 1)} dB` +
      `   worst instantaneous step ${fmt(stair.worstAbsStep, 4)} (abs)`,
  );
  console.log(
    `  [2] applyTracks jumps over ${chain.trackJumpsDb.length} voice-updates: ` +
      `pan p99 ${fmt(pct(panSorted, 0.99), 2)} dB / max ${fmt(pct(panSorted, 1), 2)} dB; ` +
      `spectrum p99 ${fmt(pct(specSorted, 0.99), 2)} dB / max ${fmt(pct(specSorted, 1), 2)} dB`,
  );
  console.log(
    `      combined max ${fmt(pct(bothSorted, 1), 2)} dB; ` +
      `updates >1 dB: ${bothSorted.filter((d) => d > 1).length}, ` +
      `>3 dB: ${bothSorted.filter((d) => d > 3).length}, ` +
      `>6 dB: ${bothSorted.filter((d) => d > 6).length}`,
  );
  console.log(
    `      tracks-on vs tracks-off signal difference: ${fmt(db(Math.sqrt(diffEnergy / Math.max(1, nd))) - db(Math.sqrt(refEnergy / Math.max(1, nd))), 1)} dB`,
  );
  console.log(
    `  [3] voice steals: ${chain.steals}, dropped events: ${chain.droppedEvents}` +
      (chain.stealEnvJumps.length
        ? `, envelope jump at steal max ${fmt(Math.max(...chain.stealEnvJumps), 1)} dB`
        : ""),
  );
  console.log(
    `  [4] envelope endpoints: max env(0) = ${fmt(chain.maxEnvStart, 6)}, ` +
      `max env(dur-1) = ${fmt(chain.maxEnvEnd, 6)}; ` +
      `shortest attack ${chain.minAttackSamples === Infinity ? "n/a" : `${chain.minAttackSamples} samples (${fmt((chain.minAttackSamples / FS) * 1000, 2)} ms)`}`,
  );
  console.log(
    `  [5] region anchor teleports: ${anchors.n} updates, max ${fmt(anchors.max, 1)} cells, ` +
      `p99 ${fmt(anchors.p99, 1)} cells, >8 cells: ${anchors.over8cells}; new region ids: ${anchors.born}`,
  );
  console.log("");
}
