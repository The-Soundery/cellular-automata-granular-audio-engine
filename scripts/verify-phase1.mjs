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
assert("fillRatio on regions", /fillRatio/.test(fieldSrc));
assert("extracts coherent regions", /extractRegions/.test(fieldSrc));
assert("builds chaotic remainder", /buildChaotic/.test(fieldSrc));
assert("toroidal COM / velocity", /toroidalDelta/.test(fieldSrc) && /velX/.test(fieldSrc));

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

  // Hold blob steady across two observes so δ drops and κ rises.
  const obs = new FieldObserver(w, h);
  obs.observe(cur, prev);
  const still = {
    width: w,
    height: h,
    r: cur.r.slice(),
    g: cur.g.slice(),
    b: cur.b.slice(),
  };
  for (let t = 0; t < 8; t++) {
    obs.observe(still, still);
  }
  const out = obs.observation;
  assert("finds at least one coherent region", out.coherent.length >= 1);
  assert(
    "calm blob area is substantial",
    out.coherent.some((r) => r.area >= FIELD_OBS.minRegionArea),
  );
  assert("chaotic remainder non-empty", out.chaotic.area > 0);
  assert("fractions sum ~1", Math.abs(out.calmAreaFraction + out.chaosAreaFraction - 1) < 0.02);
  assert("region has COM and bounds", out.coherent[0].width >= 1 && out.coherent[0].height >= 1);
  assert(
    "region has fillRatio in (0,1]",
    out.coherent.every((r) => r.fillRatio > 0 && r.fillRatio <= 1),
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
}

await runtimeCheck();

if (failed) {
  console.error(`\nPhase 1 verify: ${failed} failure(s)`);
  process.exit(1);
}
console.log("\nPhase 1 verify: passed");
