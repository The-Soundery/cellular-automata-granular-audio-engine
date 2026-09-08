/**
 * Drive the seed Type-U CA in Node (same neighbour-copy law as Utomata),
 * render through FieldObserver → GrainScheduler → grain-processor, and
 * measure click / hop / reclaim stats — especially moving calm.
 *
 * Run: node scripts/probe-live-ca-clicks.mjs
 */
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import {
  loadWorkletClass,
  makeWhite,
  mulberry32,
} from "./lib/offline-worklet.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { FieldObserver } = await import(
  pathToFileURL(join(root, "src/field/FieldObserver.ts")).href
);
const { GrainScheduler, MASTER_GAIN, FLOW_ID_BASE } = await import(
  pathToFileURL(join(root, "src/field/GrainScheduler.ts")).href
);

const W = 128;
const H = 128;
const N = W * H;
const FS = 48000;
const BLOCK = 128;
const STEP_HZ = 30;
const STEP_MS = 1000 / STEP_HZ;
const BLOCKS_PER_STEP = Math.round(FS / STEP_HZ / BLOCK);
const STEPS = 240;
const WARM = 60;
const Processor = await loadWorkletClass(FS);

function wrap(i, n) {
  let x = i % n;
  if (x < 0) x += n;
  return x;
}

function wrapDelta(to, from, period) {
  let d = to - from;
  if (d > period * 0.5) d -= period;
  if (d < -period * 0.5) d += period;
  return d;
}

/** Seed Type-U: U(add(V.b,V8.b),sub(V4.b,V8.b)) — copy neighbour at that offset. */
function stepTypeU(src, dst) {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const b = src.b[i];
      // V4: N+S+W+E blues
      let v4b =
        src.b[wrap(y - 1, H) * W + x] +
        src.b[wrap(y + 1, H) * W + x] +
        src.b[y * W + wrap(x - 1, W)] +
        src.b[y * W + wrap(x + 1, W)];
      // V8: V4 + diagonals
      let v8b =
        v4b +
        src.b[wrap(y - 1, H) * W + wrap(x - 1, W)] +
        src.b[wrap(y - 1, H) * W + wrap(x + 1, W)] +
        src.b[wrap(y + 1, H) * W + wrap(x - 1, W)] +
        src.b[wrap(y + 1, H) * W + wrap(x + 1, W)];
      const ox = Math.round(b + v8b);
      const oy = Math.round(v4b - v8b);
      const sx = wrap(x + ox, W);
      const sy = wrap(y + oy, H);
      const si = sy * W + sx;
      dst.r[i] = src.r[si];
      dst.g[i] = src.g[si];
      dst.b[i] = src.b[si];
    }
  }
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

function fillRand(field, seed) {
  const rng = mulberry32(seed);
  for (let i = 0; i < N; i++) {
    field.r[i] = rng();
    field.g[i] = rng();
    field.b[i] = rng();
  }
}

function quantize(f) {
  for (let i = 0; i < N; i++) {
    f.r[i] = Math.round(f.r[i] * 255) / 255;
    f.g[i] = Math.round(f.g[i] * 255) / 255;
    f.b[i] = Math.round(f.b[i] * 255) / 255;
  }
}

function segs() {
  const out = [];
  for (let i = 0; i < 64; i++) {
    const t = i / 63;
    out.push({
      pos: t,
      centroidHz: 120 * Math.pow(50, t),
      stationarity: 0.2 + 0.6 * ((i % 5) / 4),
      energy: 1,
      angle: t,
      radius: 0.85,
      band: ((i * 7) % 64) / 63,
    });
  }
  return out;
}

function loadWavPcm(path) {
  const buf = readFileSync(path);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (view.getUint32(0, false) !== 0x52494646) throw new Error("not RIFF");
  let offset = 12;
  let channels = 1;
  let sampleRate = 44100;
  let bits = 16;
  let dataOffset = -1;
  let dataBytes = 0;
  while (offset + 8 <= buf.length) {
    const id = String.fromCharCode(
      buf[offset],
      buf[offset + 1],
      buf[offset + 2],
      buf[offset + 3],
    );
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt ") {
      channels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bits = view.getUint16(offset + 22, true);
    } else if (id === "data") {
      dataOffset = offset + 8;
      dataBytes = size;
      break;
    }
    offset += 8 + size + (size & 1);
  }
  if (dataOffset < 0) throw new Error("no data chunk");
  const nFrames = Math.floor(dataBytes / (channels * (bits / 8)));
  const L = new Float32Array(nFrames);
  const R = new Float32Array(nFrames);
  if (bits === 16) {
    for (let i = 0; i < nFrames; i++) {
      const o = dataOffset + i * channels * 2;
      const l = view.getInt16(o, true) / 32768;
      const r =
        channels > 1 ? view.getInt16(o + 2, true) / 32768 : l;
      L[i] = l;
      R[i] = r;
    }
  } else {
    throw new Error(`unsupported bits ${bits}`);
  }
  return { L, R, sampleRate };
}

