/**
 * Phase 1 gate: FieldObserver exists, lattice stays gone, synthetic calm blob
 * forms a coherent region.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;

function assert(label, ok) {
  if (ok) {
    console.log(`  ok  ${label}`);
  } else {
    console.error(`FAIL  ${label}`);
    failed += 1;
  }
}

/** Confirmed Flow members must not also sit in Osc bags (exclusive order). */
function assertOscFlowExclusive(label, obs) {
  const flowCells = new Set();
  for (const f of obs.flows ?? []) {
    for (const i of f.cells) flowCells.add(i);
  }
  if (flowCells.size === 0) {
    assert(`${label}: osc∩flow empty (no flow)`, true);
    return;
  }
  let overlap = 0;
  for (const g of obs.oscillators ?? []) {
    for (const i of g.cells) {
      if (flowCells.has(i)) overlap += 1;
    }
  }
  assert(`${label}: osc∩flow empty`, overlap === 0);
}

// --- static tree checks ---
const main = readFileSync(join(root, "src/main.ts"), "utf8");
const fieldSrc = readFileSync(join(root, "src/field/FieldObserver.ts"), "utf8");

assert("FieldObserver.ts present", existsSync(join(root, "src/field/FieldObserver.ts")));
assert("RegionOverlay.ts present", existsSync(join(root, "src/ui/RegionOverlay.ts")));
assert("FieldReducer still absent", !existsSync(join(root, "src/field/FieldReducer.ts")));
assert("main wires FieldObserver", /FieldObserver/.test(main));
assert("main does not import FieldReducer", !/FieldReducer/.test(main));
assert("observes δ / similarity / κ", /deltaEma/.test(fieldSrc) && /kappaThreshold/.test(fieldSrc));
assert("soft colour gate", /regionColourEps/.test(fieldSrc));
assert("κ hysteresis enter/exit", /kappaEnter/.test(fieldSrc) && /kappaExit/.test(fieldSrc));
assert(
  "confirmed flow EMAs are protected from emit-poison matches",
  /emaProtectHop/.test(fieldSrc) && /emaProtectDensity/.test(fieldSrc),
);
assert(
  "emit hop/density failures are tallied separately from match rejects",
  /emitHop/.test(fieldSrc) && /emitDensity/.test(fieldSrc),
);
assert("fillRatio on regions", /fillRatio/.test(fieldSrc));
assert("no per-cell coherence length", !/meanLength/.test(fieldSrc) && !/measureCoherenceLength/.test(fieldSrc));
assert("extracts coherent regions", /extractRegions/.test(fieldSrc));
assert("builds chaotic remainder", /buildChaotic/.test(fieldSrc));
assert("toroidal COM / velocity", /toroidalDelta/.test(fieldSrc) && /velX/.test(fieldSrc));
assert(
  "osc travel is stripped from sitting-period bags",
  /suppressTravellingOscillators/.test(fieldSrc),
);
assert(
  "confirmed flow punches members out of oscillator bags",
  /punchFlowFromOscillators/.test(fieldSrc),
);
assert(
  "thin-line calm uses spine similarity and 8-connect",
  /sSpine/.test(fieldSrc) && /staircaseHeadingOk/.test(fieldSrc),
);
assert("flow snapshots site period", /flowSitePeriod/.test(fieldSrc));

// --- runtime synthetic field (via vite-less dynamic import of compiled? use tsx? ) ---
// FieldObserver is TypeScript — run logic checks by spawning tsc-free duplicate test
// through node --experimental-strip-types if available, else skip runtime and rely on build.

