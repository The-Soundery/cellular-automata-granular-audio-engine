/**
 * See↔hear gap probe (kept after the coupling pass).
 *
 * Dumps per-scenario / live Type-U stats that quantify where visual structure
 * and motion diverge from grain events:
 *   - silent structures (share > 0, active == 0)
 *   - osc spatial groups vs distinct periods
 *   - texture island count
 *   - lifecycle events vs audio consequence that step
 *   - regimes with visible motion but no RegionTrack
 *
 * Run: node scripts/probe-see-hear.mjs
 */
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { FieldObserver } = await import(
  pathToFileURL(join(root, "src/field/FieldObserver.ts")).href
);
const { GrainScheduler, FLOW_ID_BASE, TEXTURE_ID_BASE, OSC_ID_BASE } =
  await import(pathToFileURL(join(root, "src/field/GrainScheduler.ts")).href);
const { TEST_PATTERNS } = await import(
  pathToFileURL(join(root, "src/field/TestPatterns.ts")).href
);

const W = 128;
const H = 128;
const N = W * H;
const STEP_MS = 1000 / 30;

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

function wrap(i, n) {
  let x = i % n;
  if (x < 0) x += n;
  return x;
}

/** Seed Type-U neighbour-copy (same law as probe-live-ca-clicks). */
function stepTypeU(src, dst) {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const b = src.b[i];
      let v4b =
        src.b[wrap(y - 1, H) * W + x] +
        src.b[wrap(y + 1, H) * W + x] +
        src.b[y * W + wrap(x - 1, W)] +
        src.b[y * W + wrap(x + 1, W)];
      let v8b =
        v4b +
        src.b[wrap(y - 1, H) * W + wrap(x - 1, W)] +
        src.b[wrap(y - 1, H) * W + wrap(x + 1, W)] +
        src.b[wrap(y + 1, H) * W + wrap(x - 1, W)] +
        src.b[wrap(y + 1, H) * W + wrap(x + 1, W)];
      const ox = Math.round(b + v8b);
      const oy = Math.round(v4b - v8b);
      const si = wrap(y + oy, H) * W + wrap(x + ox, W);
      dst.r[i] = src.r[si];
      dst.g[i] = src.g[si];
      dst.b[i] = src.b[si];
    }
  }
}

function fillRand(field, seed) {
  let s = seed >>> 0;
  const rand = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  for (let i = 0; i < N; i++) {
    field.r[i] = rand();
    field.g[i] = rand();
    field.b[i] = rand();
  }
}

function emptyAcc() {
  return {
    steps: 0,
    silentCalm: 0,
    silentFlow: 0,
    silentTexture: 0,
    silentOsc: 0,
    oscGroups: 0,
    oscPeriods: 0,
    textureGroups: 0,
    births: 0,
    deaths: 0,
    merges: 0,
    birthWithGrain: 0,
    deathSteps: 0,
    motionNoTrack: 0,
    tracks: 0,
    events: 0,
    qMean: 0,
    qN: 0,
    reverseDir: 0,
    oscHeightSum: 0,
    oscHeightN: 0,
  };
}

