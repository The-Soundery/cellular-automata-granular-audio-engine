import type { RgbField } from "./FrameObserver.ts";

export const LUMINANCE_GATE = 0.025;
/** Slightly looser merge — fewer flicker fragments, more stable structures. */
export const RGB_MERGE_EPS = 0.18;
/** Cap regions processed per frame for realtime budget. */
export const MAX_REGIONS = 32;
/** Ignore micro-regions that thrash identity without representing structure. */
export const MIN_REGION_CELLS = 12;

export interface RawRegion {
  /** Member cell indices (row-major). */
  cells: number[];
  area: number;
  mass: number;
  /** Toroidal circular-mean centroid. */
  cx: number;
  cy: number;
  /** Unwrapped extent width/height in cells (1..w/h). */
  extentW: number;
  extentH: number;
  /** Major-axis extrema in unwrapped centroid frame. */
  tipAx: number;
  tipAy: number;
  tipBx: number;
  tipBy: number;
  meanR: number;
  meanG: number;
  meanB: number;
  /** Mean colour distance from region mean. */
  colourVariance: number;
  /** Internal spatial RGB roughness / edge energy. */
  spatialVariance: number;
}

function brightness(r: number, g: number, b: number): number {
  return (r + g + b) / 3;
}

function rgbDist(
  r0: number,
  g0: number,
  b0: number,
  r1: number,
  g1: number,
  b1: number,
): number {
  return (Math.abs(r0 - r1) + Math.abs(g0 - g1) + Math.abs(b0 - b1)) / 3;
}

/** Circular mean on [0, period). */
export function circularMean(values: number[], period: number): number {
  if (values.length === 0) return 0;
  let sx = 0;
  let sy = 0;
  const k = (2 * Math.PI) / period;
  for (const v of values) {
    sx += Math.cos(k * v);
    sy += Math.sin(k * v);
  }
  const ang = Math.atan2(sy / values.length, sx / values.length);
  let out = ang / k;
  if (out < 0) out += period;
  return out;
}

export function toroidalDelta(a: number, b: number, period: number): number {
  let d = b - a;
  if (d > period * 0.5) d -= period;
  if (d < -period * 0.5) d += period;
  return d;
}

export function toroidalDist2(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  w: number,
  h: number,
): number {
  const dx = toroidalDelta(x0, x1, w);
  const dy = toroidalDelta(y0, y1, h);
  return dx * dx + dy * dy;
}

/**
 * Extract coherent lit regions via 8-connected flood fill with RGB similarity.
 * Simulation-native: neighbour colour relationships already in the CA field.
 */
