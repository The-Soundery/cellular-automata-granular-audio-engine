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
  /**
   * Occupancy COM speed (cells/step) to treat a periodic cluster as travel.
   * Same floor as flow — a sitting blinker stays put; a sliding one does not.
   */
  oscTravelMinSpeed: 0.65,
  /**
   * Circular concentration below this: COM on that axis is not a location
   * (full-width wave on a torus).
   */
  oscComConcMin: 0.35,
  /** Frames of consistent occupancy or hop motion before stripping osc. */
  oscTravelConfirm: 3,
  /**
   * Colour-correspondence hop (cells/step) that marks a wave even when COM
   * sits still. Same scale as oscTravelMinSpeed.
   */
  oscHopMin: 0.65,
  /** Chebyshev radius to search previous-frame colour for hop votes. */
  oscHopRadius: 4,
  /**
   * Chebyshev join for osc occupancy clusters. 2 bridges a GoL-style blinker
   * (arms 2 apart around a still centre) so the pair is one sitting object.
   */
  oscClusterJoin: 2,
  /** Max cells a colour may travel in one step and still count as flow. */
  flowSearchRadius: 12,
  /** Same scale as regionColourEps — a travelling colour must stay itself. */
  flowColourEps: 0.12,
  /** Frames of consistent heading before a flow is confirmed (~0.3s at 26fps). */
  flowConfirmSteps: 8,
  /**
   * Directed travel floor (cells along heading). Consistency is the streak;
   * absolute distance stays low so short-lived streams can still confirm.
   */
  flowMinTravel: 1.5,
  /** |vel| below this is sitting still, not flow. */
  flowMinSpeed: 0.65,
  /** Confirmed flow may slow to this before it is treated as stopped. */
  flowMinSpeedExit: 0.4,
  /** Max |Δvel| to treat two particles as the same motion. */
  flowVelEps: 0.85,
  /** Colour occupying more than this fraction of the grid is background, unless it is changing. */
  flowCommonFrac: 0.25,
  /**
   * Flow is organised *change*: member cells must be temporally active.
   * Same floor as chaos, so a still colour block cannot be flow.
   */
  flowDeltaMin: 0.045,
  /**
   * Coarse block size (cells) for flow detection. Replaces large-radius
   * colour flood-fill (O(active) accumulate, not O(active·join²)).
   */
  flowBinSize: 4,
  /** Cap live blocks processed per frame (busy-field cost rail). */
  flowMaxBlocks: 192,
  /**
   * Above this change fraction with no live track, hunt with a smaller block
   * budget (do not abort — live CA is often busy).
   */
  flowScrambleFrac: 0.72,
  /** Block budget when the field is scrambling. */
  flowMaxBlocksScramble: 96,
  /**
   * Overlay dilate radius (cells). Detection no longer flood-fills here.
   */
  flowJoinRadius: 5,
  /**
   * Same-colour heading-aligned blocks may chain if COM gap is within this
   * (cells).
   */
  flowStreamJoin: 22,
  /** Max cross-track width (cells) relative to shared heading when chaining. */
  flowLaneWidth: 8,
  /** Min heading cosine to stitch two moving blocks into one stream. */
  flowStitchHeadingCos: 0.5,
  /** New flow: at least this many active cells in the cluster. */
  flowMinCellsTight: 4,
  /** Keep tracking / measure velocity down to this size. */
  flowMinCellsKeep: 3,
  /** Frames a confirmed flow may miss before it is dropped. */
  flowHoldFrames: 16,
  /** Reject groups that span nearly the whole grid in both axes (wrap junk). */
  flowMaxSpanFrac: 0.85,
  /** When measured flow % falls, ease toward it (1 = snap to 0 — the flicker bug). */
  flowFracRelease: 0.28,
  /**
   * Solid slab/bar fill of bbox — not particle flow. Spaced packs sit below this.
   */
  flowSolidFillMin: 0.88,
  /** Both axes must be at least this thick for the solid-fill reject. */
  flowSolidMinSpan: 4,
  /**
   * Fraction of blob cells with a same-colour calm Chebyshev neighbour.
   * Only rejects dense/low-hop packs (stamp glued to a mass). Thin travelling
   * colour may sit on a calm edge (live wavefronts).
   */
  flowCalmAdjFrac: 0.45,
  /** netDisplacement / pathLength floor — rejects COM jitter walks. */
  flowMinStraightness: 0.35,
  /**
   * If this fraction of members have an emerging oscillator period, defer
   * flow emit (confirmed osc already excluded via oscMask).
   */
  flowEmergingOscFrac: 0.5,
  /**
   * Mean fraction of Chebyshev-1 neighbours that are also members.
   * At/above this the blob is stamp-like (solid body), not a gappy pattern.
   * Raised so denser joined cascades can still count as flow.
   */
  flowMaxLocalDensity: 0.72,
  /**
   * Member cells / dilated footprint cap — travelling stamps fill the patch;
   * sparse / uneven packs sit below. Raised for denser cascades.
   */
  flowMaxPackT: 0.65,
  /** EMA blend for local density during confirm. */
  flowDensityEma: 0.35,
  /** Reject absurd COM jumps (noise matching), keep fast blobs (~5 cells/frame). */
  flowMaxSpeed: 6,
  /**
   * Same-cell colour persistence — with high true-AABB fill this is a sliding
   * body (not flow). Gappy packs stay below the fill floor.
   */
  flowMaxPersistT: 0.7,
  /** Member AABB fill paired with flowMaxPersistT to reject stamps. */
  flowPersistFillReject: 0.36,
  /** EMA hop churn floor to confirm flow (broken / rhythmic enough). */
  flowMinHopT: 0.15,
  /** Prefer hop-ish churn when correspondence and COM disagree. */
  flowHopDominate: 1.15,
  /** EMA blend for hop churn during confirm. */
  flowHopEma: 0.35,
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

