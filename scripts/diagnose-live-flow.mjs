/**
 * Live-like flow recognition sanity check (not part of CI gate).
 * Run: node --experimental-strip-types scripts/diagnose-live-flow.mjs
 */
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { FieldObserver } = await import(
  pathToFileURL(join(root, "src/field/FieldObserver.ts")).href
);

const W = 128;
const H = 128;
const N = W * H;

function blank() {
  return {
    r: new Float32Array(N),
    g: new Float32Array(N),
    b: new Float32Array(N),
  };
}

function clone(f) {
  return {
    r: new Float32Array(f.r),
    g: new Float32Array(f.g),
    b: new Float32Array(f.b),
  };
}

function paint(f, x, y, r, g, b) {
  const i = ((y + H) % H) * W + ((x + W) % W);
  f.r[i] = r;
  f.g[i] = g;
  f.b[i] = b;
}

function runCase(name, makeFrames, frames = 40) {
  const obs = new FieldObserver(W, H);
  let prev = blank();
  let maxArea = 0;
  let lastFlows = 0;
  for (let t = 0; t < frames; t++) {
    const cur = makeFrames(t, blank());
    obs.observe(cur, prev);
    prev = cur;
    const flows = obs.observation.flows ?? [];
    lastFlows = flows.length;
    const area = flows.reduce((s, f) => s + f.area, 0);
    if (area > maxArea) maxArea = area;
  }
  const ok = maxArea > 0;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name.padEnd(28)} maxFlowArea=${maxArea} lastFlows=${lastFlows}`,
  );
  return ok;
}

let pass = 0;
let fail = 0;

function check(name, fn) {
  const ok = runCase(name, fn);
  if (ok) pass++;
  else fail++;
}

check("harness-dense-train", (t, f) => {
  // Gappy pack (matches phase1 dense): solid slides look like stamps.
  for (let iy = 0; iy < 5; iy++) {
    for (let ix = 0; ix < 5; ix++) {
      const x = (10 + t + ix * 3) % W;
      const y = 40 + iy * 3;
      paint(f, x, y, 0.95, 0.82, 0.2);
    }
  }
  return f;
});

check("soft-tint-stream", (t, f) => {
  for (let k = 0; k < 24; k++) {
    const x = (20 + t + (k % 8) * 2) % W;
    const y = 60 + ((k / 8) | 0) * 2;
    paint(f, x, y, 0.72, 0.55, 0.38);
  }
  return f;
});

check("busy-field-train", (t, f) => {
  for (let i = 0; i < N; i++) {
    if (((i * 1103515245 + t * 12345) >>> 0) % 100 < 35) {
      const v = ((i * 7 + t * 3) % 50) / 100;
      f.r[i] = v;
      f.g[i] = v * 0.9;
      f.b[i] = v * 0.8;
    }
  }
  for (let iy = 0; iy < 4; iy++) {
    for (let ix = 0; ix < 8; ix++) {
      if ((ix + iy) % 2 === 0) continue;
      const x = (5 + t + ix * 2) % W;
      const y = 30 + iy * 2;
      paint(f, x, y, 0.95, 0.82, 0.2);
    }
  }
  return f;
});

check("joined-ribbon-hop", (t, f) => {
  for (let k = 0; k < 40; k++) {
    const x = (15 + t + ((k / 2) | 0)) % W;
    const y = 50 + (k % 3) * 2;
    if (k % 2 === 0) paint(f, x, y, 0.2, 0.75, 0.9);
  }
  return f;
});

check("large-hue-stream", (t, f) => {
  for (let i = 0; i < N; i++) {
    f.r[i] = 0.12;
    f.g[i] = 0.12;
    f.b[i] = 0.12;
  }
  // Many same-hue dashes — enough active orange to trip old per-bin commonCut,
  // but gappy so it is not a sliding stamp.
  for (let k = 0; k < 120; k++) {
    const x = (3 + t + (k % 40) * 2) % W;
    const y = 36 + ((k / 40) | 0) * 3;
    paint(f, x, y, 0.9, 0.45, 0.1);
    paint(f, (x + 1) % W, y, 0.9, 0.45, 0.1);
  }
  return f;
});

check("vertical-cascade", (t, f) => {
  for (let k = 0; k < 36; k++) {
    const y = (8 + t + (k % 12)) % H;
    const x = 64 + ((k / 12) | 0) * 2 + (k % 2);
    paint(f, x, y, 0.85, 0.3, 0.55);
  }
  return f;
});

// Clip 3: travelling red diagonals on a still gold field (calm-edge wavefront).
check("calm-edge-diagonals", (t, f) => {
  for (let i = 0; i < N; i++) {
    f.r[i] = 0.82;
    f.g[i] = 0.68;
    f.b[i] = 0.18;
  }
  for (let band = 0; band < 3; band++) {
    const y0 = 20 + band * 28;
    for (let k = 0; k < 48; k++) {
      if (k % 2 === 1) continue;
      const x = (8 + t + k) % W;
      const y = (y0 + k) % H;
      paint(f, x, y, 0.92, 0.12, 0.1);
      paint(f, x, (y + 1) % H, 0.92, 0.12, 0.1);
    }
  }
  return f;
});

// Wavefront: only the changing front is active (interior of a band would be
// still). A tall dashed leading edge travelling +x on a still field.
check("wavefront-leading-edge", (t, f) => {
  for (let i = 0; i < N; i++) {
    f.r[i] = 0.12;
    f.g[i] = 0.12;
    f.b[i] = 0.14;
  }
  const x0 = (10 + t) % W;
  for (let iy = 0; iy < 48; iy++) {
    if (iy % 2 === 1) continue;
    paint(f, x0, 24 + iy, 0.2, 0.75, 0.9);
    paint(f, (x0 + 1) % W, 24 + iy, 0.2, 0.75, 0.9);
  }
  return f;
});

// Clip 2-ish: a dithered diagonal *stripe* that slides, not a whole-field fill.
check("dithered-diagonal-texture", (t, f) => {
  for (let i = 0; i < N; i++) {
    f.r[i] = 0.08;
    f.g[i] = 0.05;
    f.b[i] = 0.35;
  }
  for (let k = 0; k < 80; k++) {
    const x = (12 + t + k) % W;
    const y = (20 + k) % H;
    for (let s = 0; s < 4; s++) {
      const dither = ((x + s) * 13 + y * 7 + t) & 3;
      if (dither === 0) continue;
      paint(f, (x + s) % W, y, 0.75, 0.12, 0.12);
    }
  }
  return f;
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
