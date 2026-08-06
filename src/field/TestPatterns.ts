import type { RgbField } from "./FrameObserver.ts";

export interface TestPattern {
  id: string;
  label: string;
  /** Overwrites every cell of `field` for the given step (30 steps/s). */
  fill(field: RgbField, step: number): void;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hsv2rgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0:
      return [v, t, p];
    case 1:
      return [q, v, p];
    case 2:
      return [p, v, t];
    case 3:
      return [p, q, v];
    case 4:
      return [t, p, v];
    default:
      return [v, p, q];
  }
}

/** Frozen noise generated once (seed 1234), reused across steps. */
function makeFrozenNoise(n: number): {
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
} {
  const rng = mulberry32(1234);
  const r = new Float32Array(n);
  const g = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    r[i] = rng();
    g[i] = rng();
    b[i] = rng();
  }
  return { r, g, b };
}

let frozenCache: {
  n: number;
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
} | null = null;

function frozenNoise(n: number) {
  if (!frozenCache || frozenCache.n !== n) {
    const f = makeFrozenNoise(n);
    frozenCache = { n, ...f };
  }
  return frozenCache;
}

function fillUniform(
  field: RgbField,
  r: number,
  g: number,
  b: number,
): void {
  field.r.fill(r);
  field.g.fill(g);
  field.b.fill(b);
}

function fillDisc(
  field: RgbField,
  cx: number,
  cy: number,
  radius: number,
  r: number,
  g: number,
  b: number,
): void {
  const { width: w, height: h } = field;
  const r2 = radius * radius;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) {
        const i = y * w + x;
        field.r[i] = r;
        field.g[i] = g;
        field.b[i] = b;
      }
    }
  }
}

function fillBlock(
  field: RgbField,
  x0: number,
  y0: number,
  bw: number,
  bh: number,
  r: number,
  g: number,
  b: number,
): void {
  const { width: w, height: h } = field;
  for (let y = y0; y < y0 + bh && y < h; y++) {
    for (let x = x0; x < x0 + bw && x < w; x++) {
      if (x < 0 || y < 0) continue;
      const i = y * w + x;
      field.r[i] = r;
      field.g[i] = g;
      field.b[i] = b;
    }
  }
}

function fillMovingBar(
  field: RgbField,
  step: number,
  dir: number,
): void {
  const { width: w, height: h } = field;
  const x0 = ((dir > 0 ? step : -step) % w + w) % w;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const inBar = ((x - x0 + w) % w) < 8;
      if (inBar) {
        field.r[i] = 0.9;
        field.g[i] = 0.3;
        field.b[i] = 0.1;
      } else {
        field.r[i] = 0.12;
        field.g[i] = 0.12;
        field.b[i] = 0.14;
      }
    }
  }
}

const GLIDER_DIRS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, -1],
];

