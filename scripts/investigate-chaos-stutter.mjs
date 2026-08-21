/**
 * Probe: why full-field chaos sounds stuttery / rhythmic instead of loose noise.
 *
 * Run: node scripts/investigate-chaos-stutter.mjs
 *
 * Measures scheduler cohort refill, 30 Hz AM depth, worklet voice peaks,
 * AGC pumping, and a reset-shaped first-frame (δ = 0) then scramble.
 */
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  loadWorkletClass,
  makeWhite,
  mulberry32,
} from "./lib/offline-worklet.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { FieldObserver } = await import(
  pathToFileURL(join(root, "src/field/FieldObserver.ts")).href
);
const { GrainScheduler, SCHED, GRAIN_BUDGET } = await import(
  pathToFileURL(join(root, "src/field/GrainScheduler.ts")).href
);
const { TEST_PATTERNS } = await import(
  pathToFileURL(join(root, "src/field/TestPatterns.ts")).href
);

const W = 128;
const H = 128;
const N = W * H;
const STEP_HZ = 30;
const STEP_SEC = 1 / STEP_HZ;
const STEP_MS = 1000 * STEP_SEC;
const FS = 48000;
const BLOCK = 128;
const BLOCK_HZ = FS / BLOCK;
const BLOCKS_PER_STEP = Math.round(FS / STEP_HZ / BLOCK);
const SOURCE_DUR = 8;
const WARM_STEPS = 24;
const MEASURE_STEPS = 90;
const MAX_GRAINS = 128;

function db(x) {
  return 20 * Math.log10(Math.max(1e-12, x));
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function mean(arr) {
  if (!arr.length) return 0;
  let s = 0;
  for (const v of arr) s += v;
  return s / arr.length;
}

function stdev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  let v = 0;
  for (const x of arr) v += (x - m) ** 2;
  return Math.sqrt(v / (arr.length - 1));
}

