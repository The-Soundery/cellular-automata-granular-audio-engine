/**
 * Offline check: calm lit listening floor + dense wash overlap.
 * Run: node scripts/verify-dual-pool.mjs
 */
const W = 64;
const H = 64;
const N = W * H;
const LUMINANCE_GATE = 0.025;
const SUSTAIN_COHERENCE_MIN = 0.3;
const CALM_LISTEN_MIN = 8;
const CALM_LISTEN_MAX = 14;
const BUSY_VOICE_CEILING = 32;
const ENERGY_TARGET = 0.26;
const ENERGY_SILENCE = 0.03;
const MASTER_GAIN_MAX = 2.5;
const MIN_DIST_SUSTAIN = 11;
const INTERIOR_CLIMB_RADIUS = 7;

function brightness(r, g, b) {
  return (r + g + b) / 3;
}
function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}
function makeField(fn) {
  const r = new Float32Array(N);
  const g = new Float32Array(N);
  const b = new Float32Array(N);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const c = fn(x, y);
      r[i] = c[0];
      g[i] = c[1];
      b[i] = c[2];
    }
  }
  return { r, g, b };
}
function toroidalDist2(a, b) {
  const ax = a % W;
  const ay = (a / W) | 0;
  const bx = b % W;
  const by = (b / W) | 0;
  let dx = Math.abs(ax - bx);
  let dy = Math.abs(ay - by);
  dx = Math.min(dx, W - dx);
  dy = Math.min(dy, H - dy);
  return dx * dx + dy * dy;
}

function analyze(current, previous) {
  const coherence = new Float32Array(N);
  const variance = new Float32Array(N);
  const sustainScore = new Float32Array(N);
  const lum = new Float32Array(N);
  let energySum = 0;
  let varSumField = 0;
  let deltaSumField = 0;
  let cohSumLit = 0;
  let litCount = 0;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const sr = current.r[i];
      const sg = current.g[i];
      const sb = current.b[i];
      const L = brightness(sr, sg, sb);
      lum[i] = L;
      energySum += L;

      let absDiff = 0;
      let count = 0;
      let meanR = 0;
      let meanG = 0;
      let meanB = 0;
      const samples = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = (x + dx + W) % W;
          const ny = (y + dy + H) % H;
          const ni = ny * W + nx;
          const nr = current.r[ni];
          const ng = current.g[ni];
          const nb = current.b[ni];
          absDiff +=
            (Math.abs(nr - sr) + Math.abs(ng - sg) + Math.abs(nb - sb)) / 3;
          meanR += nr;
          meanG += ng;
          meanB += nb;
          samples.push(nr, ng, nb);
          count++;
        }
      }
      const inv = 1 / count;
      meanR *= inv;
      meanG *= inv;
      meanB *= inv;
      let vSum = 0;
      for (let s = 0; s < samples.length; s += 3) {
        const dr = samples[s] - meanR;
        const dg = samples[s + 1] - meanG;
        const db = samples[s + 2] - meanB;
        vSum += (dr * dr + dg * dg + db * db) / 3;
      }
      coherence[i] = 1 - absDiff * inv;
      variance[i] = vSum * inv;
      varSumField += variance[i];
      const d =
        (Math.abs(sr - previous.r[i]) +
          Math.abs(sg - previous.g[i]) +
          Math.abs(sb - previous.b[i])) /
        3;
      deltaSumField += d;
      const stab = 1 - d;
      const flat = clamp01(1 - variance[i]);
      sustainScore[i] = L * flat * flat * (coherence[i] + 0.08) * (stab + 0.1);
      if (L >= LUMINANCE_GATE) {
        cohSumLit += coherence[i];
        litCount++;
      }
    }
  }

  const energy = energySum / N;
  const masterGain =
    energy >= ENERGY_SILENCE
      ? Math.min(MASTER_GAIN_MAX, ENERGY_TARGET / energy)
      : 0;

  const meanVar = varSumField / N;
  const meanDelta = deltaSumField / N;
  const meanCohLit = litCount > 0 ? cohSumLit / litCount : 0;
  const litFraction = litCount / N;
  const structural =
    clamp01(meanVar * 8) * 0.45 +
    clamp01(meanDelta * 10) * 0.45 +
    clamp01(1 - meanCohLit) * 0.1;
  const activity = Math.pow(structural, 1.35);
  const coherentLit = litFraction * meanCohLit;
  const calmListen = Math.round(
    CALM_LISTEN_MIN + coherentLit * (CALM_LISTEN_MAX - CALM_LISTEN_MIN),
  );
  const voiceBudget =
    energy < ENERGY_SILENCE
      ? 0
      : Math.max(
          calmListen,
          Math.min(
            BUSY_VOICE_CEILING,
            Math.round(calmListen + activity * (BUSY_VOICE_CEILING - calmListen)),
          ),
        );

  const sustainFrac = 0.9 - activity * 0.5;
  const sustainSlots = Math.max(
    1,
    Math.min(voiceBudget, Math.round(voiceBudget * sustainFrac)),
  );

  const sustainOrder = Array.from({ length: N }, (_, i) => i).sort(
    (a, b) => sustainScore[b] - sustainScore[a],
  );

  function climb(seed) {
    let best = seed;
    let bestScore = -Infinity;
    const sx = seed % W;
    const sy = (seed / W) | 0;
    for (let dy = -INTERIOR_CLIMB_RADIUS; dy <= INTERIOR_CLIMB_RADIUS; dy++) {
      for (let dx = -INTERIOR_CLIMB_RADIUS; dx <= INTERIOR_CLIMB_RADIUS; dx++) {
        const x = (sx + dx + W) % W;
        const y = (sy + dy + H) % H;
        const i = y * W + x;
        if (lum[i] < LUMINANCE_GATE) continue;
        const flatness = clamp01(1 - variance[i]);
        if (flatness < 0.5) continue;
        const score = sustainScore[i] * (0.2 + 0.8 * flatness * flatness);
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      }
    }
    return bestScore > -Infinity ? best : seed;
  }

  const sustain = [];
  const covered = new Uint8Array(N);
  if (voiceBudget > 0) {
    for (const raw of sustainOrder) {
      if (sustain.length >= sustainSlots) break;
      if (covered[raw]) continue;
      if (lum[raw] < LUMINANCE_GATE) continue;
      if (coherence[raw] < SUSTAIN_COHERENCE_MIN) continue;
      const i = climb(raw);
      if (covered[i] || lum[i] < LUMINANCE_GATE) continue;
      let ok = true;
      for (const s of sustain) {
        if (toroidalDist2(i, s) < MIN_DIST_SUSTAIN * MIN_DIST_SUSTAIN) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      sustain.push(i);
      const cx = i % W;
      const cy = (i / W) | 0;
      for (let dy = -11; dy <= 11; dy++) {
        for (let dx = -11; dx <= 11; dx++) {
          covered[(((cy + dy + H) % H) * W + ((cx + dx + W) % W))] = 1;
        }
      }
    }
  }

  return { energy, masterGain, sustain, voiceBudget, activity, calmListen };
}