export function extractRegions(field: RgbField): RawRegion[] {
  const { width: w, height: h, r, g, b } = field;
  const n = w * h;
  const visited = new Uint8Array(n);
  const regions: RawRegion[] = [];
  const stack = new Int32Array(n);

  for (let seed = 0; seed < n; seed++) {
    if (visited[seed]) continue;
    const sr = r[seed]!;
    const sg = g[seed]!;
    const sb = b[seed]!;
    if (brightness(sr, sg, sb) < LUMINANCE_GATE) {
      visited[seed] = 1;
      continue;
    }

    let meanR = sr;
    let meanG = sg;
    let meanB = sb;
    let count = 0;
    let sp = 0;
    stack[sp++] = seed;
    visited[seed] = 1;
    const cells: number[] = [];

    while (sp > 0) {
      const i = stack[--sp]!;
      const cr = r[i]!;
      const cg = g[i]!;
      const cb = b[i]!;
      if (
        count > 0 &&
        rgbDist(cr, cg, cb, meanR, meanG, meanB) >= RGB_MERGE_EPS
      ) {
        continue;
      }

      cells.push(i);
      count++;
      const inv = 1 / count;
      meanR += (cr - meanR) * inv;
      meanG += (cg - meanG) * inv;
      meanB += (cb - meanB) * inv;

      const x = i % w;
      const y = (i / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = (x + dx + w) % w;
          const ny = (y + dy + h) % h;
          const ni = ny * w + nx;
          if (visited[ni]) continue;
          const nr = r[ni]!;
          const ng = g[ni]!;
          const nb = b[ni]!;
          if (brightness(nr, ng, nb) < LUMINANCE_GATE) {
            visited[ni] = 1;
            continue;
          }
          if (rgbDist(nr, ng, nb, meanR, meanG, meanB) >= RGB_MERGE_EPS) {
            continue;
          }
          visited[ni] = 1;
          stack[sp++] = ni;
        }
      }
    }

    if (cells.length < MIN_REGION_CELLS) continue;

    let mass = 0;
    let colourVar = 0;
    let spatialVar = 0;
    const xs: number[] = [];
    const ys: number[] = [];

    for (const i of cells) {
      const L = brightness(r[i]!, g[i]!, b[i]!);
      mass += L;
      colourVar += rgbDist(r[i]!, g[i]!, b[i]!, meanR, meanG, meanB);
      const x = i % w;
      const y = (i / w) | 0;
      xs.push(x);
      ys.push(y);

      let edge = 0;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = (x + dx + w) % w;
        const ny = (y + dy + h) % h;
        const ni = ny * w + nx;
        edge += rgbDist(r[i]!, g[i]!, b[i]!, r[ni]!, g[ni]!, b[ni]!);
      }
      spatialVar += edge / 4;
    }

    const cx = circularMean(xs, w);
    const cy = circularMean(ys, h);

    let minDx = 0;
    let maxDx = 0;
    let minDy = 0;
    let maxDy = 0;
    let tipAx = cx;
    let tipAy = cy;
    let tipBx = cx;
    let tipBy = cy;
    let maxProj = -Infinity;
    let minProj = Infinity;

    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (let k = 0; k < cells.length; k++) {
      const dx = toroidalDelta(cx, xs[k]!, w);
      const dy = toroidalDelta(cy, ys[k]!, h);
      sxx += dx * dx;
      syy += dy * dy;
      sxy += dx * dy;
      if (dx < minDx) minDx = dx;
      if (dx > maxDx) maxDx = dx;
      if (dy < minDy) minDy = dy;
      if (dy > maxDy) maxDy = dy;
    }
    const invN = 1 / cells.length;
    sxx *= invN;
    syy *= invN;
    sxy *= invN;
    const trace = sxx + syy;
    const det = sxx * syy - sxy * sxy;
    const gap = Math.sqrt(Math.max(0, trace * trace * 0.25 - det));
    const eig = trace * 0.5 + gap;
    let axisX = 1;
    let axisY = 0;
    if (Math.abs(sxy) > 1e-8 || Math.abs(eig - sxx) > 1e-8) {
      axisX = sxy;
      axisY = eig - sxx;
      const len = Math.hypot(axisX, axisY) || 1;
      axisX /= len;
      axisY /= len;
    } else if (syy > sxx) {
      axisX = 0;
      axisY = 1;
    }

    for (let k = 0; k < cells.length; k++) {
      const dx = toroidalDelta(cx, xs[k]!, w);
      const dy = toroidalDelta(cy, ys[k]!, h);
      const proj = dx * axisX + dy * axisY;
      if (proj > maxProj) {
        maxProj = proj;
        tipAx = (cx + dx + w) % w;
        tipAy = (cy + dy + h) % h;
      }
      if (proj < minProj) {
        minProj = proj;
        tipBx = (cx + dx + w) % w;
        tipBy = (cy + dy + h) % h;
      }
    }

    regions.push({
      cells,
      area: cells.length,
      mass,
      cx,
      cy,
      extentW: Math.max(1, maxDx - minDx + 1),
      extentH: Math.max(1, maxDy - minDy + 1),
      tipAx,
      tipAy,
      tipBx,
      tipBy,
      meanR,
      meanG,
      meanB,
      colourVariance: colourVar / cells.length,
      spatialVariance: spatialVar / cells.length,
    });
  }

  regions.sort((a, b) => b.mass - a.mass);
  return regions.slice(0, MAX_REGIONS);
}