/** Confirmed travelling colour: nearby cells sharing direction and speed. */
export interface FlowGroup {
  id: number;
  /** Member cells (the particles). */
  area: number;
  /** Occupied patch including gaps between nearby members. */
  regionArea: number;
  comX: number;
  comY: number;
  velX: number;
  velY: number;
  meanR: number;
  meanG: number;
  meanB: number;
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
  flows: FlowGroup[];
  meanDelta: number;
  meanCoherence: number;
  calmAreaFraction: number;
  chaosAreaFraction: number;
  texturedAreaFraction: number;
  flowAreaFraction: number;
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

type PrevOscCluster = {
  period: number;
  comX: number;
  comY: number;
  velX: number;
  velY: number;
  concX: number;
  concY: number;
  /** Frames of directed occupancy or hop travel. */
  travelStreak: number;
};

type PrevFlow = {
  id: number;
  comX: number;
  comY: number;
  velX: number;
  velY: number;
  meanR: number;
  meanG: number;
  meanB: number;
  streak: number;
  hold: number;
  originX: number;
  originY: number;
  /** Unwrapped COM displacement from track start (sum of step deltas). */
  accumDx: number;
  accumDy: number;
  /** Cumulative per-step COM path length (cells). */
  pathLength: number;
  /** Confirm-window frames with instant speed below flowMinSpeed. */
  slowFrames: number;
  /** EMA of member local density (stamp-like → high). */
  densityEma: number;
  /** EMA of hop churn (1 − same-cell persist). */
  hopEma: number;
  regionArea: number;
  cells: Uint32Array;
};

type FlowBlock = {
  bx: number;
  by: number;
  count: number;
  comX: number;
  comY: number;
  meanR: number;
  meanG: number;
  meanB: number;
  velX: number;
  velY: number;
  persistT: number;
  hopT: number;
  cells: number[];
};

/** Cluster of coarse blocks after heading/colour join — feeds temporal confirm. */
type FlowCluster = {
  cells: number[];
  comX: number;
  comY: number;
  width: number;
  height: number;
  meanR: number;
  meanG: number;
  meanB: number;
  velX: number;
  velY: number;
  persistT: number;
  hopT: number;
  /** Occupied coarse-block footprint (cells²), cheap regionArea. */
  regionArea: number;
  /** Mean block fill (stamp-like → high). */
  density: number;
  blockCount: number;
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
  private readonly flowMark: Uint8Array;
  private readonly histLen: number;
  private readonly histR: Float32Array[];
  private readonly histG: Float32Array[];
  private readonly histB: Float32Array[];
  private histWrite = 0;
  private histCount = 0;
  private prevRegions: PrevRegion[] = [];
  private nextRegionId = 1;
  private prevFlows: PrevFlow[] = [];
  private nextFlowId = 1;
  /** Flow clusters from the previous observe (velocity match). */
  private prevFlowClusters: FlowCluster[] = [];
  private prevFlowBlocks: FlowBlock[] = [];
  private prevOscClusters: PrevOscCluster[] = [];
  private primed = false;
  private flowFracDisp = 0;
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
    this.flowMark = new Uint8Array(n);
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
    this.flowMark.fill(0);
    this.histWrite = 0;
    this.histCount = 0;
    for (let h = 0; h < this.histLen; h++) {
      this.histR[h]!.fill(0);
      this.histG[h]!.fill(0);
      this.histB[h]!.fill(0);
    }
    this.prevRegions = [];
    this.nextRegionId = 1;
    this.prevFlows = [];
    this.nextFlowId = 1;
    this.prevFlowClusters = [];
    this.prevFlowBlocks = [];
    this.prevOscClusters = [];
    this.primed = false;
    this.flowFracDisp = 0;
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
    this.suppressTravellingOscillators(current, previous);
    const oscillators = this.buildOscillatorGroups(current);

    const coherent = this.extractRegions(current);
    const flows = this.extractFlows(current, previous, coherent);
    const flowCells = this.markFlowFootprint(flows);
    const measured = flowCells / n;
    if (measured >= this.flowFracDisp) {
      this.flowFracDisp = measured;
    } else {
      this.flowFracDisp +=
        FIELD_OBS.flowFracRelease * (measured - this.flowFracDisp);
      if (this.flowFracDisp < 0.001) this.flowFracDisp = 0;
    }
    const { chaotic, textured } = this.buildRemainder(coherent, current);
    let calmCells = coherent.reduce((sum, r) => sum + r.area, 0);
    if (flows.length) {
      for (const f of flows) {
        for (let c = 0; c < f.cells.length; c++) {
          if (this.calmMask[f.cells[c]!]) calmCells--;
        }
      }
      if (calmCells < 0) calmCells = 0;
    }

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
      flows,
      meanDelta,
      meanCoherence: meanKappa,
      calmAreaFraction: calmCells / n,
      chaosAreaFraction: chaotic.area / n,
      texturedAreaFraction: textured.area / n,
      flowAreaFraction: this.flowFracDisp,
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
   * Flow via similarity travel: a colour that reappears nearby along a heading.
   * Coarse blocks match the previous same-hue block (correspondence); COM of a
   * pack is a fallback, not the definition. Solid masses stay calm.
   */
  private extractFlows(
    current: RgbField,
    previous: RgbField,
    coherent: CoherentRegion[],
  ): FlowGroup[] {
    if (!this.primed) {
      this.prevFlows = [];
      this.prevFlowClusters = [];
      this.prevFlowBlocks = [];
      return [];
    }

    const { width: w, height: h } = this;
    const n = w * h;
    const dMin = FIELD_OBS.flowDeltaMin;
    const skipNow = new Uint8Array(n);
    let skipped = 0;
    for (let i = 0; i < n; i++) {
      // Do not skip oscMask here: dashed streams revisit sites every 2 steps
      // and look like period-2 at the cell, but are flow in aggregate.
      // Confirmed still blinkers fail travel/speed; emergingOscDefer remains.
      if (this.calmMask[i] || this.deltaSmooth[i]! < dMin) {
        skipNow[i] = 1;
        skipped += 1;
      }
    }
    const changing = n - skipped;
    const scrambling =
      changing > n * FIELD_OBS.flowScrambleFrac && this.prevFlows.length === 0;
    const blockCap = scrambling
      ? FIELD_OBS.flowMaxBlocksScramble
      : FIELD_OBS.flowMaxBlocks;

    const blocks = this.accumulateFlowBlocks(
      current,
      previous,
      skipNow,
      blockCap,
    );
    this.matchBlockCorrespondence(blocks, this.prevFlowBlocks);
    // Cluster by colour + heading + lane (similarity travel), not pack-COM.
    let clusters = this.clusterFlowBlocks(blocks);
    // Pack velocity: cluster COM correspondence (block votes are too noisy
    // inside 4×4 bins). Block vels already informed the stitch.
    this.matchClusterVelocity(clusters, this.prevFlowClusters);
    this.suppressClusterFieldShift(clusters);
    this.prevFlowBlocks = blocks;
    this.prevFlowClusters = clusters;
    clusters = clusters.filter((c) => clusterLooksLikeFlow(c, w, h));

    const flows: FlowGroup[] = [];
    const usedCluster = new Set<number>();
    const usedPrev = new Set<number>();
    const nextPrev: PrevFlow[] = [];
    const colourEps = FIELD_OBS.idColourEps;
    const maxDist = FIELD_OBS.flowSearchRadius;
    const need = FIELD_OBS.flowConfirmSteps;
    const holdMax = FIELD_OBS.flowHoldFrames;
    const ema = FIELD_OBS.velocityEma;
    const minTravel = FIELD_OBS.flowMinTravel;
    const minStraight = FIELD_OBS.flowMinStraightness;

    const duplicatesCalm = (c: FlowCluster, velX: number, velY: number) =>
      coherent.some((r) => {
        if (
          rgbDelta(
            c.meanR,
            c.meanG,
            c.meanB,
            r.meanR,
            r.meanG,
            r.meanB,
          ) > FIELD_OBS.flowColourEps
        ) {
          return false;
        }
        const speed = Math.hypot(velX, velY);
        const rSpeed = Math.hypot(r.velX, r.velY);
        if (Math.hypot(velX - r.velX, velY - r.velY) < FIELD_OBS.flowVelEps) {
          return true;
        }
        const comDist = Math.hypot(
          toroidalDelta(c.comX, r.comX, w),
          toroidalDelta(c.comY, r.comY, h),
        );
        if (comDist > maxDist) return false;
        if (speed < 1e-4 || rSpeed < FIELD_OBS.flowMinSpeedExit) return false;
        const cos = (velX * r.velX + velY * r.velY) / (speed * rSpeed);
        return cos >= 0.5;
      });

    const rejectCluster = (c: FlowCluster, velX: number, velY: number) => {
      if (duplicatesCalm(c, velX, velY)) return true;
      const stamp = memberAabbStats(c.cells, w, h);
      // Thin / gappy travelling colour may ride a calm mass (clip-3 wavefronts).
      // Only treat calm-adjacency as "edge of a stamp" when the pack is dense
      // or hop is too low to be correspondence travel.
      if (this.clusterAdjacentToCalm(c, current)) {
        const denseEdge =
          (stamp.fill >= FIELD_OBS.flowPersistFillReject &&
            stamp.minSpan >= 5) ||
          c.hopT < FIELD_OBS.flowMinHopT;
        if (denseEdge) return true;
      }
      // Sliding stamp: high persist + filled AABB with real 2D extent,
      // or large body with low hop churn (fragmented L still slides).
      const stampShape =
        stamp.fill >= FIELD_OBS.flowPersistFillReject &&
        stamp.minSpan >= 5 &&
        stamp.maxSpan >= 8;
      const stampHop =
        c.cells.length >= 30 && c.hopT < FIELD_OBS.flowMinHopT * 2;
      if (
        c.persistT >= FIELD_OBS.flowMaxPersistT &&
        (stampShape || stampHop)
      ) {
        return true;
      }
      if (c.density >= FIELD_OBS.flowMaxLocalDensity) return true;
      const packT = c.cells.length / Math.max(1, c.regionArea);
      return packT > FIELD_OBS.flowMaxPackT;
    };

    const emit = (row: PrevFlow) => {
      if (row.streak < need) return;
      const speed = Math.hypot(row.velX, row.velY);
      if (speed < FIELD_OBS.flowMinSpeedExit) return;
      const directed = Math.abs(
        (row.accumDx * row.velX + row.accumDy * row.velY) / speed,
      );
      if (directed < minTravel) return;
      if (row.pathLength > 1e-3 && Math.hypot(row.accumDx, row.accumDy) / row.pathLength < minStraight) return;
      if (row.slowFrames > row.streak * 0.7) return;
      if (row.densityEma >= FIELD_OBS.flowMaxLocalDensity) return;
      if (row.hopEma < FIELD_OBS.flowMinHopT) return;
      if (
        row.cells.length / Math.max(1, row.regionArea) >
        FIELD_OBS.flowMaxPackT
      ) {
        return;
      }
      // Moving packs win over site-revisit "osc" (dashed streams look period-2).
      // Still / jittering emerging blinkers still defer.
      if (
        speed < FIELD_OBS.flowMinSpeed &&
        this.emergingOscDefer(row.cells)
      ) {
        return;
      }
      flows.push({
        id: row.id,
        area: row.cells.length,
        regionArea: row.regionArea,
        comX: row.comX,
        comY: row.comY,
        velX: row.velX,
        velY: row.velY,
        meanR: row.meanR,
        meanG: row.meanG,
        meanB: row.meanB,
        cells: row.cells,
      });
    };

    for (let p = 0; p < this.prevFlows.length; p++) {
      const prev = this.prevFlows[p]!;
      let best = -1;
      let bestScore = Infinity;
      for (let i = 0; i < clusters.length; i++) {
        if (usedCluster.has(i)) continue;
        const t = clusters[i]!;
        const colourD = rgbDelta(
          t.meanR,
          t.meanG,
          t.meanB,
          prev.meanR,
          prev.meanG,
          prev.meanB,
        );
        if (colourD > colourEps) continue;
        const confirmed = prev.streak >= need;
        const areaRatio =
          Math.min(t.cells.length, prev.cells.length) /
          Math.max(t.cells.length, prev.cells.length);
        if (areaRatio < (confirmed ? 0.08 : 0.12)) continue;
        const dist = Math.hypot(
          toroidalDelta(t.comX, prev.comX + prev.velX, w),
          toroidalDelta(t.comY, prev.comY + prev.velY, h),
        );
        if (dist > (confirmed ? maxDist * 1.5 : maxDist) && areaRatio < 0.5) {
          continue;
        }
        const score = colourD * 4 + dist + (1 - areaRatio) * 8;
        if (score < bestScore) {
          bestScore = score;
          best = i;
        }
      }
      if (best < 0) continue;
      const t = clusters[best]!;
      const comDx = toroidalDelta(t.comX, prev.comX, w);
      const comDy = toroidalDelta(t.comY, prev.comY, h);
      // Correspondence (block match) is the motion primitive. COM of the
      // active pack is only a fallback when similarity travel is silent.
      let instX = t.velX;
      let instY = t.velY;
      const blockSpeed = Math.hypot(instX, instY);
      const comSpeed = Math.hypot(comDx, comDy);
      const prevSpeed = Math.hypot(prev.velX, prev.velY);
      if (blockSpeed < FIELD_OBS.flowMinSpeedExit) {
        instX = comDx;
        instY = comDy;
      }
      let speed = Math.hypot(instX, instY);
      if (speed < FIELD_OBS.flowMinSpeedExit) {
        if (prevSpeed >= FIELD_OBS.flowMinSpeed) {
          instX = prev.velX;
          instY = prev.velY;
          speed = prevSpeed;
        } else {
          continue;
        }
      }
      // Absurd COM jumps (wrapping structures): coast on previous heading.
      if (speed > FIELD_OBS.flowMaxSpeed) {
        if (
          comSpeed <= FIELD_OBS.flowMaxSpeed &&
          comSpeed >= FIELD_OBS.flowMinSpeedExit
        ) {
          instX = comDx;
          instY = comDy;
          speed = comSpeed;
        } else if (prevSpeed >= FIELD_OBS.flowMinSpeedExit) {
          instX = prev.velX;
          instY = prev.velY;
          speed = prevSpeed;
        } else {
          continue;
        }
      }
      if (prev.streak < need && prevSpeed > 0.4 && speed > 0.4) {
        const cos =
          (instX * prev.velX + instY * prev.velY) / (speed * prevSpeed);
        if (cos < 0.5) continue;
      }
      if (rejectCluster(t, instX, instY)) continue;
      usedCluster.add(best);
      usedPrev.add(p);
      const small =
        prev.streak < need && t.cells.length < FIELD_OBS.flowMinCellsTight;
      const slowAdd = speed < FIELD_OBS.flowMinSpeed ? 1 : 0;
      const densEma = FIELD_OBS.flowDensityEma;
      const hopEmaBlend = FIELD_OBS.flowHopEma;
      const row: PrevFlow = {
        id: prev.id,
        comX: t.comX,
        comY: t.comY,
        velX: prev.velX + ema * (instX - prev.velX),
        velY: prev.velY + ema * (instY - prev.velY),
        meanR: t.meanR,
        meanG: t.meanG,
        meanB: t.meanB,
        streak: prev.streak + 1,
        hold: small ? prev.hold - 1 : holdMax,
        originX: prev.originX,
        originY: prev.originY,
        accumDx: prev.accumDx + instX,
        accumDy: prev.accumDy + instY,
        pathLength: prev.pathLength + speed,
        slowFrames: prev.slowFrames + slowAdd,
        densityEma: prev.densityEma + densEma * (t.density - prev.densityEma),
        hopEma: prev.hopEma + hopEmaBlend * (t.hopT - prev.hopEma),
        regionArea: t.regionArea,
        cells: Uint32Array.from(t.cells),
      };
      if (row.hold > 0) {
        nextPrev.push(row);
        emit(row);
      }
    }

    const minNewCells = scrambling
      ? Math.max(FIELD_OBS.flowMinCellsTight, 8)
      : FIELD_OBS.flowMinCellsTight;
    for (let i = 0; i < clusters.length; i++) {
      if (usedCluster.has(i)) continue;
      const t = clusters[i]!;
      if (t.cells.length < minNewCells) continue;
      const speed = Math.hypot(t.velX, t.velY);
      if (speed < FIELD_OBS.flowMinSpeed) continue;
      if (speed > FIELD_OBS.flowMaxSpeed) continue;
      if (rejectCluster(t, t.velX, t.velY)) continue;
      const row: PrevFlow = {
        id: this.nextFlowId++,
        comX: t.comX,
        comY: t.comY,
        velX: t.velX,
        velY: t.velY,
        meanR: t.meanR,
        meanG: t.meanG,
        meanB: t.meanB,
        streak: 1,
        hold: holdMax,
        originX: t.comX,
        originY: t.comY,
        accumDx: 0,
        accumDy: 0,
        pathLength: 0,
        slowFrames: 0,
        densityEma: t.density,
        hopEma: t.hopT,
        regionArea: t.regionArea,
        cells: Uint32Array.from(t.cells),
      };
      nextPrev.push(row);
      emit(row);
    }

    for (let p = 0; p < this.prevFlows.length; p++) {
      if (usedPrev.has(p)) continue;
      const prev = this.prevFlows[p]!;
      if (prev.streak < need) continue;
      const hold = prev.hold - 1;
      if (hold <= 0) continue;
      const row: PrevFlow = {
        ...prev,
        comX: ((prev.comX + prev.velX) % w + w) % w,
        comY: ((prev.comY + prev.velY) % h + h) % h,
        hold,
      };
      nextPrev.push(row);
      emit(row);
    }

    this.prevFlows = nextPrev;
    return flows;
  }

  /** Accumulate active cells into coarse blocks — O(active). */
  private accumulateFlowBlocks(
    current: RgbField,
    previous: RgbField,
    skip: Uint8Array,
    maxBlocks: number = FIELD_OBS.flowMaxBlocks,
  ): FlowBlock[] {
    const { width: w, height: h } = this;
    const n = w * h;
    const bin = FIELD_OBS.flowBinSize;
    const bw = Math.ceil(w / bin);
    const hist = new Uint32Array(64);
    for (let i = 0; i < n; i++) {
      hist[colourBin(current.r[i]!, current.g[i]!, current.b[i]!)]++;
    }
    const commonCut = FIELD_OBS.flowCommonFrac * n;
    let modeBin = -1;
    let modeCount = 0;
    for (let b = 0; b < 64; b++) {
      if (hist[b]! > modeCount) {
        modeCount = hist[b]!;
        modeBin = b;
      }
    }
    // Skip still-dominant background colour so motion *wake* does not become
    // flow. Travelling rare hues are kept (clip-3 red-on-gold is a different bin).
    const skipMode = modeCount > commonCut ? modeBin : -1;

    // Spatially binned *per colour* so noise in the same 4×4 cannot muddy a
    // rare stream hue (busy live fields).
    type Acc = {
      bx: number;
      by: number;
      col: number;
      count: number;
      sumR: number;
      sumG: number;
      sumB: number;
      sumX: number;
      sumY: number;
      cells: number[];
    };
    const acc = new Map<number, Acc>();

    for (let i = 0; i < n; i++) {
      if (skip[i]) continue;
      const binCol = colourBin(current.r[i]!, current.g[i]!, current.b[i]!);
      if (binCol === skipMode) continue;
      const x = i % w;
      const y = (i / w) | 0;
      const bx = (x / bin) | 0;
      const by = (y / bin) | 0;
      const bi = by * bw + bx;
      const key = bi * 64 + binCol;
      let a = acc.get(key);
      if (!a) {
        a = {
          bx,
          by,
          col: binCol,
          count: 0,
          sumR: 0,
          sumG: 0,
          sumB: 0,
          sumX: 0,
          sumY: 0,
          cells: [],
        };
        acc.set(key, a);
      }
      a.count += 1;
      a.sumR += current.r[i]!;
      a.sumG += current.g[i]!;
      a.sumB += current.b[i]!;
      a.sumX += x;
      a.sumY += y;
      a.cells.push(i);
    }

    const live = [...acc.values()];
    // Prefer colours that are sparse on the field (streams) over busy
    // mid-tones that also sit under commonCut during scramble.
    const streamCut = Math.max(64, (n * 0.005) | 0);
    live.sort((a, b) => {
      const sa = hist[a.col]! <= streamCut ? 2 : hist[a.col]! <= commonCut ? 1 : 0;
      const sb = hist[b.col]! <= streamCut ? 2 : hist[b.col]! <= commonCut ? 1 : 0;
      return sb - sa || b.count - a.count;
    });
    const cap = Math.min(live.length, maxBlocks);
    const colourEps = FIELD_OBS.flowColourEps;
    const out: FlowBlock[] = [];

    for (let k = 0; k < cap; k++) {
      const a = live[k]!;
      const c = a.count;
      const meanR = a.sumR / c;
      const meanG = a.sumG / c;
      const meanB = a.sumB / c;
      const cells = a.cells;
      let persistent = 0;
      for (let t = 0; t < cells.length; t++) {
        const i = cells[t]!;
        if (
          rgbDelta(
            previous.r[i]!,
            previous.g[i]!,
            previous.b[i]!,
            meanR,
            meanG,
            meanB,
          ) <= colourEps
        ) {
          persistent += 1;
        }
      }
      const persistT = persistent / c;
      out.push({
        bx: a.bx,
        by: a.by,
        count: c,
        comX: a.sumX / c,
        comY: a.sumY / c,
        meanR,
        meanG,
        meanB,
        velX: 0,
        velY: 0,
        persistT,
        hopT: 1 - persistT,
        cells,
      });
    }
    return out;
  }

  /**
   * Similarity travel: each live block votes a displacement by matching the
   * nearest previous block of the same colour. Cheap (≤ flowMaxBlocks²).
   */
  private matchBlockCorrespondence(
    current: FlowBlock[],
    previous: FlowBlock[],
  ): void {
    if (previous.length === 0) return;
    const { width: w, height: h } = this;
    const maxDist = FIELD_OBS.flowSearchRadius;
    const colourEps = FIELD_OBS.flowColourEps;
    const order = current.map((_, i) => i);
    order.sort((a, b) => current[b]!.count - current[a]!.count);

    for (const ci of order) {
      const cur = current[ci]!;
      let best = -1;
      let bestDist = maxDist + 1e-6;
      for (let p = 0; p < previous.length; p++) {
        const prev = previous[p]!;
        if (
          rgbDelta(
            cur.meanR,
            cur.meanG,
            cur.meanB,
            prev.meanR,
            prev.meanG,
            prev.meanB,
          ) > colourEps
        ) {
          continue;
        }
        const dist = Math.hypot(
          toroidalDelta(cur.comX, prev.comX, w),
          toroidalDelta(cur.comY, prev.comY, h),
        );
        if (dist > maxDist) continue;
        if (dist < bestDist) {
          bestDist = dist;
          best = p;
        }
      }
      if (best < 0) continue;
      const prev = previous[best]!;
      cur.velX = toroidalDelta(cur.comX, prev.comX, w);
      cur.velY = toroidalDelta(cur.comY, prev.comY, h);
    }
  }

  /** Cluster COM correspondence — stable pack velocity after stitch. */
  private matchClusterVelocity(
    current: FlowCluster[],
    previous: FlowCluster[],
  ): void {
    if (previous.length === 0) return;
    const { width: w, height: h } = this;
    const maxDist = FIELD_OBS.flowSearchRadius;
    const colourEps = FIELD_OBS.flowColourEps;
    const used = new Set<number>();
    const order = current.map((_, i) => i);
    order.sort(
      (a, b) => current[b]!.cells.length - current[a]!.cells.length,
    );

    for (const ci of order) {
      const cur = current[ci]!;
      let best = -1;
      let bestDist = maxDist + 1e-6;
      for (let p = 0; p < previous.length; p++) {
        if (used.has(p)) continue;
        const prev = previous[p]!;
        if (
          rgbDelta(
            cur.meanR,
            cur.meanG,
            cur.meanB,
            prev.meanR,
            prev.meanG,
            prev.meanB,
          ) > colourEps
        ) {
          continue;
        }
        const areaRatio =
          Math.min(cur.cells.length, prev.cells.length) /
          Math.max(cur.cells.length, prev.cells.length);
        if (areaRatio < 0.12) continue;
        const dist = Math.hypot(
          toroidalDelta(cur.comX, prev.comX, w),
          toroidalDelta(cur.comY, prev.comY, h),
        );
        if (dist > maxDist) continue;
        if (dist < bestDist) {
          bestDist = dist;
          best = p;
        }
      }
      if (best < 0) continue;
      const prev = previous[best]!;
      used.add(best);
      cur.velX = toroidalDelta(cur.comX, prev.comX, w);
      cur.velY = toroidalDelta(cur.comY, prev.comY, h);
    }
  }

  private suppressClusterFieldShift(clusters: FlowCluster[]): void {
    const bins = new Map<string, FlowCluster[]>();
    for (const b of clusters) {
      if (Math.hypot(b.velX, b.velY) < FIELD_OBS.flowMinSpeed) continue;
      const key = `${Math.round(b.velX)},${Math.round(b.velY)}`;
      let list = bins.get(key);
      if (!list) {
        list = [];
        bins.set(key, list);
      }
      list.push(b);
    }
    for (const group of bins.values()) {
      if (group.length < 4) continue;
      const s = group[0]!;
      const mixed = group.some(
        (b) =>
          rgbDelta(s.meanR, s.meanG, s.meanB, b.meanR, b.meanG, b.meanB) >
          FIELD_OBS.flowColourEps,
      );
      if (!mixed) continue;
      for (const b of group) {
        b.velX = 0;
        b.velY = 0;
      }
    }
  }

  /**
   * Join same-colour blocks that share a heading and a thin lane.
   * Adjacent always merge. Longer gaps stitch by lane even before velocity
   * exists (dashed streams / wavefronts). 2D scatter stays unglued because
   * it fails lane geometry.
   */
  private clusterFlowBlocks(blocks: FlowBlock[]): FlowCluster[] {
    if (blocks.length === 0) return [];
    const { width: w, height: h } = this;
    const bin = FIELD_OBS.flowBinSize;
    const bw = Math.ceil(w / bin);
    const bh = Math.ceil(h / bin);
    const join = FIELD_OBS.flowStreamJoin;
    const lane = FIELD_OBS.flowLaneWidth;
    const colourEps = FIELD_OBS.flowColourEps;
    const minSpeed = FIELD_OBS.flowMinSpeedExit;
    const headingCos = FIELD_OBS.flowStitchHeadingCos;
    const velEps = FIELD_OBS.flowVelEps;
    const tight = FIELD_OBS.flowMinCellsTight;

    const parent = new Int32Array(blocks.length);
    for (let i = 0; i < blocks.length; i++) parent[i] = i;
    const find = (a: number): number => {
      let x = a;
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]!]!;
        x = parent[x]!;
      }
      return x;
    };

    for (let i = 0; i < blocks.length; i++) {
      const a = blocks[i]!;
      for (let j = i + 1; j < blocks.length; j++) {
        const b = blocks[j]!;
        if (
          rgbDelta(a.meanR, a.meanG, a.meanB, b.meanR, b.meanG, b.meanB) >
          colourEps
        ) {
          continue;
        }
        let dbx = Math.abs(a.bx - b.bx);
        let dby = Math.abs(a.by - b.by);
        if (dbx > bw * 0.5) dbx = bw - dbx;
        if (dby > bh * 0.5) dby = bh - dby;
        const blockCheb = Math.max(dbx, dby);
        const dx = toroidalDelta(b.comX, a.comX, w);
        const dy = toroidalDelta(b.comY, a.comY, h);
        const dist = Math.hypot(dx, dy);
        if (dist > join && blockCheb > 1) continue;

        const speedA = Math.hypot(a.velX, a.velY);
        const speedB = Math.hypot(b.velX, b.velY);
        let chainable = false;
        // Adjacent blocks of the same colour always join (stable packs).
        if (blockCheb <= 1) {
          chainable = true;
        } else if (dist <= join) {
          const ax = Math.abs(dx);
          const ay = Math.abs(dy);
          const strip =
            ax <= lane ||
            ay <= lane ||
            (ax >= 1 && ay >= 1 && Math.abs(ax - ay) <= lane);
          const bothLarge = a.count >= tight && b.count >= tight;
          if (speedA >= minSpeed && speedB >= minSpeed) {
            const cos =
              (a.velX * b.velX + a.velY * b.velY) / (speedA * speedB);
            if (
              cos >= headingCos &&
              Math.hypot(a.velX - b.velX, a.velY - b.velY) <= velEps
            ) {
              const vx = a.velX + b.velX;
              const vy = a.velY + b.velY;
              const vm = Math.hypot(vx, vy);
              if (vm > 1e-6) {
                const hx = vx / vm;
                const hy = vy / vm;
                const along = dx * hx + dy * hy;
                const cross = Math.abs(dx * hy - dy * hx);
                const alongPath =
                  Math.abs(along) <= join && cross <= lane;
                const acrossPath =
                  cross <= join && Math.abs(along) <= lane;
                // Parallel large packs stay separate; along-path may join.
                if (bothLarge && !alongPath) {
                  chainable = false;
                } else {
                  chainable = alongPath || acrossPath || strip;
                }
              }
            } else if (strip) {
              chainable = true;
            }
          } else if (strip) {
            // Cold start / no vel yet: same-hue thin lane is similarity travel
            // waiting for a correspondence vote (dashes, wavefront edges).
            chainable = true;
          }
        }
        if (!chainable) continue;
        const pa = find(i);
        const pb = find(j);
        if (pa !== pb) parent[pa] = pb;
      }
    }

    const groups = new Map<number, FlowBlock[]>();
    for (let i = 0; i < blocks.length; i++) {
      const r = find(i);
      let list = groups.get(r);
      if (!list) {
        list = [];
        groups.set(r, list);
      }
      list.push(blocks[i]!);
    }

    const binArea = bin * bin;
    const out: FlowCluster[] = [];
    for (const parts of groups.values()) {
      const cells: number[] = [];
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let sumVelX = 0;
      let sumVelY = 0;
      let sumPersist = 0;
      let sumHop = 0;
      let sumXCos = 0;
      let sumXSin = 0;
      let sumYCos = 0;
      let sumYSin = 0;
      let densSum = 0;
      let minBx = Infinity;
      let maxBx = -Infinity;
      let minBy = Infinity;
      let maxBy = -Infinity;
      for (const p of parts) {
        for (let c = 0; c < p.cells.length; c++) cells.push(p.cells[c]!);
        sumR += p.meanR * p.count;
        sumG += p.meanG * p.count;
        sumB += p.meanB * p.count;
        sumVelX += p.velX * p.count;
        sumVelY += p.velY * p.count;
        sumPersist += p.persistT * p.count;
        sumHop += p.hopT * p.count;
        densSum += p.count / binArea;
        minBx = Math.min(minBx, p.bx);
        maxBx = Math.max(maxBx, p.bx);
        minBy = Math.min(minBy, p.by);
        maxBy = Math.max(maxBy, p.by);
        for (let c = 0; c < p.cells.length; c++) {
          const i = p.cells[c]!;
          const x = i % w;
          const y = (i / w) | 0;
          const angX = (2 * Math.PI * x) / w;
          const angY = (2 * Math.PI * y) / h;
          sumXCos += Math.cos(angX);
          sumXSin += Math.sin(angX);
          sumYCos += Math.cos(angY);
          sumYSin += Math.sin(angY);
        }
      }
      const nCells = cells.length;
      if (nCells < FIELD_OBS.flowMinCellsKeep) continue;
      const comX =
        ((Math.atan2(sumXSin, sumXCos) / (2 * Math.PI)) * w + w) % w;
      const comY =
        ((Math.atan2(sumYSin, sumYCos) / (2 * Math.PI)) * h + h) % h;
      // Cheap footprint: occupied blocks + their 8-neighbours once.
      const occ = new Set<number>();
      for (const p of parts) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = (p.bx + dx + bw) % bw;
            const ny = (p.by + dy + bh) % bh;
            occ.add(ny * bw + nx);
          }
        }
      }
      out.push({
        cells,
        comX,
        comY,
        width: Math.max(1, (maxBx - minBx + 1) * bin),
        height: Math.max(1, (maxBy - minBy + 1) * bin),
        meanR: sumR / nCells,
        meanG: sumG / nCells,
        meanB: sumB / nCells,
        velX: sumVelX / nCells,
        velY: sumVelY / nCells,
        persistT: sumPersist / nCells,
        hopT: sumHop / nCells,
        regionArea: occ.size * binArea,
        density: densSum / parts.length,
        blockCount: parts.length,
      });
    }
    return out;
  }

  private clusterAdjacentToCalm(c: FlowCluster, field: RgbField): boolean {
    const { width: w, height: h } = this;
    const colourEps = FIELD_OBS.flowColourEps;
    const need = FIELD_OBS.flowCalmAdjFrac;
    if (c.cells.length === 0) return false;
    // Sample up to 32 members for cost control.
    const step = Math.max(1, (c.cells.length / 32) | 0);
    let adj = 0;
    let tested = 0;
    for (let cidx = 0; cidx < c.cells.length; cidx += step) {
      tested += 1;
      const i = c.cells[cidx]!;
      const x = i % w;
      const y = (i / w) | 0;
      let hit = false;
      for (let dy = -1; dy <= 1 && !hit; dy++) {
        for (let dx = -1; dx <= 1 && !hit; dx++) {
          if (dx === 0 && dy === 0) continue;
          const j = ((y + dy + h) % h) * w + ((x + dx + w) % w);
          if (!this.calmMask[j]) continue;
          if (
            rgbDelta(
              field.r[j]!,
              field.g[j]!,
              field.b[j]!,
              c.meanR,
              c.meanG,
              c.meanB,
            ) <= colourEps
          ) {
            hit = true;
          }
        }
      }
      if (hit) adj += 1;
    }
    return tested > 0 && adj / tested >= need;
  }

  /** Defer flow if members look like emerging oscillators. */
  private emergingOscDefer(cells: Uint32Array): boolean {
    if (cells.length === 0) return false;
    let emerging = 0;
    for (let c = 0; c < cells.length; c++) {
      const i = cells[c]!;
      const p = this.oscPeriod[i]!;
      if (p > 0 && this.oscStreak[i]! >= p) emerging += 1;
    }
    return emerging / cells.length >= FIELD_OBS.flowEmergingOscFrac;
  }

  /** Mark flow member cells for chaos punch-out (no expensive dilate). */
  private markFlowFootprint(flows: FlowGroup[]): number {
    this.flowMark.fill(0);
    let n = 0;
    for (const f of flows) {
      const cells = f.cells;
      for (let c = 0; c < cells.length; c++) {
        const i = cells[c]!;
        if (this.flowMark[i]) continue;
        this.flowMark[i] = 1;
        n += 1;
      }
    }
    return n;
  }

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
      if (inCalm[i] || this.oscMask[i] || this.flowMark[i]) continue;
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
      if (inCalm[i] || this.oscMask[i] || this.flowMark[i]) continue;
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

  /**
   * Sitting period stays osc. Occupancy that translates, or a colour wave
   * whose hop has a heading, is travel — leave those cells to flow/chaos.
   * Groups for the scheduler stay period-bags of whatever remains.
   */
  private suppressTravellingOscillators(
    current: RgbField,
    previous: RgbField,
  ): void {
    const { width: w, height: h } = this;
    const n = w * h;
    const join = FIELD_OBS.oscClusterJoin;
    const hopR = FIELD_OBS.oscHopRadius;
    const eps = FIELD_OBS.oscMatchEps;
    const concMin = FIELD_OBS.oscComConcMin;
    const speedMin = FIELD_OBS.oscTravelMinSpeed;
    const hopMin = FIELD_OBS.oscHopMin;
    const need = FIELD_OBS.oscTravelConfirm;
    const va = FIELD_OBS.velocityEma;
    const maxDist = FIELD_OBS.comMatchDist;

    this.labels.fill(-1);
    type OscCluster = {
      period: number;
      cells: number[];
      comX: number;
      comY: number;
      concX: number;
      concY: number;
      hopX: number;
      hopY: number;
      hopFrac: number;
    };
    const clusters: OscCluster[] = [];

    for (let seed = 0; seed < n; seed++) {
      if (!this.oscMask[seed] || this.labels[seed]! >= 0) continue;
      const period = this.oscPeriod[seed]!;
      if (period <= 0) continue;

      const cellBuf: number[] = [];
      let qh = 0;
      let qt = 0;
      this.queue[qt++] = seed;
      this.labels[seed] = clusters.length;
      let sumXCos = 0;
      let sumXSin = 0;
      let sumYCos = 0;
      let sumYSin = 0;

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

        for (let dy = -join; dy <= join; dy++) {
          for (let dx = -join; dx <= join; dx++) {
            if (dx === 0 && dy === 0) continue;
            const j = ((y + dy + h) % h) * w + ((x + dx + w) % w);
            if (!this.oscMask[j] || this.labels[j]! >= 0) continue;
            if (this.oscPeriod[j]! !== period) continue;
            this.labels[j] = clusters.length;
            this.queue[qt++] = j;
          }
        }
      }

      const area = cellBuf.length;
      if (area === 0) continue;
      const comX =
        ((Math.atan2(sumXSin, sumXCos) / (2 * Math.PI)) * w + w) % w;
      const comY =
        ((Math.atan2(sumYSin, sumYCos) / (2 * Math.PI)) * h + h) % h;
      const concX = Math.hypot(sumXCos, sumXSin) / area;
      const concY = Math.hypot(sumYCos, sumYSin) / area;

      const step = Math.max(1, (area / 32) | 0);
      let hopN = 0;
      let hopDx = 0;
      let hopDy = 0;
      let hopTried = 0;
      for (let c = 0; c < area; c += step) {
        hopTried += 1;
        const i = cellBuf[c]!;
        const x = i % w;
        const y = (i / w) | 0;
        const cr = current.r[i]!;
        const cg = current.g[i]!;
        const cb = current.b[i]!;
        let bestDist = Infinity;
        let bestDx = 0;
        let bestDy = 0;
        let found = false;
        for (let dy = -hopR; dy <= hopR; dy++) {
          for (let dx = -hopR; dx <= hopR; dx++) {
            const j = ((y + dy + h) % h) * w + ((x + dx + w) % w);
            const d = rgbDelta(
              cr,
              cg,
              cb,
              previous.r[j]!,
              previous.g[j]!,
              previous.b[j]!,
            );
            if (d >= eps) continue;
            const dist = dx * dx + dy * dy;
            if (dist >= bestDist) continue;
            found = true;
            bestDist = dist;
            bestDx = dx;
            bestDy = dy;
          }
        }
        if (!found) continue;
        hopN += 1;
        hopDx += bestDx;
        hopDy += bestDy;
      }

      clusters.push({
        period,
        cells: cellBuf,
        comX,
        comY,
        concX,
        concY,
        hopX: hopN ? hopDx / hopN : 0,
        hopY: hopN ? hopDy / hopN : 0,
        hopFrac: hopTried ? hopN / hopTried : 0,
      });
    }

    const usedPrev = new Set<number>();
    const nextPrev: PrevOscCluster[] = [];
    for (const c of clusters) {
      let best = -1;
      let bestDist: number = maxDist;
      for (let p = 0; p < this.prevOscClusters.length; p++) {
        if (usedPrev.has(p)) continue;
        const prev = this.prevOscClusters[p]!;
        if (prev.period !== c.period) continue;
        const d = Math.hypot(
          toroidalDelta(c.comX, prev.comX, w),
          toroidalDelta(c.comY, prev.comY, h),
        );
        if (d < bestDist) {
          bestDist = d;
          best = p;
        }
      }

      let velX = 0;
      let velY = 0;
      let prevStreak = 0;
      let comSpeed = 0;
      if (best >= 0) {
        const prev = this.prevOscClusters[best]!;
        usedPrev.add(best);
        prevStreak = prev.travelStreak;
        const rawVx = toroidalDelta(c.comX, prev.comX, w);
        const rawVy = toroidalDelta(c.comY, prev.comY, h);
        velX = prev.velX + (rawVx - prev.velX) * va;
        velY = prev.velY + (rawVy - prev.velY) * va;
        const useVx = c.concX >= concMin ? rawVx : 0;
        const useVy = c.concY >= concMin ? rawVy : 0;
        comSpeed = Math.hypot(useVx, useVy);
      }

      const hopSpeed = Math.hypot(c.hopX, c.hopY);
      const hopTravel = c.hopFrac >= 0.5 && hopSpeed >= hopMin;
      const travellingNow = comSpeed >= speedMin || hopTravel;
      const travelStreak = travellingNow ? prevStreak + 1 : 0;

      if (travelStreak >= need) {
        for (const i of c.cells) this.oscMask[i] = 0;
      }

      nextPrev.push({
        period: c.period,
        comX: c.comX,
        comY: c.comY,
        velX,
        velY,
        concX: c.concX,
        concY: c.concY,
        travelStreak,
      });
    }
    this.prevOscClusters = nextPrev;
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

      const prev1 = this.frameAt(1);
      const d1 = prev1
        ? rgbDelta(
            cur.r[i]!,
            cur.g[i]!,
            cur.b[i]!,
            prev1.r[i]!,
            prev1.g[i]!,
            prev1.b[i]!,
          )
        : 1;

      // Unchanged this step: a translating colour's interior matches t-2
      // and would look like period 2. Keep an already-confirmed blinker
      // through its hold, but never start oscillation from a static cell.
      if (d1 < eps) {
        const p0 = this.oscPeriod[i]!;
        if (p0 > 0) {
          const past = this.frameAt(p0);
          const still =
            past &&
            rgbDelta(
              cur.r[i]!,
              cur.g[i]!,
              cur.b[i]!,
              past.r[i]!,
              past.g[i]!,
              past.b[i]!,
            ) < eps;
          if (!still) {
            if (this.oscStreak[i]! > 0) this.oscStreak[i]!--;
            if (this.oscStreak[i] === 0) this.oscPeriod[i] = 0;
          }
        }
        const p = this.oscPeriod[i]!;
        const need = confirm * Math.max(1, p);
        this.oscMask[i] = p > 0 && this.oscStreak[i]! >= need ? 1 : 0;
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
    flows: [],
    meanDelta: 0,
    meanCoherence: 0,
    calmAreaFraction: 0,
    chaosAreaFraction: 1,
    texturedAreaFraction: 0,
    flowAreaFraction: 0,
  };
}


