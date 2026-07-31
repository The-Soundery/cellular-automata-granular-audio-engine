import type { RgbField } from "./FrameObserver.ts";

/** Negotiable observation constants — tune after listening, not doctrine. */
export const FIELD_OBS = {
  /** EMA blend for per-cell δ (higher = faster tracking). */
  deltaEma: 0.28,
  /** Scale that maps raw RGB delta into ~0..1 before stability. */
  deltaNorm: 0.35,
  /** Cells with κ >= this may join coherent regions. */
  kappaThreshold: 0.55,
  /** Drop coherent coherent speckles below this area (cells). */
  minRegionArea: 24,
  /** Colour distance that ends a coherence-length ray. */
  lengthColourEps: 0.12,
  /** Max ray steps when measuring ℓ. */
  lengthMaxSteps: 24,
  /** Max COM match distance (cells) for velocity continuity. */
  comMatchDist: 18,
  /** EMA for region COM velocity. */
  velocityEma: 0.35,
} as const;

export interface CoherentRegion {
  id: number;
  area: number;
  /** Centre of mass (toroidal), continuous coords. */
  comX: number;
  comY: number;
  /** Cells / step, EMA-smoothed after region matching. */
  velX: number;
  velY: number;
  meanDelta: number;
  meanCoherence: number;
  meanR: number;
  meanG: number;
  meanB: number;
  /** Axis-aligned extent relative to COM (toroidal-aware). */
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
  /** Cell indices (row-major) belonging to this region. */
  cells: Uint32Array;
}

export interface ChaoticArea {
  area: number;
  meanDelta: number;
  meanCoherence: number;
  cells: Uint32Array;
}

export interface FieldObservation {
  width: number;
  height: number;
  /** Per-cell smoothed rate of change δ. */
  delta: Float32Array;
  /** Per-cell local colour similarity s ∈ [0,1]. */
  similarity: Float32Array;
  /** Per-cell coherence κ = s × stability. */
  coherence: Float32Array;
  /** Per-cell coherence length ℓ (cells). */
  coherenceLength: Float32Array;
  coherent: CoherentRegion[];
  chaotic: ChaoticArea;
  meanDelta: number;
  meanCoherence: number;
  calmAreaFraction: number;
  chaosAreaFraction: number;
}

type PrevCom = {
  id: number;
  comX: number;
  comY: number;
  velX: number;
  velY: number;
};

/**
 * Observes CA RGB fields into Sonic Law metrics and observational regions.
 * Regions are measurements for the scheduler — not voice owners.
 */
