/**
 * Investigation harness: feeds synthetic "known truth" CA states through
 * FieldObserver + GrainScheduler and reports what the system perceives and
 * how many grain events it fires.
 *
 * Run: node scripts/investigate-scenarios.mjs [--stage N]
 * Stage 0 = print only; stage N enforces all assertions tagged ≤ N.
 */
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { FieldObserver } = await import(
  pathToFileURL(join(root, "src/field/FieldObserver.ts")).href
);
const { GrainScheduler } = await import(
  pathToFileURL(join(root, "src/field/GrainScheduler.ts")).href
);
const { TEST_PATTERNS } = await import(
  pathToFileURL(join(root, "src/field/TestPatterns.ts")).href
);

const W = 128;
const H = 128;
const N = W * H;
const STEPS_DEFAULT = 420; // 14 s at 30 steps/s
const MEASURE_FROM_DEFAULT = 210; // skip warm-up/EMA settling, measure last 7 s
/** Longer run for breathing scrub spread (Phase 7 note). */
const STEPS_BREATHING = 600; // 20 s
const MEASURE_FROM_BREATHING = 210; // measure last 13 s
/**
 * Frozen-noise Gate 4(iv): texture rate ≈ 8/s at K=64 → slot period 8 s.
 * Need ≥2 hits per slot, so measure ≥16 s (warmup 7 s + 23 s measure).
 */
const STEPS_FROZEN = 900; // 30 s
const MEASURE_FROM_FROZEN = 210; // measure last 23 s
const STEP_MS = 1000 / 30;

function parseStage(argv) {
  const i = argv.indexOf("--stage");
  if (i < 0) return 0;
  const v = Number(argv[i + 1]);
  return Number.isFinite(v) ? v : 0;
}

const STAGE = parseStage(process.argv.slice(2));

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

/** Match FrameObserver's 8-bit quantisation of getImgData. */
function quantize(f) {
  for (let i = 0; i < N; i++) {
    f.r[i] = Math.round(f.r[i] * 255) / 255;
    f.g[i] = Math.round(f.g[i] * 255) / 255;
    f.b[i] = Math.round(f.b[i] * 255) / 255;
  }
}

function inBlinkerBlock(ci) {
  const x = ci % W;
  const y = (ci / W) | 0;
  const x0 = ((W - 40) / 2) | 0;
  const y0 = ((H - 40) / 2) | 0;
  return x >= x0 && x < x0 + 40 && y >= y0 && y < y0 + 40;
}

/**
 * @typedef {{
 *   id: string,
 *   calmPct: number,
 *   chaosPct: number,
 *   staticPct: number,
 *   regions: number,
 *   meanKappa: number,
 *   calmEvPerSec: number,
 *   chaosEvPerSec: number,
 *   textureEvPerSec: number,
 *   oscEvPerSec: number,
 *   maxPerStep: number,
 *   burstSteps: number,
 *   avgActive: number,
 *   durMin: number,
 *   durMax: number,
 *   textureDurMin: number,
 *   meanVelX: number,
 *   finalRegionCount: number,
 *   distinctRegionIds: number,
 *   oscCellsPeriod2: number,
 *   oscPeriodDetected: number,
 *   oscBurstsPerSec: number,
 *   blinkerChaosEvPerSec: number,
 *   calmSampleCenterSpread: number,
 *   calmReverseDirCount: number,
 *   chaosDurP5: number,
 *   chaosDurP95: number,
 *   chaosDurSpread: number,
 * }} ScenarioResult
 */