function percentile(arr, p) {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  const i = clamp01(p) * (a.length - 1);
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return a[lo];
  return a[lo] + (a[hi] - a[lo]) * (i - lo);
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

function copyField(dst, src) {
  dst.r.set(src.r);
  dst.g.set(src.g);
  dst.b.set(src.b);
}

function fillRandom(field, seed) {
  const rng = mulberry32(seed);
  for (let i = 0; i < N; i++) {
    field.r[i] = rng();
    field.g[i] = rng();
    field.b[i] = rng();
  }
}

function fillMix(field, prev, mix, seed) {
  const rng = mulberry32(seed);
  const keep = 1 - mix;
  for (let i = 0; i < N; i++) {
    field.r[i] = prev.r[i] * keep + rng() * mix;
    field.g[i] = prev.g[i] * keep + rng() * mix;
    field.b[i] = prev.b[i] * keep + rng() * mix;
  }
}

function chaosDurationAtDelta(delta) {
  const stabilityT = 1 - clamp01(delta / SCHED.deltaRateNorm);
  const order = 0.65 * stabilityT;
  return SCHED.DUR_MIN * Math.pow(SCHED.DUR_MAX / SCHED.DUR_MIN, order);
}

function chaosRateScale(delta) {
  return clamp01(delta / SCHED.deltaRateNorm);
}

function makeTestMaterialSegments(n = 64) {
  const segs = [];
  const denom = Math.max(1, n - 1);
  for (let i = 0; i < n; i++) {
    const t = i / denom;
    const band = ((i * 7) % n) / denom;
    segs.push({
      pos: t,
      centroidHz: 120 * Math.pow(50, t),
      stationarity: 0.15 + 0.7 * ((i % 5) / 4),
      energy: 1,
      angle: t,
      radius: 0.85,
      band,
    });
  }
  return segs;
}

function envelopeAt(age, dur, aN, rN) {
  if (age < aN) {
    const t = age / Math.max(1, aN);
    return t * t * (3 - 2 * t);
  }
  if (age > dur - 1 - rN) {
    const t = (dur - 1 - age) / Math.max(1, rN);
    const u = Math.max(0, t);
    return u * u * (3 - 2 * u);
  }
  return 1;
}

function goertzelPower(series, fs, freq) {
  const n = series.length;
  if (n < 8) return 0;
  const k = (freq / fs) * n;
  const w = (2 * Math.PI * k) / n;
  const cw = Math.cos(w);
  const coeff = 2 * cw;
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  const m = mean(series);
  for (let i = 0; i < n; i++) {
    s0 = series[i] - m + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const real = s1 - s2 * cw;
  const imag = s2 * Math.sin(w);
  return (real * real + imag * imag) / (n * n);
}

function foldDepthDb(series, period) {
  if (series.length < period * 2) return { depthDb: 0, fold: [] };
  const fold = new Array(period).fill(0);
  const n = new Array(period).fill(0);
  for (let i = 0; i < series.length; i++) {
    const b = i % period;
    fold[b] += series[i];
    n[b] += 1;
  }
  for (let b = 0; b < period; b++) fold[b] /= Math.max(1, n[b]);
  let mx = -Infinity;
  let mn = Infinity;
  for (const v of fold) {
    if (v > mx) mx = v;
    if (v < mn) mn = v;
  }
  return { depthDb: db(mx) - db(Math.max(1e-12, mn)), fold, max: mx, min: mn };
}

function send(proc, msg) {
  const handler = proc.port.onmessage;
  if (typeof handler === "function") handler({ data: msg });
}

/**
 * @param {{
 *   id: string,
 *   fill: (cur: any, prev: any, step: number) => void,
 *   resetShaped?: boolean,
 * }} spec
 */
function runScheduler(spec) {
  const obs = new FieldObserver(W, H);
  const sched = new GrainScheduler();
  sched.setSourceDurationSec(SOURCE_DUR);
  sched.setMaterialSegments(makeTestMaterialSegments(64));

  let prev = makeField();
  let cur = makeField();
  spec.fill(prev, prev, 0);
  quantize(prev);
  if (spec.resetShaped) copyField(cur, prev);

  const totalSteps = WARM_STEPS + MEASURE_STEPS;
  const grains = [];
  const perStep = [];

  for (let step = 1; step <= totalSteps; step++) {
    if (spec.resetShaped && step === 1) {
      copyField(cur, prev);
    } else {
      spec.fill(cur, prev, step);
    }
    quantize(cur);
    const o = obs.observe(cur, prev);
    const batch = sched.step(o, cur, step * STEP_MS);

    const chaosEv = [];
    for (const e of batch.events) {
      if (e.regime !== "chaos") continue;
      chaosEv.push(e);
      const start = (step - 1) * STEP_SEC + (e.startOffsetSec ?? 0);
      grains.push({
        start,
        end: start + e.durationSec,
        duration: e.durationSec,
        offset: e.startOffsetSec ?? 0,
        attack: e.attackFrac,
        release: e.releaseFrac,
        step,
      });
    }

    perStep.push({
      step,
      chaosPct: o.chaosAreaFraction,
      texturePct: o.textured.area / N,
      calmPct: o.coherent.reduce((s, r) => s + r.area, 0) / N,
      meanDelta: o.chaotic.meanDelta,
      shareChaos: batch.shares.chaos,
      chaosEvents: chaosEv.length,
      chaosActive: batch.chaosActive,
      predictedActive: batch.predictedActive,
      allEvents: batch.events.length,
      durMean: chaosEv.length ? mean(chaosEv.map((e) => e.durationSec)) : 0,
      attMean: chaosEv.length ? mean(chaosEv.map((e) => e.attackFrac)) : 0,
      relMean: chaosEv.length ? mean(chaosEv.map((e) => e.releaseFrac)) : 0,
      offsetMean: chaosEv.length
        ? mean(chaosEv.map((e) => e.startOffsetSec ?? 0))
        : 0,
    });

    const t = prev;
    prev = cur;
    cur = t;
  }

  const measured = perStep.filter((s) => s.step > WARM_STEPS);
  const measureGrains = grains.filter((g) => g.step > WARM_STEPS);
  const t0 = WARM_STEPS * STEP_SEC;
  const t1 = (WARM_STEPS + MEASURE_STEPS) * STEP_SEC;
  const dt = 0.001;
  const nBins = Math.floor((t1 - t0) / dt);
  const concurrent = new Float64Array(nBins);
  const envSum = new Float64Array(nBins);

  for (const g of measureGrains) {
    const durN = Math.max(32, Math.floor(g.duration * FS));
    const aN = Math.max(1, Math.floor(durN * g.attack));
    let rN = Math.max(1, Math.floor(durN * g.release));
    if (aN + rN > durN) rN = Math.max(1, durN - aN);
    const i0 = Math.max(0, Math.floor((g.start - t0) / dt));
    const i1 = Math.min(nBins, Math.ceil((g.end - t0) / dt));
    for (let i = i0; i < i1; i++) {
      concurrent[i] += 1;
      const ageSec = t0 + i * dt - g.start;
      const age = Math.floor(ageSec * FS);
      envSum[i] += envelopeAt(age, durN, aN, rN);
    }
  }

  const concArr = Array.from(concurrent);
  const envArr = Array.from(envSum);
  const foldMs = Math.round(STEP_SEC / dt);
  const concFold = foldDepthDb(concArr, foldMs);
  const envFold = foldDepthDb(envArr, foldMs);
  const ends = measureGrains.map((g) => g.end - t0);
  const endMod = ends.map((t) => ((t % STEP_SEC) + STEP_SEC) % STEP_SEC);
  const startMod = measureGrains.map(
    (g) => ((g.start % STEP_SEC) + STEP_SEC) % STEP_SEC,
  );

  const eventsPerStep = measured.map((s) => s.chaosEvents);
  const zeroEventSteps = eventsPerStep.filter((n) => n === 0).length;

  return {
    id: spec.id,
    steps: perStep,
    measured: {
      chaosPct: mean(measured.map((s) => s.chaosPct)),
      texturePct: mean(measured.map((s) => s.texturePct)),
      calmPct: mean(measured.map((s) => s.calmPct)),
      meanDelta: mean(measured.map((s) => s.meanDelta)),
      shareChaos: mean(measured.map((s) => s.shareChaos)),
      chaosEvPerSec:
        measured.reduce((s, x) => s + x.chaosEvents, 0) / (MEASURE_STEPS * STEP_SEC),
      meanEventsPerStep: mean(eventsPerStep),
      maxEventsPerStep: Math.max(0, ...eventsPerStep),
      minEventsPerStep: Math.min(64, ...eventsPerStep),
      zeroEventFrac: zeroEventSteps / measured.length,
      meanActive: mean(measured.map((s) => s.chaosActive)),
      durMean: mean(measured.map((s) => s.durMean).filter((x) => x > 0)),
      attMean: mean(measured.map((s) => s.attMean).filter((x) => x > 0)),
      relMean: mean(measured.map((s) => s.relMean).filter((x) => x > 0)),
      theoreticalDur: chaosDurationAtDelta(
        mean(measured.map((s) => s.meanDelta)),
      ),
      rateScale: chaosRateScale(mean(measured.map((s) => s.meanDelta))),
    },
    firstSteps: perStep.slice(0, 12).map((s) => ({
      step: s.step,
      chaosPct: +s.chaosPct.toFixed(3),
      texturePct: +s.texturePct.toFixed(3),
      meanDelta: +s.meanDelta.toFixed(3),
      chaosEvents: s.chaosEvents,
      chaosActive: s.chaosActive,
      allEvents: s.allEvents,
      durMean: +s.durMean.toFixed(3),
    })),
    concurrent: {
      mean: mean(concArr),
      min: Math.min(...concArr),
      max: Math.max(...concArr),
      std: stdev(concArr),
      cv: mean(concArr) > 0 ? stdev(concArr) / mean(concArr) : 0,
      foldDepthDb: concFold.depthDb,
      fold: downsample(concFold.fold, 33),
    },
    envelope: {
      mean: mean(envArr),
      foldDepthDb: envFold.depthDb,
      fold: downsample(envFold.fold, 33),
      hz15: goertzelPower(envArr, 1 / dt, 15),
      hz30: goertzelPower(envArr, 1 / dt, 30),
      hz45: goertzelPower(envArr, 1 / dt, 45),
      hz60: goertzelPower(envArr, 1 / dt, 60),
    },
    onsetFold: histogram(startMod, 10, 0, STEP_SEC),
    endFold: histogram(endMod, 10, 0, STEP_SEC),
    grainN: measureGrains.length,
  };
}

function downsample(arr, n) {
  if (!arr.length) return [];
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i * arr.length) / n);
    const b = Math.floor(((i + 1) * arr.length) / n);
    let s = 0;
    let c = 0;
    for (let j = a; j < b; j++) {
      s += arr[j];
      c++;
    }
    out.push(c ? s / c : 0);
  }
  return out;
}

