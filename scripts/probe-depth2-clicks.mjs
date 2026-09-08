/**
 * Random Type-U depth-2 equations (same generator as the HUD dice)
 * through FieldObserver → GrainScheduler → grain-processor.
 *
 * Run: node scripts/probe-depth2-clicks.mjs
 */
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { loadWorkletClass, mulberry32 } from "./lib/offline-worklet.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { FieldObserver } = await import(
  pathToFileURL(join(root, "src/field/FieldObserver.ts")).href
);
const { GrainScheduler, MASTER_GAIN, FLOW_ID_BASE } = await import(
  pathToFileURL(join(root, "src/field/GrainScheduler.ts")).href
);
const { randomProgram, slotKinds, domainOf } = await import(
  pathToFileURL(join(root, "src/ca/typeU.ts")).href
);

const W = 128;
const H = 128;
const N = W * H;
const FS = 48000;
const BLOCK = 128;
const STEP_HZ = 30;
const STEP_MS = 1000 / STEP_HZ;
const BLOCKS_PER_STEP = Math.round(FS / STEP_HZ / BLOCK);
const STEPS = 180;
const WARM = 40;
const EQ_SEEDS = [11, 29, 47, 83, 101];
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
  if (bits !== 16) throw new Error(`unsupported bits ${bits}`);
  for (let i = 0; i < nFrames; i++) {
    const o = dataOffset + i * channels * 2;
    L[i] = view.getInt16(o, true) / 32768;
    R[i] = channels > 1 ? view.getInt16(o + 2, true) / 32768 : L[i];
  }
  return { L, R };
}

const OFF4 = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];
const OFF8DIAG = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];
const OFF24RING = [];
for (let dy = -2; dy <= 2; dy++) {
  for (let dx = -2; dx <= 2; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) === 2) OFF24RING.push([dx, dy]);
  }
}

function applyOp(op, a, b) {
  if (op === "add") return a + b;
  if (op === "sub") return a - b;
  if (op === "mlt") return a * b;
  return b === 0 ? 0 : a / b;
}

function buildNeigh(src) {
  const maps = {
    V: src,
    V4: makeField(),
    V8: makeField(),
    V24: makeField(),
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      for (const ch of ["r", "g", "b"]) {
        const plane = src[ch];
        let v4 = 0;
        for (const [dx, dy] of OFF4) {
          v4 += plane[wrap(y + dy, H) * W + wrap(x + dx, W)];
        }
        let v8d = 0;
        for (const [dx, dy] of OFF8DIAG) {
          v8d += plane[wrap(y + dy, H) * W + wrap(x + dx, W)];
        }
        let v24r = 0;
        for (const [dx, dy] of OFF24RING) {
          v24r += plane[wrap(y + dy, H) * W + wrap(x + dx, W)];
        }
        maps.V4[ch][i] = v4;
        maps.V8[ch][i] = v4 + v8d;
        maps.V24[ch][i] = v4 + v8d + v24r;
      }
    }
  }
  return maps;
}

function evalAxis(neigh, i, program, iRef) {
  const kinds = slotKinds(program.depth);
  const kind = kinds[iRef.i];
  if (kind === "Q") {
    const q = domainOf("Q", program.depth)[program.slots[iRef.i++]];
    const c = domainOf("C", program.depth)[program.slots[iRef.i++]];
    return neigh[q][c][i];
  }
  const op = domainOf("F", program.depth)[program.slots[iRef.i++]];
  const a = evalAxis(neigh, i, program, iRef);
  const b = evalAxis(neigh, i, program, iRef);
  return applyOp(op, a, b);
}

function stepTypeU(src, dst, program) {
  const neigh = buildNeigh(src);
  const mid = slotKinds(program.depth).length / 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const ox = evalAxis(neigh, i, program, { i: 0 });
      const oy = evalAxis(neigh, i, program, { i: mid });
      const sx = Number.isFinite(ox) ? wrap(x + Math.round(ox), W) : x;
      const sy = Number.isFinite(oy) ? wrap(y + Math.round(oy), H) : y;
      const si = sy * W + sx;
      dst.r[i] = src.r[si];
      dst.g[i] = src.g[si];
      dst.b[i] = src.b[si];
    }
  }
}

function send(proc, msg) {
  const handler = proc.port.onmessage;
  if (typeof handler === "function") handler({ data: msg });
}

function processBlock(proc) {
  proc.masterGain = 1;
  proc.masterGainTarget = 1;
  proc.normGain = 1;
  proc.preScale = 1;
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
    preMed += Math.hypot(pre.L[k] - pre.L[k - 1], pre.R[k] - pre.R[k - 1]);
  }
  preMed /= 31;
  return { dH, preMed, ratio: dH / Math.max(1e-9, preMed) };
}

function fmt(n, d = 2) {
  return Number.isFinite(n) ? n.toFixed(d) : String(n);
}

let srcL;
let srcR;
let srcName = "white";
try {
  const wav = loadWavPcm(join(root, "public/default-source.wav"));
  srcL = wav.L;
  srcR = wav.R;
  srcName = `default-source.wav (${wav.L.length} samples)`;
} catch (e) {
  const { makeWhite } = await import("./lib/offline-worklet.mjs");
  srcL = makeWhite(FS * 8, 11);
  srcR = srcL.slice();
  srcName = `fallback white (${e.message})`;
}

