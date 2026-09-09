/**
 * Offline audio renderer — drives FieldObserver → GrainScheduler → real
 * grain-processor.js and measures what the engine sounds like.
 *
 * Run: node scripts/render-scenarios.mjs [--stage N] [--source white|pink|both]
 * Stage 0 = print only; stage N enforces all assertions tagged ≤ N.
 *
 * Modes:
 *   raw   — normGain=1, preScale=1 every block (all balance assertions)
 *   chain — untouched AGC path (reported for information)
 */
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  loadWorkletClass,
  makeWhite,
  makePink,
} from "./lib/offline-worklet.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { FieldObserver } = await import(
  pathToFileURL(join(root, "src/field/FieldObserver.ts")).href
);
const { GrainScheduler, MASTER_GAIN, SCHED } = await import(
  pathToFileURL(join(root, "src/field/GrainScheduler.ts")).href
);
const { TEST_PATTERNS } = await import(
  pathToFileURL(join(root, "src/field/TestPatterns.ts")).href
);
const { FrameObserver } = await import(
  pathToFileURL(join(root, "src/field/FrameObserver.ts")).href
);

const W = 128;
const H = 128;
const N = W * H;
const STEPS_DEFAULT = 420;
const MEASURE_FROM_DEFAULT = 210;
const STEPS_BREATHING = 600;
const MEASURE_FROM_BREATHING = 210;
const STEP_MS = 1000 / 30;
const FS = 48000;
const BLOCK = 128;
const BLOCKS_PER_STEP = Math.round(FS / 30 / BLOCK);
const SOURCE_DUR_SEC = 30;
const SOURCE_LEN = FS * SOURCE_DUR_SEC;

function parseArg(argv, name, fallback) {
  const i = argv.indexOf(name);
  if (i < 0) return fallback;
  return argv[i + 1] ?? fallback;
}

function parseStage(argv) {
  const v = Number(parseArg(argv, "--stage", "0"));
  return Number.isFinite(v) ? v : 0;
}

const ARGV = process.argv.slice(2);
const STAGE = parseStage(ARGV);
const SOURCE_ARG = parseArg(ARGV, "--source", "white");
const COLD_START = ARGV.includes("--cold-start");

const failures = [];

function assert(stage, scenario, name, pass, expected, got) {
  if (STAGE < stage) return;
  if (pass) return;
  failures.push({ stage, scenario, name, expected, got });
  console.log(
    `ASSERT FAIL ${scenario} ${name}: expected ${expected} got ${got}`,
  );
}

function assertLe(stage, scenario, name, value, max) {
  assert(stage, scenario, name, value <= max, `≤ ${max}`, fmtNum(value));
}

function assertGe(stage, scenario, name, value, min) {
  assert(stage, scenario, name, value >= min, `≥ ${min}`, fmtNum(value));
}

function assertIn(stage, scenario, name, value, lo, hi) {
  assert(
    stage,
    scenario,
    name,
    value >= lo && value <= hi,
    `[${lo}, ${hi}]`,
    fmtNum(value),
  );
}

function fmtNum(v) {
  return typeof v === "number" && Number.isFinite(v) ? v.toFixed(4) : String(v);
}

function db(x) {
  return 20 * Math.log10(Math.max(1e-12, x));
}

function dbSpread(values) {
  const dbs = values.map(db);
  return Math.max(...dbs) - Math.min(...dbs);
}

/** Polar segments spanning the file so HSV axes move sampleCenter in tests. */
function makeTestMaterialSegments(n = 64) {
  const segs = [];
  const denom = Math.max(1, n - 1);
  const half = 0.5 / denom;
  for (let i = 0; i < n; i++) {
    const t = i / denom;
    // Band decorrelated from angle so hue-drift is not pinned by value.
    const band = ((i * 7) % n) / denom;
    const stationarity = 0.15 + 0.7 * ((i % 5) / 4);
    segs.push({
      pos: t,
      startPos: Math.max(0, t - half),
      endPos: Math.min(1, t + half),
      centroidHz: 120 * Math.pow(50, t),
      stationarity,
      energy: 1,
      angle: t,
      radius: 0.85,
      band,
    });
  }
  return segs;
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
  const handler = proc.port.onmessage;
  if (typeof handler === "function") handler({ data: msg });
}

