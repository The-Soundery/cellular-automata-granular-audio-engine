import type { RgbField } from "./FrameObserver.ts";

/** Negotiable observation constants — tune after listening, not doctrine. */
export const FIELD_OBS = {
  /** EMA blend for per-cell δ (higher = faster tracking). */
  deltaEma: 0.28,
  /** Scale that maps raw RGB delta into ~0..1 before stability. */
  deltaNorm: 0.35,
  /**
   * Enter calm when κ >= this (also exported as kappaThreshold for verify).
   * Soft similar-colour join uses regionColourEps against running mean RGB.
   */
  kappaEnter: 0.55,
  /** Stay calm while previously calm and κ >= this (hysteresis). */
  kappaExit: 0.42,
  /** Alias of kappaEnter — kept for verify / older tune notes. */
  kappaThreshold: 0.55,
  /** Max RGB distance from running region mean to join a calm component. */
  regionColourEps: 0.12,
  /** Drop transient coherent speckles below this area (cells). */
  minRegionArea: 24,
  /** Max COM match distance (cells) for velocity continuity. */
  comMatchDist: 18,
  /** Max mean-RGB distance for ID continuity (same scale as regionColourEps). */
  idColourEps: 0.22,
  /** Minimum cell IoU to prefer an ID match when COM/colour are close. */
  idMinIoU: 0.08,
  /** EMA for region COM velocity. */
  velocityEma: 0.35,
  /** Smoothed δ below this is stasis, not chaos; quantisation noise is ~0.007. */
  chaosDeltaMin: 0.045,
  /** Max oscillator period (steps) tested ascending. */
  oscPeriodMax: 8,
  /** RGB match epsilon for period-p frame compare. */
  oscMatchEps: 0.06,
  /** EMA δ must exceed this for a cell to be tested as oscillating. */
  oscDeltaMin: 0.08,
  /** Confirmed when streak ≥ oscConfirmCycles × period. */
  oscConfirmCycles: 2,
} as const;

export interface CoherentRegion {
  id: number;
  area: number;
  /** Centre of mass (toroidal), continuous coords. */
  comX: number;
  comY: number;
  /**
   * Circular concentration (mean resultant length) of members about each axis.
   * 1 = tightly localised, 0 = spread evenly round the torus, where the COM in
   * that axis carries no information about where the mass is.
   */
  comConcX: number;
  comConcY: number;
  /** Cells / step, EMA-smoothed after region matching. */
  velX: number;
  velY: number;
  meanDelta: number;
  meanCoherence: number;
  /** Mean per-cell spatial similarity (spectral axis for material law). */
  meanSimilarity: number;
  meanR: number;
  meanG: number;
  meanB: number;
  /** RMS RGB distance of member cells from the region mean (internal diversity). */
  colourSpread: number;
  /** Axis-aligned extent relative to COM (toroidal-aware). */
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
  /** area / (width×height); sparse / L-shapes are low. */
  fillRatio: number;
  /** Cell indices (row-major) belonging to this region. */
  cells: Uint32Array;
}

export interface ChaoticArea {
  area: number;
  meanDelta: number;
  meanCoherence: number;
  /** Mean per-cell spatial similarity (spectral axis for material law). */
  meanSimilarity: number;
  /** Max per-cell δ in the bag (for δ-weighted chaos spawn). */
  maxDelta: number;
  cells: Uint32Array;
}

/** Dissimilar but stable remainder — static texture, not temporal chaos. */
export interface TexturedArea {
  area: number;
  meanDelta: number;
  meanCoherence: number;
  /** Mean per-cell spatial similarity (spectral axis for material law). */
  meanSimilarity: number;
  meanR: number;
  meanG: number;
  meanB: number;
  /** RMS RGB distance of member cells from the bag mean (internal diversity). */
  colourSpread: number;
  cells: Uint32Array;
}