console.log(`Source: ${srcName}`);
console.log("CA: random Type-U depth 2 (HUD dice)\n");

function runEquation(program, fieldSeed) {
  const obs = new FieldObserver(W, H);
  const sched = new GrainScheduler();
  sched.setSourceDurationSec(srcL.length / FS);
  sched.setMaterialSegments(segs());

  let a = makeField();
  let b = makeField();
  fillRand(a, fieldSeed);
  quantize(a);

  const lastAnchors = new Map();
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
  let bigFollow = 0;
  const batches = [];

  for (let step = 1; step <= STEPS; step++) {
    stepTypeU(a, b, program);
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

    births += o.regionEvents?.births?.length ?? 0;
    deaths += o.regionEvents?.deaths?.length ?? 0;
    merges += o.regionEvents?.merges?.length ?? 0;
    releases += batch.releaseGrainIds?.length ?? 0;
    calmShareSum += batch.shares.calm;
    calmActiveSum += batch.calmActive;

    for (const r of o.coherent) {
      const prev = lastAnchors.get(`com:${r.id}`);
      if (prev) {
        const hop = Math.hypot(
          wrapDelta(r.comX, prev.x, W),
          wrapDelta(r.comY, prev.y, H),
        );
        if (hop > maxComHop) maxComHop = hop;
      }
      lastAnchors.set(`com:${r.id}`, { x: r.comX, y: r.comY });
    }
    for (const t of batch.tracks) {
      const prev = lastAnchors.get(`tr:${t.regionId}`);
      if (prev && t.regionId < FLOW_ID_BASE) {
        const hop = Math.hypot(
          wrapDelta(t.anchorX, prev.x, t.gridWidth),
          wrapDelta(t.anchorY, prev.y, t.gridHeight),
        );
        if (hop > maxCalmHop) maxCalmHop = hop;
        if (hop >= 8) bigFollow += 1;
      }
      lastAnchors.set(`tr:${t.regionId}`, { x: t.anchorX, y: t.anchorY });
    }

    const tmp = a;
    a = b;
    b = tmp;
  }

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
    for (let bi = 0; bi < BLOCKS_PER_STEP; bi++) {
      const blk = processBlock(proc);
      if (step >= WARM) {
        if (lastBlk && bi === 0) {
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
  const maxBound = boundaryScores.reduce((m, s) => Math.max(m, s.ratio), 0);

  return {
    equation: program.equation,
    x: program.x,
    y: program.y,
    idChurnSteps,
    births,
    deaths,
    merges,
    releases,
    meanCalmShare: calmShareSum / STEPS,
    meanCalmActive: calmActiveSum / STEPS,
    maxComHop,
    maxCalmHop,
    bigFollow,
    seconds: L.length / FS,
    sounding: soundingSum / Math.max(1, soundingN),
    clicks: hits.length,
    clicksPerSec: hits.length / Math.max(1e-6, L.length / FS),
    boundClicks: boundClicks.length,
    boundN: boundaryScores.length,
    maxRatio: maxBound,
    firstHits: hits.slice(0, 4),
  };
}

const results = [];
for (let i = 0; i < EQ_SEEDS.length; i++) {
  const rng = mulberry32(EQ_SEEDS[i]);
  const program = randomProgram(2, rng);
  console.log(`--- eq ${i + 1}/${EQ_SEEDS.length}  seed=${EQ_SEEDS[i]}  x=${program.x} y=${program.y}`);
  console.log(`    ${program.equation}`);
  const r = runEquation(program, EQ_SEEDS[i] * 17 + 3);
  results.push(r);
  console.log(
    `    field  churn=${r.idChurnSteps}  births=${r.births} deaths=${r.deaths} merges=${r.merges}  releases=${r.releases}`,
  );
  console.log(
    `    calm   share=${fmt(r.meanCalmShare, 1)} active=${fmt(r.meanCalmActive, 1)}  maxCOM=${fmt(r.maxComHop, 2)} maxFollow=${fmt(r.maxCalmHop, 2)} bigFollow≥8=${r.bigFollow}`,
  );
  console.log(
    `    audio  ${fmt(r.seconds, 2)}s sounding=${fmt(r.sounding, 1)}  clicks=${r.clicks} (${fmt(r.clicksPerSec, 2)}/s)  bound=${r.boundClicks}/${r.boundN} maxR=${fmt(r.maxRatio, 1)}`,
  );
  if (r.firstHits.length) {
    for (const h of r.firstHits) {
      console.log(
        `      t=${fmt(h.tMs, 0)}ms Δ=${h.d.toExponential(2)} ratio=${fmt(h.ratio, 1)} edge=${h.blockEdge}`,
      );
    }
  }
}

const clickSum = results.reduce((s, r) => s + r.clicks, 0);
const boundSum = results.reduce((s, r) => s + r.boundClicks, 0);
const maxR = results.reduce((m, r) => Math.max(m, r.maxRatio), 0);
console.log("\n=== Depth-2 random summary ===");
console.log(
  `  equations=${results.length}  totalClicks=${clickSum}  totalBound=${boundSum}  worstMaxR=${fmt(maxR, 1)}`,
);
console.log("Done.");