function histogram(values, bins, lo, hi) {
  const counts = new Array(bins).fill(0);
  const span = hi - lo;
  for (const v of values) {
    let b = Math.floor(((v - lo) / span) * bins);
    if (b < 0) b = 0;
    if (b >= bins) b = bins - 1;
    counts[b]++;
  }
  return counts.map((c, i) => ({
    lo: lo + (i * span) / bins,
    hi: lo + ((i + 1) * span) / bins,
    n: c,
    p: values.length ? c / values.length : 0,
  }));
}

function loadSource(proc, pcm) {
  const pcmL = pcm;
  const pcmR = pcmL.slice();
  send(proc, {
    type: "source",
    sampleRate: FS,
    length: pcmL.length,
    pcmL,
    pcmR,
  });
  proc.masterGain = 1;
  proc.masterGainTarget = 1;
  proc.normGain = 1;
  proc.preScale = 1;
}

/**
 * @param {object} spec
 * @param {"raw"|"chain"} mode
 */
async function runAudio(Processor, spec, mode) {
  const obs = new FieldObserver(W, H);
  const sched = new GrainScheduler();
  sched.setSourceDurationSec(SOURCE_DUR);
  sched.setMaterialSegments(makeTestMaterialSegments(64));

  const proc = new Processor();
  loadSource(proc, makeWhite(FS * SOURCE_DUR, 11));

  let drops = 0;
  let steals = 0;
  const origAlloc = proc.allocVoice.bind(proc);
  proc.allocVoice = function patchedAlloc() {
    const beforeChaos = proc.voices.filter(
      (v) => v.active && v.regime === "chaos",
    ).length;
    const v = origAlloc();
    if (!v) {
      drops += 1;
      const afterChaos = proc.voices.filter(
        (v) => v.active && v.regime === "chaos",
      ).length;
      if (afterChaos <= beforeChaos) steals += 1;
    }
    return v;
  };

  let prev = makeField();
  let cur = makeField();
  spec.fill(prev, prev, 0);
  quantize(prev);

  const totalSteps = WARM_STEPS + MEASURE_STEPS;
  const blockRms = [];
  const sounding = [];
  const active = [];
  const peak = [];
  const normGain = [];
  const preScale = [];
  let eventsSent = 0;
  let maxActive = 0;
  let clipBlocks = 0;

  for (let step = 1; step <= totalSteps; step++) {
    if (spec.resetShaped && step === 1) copyField(cur, prev);
    else spec.fill(cur, prev, step);
    quantize(cur);
    const o = obs.observe(cur, prev);
    const batch = sched.step(o, cur, step * STEP_MS);
    eventsSent += batch.events.length;
    send(proc, {
      type: "events",
      masterGain: 1,
      events: batch.events,
      tracks: batch.tracks,
    });

    for (let b = 0; b < BLOCKS_PER_STEP; b++) {
      if (mode === "raw") {
        proc.normGain = 1;
        proc.preScale = 1;
      }
      const L = new Float32Array(BLOCK);
      const R = new Float32Array(BLOCK);
      proc.process([], [[L, R]]);
      let e = 0;
      let pk = 0;
      for (let i = 0; i < BLOCK; i++) {
        const p = L[i] * L[i] + R[i] * R[i];
        e += p;
        const a = Math.hypot(L[i], R[i]);
        if (a > pk) pk = a;
      }
      const rms = Math.sqrt(e / BLOCK);
      if (step > WARM_STEPS) {
        blockRms.push(rms);
        peak.push(pk);
        if (pk >= 0.99) clipBlocks += 1;
        let act = 0;
        let snd = 0;
        for (const voice of proc.voices) {
          if (voice.active) act += 1;
          if (voice.sounding) snd += 1;
        }
        active.push(act);
        sounding.push(snd);
        if (act > maxActive) maxActive = act;
        normGain.push(proc.normGain);
        preScale.push(proc.preScale);
      }
    }

    const t = prev;
    prev = cur;
    cur = t;
  }

  const fold = foldDepthDb(blockRms, BLOCKS_PER_STEP);
  return {
    id: spec.id,
    mode,
    rmsMean: mean(blockRms),
    rmsStdDb: stdev(blockRms.map(db)),
    crestDb: db(Math.max(...peak)) - db(mean(blockRms)),
    peakMax: Math.max(...peak),
    clipBlockFrac: clipBlocks / Math.max(1, blockRms.length),
    foldDepthDb: fold.depthDb,
    fold: fold.fold,
    hz15: goertzelPower(blockRms, BLOCK_HZ, 15),
    hz30: goertzelPower(blockRms, BLOCK_HZ, 30),
    hz45: goertzelPower(blockRms, BLOCK_HZ, 45),
    hz60: goertzelPower(blockRms, BLOCK_HZ, 60),
    soundingMean: mean(sounding),
    soundingMin: Math.min(...sounding),
    soundingMax: Math.max(...sounding),
    activeMean: mean(active),
    activeMax: maxActive,
    eventsSent,
    drops,
    steals,
    dropFrac: eventsSent ? drops / eventsSent : 0,
    normGainMean: mean(normGain),
    normGainMin: Math.min(...normGain),
    normGainMax: Math.max(...normGain),
    preScaleMean: mean(preScale),
    preScaleMin: Math.min(...preScale),
    preScaleMax: Math.max(...preScale),
    blockRms: downsample(blockRms, 60),
  };
}