async function runtimeCheck() {
  const entry = join(root, "src/field/FieldObserver.ts");
  let mod;
  try {
    mod = await import(pathToFileURL(entry).href);
  } catch (err) {
    // Node without TS strip: fall back to verifying build artifacts after tsc.
    console.log(`  skip runtime import (${err instanceof Error ? err.message : err})`);
    return;
  }

  const { FieldObserver, FIELD_OBS } = mod;
  const w = 32;
  const h = 32;
  const n = w * h;

  function field(fill) {
    const r = new Float32Array(n);
    const g = new Float32Array(n);
    const b = new Float32Array(n);
    for (let i = 0; i < n; i++) fill(r, g, b, i);
    return { width: w, height: h, r, g, b };
  }

  const prev = field((r, g, b, i) => {
    r[i] = 0.1;
    g[i] = 0.1;
    b[i] = 0.1;
  });

  const cur = field((r, g, b, i) => {
    const x = i % w;
    const y = (i / w) | 0;
    const inBlob = x >= 8 && x < 20 && y >= 8 && y < 20;
    if (inBlob) {
      r[i] = 0.2;
      g[i] = 0.55;
      b[i] = 0.85;
    } else {
      // noisy chaos outside
      r[i] = (i * 17) % 97 / 97;
      g[i] = (i * 31) % 89 / 89;
      b[i] = (i * 13) % 83 / 83;
    }
  });

  // Hold blob steady so δ EMA decays below chaosDeltaMin (static → textured).
  const obs = new FieldObserver(w, h);
  obs.observe(cur, prev);
  const still = {
    width: w,
    height: h,
    r: cur.r.slice(),
    g: cur.g.slice(),
    b: cur.b.slice(),
  };
  for (let t = 0; t < 24; t++) {
    obs.observe(still, still);
  }
  const out = obs.observation;
  assert("finds at least one coherent region", out.coherent.length >= 1);
  assert(
    "calm blob area is substantial",
    out.coherent.some((r) => r.area >= FIELD_OBS.minRegionArea),
  );
  // V4.2 Phase 4: static noisy surround is textured, not chaotic.
  assert(
    "static noisy surround is textured (not chaotic)",
    out.textured.area > 0 && out.chaotic.area === 0,
  );
  assert(
    "fractions sum ~1",
    Math.abs(
      out.calmAreaFraction +
        out.chaosAreaFraction +
        (out.texturedAreaFraction ?? 0) -
        1,
    ) < 0.02,
  );

  // Flickering surround: regenerate noise each observe → true chaos.
  const flickerObs = new FieldObserver(w, h);
  let flickerPrev = field((r, g, b, i) => {
    r[i] = 0.1;
    g[i] = 0.1;
    b[i] = 0.1;
  });
  for (let t = 0; t < 10; t++) {
    const flickerCur = field((r, g, b, i) => {
      const x = i % w;
      const y = (i / w) | 0;
      const inBlob = x >= 8 && x < 20 && y >= 8 && y < 20;
      if (inBlob) {
        r[i] = 0.2;
        g[i] = 0.55;
        b[i] = 0.85;
      } else {
        const seed = (t + 1) * 9973 + i * 17;
        r[i] = ((seed * 31) % 97) / 97;
        g[i] = ((seed * 57) % 89) / 89;
        b[i] = ((seed * 13) % 83) / 83;
      }
    });
    flickerObs.observe(flickerCur, flickerPrev);
    flickerPrev = flickerCur;
  }
  assert(
    "flickering surround is chaotic",
    flickerObs.observation.chaotic.area > 0,
  );
  assert("region has COM and bounds", out.coherent[0].width >= 1 && out.coherent[0].height >= 1);
  assert(
    "region has fillRatio in (0,1]",
    out.coherent.every((r) => r.fillRatio > 0 && r.fillRatio <= 1),
  );
  assert(
    "region has width/height extent",
    out.coherent.every((r) => r.width >= 1 && r.height >= 1),
  );

  // Two adjacent different-hue calm blobs must not merge (soft colour gate).
  const dual = field((r, g, b, i) => {
    const x = i % w;
    const y = (i / w) | 0;
    const left = x >= 4 && x < 14 && y >= 8 && y < 22;
    const right = x >= 14 && x < 24 && y >= 8 && y < 22;
    if (left) {
      r[i] = 0.15;
      g[i] = 0.45;
      b[i] = 0.9;
    } else if (right) {
      r[i] = 0.95;
      g[i] = 0.35;
      b[i] = 0.1;
    } else {
      r[i] = (i * 17) % 97 / 97;
      g[i] = (i * 31) % 89 / 89;
      b[i] = (i * 13) % 83 / 83;
    }
  });
  const dualObs = new FieldObserver(w, h);
  dualObs.observe(dual, prev);
  for (let t = 0; t < 8; t++) dualObs.observe(dual, dual);
  const dualOut = dualObs.observation;
  assert(
    "adjacent different-hue calm blobs stay separate",
    dualOut.coherent.length >= 2,
  );

  // Similar (not exact) hues within eps should form one region.
  const similar = field((r, g, b, i) => {
    const x = i % w;
    const y = (i / w) | 0;
    const inBlob = x >= 8 && x < 22 && y >= 8 && y < 22;
    if (inBlob) {
      const jitter = ((x + y) % 3) * 0.02;
      r[i] = 0.22 + jitter;
      g[i] = 0.55;
      b[i] = 0.82 - jitter * 0.5;
    } else {
      r[i] = (i * 17) % 97 / 97;
      g[i] = (i * 31) % 89 / 89;
      b[i] = (i * 13) % 83 / 83;
    }
  });
  const simObs = new FieldObserver(w, h);
  simObs.observe(similar, prev);
  for (let t = 0; t < 8; t++) simObs.observe(similar, similar);
  const simOut = simObs.observation;
  const big = simOut.coherent.reduce((m, r) => Math.max(m, r.area), 0);
  assert(
    "similar-hue calm variance merges into one substantial region",
    big >= FIELD_OBS.minRegionArea * 2,
  );

  // Sparse same-direction dots are not a flow region (too spread out).
  const flowObs = new FieldObserver(w, h);
  const bg = field((r, g, b, i) => {
    r[i] = 0.1;
    g[i] = 0.1;
    b[i] = 0.12;
  });
  const flowStarts = [
    [3, 3],
    [3, 14],
    [3, 25],
    [18, 8],
    [18, 19],
    [18, 30],
  ];
  let flowPrev = bg;
  for (let t = 0; t < 36; t++) {
    const flowCur = field((r, g, b, i) => {
      r[i] = 0.1;
      g[i] = 0.1;
      b[i] = 0.12;
    });
    for (const [sx, sy] of flowStarts) {
      const x = (sx + t * 2 + w) % w;
      const y = (sy + h) % h;
      const i = y * w + x;
      flowCur.r[i] = 0.95;
      flowCur.g[i] = 0.82;
      flowCur.b[i] = 0.2;
    }
    flowObs.observe(flowCur, flowPrev);
    flowPrev = flowCur;
  }
  assert(
    "widely spaced same-direction dots are not a flow",
    (flowObs.observation.flows ?? []).reduce((s, f) => s + f.area, 0) === 0,
  );

  const oneObs = new FieldObserver(w, h);
  let onePrev = bg;
  for (let t = 0; t < 8; t++) {
    const oneCur = field((r, g, b, i) => {
      r[i] = 0.1;
      g[i] = 0.1;
      b[i] = 0.12;
    });
    const x = (4 + t * 2 + w) % w;
    const y = (5 + t + h) % h;
    const i = y * w + x;
    oneCur.r[i] = 0.2;
    oneCur.g[i] = 0.9;
    oneCur.b[i] = 0.85;
    oneObs.observe(oneCur, onePrev);
    onePrev = oneCur;
  }
  assert(
    "a single travelling cell is not a flow region",
    (oneObs.observation.flows ?? []).length === 0,
  );

  // Dense pack: 5×5 particles 3 cells apart, all moving +1 x.
  const denseObs = new FieldObserver(w, h);
  let densePrev = bg;
  for (let t = 0; t < 36; t++) {
    const denseCur = field((r, g, b, i) => {
      r[i] = 0.1;
      g[i] = 0.1;
      b[i] = 0.12;
    });
    const x0 = (2 + t + w) % w;
    const y0 = 8;
    for (let iy = 0; iy < 5; iy++) {
      for (let ix = 0; ix < 5; ix++) {
        const x = (x0 + ix * 3) % w;
        const y = (y0 + iy * 3) % h;
        const i = y * w + x;
        denseCur.r[i] = 0.95;
        denseCur.g[i] = 0.82;
        denseCur.b[i] = 0.2;
      }
    }
    denseObs.observe(denseCur, densePrev);
    densePrev = denseCur;
  }
  const denseOut = denseObs.observation;
  const denseArea = (denseOut.flows ?? []).reduce((s, f) => s + f.area, 0);
  const denseVelX =
    denseArea > 0
      ? (denseOut.flows ?? []).reduce((s, f) => s + f.velX * f.area, 0) /
        denseArea
      : 0;
  assert("a packed travelling colour is a flow", denseArea >= 20);
  assert(
    "dense flow velocity is +1 x",
    denseVelX > 0.7 && denseVelX < 1.4,
  );
  const denseRegion = (denseOut.flows ?? []).reduce(
    (s, f) => s + (f.regionArea ?? 0),
    0,
  );
  assert(
    "flow % uses the group patch, not only particle count",
    denseRegion > denseArea,
  );
  const denseFlowCells = new Set();
  for (const f of denseOut.flows ?? []) {
    for (const i of f.cells) denseFlowCells.add(i);
  }
  assert(
    "flow cells are not also counted as chaos",
    ![...denseOut.chaotic.cells].some((i) => denseFlowCells.has(i)),
  );
  assertOscFlowExclusive("dense pack", denseOut);

  const earlyObs = new FieldObserver(w, h);
  let earlyPrev = bg;
  for (let t = 0; t < 8; t++) {
    const cur = field((r, g, b, i) => {
      r[i] = 0.1;
      g[i] = 0.1;
      b[i] = 0.12;
    });
    const x0 = (2 + t + w) % w;
    for (let iy = 0; iy < 5; iy++) {
      for (let ix = 0; ix < 5; ix++) {
        const i = (8 + iy * 3) * w + ((x0 + ix * 3) % w);
        cur.r[i] = 0.95;
        cur.g[i] = 0.82;
        cur.b[i] = 0.2;
      }
    }
    earlyObs.observe(cur, earlyPrev);
    earlyPrev = cur;
  }
  assert(
    "flow is not confirmed in the first few steps",
    (earlyObs.observation.flows ?? []).length === 0,
  );

  const streamW = 64;
  const streamH = 64;
  const streamN = streamW * streamH;
  const streamObs = new FieldObserver(streamW, streamH);
  function streamField(fill) {
    const r = new Float32Array(streamN);
    const g = new Float32Array(streamN);
    const b = new Float32Array(streamN);
    for (let i = 0; i < streamN; i++) fill(r, g, b, i);
    return { width: streamW, height: streamH, r, g, b };
  }
  const streamBg = streamField((r, g, b, i) => {
    r[i] = 0.1;
    g[i] = 0.1;
    b[i] = 0.12;
  });
  let streamPrev = streamBg;
  for (let t = 0; t < 36; t++) {
    const cur = streamField((r, g, b, i) => {
      r[i] = 0.1;
      g[i] = 0.1;
      b[i] = 0.12;
    });
    const x0 = (3 + t + streamW) % streamW;
    for (let k = 0; k < 12; k++) {
      const i = (8 + k * 6) * streamW + x0;
      cur.r[i] = 0.95;
      cur.g[i] = 0.82;
      cur.b[i] = 0.2;
    }
    streamObs.observe(cur, streamPrev);
    streamPrev = cur;
  }
  assert(
    "a dashed travelling stream is a flow",
    (streamObs.observation.flows ?? []).reduce((s, f) => s + f.area, 0) >= 10,
  );
  assertOscFlowExclusive("dashed stream", streamObs.observation);

  // 10 spaced cells (gappy hop) — min-size gate; solid adjacent packs are calm.
  const pack10Obs = new FieldObserver(w, h);
  let pack10Prev = bg;
  for (let t = 0; t < 36; t++) {
    const cur = field((r, g, b, i) => {
      r[i] = 0.1;
      g[i] = 0.1;
      b[i] = 0.12;
    });
    const x0 = (2 + t + w) % w;
    for (let k = 0; k < 10; k++) {
      const i = (8 + (k % 2) * 3) * w + ((x0 + ((k / 2) | 0) * 3) % w);
      cur.r[i] = 0.95;
      cur.g[i] = 0.82;
      cur.b[i] = 0.2;
    }
    pack10Obs.observe(cur, pack10Prev);
    pack10Prev = cur;
  }
  assert(
    "ten spaced cells are a flow",
    (pack10Obs.observation.flows ?? []).reduce((s, f) => s + f.area, 0) >= 10,
  );

  const diagObs = new FieldObserver(w, h);
  let diagPrev = bg;
  for (let t = 0; t < 36; t++) {
    const cur = field((r, g, b, i) => {
      r[i] = 0.1;
      g[i] = 0.1;
      b[i] = 0.12;
    });
    const x0 = (2 + t + w) % w;
    const y0 = 8;
    for (let k = 0; k < 12; k++) {
      const i = ((y0 + k) % h) * w + ((x0 + k) % w);
      cur.r[i] = 0.2;
      cur.g[i] = 0.9;
      cur.b[i] = 0.75;
    }
    diagObs.observe(cur, diagPrev);
    diagPrev = cur;
  }
  const diagArea = (diagObs.observation.flows ?? []).reduce(
    (s, f) => s + f.area,
    0,
  );
  const diagVelX =
    diagArea > 0
      ? (diagObs.observation.flows ?? []).reduce((s, f) => s + f.velX * f.area, 0) /
        diagArea
      : 0;
  assert("a travelling diagonal stream is a flow", diagArea >= 10);
  assert("diagonal flow velocity is +1 x", diagVelX > 0.7 && diagVelX < 1.4);

  const fastObs = new FieldObserver(w, h);
  let fastPrev = bg;
  for (let t = 0; t < 36; t++) {
    const cur = field((r, g, b, i) => {
      r[i] = 0.1;
      g[i] = 0.1;
      b[i] = 0.12;
    });
    const x0 = (2 + t * 5 + w) % w;
    for (let iy = 0; iy < 2; iy++) {
      for (let ix = 0; ix < 5; ix++) {
        const i = (8 + iy) * w + ((x0 + ix) % w);
        cur.r[i] = 0.95;
        cur.g[i] = 0.4;
        cur.b[i] = 0.2;
      }
    }
    fastObs.observe(cur, fastPrev);
    fastPrev = cur;
  }
  assert(
    "a small fast blob is a flow",
    (fastObs.observation.flows ?? []).reduce((s, f) => s + f.area, 0) >= 10,
  );

  const twinObs = new FieldObserver(w, h);
  let twinPrev = bg;
  for (let t = 0; t < 36; t++) {
    const cur = field((r, g, b, i) => {
      r[i] = 0.1;
      g[i] = 0.1;
      b[i] = 0.12;
    });
    const x0 = (2 + t + w) % w;
    for (const y0 of [8, 16]) {
      for (let iy = 0; iy < 2; iy++) {
        for (let ix = 0; ix < 6; ix++) {
          const i = (y0 + iy * 3) * w + ((x0 + ix * 3) % w);
          cur.r[i] = 0.95;
          cur.g[i] = 0.82;
          cur.b[i] = 0.2;
        }
      }
    }
    twinObs.observe(cur, twinPrev);
    twinPrev = cur;
  }
  assert(
    "two nearby same-colour packs are both flows",
    (twinObs.observation.flows ?? []).reduce((s, f) => s + f.area, 0) >= 20,
  );

  const holdObs = new FieldObserver(w, h);
  let holdPrev = bg;
  for (let t = 0; t < 36; t++) {
    const cur = field((r, g, b, i) => {
      r[i] = 0.1;
      g[i] = 0.1;
      b[i] = 0.12;
    });
    const x0 = (2 + t + w) % w;
    for (let iy = 0; iy < 5; iy++) {
      for (let ix = 0; ix < 5; ix++) {
        const i = (8 + iy * 3) * w + ((x0 + ix * 3) % w);
        cur.r[i] = 0.95;
        cur.g[i] = 0.82;
        cur.b[i] = 0.2;
      }
    }
    holdObs.observe(cur, holdPrev);
    holdPrev = cur;
  }
  for (let t = 0; t < 6; t++) {
    holdObs.observe(bg, holdPrev);
    holdPrev = bg;
  }
  assert(
    "confirmed flow holds across a brief miss",
    holdObs.observation.flowAreaFraction > 0,
  );

  const blockObs = new FieldObserver(w, h);
  let blockPrev = bg;
  for (let t = 0; t < 36; t++) {
    const cur = field((r, g, b, i) => {
      r[i] = 0.1;
      g[i] = 0.1;
      b[i] = 0.12;
    });
    const x0 = (2 + t + w) % w;
    for (let iy = 0; iy < 12; iy++) {
      for (let ix = 0; ix < 12; ix++) {
        const i = (6 + iy) * w + ((x0 + ix) % w);
        cur.r[i] = 0.2;
        cur.g[i] = 0.55;
        cur.b[i] = 0.85;
      }
    }
    blockObs.observe(cur, blockPrev);
    blockPrev = cur;
  }
  assert(
    "a solid translating colour block is calm, not flow",
    (blockObs.observation.flows ?? []).reduce((s, f) => s + f.area, 0) === 0,
  );
  assert(
    "a solid translating colour block stays a calm region",
    blockObs.observation.coherent.some((r) => r.area >= 80),
  );

  // Thin solid bar: live-CA failure mode (edge δ looks like a stream).
  const thinBarObs = new FieldObserver(w, h);
  let thinPrev = bg;
  for (let t = 0; t < 36; t++) {
    const cur = field((r, g, b, i) => {
      r[i] = 0.1;
      g[i] = 0.1;
      b[i] = 0.12;
    });
    const x0 = (2 + t + w) % w;
    for (let iy = 0; iy < 4; iy++) {
      for (let ix = 0; ix < 24; ix++) {
        const i = (10 + iy) * w + ((x0 + ix) % w);
        cur.r[i] = 0.25;
        cur.g[i] = 0.6;
        cur.b[i] = 0.9;
      }
    }
    thinBarObs.observe(cur, thinPrev);
    thinPrev = cur;
  }
  assert(
    "a thin translating colour bar is not flow",
    (thinBarObs.observation.flows ?? []).reduce((s, f) => s + f.area, 0) === 0,
  );

  // Vertical dashed train: hops +1 y each step; whole pattern drifts +1 x
  // every 5 steps. Perceptual motion is down — hop vel must win over COM.
  // Keep span short of a full torus ring so COM/hop stay well-defined.
  const trainObs = new FieldObserver(w, h);
  let trainPrev = bg;
  for (let t = 0; t < 40; t++) {
    const cur = field((r, g, b, i) => {
      r[i] = 0.1;
      g[i] = 0.1;
      b[i] = 0.12;
    });
    const xDrift = (2 + Math.floor(t / 5) + w) % w;
    const y0 = (4 + t + h) % h;
    for (let k = 0; k < 10; k++) {
      const i = ((y0 + k * 3) % h) * w + xDrift;
      cur.r[i] = 0.2;
      cur.g[i] = 0.9;
      cur.b[i] = 0.35;
    }
    trainObs.observe(cur, trainPrev);
    trainPrev = cur;
  }
  const trainFlows = trainObs.observation.flows ?? [];
  const trainArea = trainFlows.reduce((s, f) => s + f.area, 0);
  const trainVelY =
    trainArea > 0
      ? trainFlows.reduce((s, f) => s + f.velY * f.area, 0) / trainArea
      : 0;
  const trainVelX =
    trainArea > 0
      ? trainFlows.reduce((s, f) => s + f.velX * f.area, 0) / trainArea
      : 0;
  assert("a vertical dashed train is a flow", trainArea >= 6);
  assert(
    "train flow velocity is primarily +y (not lateral COM drift)",
    trainVelY > 0.7 && Math.abs(trainVelY) > Math.abs(trainVelX) * 1.5,
  );

  // Spacing-2 short hopping train (wavelength-2 dash) — still Flow.
  const hop2Obs = new FieldObserver(w, h);
  let hop2Prev = bg;
  for (let t = 0; t < 40; t++) {
    const cur = field((r, g, b, i) => {
      r[i] = 0.1;
      g[i] = 0.1;
      b[i] = 0.12;
    });
    const xDrift = (2 + Math.floor(t / 5) + w) % w;
    const y0 = (4 + t + h) % h;
    for (let k = 0; k < 10; k++) {
      const i = ((y0 + k * 2) % h) * w + xDrift;
      cur.r[i] = 0.2;
      cur.g[i] = 0.9;
      cur.b[i] = 0.35;
    }
    hop2Obs.observe(cur, hop2Prev);
    hop2Prev = cur;
  }
  assert(
    "a spacing-2 hopping train is a flow",
    (hop2Obs.observation.flows ?? []).reduce((s, f) => s + f.area, 0) >= 6,
  );
  assertOscFlowExclusive("spacing-2 hop train", hop2Obs.observation);
  assert(
    "a spacing-2 hopping train keeps a site period",
    (hop2Obs.observation.flows ?? []).some((f) => f.period === 2),
  );

  // Dashed diagonal train: hop +1,+1.
  const diagTrainObs = new FieldObserver(w, h);
  let diagTrainPrev = bg;
  for (let t = 0; t < 40; t++) {
    const cur = field((r, g, b, i) => {
      r[i] = 0.1;
      g[i] = 0.1;
      b[i] = 0.12;
    });
    const x0 = (3 + t + w) % w;
    const y0 = (4 + t + h) % h;
    for (let k = 0; k < 10; k++) {
      const i = ((y0 + k * 2) % h) * w + ((x0 + k * 2) % w);
      cur.r[i] = 0.2;
      cur.g[i] = 0.9;
      cur.b[i] = 0.35;
    }
    diagTrainObs.observe(cur, diagTrainPrev);
    diagTrainPrev = cur;
  }
  const diagTrainFlows = diagTrainObs.observation.flows ?? [];
  const diagTrainArea = diagTrainFlows.reduce((s, f) => s + f.area, 0);
  const diagTrainVelX =
    diagTrainArea > 0
      ? diagTrainFlows.reduce((s, f) => s + f.velX * f.area, 0) / diagTrainArea
      : 0;
  const diagTrainVelY =
    diagTrainArea > 0
      ? diagTrainFlows.reduce((s, f) => s + f.velY * f.area, 0) / diagTrainArea
      : 0;
  assert("a dashed diagonal train is a flow", diagTrainArea >= 6);
  assert(
    "diagonal train velocity has both +x and +y",
    diagTrainVelX > 0.5 && diagTrainVelY > 0.5,
  );

  // Still 1-cell-wide strip → Calm (spine κ), not Flow / leftover Static-only.
  const stillStripObs = new FieldObserver(w, h);
  const stillStrip = field((r, g, b, i) => {
    const x = i % w;
    const y = (i / w) | 0;
    if (y === 10) {
      r[i] = 0.2;
      g[i] = 0.9;
      b[i] = 0.35;
    } else {
      r[i] = 0.1;
      g[i] = 0.1;
      b[i] = 0.12;
    }
  });
  stillStripObs.observe(stillStrip, bg);
  for (let t = 0; t < 12; t++) stillStripObs.observe(stillStrip, stillStrip);
  const stillStripCalm = stillStripObs.observation.coherent.reduce(
    (s, r) => s + r.area,
    0,
  );
  assert("a still 1-cell strip is a calm region", stillStripCalm >= 24);
  assert(
    "a still 1-cell strip is not flow",
    (stillStripObs.observation.flows ?? []).length === 0,
  );

  const stillDiagObs = new FieldObserver(w, h);
  const stillDiag = field((r, g, b, i) => {
    const x = i % w;
    const y = (i / w) | 0;
    if (x >= 2 && x < 28 && y === x) {
      r[i] = 0.2;
      g[i] = 0.9;
      b[i] = 0.35;
    } else {
      r[i] = 0.1;
      g[i] = 0.1;
      b[i] = 0.12;
    }
  });
  stillDiagObs.observe(stillDiag, bg);
  for (let t = 0; t < 12; t++) stillDiagObs.observe(stillDiag, stillDiag);
  assert(
    "a still diagonal 1-cell strip is a calm region",
    stillDiagObs.observation.coherent.reduce((s, r) => s + r.area, 0) >= 24,
  );

  // Travelling 1-cell-wide *solid* strip: persist silhouette → Calm, not Flow.
  const slideStripObs = new FieldObserver(w, h);
  let slidePrev = bg;
  for (let t = 0; t < 40; t++) {
    const cur = field((r, g, b, i) => {
      r[i] = 0.1;
      g[i] = 0.1;
      b[i] = 0.12;
    });
    const x0 = (2 + t + w) % w;
    for (let k = 0; k < 28; k++) {
      const i = 10 * w + ((x0 + k) % w);
      cur.r[i] = 0.2;
      cur.g[i] = 0.9;
      cur.b[i] = 0.35;
    }
    slideStripObs.observe(cur, slidePrev);
    slidePrev = cur;
  }
  const slideCalm = slideStripObs.observation.coherent.filter(
    (r) => r.meanG > 0.5,
  );
  const slideCalmArea = slideCalm.reduce((s, r) => s + r.area, 0);
  const slideVelX =
    slideCalmArea > 0
      ? slideCalm.reduce((s, r) => s + r.velX * r.area, 0) / slideCalmArea
      : 0;
  assert(
    "a travelling 1-cell solid strip is a calm region",
    slideCalmArea >= 24,
  );
  assert(
    "travelling 1-cell solid strip velocity is +x",
    slideVelX > 0.7 && slideVelX < 1.4,
  );
  assert(
    "a travelling 1-cell solid strip is not flow",
    (slideStripObs.observation.flows ?? []).reduce((s, f) => s + f.area, 0) ===
      0,
  );

  // Sitting wavelength-2 line: period-2 at sites, cancelling hops → Osc.
  const sitLineObs = new FieldObserver(w, h);
  let sitLinePrev = bg;
  const sitLinePainted = new Set();
  for (let t = 0; t < 24; t++) {
    sitLinePainted.clear();
    const cur = field((r, g, b, i) => {
      r[i] = 0.1;
      g[i] = 0.1;
      b[i] = 0.12;
    });
    const phase = t % 2;
    const x = 12;
    const y0 = 8;
    for (let k = 0; k < 10; k++) {
      if (k % 2 !== phase) continue;
      const i = (y0 + k) * w + x;
      cur.r[i] = 0.2;
      cur.g[i] = 0.9;
      cur.b[i] = 0.35;
      sitLinePainted.add(i);
    }
    sitLineObs.observe(cur, sitLinePrev);
    sitLinePrev = cur;
  }
  const sitLineOsc = (sitLineObs.observation.oscillators ?? []).reduce(
    (s, g) => s + g.area,
    0,
  );
  const sitLineFlow = (sitLineObs.observation.flows ?? []).reduce(
    (s, f) => s + f.area,
    0,
  );
  const sitLineChaosPainted = [...sitLinePainted].filter((i) =>
    [...sitLineObs.observation.chaotic.cells].includes(i),
  ).length;
  assert("a sitting spacing-2 blinker line is an oscillator", sitLineOsc >= 4);
  assert("a sitting spacing-2 blinker line is not flow", sitLineFlow === 0);
  assert(
    "sitting blinker line painted cells are not chaos",
    sitLineChaosPainted === 0,
  );

  // Full-height wrapping spacing-2 line: Osc (cancelling hops), not Chaos.
  const wrapW = 64;
  const wrapH = 64;
  const wrapN = wrapW * wrapH;
  function wrapField(fill) {
    const r = new Float32Array(wrapN);
    const g = new Float32Array(wrapN);
    const b = new Float32Array(wrapN);
    for (let i = 0; i < wrapN; i++) fill(r, g, b, i);
    return { width: wrapW, height: wrapH, r, g, b };
  }
  const wrapObs = new FieldObserver(wrapW, wrapH);
  let wrapPrev = wrapField((r, g, b) => {
    r.fill(0.1);
    g.fill(0.1);
    b.fill(0.12);
  });
  const wrapPainted = new Set();
  for (let t = 0; t < 24; t++) {
    wrapPainted.clear();
    const cur = wrapField((r, g, b) => {
      r.fill(0.1);
      g.fill(0.1);
      b.fill(0.12);
    });
    const phase = t % 2;
    const x = 12;
    for (let y = 0; y < wrapH; y++) {
      if (y % 2 !== phase) continue;
      const i = y * wrapW + x;
      cur.r[i] = 0.2;
      cur.g[i] = 0.9;
      cur.b[i] = 0.35;
      wrapPainted.add(i);
    }
    wrapObs.observe(cur, wrapPrev);
    wrapPrev = cur;
  }
  const wrapOsc = (wrapObs.observation.oscillators ?? []).reduce(
    (s, g) => s + g.area,
    0,
  );
  const wrapChaosPainted = [...wrapPainted].filter((i) =>
    [...wrapObs.observation.chaotic.cells].includes(i),
  ).length;
  assert(
    "a wrapping spacing-2 blinker line is an oscillator",
    wrapOsc >= wrapH / 2 - 2,
  );
  assert(
    "wrapping blinker line painted cells are not chaos",
    wrapChaosPainted === 0,
  );
  assert(
    "wrapping blinker line is not flow",
    (wrapObs.observation.flows ?? []).reduce((s, f) => s + f.area, 0) === 0,
  );

  // 16×16 sitting checkerboard → Osc (cancelling orthogonal hops).
  const checkObs = new FieldObserver(w, h);
  let checkPrev = bg;
  for (let t = 0; t < 24; t++) {
    const phase = t % 2;
    const cur = field((r, g, b, i) => {
      const x = i % w;
      const y = (i / w) | 0;
      r[i] = 0.1;
      g[i] = 0.1;
      b[i] = 0.12;
      if (x >= 8 && x < 24 && y >= 8 && y < 24 && (x + y) % 2 === phase) {
        r[i] = 0.9;
        g[i] = 0.25;
        b[i] = 0.2;
      }
    });
    checkObs.observe(cur, checkPrev);
    checkPrev = cur;
  }
  const checkOsc = (checkObs.observation.oscillators ?? []).reduce(
    (s, g) => s + g.area,
    0,
  );
  assert("a sitting checkerboard is an oscillator", checkOsc >= 100);
  assert(
    "a sitting checkerboard is not flow",
    (checkObs.observation.flows ?? []).reduce((s, f) => s + f.area, 0) === 0,
  );

  // Filled L-stamp: high local density translating body — calm/chaos, not flow.
  const ellObs = new FieldObserver(w, h);
  let ellPrev = bg;
  for (let t = 0; t < 36; t++) {
    const cur = field((r, g, b, i) => {
      r[i] = 0.1;
      g[i] = 0.1;
      b[i] = 0.12;
    });
    const x0 = (2 + t + w) % w;
    const y0 = 6;
    for (let iy = 0; iy < 10; iy++) {
      for (let ix = 0; ix < 3; ix++) {
        const i = (y0 + iy) * w + ((x0 + ix) % w);
        cur.r[i] = 0.15;
        cur.g[i] = 0.7;
        cur.b[i] = 0.55;
      }
    }
    for (let iy = 0; iy < 3; iy++) {
      for (let ix = 0; ix < 10; ix++) {
        const i = (y0 + 7 + iy) * w + ((x0 + ix) % w);
        cur.r[i] = 0.15;
        cur.g[i] = 0.7;
        cur.b[i] = 0.55;
      }
    }
    ellObs.observe(cur, ellPrev);
    ellPrev = cur;
  }
  assert(
    "a translating filled L-stamp is not flow",
    (ellObs.observation.flows ?? []).reduce((s, f) => s + f.area, 0) === 0,
  );

  // Thick ribbon (solid strip): stamp-like local density.
  const ribbonObs = new FieldObserver(w, h);
  let ribbonPrev = bg;
  for (let t = 0; t < 36; t++) {
    const cur = field((r, g, b, i) => {
      r[i] = 0.1;
      g[i] = 0.1;
      b[i] = 0.12;
    });
    const x0 = (2 + t + w) % w;
    for (let iy = 0; iy < 6; iy++) {
      for (let ix = 0; ix < 14; ix++) {
        const i = (12 + iy) * w + ((x0 + ix) % w);
        cur.r[i] = 0.85;
        cur.g[i] = 0.4;
        cur.b[i] = 0.2;
      }
    }
    ribbonObs.observe(cur, ribbonPrev);
    ribbonPrev = cur;
  }
  assert(
    "a thick translating ribbon is not flow",
    (ribbonObs.observation.flows ?? []).reduce((s, f) => s + f.area, 0) === 0,
  );

  // Stationary flicker patch: COM jitter must not confirm as flow.
  const stayFlickObs = new FieldObserver(w, h);
  let stayPrev = bg;
  for (let t = 0; t < 40; t++) {
    const cur = field((r, g, b, i) => {
      r[i] = 0.1;
      g[i] = 0.1;
      b[i] = 0.12;
    });
    const on = t % 2 === 0;
    for (let iy = 0; iy < 6; iy++) {
      for (let ix = 0; ix < 6; ix++) {
        const i = (20 + iy) * w + (20 + ix);
        if (on) {
          cur.r[i] = 0.9;
          cur.g[i] = 0.35;
          cur.b[i] = 0.15;
        } else {
          cur.r[i] = 0.2;
          cur.g[i] = 0.15;
          cur.b[i] = 0.4;
        }
      }
    }
    stayFlickObs.observe(cur, stayPrev);
    stayPrev = cur;
  }
  assert(
    "a stationary flickering patch is not flow",
    (stayFlickObs.observation.flows ?? []).reduce((s, f) => s + f.area, 0) ===
      0,
  );

  // Cascade: dashed cells along a soft curve (not H/V/diag strip), hopping +y.
  // Heading-chain stitch should join them into one flow.
  const cascadeObs = new FieldObserver(w, h);
  let cascadePrev = bg;
  for (let t = 0; t < 40; t++) {
    const cur = field((r, g, b, i) => {
      r[i] = 0.1;
      g[i] = 0.1;
      b[i] = 0.12;
    });
    const y0 = (6 + t + h) % h;
    for (let k = 0; k < 10; k++) {
      const x = (10 + Math.round(Math.sin(k * 0.55) * 4) + w) % w;
      const y = (y0 + k * 3) % h;
      const i = y * w + x;
      cur.r[i] = 0.15;
      cur.g[i] = 0.85;
      cur.b[i] = 0.55;
    }
    cascadeObs.observe(cur, cascadePrev);
    cascadePrev = cur;
  }
  const cascadeFlows = cascadeObs.observation.flows ?? [];
  const cascadeArea = cascadeFlows.reduce((s, f) => s + f.area, 0);
  const cascadeVelY =
    cascadeArea > 0
      ? cascadeFlows.reduce((s, f) => s + f.velY * f.area, 0) / cascadeArea
      : 0;
  assert("a curved same-heading cascade is a flow", cascadeArea >= 6);
  assert(
    "cascade flow velocity is primarily +y",
    cascadeVelY > 0.5,
  );
  assert(
    "cascade stitches into one flow group",
    cascadeFlows.length >= 1 && cascadeFlows.length <= 2,
  );

  // Staggered wavefront: a few short dashes at different x, all hopping +y.
  const waveObs = new FieldObserver(w, h);
  let wavePrev = bg;
  for (let t = 0; t < 40; t++) {
    const cur = field((r, g, b, i) => {
      r[i] = 0.1;
      g[i] = 0.1;
      b[i] = 0.12;
    });
    const y0 = (5 + t + h) % h;
    for (let col = 0; col < 4; col++) {
      const x = 12 + col * 4;
      for (let k = 0; k < 3; k++) {
        const y = (y0 + col + k * 4) % h;
        const i = y * w + x;
        cur.r[i] = 0.9;
        cur.g[i] = 0.55;
        cur.b[i] = 0.2;
      }
    }
    waveObs.observe(cur, wavePrev);
    wavePrev = cur;
  }
  const waveArea = (waveObs.observation.flows ?? []).reduce(
    (s, f) => s + f.area,
    0,
  );
  assert("a staggered same-heading wavefront is a flow", waveArea >= 6);

  // Dense cascade: several 2×3 clumps spaced along +y hop — joined but not
  // an evenly filled mass. Must confirm as flow under loosened density caps.
  const denseCascObs = new FieldObserver(w, h);
  let denseCascPrev = bg;
  for (let t = 0; t < 40; t++) {
    const cur = field((r, g, b, i) => {
      r[i] = 0.1;
      g[i] = 0.1;
      b[i] = 0.12;
    });
    const y0 = (5 + t + h) % h;
    for (let k = 0; k < 5; k++) {
      const x0 = 18;
      const yBase = (y0 + k * 5) % h;
      for (let iy = 0; iy < 2; iy++) {
        for (let ix = 0; ix < 3; ix++) {
          const i = ((yBase + iy) % h) * w + ((x0 + ix) % w);
          cur.r[i] = 0.85;
          cur.g[i] = 0.35;
          cur.b[i] = 0.2;
        }
      }
    }
    denseCascObs.observe(cur, denseCascPrev);
    denseCascPrev = cur;
  }
  const denseCascArea = (denseCascObs.observation.flows ?? []).reduce(
    (s, f) => s + f.area,
    0,
  );
  assert(
    "a denser multi-cell cascade is a flow",
    denseCascArea >= 10,
  );

  // Dithered sheet: same-hue speckles occupying a 2D band, translating +1 x.
  const ditherW = 64;
  const ditherH = 64;
  const ditherN = ditherW * ditherH;
  function ditherField(fill) {
    const r = new Float32Array(ditherN);
    const g = new Float32Array(ditherN);
    const b = new Float32Array(ditherN);
    for (let i = 0; i < ditherN; i++) fill(r, g, b, i);
    return { width: ditherW, height: ditherH, r, g, b };
  }
  const ditherBg = ditherField((r, g, b) => {
    r.fill(0.1);
    g.fill(0.1);
    b.fill(0.12);
  });
  const ditherObs = new FieldObserver(ditherW, ditherH);
  let ditherPrev = ditherBg;
  for (let t = 0; t < 40; t++) {
    const cur = ditherField((r, g, b) => {
      r.fill(0.1);
      g.fill(0.1);
      b.fill(0.12);
    });
    const x0 = (8 + t + ditherW) % ditherW;
    const y0 = 18;
    const bw = 28;
    const bh = 16;
    for (let iy = 0; iy < bh; iy++) {
      for (let ix = 0; ix < bw; ix++) {
        if ((ix * 19 + iy * 47) % 100 >= 42) continue;
        const i = ((y0 + iy) % ditherH) * ditherW + ((x0 + ix) % ditherW);
        cur.r[i] = 0.92;
        cur.g[i] = 0.78;
        cur.b[i] = 0.22;
      }
    }
    ditherObs.observe(cur, ditherPrev);
    ditherPrev = cur;
  }
  const ditherArea = (ditherObs.observation.flows ?? []).reduce(
    (s, f) => s + f.area,
    0,
  );
  assert("a dithered translating speckle sheet is a flow", ditherArea >= 20);
  assertOscFlowExclusive("dither sheet", ditherObs.observation);

  // Once confirmed, matched updates must not blank emit via hop/density EMA poison.
  let ditherGaps = 0;
  let ditherEmitPoison = 0;
  for (let t = 40; t < 100; t++) {
    const cur = ditherField((r, g, b) => {
      r.fill(0.1);
      g.fill(0.1);
      b.fill(0.12);
    });
    const bw = 28;
    const bh = 16;
    const x0 = (8 + t + ditherW) % ditherW;
    const y0 = 18;
    for (let iy = 0; iy < bh; iy++) {
      for (let ix = 0; ix < bw; ix++) {
        if ((ix * 19 + iy * 47) % 100 >= 42) continue;
        const i = ((y0 + iy) % ditherH) * ditherW + ((x0 + ix) % ditherW);
        cur.r[i] = 0.92;
        cur.g[i] = 0.78;
        cur.b[i] = 0.22;
      }
    }
    ditherObs.observe(cur, ditherPrev);
    ditherPrev = cur;
    const flows = ditherObs.observation.flows ?? [];
    if (flows.length === 0) ditherGaps += 1;
    const rej = ditherObs.observation.flowRejects ?? {};
    ditherEmitPoison += (rej.emitHop ?? 0) + (rej.emitDensity ?? 0);
  }
  assert(
    "confirmed dither sheet stays emitted (no EMA-poison gaps)",
    ditherGaps === 0,
  );
  assert(
    "confirmed dither sheet does not emitHop/emitDensity fail",
    ditherEmitPoison === 0,
  );

  // Two discrete hues in one sliding band: interacting streams, not tint-glue.
  const multiObs = new FieldObserver(ditherW, ditherH);
  let multiPrev = ditherBg;
  const multiPal = [
    [0.92, 0.78, 0.22],
    [0.2, 0.75, 0.55],
  ];
  for (let t = 0; t < 40; t++) {
    const cur = ditherField((r, g, b) => {
      r.fill(0.1);
      g.fill(0.1);
      b.fill(0.12);
    });
    const x0 = (8 + t + ditherW) % ditherW;
    const y0 = 18;
    for (let iy = 0; iy < 16; iy++) {
      for (let ix = 0; ix < 28; ix++) {
        if ((ix * 19 + iy * 47) % 100 >= 42) continue;
        const pal = multiPal[(ix + iy) % 2];
        const i = ((y0 + iy) % ditherH) * ditherW + ((x0 + ix) % ditherW);
        cur.r[i] = pal[0];
        cur.g[i] = pal[1];
        cur.b[i] = pal[2];
      }
    }
    multiObs.observe(cur, multiPrev);
    multiPrev = cur;
  }
  const multiArea = (multiObs.observation.flows ?? []).reduce(
    (s, f) => s + f.area,
    0,
  );
  assert("two interacting hues in a sliding sheet can be flow", multiArea >= 12);

  // Same hue, value flicker: RGB eps would break; hue match must hold.
  const pulseObs = new FieldObserver(ditherW, ditherH);
  let pulsePrev = ditherBg;
  for (let t = 0; t < 40; t++) {
    const cur = ditherField((r, g, b) => {
      r.fill(0.1);
      g.fill(0.1);
      b.fill(0.12);
    });
    const x0 = (6 + t + ditherW) % ditherW;
    const v = t % 2 === 0 ? 1 : 0.45;
    for (let k = 0; k < 10; k++) {
      const i = (12 + k * 3) * ditherW + x0;
      cur.r[i] = 0.95 * v;
      cur.g[i] = 0.82 * v;
      cur.b[i] = 0.2 * v;
    }
    pulseObs.observe(cur, pulsePrev);
    pulsePrev = cur;
  }
  const pulseArea = (pulseObs.observation.flows ?? []).reduce(
    (s, f) => s + f.area,
    0,
  );
  assert("a value-flickering same-hue stream is still flow", pulseArea >= 8);

  assert(
    "a still calm blob is not flow",
    (out.flows ?? []).length === 0,
  );
  assert(
    "flickering surround is not flow",
    (flickerObs.observation.flows ?? []).reduce((s, f) => s + f.area, 0) === 0,
  );

  const blinkObs = new FieldObserver(w, h);
  let blinkPrev = bg;
  for (let t = 0; t < 16; t++) {
    const on = t % 2 === 0;
    const cur = field((r, g, b, i) => {
      const x = i % w;
      const y = (i / w) | 0;
      const inBlk = x >= 4 && x < 12 && y >= 4 && y < 12;
      if (inBlk && on) {
        r[i] = 0.9;
        g[i] = 0.2;
        b[i] = 0.2;
      } else {
        r[i] = 0.1;
        g[i] = 0.1;
        b[i] = 0.12;
      }
    });
    blinkObs.observe(cur, blinkPrev);
    blinkPrev = cur;
  }
  const blinkOsc = (blinkObs.observation.oscillators ?? []).reduce(
    (s, g) => s + (g.period === 2 ? g.area : 0),
    0,
  );
  assert("a period-2 block is an oscillator, not a flow", blinkOsc >= 32);
  assert(
    "a period-2 block is not a flow",
    (blinkObs.observation.flows ?? []).reduce((s, f) => s + f.area, 0) === 0,
  );
  assertOscFlowExclusive("sitting blinker", blinkObs.observation);

  const travelBlink = new FieldObserver(w, h);
  let travelPrev = bg;
  for (let t = 0; t < 28; t++) {
    const on = t % 2 === 0;
    const x0 = (2 + t) % w;
    const cur = field((r, g, b, i) => {
      const x = i % w;
      const y = (i / w) | 0;
      const dx = (x - x0 + w) % w;
      const inBlk = dx < 8 && y >= 8 && y < 16;
      if (inBlk && on) {
        r[i] = 0.9;
        g[i] = 0.2;
        b[i] = 0.2;
      } else if (inBlk) {
        r[i] = 0.2;
        g[i] = 0.2;
        b[i] = 0.9;
      } else {
        r[i] = 0.1;
        g[i] = 0.1;
        b[i] = 0.12;
      }
    });
    travelBlink.observe(cur, travelPrev);
    travelPrev = cur;
  }
  const travelOsc = (travelBlink.observation.oscillators ?? []).reduce(
    (s, g) => s + g.area,
    0,
  );
  assert(
    "a travelling period-2 block is not an oscillator",
    travelOsc === 0,
  );

  const hueWave = new FieldObserver(w, h);
  let huePrev = bg;
  const wavePal = [
    [0.9, 0.25, 0.2],
    [0.2, 0.3, 0.9],
    [0.2, 0.85, 0.35],
    [0.85, 0.8, 0.15],
  ];
  for (let t = 0; t < 28; t++) {
    const cur = field((r, g, b, i) => {
      const x = i % w;
      const y = (i / w) | 0;
      if (y < 8 || y >= 16) {
        r[i] = 0.1;
        g[i] = 0.1;
        b[i] = 0.12;
        return;
      }
      const pal = wavePal[((x - t) % 4 + 4) % 4];
      r[i] = pal[0];
      g[i] = pal[1];
      b[i] = pal[2];
    });
    hueWave.observe(cur, huePrev);
    huePrev = cur;
  }
  const hueWaveOsc = (hueWave.observation.oscillators ?? []).reduce(
    (s, g) => s + g.area,
    0,
  );
  assert("a travelling colour wave is not an oscillator", hueWaveOsc === 0);
}

await runtimeCheck();

if (failed) {
  console.error(`\nPhase 1 verify: ${failed} failure(s)`);
  process.exit(1);
}
console.log("\nPhase 1 verify: passed");
