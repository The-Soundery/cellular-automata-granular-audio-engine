/**
 * Offline check: structure extraction + neutral allocation sizing.
 * Run: node scripts/verify-dual-pool.mjs
 */
const W = 64;
const H = 64;
const N = W * H;
const LUMINANCE_GATE = 0.025;

function brightness(r, g, b) {
  return (r + g + b) / 3;
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
  return { width: W, height: H, r, g, b };
}

function rgbDist(r0, g0, b0, r1, g1, b1) {
  return (Math.abs(r0 - r1) + Math.abs(g0 - g1) + Math.abs(b0 - b1)) / 3;
}

function extract(field) {
  const { width: w, height: h, r, g, b } = field;
  const visited = new Uint8Array(N);
  const regions = [];
  const RGB_MERGE_EPS = 0.14;
  const stack = new Int32Array(N);

  for (let seed = 0; seed < N; seed++) {
    if (visited[seed]) continue;
    if (brightness(r[seed], g[seed], b[seed]) < LUMINANCE_GATE) {
      visited[seed] = 1;
      continue;
    }
    let meanR = r[seed];
    let meanG = g[seed];
    let meanB = b[seed];
    let count = 0;
    let sp = 0;
    stack[sp++] = seed;
    visited[seed] = 1;
    const cells = [];
    while (sp > 0) {
      const i = stack[--sp];
      if (
        count > 0 &&
        rgbDist(r[i], g[i], b[i], meanR, meanG, meanB) >= RGB_MERGE_EPS
      ) {
        continue;
      }
      cells.push(i);
      count++;
      const inv = 1 / count;
      meanR += (r[i] - meanR) * inv;
      meanG += (g[i] - meanG) * inv;
      meanB += (b[i] - meanB) * inv;
      const x = i % w;
      const y = (i / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = (x + dx + w) % w;
          const ny = (y + dy + h) % h;
          const ni = ny * w + nx;
          if (visited[ni]) continue;
          if (brightness(r[ni], g[ni], b[ni]) < LUMINANCE_GATE) {
            visited[ni] = 1;
            continue;
          }
          if (rgbDist(r[ni], g[ni], b[ni], meanR, meanG, meanB) >= RGB_MERGE_EPS) {
            continue;
          }
          visited[ni] = 1;
          stack[sp++] = ni;
        }
      }
    }
    if (cells.length < 12) continue;
    let mass = 0;
    for (const i of cells) mass += brightness(r[i], g[i], b[i]);
    regions.push({ area: cells.length, mass });
  }
  return regions.sort((a, b) => b.mass - a.mass);
}

function probeCountFor(area) {
  return Math.max(1, Math.min(5, Math.round(Math.sqrt(area) / 4.5)));
}

const checks = [];
function assert(name, cond, detail = "") {
  checks.push({ name, ok: !!cond, detail });
}

const blob = makeField((x, y) => {
  const inBlob = x >= 10 && x < 40 && y >= 10 && y < 40;
  return inBlob ? [0.8, 0.2, 0.15] : [0, 0, 0];
});
const regions = extract(blob);
assert("large coherent blob → few regions", regions.length >= 1 && regions.length <= 3, `n=${regions.length}`);
assert("blob area substantial", regions[0].area >= 400, `area=${regions[0]?.area}`);
assert("large area → multiple probes", probeCountFor(regions[0].area) >= 3, `probes=${probeCountFor(regions[0].area)}`);

const small = makeField((x, y) => {
  const hit = x >= 5 && x < 9 && y >= 5 && y < 9;
  return hit ? [0.5, 0.5, 0.1] : [0, 0, 0];
});
const smallRegs = extract(small);
assert("small structure → ≥1 region", smallRegs.length >= 1, `n=${smallRegs.length}`);
assert("small → 1 probe", probeCountFor(smallRegs[0]?.area || 16) === 1);

const black = makeField(() => [0, 0, 0]);
assert("black → no regions", extract(black).length === 0);

const two = makeField((x, y) => {
  if (x >= 2 && x < 12 && y >= 2 && y < 12) return [0.9, 0.1, 0.1];
  if (x >= 40 && x < 55 && y >= 40 && y < 55) return [0.1, 0.1, 0.9];
  return [0, 0, 0];
});
const twoRegs = extract(two);
assert("two colour regions → ≥2", twoRegs.length >= 2, `n=${twoRegs.length}`);

for (const c of checks) {
  console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}${c.detail ? " — " + c.detail : ""}`);
}
const failed = checks.filter((c) => !c.ok);
if (failed.length) {
  console.error(`\n${failed.length} check(s) failed`);
  process.exit(1);
}
console.log(`\nAll ${checks.length} checks passed`);