function loadSource(proc, pcm) {
  // Mono test sources → duplicate into L/R (V5 stereo bank).
  const pcmL = pcm instanceof Float32Array ? pcm : new Float32Array(pcm);
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

function renderBlock(proc, mode) {
  if (mode === "raw") {
    proc.normGain = 1;
    proc.preScale = 1;
  }
  const L = new Float32Array(BLOCK);
  const R = new Float32Array(BLOCK);
  proc.process([], [[L, R]]);
  // Primary loudness: total power (equal-power pan invariant). Mono fold-down
  // is kept as a secondary mono-compatibility figure only — 0.5*(L+R) reads
  // centre-panned grains ~3 dB hot vs hard-panned ones with identical energy.
  let peak = 0;
  let energy = 0;
  let monoEnergy = 0;
  let monoPeak = 0;
  const mono = new Float32Array(BLOCK);
  const framePower = new Float32Array(BLOCK);
  for (let i = 0; i < BLOCK; i++) {
    const l = L[i];
    const r = R[i];
    const p = l * l + r * r;
    framePower[i] = p;
    energy += p;
    const m = 0.5 * (l + r);
    mono[i] = m;
    monoEnergy += m * m;
    const a = Math.hypot(l, r);
    if (a > peak) peak = a;
    const am = Math.abs(m);
    if (am > monoPeak) monoPeak = am;
  }
  let sounding = 0;
  for (const v of proc.voices) if (v.sounding) sounding++;
  return { mono, framePower, peak, monoPeak, energy, monoEnergy, sounding };
}

function renderBlocks(proc, nBlocks, mode) {
  const out = new Float32Array(nBlocks * BLOCK);
  const powerOut = new Float32Array(nBlocks * BLOCK);
  let peak = 0;
  let monoPeak = 0;
  let energy = 0;
  let monoEnergy = 0;
  let sumSounding = 0;
  for (let b = 0; b < nBlocks; b++) {
    const r = renderBlock(proc, mode);
    out.set(r.mono, b * BLOCK);
    powerOut.set(r.framePower, b * BLOCK);
    if (r.peak > peak) peak = r.peak;
    if (r.monoPeak > monoPeak) monoPeak = r.monoPeak;
    energy += r.energy;
    monoEnergy += r.monoEnergy;
    sumSounding += r.sounding;
  }
  return {
    samples: out,
    framePower: powerOut,
    peak,
    monoPeak,
    energy,
    monoEnergy,
    meanConcurrency: sumSounding / Math.max(1, nBlocks),
  };
}

function poolFilter(regime) {
  if (regime === "all") return () => true;
  if (regime === "chaos") {
    return (e) =>
      e.regime !== "calm" &&
      e.regime !== "texture" &&
      e.regime !== "osc" &&
      e.regime !== "flow";
  }
  return (e) => e.regime === regime;
}

function stepCounts(pattern) {
  if (pattern.id === "breathing-uniform") {
    return { STEPS: STEPS_BREATHING, MEASURE_FROM: MEASURE_FROM_BREATHING };
  }
  return { STEPS: STEPS_DEFAULT, MEASURE_FROM: MEASURE_FROM_DEFAULT };
}

/**
 * Run observer→scheduler once; record every step's batch for pool replay.
 */
function recordScenario(pattern) {
  const { STEPS, MEASURE_FROM } = stepCounts(pattern);
  const obs = new FieldObserver(W, H);
  const sched = new GrainScheduler();
  sched.setSourceDurationSec(SOURCE_DUR_SEC);
  sched.setMaterialSegments(makeTestMaterialSegments(64));

  let prev = makeField();
  let cur = makeField();
  pattern.fill(prev, 0);
  quantize(prev);

  /** @type {Array<{events:any[], tracks:any[], shares:any, calmActive:number, chaosActive:number, textureActive:number, predictedActive:number, coherent:any[], textured:any}>} */
  const steps = [];

  for (let step = 1; step <= STEPS; step++) {
    pattern.fill(cur, step);
    quantize(cur);
    const o = obs.observe(cur, prev);
    const batch = sched.step(o, cur, step * STEP_MS);
    steps.push({
      events: batch.events,
      tracks: batch.tracks,
      shares: { ...batch.shares },
      calmActive: batch.calmActive,
      chaosActive: batch.chaosActive,
      textureActive: batch.textureActive,
      predictedActive: batch.predictedActive,
      coherent: o.coherent.map((r) => ({
        id: r.id,
        area: r.area,
      })),
      texturedArea: o.textured?.area ?? 0,
    });
    const t = prev;
    prev = cur;
    cur = t;
  }
  return { STEPS, MEASURE_FROM, steps };
}

/**
 * Replay a recorded scenario into the worklet, optionally filtering by pool.
 */
function replayScenario(Processor, pcm, mode, recorded, pool) {
  const { STEPS, MEASURE_FROM, steps } = recorded;
  const keep = poolFilter(pool);
  const proc = new Processor();
  loadSource(proc, pcm);
  proc._measureMode = mode;

  const measureChunks = [];
  const measurePowerChunks = [];
  let measurePeak = 0;
  let measureEnergy = 0;
  let measureMonoEnergy = 0;
  let measureSamples = 0;
  let sumConcurrency = 0;
  let concurrencyBlocks = 0;
  let sumShare = { calm: 0, texture: 0, chaos: 0, osc: 0 };
  let shareSteps = 0;
  let sumQ = 0;
  let sumDur = 0;
  let qCount = 0;
  let sumPan = 0;
  let panMin = Infinity;
  let panMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  const sitesAll = new Set();
  /** @type {Map<number, Set<string>>} */
  const sitesByPool = new Map();
  /** @type {Map<number, number>} */
  const areaByPool = new Map();
  // Dispersion of the pool that is largest *in that step*. Region ids churn
  // when membership changes (moving-bar's background is re-identified as the
  // bar sweeps), so a whole-window "largest id" would sample only the steps
  // one id happened to survive.
  let domPanMin = Infinity;
  let domPanMax = -Infinity;
  let domYMin = Infinity;
  let domYMax = -Infinity;
  let eventsMeasured = 0;
  let calmActiveSum = 0;
  let chaosActiveSum = 0;
  let textureActiveSum = 0;
  /** Dominant-pool per-slot pan/yNorm series (temporal stability). */
  /** @type {Map<number, {pans:number[], ys:number[]}>} */
  const slotSeries = new Map();
  /** Per-step total-power RMS (linear) over the measure window — pulse mod. */
  const stepRms = [];

  for (let step = 0; step < STEPS; step++) {
    const batch = steps[step];
    const filtered = batch.events.filter(keep);
    send(proc, {
      type: "events",
      masterGain: mode === "raw" ? 1 : MASTER_GAIN,
      events: filtered,
      tracks: batch.tracks,
    });
    const rendered = renderBlocks(proc, BLOCKS_PER_STEP, mode);
    const stepIdx = step + 1;

    // Slot stability is collected over the whole run so each slot can fire ≥2×
    // (grain period ≈ 8 s; measure window alone is only 7 s).
    {
      let domKey = null;
      let domArea = 0;
      for (const r of batch.coherent) {
        if (r.area > domArea) {
          domArea = r.area;
          domKey = r.id;
        }
      }
      if (batch.texturedArea > 0 && batch.texturedArea > domArea) {
        domKey = -2;
      }
      for (const e of batch.events) {
        if (e.regime !== "calm" && e.regime !== "texture") continue;
        if (typeof e.siteSlot !== "number") continue;
        const poolKey = e.regime === "texture" ? -2 : e.regionId;
        if (poolKey !== domKey) continue;
        let s = slotSeries.get(e.siteSlot);
        if (!s) {
          s = { pans: [], ys: [] };
          slotSeries.set(e.siteSlot, s);
        }
        s.pans.push(e.pan);
        s.ys.push(e.yNorm);
      }
    }

    if (stepIdx >= MEASURE_FROM) {
      let e = 0;
      for (let i = 0; i < rendered.framePower.length; i++) {
        e += rendered.framePower[i];
      }
      stepRms.push(Math.sqrt(e / Math.max(1, rendered.framePower.length)));
      measureChunks.push(rendered.samples);
      measurePowerChunks.push(rendered.framePower);
      if (rendered.peak > measurePeak) measurePeak = rendered.peak;
      measureEnergy += rendered.energy;
      measureMonoEnergy += rendered.monoEnergy;
      measureSamples += rendered.samples.length;
      sumConcurrency += rendered.meanConcurrency * BLOCKS_PER_STEP;
      concurrencyBlocks += BLOCKS_PER_STEP;
      sumShare.calm += batch.shares.calm;
      sumShare.texture += batch.shares.texture;
      sumShare.chaos += batch.shares.chaos;
      sumShare.osc += batch.shares.osc;
      shareSteps++;
      calmActiveSum += batch.calmActive;
      chaosActiveSum += batch.chaosActive;
      textureActiveSum += batch.textureActive;

      let domKey = null;
      let domArea = 0;
      for (const r of batch.coherent) {
        areaByPool.set(r.id, r.area);
        if (!sitesByPool.has(r.id)) sitesByPool.set(r.id, new Set());
        if (r.area > domArea) {
          domArea = r.area;
          domKey = r.id;
        }
      }
      if (batch.texturedArea > 0) {
        areaByPool.set(-2, batch.texturedArea);
        if (!sitesByPool.has(-2)) sitesByPool.set(-2, new Set());
        if (batch.texturedArea > domArea) {
          domArea = batch.texturedArea;
          domKey = -2;
        }
      }

      for (const e of filtered) {
        sumQ += e.q;
        sumDur += e.durationSec;
        qCount++;
        eventsMeasured++;
        sumPan += e.pan;
        if (e.pan < panMin) panMin = e.pan;
        if (e.pan > panMax) panMax = e.pan;
        if (e.yNorm < yMin) yMin = e.yNorm;
        if (e.yNorm > yMax) yMax = e.yNorm;

        if (e.regime === "calm" || e.regime === "texture") {
          const key = `${e.x | 0},${e.y | 0}`;
          sitesAll.add(key);
          const poolKey = e.regime === "texture" ? -2 : e.regionId;
          if (!sitesByPool.has(poolKey)) sitesByPool.set(poolKey, new Set());
          sitesByPool.get(poolKey).add(key);
          if (poolKey === domKey) {
            if (e.pan < domPanMin) domPanMin = e.pan;
            if (e.pan > domPanMax) domPanMax = e.pan;
            if (e.yNorm < domYMin) domYMin = e.yNorm;
            if (e.yNorm > domYMax) domYMax = e.yNorm;
          }
        }
      }
    }
  }

  const totalSamples = new Float32Array(measureSamples);
  const totalPower = new Float32Array(measureSamples);
  let off = 0;
  for (let i = 0; i < measureChunks.length; i++) {
    totalSamples.set(measureChunks[i], off);
    totalPower.set(measurePowerChunks[i], off);
    off += measureChunks[i].length;
  }

  // Primary RMS: sqrt(mean(L²+R²)) — pan-invariant under equal-power stereo.
  const rms = Math.sqrt(measureEnergy / Math.max(1, measureSamples));
  const monoRms = Math.sqrt(measureMonoEnergy / Math.max(1, measureSamples));
  const crest = db(measurePeak) - db(rms);

  // Largest-area calm/texture pool distinct sites.
  let largestPoolKey = -1;
  let largestPoolArea = -1;
  for (const [k, area] of areaByPool) {
    if (area > largestPoolArea) {
      largestPoolArea = area;
      largestPoolKey = k;
    }
  }
  const largestPoolSites = sitesByPool.has(largestPoolKey)
    ? sitesByPool.get(largestPoolKey).size
    : 0;

  const blockRmsStd = computeBlockRmsStdFromPower(totalPower, FS);
  const spectralFlux = meanSpectralFlux(totalSamples, FS);

  let slotPanSdMax = 0;
  let slotYSdMax = 0;
  let slotMulti = 0;
  for (const s of slotSeries.values()) {
    if (s.pans.length < 2) continue;
    slotMulti++;
    const sd = (arr) => {
      const m = arr.reduce((a, b) => a + b, 0) / arr.length;
      return Math.sqrt(
        arr.reduce((acc, x) => acc + (x - m) ** 2, 0) / arr.length,
      );
    };
    const panSd = sd(s.pans);
    const ySd = sd(s.ys);
    if (panSd > slotPanSdMax) slotPanSdMax = panSd;
    if (ySd > slotYSdMax) slotYSdMax = ySd;
  }

  return {
    pool,
    mode,
    rms,
    monoRms,
    peak: measurePeak,
    crest,
    meanConcurrency: sumConcurrency / Math.max(1, concurrencyBlocks),
    meanShare: {
      calm: sumShare.calm / Math.max(1, shareSteps),
      texture: sumShare.texture / Math.max(1, shareSteps),
      chaos: sumShare.chaos / Math.max(1, shareSteps),
      osc: sumShare.osc / Math.max(1, shareSteps),
    },
    meanQ: qCount ? sumQ / qCount : 0,
    meanDur: qCount ? sumDur / qCount : 0,
    meanPan: eventsMeasured ? sumPan / eventsMeasured : 0,
    panMin: Number.isFinite(panMin) ? panMin : 0,
    panMax: Number.isFinite(panMax) ? panMax : 0,
    yMin: Number.isFinite(yMin) ? yMin : 0,
    yMax: Number.isFinite(yMax) ? yMax : 0,
    panSpread:
      Number.isFinite(panMin) && Number.isFinite(panMax) ? panMax - panMin : 0,
    ySpread:
      Number.isFinite(yMin) && Number.isFinite(yMax) ? yMax - yMin : 0,
    distinctSites: sitesAll.size,
    largestPoolSites,
    domPanSpread:
      Number.isFinite(domPanMin) && Number.isFinite(domPanMax)
        ? domPanMax - domPanMin
        : 0,
    domYSpread:
      Number.isFinite(domYMin) && Number.isFinite(domYMax)
        ? domYMax - domYMin
        : 0,
    slotPanSdMax,
    slotYSdMax,
    slotMulti,
    stepRms,
    blockRmsStd,
    spectralFlux,
    eventsMeasured,
    calmActive: calmActiveSum / Math.max(1, shareSteps),
    chaosActive: chaosActiveSum / Math.max(1, shareSteps),
    textureActive: textureActiveSum / Math.max(1, shareSteps),
  };
}

function computeBlockRmsStdFromPower(framePower, fs) {
  const blockN = Math.round(0.1 * fs);
  const blockRmsDb = [];
  for (let i = 0; i + blockN <= framePower.length; i += blockN) {
    let e = 0;
    for (let j = 0; j < blockN; j++) e += framePower[i + j];
    blockRmsDb.push(db(Math.sqrt(e / blockN)));
  }
  if (blockRmsDb.length < 2) return 0;
  const mean = blockRmsDb.reduce((a, b) => a + b, 0) / blockRmsDb.length;
  let varSum = 0;
  for (const v of blockRmsDb) varSum += (v - mean) ** 2;
  return Math.sqrt(varSum / (blockRmsDb.length - 1));
}

/** @deprecated mono fold-down — kept for any leftover callers */
function computeBlockRmsStd(samples, fs) {
  const blockN = Math.round(0.1 * fs);
  const blockRmsDb = [];
  for (let i = 0; i + blockN <= samples.length; i += blockN) {
    let e = 0;
    for (let j = 0; j < blockN; j++) e += samples[i + j] * samples[i + j];
    blockRmsDb.push(db(Math.sqrt(e / blockN)));
  }
  if (blockRmsDb.length < 2) return 0;
  const mean = blockRmsDb.reduce((a, b) => a + b, 0) / blockRmsDb.length;
  let varSum = 0;
  for (const v of blockRmsDb) varSum += (v - mean) ** 2;
  return Math.sqrt(varSum / (blockRmsDb.length - 1));
}

/**
 * Mean L2 distance between successive 100 ms magnitude spectra, each
 * normalised to unit energy so the measure responds to timbre, not level.
 *
 * A single 4096-point periodogram of a noise-driven signal is useless here:
 * its bins are Rayleigh-distributed, so the L2 distance between two
 * independent unit-energy spectra sits at sqrt(2 - pi/2) = 0.6551 whatever
 * the signal is doing. Measured against synthetic ground truth, that estimator
 * returned 0.654 for perfectly stationary filtered noise and 0.664 for a
 * sweeping filter — i.e. entirely estimator variance.
 *
 * Each 100 ms block is therefore Welch-averaged over 512-point Hann segments
 * (hop 64) and folded into 16 mel bands before normalising. Same ground truth:
 * stationary 0.065–0.098, slow sweep 0.151, 100 ms timbre alternation 1.053.
 */
const FLUX_SEG = 512;
const FLUX_SEG_HOP = 64;
const FLUX_BANDS = 16;
const FLUX_LO_HZ = 50;
const FLUX_HI_HZ = 16000;

const toMel = (f) => 2595 * Math.log10(1 + f / 700);
const fromMel = (m) => 700 * (Math.pow(10, m / 2595) - 1);

function melBandEdges(fs) {
  const binHz = fs / FLUX_SEG;
  const nBins = FLUX_SEG / 2;
  const m0 = toMel(FLUX_LO_HZ);
  const m1 = toMel(FLUX_HI_HZ);
  const edges = [];
  let prev = Math.max(1, Math.round(FLUX_LO_HZ / binHz));
  for (let k = 1; k <= FLUX_BANDS; k++) {
    const f = fromMel(m0 + ((m1 - m0) * k) / FLUX_BANDS);
    let hi = Math.min(nBins, Math.round(f / binHz));
    if (hi <= prev) hi = prev + 1;
    if (hi > nBins) break;
    edges.push([prev, hi]);
    prev = hi;
  }
  return edges;
}

function meanSpectralFlux(samples, fs) {
  const blockN = Math.round(0.1 * fs);
  if (samples.length < blockN * 2) return 0;
  const edges = melBandEdges(fs);
  const win = new Float64Array(FLUX_SEG);
  for (let i = 0; i < FLUX_SEG; i++) {
    win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FLUX_SEG - 1)));
  }
  const specs = [];
  for (let off = 0; off + blockN <= samples.length; off += blockN) {
    const power = new Float64Array(FLUX_SEG / 2);
    let nSeg = 0;
    for (let s = off; s + FLUX_SEG <= off + blockN; s += FLUX_SEG_HOP) {
      const re = new Float64Array(FLUX_SEG);
      const im = new Float64Array(FLUX_SEG);
      for (let i = 0; i < FLUX_SEG; i++) re[i] = samples[s + i] * win[i];
      fftRadix2(re, im);
      for (let k = 0; k < FLUX_SEG / 2; k++) {
        power[k] += re[k] * re[k] + im[k] * im[k];
      }
      nSeg++;
    }
    if (!nSeg) continue;
    const mag = new Float64Array(edges.length);
    let e = 0;
    for (let b = 0; b < edges.length; b++) {
      const [lo, hi] = edges[b];
      let p = 0;
      for (let k = lo; k < hi; k++) p += power[k];
      const m = Math.sqrt(p / nSeg);
      mag[b] = m;
      e += m * m;
    }
    const inv = e > 1e-20 ? 1 / Math.sqrt(e) : 0;
    for (let k = 0; k < mag.length; k++) mag[k] *= inv;
    specs.push(mag);
  }
  if (specs.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < specs.length; i++) {
    let d = 0;
    const a = specs[i - 1];
    const b = specs[i];
    for (let k = 0; k < a.length; k++) {
      const diff = a[k] - b[k];
      d += diff * diff;
    }
    sum += Math.sqrt(d);
  }
  return sum / (specs.length - 1);
}