const fullFlicker = TEST_PATTERNS.find((p) => p.id === "full-flicker");
const chaosBlob = TEST_PATTERNS.find((p) => p.id === "chaos-blob-2pct");
const frozen = TEST_PATTERNS.find((p) => p.id === "frozen-noise");

const specs = [
  {
    id: "full-flicker",
    fill(cur, _prev, step) {
      fullFlicker.fill(cur, step);
    },
  },
  {
    id: "live-chaos-mix",
    fill(cur, prev, step) {
      // Mix chosen so δ̄ lands near the live Utomata band (~0.26–0.30).
      fillMix(cur, prev, 0.18, 90000 + step);
    },
  },
  {
    id: "reset-then-flicker",
    resetShaped: true,
    fill(cur, _prev, step) {
      fullFlicker.fill(cur, step);
    },
  },
  {
    id: "chaos-blob-2pct",
    fill(cur, _prev, step) {
      chaosBlob.fill(cur, step);
    },
  },
  {
    id: "frozen-noise",
    fill(cur, _prev, step) {
      frozen.fill(cur, step);
    },
  },
];

console.log("=== Chaos duration law (areaT=0) ===");
const durTable = [];
for (const d of [0.05, 0.12, 0.2, 0.26, 0.28, 0.3, 0.35, 0.5, 0.7]) {
  const dur = chaosDurationAtDelta(d);
  const t = chaosRateScale(d);
  const gens = dur / STEP_SEC;
  durTable.push({
    delta: d,
    t: +t.toFixed(3),
    durMs: +(dur * 1000).toFixed(1),
    generations: +gens.toFixed(2),
    refillHz: +(1 / dur).toFixed(2),
  });
  console.log(
    `  δ=${d.toFixed(2)}  t=${t.toFixed(2)}  dur=${(dur * 1000).toFixed(1)}ms  ≈${gens.toFixed(2)} CA steps  cohort≈${(1 / dur).toFixed(1)} Hz`,
  );
}

