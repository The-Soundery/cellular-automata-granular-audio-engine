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
  /**
   * Minimum absolute circular-resultant length (cells) for an axis's COM to
   * be a measurement. A mass covering the whole torus on an axis has an
   * exactly-symmetric distribution — its resultant is float noise and its
   * COM jumps randomly, churning a stable region's id every few frames.
   * A near-wrapping arc keeps a small but genuine resultant (e.g. a 28-cell
   * strip on a 32 torus ≈ 3.9), so the gate is absolute, not conc-relative.
   * Degenerate axes are excluded from ID matching and their velocity holds 0.
   */
  regionComResultantMin: 2,
  /** Max mean-RGB distance for ID continuity (same scale as regionColourEps). */
  idColourEps: 0.22,
  /** Minimum cell IoU to prefer an ID match when COM/colour are close. */
  idMinIoU: 0.08,
  /** EMA for region COM velocity. */
  velocityEma: 0.35,
  /** Smoothed δ below this is stasis, not chaos; quantisation noise is ~0.007. */
  chaosDeltaMin: 0.045,
  /**
   * Chebyshev join radius when clustering the chaos bag into areas. Chaotic
   * cells within this distance belong to one area (brief §7: "chaotic areas
   * receive share by their area"). Clusters are measurements, not owners.
   */
  chaosClusterJoin: 2,
  /** Chaos clusters below this area fold into one residual scatter bag. */
  chaosClusterMinArea: 16,
  /** Max distinct chaos clusters per frame (largest kept; rest → residual). */
  chaosClusterMax: 24,
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
  flowSearchRadius: 14,
  /** Same scale as regionColourEps — a travelling colour must stay itself. */
  flowColourEps: 0.12,
  /**
   * Hue wrap distance (0..0.5) for same-colour match when RGB eps fails.
   * Value flicker of one hue is still that colour; tint walks are not.
   */
  flowHueEps: 0.04,
  /** Saturation window paired with flowHueEps. */
  flowSatEps: 0.28,
  /** Below this sat, hue is unstable — RGB eps only (greys). */
  flowSatMin: 0.2,
  /**
   * Chromaticity (RGB / sum) distance for value flicker of one colour.
   * Scaled RGB stays near 0; random scramble does not.
   */
  flowChromaEps: 0.07,
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
   * Skip the mode colour only as a still-bg wake. If this fraction of that
   * bin is itself active, the colour is travelling (dithered sheet) — keep it.
   */
  flowModeWakeFrac: 0.32,
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
  flowMaxBlocksScramble: 160,
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
  /**
   * Same-heading blocks within this Chebyshev bin gap join as a 2D sheet
   * even when they fail the thin-lane test. 2 stays below sparse-dot spacing.
   */
  flowSheetCheb: 2,
  /** Min heading cosine to stitch two moving blocks into one stream. */
  flowStitchHeadingCos: 0.5,
  /** Unconfirmed track match: heading may bend this far (cos) before ID break. */
  flowTrackHeadingCos: 0.35,
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
   * Wide+tall bbox with fill below this is 2D scatter (scramble dust), not a
   * dithered sheet. Sheets occupy their patch; flicker does not.
   */
  flowScatterFillMax: 0.12,
  /** Min bbox fraction of the grid (both axes) to apply the scatter reject. */
  flowScatterSpanFrac: 0.55,
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
   * flow emit while the pack is still slow. Detection may see oscMask cells
   * (dashed streams); confirmed Flow then punches those cells out of Osc.
   */
  flowEmergingOscFrac: 0.5,
  /**
   * Mean fraction of Chebyshev-1 neighbours that are also members.
   * At/above this the blob is stamp-like (solid body), not a gappy pattern.
   * Raised so denser joined cascades / dithered sheets can still count as flow.
   */
  flowMaxLocalDensity: 0.8,
  /**
   * Member cells / dilated footprint cap — travelling stamps fill the patch;
   * sparse / uneven packs sit below. Raised for denser cascades and sheets.
   */
  flowMaxPackT: 0.72,
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
  /**
   * Spatial partition of the bag into chaotic areas (plus one residual
   * scatter entry). Same cells, no ownership — lets the scheduler spend each
   * area's share where the change actually is. Optional so harness fixtures
   * that hand-build observations keep working (scheduler falls back to the
   * whole bag as one area).
   */
  clusters?: ChaosCluster[];
}

/** One spatially connected chaotic area (measurement, re-derived each frame). */
export interface ChaosCluster {
  /** COM-matched id for rate-clock continuity; -1 = residual scatter. */
  id: number;
  area: number;
  /** Toroidal circular COM — meaningless for the residual (compact=false). */
  comX: number;
  comY: number;
  /** False for the residual scatter entry (no usable location). */
  compact: boolean;
  meanDelta: number;
  maxDelta: number;
  meanSimilarity: number;
  meanR: number;
  meanG: number;
  meanB: number;
  cells: Uint32Array;
}