export class FieldObserver {
  readonly width: number;
  readonly height: number;
  private readonly delta: Float32Array;
  private readonly similarity: Float32Array;
  private readonly coherence: Float32Array;
  private readonly coherenceLength: Float32Array;
  private readonly calmMask: Uint8Array;
  private readonly labels: Int32Array;
  private readonly queue: Uint32Array;
  private prevComs: PrevCom[] = [];
  private nextRegionId = 1;
  private primed = false;
  private last: FieldObservation;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    const n = width * height;
    this.delta = new Float32Array(n);
    this.similarity = new Float32Array(n);
    this.coherence = new Float32Array(n);
    this.coherenceLength = new Float32Array(n);
    this.calmMask = new Uint8Array(n);
    this.labels = new Int32Array(n);
    this.queue = new Uint32Array(n);
    this.last = emptyObservation(width, height, this.delta, this.similarity, this.coherence, this.coherenceLength);
  }

  get observation(): FieldObservation {
    return this.last;
  }

  reset(): void {
    this.delta.fill(0);
    this.similarity.fill(0);
    this.coherence.fill(0);
    this.coherenceLength.fill(0);
    this.calmMask.fill(0);
    this.labels.fill(-1);
    this.prevComs = [];
    this.nextRegionId = 1;
    this.primed = false;
    this.last = emptyObservation(
      this.width,
      this.height,
      this.delta,
      this.similarity,
      this.coherence,
      this.coherenceLength,
    );
  }

  /**
   * Advance observation from current/previous RGB fields (same step as FrameObserver).
   */
  observe(current: RgbField, previous: RgbField): FieldObservation {
    const { width: w, height: h } = this;
    const n = w * h;
    const a = FIELD_OBS.deltaEma;
    const deltaNorm = FIELD_OBS.deltaNorm;

    let meanDelta = 0;
    let meanKappa = 0;

    for (let i = 0; i < n; i++) {
      const inst = rgbDelta(
        current.r[i]!,
        current.g[i]!,
        current.b[i]!,
        previous.r[i]!,
        previous.g[i]!,
        previous.b[i]!,
      );
      const d = this.primed ? this.delta[i]! + (inst - this.delta[i]!) * a : inst;
      this.delta[i] = d;
      meanDelta += d;
    }
    meanDelta /= n;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const s = localSimilarity(current, x, y, w, h);
        this.similarity[i] = s;
        const stability = 1 - clamp01(this.delta[i]! / deltaNorm);
        const kappa = s * stability;
        this.coherence[i] = kappa;
        meanKappa += kappa;
      }
    }
    meanKappa /= n;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        this.coherenceLength[i] = measureCoherenceLength(current, x, y, w, h);
      }
    }

    const coherent = this.extractRegions(current);
    const chaotic = this.buildChaotic(coherent);
    const calmCells = coherent.reduce((sum, r) => sum + r.area, 0);

    this.primed = true;
    this.last = {
      width: w,
      height: h,
      delta: this.delta,
      similarity: this.similarity,
      coherence: this.coherence,
      coherenceLength: this.coherenceLength,
      coherent,
      chaotic,
      meanDelta,
      meanCoherence: meanKappa,
      calmAreaFraction: calmCells / n,
      chaosAreaFraction: chaotic.area / n,
    };
    return this.last;
  }

  private extractRegions(current: RgbField): CoherentRegion[] {
    const { width: w, height: h } = this;
    const n = w * h;
    const thr = FIELD_OBS.kappaThreshold;
    const minArea = FIELD_OBS.minRegionArea;

    for (let i = 0; i < n; i++) {
      this.calmMask[i] = this.coherence[i]! >= thr ? 1 : 0;
      this.labels[i] = -1;
    }

    const regions: CoherentRegion[] = [];
    const cellBuf: number[] = [];

    for (let seed = 0; seed < n; seed++) {
      if (!this.calmMask[seed] || this.labels[seed]! >= 0) continue;

      cellBuf.length = 0;
      let qh = 0;
      let qt = 0;
      this.queue[qt++] = seed;
      this.labels[seed] = regions.length;

      let sumXCos = 0;
      let sumXSin = 0;
      let sumYCos = 0;
      let sumYSin = 0;
      let sumD = 0;
      let sumK = 0;
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;

      while (qh < qt) {
        const i = this.queue[qh++]!;
        cellBuf.push(i);
        const x = i % w;
        const y = (i / w) | 0;
        const angX = (2 * Math.PI * x) / w;
        const angY = (2 * Math.PI * y) / h;
        sumXCos += Math.cos(angX);
        sumXSin += Math.sin(angX);
        sumYCos += Math.cos(angY);
        sumYSin += Math.sin(angY);
        sumD += this.delta[i]!;
        sumK += this.coherence[i]!;
        sumR += current.r[i]!;
        sumG += current.g[i]!;
        sumB += current.b[i]!;

        // 4-connected, toroidal
        const nIdx = [
          y * w + ((x + 1) % w),
          y * w + ((x - 1 + w) % w),
          ((y + 1) % h) * w + x,
          ((y - 1 + h) % h) * w + x,
        ];
        for (const j of nIdx) {
          if (this.calmMask[j] && this.labels[j]! < 0) {
            this.labels[j] = regions.length;
            this.queue[qt++] = j;
          }
        }
      }

      const area = cellBuf.length;
      if (area < minArea) {
        for (const i of cellBuf) {
          this.labels[i] = -1;
          this.calmMask[i] = 0;
        }
        continue;
      }

      const comX =
        ((Math.atan2(sumXSin, sumXCos) / (2 * Math.PI)) * w + w) % w;
      const comY =
        ((Math.atan2(sumYSin, sumYCos) / (2 * Math.PI)) * h + h) % h;

      let minDx = 0;
      let maxDx = 0;
      let minDy = 0;
      let maxDy = 0;
      for (let c = 0; c < cellBuf.length; c++) {
        const i = cellBuf[c]!;
        const x = i % w;
        const y = (i / w) | 0;
        const dx = toroidalDelta(x, comX, w);
        const dy = toroidalDelta(y, comY, h);
        if (c === 0) {
          minDx = maxDx = dx;
          minDy = maxDy = dy;
        } else {
          if (dx < minDx) minDx = dx;
          if (dx > maxDx) maxDx = dx;
          if (dy < minDy) minDy = dy;
          if (dy > maxDy) maxDy = dy;
        }
      }

      const width = Math.max(1, maxDx - minDx + 1);
      const height = Math.max(1, maxDy - minDy + 1);
      const minX = (comX + minDx + w) % w;
      const maxX = (comX + maxDx + w) % w;
      const minY = (comY + minDy + h) % h;
      const maxY = (comY + maxDy + h) % h;

      const cells = Uint32Array.from(cellBuf);
      regions.push({
        id: -1,
        area,
        comX,
        comY,
        velX: 0,
        velY: 0,
        meanDelta: sumD / area,
        meanCoherence: sumK / area,
        meanR: sumR / area,
        meanG: sumG / area,
        meanB: sumB / area,
        minX,
        maxX,
        minY,
        maxY,
        width,
        height,
        cells,
      });
    }

    this.assignIdsAndVelocity(regions);
    return regions;
  }

  private assignIdsAndVelocity(regions: CoherentRegion[]): void {
    const { width: w, height: h } = this;
    const maxDist: number = FIELD_OBS.comMatchDist;
    const va: number = FIELD_OBS.velocityEma;
    const usedPrev = new Set<number>();

    for (const region of regions) {
      let best = -1;
      let bestD: number = maxDist;
      for (let p = 0; p < this.prevComs.length; p++) {
        if (usedPrev.has(p)) continue;
        const prev = this.prevComs[p]!;
        const d = Math.hypot(
          toroidalDelta(region.comX, prev.comX, w),
          toroidalDelta(region.comY, prev.comY, h),
        );
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }

      if (best >= 0) {
        const prev = this.prevComs[best]!;
        usedPrev.add(best);
        region.id = prev.id;
        const rawVx = toroidalDelta(region.comX, prev.comX, w);
        const rawVy = toroidalDelta(region.comY, prev.comY, h);
        region.velX = prev.velX + (rawVx - prev.velX) * va;
        region.velY = prev.velY + (rawVy - prev.velY) * va;
      } else {
        region.id = this.nextRegionId++;
        region.velX = 0;
        region.velY = 0;
      }
    }

    this.prevComs = regions.map((r) => ({
      id: r.id,
      comX: r.comX,
      comY: r.comY,
      velX: r.velX,
      velY: r.velY,
    }));
  }

  private buildChaotic(coherent: CoherentRegion[]): ChaoticArea {
    const n = this.width * this.height;
    const inCalm = new Uint8Array(n);
    for (const r of coherent) {
      for (let i = 0; i < r.cells.length; i++) {
        inCalm[r.cells[i]!] = 1;
      }
    }

    const cells: number[] = [];
    let sumD = 0;
    let sumK = 0;
    for (let i = 0; i < n; i++) {
      if (inCalm[i]) continue;
      cells.push(i);
      sumD += this.delta[i]!;
      sumK += this.coherence[i]!;
    }
    const area = cells.length;
    return {
      area,
      meanDelta: area ? sumD / area : 0,
      meanCoherence: area ? sumK / area : 0,
      cells: Uint32Array.from(cells),
    };
  }
}