function send(proc, msg) {
  const handler = proc.port.onmessage;
  if (typeof handler === "function") handler({ data: msg });
}

function processBlock(proc, freezeAgc = true) {
  if (freezeAgc) {
    proc.masterGain = 1;
    proc.masterGainTarget = 1;
    proc.normGain = 1;
    proc.preScale = 1;
  }
  const L = new Float32Array(BLOCK);
  const R = new Float32Array(BLOCK);
  proc.process([], [[L, R]]);
  return { L, R };
}

function firstDiff(L, R) {
  const d = new Float32Array(L.length);
  for (let i = 1; i < L.length; i++) {
    d[i] = Math.hypot(L[i] - L[i - 1], R[i] - R[i - 1]);
  }
  return d;
}

function median(arr) {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  const m = (a.length - 1) / 2;
  return (a[Math.floor(m)] + a[Math.ceil(m)]) * 0.5;
}

function findClicks(L, R, minAbs = 0.01, ratioTh = 7) {
  const d = firstDiff(L, R);
  const hits = [];
  const radius = 48;
  for (let i = radius + 8; i < d.length - radius; i++) {
    if (d[i] < minAbs) continue;
    const local = [];
    for (let k = i - radius; k < i - 6; k++) local.push(d[k]);
    for (let k = i + 6; k <= i + radius; k++) local.push(d[k]);
    const scale = median(local);
    const ratio = d[i] / Math.max(1e-9, scale);
    if (ratio >= ratioTh) {
      hits.push({ i, tMs: (i / FS) * 1000, d: d[i], ratio, blockEdge: i % BLOCK === 0 });
      i += 32;
    }
  }
  return hits;
}

function boundaryClickScore(pre, post) {
  const dH = Math.hypot(
    post.L[0] - pre.L[BLOCK - 1],
    post.R[0] - pre.R[BLOCK - 1],
  );
  let preMed = 0;
  for (let k = BLOCK - 32; k < BLOCK; k++) {
    preMed += Math.hypot(
      pre.L[k] - pre.L[k - 1],
      pre.R[k] - pre.R[k - 1],
    );
  }
  preMed /= 31;
  return { dH, preMed, ratio: dH / Math.max(1e-9, preMed) };
}

function fmt(n, d = 2) {
  return Number.isFinite(n) ? n.toFixed(d) : String(n);
}

// --- sources ---
const white = makeWhite(FS * 8, 11);
let srcL = white;
let srcR = white.slice();
let srcName = "white";
try {
  const wav = loadWavPcm(join(root, "public/default-source.wav"));
  // Resample is skipped — worklet plays at context rate; use as-is for click hunt.
  srcL = wav.L;
  srcR = wav.R;
  srcName = `default-source.wav (${wav.sampleRate} Hz, ${wav.L.length} samples)`;
} catch (e) {
  console.log(`(fallback white: ${e.message})`);
}

console.log(`Source: ${srcName}`);
console.log("CA: seed Type-U U(add(V.b,V8.b),sub(V4.b,V8.b))\n");

const obs = new FieldObserver(W, H);
const sched = new GrainScheduler();
sched.setSourceDurationSec(srcL.length / FS);
sched.setMaterialSegments(segs());

let a = makeField();
let b = makeField();
fillRand(a, 7);
quantize(a);

const lastAnchors = new Map();
const lastCom = new Map();
const calmHops = [];
const allBigHops = [];
const comHops = [];
let releases = 0;
let births = 0;
let deaths = 0;
let merges = 0;
let idChurnSteps = 0;
let lastIds = new Set();
let maxCalmHop = 0;
let maxComHop = 0;
let calmShareSum = 0;
let calmActiveSum = 0;

const batches = [];