function fftRadix2(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let tmp = re[i];
      re[i] = re[j];
      re[j] = tmp;
      tmp = im[i];
      im[i] = im[j];
      im[j] = tmp;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wlenRe = Math.cos(ang);
    const wlenIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wRe = 1;
      let wIm = 0;
      for (let j = 0; j < len / 2; j++) {
        const uRe = re[i + j];
        const uIm = im[i + j];
        const vRe = re[i + j + len / 2] * wRe - im[i + j + len / 2] * wIm;
        const vIm = re[i + j + len / 2] * wIm + im[i + j + len / 2] * wRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + len / 2] = uRe - vRe;
        im[i + j + len / 2] = uIm - vIm;
        const nWRe = wRe * wlenRe - wIm * wlenIm;
        wIm = wRe * wlenIm + wIm * wlenRe;
        wRe = nWRe;
      }
    }
  }
}

function renderOneGrain(Processor, pcm, overrides) {
  const proc = new Processor();
  loadSource(proc, pcm);
  const dur = overrides.durationSec ?? 0.5;
  send(proc, {
    type: "events",
    masterGain: 1,
    events: [
      {
        x: 64,
        y: 64,
        r: 0.5,
        g: 0.5,
        b: 0.5,
        durationSec: dur,
        amplitude: 1 / Math.sqrt(64),
        direction: 1,
        sampleCenter: 0.5,
        sampleHalf: 0.4,
        startOffsetSec: 0,
        q: overrides.q ?? 2,
        yNorm: overrides.yNorm ?? 0.5,
        pan: 0,
        attackFrac: overrides.attackFrac ?? 0.3,
        releaseFrac: overrides.releaseFrac ?? 0.34,
        regime: overrides.regime ?? "calm",
        regionId: -1,
        trackDx: 0,
        trackDy: 0,
      },
    ],
    tracks: [],
  });
  const nBlocks = Math.ceil((dur * FS) / BLOCK) + 4;
  const rendered = renderBlocks(proc, nBlocks, "raw");
  const grainSamples = Math.floor(dur * FS);
  const n = Math.min(grainSamples, rendered.framePower.length);
  let energy = 0;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    energy += rendered.framePower[i];
  }
  // Peak over the rendered blocks (already hypot-based).
  peak = rendered.peak;
  const rms = Math.sqrt(energy / Math.max(1, n));
  return { rms, peak, crest: db(peak) - db(rms) };
}