function probeRun(label, fillStep, steps = 240, warm = 60) {
  const obs = new FieldObserver(W, H);
  const sched = new GrainScheduler();
  sched.setSourceDurationSec(30);
  sched.setMaterialSegments(makeTestMaterialSegments(64));

  let prev = makeField();
  let cur = makeField();
  fillStep(prev, 0);
  quantize(prev);

  const acc = emptyAcc();
  const periodSet = new Set();

  for (let step = 1; step <= steps; step++) {
    fillStep(cur, step);
    quantize(cur);
    const o = obs.observe(cur, prev);
    const batch = sched.step(o, cur, step * STEP_MS);
    const tmp = prev;
    prev = cur;
    cur = tmp;

    if (step < warm) continue;
    acc.steps += 1;

    const seatMap = new Map();
    for (const s of batch.regionSeats ?? []) {
      seatMap.set(s.id, s);
    }

    for (const r of o.coherent) {
      const seat = seatMap.get(r.id);
      if ((seat?.share ?? 0) > 0 && (seat?.active ?? 0) === 0) {
        acc.silentCalm += 1;
      }
    }
    for (const f of o.flows ?? []) {
      const seat = seatMap.get(FLOW_ID_BASE + f.id);
      if ((seat?.share ?? 0) > 0 && (seat?.active ?? 0) === 0) {
        acc.silentFlow += 1;
      }
    }
    for (const g of o.texturedGroups ?? []) {
      const seat = seatMap.get(TEXTURE_ID_BASE + g.id);
      if ((seat?.share ?? 0) > 0 && (seat?.active ?? 0) === 0) {
        acc.silentTexture += 1;
      }
    }
    for (const g of o.oscillators ?? []) {
      const seat = seatMap.get(OSC_ID_BASE + g.id);
      if ((seat?.share ?? 0) > 0 && (seat?.active ?? 0) === 0) {
        acc.silentOsc += 1;
      }
      acc.oscHeightSum += g.height ?? 1;
      acc.oscHeightN += 1;
    }

    for (const e of batch.events) {
      acc.events += 1;
      if (e.direction === -1) acc.reverseDir += 1;
      acc.qMean += e.q;
      acc.qN += 1;
    }

    acc.oscGroups += o.oscillators?.length ?? 0;
    for (const g of o.oscillators ?? []) periodSet.add(g.period);
    acc.textureGroups += o.texturedGroups?.length ?? 0;

    const ev = o.regionEvents;
    if (ev) {
      acc.births += ev.births.length;
      acc.deaths += ev.deaths.length;
      acc.merges += ev.merges.length;
      if (ev.deaths.length) acc.deathSteps += 1;
      for (const id of ev.births) {
        if (batch.events.some((e) => e.regime === "calm" && e.regionId === id)) {
          acc.birthWithGrain += 1;
        }
      }
    }

    const trackIds = new Set((batch.tracks ?? []).map((t) => t.regionId));
    acc.tracks += trackIds.size;
    for (const r of o.coherent) {
      if (Math.hypot(r.velX, r.velY) >= 0.4 && !trackIds.has(r.id)) {
        acc.motionNoTrack += 1;
      }
    }
    for (const f of o.flows ?? []) {
      if (
        Math.hypot(f.velX, f.velY) >= 0.4 &&
        !trackIds.has(FLOW_ID_BASE + f.id)
      ) {
        acc.motionNoTrack += 1;
      }
    }
  }

  acc.oscPeriods = periodSet.size;
  const stepsMeas = Math.max(1, acc.steps);
  return {
    label,
    steps: stepsMeas,
    silentCalmPerStep: acc.silentCalm / stepsMeas,
    silentFlowPerStep: acc.silentFlow / stepsMeas,
    silentTexturePerStep: acc.silentTexture / stepsMeas,
    silentOscPerStep: acc.silentOsc / stepsMeas,
    avgOscGroups: acc.oscGroups / stepsMeas,
    distinctOscPeriods: acc.oscPeriods,
    avgTextureIslands: acc.textureGroups / stepsMeas,
    avgOscHeight: acc.oscHeightN ? acc.oscHeightSum / acc.oscHeightN : 0,
    births: acc.births,
    deaths: acc.deaths,
    merges: acc.merges,
    birthAudibleFrac: acc.births ? acc.birthWithGrain / acc.births : 0,
    deathSteps: acc.deathSteps,
    motionNoTrackPerStep: acc.motionNoTrack / stepsMeas,
    avgTracks: acc.tracks / stepsMeas,
    eventsPerStep: acc.events / stepsMeas,
    meanQ: acc.qN ? acc.qMean / acc.qN : 0,
    reverseDirPerStep: acc.reverseDir / stepsMeas,
  };
}

function printReport(r) {
  console.log(`\n=== ${r.label} ===`);
  console.log(
    `  osc groups/step ${r.avgOscGroups.toFixed(2)} (periods ${r.distinctOscPeriods}, mean height ${r.avgOscHeight.toFixed(1)}) | texture islands/step ${r.avgTextureIslands.toFixed(2)}`,
  );
  console.log(
    `  silent/step calm ${r.silentCalmPerStep.toFixed(2)} flow ${r.silentFlowPerStep.toFixed(2)} tex ${r.silentTexturePerStep.toFixed(2)} osc ${r.silentOscPerStep.toFixed(2)}`,
  );
  console.log(
    `  lifecycle births ${r.births} (audible ${(r.birthAudibleFrac * 100).toFixed(0)}%) | deaths ${r.deaths} | merges ${r.merges} | death-steps ${r.deathSteps}`,
  );
  console.log(
    `  motion-no-track/step ${r.motionNoTrackPerStep.toFixed(3)} | tracks/step ${r.avgTracks.toFixed(2)} | events/step ${r.eventsPerStep.toFixed(1)} | mean Q ${r.meanQ.toFixed(2)} | reverseDir/step ${r.reverseDirPerStep.toFixed(2)}`,
  );
}

const patterns = [
  "uniform-calm",
  "frozen-noise",
  "moving-bar",
  "blinker-fast",
  "flow-dense",
  "full-flicker",
  "two-blobs-merge",
  "half-half",
];

console.log("see↔hear probe — synthetic patterns + live Type-U\n");

for (const id of patterns) {
  const p = TEST_PATTERNS.find((t) => t.id === id);
  if (!p) {
    console.warn(`missing pattern ${id}`);
    continue;
  }
  const report = probeRun(id, (field, step) => p.fill(field, step));
  printReport(report);
}

{
  let a = makeField();
  let b = makeField();
  fillRand(a, 0xc0ffee);
  quantize(a);
  const report = probeRun(
    "type-u-seed",
    (field, step) => {
      if (step === 0) {
        field.r.set(a.r);
        field.g.set(a.g);
        field.b.set(a.b);
        return;
      }
      stepTypeU(a, b);
      quantize(b);
      const t = a;
      a = b;
      b = t;
      field.r.set(a.r);
      field.g.set(a.g);
      field.b.set(a.b);
    },
    300,
    90,
  );
  printReport(report);
}

console.log("\nDone.");