/** Confirmed periodic cells grouped by period (re-derived every frame). */
export interface OscillatorGroup {
  period: number;
  area: number;
  cells: Uint32Array;
  meanR: number;
  meanG: number;
  meanB: number;
  meanDelta: number;
}

export interface FieldObservation {
  width: number;
  height: number;
  /** Per-cell EMA rate of change δ (raw). */
  delta: Float32Array;
  /** Spatially smoothed δ (3×3 box) used for stability / regime split. */
  deltaSmooth: Float32Array;
  /** Per-cell local colour similarity s ∈ [0,1]. */
  similarity: Float32Array;
  /** Per-cell coherence κ = s × stability. */
  coherence: Float32Array;
  coherent: CoherentRegion[];
  chaotic: ChaoticArea;
  textured: TexturedArea;
  oscillators: OscillatorGroup[];
  meanDelta: number;
  meanCoherence: number;
  calmAreaFraction: number;
  chaosAreaFraction: number;
  texturedAreaFraction: number;
}

type PrevRegion = {
  id: number;
  comX: number;
  comY: number;
  velX: number;
  velY: number;
  meanR: number;
  meanG: number;
  meanB: number;
  cells: Uint32Array;
};

/**
 * Observes CA RGB fields into Sonic Law metrics and observational regions.
 * Regions are measurements for the scheduler — not voice owners.
 */