function washOverlapFrac(overlap, persistence) {
  let advance;
  if (overlap >= 0.65) advance = 0.5 + 0.3 * overlap;
  else advance = 0.12 + 0.45 * overlap;
  advance *= 1 - 0.22 * persistence;
  if (overlap >= 0.65) advance = Math.max(0.42, advance);
  return advance;
}

const checks = [];
function assert(name, cond, detail = "") {
  checks.push({ name, ok: !!cond, detail });
}

const calm = makeField(() => [0.15, 0.7, 0.12]);
const rCalm = analyze(calm, calm);
assert(
  "calm lit → listening floor ≥8",
  rCalm.voiceBudget >= 8 && rCalm.voiceBudget <= 16,
  `budget=${rCalm.voiceBudget} calmListen=${rCalm.calmListen}`,
);
assert(
  "calm → many sustain washes",
  rCalm.sustain.length >= 6,
  `n=${rCalm.sustain.length}`,
);

const prev = makeField((x, y) => ((x + y) & 1 ? [0.9, 0.1, 0.1] : [0.1, 0.1, 0.9]));
const next = makeField((x, y) => ((x + y) & 1 ? [0.1, 0.1, 0.9] : [0.9, 0.1, 0.1]));
const rBusy = analyze(next, prev);
assert(
  "busy → higher budget",
  rBusy.voiceBudget >= 20,
  `budget=${rBusy.voiceBudget}`,
);

const black = makeField(() => [0, 0, 0]);
const rBlack = analyze(black, black);
assert("black → budget 0", rBlack.voiceBudget === 0);

const ov = washOverlapFrac(0.9, 0.85);
assert(
  "wash stacks ≥42% into prior grain",
  ov >= 0.42,
  `advance/overlapFrac=${ov.toFixed(3)}`,
);
assert(
  "wash stacks substantially (continuous cloud)",
  ov >= 0.5,
  `advance=${ov.toFixed(3)}`,
);

for (const c of checks) {
  console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}${c.detail ? " — " + c.detail : ""}`);
}
const failed = checks.filter((c) => !c.ok);
if (failed.length) {
  console.error(`\n${failed.length} check(s) failed`);
  process.exit(1);
}
console.log(`\nAll ${checks.length} checks passed`);