for (let step = 1; step <= STEPS; step++) {
  stepTypeU(a, b);
  quantize(b);
  const o = obs.observe(b, a);
  const batch = sched.step(o, b, step * STEP_MS, srcL.length / FS);
  batches.push(batch);

  const ids = new Set(o.coherent.map((r) => r.id));
  let churn = 0;
  for (const id of lastIds) if (!ids.has(id)) churn++;
  for (const id of ids) if (!lastIds.has(id)) churn++;
  if (churn) idChurnSteps++;
  lastIds = ids;

  if (o.regionEvents) {
    births += o.regionEvents.births?.length ?? 0;
    deaths += o.regionEvents.deaths?.length ?? 0;
    merges += o.regionEvents.merges?.length ?? 0;
  }
  releases += batch.releaseGrainIds?.length ?? 0;
  calmShareSum += batch.shares.calm;
  calmActiveSum += batch.calmActive;

  for (const r of o.coherent) {
    const prev = lastCom.get(r.id);
    if (prev) {
      const hop = Math.hypot(
        wrapDelta(r.comX, prev.x, W),
        wrapDelta(r.comY, prev.y, H),
      );
      if (hop > maxComHop) maxComHop = hop;
      if (hop >= 8) {
        comHops.push({
          step,
          id: r.id,
          hop,
          dx: wrapDelta(r.comX, prev.x, W),
          dy: wrapDelta(r.comY, prev.y, H),
        });
      }
    }
    lastCom.set(r.id, { x: r.comX, y: r.comY });
  }

  for (const t of batch.tracks) {
    const prev = lastAnchors.get(t.regionId);
    if (prev) {
      const dx = wrapDelta(t.anchorX, prev.x, t.gridWidth);
      const dy = wrapDelta(t.anchorY, prev.y, t.gridHeight);
      const hop = Math.hypot(dx, dy);
      const kind = t.regionId >= FLOW_ID_BASE ? "flow" : "calm";
      if (kind === "calm" && hop > maxCalmHop) maxCalmHop = hop;
      if (hop >= 2) {
        const rec = {
          step,
          kind,
          id: t.regionId,
          hop,
          dx,
          dy,
          ax: t.anchorX,
          ay: t.anchorY,
        };
        if (kind === "calm") calmHops.push(rec);
        if (hop >= 8) allBigHops.push(rec);
      }
    }
    lastAnchors.set(t.regionId, { x: t.anchorX, y: t.anchorY });
  }

  const tmp = a;
  a = b;
  b = tmp;
}

calmHops.sort((x, y) => y.hop - x.hop);
allBigHops.sort((x, y) => y.hop - x.hop);

console.log("=== Live Type-U field observation ===");
console.log(
  `  steps=${STEPS}  idChurnSteps=${idChurnSteps}  births=${births} deaths=${deaths} merges=${merges}`,
);
console.log(
  `  releases=${releases}  meanCalmShare=${fmt(calmShareSum / STEPS, 1)}  meanCalmActive=${fmt(calmActiveSum / STEPS, 1)}`,
);
console.log(
  `  raw COM hops≥8=${comHops.length}  maxComHop=${fmt(maxComHop, 2)}`,
);
console.log(
  `  follow hops≥2=${calmHops.length}  maxFollowHop=${fmt(maxCalmHop, 2)}  bigFollow≥8=${allBigHops.length}`,
);
console.log("  top calm hops:");
for (const h of calmHops.slice(0, 10)) {
  console.log(
    `    step ${h.step} id=${h.id} hop=${fmt(h.hop, 2)} d=(${fmt(h.dx, 1)},${fmt(h.dy, 1)}) anchor=(${fmt(h.ax, 1)},${fmt(h.ay, 1)})`,
  );
}
console.log("  top big hops (any):");
for (const h of allBigHops.slice(0, 10)) {
  console.log(
    `    ${h.kind} step ${h.step} id=${h.id} hop=${fmt(h.hop, 2)} d=(${fmt(h.dx, 1)},${fmt(h.dy, 1)})`,
  );
}

// --- render audio ---
const proc = new Processor();
send(proc, {
  type: "source",
  sampleRate: FS,
  length: srcL.length,
  pcmL: srcL,
  pcmR: srcR,
});
proc.masterGain = 1;
proc.masterGainTarget = 1;
proc.normGain = 1;
proc.preScale = 1;

const measureL = [];
const measureR = [];
const boundaryScores = [];
let lastBlk = null;
let soundingSum = 0;
let soundingN = 0;

for (let step = 0; step < STEPS; step++) {
  const batch = batches[step];
  send(proc, {
    type: "events",
    masterGain: MASTER_GAIN,
    events: batch.events,
    tracks: batch.tracks,
    releaseGrainIds: batch.releaseGrainIds ?? [],
  });
  for (let b = 0; b < BLOCKS_PER_STEP; b++) {
    const blk = processBlock(proc, true);
    if (step >= WARM) {
      if (lastBlk && b === 0) {
        boundaryScores.push(boundaryClickScore(lastBlk, blk));
      }
      measureL.push(blk.L);
      measureR.push(blk.R);
      let s = 0;
      for (const v of proc.voices) if (v.sounding) s++;
      soundingSum += s;
      soundingN++;
    }
    lastBlk = blk;
  }
}

const L = new Float32Array(measureL.length * BLOCK);
const R = new Float32Array(measureR.length * BLOCK);
for (let i = 0; i < measureL.length; i++) {
  L.set(measureL[i], i * BLOCK);
  R.set(measureR[i], i * BLOCK);
}