export function rgbDelta(
  r0: number,
  g0: number,
  b0: number,
  r1: number,
  g1: number,
  b1: number,
): number {
  const dr = r0 - r1;
  const dg = g0 - g1;
  const db = b0 - b1;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

export function toroidalDelta(a: number, b: number, period: number): number {
  let d = a - b;
  if (d > period * 0.5) d -= period;
  if (d < -period * 0.5) d += period;
  return d;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Inverse of mean squared colour distance to 8 neighbours (toroidal). */
function localSimilarity(
  field: RgbField,
  x: number,
  y: number,
  w: number,
  h: number,
): number {
  const i = y * w + x;
  const r0 = field.r[i]!;
  const g0 = field.g[i]!;
  const b0 = field.b[i]!;
  let varSum = 0;
  let count = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = (x + dx + w) % w;
      const ny = (y + dy + h) % h;
      const j = ny * w + nx;
      const dr = r0 - field.r[j]!;
      const dg = g0 - field.g[j]!;
      const db = b0 - field.b[j]!;
      varSum += dr * dr + dg * dg + db * db;
      count += 1;
    }
  }
  const meanVar = varSum / Math.max(1, count);
  return 1 / (1 + meanVar * 8);
}

/**
 * Mean extent of similarity rays in 4 directions — proxy for local ℓ.
 */
function measureCoherenceLength(
  field: RgbField,
  x: number,
  y: number,
  w: number,
  h: number,
): number {
  const eps = FIELD_OBS.lengthColourEps;
  const maxSteps = FIELD_OBS.lengthMaxSteps;
  const i0 = y * w + x;
  const r0 = field.r[i0]!;
  const g0 = field.g[i0]!;
  const b0 = field.b[i0]!;

  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;

  let sum = 0;
  for (const [dx, dy] of dirs) {
    let steps = 0;
    for (let s = 1; s <= maxSteps; s++) {
      const nx = (x + dx * s + w * 16) % w;
      const ny = (y + dy * s + h * 16) % h;
      const j = ny * w + nx;
      const d = rgbDelta(r0, g0, b0, field.r[j]!, field.g[j]!, field.b[j]!);
      if (d > eps) break;
      steps = s;
    }
    sum += steps;
  }
  return sum / 4;
}

function emptyObservation(
  width: number,
  height: number,
  delta: Float32Array,
  similarity: Float32Array,
  coherence: Float32Array,
  coherenceLength: Float32Array,
): FieldObservation {
  return {
    width,
    height,
    delta,
    similarity,
    coherence,
    coherenceLength,
    coherent: [],
    chaotic: { area: width * height, meanDelta: 0, meanCoherence: 0, cells: new Uint32Array(0) },
    meanDelta: 0,
    meanCoherence: 0,
    calmAreaFraction: 0,
    chaosAreaFraction: 1,
  };
}