export class FieldObserver {
  readonly width: number;
  readonly height: number;
  private readonly delta: Float32Array;
  private readonly deltaSmooth: Float32Array;
  private readonly similarity: Float32Array;
  private readonly coherence: Float32Array;
  private readonly calmMask: Uint8Array;
  private readonly prevCalm: Uint8Array;
  private readonly oscMask: Uint8Array;
  private readonly oscPeriod: Uint8Array;
  private readonly oscStreak: Uint16Array;
  private readonly labels: Int32Array;
  private readonly queue: Uint32Array;
  private readonly histLen: number;
  private readonly histR: Float32Array[];
  private readonly histG: Float32Array[];
  private readonly histB: Float32Array[];
  private histWrite = 0;
  private histCount = 0;
  private prevRegions: PrevRegion[] = [];
  private nextRegionId = 1;
  private primed = false;
  private last: FieldObservation;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    const n = width * height;
    this.delta = new Float32Array(n);
    this.deltaSmooth = new Float32Array(n);
    this.similarity = new Float32Array(n);
    this.coherence = new Float32Array(n);
    this.calmMask = new Uint8Array(n);
    this.prevCalm = new Uint8Array(n);
    this.oscMask = new Uint8Array(n);
    this.oscPeriod = new Uint8Array(n);
    this.oscStreak = new Uint16Array(n);
    this.labels = new Int32Array(n);
    this.queue = new Uint32Array(n);
    this.histLen = FIELD_OBS.oscPeriodMax + 1;
    this.histR = Array.from({ length: this.histLen }, () => new Float32Array(n));
    this.histG = Array.from({ length: this.histLen }, () => new Float32Array(n));
    this.histB = Array.from({ length: this.histLen }, () => new Float32Array(n));
    this.last = emptyObservation(
      width,
      height,
      this.delta,
      this.deltaSmooth,
      this.similarity,
      this.coherence,
    );
  }

  get observation(): FieldObservation {
    return this.last;
  }

  reset(): void {
    this.delta.fill(0);
    this.deltaSmooth.fill(0);
    this.similarity.fill(0);
    this.coherence.fill(0);
    this.calmMask.fill(0);
    this.prevCalm.fill(0);
    this.oscMask.fill(0);
    this.oscPeriod.fill(0);
    this.oscStreak.fill(0);
    this.labels.fill(-1);
    this.histWrite = 0;
    this.histCount = 0;
    for (let h = 0; h < this.histLen; h++) {
      this.histR[h]!.fill(0);
      this.histG[h]!.fill(0);
      this.histB[h]!.fill(0);
    }
    this.prevRegions = [];
    this.nextRegionId = 1;
    this.primed = false;
    this.last = emptyObservation(
      this.width,
      this.height,
      this.delta,
      this.deltaSmooth,
      this.similarity,
      this.coherence,
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

    blurDelta3x3(this.delta, this.deltaSmooth, w, h);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const s = localSimilarity(current, x, y, w, h);
        this.similarity[i] = s;
        const stability = 1 - clamp01(this.deltaSmooth[i]! / deltaNorm);
        const kappa = s * stability;
        this.coherence[i] = kappa;
        meanKappa += kappa;
      }
    }
    meanKappa /= n;

    this.pushHistory(current);
    this.updateOscillators(current);
    const oscillators = this.buildOscillatorGroups(current);

    const coherent = this.extractRegions(current);
    const { chaotic, textured } = this.buildRemainder(coherent, current);
    const calmCells = coherent.reduce((sum, r) => sum + r.area, 0);

    this.prevCalm.set(this.calmMask);
    this.primed = true;
    this.last = {
      width: w,
      height: h,
      delta: this.delta,
      deltaSmooth: this.deltaSmooth,
      similarity: this.similarity,
      coherence: this.coherence,
      coherent,
      chaotic,
      textured,
      oscillators,
      meanDelta,
      meanCoherence: meanKappa,
      calmAreaFraction: calmCells / n,
      chaosAreaFraction: chaotic.area / n,
      texturedAreaFraction: textured.area / n,
    };
    return this.last;
  }

  private extractRegions(current: RgbField): CoherentRegion[] {
    const { width: w, height: h } = this;
    const n = w * h;
    const enter = FIELD_OBS.kappaEnter;
    const exit = FIELD_OBS.kappaExit;
    const colourEps = FIELD_OBS.regionColourEps;
    const minArea = FIELD_OBS.minRegionArea;

    for (let i = 0; i < n; i++) {
      const k = this.coherence[i]!;
      const wasCalm = this.prevCalm[i] === 1;
      // Confirmed oscillators are structure — exclude from calm regions.
      if (this.oscMask[i]) {
        this.calmMask[i] = 0;
      } else {
        this.calmMask[i] = wasCalm ? (k >= exit ? 1 : 0) : k >= enter ? 1 : 0;
      }
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
      let sumS = 0;
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
        sumD += this.deltaSmooth[i]!;
        sumK += this.coherence[i]!;
        sumS += this.similarity[i]!;
        sumR += current.r[i]!;
        sumG += current.g[i]!;
        sumB += current.b[i]!;

        const count = cellBuf.length;
        const meanR = sumR / count;
        const meanG = sumG / count;
        const meanB = sumB / count;

        const nIdx = [
          y * w + ((x + 1) % w),
          y * w + ((x - 1 + w) % w),
          ((y + 1) % h) * w + x,
          ((y - 1 + h) % h) * w + x,
        ];
        for (const j of nIdx) {
          if (!this.calmMask[j] || this.labels[j]! >= 0) continue;
          const d = rgbDelta(
            current.r[j]!,
            current.g[j]!,
            current.b[j]!,
            meanR,
            meanG,
            meanB,
          );
          if (d > colourEps) continue;
          this.labels[j] = regions.length;
          this.queue[qt++] = j;
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
      const comConcX = Math.hypot(sumXCos, sumXSin) / area;
      const comConcY = Math.hypot(sumYCos, sumYSin) / area;

      const avgR = sumR / area;
      const avgG = sumG / area;
      const avgB = sumB / area;

      let minDx = 0;
      let maxDx = 0;
      let minDy = 0;
      let maxDy = 0;
      // Second pass: extents and colour spread both need the finished means.
      let sumSpreadSq = 0;
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
        const cd = rgbDelta(
          current.r[i]!,
          current.g[i]!,
          current.b[i]!,
          avgR,
          avgG,
          avgB,
        );
        sumSpreadSq += cd * cd;
      }
      const colourSpread = Math.sqrt(sumSpreadSq / area);

      const width = Math.max(1, maxDx - minDx + 1);
      const height = Math.max(1, maxDy - minDy + 1);
      const minX = (comX + minDx + w) % w;
      const maxX = (comX + maxDx + w) % w;
      const minY = (comY + minDy + h) % h;
      const maxY = (comY + maxDy + h) % h;
      const fillRatio = clamp01(area / (width * height));

      const cells = Uint32Array.from(cellBuf);
      regions.push({
        id: -1,
        area,
        comX,
        comY,
        comConcX,
        comConcY,
        velX: 0,
        velY: 0,
        meanDelta: sumD / area,
        meanCoherence: sumK / area,
        meanSimilarity: sumS / area,
        meanR: avgR,
        meanG: avgG,
        meanB: avgB,
        colourSpread,
        minX,
        maxX,
        minY,
        maxY,
        width,
        height,
        fillRatio,
        cells,
      });
    }

    this.assignIdsAndVelocity(regions);
    return regions;
  }

  private assignIdsAndVelocity(regions: CoherentRegion[]): void {
    const { width: w, height: h } = this;
    const maxDist = FIELD_OBS.comMatchDist;
    const colourEps = FIELD_OBS.idColourEps;
    const minIoU = FIELD_OBS.idMinIoU;
    const va = FIELD_OBS.velocityEma;
    const usedPrev = new Set<number>();

    for (const region of regions) {
      let best = -1;
      let bestScore = Infinity;

      for (let p = 0; p < this.prevRegions.length; p++) {
        if (usedPrev.has(p)) continue;
        const prev = this.prevRegions[p]!;
        const comD = Math.hypot(
          toroidalDelta(region.comX, prev.comX, w),
          toroidalDelta(region.comY, prev.comY, h),
        );
        if (comD > maxDist) continue;

        const colourD = rgbDelta(
          region.meanR,
          region.meanG,
          region.meanB,
          prev.meanR,
          prev.meanG,
          prev.meanB,
        );
        if (colourD > colourEps) continue;

        const iou = cellIoU(region.cells, prev.cells);
        // Lower is better: COM distance, colour distance, soft IoU penalty.
        const score = comD + colourD * 8 + (1 - Math.max(iou, minIoU)) * 4;
        if (score < bestScore) {
          bestScore = score;
          best = p;
        }
      }

      if (best >= 0) {
        const prev = this.prevRegions[best]!;
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

    this.prevRegions = regions.map((r) => ({
      id: r.id,
      comX: r.comX,
      comY: r.comY,
      velX: r.velX,
      velY: r.velY,
      meanR: r.meanR,
      meanG: r.meanG,
      meanB: r.meanB,
      cells: r.cells,
    }));
  }

  /**
   * Partition non-calm cells into chaotic (changing) vs textured (static detail).
   * `buildChaotic` name retained for verify regex / history.
   */
  private buildRemainder(
    coherent: CoherentRegion[],
    current: RgbField,
  ): { chaotic: ChaoticArea; textured: TexturedArea } {
    return {
      chaotic: this.buildChaotic(coherent),
      textured: this.buildTextured(coherent, current),
    };
  }

  private buildChaotic(coherent: CoherentRegion[]): ChaoticArea {
    const n = this.width * this.height;
    const inCalm = new Uint8Array(n);
    for (const r of coherent) {
      for (let i = 0; i < r.cells.length; i++) {
        inCalm[r.cells[i]!] = 1;
      }
    }

    const chaosMin = FIELD_OBS.chaosDeltaMin;
    const cells: number[] = [];
    let sumD = 0;
    let sumK = 0;
    let sumS = 0;
    let maxDelta = 0;
    for (let i = 0; i < n; i++) {
      if (inCalm[i] || this.oscMask[i]) continue;
      const d = this.deltaSmooth[i]!;
      if (d < chaosMin) continue;
      cells.push(i);
      sumD += d;
      sumK += this.coherence[i]!;
      sumS += this.similarity[i]!;
      if (d > maxDelta) maxDelta = d;
    }
    const area = cells.length;
    return {
      area,
      meanDelta: area ? sumD / area : 0,
      meanCoherence: area ? sumK / area : 0,
      meanSimilarity: area ? sumS / area : 0,
      maxDelta,
      cells: Uint32Array.from(cells),
    };
  }

  private buildTextured(
    coherent: CoherentRegion[],
    current: RgbField,
  ): TexturedArea {
    const n = this.width * this.height;
    const inCalm = new Uint8Array(n);
    for (const r of coherent) {
      for (let i = 0; i < r.cells.length; i++) {
        inCalm[r.cells[i]!] = 1;
      }
    }

    const chaosMin = FIELD_OBS.chaosDeltaMin;
    const cells: number[] = [];
    let sumD = 0;
    let sumK = 0;
    let sumS = 0;
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    for (let i = 0; i < n; i++) {
      if (inCalm[i] || this.oscMask[i]) continue;
      const d = this.deltaSmooth[i]!;
      if (d >= chaosMin) continue;
      cells.push(i);
      sumD += d;
      sumK += this.coherence[i]!;
      sumS += this.similarity[i]!;
      sumR += current.r[i]!;
      sumG += current.g[i]!;
      sumB += current.b[i]!;
    }
    const area = cells.length;
    const avgR = area ? sumR / area : 0;
    const avgG = area ? sumG / area : 0;
    const avgB = area ? sumB / area : 0;

    // Second pass: colour spread needs the finished bag mean.
    let sumSpreadSq = 0;
    for (let c = 0; c < cells.length; c++) {
      const i = cells[c]!;
      const cd = rgbDelta(
        current.r[i]!,
        current.g[i]!,
        current.b[i]!,
        avgR,
        avgG,
        avgB,
      );
      sumSpreadSq += cd * cd;
    }

    return {
      area,
      meanDelta: area ? sumD / area : 0,
      meanCoherence: area ? sumK / area : 0,
      meanSimilarity: area ? sumS / area : 0,
      meanR: avgR,
      meanG: avgG,
      meanB: avgB,
      colourSpread: area ? Math.sqrt(sumSpreadSq / area) : 0,
      cells: Uint32Array.from(cells),
    };
  }

  private pushHistory(current: RgbField): void {
    const slot = this.histWrite;
    this.histR[slot]!.set(current.r);
    this.histG[slot]!.set(current.g);
    this.histB[slot]!.set(current.b);
    this.histWrite = (this.histWrite + 1) % this.histLen;
    if (this.histCount < this.histLen) this.histCount += 1;
  }

  private frameAt(age: number): {
    r: Float32Array;
    g: Float32Array;
    b: Float32Array;
  } | null {
    if (age < 0 || age >= this.histCount) return null;
    const idx = (this.histWrite - 1 - age + this.histLen) % this.histLen;
    return {
      r: this.histR[idx]!,
      g: this.histG[idx]!,
      b: this.histB[idx]!,
    };
  }

  private updateOscillators(current: RgbField): void {
    const n = this.width * this.height;
    const maxP = FIELD_OBS.oscPeriodMax;
    const eps = FIELD_OBS.oscMatchEps;
    const dMin = FIELD_OBS.oscDeltaMin;
    const confirm = FIELD_OBS.oscConfirmCycles;
    const cur = this.frameAt(0);
    if (!cur || this.histCount < 3) {
      this.oscMask.fill(0);
      return;
    }

    for (let i = 0; i < n; i++) {
      if (this.delta[i]! <= dMin) {
        // Inactive — decay streak.
        if (this.oscStreak[i]! > 0) this.oscStreak[i]!--;
        if (this.oscStreak[i] === 0) this.oscPeriod[i] = 0;
        this.oscMask[i] = 0;
        continue;
      }

      let matched = 0;
      for (let p = 2; p <= maxP; p++) {
        const past = this.frameAt(p);
        if (!past) break;
        const d = rgbDelta(
          cur.r[i]!,
          cur.g[i]!,
          cur.b[i]!,
          past.r[i]!,
          past.g[i]!,
          past.b[i]!,
        );
        if (d < eps) {
          matched = p;
          break;
        }
      }

      if (matched > 0) {
        if (this.oscPeriod[i] === matched) {
          this.oscStreak[i]!++;
        } else {
          this.oscPeriod[i] = matched;
          this.oscStreak[i] = 1;
        }
      } else {
        if (this.oscStreak[i]! > 0) this.oscStreak[i]!--;
        if (this.oscStreak[i] === 0) this.oscPeriod[i] = 0;
      }

      const p = this.oscPeriod[i]!;
      const need = confirm * Math.max(1, p);
      this.oscMask[i] = p > 0 && this.oscStreak[i]! >= need ? 1 : 0;
    }

    // Silence unused binding warning for current (history already pushed).
    void current;
  }

  private buildOscillatorGroups(current: RgbField): OscillatorGroup[] {
    const n = this.width * this.height;
    const byPeriod = new Map<number, number[]>();
    for (let i = 0; i < n; i++) {
      if (!this.oscMask[i]) continue;
      const p = this.oscPeriod[i]!;
      let list = byPeriod.get(p);
      if (!list) {
        list = [];
        byPeriod.set(p, list);
      }
      list.push(i);
    }
    const groups: OscillatorGroup[] = [];
    for (const [period, cells] of byPeriod) {
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let sumD = 0;
      for (const i of cells) {
        sumR += current.r[i]!;
        sumG += current.g[i]!;
        sumB += current.b[i]!;
        sumD += this.deltaSmooth[i]!;
      }
      const area = cells.length;
      groups.push({
        period,
        area,
        cells: Uint32Array.from(cells),
        meanR: sumR / area,
        meanG: sumG / area,
        meanB: sumB / area,
        meanDelta: sumD / area,
      });
    }
    groups.sort((a, b) => a.period - b.period);
    return groups;
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

function cellIoU(a: Uint32Array, b: Uint32Array): number {
  if (a.length === 0 || b.length === 0) return 0;
  const set = new Set<number>();
  for (let i = 0; i < a.length; i++) set.add(a[i]!);
  let inter = 0;
  for (let i = 0; i < b.length; i++) {
    if (set.has(b[i]!)) inter += 1;
  }
  const union = a.length + b.length - inter;
  return union > 0 ? inter / union : 0;
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

/** One-pass 3×3 toroidal box blur of per-cell δ. */
function blurDelta3x3(
  src: Float32Array,
  dst: Float32Array,
  w: number,
  h: number,
): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = (y + dy + h) % h;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = (x + dx + w) % w;
          sum += src[ny * w + nx]!;
        }
      }
      dst[y * w + x] = sum / 9;
    }
  }
}

function emptyObservation(
  width: number,
  height: number,
  delta: Float32Array,
  deltaSmooth: Float32Array,
  similarity: Float32Array,
  coherence: Float32Array,
): FieldObservation {
  return {
    width,
    height,
    delta,
    deltaSmooth,
    similarity,
    coherence,
    coherent: [],
    chaotic: {
      area: width * height,
      meanDelta: 0,
      meanCoherence: 0,
      meanSimilarity: 0,
      maxDelta: 0,
      cells: new Uint32Array(0),
    },
    textured: {
      area: 0,
      meanDelta: 0,
      meanCoherence: 0,
      meanSimilarity: 0,
      meanR: 0,
      meanG: 0,
      meanB: 0,
      colourSpread: 0,
      cells: new Uint32Array(0),
    },
    oscillators: [],
    meanDelta: 0,
    meanCoherence: 0,
    calmAreaFraction: 0,
    chaosAreaFraction: 1,
    texturedAreaFraction: 0,
  };
}