/** Region lifecycle events from ID matching (births / deaths / merges). */
export interface RegionEvents {
  /** Region ids minted this frame (structure appeared or split off). */
  births: number[];
  /** Previous-frame ids that vanished with no successor. */
  deaths: number[];
  /** Previous-frame ids absorbed into a surviving region this frame. */
  merges: { from: number; into: number }[];
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
  /** Modal site period on members (0 = none). Pulses Flow grains; exclusive of Osc. */
  period: number;
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
  /** Per-frame candidate reject counts (overlay debug / verify). */
  flowRejects: Record<string, number>;
  /** Calm-region lifecycle events this frame (optional for fixtures). */
  regionEvents?: RegionEvents;
}

type PrevRegion = {
  id: number;
  area: number;
  comX: number;
  comY: number;
  /** Circular concentration per axis — low = COM on that axis is noise. */
  comConcX: number;
  comConcY: number;
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
  /** Circular concentration about each axis (1 = localised, 0 = wraps torus). */
  comConcX: number;
  comConcY: number;
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
  private flowRejects: Record<string, number> = {};
  /** Cells culled from calm this frame for area only — kept for hysteresis. */
  private culledCalm: number[] = [];
  /** Region lifecycle events from the last ID-matching pass. */
  private lastRegionEvents: RegionEvents = {
    births: [],
    deaths: [],
    merges: [],
  };
  /** Chaos-cluster scratch + COM continuity (measurement ids, not owners). */
  private readonly chaosLabel: Int32Array;
  private prevChaosClusters: { id: number; comX: number; comY: number }[] = [];
  private nextChaosClusterId = 1;
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
    this.chaosLabel = new Int32Array(n);
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
    this.flowRejects = {};
    this.culledCalm = [];
    this.lastRegionEvents = { births: [], deaths: [], merges: [] };
    this.prevChaosClusters = [];
    this.nextChaosClusterId = 1;
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
    // Calm excludes sitting Osc; Flow may still inspect Osc-looking cells
    // (dashed streams). Confirmed Flow then punches Osc so bags stay exclusive.
    const coherent = this.extractRegions(current);
    const flows = this.extractFlows(current, previous, coherent);
    const flowCells = this.markFlowFootprint(flows);
    this.punchFlowFromOscillators(flows);
    const oscillators = this.buildOscillatorGroups(current);
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
    // Culled-but-coherent cells keep their hysteresis state (see extractRegions).
    for (const i of this.culledCalm) this.prevCalm[i] = 1;
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
      flowRejects: this.flowRejects,
      regionEvents: this.lastRegionEvents,
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

    this.culledCalm.length = 0;
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
          ((y + 1) % h) * w + ((x + 1) % w),
          ((y + 1) % h) * w + ((x - 1 + w) % w),
          ((y - 1 + h) % h) * w + ((x + 1) % w),
          ((y - 1 + h) % h) * w + ((x - 1 + w) % w),
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
        // Too small to voice — but the cells were genuinely coherent. Clear
        // the mask (remainder/flow must not see them as calm) yet remember
        // them so hysteresis still applies next frame: zeroing prevCalm here
        // forced marginal regions back to the *enter* threshold every frame,
        // making them blink in and out (clock resets, budget churn).
        for (const i of cellBuf) {
          this.labels[i] = -1;
          this.calmMask[i] = 0;
          this.culledCalm.push(i);
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
    const events: RegionEvents = { births: [], deaths: [], merges: [] };
    this.lastRegionEvents = events;
    const resMin = FIELD_OBS.regionComResultantMin;
    const axisUsable = (conc: number, area: number): boolean =>
      conc * area >= resMin;
    // An axis where either side's COM is degenerate (torus-wrapping mass)
    // contributes nothing to the match distance — without this, a stable
    // full-height region's noisy COM-Y breaks its id every few frames.
    const comDist = (
      region: CoherentRegion,
      prev: PrevRegion,
    ): number => {
      const useX =
        axisUsable(region.comConcX, region.area) &&
        axisUsable(prev.comConcX, prev.area);
      const useY =
        axisUsable(region.comConcY, region.area) &&
        axisUsable(prev.comConcY, prev.area);
      const dx = useX ? toroidalDelta(region.comX, prev.comX, w) : 0;
      const dy = useY ? toroidalDelta(region.comY, prev.comY, h) : 0;
      return Math.hypot(dx, dy);
    };

    for (const region of regions) {
      let best = -1;
      let bestScore = Infinity;

      for (let p = 0; p < this.prevRegions.length; p++) {
        if (usedPrev.has(p)) continue;
        const prev = this.prevRegions[p]!;
        const comD = comDist(region, prev);
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
        // Degenerate axes have no measurable motion — decay toward 0 there
        // instead of chasing COM noise (pan/direction stay steady).
        const useX =
          axisUsable(region.comConcX, region.area) &&
          axisUsable(prev.comConcX, prev.area);
        const useY =
          axisUsable(region.comConcY, region.area) &&
          axisUsable(prev.comConcY, prev.area);
        const rawVx = useX ? toroidalDelta(region.comX, prev.comX, w) : 0;
        const rawVy = useY ? toroidalDelta(region.comY, prev.comY, h) : 0;
        region.velX = prev.velX + (rawVx - prev.velX) * va;
        region.velY = prev.velY + (rawVy - prev.velY) * va;
      } else {
        region.id = this.nextRegionId++;
        region.velX = 0;
        region.velY = 0;
        events.births.push(region.id);
      }
    }

    // Lifecycle: an unmatched previous region either merged into a nearby
    // surviving region (COM + colour still match one) or died. These are the
    // actual events of computational flow — exported as measurements so the
    // scheduler can keep merged grains following the surviving body.
    for (let p = 0; p < this.prevRegions.length; p++) {
      if (usedPrev.has(p)) continue;
      const prev = this.prevRegions[p]!;
      let into = -1;
      let bestD = Infinity;
      for (const region of regions) {
        if (region.id === prev.id) continue;
        const comD = comDist(region, prev);
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
        if (comD < bestD) {
          bestD = comD;
          into = region.id;
        }
      }
      if (into >= 0) events.merges.push({ from: prev.id, into });
      else events.deaths.push(prev.id);
    }

    this.prevRegions = regions.map((r) => ({
      id: r.id,
      area: r.area,
      comX: r.comX,
      comY: r.comY,
      comConcX: r.comConcX,
      comConcY: r.comConcY,
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
      this.flowRejects = {};
      return [];
    }

    const { width: w, height: h } = this;
    const n = w * h;
    const rejects: Record<string, number> = {};
    const bump = (key: string) => {
      rejects[key] = (rejects[key] ?? 0) + 1;
    };
    const dMin = FIELD_OBS.flowDeltaMin;
    const skipNow = new Uint8Array(n);
    let skipped = 0;
    for (let i = 0; i < n; i++) {
      // Do not skip oscMask here: dashed streams revisit sites every 2 steps
      // and look like period-2 at the cell, but are flow in aggregate.
      // Confirmed still blinkers fail travel/speed; emergingOscDefer remains.
      if (this.calmMask[i] || (this.deltaSmooth[i]! < dMin && this.delta[i]! < dMin)) {
        skipNow[i] = 1;
        skipped += 1;
      }
    }
    const changing = n - skipped;
    const scrambling = changing > n * FIELD_OBS.flowScrambleFrac;
    const blockCap = scrambling
      ? FIELD_OBS.flowMaxBlocksScramble
      : FIELD_OBS.flowMaxBlocks;
    if (scrambling) bump("scramble");

    const blocks = this.accumulateFlowBlocks(
      current,
      previous,
      skipNow,
      blockCap,
    );
    const busy = changing > n * 0.4;
    this.matchBlockCorrespondence(blocks, this.prevFlowBlocks, busy);
    // Cluster by colour + heading + lane (similarity travel), not pack-COM.
    let clusters = this.clusterFlowBlocks(blocks);
    // Pack velocity: cluster COM correspondence (block votes are too noisy
    // inside 4×4 bins). Block vels already informed the stitch.
    this.matchClusterVelocity(clusters, this.prevFlowClusters, busy);
    this.suppressClusterFieldShift(clusters);
    this.prevFlowBlocks = blocks;
    this.prevFlowClusters = clusters;
    clusters = clusters.filter((c) => {
      if (clusterLooksLikeFlow(c, w, h)) return true;
      bump("shape");
      return false;
    });

    const flows: FlowGroup[] = [];
    const usedCluster = new Set<number>();
    const usedPrev = new Set<number>();
    const nextPrev: PrevFlow[] = [];
    const maxDist = FIELD_OBS.flowSearchRadius;
    const need = FIELD_OBS.flowConfirmSteps;
    const holdMax = FIELD_OBS.flowHoldFrames;
    const ema = FIELD_OBS.velocityEma;
    const minTravel = FIELD_OBS.flowMinTravel;
    const minStraight = FIELD_OBS.flowMinStraightness;

    const duplicatesCalm = (c: FlowCluster, velX: number, velY: number) =>
      coherent.some((r) => {
        if (
          !flowColoursMatch(
            c.meanR,
            c.meanG,
            c.meanB,
            r.meanR,
            r.meanG,
            r.meanB,
          )
        ) {
          return false;
        }
        const comDist = Math.hypot(
          toroidalDelta(c.comX, r.comX, w),
          toroidalDelta(c.comY, r.comY, h),
        );
        if (comDist > maxDist) return false;
        const speed = Math.hypot(velX, velY);
        const rSpeed = Math.hypot(r.velX, r.velY);
        if (Math.hypot(velX - r.velX, velY - r.velY) < FIELD_OBS.flowVelEps) {
          return true;
        }
        if (speed < 1e-4 || rSpeed < FIELD_OBS.flowMinSpeedExit) return false;
        const cos = (velX * r.velX + velY * r.velY) / (speed * rSpeed);
        return cos >= 0.5;
      });

    const rejectCluster = (
      c: FlowCluster,
      velX: number,
      velY: number,
    ): string | null => {
      if (duplicatesCalm(c, velX, velY)) return "calmDup";
      const stamp = memberAabbStats(c.cells, w, h);
      // Thin / gappy travelling colour may ride a calm mass (clip-3 wavefronts).
      // Only treat calm-adjacency as "edge of a stamp" when the pack is dense
      // or hop is too low to be correspondence travel.
      if (this.clusterAdjacentToCalm(c, current)) {
        const denseEdge =
          (stamp.fill >= FIELD_OBS.flowPersistFillReject &&
            stamp.minSpan >= 5) ||
          c.hopT < FIELD_OBS.flowMinHopT;
        if (denseEdge) return "calmEdge";
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
        return "persistStamp";
      }
      if (c.density >= FIELD_OBS.flowMaxLocalDensity) return "density";
      const packT = c.cells.length / Math.max(1, c.regionArea);
      return packT > FIELD_OBS.flowMaxPackT ? "packT" : null;
    };

    /** Emit confirmed flow; return false if a gate blocked (tallied in flowRejects). */
    const emit = (row: PrevFlow): boolean => {
      if (row.streak < need) {
        bump("streak");
        return false;
      }
      const speed = Math.hypot(row.velX, row.velY);
      if (speed < FIELD_OBS.flowMinSpeedExit) {
        bump("speed");
        return false;
      }
      const directed = Math.abs(
        (row.accumDx * row.velX + row.accumDy * row.velY) / speed,
      );
      if (directed < minTravel) {
        bump("travel");
        return false;
      }
      if (
        row.pathLength > 1e-3 &&
        Math.hypot(row.accumDx, row.accumDy) / row.pathLength < minStraight
      ) {
        bump("straight");
        return false;
      }
      if (row.slowFrames > row.streak * 0.7) {
        bump("slow");
        return false;
      }
      if (row.densityEma >= FIELD_OBS.flowMaxLocalDensity) {
        bump("emitDensity");
        return false;
      }
      if (row.hopEma < FIELD_OBS.flowMinHopT) {
        bump("emitHop");
        return false;
      }
      if (
        row.cells.length / Math.max(1, row.regionArea) >
        FIELD_OBS.flowMaxPackT
      ) {
        bump("emitPackT");
        return false;
      }
      // Moving packs win over site-revisit "osc" (dashed streams look period-2).
      // Still / jittering emerging blinkers still defer.
      if (
        speed < FIELD_OBS.flowMinSpeed &&
        this.emergingOscDefer(row.cells)
      ) {
        bump("oscDefer");
        return false;
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
        period: this.flowSitePeriod(row.cells),
      });
      return true;
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
        if (
          busy
            ? rgbDelta(
                t.meanR,
                t.meanG,
                t.meanB,
                prev.meanR,
                prev.meanG,
                prev.meanB,
              ) > FIELD_OBS.flowColourEps
            : !flowColoursMatch(
                t.meanR,
                t.meanG,
                t.meanB,
                prev.meanR,
                prev.meanG,
                prev.meanB,
              )
        ) {
          continue;
        }
        const confirmed = prev.streak >= need;
        const areaRatio =
          Math.min(t.cells.length, prev.cells.length) /
          Math.max(t.cells.length, prev.cells.length);
        if (areaRatio < (confirmed ? 0.08 : 0.06)) continue;
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
      // Correspondence (block match) is the motion primitive. Prefer hop when
      // it dominates COM; otherwise COM is the fallback. Absurd COM jumps
      // (wrapping packs) keep block correspondence when it is usable.
      let instX = t.velX;
      let instY = t.velY;
      const blockSpeed = Math.hypot(instX, instY);
      const comSpeed = Math.hypot(comDx, comDy);
      const prevSpeed = Math.hypot(prev.velX, prev.velY);
      const comJump = comSpeed > FIELD_OBS.flowMaxSpeed;
      const diagHop =
        blockSpeed >= FIELD_OBS.flowMinSpeedExit &&
        Math.abs(instX) >= FIELD_OBS.flowMinSpeedExit &&
        Math.abs(instY) >= FIELD_OBS.flowMinSpeedExit;
      const hopDominates =
        blockSpeed >= FIELD_OBS.flowMinSpeedExit &&
        (comJump ||
          diagHop ||
          blockSpeed >= comSpeed * FIELD_OBS.flowHopDominate);
      if (!hopDominates) {
        if (comSpeed >= FIELD_OBS.flowMinSpeedExit && !comJump) {
          instX = comDx;
          instY = comDy;
        } else if (blockSpeed < FIELD_OBS.flowMinSpeedExit) {
          instX = comDx;
          instY = comDy;
        }
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
      // Absurd jumps with no usable correspondence: coast or drop.
      if (speed > FIELD_OBS.flowMaxSpeed) {
        if (
          !comJump &&
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
        if (
          cos < FIELD_OBS.flowTrackHeadingCos &&
          !staircaseHeadingOk(prev.velX, prev.velY, instX, instY)
        ) {
          bump("heading");
          continue;
        }
      }
      const reject = rejectCluster(t, instX, instY);
      if (reject) {
        bump(reject);
        continue;
      }
      usedCluster.add(best);
      usedPrev.add(p);
      const small =
        prev.streak < need && t.cells.length < FIELD_OBS.flowMinCellsTight;
      const slowAdd = speed < FIELD_OBS.flowMinSpeed ? 1 : 0;
      const densEma = FIELD_OBS.flowDensityEma;
      const hopEmaBlend = FIELD_OBS.flowHopEma;
      let densityEma =
        prev.densityEma + densEma * (t.density - prev.densityEma);
      let hopEma = prev.hopEma + hopEmaBlend * (t.hopT - prev.hopEma);
      // Confirmed tracks: never poison hop/density EMAs with a sample that
      // would fail emit. A match that updated EMAs then failed emit left the
      // track in prevFlows but off overlay/meters; hold-coast could not help.
      const wasConfirmed = prev.streak >= need;
      if (wasConfirmed) {
        const densBad = densityEma >= FIELD_OBS.flowMaxLocalDensity;
        const hopBad = hopEma < FIELD_OBS.flowMinHopT;
        const prevOk =
          prev.densityEma < FIELD_OBS.flowMaxLocalDensity &&
          prev.hopEma >= FIELD_OBS.flowMinHopT;
        if ((densBad || hopBad) && prevOk) {
          if (densBad) bump("emaProtectDensity");
          if (hopBad) bump("emaProtectHop");
          densityEma = prev.densityEma;
          hopEma = prev.hopEma;
        }
      }
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
        densityEma,
        hopEma,
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
      if (t.cells.length < minNewCells) {
        bump("size");
        continue;
      }
      if (scrambling && t.density >= 0.45) {
        bump("scrambleDens");
        continue;
      }
      const speed = Math.hypot(t.velX, t.velY);
      if (speed < FIELD_OBS.flowMinSpeed) {
        bump("speed");
        continue;
      }
      if (speed > FIELD_OBS.flowMaxSpeed) {
        bump("maxSpeed");
        continue;
      }
      const reject = rejectCluster(t, t.velX, t.velY);
      if (reject) {
        bump(reject);
        continue;
      }
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
    this.flowRejects = rejects;
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
    // flow. Travelling rare hues are kept. If a large share of the mode bin
    // is itself active, that colour is a sheet — keep it.
    let skipMode = -1;
    if (modeCount > commonCut) {
      let modeActive = 0;
      for (let i = 0; i < n; i++) {
        if (skip[i]) continue;
        if (colourBin(current.r[i]!, current.g[i]!, current.b[i]!) === modeBin) {
          modeActive += 1;
        }
      }
      if (modeActive < modeCount * FIELD_OBS.flowModeWakeFrac) {
        skipMode = modeBin;
      }
    }

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
    strictColour = false,
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
        const colourOk = strictColour
          ? rgbDelta(
              cur.meanR,
              cur.meanG,
              cur.meanB,
              prev.meanR,
              prev.meanG,
              prev.meanB,
            ) <= colourEps
          : flowColoursMatch(
              cur.meanR,
              cur.meanG,
              cur.meanB,
              prev.meanR,
              prev.meanG,
              prev.meanB,
            );
        if (!colourOk) continue;
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

  /**
   * Cluster velocity after stitch. COM is the usual pack velocity; when COM
   * jumps absurdly on a torus, keep the block correspondence vote instead.
   */
  private matchClusterVelocity(
    current: FlowCluster[],
    previous: FlowCluster[],
    strictColour = false,
  ): void {
    if (previous.length === 0) return;
    const { width: w, height: h } = this;
    const maxDist = FIELD_OBS.flowSearchRadius;
    const colourEps = FIELD_OBS.flowColourEps;
    const maxSpeed = FIELD_OBS.flowMaxSpeed;
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
        const colourOk = strictColour
          ? rgbDelta(
              cur.meanR,
              cur.meanG,
              cur.meanB,
              prev.meanR,
              prev.meanG,
              prev.meanB,
            ) <= colourEps
          : flowColoursMatch(
              cur.meanR,
              cur.meanG,
              cur.meanB,
              prev.meanR,
              prev.meanG,
              prev.meanB,
            );
        if (!colourOk) continue;
        const areaRatio =
          Math.min(cur.cells.length, prev.cells.length) /
          Math.max(cur.cells.length, prev.cells.length);
        if (areaRatio < 0.08) continue;
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
      const comDx = toroidalDelta(cur.comX, prev.comX, w);
      const comDy = toroidalDelta(cur.comY, prev.comY, h);
      const comSpeed = Math.hypot(comDx, comDy);
      // Absurd COM jump — keep block correspondence already on the cluster.
      if (comSpeed > maxSpeed) continue;
      cur.velX = comDx;
      cur.velY = comDy;
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
   * Join same-colour blocks that share a heading.
   * Adjacent always merge. Longer gaps stitch by lane (streams) or by nearby
   * Chebyshev bins (dithered sheets). Isolated 2D scatter stays unglued.
   */
  private clusterFlowBlocks(blocks: FlowBlock[]): FlowCluster[] {
    if (blocks.length === 0) return [];
    const { width: w, height: h } = this;
    const bin = FIELD_OBS.flowBinSize;
    const bw = Math.ceil(w / bin);
    const bh = Math.ceil(h / bin);
    const join = FIELD_OBS.flowStreamJoin;
    const lane = FIELD_OBS.flowLaneWidth;
    const sheetCheb = FIELD_OBS.flowSheetCheb;
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
          !flowColoursMatch(a.meanR, a.meanG, a.meanB, b.meanR, b.meanG, b.meanB)
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
        if (
          !chainable &&
          blockCheb <= sheetCheb &&
          speedA >= minSpeed &&
          speedB >= minSpeed
        ) {
          const cos =
            (a.velX * b.velX + a.velY * b.velY) / (speedA * speedB);
          if (
            cos >= headingCos &&
            Math.hypot(a.velX - b.velX, a.velY - b.velY) <= velEps
          ) {
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
        comConcX: Math.hypot(sumXCos, sumXSin) / nCells,
        comConcY: Math.hypot(sumYCos, sumYSin) / nCells,
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
            flowColoursMatch(
              field.r[j]!,
              field.g[j]!,
              field.b[j]!,
              c.meanR,
              c.meanG,
              c.meanB,
            )
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

  /** Modal confirmed site period on members, or 0. */
  private flowSitePeriod(cells: Uint32Array): number {
    if (cells.length === 0) return 0;
    const counts = new Map<number, number>();
    let hit = 0;
    for (let c = 0; c < cells.length; c++) {
      const p = this.oscPeriod[cells[c]!]!;
      if (p < 2) continue;
      hit += 1;
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    if (hit / cells.length < FIELD_OBS.flowEmergingOscFrac) return 0;
    let best = 0;
    let bestN = 0;
    for (const [p, n] of counts) {
      if (n > bestN) {
        bestN = n;
        best = p;
      }
    }
    return best;
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

  /**
   * Confirmed Flow wins over Osc: clear period state on flow members so
   * oscillator bags and grain share stay exclusive. Detection may still
   * inspect Osc-looking cells before emit (dashed streams).
   */
  private punchFlowFromOscillators(flows: FlowGroup[]): void {
    for (const f of flows) {
      const cells = f.cells;
      for (let c = 0; c < cells.length; c++) {
        const i = cells[c]!;
        this.oscMask[i] = 0;
        this.oscPeriod[i] = 0;
        this.oscStreak[i] = 0;
      }
    }
  }

  private buildRemainder(
    coherent: CoherentRegion[],
    current: RgbField,
  ): { chaotic: ChaoticArea; textured: TexturedArea } {
    return {
      chaotic: this.buildChaotic(coherent, current),
      textured: this.buildTextured(coherent, current),
    };
  }

  private buildChaotic(
    coherent: CoherentRegion[],
    current: RgbField,
  ): ChaoticArea {
    const n = this.width * this.height;
    const { width: w, height: h } = this;
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
      // 3×3 δ blur leaks past chaosDeltaMin into neighbours of Osc/Flow/Calm
      // cells. Skip leftover cells whose raw δ is still below the floor —
      // independently flickering cells (raw δ high) stay Chaos.
      if (this.delta[i]! < chaosMin) {
        const x = i % w;
        const y = (i / w) | 0;
        let claimedNeighbour = false;
        for (let dy = -1; dy <= 1 && !claimedNeighbour; dy++) {
          for (let dx = -1; dx <= 1 && !claimedNeighbour; dx++) {
            if (dx === 0 && dy === 0) continue;
            const j = ((y + dy + h) % h) * w + ((x + dx + w) % w);
            if (inCalm[j] || this.oscMask[j] || this.flowMark[j]) {
              claimedNeighbour = true;
            }
          }
        }
        if (claimedNeighbour) continue;
      }
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
      clusters: this.clusterChaos(cells, current),
    };
  }

  /**
   * Partition the chaos bag into spatially connected areas (Chebyshev join
   * ≤ chaosClusterJoin) plus one residual scatter entry. Ids follow COM
   * greedily frame-to-frame so the scheduler's per-area rate clocks keep
   * phase; ids carry no ownership and vanish with the area.
   */
  private clusterChaos(
    bagCells: number[],
    current: RgbField,
  ): ChaosCluster[] {
    const { width: w, height: h } = this;
    const join = FIELD_OBS.chaosClusterJoin;
    const label = this.chaosLabel;
    for (const i of bagCells) label[i] = -2; // member, unvisited
    const groups: number[][] = [];

    for (const seed of bagCells) {
      if (label[seed] !== -2) continue;
      const group: number[] = [];
      let qh = 0;
      let qt = 0;
      this.queue[qt++] = seed;
      label[seed] = groups.length;
      while (qh < qt) {
        const i = this.queue[qh++]!;
        group.push(i);
        const x = i % w;
        const y = (i / w) | 0;
        for (let dy = -join; dy <= join; dy++) {
          const ny = (y + dy + h) % h;
          for (let dx = -join; dx <= join; dx++) {
            if (dx === 0 && dy === 0) continue;
            const j = ny * w + ((x + dx + w) % w);
            if (label[j] !== -2) continue;
            label[j] = groups.length;
            this.queue[qt++] = j;
          }
        }
      }
      groups.push(group);
    }
    // Reset labels for next frame (only member cells were touched).
    for (const i of bagCells) label[i] = -1;

    groups.sort((a, b) => b.length - a.length);
    const minArea = FIELD_OBS.chaosClusterMinArea;
    const maxKeep = FIELD_OBS.chaosClusterMax;
    const kept: number[][] = [];
    const residual: number[] = [];
    for (const g of groups) {
      if (kept.length < maxKeep && g.length >= minArea) kept.push(g);
      else residual.push(...g);
    }

    const measure = (cellsArr: number[], compact: boolean): ChaosCluster => {
      let sumXCos = 0;
      let sumXSin = 0;
      let sumYCos = 0;
      let sumYSin = 0;
      let sumD = 0;
      let sumS = 0;
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let maxD = 0;
      for (const i of cellsArr) {
        const x = i % w;
        const y = (i / w) | 0;
        const angX = (2 * Math.PI * x) / w;
        const angY = (2 * Math.PI * y) / h;
        sumXCos += Math.cos(angX);
        sumXSin += Math.sin(angX);
        sumYCos += Math.cos(angY);
        sumYSin += Math.sin(angY);
        const d = this.deltaSmooth[i]!;
        sumD += d;
        if (d > maxD) maxD = d;
        sumS += this.similarity[i]!;
        sumR += current.r[i]!;
        sumG += current.g[i]!;
        sumB += current.b[i]!;
      }
      const a = Math.max(1, cellsArr.length);
      return {
        id: -1,
        area: cellsArr.length,
        comX: ((Math.atan2(sumXSin, sumXCos) / (2 * Math.PI)) * w + w) % w,
        comY: ((Math.atan2(sumYSin, sumYCos) / (2 * Math.PI)) * h + h) % h,
        compact,
        meanDelta: sumD / a,
        maxDelta: maxD,
        meanSimilarity: sumS / a,
        meanR: sumR / a,
        meanG: sumG / a,
        meanB: sumB / a,
        cells: Uint32Array.from(cellsArr),
      };
    };

    const clusters = kept.map((g) => measure(g, true));

    // Greedy COM continuity (largest first) — clock phase, not ownership.
    const usedPrev = new Set<number>();
    for (const c of clusters) {
      let best = -1;
      let bestD = Infinity;
      for (let p = 0; p < this.prevChaosClusters.length; p++) {
        if (usedPrev.has(p)) continue;
        const prev = this.prevChaosClusters[p]!;
        const d = Math.hypot(
          toroidalDelta(c.comX, prev.comX, w),
          toroidalDelta(c.comY, prev.comY, h),
        );
        if (d <= FIELD_OBS.comMatchDist && d < bestD) {
          bestD = d;
          best = p;
        }
      }
      if (best >= 0) {
        usedPrev.add(best);
        c.id = this.prevChaosClusters[best]!.id;
      } else {
        c.id = this.nextChaosClusterId++;
      }
    }
    this.prevChaosClusters = clusters.map((c) => ({
      id: c.id,
      comX: c.comX,
      comY: c.comY,
    }));

    if (residual.length > 0) clusters.push(measure(residual, false));
    return clusters;
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
        // Collect every nearest-distance match (skip same-cell). A single
        // first-hit invents a heading on wavelength-2 lines / checkerboards
        // where ±1 along the axis cancel when averaged.
        let bestDist = Infinity;
        const matches: { dx: number; dy: number }[] = [];
        for (let dy = -hopR; dy <= hopR; dy++) {
          for (let dx = -hopR; dx <= hopR; dx++) {
            if (dx === 0 && dy === 0) continue;
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
            if (dist < bestDist) {
              bestDist = dist;
              matches.length = 0;
              matches.push({ dx, dy });
            } else if (dist === bestDist) {
              matches.push({ dx, dy });
            }
          }
        }
        if (matches.length === 0) continue;
        hopN += 1;
        let cellDx = 0;
        let cellDy = 0;
        for (const m of matches) {
          cellDx += m.dx;
          cellDy += m.dy;
        }
        hopDx += cellDx / matches.length;
        hopDy += cellDy / matches.length;
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
    const headingCosMin = FIELD_OBS.flowTrackHeadingCos;
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
      let prevVelX = 0;
      let prevVelY = 0;
      if (best >= 0) {
        const prev = this.prevOscClusters[best]!;
        usedPrev.add(best);
        prevStreak = prev.travelStreak;
        prevVelX = prev.velX;
        prevVelY = prev.velY;
        const rawVx = toroidalDelta(c.comX, prev.comX, w);
        const rawVy = toroidalDelta(c.comY, prev.comY, h);
        velX = prev.velX + (rawVx - prev.velX) * va;
        velY = prev.velY + (rawVy - prev.velY) * va;
        // Only trust COM on localised clusters (wrapping rings have conc≈0).
        const useVx = c.concX >= concMin ? rawVx : 0;
        const useVy = c.concY >= concMin ? rawVy : 0;
        comSpeed = Math.hypot(useVx, useVy);
      }

      const hopSpeed = Math.hypot(c.hopX, c.hopY);
      const hopTravel = c.hopFrac >= 0.5 && hopSpeed >= hopMin;
      const comTravel = comSpeed >= speedMin;
      let travellingNow = comTravel || hopTravel;
      // Heading flip resets streak: sitting wavelength-2 lines wobble ±1
      // along the axis; a translating blinker block keeps one heading.
      if (travellingNow && prevStreak > 0) {
        const prevSpeed = Math.hypot(prevVelX, prevVelY);
        if (prevSpeed > 0.4) {
          const curVx = hopTravel ? c.hopX : velX;
          const curVy = hopTravel ? c.hopY : velY;
          const curSpeed = Math.hypot(curVx, curVy);
          if (curSpeed > 0.4) {
            const cos =
              (curVx * prevVelX + curVy * prevVelY) / (curSpeed * prevSpeed);
            if (cos < headingCosMin) travellingNow = false;
          }
        }
      }
      const travelStreak = travellingNow ? prevStreak + 1 : 0;

      if (travelStreak >= need) {
        for (const i of c.cells) this.oscMask[i] = 0;
      }

      // Store the travel signal used for heading (hop when that drove travel).
      const storeVx = hopTravel && hopSpeed >= comSpeed ? c.hopX : velX;
      const storeVy = hopTravel && hopSpeed >= comSpeed ? c.hopY : velY;
      nextPrev.push({
        period: c.period,
        comX: c.comX,
        comY: c.comY,
        velX: storeVx,
        velY: storeVy,
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

/** Same travelling colour: RGB eps, or same chromaticity (value flicker). */
function flowColoursMatch(
  r0: number,
  g0: number,
  b0: number,
  r1: number,
  g1: number,
  b1: number,
): boolean {
  if (rgbDelta(r0, g0, b0, r1, g1, b1) <= FIELD_OBS.flowColourEps) return true;
  const s0 = r0 + g0 + b0;
  const s1 = r1 + g1 + b1;
  if (s0 < 0.12 || s1 < 0.12) return false;
  const dr = r0 / s0 - r1 / s1;
  const dg = g0 / s0 - g1 / s1;
  const db = b0 / s0 - b1 / s1;
  if (Math.hypot(dr, dg, db) > FIELD_OBS.flowChromaEps) return false;
  const a = rgbToHsvLite(r0, g0, b0);
  const b = rgbToHsvLite(r1, g1, b1);
  if (a.s < FIELD_OBS.flowSatMin || b.s < FIELD_OBS.flowSatMin) return false;
  let dh = Math.abs(a.h - b.h);
  if (dh > 0.5) dh = 1 - dh;
  return dh <= FIELD_OBS.flowHueEps && Math.abs(a.s - b.s) <= FIELD_OBS.flowSatEps;
}

function rgbToHsvLite(
  r: number,
  g: number,
  b: number,
): { h: number; s: number; v: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const v = max;
  const d = max - min;
  const s = max > 1e-6 ? d / max : 0;
  if (d < 1e-6) return { h: 0, s, v };
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h, s, v };
}

export function toroidalDelta(a: number, b: number, period: number): number {
  let d = a - b;
  if (d > period * 0.5) d -= period;
  if (d < -period * 0.5) d += period;
  return d;
}

/** Stair-step +x/+y is the same diagonal heading (4×4 bins chatter). */
function staircaseHeadingOk(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): boolean {
  const sax = axisSign(ax);
  const say = axisSign(ay);
  const sbx = axisSign(bx);
  const sby = axisSign(by);
  if (sax !== 0 && sbx !== 0 && sax !== sbx) return false;
  if (say !== 0 && sby !== 0 && say !== sby) return false;
  if ((sax !== 0 && sax === sbx) || (say !== 0 && say === sby)) return true;
  if (sax !== 0 && sby !== 0 && sbx === 0 && say === 0) return true;
  if (say !== 0 && sbx !== 0 && sby === 0 && sax === 0) return true;
  return sax === sbx && say === sby;
}

function axisSign(v: number): number {
  if (v > 0.35) return 1;
  if (v < -0.35) return -1;
  return 0;
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

/** Inverse of mean squared colour distance to 8 neighbours (toroidal),
 *  or along the best 1-cell spine (H / V / two diagonals) so a thin
 *  same-colour line is coherent even when most 8-neighbours are background. */
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
  const s8 = 1 / (1 + (varSum / Math.max(1, count)) * 8);
  const axes: [number, number][] = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ];
  let sSpine = 0;
  for (const [dx, dy] of axes) {
    let axisVar = 0;
    for (const sign of [-1, 1]) {
      const nx = (x + sign * dx + w) % w;
      const ny = (y + sign * dy + h) % h;
      const j = ny * w + nx;
      const dr = r0 - field.r[j]!;
      const dg = g0 - field.g[j]!;
      const db = b0 - field.b[j]!;
      axisVar += dr * dr + dg * dg + db * db;
    }
    const s = 1 / (1 + (axisVar / 2) * 8);
    if (s > sSpine) sSpine = s;
  }
  return s8 > sSpine ? s8 : sSpine;
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
    flowRejects: {},
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
  const speed = Math.hypot(c.velX, c.velY);
  let thinStream = false;
  if (speed >= FIELD_OBS.flowMinSpeedExit && c.cells.length > 0) {
    const hx = c.velX / speed;
    const hy = c.velY / speed;
    let minC = Infinity;
    let maxC = -Infinity;
    for (let t = 0; t < c.cells.length; t++) {
      const i = c.cells[t]!;
      const x = i % gridW;
      const y = (i / gridW) | 0;
      const dx = toroidalDelta(x, c.comX, gridW);
      const dy = toroidalDelta(y, c.comY, gridH);
      const cross = dx * hy - dy * hx;
      if (cross < minC) minC = cross;
      if (cross > maxC) maxC = cross;
    }
    thinStream = maxC - minC <= FIELD_OBS.flowLaneWidth;
  }
  if (
    !thinStream &&
    c.width > gridW * FIELD_OBS.flowMaxSpanFrac &&
    c.height > gridH * FIELD_OBS.flowMaxSpanFrac
  ) {
    return false;
  }
  const fill = c.cells.length / Math.max(1, c.width * c.height);
  if (
    !thinStream &&
    c.width > gridW * FIELD_OBS.flowScatterSpanFrac &&
    c.height > gridH * FIELD_OBS.flowScatterSpanFrac &&
    fill < FIELD_OBS.flowScatterFillMax
  ) {
    return false;
  }
  const spanOk =
    Math.min(c.width, c.height) >= FIELD_OBS.flowSolidMinSpan;
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
