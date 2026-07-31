import type { RgbField } from "./FrameObserver.ts";

/** Initial state lattice size — raise only after listening gate + CPU check. */
export const GRAIN_BUDGET = 64;
/** Global render ceiling — not per-cell volume. */
export const MASTER_GAIN = 1.0;
/**
 * Uniform physical grain aperture (listening medium).
 * Not varied by stability/chaos — renderer is dumb.
 */
export const GRAIN_LENGTH_SEC = 0.25;

export interface GrainParams {
  /** Stable lattice slot index (0..N-1). State address, not grain ownership. */
  latticeIndex: number;
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
  /** Always 1/N — equal share, never luminance-weighted. */
  amplitudeShare: number;
  /** Observable field change at locus — diagnostics only, not a scheduler. */
  localDelta: number;
  grainLengthSec: number;
}

export interface GrainPlan {
  masterGain: number;
  gridWidth: number;
  gridHeight: number;
  grainCount: number;
  grains: GrainParams[];
}

/**
 * Sonic-state lattice builder: full-grid equal-share pixels.
 * No structure detection, scores, brightness gates, or update scheduling.
 */
export class FieldReducer {
  readonly grainBudget: number;
  private readonly cols: number;
  private readonly rows: number;

  constructor(grainBudget = GRAIN_BUDGET) {
    this.grainBudget = grainBudget;
    const side = Math.max(1, Math.round(Math.sqrt(grainBudget)));
    this.cols = side;
    this.rows = side;
  }

  reset(): void {
    // Stateless per frame; kept for API symmetry with CA Reset.
  }

  reduce(current: RgbField, previous: RgbField): GrainPlan {
    const w = current.width;
    const h = current.height;
    const n = this.grainBudget;
    const amp = 1 / n;
    const grains: GrainParams[] = [];

    for (let i = 0; i < n; i++) {
      const col = i % this.cols;
      const row = Math.floor(i / this.cols);
      const x = latticeCoord(col, this.cols, w);
      const y = latticeCoord(row, this.rows, h);
      const idx = Math.min(w * h - 1, Math.floor(y) * w + Math.floor(x));

      const r = current.r[idx]!;
      const g = current.g[idx]!;
      const b = current.b[idx]!;
      const localDelta = rgbDelta(
        r,
        g,
        b,
        previous.r[idx]!,
        previous.g[idx]!,
        previous.b[idx]!,
      );

      grains.push({
        latticeIndex: i,
        x,
        y,
        r,
        g,
        b,
        amplitudeShare: amp,
        localDelta,
        grainLengthSec: GRAIN_LENGTH_SEC,
      });
    }

    return {
      masterGain: MASTER_GAIN,
      gridWidth: w,
      gridHeight: h,
      grainCount: n,
      grains,
    };
  }
}

/** Center of lattice cell i in a period-sized axis. */
export function latticeCoord(i: number, count: number, period: number): number {
  if (count <= 1) return (period - 1) * 0.5;
  const cell = period / count;
  return i * cell + cell * 0.5;
}

export function rgbDelta(
  r0: number,
  g0: number,
  b0: number,
  r1: number,
  g1: number,
  b1: number,
): number {
  return (
    (Math.abs(r0 - r1) + Math.abs(g0 - g1) + Math.abs(b0 - b1)) / 3
  );
}

/** Fraction of lattice grains whose (x,y) fall inside an axis-aligned band. */
export function occupationShare(
  grains: Pick<GrainParams, "x" | "y">[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  if (grains.length === 0) return 0;
  let inside = 0;
  for (const g of grains) {
    if (g.x >= x0 && g.x < x1 && g.y >= y0 && g.y < y1) inside++;
  }
  return inside / grains.length;
}