function colourBin(r: number, g: number, b: number): number {
  const qr = Math.min(3, Math.max(0, (r * 4) | 0));
  const qg = Math.min(3, Math.max(0, (g * 4) | 0));
  const qb = Math.min(3, Math.max(0, (b * 4) | 0));
  return qr * 16 + qg * 4 + qb;
}

function clusterLooksLikeFlow(
  c: FlowCluster,
  gridW: number,
  gridH: number,
): boolean {
  if (c.cells.length < FIELD_OBS.flowMinCellsKeep) return false;
  if (
    c.width > gridW * FIELD_OBS.flowMaxSpanFrac &&
    c.height > gridH * FIELD_OBS.flowMaxSpanFrac
  ) {
    return false;
  }
  const spanOk =
    Math.min(c.width, c.height) >= FIELD_OBS.flowSolidMinSpan;
  const fill = c.cells.length / Math.max(1, c.width * c.height);
  if (spanOk && fill >= FIELD_OBS.flowSolidFillMin) return false;
  if (c.density >= FIELD_OBS.flowMaxLocalDensity) return false;
  return true;
}

/** Non-toroidal AABB stats for compact local packs (flow stamps). */
function memberAabbStats(
  cells: number[],
  w: number,
  h: number,
): { fill: number; minSpan: number; maxSpan: number } {
  if (cells.length === 0) return { fill: 0, minSpan: 0, maxSpan: 0 };
  let minX = w;
  let maxX = 0;
  let minY = h;
  let maxY = 0;
  for (let t = 0; t < cells.length; t++) {
    const i = cells[t]!;
    const x = i % w;
    const y = (i / w) | 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  if (bw > w * 0.5 || bh > h * 0.5) {
    return { fill: 0, minSpan: 0, maxSpan: 0 };
  }
  return {
    fill: cells.length / (bw * bh),
    minSpan: Math.min(bw, bh),
    maxSpan: Math.max(bw, bh),
  };
}