console.log("\n=== Scheduler probes ===");
const schedResults = [];
for (const spec of specs) {
  const r = runScheduler(spec);
  schedResults.push(r);
  const m = r.measured;
  console.log(`\n[${r.id}]`);
  console.log(
    `  chaos%=${(m.chaosPct * 100).toFixed(1)}  static%=${(m.texturePct * 100).toFixed(1)}  δ̄=${m.meanDelta.toFixed(3)}  t=${m.rateScale.toFixed(2)}`,
  );
  console.log(
    `  share=${m.shareChaos.toFixed(1)}  ev/s=${m.chaosEvPerSec.toFixed(0)}  ev/step mean=${m.meanEventsPerStep.toFixed(1)} min=${m.minEventsPerStep} max=${m.maxEventsPerStep}  silentSteps=${(m.zeroEventFrac * 100).toFixed(0)}%`,
  );
  console.log(
    `  dur=${(m.durMean * 1000).toFixed(1)}ms (law ${(m.theoreticalDur * 1000).toFixed(1)}ms)  att=${m.attMean.toFixed(3)}  rel=${m.relMean.toFixed(3)}  active=${m.meanActive.toFixed(1)}`,
  );
  console.log(
    `  concurrent mean=${r.concurrent.mean.toFixed(1)} min=${r.concurrent.min.toFixed(0)} max=${r.concurrent.max.toFixed(0)}  30Hz fold ${r.concurrent.foldDepthDb.toFixed(2)} dB  CV=${r.concurrent.cv.toFixed(3)}`,
  );
  console.log(
    `  envelope 30Hz fold ${r.envelope.foldDepthDb.toFixed(2)} dB  Goertzel 15/30/60 = ${r.envelope.hz15.toExponential(2)} / ${r.envelope.hz30.toExponential(2)} / ${r.envelope.hz60.toExponential(2)}`,
  );
  console.log("  first 8 steps:", JSON.stringify(r.firstSteps.slice(0, 8)));
}

