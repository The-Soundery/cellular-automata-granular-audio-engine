/**
 * Type-U see↔hear survey (kept after the coupling pass).
 *
 * 4 random depth-1 + 4 random depth-2 programs (HUD dice). Each run advances
 * until the field settles into structures, then measures the see↔hear gap
 * on the settle window.
 *
 * Run: node scripts/probe-typeu-see-hear.mjs
 */
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { writeFileSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { FieldObserver } = await import(
  pathToFileURL(join(root, "src/field/FieldObserver.ts")).href
);
const { GrainScheduler, FLOW_ID_BASE, TEXTURE_ID_BASE, OSC_ID_BASE } =
  await import(pathToFileURL(join(root, "src/field/GrainScheduler.ts")).href);
const { randomProgram, slotKinds, domainOf } = await import(
  pathToFileURL(join(root, "src/ca/typeU.ts")).href
);

const W = 128;
const H = 128;
const N = W * H;
const STEP_MS = 1000 / 30;
const MIN_WARM = 120;
const SETTLE_WIN = 60;
const MEASURE_WIN = 90;
const MAX_STEPS = 600;
/** Per-depth program seeds (reproducible “4 random of each”). */
const DEPTH1_SEEDS = [11, 29, 47, 83];
const DEPTH2_SEEDS = [101, 137, 173, 211];
const FIELD_SEED = 0xc0ffee;

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function wrap(i, n) {
  let x = i % n;
  if (x < 0) x += n;
  return x;
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

function makeTestMaterialSegments(n = 64) {
  const segs = [];
  const denom = Math.max(1, n - 1);
  const half = 0.5 / denom;
  for (let i = 0; i < n; i++) {
    const t = i / denom;
    segs.push({
      pos: t,
      startPos: Math.max(0, t - half),
      endPos: Math.min(1, t + half),
      centroidHz: 120 * Math.pow(50, t),
      stationarity: 0.15 + 0.7 * ((i % 5) / 4),
      energy: 1,
      angle: t,
      radius: 0.85,
      band: ((i * 7) % n) / denom,
    });
  }
  return segs;
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

function std(xs) {
  if (xs.length < 2) return 0;
  let m = 0;
  for (const x of xs) m += x;
  m /= xs.length;
  let v = 0;
  for (const x of xs) v += (x - m) * (x - m);
  return Math.sqrt(v / (xs.length - 1));
}

function mean(xs) {
  if (!xs.length) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function emptyStepSnap() {
  return {
    calm: 0,
    chaos: 0,
    flow: 0,
    texture: 0,
    meanDelta: 0,
    calmRegions: 0,
    flowGroups: 0,
    oscGroups: 0,
    oscPeriods: 0,
    textureIslands: 0,
    chaosClusters: 0,
    births: 0,
    deaths: 0,
    merges: 0,
    birthAudible: 0,
    silentCalm: 0,
    silentFlow: 0,
    silentFlowPulsed: 0,
    seatedFlow: 0,
    silentTexture: 0,
    silentOsc: 0,
    motionNoTrack: 0,
    tracks: 0,
    events: 0,
    reverseDir: 0,
    meanQ: 0,
    qN: 0,
    movingCalm: 0,
    movingFlow: 0,
    meanCalmVel: 0,
    meanFlowVel: 0,
    meanCalmHeight: 0,
    meanCalmFill: 0,
    calmHeightN: 0,
    idChurn: 0,
  };
}

function snapStep(o, batch, lastIds) {
  const s = emptyStepSnap();
  s.calm = o.calmAreaFraction;
  s.chaos = o.chaosAreaFraction;
  s.flow = o.flowAreaFraction;
  s.texture = o.texturedAreaFraction;
  s.meanDelta = o.meanDelta;
  s.calmRegions = o.coherent.length;
  s.flowGroups = o.flows?.length ?? 0;
  s.oscGroups = o.oscillators?.length ?? 0;
  const periods = new Set((o.oscillators ?? []).map((g) => g.period));
  s.oscPeriods = periods.size;
  s.textureIslands = o.texturedGroups?.length ?? 0;
  s.chaosClusters = (o.chaotic.clusters ?? []).filter((c) => c.compact).length;

  const ids = new Set(o.coherent.map((r) => r.id));
  let churn = 0;
  for (const id of lastIds) if (!ids.has(id)) churn++;
  for (const id of ids) if (!lastIds.has(id)) churn++;
  s.idChurn = churn;

  const seatMap = new Map();
  for (const seat of batch.regionSeats ?? []) seatMap.set(seat.id, seat);

  for (const r of o.coherent) {
    const seat = seatMap.get(r.id);
    if ((seat?.share ?? 0) > 0 && (seat?.active ?? 0) === 0) s.silentCalm++;
    const spd = Math.hypot(r.velX, r.velY);
    if (spd >= 0.4) {
      s.movingCalm++;
      s.meanCalmVel += spd;
    }
    s.meanCalmHeight += r.height;
    s.meanCalmFill += r.fillRatio ?? 1;
    s.calmHeightN++;
  }
  for (const f of o.flows ?? []) {
    const seat = seatMap.get(FLOW_ID_BASE + f.id);
    if ((seat?.share ?? 0) > 0) {
      s.seatedFlow++;
      if ((seat?.active ?? 0) === 0) {
        s.silentFlow++;
        if ((f.period ?? 0) >= 2) s.silentFlowPulsed++;
      }
    }
    const spd = Math.hypot(f.velX, f.velY);
    if (spd >= 0.4) {
      s.movingFlow++;
      s.meanFlowVel += spd;
    }
  }
  for (const g of o.texturedGroups ?? []) {
    const seat = seatMap.get(TEXTURE_ID_BASE + g.id);
    if ((seat?.share ?? 0) > 0 && (seat?.active ?? 0) === 0) s.silentTexture++;
  }
  for (const g of o.oscillators ?? []) {
    const seat = seatMap.get(OSC_ID_BASE + g.id);
    if ((seat?.share ?? 0) > 0 && (seat?.active ?? 0) === 0) s.silentOsc++;
  }

  const ev = o.regionEvents;
  if (ev) {
    s.births = ev.births.length;
    s.deaths = ev.deaths.length;
    s.merges = ev.merges.length;
    for (const id of ev.births) {
      if (batch.events.some((e) => e.regime === "calm" && e.regionId === id)) {
        s.birthAudible++;
      }
    }
  }

  const trackIds = new Set((batch.tracks ?? []).map((t) => t.regionId));
  s.tracks = trackIds.size;
  for (const r of o.coherent) {
    if (Math.hypot(r.velX, r.velY) >= 0.4 && !trackIds.has(r.id)) {
      s.motionNoTrack++;
    }
  }
  for (const f of o.flows ?? []) {
    if (
      Math.hypot(f.velX, f.velY) >= 0.4 &&
      !trackIds.has(FLOW_ID_BASE + f.id)
    ) {
      s.motionNoTrack++;
    }
  }

  for (const e of batch.events) {
    s.events++;
    if (e.direction === -1) s.reverseDir++;
    s.meanQ += e.q;
    s.qN++;
  }

  return { snap: s, ids };
}

function isSettled(windowSnaps) {
  if (windowSnaps.length < SETTLE_WIN) return false;
  const calm = windowSnaps.map((s) => s.calm);
  const chaos = windowSnaps.map((s) => s.chaos);
  const flow = windowSnaps.map((s) => s.flow);
  const churn = windowSnaps.map((s) => s.idChurn);
  const delta = windowSnaps.map((s) => s.meanDelta);
  // Structures held: regime mix stable + low id churn, or very quiet δ.
  const regimeStable =
    std(calm) < 0.06 && std(chaos) < 0.08 && std(flow) < 0.05;
  const lowChurn = mean(churn) < 2.5;
  const quiet = mean(delta) < 0.04 && std(delta) < 0.02;
  // Persistent structures present (not empty / not pure scrub).
  const hasBody =
    mean(windowSnaps.map((s) => s.calmRegions + s.flowGroups)) >= 1 ||
    mean(windowSnaps.map((s) => s.textureIslands + s.oscGroups)) >= 1;
  return hasBody && ((regimeStable && lowChurn) || quiet);
}

function summarise(snaps, meta) {
  const n = Math.max(1, snaps.length);
  const sum = (key) => snaps.reduce((a, s) => a + s[key], 0);
  const avg = (key) => sum(key) / n;
  const births = sum("births");
  const heightN = sum("calmHeightN");
  const movingCalm = sum("movingCalm");
  const movingFlow = sum("movingFlow");
  return {
    ...meta,
    measureSteps: n,
    calmPct: avg("calm"),
    chaosPct: avg("chaos"),
    flowPct: avg("flow"),
    texturePct: avg("texture"),
    meanDelta: avg("meanDelta"),
    calmRegions: avg("calmRegions"),
    flowGroups: avg("flowGroups"),
    oscGroups: avg("oscGroups"),
    oscPeriods: avg("oscPeriods"),
    textureIslands: avg("textureIslands"),
    chaosClusters: avg("chaosClusters"),
    silentCalm: avg("silentCalm"),
    silentFlow: avg("silentFlow"),
    silentFlowPulsed: avg("silentFlowPulsed"),
    seatedFlow: avg("seatedFlow"),
    silentTexture: avg("silentTexture"),
    silentOsc: avg("silentOsc"),
    births,
    deaths: sum("deaths"),
    merges: sum("merges"),
    birthAudibleFrac: births ? sum("birthAudible") / births : 0,
    motionNoTrack: avg("motionNoTrack"),
    tracks: avg("tracks"),
    eventsPerStep: avg("events"),
    reverseDir: avg("reverseDir"),
    meanQ: sum("qN") ? sum("meanQ") / sum("qN") : 0,
    movingCalm: avg("movingCalm"),
    movingFlow: avg("movingFlow"),
    meanCalmVel: movingCalm ? sum("meanCalmVel") / movingCalm : 0,
    meanFlowVel: movingFlow ? sum("meanFlowVel") / movingFlow : 0,
    meanCalmHeight: heightN ? sum("meanCalmHeight") / heightN : 0,
    meanCalmFill: heightN ? sum("meanCalmFill") / heightN : 0,
    idChurn: avg("idChurn"),
  };
}

function runProgram(depth, eqSeed) {
  const program = randomProgram(depth, mulberry32(eqSeed));
  const obs = new FieldObserver(W, H);
  const sched = new GrainScheduler();
  sched.setSourceDurationSec(30);
  sched.setMaterialSegments(makeTestMaterialSegments(64));

  let a = makeField();
  let b = makeField();
  fillRand(a, FIELD_SEED ^ (eqSeed * 997));
  quantize(a);

  const history = [];
  let lastIds = new Set();
  let settledAt = -1;

  for (let step = 1; step <= MAX_STEPS; step++) {
    stepTypeU(a, b, program);
    quantize(b);
    const o = obs.observe(b, a);
    const batch = sched.step(o, b, step * STEP_MS);
    const { snap, ids } = snapStep(o, batch, lastIds);
    lastIds = ids;
    history.push(snap);
    const tmp = a;
    a = b;
    b = tmp;

    if (step >= MIN_WARM + SETTLE_WIN && settledAt < 0) {
      const win = history.slice(history.length - SETTLE_WIN);
      if (isSettled(win)) settledAt = step;
    }
    if (settledAt > 0 && step >= settledAt + MEASURE_WIN) break;
  }

  const settled = settledAt > 0;
  const end = history.length;
  const start = Math.max(0, end - MEASURE_WIN);
  const measure = history.slice(start);
  const report = summarise(measure, {
    depth,
    eqSeed,
    equation: program.equation,
    x: program.x,
    y: program.y,
    settled,
    settledAt: settled ? settledAt : null,
    totalSteps: end,
  });
  return report;
}

function printReport(r) {
  const settle = r.settled
    ? `settled @ step ${r.settledAt}`
    : `never settled (last ${r.measureSteps} of ${r.totalSteps})`;
  console.log(`\n=== depth ${r.depth} seed ${r.eqSeed} — ${settle} ===`);
  console.log(`  ${r.equation}`);
  console.log(
    `  mix calm ${(r.calmPct * 100).toFixed(0)}% chaos ${(r.chaosPct * 100).toFixed(0)}% flow ${(r.flowPct * 100).toFixed(0)}% tex ${(r.texturePct * 100).toFixed(0)}% | δ̄ ${r.meanDelta.toFixed(3)} | churn ${r.idChurn.toFixed(2)}`,
  );
  console.log(
    `  objects calm ${r.calmRegions.toFixed(1)} flow ${r.flowGroups.toFixed(1)} osc ${r.oscGroups.toFixed(1)}/${r.oscPeriods.toFixed(1)}p tex ${r.textureIslands.toFixed(1)} chaosCl ${r.chaosClusters.toFixed(1)}`,
  );
  console.log(
    `  silent/step calm ${r.silentCalm.toFixed(2)} flow ${r.silentFlow.toFixed(2)} (pulsed ${r.silentFlowPulsed.toFixed(2)} / seated ${r.seatedFlow.toFixed(2)}) tex ${r.silentTexture.toFixed(2)} osc ${r.silentOsc.toFixed(2)}`,
  );
  console.log(
    `  lifecycle births ${r.births} (audible ${(r.birthAudibleFrac * 100).toFixed(0)}%) deaths ${r.deaths} merges ${r.merges}`,
  );
  console.log(
    `  motion calm ${r.movingCalm.toFixed(2)}@${r.meanCalmVel.toFixed(2)} flow ${r.movingFlow.toFixed(2)}@${r.meanFlowVel.toFixed(2)} | no-track ${r.motionNoTrack.toFixed(3)} | reverseDir ${r.reverseDir.toFixed(2)}`,
  );
  console.log(
    `  shape height ${r.meanCalmHeight.toFixed(1)} fill ${r.meanCalmFill.toFixed(2)} | events/step ${r.eventsPerStep.toFixed(1)} meanQ ${r.meanQ.toFixed(2)} tracks ${r.tracks.toFixed(1)}`,
  );
}

function avgKey(rows, key) {
  return mean(rows.map((r) => r[key]));
}

function printDepthSummary(depth, rows) {
  if (rows.length === 0) return;
  console.log(`\n-------- depth ${depth} summary (n=${rows.length}) --------`);
  const settled = rows.filter((r) => r.settled).length;
  console.log(`  settled ${settled}/${rows.length}`);
  console.log(
    `  avg mix calm ${(avgKey(rows, "calmPct") * 100).toFixed(0)}% chaos ${(avgKey(rows, "chaosPct") * 100).toFixed(0)}% flow ${(avgKey(rows, "flowPct") * 100).toFixed(0)}% tex ${(avgKey(rows, "texturePct") * 100).toFixed(0)}%`,
  );
  console.log(
    `  avg objects calm ${avgKey(rows, "calmRegions").toFixed(1)} flow ${avgKey(rows, "flowGroups").toFixed(1)} osc ${avgKey(rows, "oscGroups").toFixed(1)} (periods ${avgKey(rows, "oscPeriods").toFixed(1)}) tex ${avgKey(rows, "textureIslands").toFixed(1)}`,
  );
  console.log(
    `  avg silent calm ${avgKey(rows, "silentCalm").toFixed(2)} flow ${avgKey(rows, "silentFlow").toFixed(2)} tex ${avgKey(rows, "silentTexture").toFixed(2)} osc ${avgKey(rows, "silentOsc").toFixed(2)}`,
  );
  console.log(
    `  avg birth audible ${(avgKey(rows, "birthAudibleFrac") * 100).toFixed(0)}% | moving calm ${avgKey(rows, "movingCalm").toFixed(2)} flow ${avgKey(rows, "movingFlow").toFixed(2)} | reverseDir ${avgKey(rows, "reverseDir").toFixed(2)}`,
  );
  console.log(
    `  avg calm height ${avgKey(rows, "meanCalmHeight").toFixed(1)} fill ${avgKey(rows, "meanCalmFill").toFixed(2)} | oscGroups/periods ratio ${(avgKey(rows, "oscGroups") / Math.max(0.01, avgKey(rows, "oscPeriods"))).toFixed(2)}`,
  );
}

console.log(
  "Type-U see↔hear survey — 4 random depth-1 + 4 random depth-2, settle then measure\n",
);

const seedArg = process.argv.indexOf("--seed");
const onlySeed =
  seedArg >= 0 ? Number(process.argv[seedArg + 1]) : null;
const depthArg = process.argv.indexOf("--depth");
const onlyDepth =
  depthArg >= 0 ? Number(process.argv[depthArg + 1]) : null;

const all = [];
if (onlyDepth !== 2) {
  for (const seed of DEPTH1_SEEDS) {
    if (onlySeed != null && seed !== onlySeed) continue;
    const r = runProgram(1, seed);
    all.push(r);
    printReport(r);
  }
}
if (onlyDepth !== 1) {
  for (const seed of DEPTH2_SEEDS) {
    if (onlySeed != null && seed !== onlySeed) continue;
    const r = runProgram(2, seed);
    all.push(r);
    printReport(r);
  }
}

printDepthSummary(
  1,
  all.filter((r) => r.depth === 1),
);
printDepthSummary(
  2,
  all.filter((r) => r.depth === 2),
);

const outPath = join(root, "scripts/probe-typeu-see-hear-report.json");
writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), runs: all }, null, 2));
console.log(`\nWrote ${outPath}`);
console.log("Done.");