const hits = findClicks(L, R);
const boundClicks = boundaryScores.filter((s) => s.ratio >= 8);
const maxBound = boundaryScores.reduce(
  (m, s) => Math.max(m, s.ratio),
  0,
);

console.log("\n=== Rendered audio (Type-U → worklet) ===");
console.log(
  `  seconds=${fmt(L.length / FS, 2)}  sounding=${fmt(soundingSum / Math.max(1, soundingN), 1)}`,
);
console.log(
  `  outlier clicks=${hits.length} (${fmt(hits.length / (L.length / FS), 2)}/s)  blockEdge=${hits.filter((h) => h.blockEdge).length}`,
);
console.log(
  `  CA-boundary clicks (ratio≥8)=${boundClicks.length}/${boundaryScores.length}  maxRatio=${fmt(maxBound, 1)}`,
);
if (hits.length) {
  console.log("  first outlier clicks:");
  for (const h of hits.slice(0, 8)) {
    console.log(
      `    t=${fmt(h.tMs, 0)}ms  Δ=${h.d.toExponential(2)}  ratio=${fmt(h.ratio, 1)}  blockEdge=${h.blockEdge}`,
    );
  }
}

// Ablation: freeze follow on calm tracks only
function wrapApplyTracks(proc, mode) {
  const orig = proc.applyTracks.bind(proc);
  proc.applyTracks = (tracks) => {
    if (mode === "no-calm-follow") {
      const snap = proc.voices.map((v) => ({
        pan: v.pan,
        yNorm: v.yNorm,
        channelMix: v.channelMix,
        x: v.x,
        y: v.y,
        gainL: v.gainL,
        gainR: v.gainR,
        fcNorm: v.fcNorm,
        panTarget: v.panTarget,
        yNormTarget: v.yNormTarget,
        mixTarget: v.mixTarget,
        rampN: v.rampN,
      }));
      orig(tracks);
      for (let i = 0; i < proc.voices.length; i++) {
        const v = proc.voices[i];
        const s = snap[i];
        if (!v.active || v.regime !== "calm") continue;
        v.pan = s.pan;
        v.yNorm = s.yNorm;
        v.channelMix = s.channelMix;
        v.x = s.x;
        v.y = s.y;
        v.gainL = s.gainL;
        v.gainR = s.gainR;
        v.fcNorm = s.fcNorm;
        v.panTarget = s.panTarget;
        v.yNormTarget = s.yNormTarget;
        v.mixTarget = s.mixTarget;
        v.rampN = 0;
      }
    } else {
      orig(tracks);
    }
  };
}

function replay(mode) {
  const p = new Processor();
  send(p, {
    type: "source",
    sampleRate: FS,
    length: srcL.length,
    pcmL: srcL.slice(),
    pcmR: srcR.slice(),
  });
  p.masterGain = 1;
  p.masterGainTarget = 1;
  p.normGain = 1;
  p.preScale = 1;
  if (mode) wrapApplyTracks(p, mode);
  const outL = [];
  const outR = [];
  const scores = [];
  let prev = null;
  for (let step = 0; step < STEPS; step++) {
    const batch = batches[step];
    send(p, {
      type: "events",
      masterGain: MASTER_GAIN,
      events: batch.events,
      tracks: batch.tracks,
      releaseGrainIds: batch.releaseGrainIds ?? [],
    });
    for (let b = 0; b < BLOCKS_PER_STEP; b++) {
      const blk = processBlock(p, true);
      if (step >= WARM) {
        if (prev && b === 0) scores.push(boundaryClickScore(prev, blk));
        outL.push(blk.L);
        outR.push(blk.R);
      }
      prev = blk;
    }
  }
  const LL = new Float32Array(outL.length * BLOCK);
  const RR = new Float32Array(outR.length * BLOCK);
  for (let i = 0; i < outL.length; i++) {
    LL.set(outL[i], i * BLOCK);
    RR.set(outR[i], i * BLOCK);
  }
  const h = findClicks(LL, RR);
  const bc = scores.filter((s) => s.ratio >= 8).length;
  const maxR = scores.reduce((m, s) => Math.max(m, s.ratio), 0);
  return { clicks: h.length, perSec: h.length / (LL.length / FS), boundClicks: bc, maxR };
}

console.log("\n=== Ablation ===");
const full = replay(null);
const frozen = replay("no-calm-follow");
console.log(
  `  full follow:     clicks=${full.clicks} (${fmt(full.perSec, 2)}/s)  bound=${full.boundClicks} maxR=${fmt(full.maxR, 1)}`,
);
console.log(
  `  freeze calm:     clicks=${frozen.clicks} (${fmt(frozen.perSec, 2)}/s)  bound=${frozen.boundClicks} maxR=${fmt(frozen.maxR, 1)}`,
);

console.log("\nDone.");