/** @returns {ScenarioResult} */
function runScenario(pattern) {
  const STEPS =
    pattern.id === "breathing-uniform"
      ? STEPS_BREATHING
      : pattern.id === "frozen-noise"
        ? STEPS_FROZEN
        : STEPS_DEFAULT;
  const MEASURE_FROM =
    pattern.id === "breathing-uniform"
      ? MEASURE_FROM_BREATHING
      : pattern.id === "frozen-noise"
        ? MEASURE_FROM_FROZEN
        : MEASURE_FROM_DEFAULT;

  const obs = new FieldObserver(W, H);
  const sched = new GrainScheduler();
  sched.setSourceDurationSec(30);
  // Synthetic polar map so HSV axes reach distinct file positions in headless runs.
  sched.setMaterialSegments(makeTestMaterialSegments(64));

  let prev = makeField();
  let cur = makeField();
  pattern.fill(prev, 0);
  quantize(prev);

  let calmEvents = 0;
  let chaosEvents = 0;
  let textureEvents = 0;
  let oscEvents = 0;
  let flowEvents = 0;
  let maxPerStep = 0;
  let burstSteps = 0;
  let sumCalmFrac = 0;
  let sumChaosFrac = 0;
  let sumStaticFrac = 0;
  let sumFlowFrac = 0;
  let sumRegions = 0;
  let sumKappa = 0;
  let sumActive = 0;
  let sumCalmActive = 0;
  let velXSamples = [];
  let measured = 0;
  let durMin = Infinity;
  let durMax = 0;
  let textureDurMin = Infinity;
  /** @type {number[]} */
  const chaosDurs = [];
  let finalRegionCount = 0;
  const regionIdsSeen = new Set();
  let oscCellsPeriod2 = 0;
  let oscPeriodDetected = 0;
  let oscBurstSteps = 0;
  let blinkerChaosEvents = 0;
  const calmCenters = [];
  const textureCenters = [];
  /** @type {Map<number, number[]>} */
  const textureCentersBySlot = new Map();
  let calmReverseDirCount = 0;
  /** Active grains for event-domain Y/Q flux (Gate 4(iii)). */
  const activeGrains = [];
  const eventFluxHists = [];
  const EVENT_FLUX_EVERY = 3; // 100 ms at 30 steps/s

  for (let step = 1; step <= STEPS; step++) {
    pattern.fill(cur, step);
    quantize(cur);
    const o = obs.observe(cur, prev);
    const batch = sched.step(o, cur, step * STEP_MS);

    for (const r of o.coherent) regionIdsSeen.add(r.id);
    finalRegionCount = o.coherent.length;

    for (const e of batch.events) {
      activeGrains.push({
        y: e.yNorm,
        logQ: Math.log2(Math.max(1e-6, e.q)),
        end: step + e.durationSec * 30,
      });
    }
    for (let i = activeGrains.length - 1; i >= 0; i--) {
      if (activeGrains[i].end <= step) activeGrains.splice(i, 1);
    }

    if (step >= MEASURE_FROM) {
      measured++;
      let calmThisStep = new Map();
      let oscThisStep = 0;
      for (const e of batch.events) {
        if (e.regime === "calm") {
          calmEvents++;
          calmThisStep.set(e.regionId, (calmThisStep.get(e.regionId) ?? 0) + 1);
          calmCenters.push(e.sampleCenter);
          if (e.direction === -1) calmReverseDirCount++;
        } else if (e.regime === "texture") {
          textureEvents++;
          textureCenters.push(e.sampleCenter);
          // Key by colour-group + slot — slot alone collides across groups.
          const slotKey =
            typeof e.siteSlot === "number"
              ? `${e.regionId}:${e.siteSlot}`
              : `${e.regionId}:-1`;
          let arr = textureCentersBySlot.get(slotKey);
          if (!arr) {
            arr = [];
            textureCentersBySlot.set(slotKey, arr);
          }
          arr.push(e.sampleCenter);
          if (e.durationSec < textureDurMin) textureDurMin = e.durationSec;
        } else if (e.regime === "osc") {
          oscEvents++;
          oscThisStep++;
        } else if (e.regime === "flow") {
          flowEvents++;
        } else {
          chaosEvents++;
          chaosDurs.push(e.durationSec);
          if (inBlinkerBlock(e.y * W + e.x)) blinkerChaosEvents++;
        }
        if (e.durationSec < durMin) durMin = e.durationSec;
        if (e.durationSec > durMax) durMax = e.durationSec;
      }

      if ((step - MEASURE_FROM) % EVENT_FLUX_EVERY === 0) {
        const bins = new Float64Array(16);
        let logQ = 0;
        const n = activeGrains.length;
        for (const g of activeGrains) {
          bins[Math.min(15, Math.floor(Math.max(0, Math.min(1, g.y)) * 16))]++;
          logQ += g.logQ;
        }
        if (n > 0) {
          for (let k = 0; k < 16; k++) bins[k] /= n;
          logQ /= n;
        }
        eventFluxHists.push({ bins, logQ });
      }

      for (const c of calmThisStep.values()) if (c >= 2) burstSteps++;
      if (oscThisStep > 0) oscBurstSteps++;
      if (batch.events.length > maxPerStep) maxPerStep = batch.events.length;
      sumCalmFrac += o.calmAreaFraction;
      sumChaosFrac += o.chaosAreaFraction;
      sumStaticFrac += o.texturedAreaFraction ?? 0;
      sumFlowFrac += o.flowAreaFraction ?? 0;
      sumRegions += o.coherent.length;
      sumKappa += o.meanCoherence;
      sumActive += batch.predictedActive;
      sumCalmActive += batch.calmActive;
      if (o.coherent.length > 0) {
        const biggest = o.coherent.reduce((m, r) => (r.area > m.area ? r : m));
        velXSamples.push(biggest.velX);
      }

      // Oscillator observation stats
      if (o.oscillators && o.oscillators.length > 0) {
        let cellsP2 = 0;
        let maxPeriod = 0;
        let maxArea = 0;
        for (const g of o.oscillators) {
          if (g.period === 2) cellsP2 += g.area;
          if (g.area > maxArea) {
            maxArea = g.area;
            maxPeriod = g.period;
          }
        }
        oscCellsPeriod2 += cellsP2;
        if (maxPeriod > 0) oscPeriodDetected = maxPeriod;
      }
    }

    const t = prev;
    prev = cur;
    cur = t;
  }

  const secs = measured / 30;
  const meanVelX = velXSamples.length
    ? velXSamples.reduce((a, b) => a + b, 0) / velXSamples.length
    : 0;

  let centerSpread = 0;
  if (calmCenters.length > 1) {
    let minC = Infinity;
    let maxC = -Infinity;
    for (const c of calmCenters) {
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
    }
    // For scrub advance we want absolute range of values seen.
    centerSpread = maxC - minC;
  }

  let textureCenterSpread = 0;
  if (textureCenters.length > 1) {
    let minC = Infinity;
    let maxC = -Infinity;
    for (const c of textureCenters) {
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
    }
    textureCenterSpread = maxC - minC;
  }

  // Per-slot sampleCenter spread: frozen-noise has many hues across sites, so
  // global max−min is large; stasis means each siteSlot's centre does not drift.
  let texturePerSlotCenterSpread = 0;
  let textureSlotsMulti = 0;
  for (const arr of textureCentersBySlot.values()) {
    if (arr.length < 2) continue;
    textureSlotsMulti++;
    let minC = Infinity;
    let maxC = -Infinity;
    for (const c of arr) {
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
    }
    const sp = maxC - minC;
    if (sp > texturePerSlotCenterSpread) texturePerSlotCenterSpread = sp;
  }

  let eventFlux = 0;
  if (eventFluxHists.length >= 2) {
    let sum = 0;
    for (let i = 1; i < eventFluxHists.length; i++) {
      const a = eventFluxHists[i - 1];
      const b = eventFluxHists[i];
      let d = (a.logQ - b.logQ) ** 2;
      for (let k = 0; k < 16; k++) {
        const diff = a.bins[k] - b.bins[k];
        d += diff * diff;
      }
      sum += Math.sqrt(d);
    }
    eventFlux = sum / (eventFluxHists.length - 1);
  }

  chaosDurs.sort((a, b) => a - b);
  const chaosDurP5 =
    chaosDurs.length > 0
      ? chaosDurs[Math.floor(0.05 * (chaosDurs.length - 1))]
      : 0;
  const chaosDurP95 =
    chaosDurs.length > 0
      ? chaosDurs[Math.floor(0.95 * (chaosDurs.length - 1))]
      : 0;
  const chaosDurSpread =
    chaosDurP5 > 1e-9 ? chaosDurP95 / chaosDurP5 : 0;

  return {
    id: pattern.id,
    calmPct: (100 * sumCalmFrac) / measured,
    chaosPct: (100 * sumChaosFrac) / measured,
    staticPct: (100 * sumStaticFrac) / measured,
    flowPct: (100 * sumFlowFrac) / measured,
    regions: sumRegions / measured,
    meanKappa: sumKappa / measured,
    calmEvPerSec: calmEvents / secs,
    chaosEvPerSec: chaosEvents / secs,
    textureEvPerSec: textureEvents / secs,
    oscEvPerSec: oscEvents / secs,
    flowEvPerSec: flowEvents / secs,
    maxPerStep,
    burstSteps,
    avgActive: sumActive / measured,
    calmAvgActive: sumCalmActive / measured,
    durMin: Number.isFinite(durMin) ? durMin : 0,
    durMax: Number.isFinite(durMax) ? durMax : 0,
    textureDurMin: Number.isFinite(textureDurMin) ? textureDurMin : 0,
    chaosDurP5,
    chaosDurP95,
    chaosDurSpread,
    meanVelX,
    finalRegionCount,
    distinctRegionIds: regionIdsSeen.size,
    oscCellsPeriod2: oscCellsPeriod2 / measured,
    oscPeriodDetected,
    oscBurstsPerSec: oscBurstSteps / secs,
    blinkerChaosEvPerSec: blinkerChaosEvents / secs,
    calmSampleCenterSpread: centerSpread,
    textureSampleCenterSpread: textureCenterSpread,
    texturePerSlotCenterSpread,
    textureSlotsMulti,
    eventFlux,
    measureWindowSec: secs,
    calmReverseDirCount,
  };
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

const failures = [];

function assert(stage, scenario, name, pass, expected, got) {
  if (STAGE < stage) return;
  if (!pass) {
    const msg = `ASSERT FAIL ${scenario} ${name}: expected ${expected} got ${got}`;
    failures.push(msg);
    console.error(msg);
  }
}

function assertIn(stage, scenario, name, value, lo, hi) {
  assert(
    stage,
    scenario,
    name,
    value >= lo && value <= hi,
    `[${lo}, ${hi}]`,
    value.toFixed(3),
  );
}

function assertGe(stage, scenario, name, value, lo) {
  assert(stage, scenario, name, value >= lo, `≥ ${lo}`, value.toFixed(3));
}

function assertLe(stage, scenario, name, value, hi) {
  assert(stage, scenario, name, value <= hi, `≤ ${hi}`, value.toFixed(3));
}

function assertEq(stage, scenario, name, value, expected) {
  assert(
    stage,
    scenario,
    name,
    value === expected,
    String(expected),
    String(value),
  );
}

// ---------------------------------------------------------------------------
// SVF bandpass — replica of grain-processor.js updateFilterCoeffs / bandpass.
// V4.3: bandwidth-compensated bpGain (not peak-unity k). Keep in sync by hand.
// ---------------------------------------------------------------------------
const FILT_FMIN_H = 80;
const FILT_FMAX_H = 12000;
const Q_REF_H = 2.0;
const FC_REF_H = Math.sqrt(FILT_FMIN_H * FILT_FMAX_H);
const SPECTRAL_TILT_COMP_H = 1.0;

function svfBpGain(q, fc) {
  return (
    (Math.sqrt(q / Q_REF_H) / q) *
    Math.pow(FC_REF_H / fc, 0.5 * SPECTRAL_TILT_COMP_H)
  );
}

/** Closed-form peak passband gain after bandwidth compensation (A1). */
function svfExpectedPeakGain(q, fc) {
  return (
    Math.sqrt(q / Q_REF_H) *
    Math.pow(FC_REF_H / fc, 0.5 * SPECTRAL_TILT_COMP_H)
  );
}

function svfGainAtCutoff(q, fc, fs) {
  const g = Math.tan((Math.PI * fc) / fs);
  const k = 1 / q;
  const a1 = 1 / (1 + g * (g + k));
  const a2 = g * a1;
  const a3 = g * a2;
  const bpGain = svfBpGain(q, fc);
  let ic1eq = 0;
  let ic2eq = 0;
  let peakIn = 0;
  let peakOut = 0;
  const nSamp = fs; // 1 s
  for (let i = 0; i < nSamp; i++) {
    const v0 = Math.sin((2 * Math.PI * fc * i) / fs);
    const v3 = v0 - ic2eq;
    const v1 = a1 * ic1eq + a2 * v3;
    const v2 = ic2eq + a2 * ic1eq + a3 * v3;
    ic1eq = 2 * v1 - ic1eq;
    ic2eq = 2 * v2 - ic2eq;
    // Bandwidth-compensated bandpass (V4.3 Phase 2): return v1 * bpGain.
    const out = v1 * bpGain;
    if (i > fs / 2) {
      peakIn = Math.max(peakIn, Math.abs(v0));
      peakOut = Math.max(peakOut, Math.abs(out));
    }
  }
  return peakOut / peakIn;
}

/** Broadband through-energy (white noise RMS in / RMS out) for Q balance. */
function svfBroadbandThroughRms(q, fc, fs) {
  const g = Math.tan((Math.PI * fc) / fs);
  const k = 1 / q;
  const a1 = 1 / (1 + g * (g + k));
  const a2 = g * a1;
  const a3 = g * a2;
  const bpGain = svfBpGain(q, fc);
  let ic1eq = 0;
  let ic2eq = 0;
  let eIn = 0;
  let eOut = 0;
  // Deterministic white: mulberry32(99)
  let a = 99 >>> 0;
  const nSamp = fs * 2;
  for (let i = 0; i < nSamp; i++) {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const v0 = ((t ^ (t >>> 14)) >>> 0) / 4294967296 * 2 - 1;
    const v3 = v0 - ic2eq;
    const v1 = a1 * ic1eq + a2 * v3;
    const v2 = ic2eq + a2 * ic1eq + a3 * v3;
    ic1eq = 2 * v1 - ic1eq;
    ic2eq = 2 * v2 - ic2eq;
    const out = v1 * bpGain;
    if (i > fs / 4) {
      eIn += v0 * v0;
      eOut += out * out;
    }
  }
  const n = nSamp - fs / 4;
  return Math.sqrt(eOut / n) / Math.sqrt(eIn / n);
}

console.log(
  `grid ${W}x${H}, ${STEPS_DEFAULT} steps @30/s (breathing ${STEPS_BREATHING}), measuring last ${(STEPS_DEFAULT - MEASURE_FROM_DEFAULT) / 30}s, stage ${STAGE}\n`,
);

/** @type {Map<string, ScenarioResult>} */
const results = new Map();

for (const pattern of TEST_PATTERNS) {
  const r = runScenario(pattern);
  results.set(pattern.id, r);

  const staticPart =
    r.staticPct > 0.05
      ? ` | static ${r.staticPct.toFixed(0)}%`
      : "";
  const flowPart =
    r.flowPct > 0.05
      ? ` | flow ${r.flowPct.toFixed(1)}%`
      : "";
  console.log(`--- ${pattern.id} (${pattern.label})`);
  console.log(
    `    seen: calm ${r.calmPct.toFixed(0)}% | chaos ${r.chaosPct.toFixed(0)}%${staticPart}${flowPart} | regions ${r.regions.toFixed(1)} | mean kappa ${r.meanKappa.toFixed(2)}`,
  );
  const texPart =
    r.textureEvPerSec > 0.01
      ? ` | texture ${r.textureEvPerSec.toFixed(1)} ev/s`
      : "";
  const oscPart =
    r.oscEvPerSec > 0.01
      ? ` | osc ${r.oscEvPerSec.toFixed(1)} ev/s`
      : "";
  console.log(
    `    audio: calm ${r.calmEvPerSec.toFixed(1)} ev/s | chaos ${r.chaosEvPerSec.toFixed(1)} ev/s${texPart}${oscPart} | max ${r.maxPerStep}/step | pulse-burst steps ${r.burstSteps} | avg active grains ${r.avgActive.toFixed(1)}`,
  );
  if (r.durMin > 0 || r.durMax > 0) {
    console.log(
      `    grain durations: ${r.durMin.toFixed(3)}s .. ${r.durMax.toFixed(3)}s`,
    );
  }
  if (r.chaosDurSpread > 0) {
    console.log(
      `    chaos duration spray: p5=${(r.chaosDurP5 * 1000).toFixed(1)}ms p95=${(r.chaosDurP95 * 1000).toFixed(1)}ms ratio=${r.chaosDurSpread.toFixed(2)}`,
    );
  }
  if (Math.abs(r.meanVelX) > 0.01) {
    console.log(
      `    largest region velX: ${r.meanVelX.toFixed(2)} cells/step`,
    );
  }
  if (r.oscCellsPeriod2 > 0 || r.oscPeriodDetected > 0) {
    console.log(
      `    oscillators: period ${r.oscPeriodDetected} | period-2 cells ${r.oscCellsPeriod2.toFixed(0)} | bursts/s ${r.oscBurstsPerSec.toFixed(1)}`,
    );
  }
  console.log("");
}

console.log(
  "--- per-grain bandpass loudness vs Q (sine at cutoff, 1 kHz, fs 48 kHz)",
);
const svfGains = {};
const svfThrough = {};
const FC_TEST = 1000;
const FS_TEST = 48000;
for (const q of [0.8, 2, 4, 8]) {
  const gain = svfGainAtCutoff(q, FC_TEST, FS_TEST);
  svfGains[q] = gain;
  const expected = svfExpectedPeakGain(q, FC_TEST);
  console.log(
    `    Q=${q}: passband gain x${gain.toFixed(4)} (expect x${expected.toFixed(4)}) (${(20 * Math.log10(Math.max(1e-9, gain))).toFixed(1)} dB)`,
  );
}
console.log("--- broadband through-energy vs Q (white, fc=1 kHz)");
for (const q of [0.8, 2, 4, 8]) {
  const thr = svfBroadbandThroughRms(q, FC_TEST, FS_TEST);
  svfThrough[q] = thr;
  console.log(
    `    Q=${q}: through-RMS ratio ${thr.toFixed(4)} (${(20 * Math.log10(Math.max(1e-9, thr))).toFixed(2)} dB)`,
  );
}
console.log("");

// Stage 1
{
  const r = results.get("uniform-calm");
  assertGe(1, "uniform-calm", "calm%", r.calmPct, 99);
  assertLe(1, "uniform-calm", "chaos ev/s", r.chaosEvPerSec, 0.01);
  // A2: calm ev/s = budget / DUR_MAX = 64 / 8.0 = 8.0; band [6,10]
  assertIn(1, "uniform-calm", "calm ev/s", r.calmEvPerSec, 6, 10);
  assertIn(1, "uniform-calm", "avg active", r.avgActive, 55, 64);
}
{
  const r = results.get("half-half");
  assertIn(1, "half-half", "calm%", r.calmPct, 45, 55);
}
{
  const r = results.get("moving-bar");
  assertIn(1, "moving-bar", "velX", r.meanVelX, 0.7, 1.1);
}
{
  const r = results.get("full-flicker");
  assertGe(1, "full-flicker", "chaos%", r.chaosPct, 99);
}
{
  const r = results.get("two-blobs-merge");
  assertEq(
    1,
    "two-blobs-merge",
    "final region count",
    r.finalRegionCount,
    1,
  );
  assertLe(
    1,
    "two-blobs-merge",
    "distinct region ids",
    r.distinctRegionIds,
    4,
  );
}
{
  const r = results.get("glider-swarm");
  assertGe(1, "glider-swarm", "calm%", r.calmPct, 85);
  // 3×3 travelling packs are flow (same-colour correspondence), not chaos.
  assertIn(
    1,
    "glider-swarm",
    "chaos+flow ev/s",
    r.chaosEvPerSec + r.flowEvPerSec,
    1,
    80,
  );
}

// Stage 3 — SVF bandwidth-compensated peak gain (A1) + broadband flatness
for (const q of [0.8, 2, 4, 8]) {
  const g = svfGains[q];
  const expected = svfExpectedPeakGain(q, FC_TEST);
  assertIn(
    3,
    "svf",
    `Q=${q} passband gain`,
    g,
    expected * 0.9,
    expected * 1.1,
  );
}
{
  const thrDbs = [0.8, 2, 4, 8].map((q) =>
    20 * Math.log10(Math.max(1e-12, svfThrough[q])),
  );
  const spread = Math.max(...thrDbs) - Math.min(...thrDbs);
  assertLe(3, "svf", "broadband through-energy Q spread ≤1.5dB", spread, 1.5);
}

// Stage 4
{
  const r = results.get("frozen-noise");
  // Texture = still cells with no body. Accidental κ-islands below minRegionArea
  // are silent residual, so textured% sits a bit under 100.
  assertGe(4, "frozen-noise", "static%", r.staticPct, 90);
  assertLe(4, "frozen-noise", "chaos ev/s", r.chaosEvPerSec, 1);
  // Hue-grouped texture: several colour voices share the bag; packing rate
  // rises because each group's area (and duration) is smaller than the bag.
  assertIn(4, "frozen-noise", "texture ev/s", r.textureEvPerSec, 8, 24);
  assertGe(4, "frozen-noise", "min texture grain duration", r.textureDurMin, 1.5);
  // Seat spend follows textured area (silent residual does not get seats).
  assertIn(4, "frozen-noise", "avg active", r.avgActive, 45, 64);
}
{
  const r = results.get("checkerboard-calm");
  // 1-cell greyscale checkerboard: same-value cells 8-connect on diagonals
  // → two interleaved Calm masses (not Texture leftover). Frozen-noise is
  // the Texture harness case.
  assertGe(4, "checkerboard-calm", "calm%", r.calmPct, 95);
  assertLe(4, "checkerboard-calm", "chaos ev/s", r.chaosEvPerSec, 1);
}
{
  const r = results.get("gradient-calm");
  assertLe(4, "gradient-calm", "chaos ev/s", r.chaosEvPerSec, 1);
  assertIn(4, "gradient-calm", "avg active", r.avgActive, 55, 64);
}
{
  const r = results.get("half-half");
  // Calm share ≈ 31; with κ≈1 desired ≈ share.
  // Calm holds ~half the seats; upper 34 allows a hair of variance when
  // chaos duration spray frees/holds shared budget seats unevenly.
  assertIn(3, "half-half", "calm avg active", r.calmAvgActive, 26, 34);
}

// Gate 4(iii) — event-domain Y/Q flux (audio Welch-mel is reported, not asserted)
{
  const fFlicker = results.get("full-flicker").eventFlux;
  for (const id of [
    "frozen-noise",
    "uniform-calm",
    "checkerboard-calm",
    "hue-drift",
  ]) {
    const f = results.get(id).eventFlux;
    assert(
      4,
      "eventFlux",
      `${id} ×2 ≤ full-flicker`,
      f * 2 <= fFlicker,
      `${id}*2 ≤ flicker`,
      `${id}=${f.toFixed(4)} flicker=${fFlicker.toFixed(4)}`,
    );
  }
}

// Gate 4(iv) — sampleCenter drift (event domain; V5 polar HSV)
{
  const r = results.get("frozen-noise");
  // δ=0 ⇒ HSV fixed per colour group. Stasis is per (group, siteSlot).
  assertGe(
    4,
    "frozen-noise",
    "texture slots with ≥2 hits (stasis sample)",
    r.textureSlotsMulti,
    8,
  );
  assertLe(
    4,
    "frozen-noise",
    "texture per-slot sampleCenter spread",
    r.texturePerSlotCenterSpread,
    0.005,
  );
}
{
  const r = results.get("hue-drift");
  // Saturated uniform hue walk moves polar angle → sampleCenter (absolute map).
  // Floor = ½ × hue-rate × stepsPerSec × windowSec (same geometric bound).
  const floor = 0.5 * 0.0006 * 30 * r.measureWindowSec;
  assertGe(
    4,
    "hue-drift",
    `calm sampleCenter spread ≥ ${floor.toFixed(4)} (½·0.0006·30·${r.measureWindowSec.toFixed(2)}s, V5 polar)`,
    r.calmSampleCenterSpread,
    floor,
  );
}

// Stage 5 — chaos rate from area share (CHAOS_EVENTS_MAX_HZ is CPU rail only).
// Ideal: share / DUR_MIN → full-flicker 64/0.03 ≈ 2133 Hz, half-half ≈33/0.03 ≈ 1100 Hz.
// Phase-4 measured turnover was lower; expected Phase-5 ≈ that × 5/3 (~1600 / ~806).
// Lower band 1200 is ~44% below the 2133 ideal — loose enough to hide a mild
// under-spend; avg active ∈ [55,64] is the direct concurrency guard.
{
  const r = results.get("half-half");
  assertIn(5, "half-half", "chaos ev/s", r.chaosEvPerSec, 550, 1100);
  assertLe(5, "half-half", "chaos rate below CPU rail", r.chaosEvPerSec, 4000);
}
{
  const r = results.get("full-flicker");
  assertIn(5, "full-flicker", "chaos ev/s", r.chaosEvPerSec, 1200, 2200);
  assertLe(5, "full-flicker", "chaos rate below CPU rail", r.chaosEvPerSec, 4000);
  assertIn(5, "full-flicker", "avg active", r.avgActive, 55, 64);
  // Spray around bag mean — not 64 copies of identical DUR_MIN.
  // CHAOS_DUR_SPREAD 1.7 → theoretical max ratio ~2.89; require clear spread.
  assertGe(5, "full-flicker", "chaos duration p95/p5", r.chaosDurSpread, 1.2);
}
{
  const r = results.get("chaos-blob-2pct");
  if (r) {
    // Share 1 at saturated δ → ~1 event per CA step (30/s), still discrete.
    assertIn(5, "chaos-blob-2pct", "chaos ev/s", r.chaosEvPerSec, 20, 40);
  }
}

// Stage 6
{
  const r = results.get("hue-drift");
  assertLe(6, "hue-drift", "pulse-burst steps", r.burstSteps, 1);
}
{
  const r = results.get("blinker-fast");
  assertGe(6, "blinker-fast", "oscillator cells period 2", r.oscCellsPeriod2, 1000);
  assertIn(6, "blinker-fast", "osc bursts/s", r.oscBurstsPerSec, 12, 18);
  assertLe(6, "blinker-fast", "blinker chaos ev/s", r.blinkerChaosEvPerSec, 2);
}
{
  const r = results.get("blinker-slow");
  assertEq(6, "blinker-slow", "oscillator period", r.oscPeriodDetected, 6);
  assertIn(6, "blinker-slow", "osc bursts/s", r.oscBurstsPerSec, 3.5, 6.5);
  assertLe(6, "blinker-slow", "blinker chaos ev/s", r.blinkerChaosEvPerSec, 2);
}

// Stage 7 (+ stage 8 reuses these)
{
  const r = results.get("breathing-uniform");
  assertGe(
    7,
    "breathing-uniform",
    "calm sampleCenter spread",
    r.calmSampleCenterSpread,
    0.005,
  );
}
{
  const r = results.get("uniform-calm");
  assertLe(
    7,
    "uniform-calm",
    "calm sampleCenter spread",
    r.calmSampleCenterSpread,
    0.001,
  );
}
{
  const r = results.get("bar-left");
  assertLe(7, "bar-left", "velX", r.meanVelX, -0.7);
  assertGe(
    7,
    "bar-left",
    "calm reverse direction events",
    r.calmReverseDirCount,
    1,
  );
}

if (STAGE > 0) {
  if (failures.length === 0) {
    console.log(`All stage ≤ ${STAGE} assertions passed.`);
  } else {
    console.error(`\n${failures.length} assertion(s) failed at stage ${STAGE}.`);
    process.exit(1);
  }
}
