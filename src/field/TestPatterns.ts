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
  {
    id: "flow-dots",
    label: "Flow dots (sparse — should be off)",
    fill(field, step) {
      fillUniform(field, 0.1, 0.1, 0.12);
      const { width: w, height: h } = field;
      const starts: [number, number][] = [
        [8, 20],
        [40, 55],
        [70, 15],
        [100, 90],
        [25, 100],
        [88, 40],
        [12, 70],
        [55, 8],
        [110, 60],
        [33, 33],
      ];
      for (const [sx, sy] of starts) {
        const x = (((sx + step * 2) % w) + w) % w;
        const y = ((sy % h) + h) % h;
        const i = y * w + x;
        field.r[i] = 0.95;
        field.g[i] = 0.82;
        field.b[i] = 0.2;
      }
    },
  },
  {
    id: "flow-dense",
    label: "Flow dense (packed particles)",
    fill(field, step) {
      fillUniform(field, 0.1, 0.1, 0.12);
      const { width: w, height: h } = field;
      const x0 = (((40 + step) % w) + w) % w;
      const y0 = 48;
      for (let iy = 0; iy < 5; iy++) {
        for (let ix = 0; ix < 5; ix++) {
          const x = (x0 + ix * 3) % w;
          const y = (y0 + iy * 3) % h;
          const i = y * w + x;
          field.r[i] = 0.95;
          field.g[i] = 0.82;
          field.b[i] = 0.2;
        }
      }
    },
  },
  {
    id: "flow-cascade",
    label: "Flow cascade (curved hop stream)",
    fill(field, step) {
      fillUniform(field, 0.1, 0.1, 0.12);
      const { width: w, height: h } = field;
      const y0 = (((6 + step) % h) + h) % h;
      for (let k = 0; k < 10; k++) {
        const x = (((10 + Math.round(Math.sin(k * 0.55) * 4)) % w) + w) % w;
        const y = (y0 + k * 3) % h;
        const i = y * w + x;
        field.r[i] = 0.15;
        field.g[i] = 0.85;
        field.b[i] = 0.55;
      }
    },
  },
  {
    id: "flow-wavefront",
    label: "Flow wavefront (staggered dashes)",
    fill(field, step) {
      fillUniform(field, 0.1, 0.1, 0.12);
      const { width: w, height: h } = field;
      const y0 = (((5 + step) % h) + h) % h;
      for (let col = 0; col < 4; col++) {
        const x = 40 + col * 4;
        for (let k = 0; k < 3; k++) {
          const y = (y0 + col + k * 4) % h;
          const i = y * w + (x % w);
          field.r[i] = 0.9;
          field.g[i] = 0.55;
          field.b[i] = 0.2;
        }
      }
    },
  },
  {
    id: "flow-dense-cascade",
    label: "Flow dense cascade (joined clumps)",
    fill(field, step) {
      fillUniform(field, 0.1, 0.1, 0.12);
      const { width: w, height: h } = field;
      const y0 = (((5 + step) % h) + h) % h;
      for (let k = 0; k < 5; k++) {
        const x0 = 48;
        const yBase = (y0 + k * 5) % h;
        for (let iy = 0; iy < 2; iy++) {
          for (let ix = 0; ix < 3; ix++) {
            const i = ((yBase + iy) % h) * w + ((x0 + ix) % w);
            field.r[i] = 0.85;
            field.g[i] = 0.35;
            field.b[i] = 0.2;
          }
        }
      }
    },
  },
  {
    id: "flow-dither",
    label: "Flow dither (sliding speckle sheet)",
    fill(field, step) {
      fillUniform(field, 0.1, 0.1, 0.12);
      const { width: w, height: h } = field;
      const bw = 40;
      const bh = 24;
      const x0 = (((16 + step) % w) + w) % w;
      const y0 = Math.min(40, h - bh - 1);
      for (let iy = 0; iy < bh; iy++) {
        for (let ix = 0; ix < bw; ix++) {
          const u = (ix * 19 + iy * 47) % 100;
          if (u >= 42) continue;
          const x = (x0 + ix) % w;
          const y = (y0 + iy) % h;
          const i = y * w + x;
          field.r[i] = 0.92;
          field.g[i] = 0.78;
          field.b[i] = 0.22;
        }
      }
    },
  },
  /**
   * Sliding dither that packs denser every 10 steps for 3 frames.
   * Repro for match→EMA→emit poison: hop/density EMAs dip while the track
   * still matches, so emit can fail without a hold-coast miss.
   */
  {
    id: "flow-hop-pulse",
    label: "Flow hop pulse (EMA poison repro)",
    fill(field, step) {
      fillUniform(field, 0.1, 0.1, 0.12);
      const { width: w, height: h } = field;
      const bw = 40;
      const bh = 24;
      const x0 = (((16 + step) % w) + w) % w;
      const y0 = Math.min(40, h - bh - 1);
      const packPulse = step % 10 >= 7;
      for (let iy = 0; iy < bh; iy++) {
        for (let ix = 0; ix < bw; ix++) {
          const u = (ix * 19 + iy * 47 + (packPulse ? step * 3 : 0)) % 100;
          // Sparse travel most frames; denser (lower hop) during the pulse.
          if (u >= (packPulse ? 78 : 42)) continue;
          const x = (x0 + ix) % w;
          const y = (y0 + iy) % h;
          const i = y * w + x;
          field.r[i] = 0.92;
          field.g[i] = 0.78;
          field.b[i] = 0.22;
        }
      }
    },
  },
  {
    id: "chaos-blob-2pct",
    label: "Chaos blob 2%",
    fill(field, step) {
      fillUniform(field, 0.2, 0.55, 0.85);
      const rng = mulberry32(71000 + step);
      const { width: w, height: h } = field;
      const bw = 18;
      const bh = 18;
      const x0 = ((w - bw) / 2) | 0;
      const y0 = ((h - bh) / 2) | 0;
      for (let y = y0; y < y0 + bh; y++) {
        for (let x = x0; x < x0 + bw; x++) {
          const i = y * w + x;
          field.r[i] = rng();
          field.g[i] = rng();
          field.b[i] = rng();
        }
      }
    },
  },
  {
    id: "chaos-blob-10pct",
    label: "Chaos blob 10%",
    fill(field, step) {
      fillUniform(field, 0.2, 0.55, 0.85);
      const rng = mulberry32(72000 + step);
      const { width: w, height: h } = field;
      const bw = 40;
      const bh = 40;
      const x0 = ((w - bw) / 2) | 0;
      const y0 = ((h - bh) / 2) | 0;
      for (let y = y0; y < y0 + bh; y++) {
        for (let x = x0; x < x0 + bw; x++) {
          const i = y * w + x;
          field.r[i] = rng();
          field.g[i] = rng();
          field.b[i] = rng();
        }
      }
    },
  },
  {
    id: "hue-bands",
    label: "Hue bands (8)",
    fill(field) {
      const { width: w, height: h } = field;
      const bandW = (w / 8) | 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const k = Math.min(7, (x / bandW) | 0);
          const [r, g, b] = hsv2rgb(k * 0.02, 0.8, 0.8);
          const i = y * w + x;
          field.r[i] = r;
          field.g[i] = g;
          field.b[i] = b;
        }
      }
    },
  },
  {
    id: "pulse-calm",
    label: "Pulse calm (1 Hz)",
    fill(field, step) {
      // Steady colour; every 30th step HSV value bumps for 2 steps then
      // returns — period 1.0 s inside rhythmMinSec..rhythmMaxSec. The bump
      // must stay below chaosDeltaMin after EMA so the calm region (and its
      // rhythm clock) survive the impulse; a large jump wipes the field to
      // chaos and deletes the clock.
      const phase = ((step % 30) + 30) % 30;
      const v = phase < 2 ? 0.58 : 0.5;
      const [r, g, b] = hsv2rgb(0.58, 0.75, v);
      fillUniform(field, r, g, b);
    },
  },
  {
    id: "identity-quadrants",
    label: "Identity quadrants",
    fill(field) {
      // Matched Rec.709 luminance ≈ 0.55 so loudness stays out of the listen.
      // Grey (s=0) vs saturated; upper vs lower half → cutoff; left/right → pan.
      const { width: w, height: h } = field;
      const midX = (w / 2) | 0;
      const midY = (h / 2) | 0;
      const grey = 0.55;
      // Saturated red-orange and teal at Y≈0.55.
      const satTR: [number, number, number] = [0.92, 0.48, 0.22];
      const satBR: [number, number, number] = [0.18, 0.72, 0.62];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const upper = y < midY;
          const left = x < midX;
          let r: number;
          let g: number;
          let b: number;
          if (left) {
            r = grey;
            g = grey;
            b = grey;
          } else if (upper) {
            [r, g, b] = satTR;
          } else {
            [r, g, b] = satBR;
          }
          field.r[i] = r;
          field.g[i] = g;
          field.b[i] = b;
        }
      }
    },
  },
  {
    id: "osc-field",
    label: "Oscillator field (period 2)",
    fill(field, step) {
      const on = step % 2 === 0;
      if (on) fillUniform(field, 0.9, 0.25, 0.2);
      else fillUniform(field, 0.2, 0.3, 0.9);
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