export const TEST_PATTERNS: TestPattern[] = [
  {
    id: "uniform-static",
    label: "Uniform static",
    fill(field) {
      fillUniform(field, 0.2, 0.55, 0.85);
    },
  },
  {
    id: "hue-drift",
    label: "Uniform slow hue drift",
    fill(field, step) {
      const [r, g, b] = hsv2rgb((step * 0.0006) % 1, 0.8, 0.8);
      fillUniform(field, r, g, b);
    },
  },
  {
    id: "frozen-noise",
    label: "Frozen noise",
    fill(field) {
      const n = field.width * field.height;
      const f = frozenNoise(n);
      field.r.set(f.r);
      field.g.set(f.g);
      field.b.set(f.b);
    },
  },
  {
    id: "checkerboard-static",
    label: "Static checkerboard",
    fill(field) {
      const { width: w, height: h } = field;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const v = (x + y) % 2 === 0 ? 0.35 : 0.65;
          field.r[i] = v;
          field.g[i] = v;
          field.b[i] = v;
        }
      }
    },
  },
  {
    id: "half-half",
    label: "Half calm / half chaos",
    fill(field, step) {
      const { width: w, height: h } = field;
      const rng = mulberry32(9000 + step);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (x < w / 2) {
            field.r[i] = 0.2;
            field.g[i] = 0.55;
            field.b[i] = 0.85;
          } else {
            field.r[i] = rng();
            field.g[i] = rng();
            field.b[i] = rng();
          }
        }
      }
    },
  },
  {
    id: "moving-bar",
    label: "Moving bar (right)",
    fill(field, step) {
      fillMovingBar(field, step, 1);
    },
  },
  {
    id: "full-flicker",
    label: "Full flicker noise",
    fill(field, step) {
      const n = field.width * field.height;
      const rng = mulberry32(50000 + step);
      for (let i = 0; i < n; i++) {
        field.r[i] = rng();
        field.g[i] = rng();
        field.b[i] = rng();
      }
    },
  },
  {
    id: "blinker-fast",
    label: "Blinker fast (period 2)",
    fill(field, step) {
      fillUniform(field, 0.15, 0.15, 0.18);
      const on = step % 2 === 0;
      const r = on ? 0.9 : 0.2;
      const g = 0.2;
      const b = on ? 0.2 : 0.9;
      const { width: w, height: h } = field;
      const x0 = ((w - 40) / 2) | 0;
      const y0 = ((h - 40) / 2) | 0;
      fillBlock(field, x0, y0, 40, 40, r, g, b);
    },
  },
  {
    id: "blinker-slow",
    label: "Blinker slow (period 6)",
    fill(field, step) {
      // 6-step colour cycle (every frame differs from t−2/t−3) → fundamental period 6.
      fillUniform(field, 0.15, 0.15, 0.18);
      const phase = ((step % 6) + 6) % 6;
      const [r, g, b] = hsv2rgb(phase / 6, 0.85, 0.9);
      const { width: w, height: h } = field;
      const x0 = ((w - 40) / 2) | 0;
      const y0 = ((h - 40) / 2) | 0;
      fillBlock(field, x0, y0, 40, 40, r, g, b);
    },
  },
  {
    id: "breathing-uniform",
    label: "Breathing uniform",
    fill(field, step) {
      const v = 0.55 + 0.15 * Math.sin((2 * Math.PI * step) / 90);
      const [r, g, b] = hsv2rgb(0.55, 0.7, v);
      fillUniform(field, r, g, b);
    },
  },
  {
    id: "gradient-static",
    label: "Static hue gradient",
    fill(field) {
      const { width: w, height: h } = field;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const [r, g, b] = hsv2rgb(x / w, 0.7, 0.8);
          field.r[i] = r;
          field.g[i] = g;
          field.b[i] = b;
        }
      }
    },
  },
  {
    id: "two-blobs-merge",
    label: "Two blobs merge",
    fill(field, step) {
      // Full frozen-noise bg fails local similarity → not calm; only discs are.
      const n = field.width * field.height;
      const f = frozenNoise(n);
      field.r.set(f.r);
      field.g.set(f.g);
      field.b.set(f.b);
      const { width: w, height: h } = field;
      const cy = h / 2;
      const startSep = 70;
      // Fully overlapped by step ~200 so measure window sees the merge.
      const approach = Math.min(startSep, step * 0.35);
      const half = (startSep - approach) / 2;
      const cx0 = w / 2 - half;
      const cx1 = w / 2 + half;
      // Colours within 0.08 RGB of each other.
      fillDisc(field, cx0, cy, 18, 0.72, 0.38, 0.28);
      fillDisc(field, cx1, cy, 18, 0.68, 0.42, 0.32);
    },
  },
  {
    id: "bar-left",
    label: "Moving bar (left)",
    fill(field, step) {
      fillMovingBar(field, step, -1);
    },
  },
  {
    id: "glider-swarm",
    label: "Glider swarm",
    fill(field, step) {
      fillUniform(field, 0.12, 0.12, 0.14);
      const { width: w, height: h } = field;
      const starts: [number, number][] = [
        [20, 20],
        [90, 30],
        [40, 80],
        [100, 90],
        [60, 50],
        [30, 100],
      ];
      for (let g = 0; g < 6; g++) {
        const [dx, dy] = GLIDER_DIRS[g]!;
        const [sx, sy] = starts[g]!;
        const x0 = (((sx + step * dx) % w) + w) % w;
        const y0 = (((sy + step * dy) % h) + h) % h;
        for (let oy = 0; oy < 3; oy++) {
          for (let ox = 0; ox < 3; ox++) {
            const x = (x0 + ox) % w;
            const y = (y0 + oy) % h;
            const i = y * w + x;
            field.r[i] = 0.95;
            field.g[i] = 0.85;
            field.b[i] = 0.2;
          }
        }
      }
    },
  },
];

/** Render a pattern step into an RGBA byte buffer (for the app path). */
export function fillRgba(
  p: TestPattern,
  buf: Uint8ClampedArray,
  w: number,
  h: number,
  step: number,
): void {
  const n = w * h;
  const field: RgbField = {
    width: w,
    height: h,
    r: new Float32Array(n),
    g: new Float32Array(n),
    b: new Float32Array(n),
  };
  p.fill(field, step);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    buf[o] = Math.round(clamp01(field.r[i]!) * 255);
    buf[o + 1] = Math.round(clamp01(field.g[i]!) * 255);
    buf[o + 2] = Math.round(clamp01(field.b[i]!) * 255);
    buf[o + 3] = 255;
  }
}

export function getTestPattern(id: string): TestPattern | undefined {
  return TEST_PATTERNS.find((p) => p.id === id);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