async function runColdStart(Processor, pattern, pcm) {
  const frameObs = new FrameObserver(W, H);
  frameObs.reset();
  const fieldObs = new FieldObserver(W, H);
  const sched = new GrainScheduler();
  sched.setSourceDurationSec(SOURCE_DUR_SEC);
  sched.setMaterialSegments(makeTestMaterialSegments(64));

  const proc = new Processor();
  loadSource(proc, pcm);

  const rgba = new Uint8ClampedArray(W * H * 4);
  const field = makeField();
  const STEPS = 180;
  const earlyPeaks = [];
  const latePeaks = [];

  for (let step = 0; step < STEPS; step++) {
    pattern.fill(field, step);
    for (let i = 0; i < N; i++) {
      rgba[i * 4] = Math.round(field.r[i] * 255);
      rgba[i * 4 + 1] = Math.round(field.g[i] * 255);
      rgba[i * 4 + 2] = Math.round(field.b[i] * 255);
      rgba[i * 4 + 3] = 255;
    }
    const ingested = frameObs.ingest(rgba, step);
    if (!ingested) continue;
    const o = fieldObs.observe(frameObs.current, frameObs.previous);
    const batch = sched.step(o, frameObs.current, step * STEP_MS);
    send(proc, {
      type: "events",
      masterGain: 1,
      events: batch.events,
      tracks: batch.tracks,
    });
    const rendered = renderBlocks(proc, BLOCKS_PER_STEP, "raw");
    if (step < 30) earlyPeaks.push(rendered.peak);
    if (step >= 120 && step < 180) latePeaks.push(rendered.peak);
  }

  const earlyPeak = Math.max(0, ...earlyPeaks);
  const latePeak = Math.max(1e-12, ...latePeaks);
  return {
    earlyPeak,
    latePeak,
    deltaDb: db(earlyPeak) - db(latePeak),
  };
}

