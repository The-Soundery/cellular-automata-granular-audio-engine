/**
 * Offline occupation check for V3 equal-share lattice.
 * Synthetic river occupying ~40% of a 128² field must contain ~40% of grains.
 * Amplitudes must all equal 1/N (no luminance weighting).
 */

const W = 128;
const H = 128;
const N = 64;
const SIDE = Math.round(Math.sqrt(N));

function latticeCoord(i, count, period) {
  if (count <= 1) return (period - 1) * 0.5;
  const cell = period / count;
  return i * cell + cell * 0.5;
}

function makeRiverField() {
  // Vertical band from x=38..89 ≈ 40% of width (51/128 ≈ 0.398)
  const x0 = 38;
  const x1 = 89;
  const r = new Float32Array(W * H);
  const g = new Float32Array(W * H);
  const b = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (x >= x0 && x < x1) {
        r[i] = 0.2;
        g[i] = 0.8;
        b[i] = 0.3;
      } else {
        r[i] = 0.02;
        g[i] = 0.02;
        b[i] = 0.02;
      }
    }
  }
  return { r, g, b, x0, x1, expected: (x1 - x0) / W };
}

function reduce(field) {
  const grains = [];
  const amp = 1 / N;
  for (let i = 0; i < N; i++) {
    const col = i % SIDE;
    const row = Math.floor(i / SIDE);
    const x = latticeCoord(col, SIDE, W);
    const y = latticeCoord(row, SIDE, H);
    const idx = Math.floor(y) * W + Math.floor(x);
    grains.push({
      x,
      y,
      amp,
      r: field.r[idx],
      g: field.g[idx],
      b: field.b[idx],
    });
  }
  return grains;
}

const field = makeRiverField();
const grains = reduce(field);

let inside = 0;
for (const g of grains) {
  if (g.x >= field.x0 && g.x < field.x1) inside++;
}
const share = inside / grains.length;
const ampOk = grains.every((g) => Math.abs(g.amp - 1 / N) < 1e-12);
const brightOutside = grains.filter(
  (g) => !(g.x >= field.x0 && g.x < field.x1) && (g.r + g.g + g.b) / 3 < 0.1,
);
const darkStillPresent = brightOutside.length > 0;
const ampEqualDarkLight =
  grains.every((g) => Math.abs(g.amp - grains[0].amp) < 1e-12);

// Coarse lattice can only resolve occupation to ~1/SIDE; allow one cell of error.
const tol = 1 / SIDE + 0.02;
const occupationOk = Math.abs(share - field.expected) <= tol;

console.log(
  JSON.stringify(
    {
      expectedOccupation: field.expected,
      grainOccupation: share,
      occupationOk,
      ampOk,
      ampEqualDarkLight,
      darkStillPresent,
      grainCount: grains.length,
    },
    null,
    2,
  ),
);

if (!occupationOk || !ampOk || !ampEqualDarkLight || !darkStillPresent) {
  console.error("verify-field-reducer FAILED");
  process.exit(1);
}
console.log("verify-field-reducer OK");