console.log("\n=== Audio probes (white source) ===");
const Processor = await loadWorkletClass(FS);
const audioResults = [];
for (const spec of specs.filter((s) => s.id !== "frozen-noise")) {
  for (const mode of ["raw", "chain"]) {
    const r = await runAudio(Processor, spec, mode);
    audioResults.push(r);
    console.log(`\n[${r.id} / ${r.mode}]`);
    console.log(
      `  RMS=${r.rmsMean.toExponential(3)}  blockStd=${r.rmsStdDb.toFixed(2)} dB  crest=${r.crestDb.toFixed(1)} dB  peak=${r.peakMax.toFixed(3)}  clipBlocks=${(r.clipBlockFrac * 100).toFixed(1)}%`,
    );
    console.log(
      `  30Hz fold ${r.foldDepthDb.toFixed(2)} dB  Goertzel 15/30/60 = ${r.hz15.toExponential(2)} / ${r.hz30.toExponential(2)} / ${r.hz60.toExponential(2)}`,
    );
    console.log(
      `  sounding ${r.soundingMin}–${r.soundingMax} (mean ${r.soundingMean.toFixed(1)})  worklet active max ${r.activeMax}/${MAX_GRAINS}  drops=${r.drops} steals=${r.steals} (${(r.dropFrac * 100).toFixed(2)}%)`,
    );
    console.log(
      `  AGC normGain ${r.normGainMin.toFixed(3)}–${r.normGainMax.toFixed(3)}  preScale ${r.preScaleMin.toFixed(3)}–${r.preScaleMax.toFixed(3)}`,
    );
  }
}

const outPath = join(root, "scripts/.chaos-stutter-report.json");
const report = {
  generatedAt: new Date().toISOString(),
  constants: {
    GRAIN_BUDGET,
    MAX_GRAINS,
    CHAOS_EVENTS_MAX_HZ: SCHED.CHAOS_EVENTS_MAX_HZ,
    DUR_MIN: SCHED.DUR_MIN,
    REL_CHAOS: SCHED.REL_CHAOS,
    ATT_MIN: SCHED.ATT_MIN,
    stepsPerSec: SCHED.stepsPerSec,
    deltaRateNorm: SCHED.deltaRateNorm,
    BLOCKS_PER_STEP,
    STEP_SEC,
  },
  durationLaw: durTable,
  scheduler: schedResults.map((r) => ({
    id: r.id,
    measured: r.measured,
    firstSteps: r.firstSteps,
    concurrent: r.concurrent,
    envelope: {
      mean: r.envelope.mean,
      foldDepthDb: r.envelope.foldDepthDb,
      fold: r.envelope.fold,
      hz15: r.envelope.hz15,
      hz30: r.envelope.hz30,
      hz45: r.envelope.hz45,
      hz60: r.envelope.hz60,
    },
    onsetFold: r.onsetFold,
    endFold: r.endFold,
  })),
  audio: audioResults,
};

const { writeFileSync } = await import("node:fs");
writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(`\nWrote ${outPath}`);