/** Distinct (x,y) count for a regime over the measure window (event-only). */
function countDistinctSites(pattern, regime) {
  const recorded = recordScenario(pattern);
  const sites = new Set();
  let events = 0;
  let sumPan = 0;
  for (let step = 0; step < recorded.STEPS; step++) {
    if (step + 1 < recorded.MEASURE_FROM) continue;
    for (const e of recorded.steps[step].events) {
      const match =
        regime === "chaos"
          ? e.regime !== "calm" &&
            e.regime !== "texture" &&
            e.regime !== "osc" &&
            e.regime !== "flow"
          : regime === "calm+texture"
            ? e.regime === "calm" || e.regime === "texture"
            : e.regime === regime;
      if (!match) continue;
      sites.add(`${e.x | 0},${e.y | 0}`);
      events++;
      sumPan += e.pan;
    }
  }
  return {
    distinct: sites.size,
    events,
    meanPan: events ? sumPan / events : 0,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const Processor = await loadWorkletClass(FS);
const white = makeWhite(SOURCE_LEN, 11);
const pink = makePink(SOURCE_LEN, 42);

const sources =
  SOURCE_ARG === "pink"
    ? [["pink", pink]]
    : SOURCE_ARG === "both"
      ? [
          ["white", white],
          ["pink", pink],
        ]
      : [["white", white]];

console.log(
  `render-scenarios: fs=${FS} block=${BLOCK} blocks/step=${BLOCKS_PER_STEP} stage=${STAGE}\n`,
);

// ---- Sweeps ----
console.log("=== Q sweep (yNorm=0.5, dur=0.5s, raw) ===");
const qSweep = {};
for (const [srcName, pcm] of sources) {
  const rmses = [];
  for (const q of [0.8, 2, 4, 8]) {
    const r = renderOneGrain(Processor, pcm, { q, yNorm: 0.5 });
    rmses.push(r.rms);
    console.log(
      `  ${srcName} Q=${q}: rms=${r.rms.toFixed(5)} (${db(r.rms).toFixed(2)} dB)`,
    );
  }
  const spread = dbSpread(rmses);
  qSweep[srcName] = { rmses, spread };
  console.log(`  ${srcName} Q spread: ${spread.toFixed(2)} dB`);
}
console.log("");

console.log("=== Y sweep (Q=2, dur=0.5s, raw) ===");
const ySweep = {};
for (const [srcName, pcm] of sources) {
  const rmses = [];
  for (const y of [0, 0.25, 0.5, 0.75, 1]) {
    const r = renderOneGrain(Processor, pcm, { q: 2, yNorm: y });
    rmses.push(r.rms);
    console.log(
      `  ${srcName} yNorm=${y}: rms=${r.rms.toFixed(5)} (${db(r.rms).toFixed(2)} dB)`,
    );
  }
  const spread = dbSpread(rmses);
  const spreadLower = dbSpread(rmses.slice(0, 4));
  ySweep[srcName] = { rmses, spread, spreadLower };
  console.log(
    `  ${srcName} Y spread: ${spread.toFixed(2)} dB (lower4: ${spreadLower.toFixed(2)} dB)`,
  );
}
console.log("");

console.log("=== Envelope sweep (Q=2, yNorm=0.5, raw) ===");
const envShapes = [
  { attackFrac: 0.3, releaseFrac: 0.34, label: "calm" },
  { attackFrac: 0.04, releaseFrac: 0.12, label: "chaos" },
  { attackFrac: 0.02, releaseFrac: 0.98, label: "percussive" },
];
const envSweep = {};
for (const [srcName, pcm] of sources) {
  const rmses = [];
  for (const shape of envShapes) {
    const r = renderOneGrain(Processor, pcm, {
      q: 2,
      yNorm: 0.5,
      attackFrac: shape.attackFrac,
      releaseFrac: shape.releaseFrac,
    });
    rmses.push(r.rms);
    console.log(
      `  ${srcName} ${shape.label} (${shape.attackFrac}/${shape.releaseFrac}): rms=${r.rms.toFixed(5)} (${db(r.rms).toFixed(2)} dB)`,
    );
  }
  const spread = dbSpread(rmses);
  envSweep[srcName] = { rmses, spread };
  console.log(`  ${srcName} envelope spread: ${spread.toFixed(2)} dB`);
}
console.log("");

for (const [srcName, data] of Object.entries(qSweep)) {
  assertLe(2, "Q-sweep", `${srcName} spread ≤1.5dB`, data.spread, 1.5);
}
if (ySweep.white) {
  assertLe(2, "Y-sweep", "white spread ≤3.5dB", ySweep.white.spread, 3.5);
  assertLe(
    2,
    "Y-sweep",
    "white lower4 ≤1.5dB",
    ySweep.white.spreadLower,
    1.5,
  );
}
for (const [srcName, data] of Object.entries(envSweep)) {
  assertLe(2, "env-sweep", `${srcName} spread ≤1dB`, data.spread, 1.0);
}

// ---- Scenarios ----
const primaryPcm = SOURCE_ARG === "pink" ? pink : white;
const primaryName = SOURCE_ARG === "pink" ? "pink" : "white";
/** @type {Map<string, any>} */
const results = new Map();

for (const pattern of TEST_PATTERNS) {
  console.log(`=== ${pattern.id}  source=${primaryName}  mode=raw ===`);
  const recorded = recordScenario(pattern);
  /** @type {Record<string, any>} */
  const byPool = {};
  for (const pool of ["all", "calm", "texture", "chaos", "osc"]) {
    byPool[pool] = replayScenario(
      Processor,
      primaryPcm,
      "raw",
      recorded,
      pool,
    );
  }
  const total = byPool.all;
  console.log(
    `  total      rms ${total.rms.toExponential(3)}  (mono ${total.monoRms.toExponential(3)})  peak ${total.peak.toExponential(3)}  crest ${total.crest.toFixed(1)} dB  mean concurrency ${total.meanConcurrency.toFixed(1)}`,
  );
  console.log(
    `  calm       rms ${byPool.calm.rms.toExponential(3)}  mean concurrency ${byPool.calm.meanConcurrency.toFixed(1)}  share ${total.meanShare.calm.toFixed(1)}`,
  );
  console.log(
    `  texture    rms ${byPool.texture.rms.toExponential(3)}  mean concurrency ${byPool.texture.meanConcurrency.toFixed(1)}  share ${total.meanShare.texture.toFixed(1)}`,
  );
  console.log(
    `  chaos      rms ${byPool.chaos.rms.toExponential(3)}  mean concurrency ${byPool.chaos.meanConcurrency.toFixed(1)}  share ${total.meanShare.chaos.toFixed(1)}`,
  );
  console.log(
    `  osc        rms ${byPool.osc.rms.toExponential(3)}  mean concurrency ${byPool.osc.meanConcurrency.toFixed(1)}  share ${total.meanShare.osc.toFixed(1)}`,
  );
  console.log(
    `  material   meanQ calm=${byPool.calm.meanQ.toFixed(2)} tex=${byPool.texture.meanQ.toFixed(2)} chaos=${byPool.chaos.meanQ.toFixed(2)}  meanDur calm=${byPool.calm.meanDur.toFixed(3)} tex=${byPool.texture.meanDur.toFixed(3)}`,
  );
  console.log(
    `  pan/y      calm pan[${byPool.calm.panMin.toFixed(2)},${byPool.calm.panMax.toFixed(2)}] spread=${byPool.calm.panSpread.toFixed(2)} y spread=${byPool.calm.ySpread.toFixed(2)}  tex pan spread=${byPool.texture.panSpread.toFixed(2)} y spread=${byPool.texture.ySpread.toFixed(2)}`,
  );
  console.log(
    `  dominant   pan spread=${total.domPanSpread.toFixed(2)}  y spread=${total.domYSpread.toFixed(2)}  (largest calm/texture pool per step)`,
  );
  console.log(
    `  sites      distinct calm+tex=${total.distinctSites}  largest-pool=${total.largestPoolSites}  blockRmsStd=${total.blockRmsStd.toFixed(2)} dB  spectralFlux=${total.spectralFlux.toFixed(4)}`,
  );
  console.log(
    `  slotStab   multi=${total.slotMulti}  maxPanSd=${total.slotPanSdMax.toFixed(4)}  maxYSd=${total.slotYSdMax.toFixed(4)}`,
  );
  console.log("");
  results.set(pattern.id, { total, byPool, pattern });
}

const chaosSites = countDistinctSites(
  TEST_PATTERNS.find((p) => p.id === "full-flicker"),
  "chaos",
);
const uniformSites = countDistinctSites(
  TEST_PATTERNS.find((p) => p.id === "uniform-calm"),
  "calm+texture",
);
console.log(
  `chaos sites (full-flicker): distinct=${chaosSites.distinct} events=${chaosSites.events}`,
);
console.log(
  `uniform-calm mean pan (calm+tex): ${uniformSites.meanPan.toFixed(3)}`,
);
console.log("");

// ---- Stage 3 ----
{
  const u = results.get("uniform-calm")?.total;
  const f = results.get("full-flicker")?.total;
  const h = results.get("half-half")?.total;
  const g = results.get("gradient-calm")?.total;
  const fr = results.get("frozen-noise");
  const uu = results.get("uniform-calm");
  const hh = results.get("half-half")?.byPool;

  if (u && f && h) {
    assertLe(
      3,
      "balance",
      "uniform/flicker/half-half total RMS within 3dB",
      dbSpread([u.rms, f.rms, h.rms]),
      3,
    );
  }
  if (hh) {
    assertLe(
      3,
      "half-half",
      "calm vs chaos pool RMS within 6dB",
      Math.abs(db(hh.calm.rms) - db(hh.chaos.rms)),
      6,
    );
  }
  if (u && g) {
    assertLe(
      3,
      "segmentation",
      "uniform vs gradient total RMS within 1dB",
      Math.abs(db(u.rms) - db(g.rms)),
      1,
    );
  }
  if (u && fr) {
    assertLe(
      3,
      "frozen-vs-uniform",
      "frozen-noise vs uniform-calm total RMS within 3dB",
      Math.abs(db(fr.total.rms) - db(u.rms)),
      3,
    );
    const fQ = fr.byPool.texture.meanQ;
    const uQ = uu.byPool.calm.meanQ;
    assert(
      3,
      "frozen-vs-uniform",
      "frozen-noise mean Q < uniform-calm mean Q",
      fQ < uQ,
      "frozen Q < uniform Q",
      `frozen=${fQ.toFixed(3)} uniform=${uQ.toFixed(3)}`,
    );
  }
}

// ---- Stage 4 ----
{
  const useStable = (id) => {
    const r = results.get(id);
    if (!r) return null;
    return r.byPool.calm.eventsMeasured >= r.byPool.texture.eventsMeasured
      ? r.byPool.calm
      : r.byPool.texture;
  };
  // Temporal stability per stratified slot (replaces range-bound checkDisp).
  // Spread across slots is unbounded; a given slot must not wander.
  const checkSlotStable = (id) => {
    const r = results.get(id);
    if (!r) return;
    assertGe(
      4,
      id,
      "dominant-pool slots with ≥2 hits (stasis sample)",
      r.total.slotMulti,
      8,
    );
    assertLe(
      4,
      id,
      "per-slot pan sd ≤0.01",
      r.total.slotPanSdMax,
      0.01,
    );
    assertLe(
      4,
      id,
      "per-slot yNorm sd ≤0.01",
      r.total.slotYSdMax,
      0.01,
    );
  };
  const checkDispMin = (id, panMin, yMin) => {
    const r = results.get(id);
    if (!r) return;
    if (id === "gradient-calm") {
      assertGe(4, id, `pan spread ≥${panMin}`, r.byPool.calm.panSpread, panMin);
      return;
    }
    const use = useStable(id);
    assertGe(4, id, `pan spread ≥${panMin}`, use.panSpread, panMin);
    if (yMin != null) {
      assertGe(4, id, `yNorm spread ≥${yMin}`, use.ySpread, yMin);
    }
  };

  // moving-bar is deliberately excluded (owner decision 2026-08-10): its mask
  // has a moving hole, so slots near the bar's path legitimately snap a few
  // cells aside when it passes — sound reacting to real field change, not
  // sampler wander. The three frozen-mask sims cover stasis exactly (sd 0).
  checkSlotStable("uniform-calm");
  checkSlotStable("breathing-uniform");
  checkSlotStable("glider-swarm");
  checkDispMin("frozen-noise", 0.7, 0.7);
  checkDispMin("gradient-calm", 0.7, null);

  assertIn(
    4,
    "uniform-calm",
    "mean pan ∈ [-0.15, 0.15]",
    uniformSites.meanPan,
    -0.15,
    0.15,
  );

  const siteMax = (id, max) => {
    const r = results.get(id);
    if (!r) return;
    assertLe(
      4,
      id,
      `largest-pool distinct sites ≤${max}`,
      r.total.largestPoolSites,
      max,
    );
  };
  siteMax("uniform-calm", 70);
  siteMax("frozen-noise", 70);
  siteMax("checkerboard-calm", 70);
  siteMax("hue-drift", 70);
  siteMax("breathing-uniform", 70);
  siteMax("glider-swarm", 70);
  siteMax("gradient-calm", 12);

  assertGe(
    4,
    "full-flicker",
    "chaos distinct sites ≥500",
    chaosSites.distinct,
    500,
  );

  for (const [id, r] of results) {
    // Listening instruments (V4.4 Phase 5) and known modulators are excluded
    // from the stasis block-RMS bound — they exist to produce change.
    if (
      id === "half-half" ||
      id === "two-blobs-merge" ||
      id === "chaos-blob-2pct" ||
      id === "chaos-blob-10pct" ||
      id === "pulse-calm" ||
      id === "osc-field" ||
      id === "hue-bands" ||
      id === "identity-quadrants"
    ) {
      continue;
    }
    assertLe(4, id, "blockRmsStd ≤1.5dB", r.total.blockRmsStd, 1.5);
  }

  // Phase 4 S4 — block-RMS modulation depth at the oscillator pulse rate.
  // Raw mode (no AGC): this is the intentional percussive crest, not
  // normaliser pumping. Bound leaves headroom above post-change measured
  // depth on blinker-fast/slow (~0.2–0.5 dB all-pool); osc-only is much
  // deeper by design. Fail closed if all-pool pulse depth explodes.
  const pulseFoldDepthDb = (stepRms, periodSteps) => {
    if (!stepRms?.length || periodSteps < 2) return 0;
    const fold = new Array(periodSteps).fill(0);
    const foldN = new Array(periodSteps).fill(0);
    for (let i = 0; i < stepRms.length; i++) {
      const b = i % periodSteps;
      fold[b] += stepRms[i];
      foldN[b] += 1;
    }
    let mx = -Infinity;
    let mn = Infinity;
    for (let b = 0; b < periodSteps; b++) {
      const v = fold[b] / Math.max(1, foldN[b]);
      if (v > mx) mx = v;
      if (v < mn) mn = v;
    }
    return db(mx) - db(mn);
  };
  const checkPulseMod = (id, periodSteps, maxDb) => {
    const r = results.get(id);
    if (!r) return;
    const depth = pulseFoldDepthDb(r.total.stepRms, periodSteps);
    const oscDepth = pulseFoldDepthDb(r.byPool.osc.stepRms, periodSteps);
    console.log(
      `  pulseMod  ${id}: all ${depth.toFixed(2)} dB  osc-only ${oscDepth.toFixed(2)} dB  (period ${periodSteps} steps)`,
    );
    assertLe(4, id, `pulse fold depth ≤${maxDb}dB`, depth, maxDb);
  };
  checkPulseMod("blinker-fast", 2, 3.0);
  checkPulseMod("blinker-slow", 6, 3.0);
  // osc-field is all pulse — depth ≈ osc-only (~21 dB). Bound is headroom
  // above the measured intentional crest, not a stasis target.
  if (results.has("osc-field")) checkPulseMod("osc-field", 2, 30.0);

  // Audio Welch-mel flux: REPORT ONLY. At filled concurrency the ordering is
  // near-backwards (64 short chaos grains average into a smoother wash than 64
  // long re-triggers). Event-domain Y/Q flux in investigate is the real gate.
  // Noise floor: independent unit-energy periodograms → E[L2]=√(2−π/2)≈0.6551;
  // Welch-mel drops stationary to ~0.065–0.098.
  console.log("  Audio flux (Welch mel, reported, not asserted):");
  console.log(
    "    simulated bit-identical×64 vs redrawn chaos: 100ms ratio 0.80, 200ms ratio 1.13",
  );
  const flux = (id) => results.get(id)?.total.spectralFlux ?? 0;
  const fFlicker = flux("full-flicker");
  for (const id of [
    "frozen-noise",
    "uniform-calm",
    "checkerboard-calm",
    "hue-drift",
    "full-flicker",
  ]) {
    const f = flux(id);
    console.log(
      `    ${id}: ${f.toFixed(4)}${id === "full-flicker" ? "" : `  (ratio vs flicker ${(fFlicker / Math.max(1e-12, f)).toFixed(2)})`}`,
    );
  }
}

// ---- Stage 5 (Phase 5: percussive chaos; envNorm keeps level) ----
// Phase-4 baselines (chaos-only replay RMS; scheduler chaosActive for conc).
const PHASE4_CHAOS = {
  // Re-captured under sqrt(mean(L²+R²)) with Phase-4 DUR/ATT/REL (0.05/0.04/0.12).
  "half-half": { rms: 5.9803e-2, conc: 33.0 },
  "full-flicker": { rms: 8.2752e-2, conc: 64.0 },
};

/**
 * Recover the envelope from rendered audio: ensemble-average squared samples
 * of one chaos grain over many noise realisations, then 10·log₁₀(peak/mean)
 * of that power curve. Tests the worklet path, not just the SCHED constants.
 */
async function renderedEnvelopeCrestDb(
  Processor,
  { attackFrac, releaseFrac, durationSec },
  nReal = 256,
) {
  const nSamples = Math.ceil(durationSec * FS);
  const nBlocks = Math.ceil(nSamples / BLOCK) + 2;
  const power = new Float64Array(nSamples);
  const pcmLen = Math.max(FS * 2, nSamples + FS);
  for (let r = 0; r < nReal; r++) {
    const pcm = makeWhite(pcmLen, (r + 1) * 9973);
    const proc = new Processor();
    loadSource(proc, pcm);
    send(proc, {
      type: "events",
      masterGain: 1,
      events: [
        {
          x: 64,
          y: 64,
          r: 0.5,
          g: 0.2,
          b: 0.8,
          durationSec,
          amplitude: 0.125,
          direction: 1,
          sampleCenter: 0.5,
          sampleHalf: 0.1,
          startOffsetSec: 0,
          q: 1.5,
          yNorm: 0.5,
          pan: 0,
          attackFrac,
          releaseFrac,
          regime: "chaos",
          regionId: -1,
          trackDx: 0,
          trackDy: 0,
          readOffset: 0,
        },
      ],
      tracks: [],
    });
    let off = 0;
    for (let b = 0; b < nBlocks && off < nSamples; b++) {
      const { framePower } = renderBlock(proc, "raw");
      for (let i = 0; i < BLOCK && off < nSamples; i++, off++) {
        power[off] += framePower[i];
      }
    }
  }
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < nSamples; i++) {
    const p = power[i] / nReal;
    power[i] = p;
    sum += p;
    if (p > peak) peak = p;
  }
  const mean = sum / nSamples;
  return 10 * Math.log10(peak / Math.max(1e-30, mean));
}

{
  const crestP4 = await renderedEnvelopeCrestDb(Processor, {
    attackFrac: 0.04,
    releaseFrac: 0.12,
    durationSec: 0.05,
  });
  const crestP5 = await renderedEnvelopeCrestDb(Processor, {
    attackFrac: SCHED.ATT_MIN,
    releaseFrac: SCHED.REL_CHAOS,
    durationSec: SCHED.DUR_MIN,
  });
  const dCrest = crestP5 - crestP4;
  assertGe(5, "chaos-envelope", "rendered crest vs Phase 4 ≥+3 dB", dCrest, 3);
  console.log(
    `  Gate5 rendered envelope crest: P4 ${crestP4.toFixed(2)} dB → P5 ${crestP5.toFixed(2)} dB (Δ ${dCrest.toFixed(2)} dB)`,
  );

  for (const id of ["half-half", "full-flicker"]) {
    const row = results.get(id);
    const pool = row?.byPool.chaos;
    const base = PHASE4_CHAOS[id];
    if (!pool || !base || !row) continue;
    const conc = row.total.chaosActive;
    const dRms = Math.abs(db(pool.rms) - db(base.rms));
    const dConc = Math.abs(conc - base.conc);
    assertLe(5, id, "chaos RMS vs Phase 4 ≤1.5 dB", dRms, 1.5);
    assertLe(5, id, "chaos concurrency vs Phase 4 ≤2", dConc, 2);
    console.log(
      `  Gate5 ${id}: chaos rms ${pool.rms.toExponential(3)} (${dRms.toFixed(2)} dB vs P4)  schedConc ${conc.toFixed(1)} (Δ${dConc.toFixed(1)})`,
    );
  }
}

// ---- Segmentation coherence diagnostic (assertion stays; do not widen band) ----
{
  const pattern = TEST_PATTERNS.find((p) => p.id === "uniform-calm");
  const recorded = recordScenario(pattern);
  const clonePatch = (forceZero) => {
    const steps = recorded.steps.map((s) => ({
      ...s,
      events: s.events.map((e) => ({
        ...e,
        readOffset: forceZero ? 0 : e.readOffset,
      })),
    }));
    return { ...recorded, steps };
  };
  const correlated = replayScenario(
    Processor,
    primaryPcm,
    "raw",
    clonePatch(true),
    "all",
  );
  const decorrelated = replayScenario(
    Processor,
    primaryPcm,
    "raw",
    clonePatch(false),
    "all",
  );
  const gapDb = db(correlated.rms) - db(decorrelated.rms);
  console.log(
    `  Coherence test (uniform-calm): readOffset=0 rms=${correlated.rms.toExponential(3)}  per-slot rms=${decorrelated.rms.toExponential(3)}  gap=${gapDb.toFixed(2)} dB`,
  );
  console.log(
    gapDb >= 0.4 && gapDb <= 1.2
      ? "    → gap ≈ 0.7 dB class: colour uniformity → louder (D1 boundary)."
      : "    → gap not ≈0.7 dB: earlier coherence residual disconfirmed (segmentation cause was mono fold-down, not this).",
  );
}

// ---- Stage 6 / cold-start ----
if (STAGE >= 6 || COLD_START || STAGE === 0) {
  console.log(
    "=== Cold-start mode (FrameObserver path, first 30 / late 120-180) ===",
  );
  for (const id of [
    "frozen-noise",
    "breathing-uniform",
    "gradient-calm",
    "uniform-calm",
  ]) {
    const pattern = TEST_PATTERNS.find((p) => p.id === id);
    if (!pattern) continue;
    const c = await runColdStart(Processor, pattern, primaryPcm);
    console.log(
      `  ${id}: earlyPeak=${c.earlyPeak.toExponential(3)} latePeak=${c.latePeak.toExponential(3)} delta=${c.deltaDb.toFixed(2)} dB`,
    );
    assertLe(6, id, "cold-start early peak ≤ late+3dB", c.deltaDb, 3);
  }
  console.log("");
}

if (failures.length) {
  console.log(`\n${failures.length} assertion(s) failed (stage ≤ ${STAGE}).`);
  process.exit(1);
}
console.log(
  STAGE === 0
    ? "\nStage 0: print only (no assertions enforced)."
    : `\nAll stage ≤ ${STAGE} assertions passed.`,
);
