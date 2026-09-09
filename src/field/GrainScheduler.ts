import type {
  CoherentRegion,
  FieldObservation,
  FlowGroup,
  OscillatorGroup,
  TexturedArea,
  TexturedGroup,
} from "./FieldObserver.ts";
import { FIELD_OBS, toroidalDelta } from "./FieldObserver.ts";
import type { RgbField } from "./FrameObserver.ts";
import {
  identitySpectralBank,
  queryMaterialFromHsv,
  rgbToHsv,
  type MaterialSegment,
} from "../audio/spectral.ts";

/** Negotiable physical budget — raise after listening + CPU check. */
export const GRAIN_BUDGET = 64;
export const MASTER_GAIN = 1.0;

/**
 * Flow track ids live above this so they never collide with calm region ids
 * (both counters start at 1). Worklet applyTracks keys on regionId.
 */
export const FLOW_ID_BASE = 1_000_000;
/** Static colour-group ids — above flow so reclaim keys never collide. */
export const TEXTURE_ID_BASE = 2_000_000;

/** Negotiable scheduler curves (Sonic Laws shape; numbers are tunable). */
export const SCHED = {
  /** Per-region ceiling is the budget itself — area share is the real limit. */
  maxCalmConcurrent: 64,
  /** Max concurrent grains for the textured (static detail) pool. */
  textureMaxConcurrent: 64,
  /** Unified continuous duration range (log-lerp by timeOrder). */
  DUR_MIN: 0.03,
  /** Large still masses are long drones; keeps turnover low when a big area holds many concurrent grains. */
  DUR_MAX: 8.0,
  /**
   * Attack / release fraction range (chaos→calm via timeOrder).
   * Chaos end of the law is percussive (no sustain); calm end is sustained.
   * Release ends are named by pole, not min/max — the chaos end (0.98) is
   * larger than the calm end (0.34).
   */
  ATT_MIN: 0.02,
  ATT_MAX: 0.30,
  /** Release fraction at timeOrder = 0 (chaos): almost all release, no sustain. */
  REL_CHAOS: 0.98,
  /** Release fraction at timeOrder = 1 (calm): sustained wash. */
  REL_CALM: 0.34,
  /** Vertical extent → bandpass Q (derived from Y→frequency law). */
  Q_MIN: 0.1,
  Q_MAX: 26.0,
  /** Absolute floor on window half-width (seconds) — avoids degenerate ping-pong. */
  WINDOW_HALF_ABS_MIN_S: 0.005,
  /**
   * Calm/texture playheads stay past this much of the window start (seconds),
   * or 25% of the window if shorter — keeps sustained grains off the onset.
   */
  SUSTAINED_ONSET_SKIP_S: 0.08,
  /** Legacy calm Hz band — packing rate supersedes for calm wash. */
  calmRateMinHz: 0.8,
  calmRateMaxHz: 6,
  chaosRateMinHz: 6,
  chaosRateMaxHz: 48,
  /** δ scale for rate/duration — headroom so mid-chaos does not stick at max. */
  deltaRateNorm: 0.35,
  /**
   * Packing rate is concurrency/duration; the concurrent-count guard does the
   * limiting, so no rate floor is needed (1.0 → scale collapses to 1).
   */
  calmPackRateMin: 1.0,
  /**
   * Retired in V4.2 — chaos rate is pure δ-proportional (no floor).
   * Kept for history / grep continuity.
   */
  chaosPackRateMin: 0,
  /**
   * CPU rail only — never a mix control. Area share + duration already set the
   * concurrency ceiling via desiredChaos and the spawn-loop room() guard.
   * Max the law can demand: GRAIN_BUDGET / duration floor ≈ 64/0.02 = 3200 Hz;
   * 4000 leaves headroom. Assert this rail never binds; if it does, report.
   */
  CHAOS_EVENTS_MAX_HZ: 4000,
  /**
   * Per-cell chaos duration spray around the bag mean (packing rate still
   * uses durationChaosMean). duration = meanDur × clamp((bagδ̄/cellδ)^EXP,
   * 1/SPREAD, SPREAD) with raw (unsmoothed) cell δ — smoothed δ is too flat
   * on saturated scramble to break the 30 Hz choir. Negotiable; ~1.7 →
   * roughly 18–51 ms around a 30 ms mean.
   */
  CHAOS_DUR_SPREAD: 1.7,
  /** Exponent on (bagδ̄ / cellδ) before the SPREAD clamp. */
  CHAOS_DUR_EXP: 1.0,
  velDirEps: 0.08,
  stepsPerSec: 30,
  /** Samples of meanDelta kept per calm region for period detection. */
  rhythmHistory: 48,
  /** Minimum accepted observed period (seconds). */
  rhythmMinSec: 0.15,
  /** Maximum accepted observed period (seconds). */
  rhythmMaxSec: 2.0,
  /** Autocorr peak confidence to trust a period (raised V4.2 — reject drift artifacts). */
  rhythmConfidence: 0.72,
  /** Max grains fired on a trusted period wrap (felt pulse, not packing burst). */
  rhythmPulseMax: 2,
  /** While period trusted, top up wash only below this fraction of desired. */
  rhythmWashFloor: 0.5,
  /** Autocorr must dip below this between minLag and a qualifying peak. */
  RHYTHM_DIP: 0.15,
  /**
   * CPU rail only, never a mix control — mirrors CHAOS_EVENTS_MAX_HZ.
   * Burst size is the area share; the loop's budget + share guards are the
   * real ceilings. Kept at GRAIN_BUDGET so STOP-list greps still resolve.
   */
  oscBurstMax: GRAIN_BUDGET,
  /**
   * Oscillator pulse duty: duration = max(DUR_MIN, OSC_DUTY × periodSec).
   * At period 2 the raw value is 0.35×66.7ms = 23ms, which floors to DUR_MIN
   * 30ms (duty 0.45) so a fast oscillator does not collapse to a spike train.
   * Peak concurrency = share; average ≈ share × duty.
   */
  OSC_DUTY: 0.35,
  /** EMA for oscillator phase histogram buckets. */
  oscPhaseEma: 0.2,
  /** Colour spread at which spawn sites use the region's full extent. */
  SPAWN_SPREAD_FULL: 0.12,
  /** Floor on spawn dispersion — at 0.5 the 2-sigma envelope
   * (SPAWN_SLOT_Z_MAX) equals the region's half-extent, so a uniform region
   * samples its full extent and no more. */
  SPAWN_SPREAD_MIN: 0.5,
  /** Clamp on the per-slot Gaussian radius, in sigmas. */
  SPAWN_SLOT_Z_MAX: 2,
  /** Ring-search radius cap when a slot's target is outside the mask. */
  SPAWN_SNAP_MAX_RING: 32,
  /** Seed salts so the calm and texture pools do not resolve to the same sites. */
  SITE_SALT_CALM: 0x9e3779b1,
  SITE_SALT_TEXTURE: 0x85ebca6b,
  /**
   * Below this circular concentration R a region's COM in that axis is not a
   * usable spawn anchor (circular variance ≥ 0.5) — plan §4d / SPAWN_ANCHOR_R_MIN.
   */
  SPAWN_ANCHOR_R_MIN: 0.5,
  /**
   * Calm follow rides velX/velY (same conveyor idea as flow). Raw COM can
   * teleport ≤comMatchDist on a stable id when a moving mass changes shape;
   * that must not become one pan/Y hop. Soft-correct toward the spawn
   * anchor, capped per step.
   */
  CALM_FOLLOW_CORRECT: 0.35,
  CALM_FOLLOW_CORR_CAP: 2,
  /**
   * Flow timeOrder mid-band (chaos-adjacent → toward calm, never wash).
   * Packing density packT = area/regionArea lerps MIN→MAX. RegionArea still
   * only buys concurrency; packing shapes duration/envelope. Listen-tune.
   */
  FLOW_ORDER_MIN: 0.28,
  FLOW_ORDER_MAX: 0.52,
  /**
   * Cap flow grain lifetime by stream travel time (length / hop speed in
   * steps × dt). Keeps conveyor grains dying near the leading edge.
   */
  FLOW_TRAVEL_DUR_BLEND: 1,
  /**
   * Per-grain flow duration spray around the packing mean (packing rate
   * still uses unsprayed flowConveyorDuration). duration = meanDur ×
   * clamp((flowδ̄/cellδ)^EXP, 1/SPREAD, SPREAD) with raw cell δ, then
   * clamped to the travel-time cap when that bound applies. Gentler than
   * chaos so conveyors stay coherent.
   */
  FLOW_DUR_SPREAD: 1.5,
  /** Exponent on (flowδ̄ / cellδ) before the SPREAD clamp. */
  FLOW_DUR_EXP: 1.0,
} as const;

export type GrainRegime = "calm" | "chaos" | "texture" | "osc" | "flow";

/** Ephemeral grain descriptor (V4.1: continuous material; hue→sample frozen). */
export interface GrainSpawnEvent {
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
  durationSec: number;
  amplitude: number;
  /** +1 forward / -1 reverse along sample axis. */
  direction: number;
  /** Window centre [0,1] of file length (wrap-aware). */
  sampleCenter: number;
  /** Window half-width [0,1] of file length. */
  sampleHalf: number;
  /** Sample-accurate onset delay within the CA step (seconds). */
  startOffsetSec: number;
  /** Resonant bandpass Q (spectral purity); frozen at spawn. */
  q: number;
  /** Spectral position [0,1] at spawn; follows region while alive. */
  yNorm: number;
  /** Source L/R mix [0,1] from X (0=left); follows region while alive. */
  channelMix: number;
  /** Stereo pan [-1,1] at spawn; follows region while alive. */
  pan: number;
  /** Envelope attack as fraction of duration (frozen at spawn). */
  attackFrac: number;
  /** Envelope release as fraction of duration (frozen at spawn). */
  releaseFrac: number;
  regime: GrainRegime;
  regionId: number;
  /** Spawn offset from region follow-anchor (cells) — used for direct pan/Y follow. */
  trackDx: number;
  trackDy: number;
  /**
   * Read-position offset within the frozen window, ∈ [-1, 1].
   * Set by the scheduler (identity); worklet must not randomise.
   */
  readOffset?: number;
  /** Stratified slot index for calm/texture. Diagnostic — audio must not branch on it. */
  siteSlot?: number;
  /** Scheduler↔worklet id so share-reclaim can fade the same voice. */
  grainId?: number;
}

/** Per-step region COM for direct pan/Y follow (anchors are not EMA'd). */
export interface RegionTrack {
  regionId: number;
  /** True toroidal COM (kept for harness asserts; follow uses anchor). */
  comX: number;
  comY: number;
  /**
   * Spawn/follow anchor. Calm: hop-velocity conveyor + capped COM
   * correction (raw COM teleports on a stable id). Flow: hop-integrated
   * conveyor so grains ride perceptual motion, not structure COM drift.
   */
  anchorX: number;
  anchorY: number;
  gridWidth: number;
  gridHeight: number;
  /** Hop velocity (cells/step) — diagnostic; follow uses integrated anchor. */
  velX?: number;
  velY?: number;
}

export interface GrainEventBatch {
  masterGain: number;
  gridWidth: number;
  gridHeight: number;
  events: GrainSpawnEvent[];
  tracks: RegionTrack[];
  budget: number;
  /** Measured CA step rate (Hz) — diagnostic for the DATA fold. */
  measuredStepHz: number;
  predictedActive: number;
  calmActive: number;
  chaosActive: number;
  textureActive: number;
  oscActive: number;
  flowActive: number;
  /** Area-share allocation this step (sum of per-region calm/osc/flow shares). */
  shares: {
    calm: number;
    texture: number;
    chaos: number;
    osc: number;
    flow: number;
  };
  /** Per-region seats (calm ids + FLOW_ID_BASE+flow.id) for DATA-fold join. */
  regionSeats: { id: number; share: number; active: number }[];
  /** Voices the worklet must short-release so a new area share can spend. */
  releaseGrainIds: number[];
}

type ActiveRecord = {
  endMs: number;
  regime: GrainRegime;
  regionId: number;
  grainId: number;
};

type ShareAlloc = {
  calm: Map<number, number>;
  chaos: number;
  texture: Map<number, number>;
  osc: Map<number, number>;
  flow: Map<number, number>;
};

type RegionClock = {
  id: number;
  /** Poisson-style accumulator when no confident period. */
  acc: number;
  /** Phase in [0,1) when period is trusted. */
  phase: number;
  history: Float32Array;
  histLen: number;
  histWrite: number;
  periodSec: number;
  confidence: number;
  /** Next stratified spawn slot for this region (cursor, not ownership). */
  siteSlot: number;
  /**
   * Hop-integrated follow anchor (cells). Raw COM can jump ≤comMatchDist
   * (~18) on a stable id when a moving mass changes shape — that teleported
   * every living grain. Ride EMA velocity instead; soft-correct toward COM.
   */
  followX: number;
  followY: number;
  hasFollow: boolean;
};

type GrainMaterial = {
  order: number;
  durationSec: number;
  attackFrac: number;
  releaseFrac: number;
  q: number;
};

/** Minimal bag a chaos spawn needs — whole bag or one cluster. */
type ChaosSpendBag = {
  id: number;
  area: number;
  cells: Uint32Array;
  meanDelta: number;
  maxDelta: number;
  meanSimilarity: number;
};

/** Integer split of `total` ∝ weights, exact by largest remainder. */
function largestRemainderSplit(total: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0 || total <= 0) return weights.map(() => 0);
  let weightSum = 0;
  for (const w of weights) weightSum += Math.max(0, w);
  if (weightSum <= 0) return weights.map(() => 0);
  const out = new Array<number>(n);
  const rema: { i: number; frac: number }[] = [];
  let used = 0;
  for (let i = 0; i < n; i++) {
    const exact = (total * Math.max(0, weights[i]!)) / weightSum;
    const base = Math.floor(exact);
    out[i] = base;
    used += base;
    rema.push({ i, frac: exact - base });
  }
  rema.sort((a, b) => b.frac - a.frac);
  for (let k = 0; used < total && k < rema.length; k++, used++) {
    out[rema[k]!.i]! += 1;
  }
  return out;
}

/**
 * Area-weighted ephemeral grain scheduler.
 * Activity shapes rate/length usage; area shapes budget share;
 * loudness stays regime-neutral via equal amplitude + voice prescale;
 * the worklet is a slow sounding-count leveler, not a flat RMS servo.
 */
export class GrainScheduler {
  readonly budget: number;
  private active: ActiveRecord[] = [];
  private calmClocks = new Map<number, RegionClock>();
  /** Per-chaos-area packing accumulators, keyed by cluster id (-1 = residual). */
  private chaosAccs = new Map<number, number>();
  /** Per static colour-group packing accumulators. */
  private textureAccs = new Map<number, number>();
  private lastStepMs = 0;
  private stepIndex = 0;
  /**
   * Measured CA step interval (EMA of observed dt). The display-refresh
   * quantised CA rarely runs at exactly SCHED.stepsPerSec, and oscillator /
   * flow pulse periods are given in *steps* — converting them with the real
   * interval keeps pulses locked to the visual period on every machine.
   */
  private stepSec = 1 / SCHED.stepsPerSec;
  /**
   * Merged-away region ids → surviving id, held only while grains spawned
   * under the old id are still alive so they keep following the merged body.
   */
  private mergeAliases = new Map<number, number>();
  /** Per-period phase histograms for oscillator pulse locking. */
  private oscPhase = new Map<number, Float32Array>();
  /** Next stratified spawn slot per static colour group. */
  private textureSiteSlots = new Map<number, number>();
  /** Per-flow packing accumulators, trailing-edge cursors, hop conveyor. */
  private flowClocks = new Map<
    number,
    {
      acc: number;
      phase: number;
      cellCursor: number;
      followX: number;
      followY: number;
      hasFollow: boolean;
    }
  >();
  /**
   * Hysteresis for calm follow anchors (COM vs grid centre). Crossing
   * SPAWN_ANCHOR_R_MIN every frame teleports pan/Y by ~half the grid.
   */
  private anchorLocks = new Map<number, { xCenter: boolean; yCenter: boolean }>();
  /**
   * O(1) pool-membership test for spawn-site snapping. Stamp buffer so a
   * pool's mask never has to be cleared: a cell is a member iff its entry
   * equals the stamp handed out when that pool's mask was written.
   */
  private maskStamp = new Uint32Array(0);
  private maskStampValue = 1;
  /** Source file duration (seconds) for window-in-seconds law. */
  private sourceDurationSec = 1;
  /** Polar material segments; identity mid-file until a source loads. */
  private segments: MaterialSegment[] = identitySpectralBank().segments;
  /** Monotonic voice id — pairs scheduler occupancy with worklet voices. */
  private nextGrainId = 1;

  constructor(budget = GRAIN_BUDGET) {
    this.budget = budget;
  }

  setSourceDurationSec(durationSec: number): void {
    this.sourceDurationSec = Math.max(1e-3, durationSec);
  }

  setMaterialSegments(segments: MaterialSegment[]): void {
    this.segments =
      segments.length > 0 ? segments : identitySpectralBank().segments;
  }

  /** @deprecated Use setMaterialSegments — kept for call-site migration. */
  setHueSampleLut(_lut: Float32Array): void {
    /* no-op under V5 polar map */
  }

  reset(): void {
    this.active = [];
    this.calmClocks.clear();
    this.chaosAccs.clear();
    this.textureAccs.clear();
    this.lastStepMs = 0;
    this.stepIndex = 0;
    this.stepSec = 1 / SCHED.stepsPerSec;
    this.mergeAliases.clear();
    this.oscPhase.clear();
    this.textureSiteSlots.clear();
    this.flowClocks.clear();
    this.anchorLocks.clear();
    this.nextGrainId = 1;
  }

  private rememberActive(ev: GrainSpawnEvent, nowMs: number): void {
    const grainId = this.nextGrainId++;
    ev.grainId = grainId;
    this.active.push({
      endMs: nowMs + ev.durationSec * 1000,
      regime: ev.regime,
      regionId: ev.regionId,
      grainId,
    });
  }

  /**
   * Area share is the occupancy ceiling. Long DUR_MAX grains from a dead id
   * or a shrunk region must yield so a newly allocated pool can spend —
   * otherwise calm fills the budget and flow/chaos stay at 0/share.
   */
  private reclaimToShares(obs: FieldObservation, shares: ShareAlloc): number[] {
    const liveCalm = shares.calm;
    const liveFlow = new Map<number, number>();
    for (const f of obs.flows ?? []) {
      liveFlow.set(FLOW_ID_BASE + f.id, shares.flow.get(f.id) ?? 0);
    }
    const liveTexture = new Map<number, number>();
    for (const [id, n] of shares.texture) {
      liveTexture.set(TEXTURE_ID_BASE + id, n);
    }
    let oscShare = 0;
    for (const n of shares.osc.values()) oscShare += n;

    const capOf = (a: ActiveRecord): number => {
      if (a.regime === "calm") {
        return liveCalm.get(resolveAlias(a.regionId, this.mergeAliases)) ?? 0;
      }
      if (a.regime === "flow") return liveFlow.get(a.regionId) ?? 0;
      if (a.regime === "chaos") return shares.chaos;
      if (a.regime === "texture") return liveTexture.get(a.regionId) ?? 0;
      if (a.regime === "osc") return oscShare;
      return 0;
    };
    const keyOf = (a: ActiveRecord): string => {
      if (a.regime === "calm") {
        return `calm:${resolveAlias(a.regionId, this.mergeAliases)}`;
      }
      if (a.regime === "flow") return `flow:${a.regionId}`;
      if (a.regime === "texture") return `texture:${a.regionId}`;
      return a.regime;
    };

    const groups = new Map<string, ActiveRecord[]>();
    for (const a of this.active) {
      const k = keyOf(a);
      const g = groups.get(k);
      if (g) g.push(a);
      else groups.set(k, [a]);
    }

    const steal = new Set<number>();
    for (const grains of groups.values()) {
      const cap = capOf(grains[0]!);
      if (grains.length <= cap) continue;
      grains.sort((a, b) => a.endMs - b.endMs);
      const nSteal = grains.length - cap;
      for (let i = 0; i < nSteal; i++) steal.add(grains[i]!.grainId);
    }
    if (steal.size === 0) return [];
    this.active = this.active.filter((a) => !steal.has(a.grainId));
    return [...steal];
  }

  /** Write a pool's membership into the stamp buffer; returns its stamp. */
  private stampPoolMask(cells: Uint32Array, nCells: number): number {
    if (this.maskStamp.length < nCells) {
      this.maskStamp = new Uint32Array(nCells);
      this.maskStampValue = 1;
    }
    this.maskStampValue += 1;
    if (this.maskStampValue >= 0xffffffff) {
      this.maskStamp.fill(0);
      this.maskStampValue = 1;
    }
    const stamp = this.maskStampValue;
    for (let i = 0; i < cells.length; i++) {
      const ci = cells[i]!;
      if (ci < nCells) this.maskStamp[ci] = stamp;
    }
    return stamp;
  }

  /**
   * Produce spawn events for this CA step.
   * @param rgb Current frame RGB (identity at spawn).
   * @param nowMs performance.now()
   * @param sourceDurationSec Optional override for window law (else setSourceDurationSec).
   */
  step(
    obs: FieldObservation,
    rgb: RgbField,
    nowMs = performance.now(),
    sourceDurationSec?: number,
  ): GrainEventBatch {
    this.prune(nowMs);
    const events: GrainSpawnEvent[] = [];
    const nCells = obs.width * obs.height;
    const dtSec =
      this.lastStepMs > 0
        ? Math.min(0.25, (nowMs - this.lastStepMs) / 1000)
        : 1 / SCHED.stepsPerSec;
    if (this.lastStepMs > 0) {
      // EMA of the real inter-step interval (clamped to sane CA rates) —
      // periods given in steps convert to seconds with this, not the 30 Hz
      // assumption. A steady offline 30-steps/s drive converges to 1/30.
      const measured = Math.min(0.25, Math.max(1 / 120, dtSec));
      this.stepSec += (measured - this.stepSec) * 0.08;
    }
    this.lastStepMs = nowMs;
    this.stepIndex += 1;
    const bankDur =
      typeof sourceDurationSec === "number" && sourceDurationSec > 0
        ? sourceDurationSec
        : this.sourceDurationSec;

    const shares = allocateShares(obs, this.budget, nCells);
    const amp = equalAmp(this.budget);
    const tracks: RegionTrack[] = [];

    const liveCalmIds = new Set(obs.coherent.map((r) => r.id));
    for (const id of [...this.calmClocks.keys()]) {
      if (!liveCalmIds.has(id)) this.calmClocks.delete(id);
    }
    for (const id of [...this.anchorLocks.keys()]) {
      if (!liveCalmIds.has(id)) this.anchorLocks.delete(id);
    }

    // Region lifecycle: remember merges so old-id grains follow the survivor;
    // births fire immediately below (visual appearance = audible onset).
    const births = new Set(obs.regionEvents?.births ?? []);
    for (const m of obs.regionEvents?.merges ?? []) {
      this.mergeAliases.set(m.from, m.into);
    }

    const releaseGrainIds = this.reclaimToShares(obs, shares);

    for (const region of obs.coherent) {
      let lock = this.anchorLocks.get(region.id);
      if (!lock) {
        lock = {
          xCenter:
            region.width >= obs.width ||
            region.comConcX < SCHED.SPAWN_ANCHOR_R_MIN,
          yCenter:
            region.height >= obs.height ||
            region.comConcY < SCHED.SPAWN_ANCHOR_R_MIN,
        };
        this.anchorLocks.set(region.id, lock);
      }
      const prevXCenter = lock.xCenter;
      const prevYCenter = lock.yCenter;
      const anchor = regionAnchor(region, obs, lock);
      const w = obs.width;
      const h = obs.height;

      let clock = this.calmClocks.get(region.id);
      if (!clock) {
        clock = {
          id: region.id,
          // A newborn structure speaks the step it appears; re-seen ids keep
          // the random phase so steady fields do not synchronise.
          acc: births.has(region.id) ? 1 : Math.random(),
          phase: Math.random(),
          history: new Float32Array(SCHED.rhythmHistory),
          histLen: 0,
          histWrite: 0,
          periodSec: 0,
          confidence: 0,
          siteSlot: 0,
          followX: anchor.x,
          followY: anchor.y,
          hasFollow: true,
        };
        this.calmClocks.set(region.id, clock);
      } else if (!clock.hasFollow) {
        clock.followX = anchor.x;
        clock.followY = anchor.y;
        clock.hasFollow = true;
      } else {
        // Velocity conveyor + capped COM correction (not a raw COM snap).
        clock.followX =
          (((clock.followX + region.velX) % w) + w) % w;
        clock.followY =
          (((clock.followY + region.velY) % h) + h) % h;
        const errX = toroidalDelta(anchor.x, clock.followX, w);
        const errY = toroidalDelta(anchor.y, clock.followY, h);
        const corr = SCHED.CALM_FOLLOW_CORRECT;
        const cap = SCHED.CALM_FOLLOW_CORR_CAP;
        clock.followX =
          (((clock.followX + clamp(errX * corr, -cap, cap)) % w) + w) % w;
        clock.followY =
          (((clock.followY + clamp(errY * corr, -cap, cap)) % h) + h) % h;
        // COM ↔ centre is a seam event — resync that axis once.
        if (lock.xCenter !== prevXCenter) clock.followX = anchor.x;
        if (lock.yCenter !== prevYCenter) clock.followY = anchor.y;
      }

      tracks.push({
        regionId: region.id,
        comX: region.comX,
        comY: region.comY,
        anchorX: clock.followX,
        anchorY: clock.followY,
        gridWidth: w,
        gridHeight: h,
        velX: region.velX,
        velY: region.velY,
      });

      const share = shares.calm.get(region.id) ?? 0;
      if (share <= 0) continue;

      const desired = desiredCalmConcurrent(region, share);

      pushHistory(clock, region.meanDelta);
      const rhythm = estimatePeriod(clock, dtSec);
      clock.periodSec = rhythm.periodSec;
      clock.confidence = rhythm.confidence;

      const mat = materialFromRegion(region, nCells);
      const packHz = desired / Math.max(0.05, mat.durationSec);
      const baseHz = calmPackRateHz(packHz, region.meanDelta);
      const regionActive = () =>
        countActiveSeat(this.active, "calm", region.id, this.mergeAliases);
      const room = () =>
        regionActive() < desired && this.active.length < this.budget;

      // Built once per region per step, reused by every spawn in that step.
      let calmMaskStamp = -1;

      const pushCalm = () => {
        if (calmMaskStamp < 0) {
          calmMaskStamp = this.stampPoolMask(region.cells, nCells);
        }
        const slot = clock!.siteSlot % Math.max(1, desired);
        clock!.siteSlot += 1;
        const ev = spawnCalm(
          region,
          obs,
          rgb,
          amp,
          mat,
          bankDur,
          dtSec,
          this.segments,
          slot,
          this.maskStamp,
          calmMaskStamp,
          anchor.x,
          anchor.y,
        );
        events.push(ev);
        this.rememberActive(ev, nowMs);
      };

      if (
        rhythm.confidence >= SCHED.rhythmConfidence &&
        rhythm.periodSec > 0
      ) {
        // Phase-locked pulse — small burst on wrap (do not packing-smear the beat).
        clock.phase += dtSec / rhythm.periodSec;
        while (clock.phase >= 1 && room()) {
          clock.phase -= 1;
          const pulseN = Math.min(SCHED.rhythmPulseMax, desired);
          let burst = 0;
          while (burst < pulseN && room()) {
            pushCalm();
            burst += 1;
          }
        }
        if (clock.phase > 2) clock.phase = clock.phase % 1;

        // Soft wash top-up only if concurrent collapses below floor.
        const washTarget = Math.max(1, Math.floor(desired * SCHED.rhythmWashFloor));
        if (regionActive() < washTarget) {
          clock.acc += baseHz * dtSec;
          while (clock.acc >= 1 && regionActive() < washTarget && room()) {
            clock.acc -= 1;
            pushCalm();
          }
          if (clock.acc > 2) clock.acc = 2;
        }
      } else {
        // Multi-spawn per step so a large share can fill after reset;
        // concurrent-count room() is the real limit.
        clock.acc += baseHz * dtSec;
        clock.acc = Math.min(clock.acc, desired);
        while (clock.acc >= 1 && room()) {
          clock.acc -= 1;
          pushCalm();
        }
      }
    }

    // Oscillator pulse-locked bursts.
    const livePeriods = new Set(
      (obs.oscillators ?? []).map((g) => g.period),
    );
    for (const p of [...this.oscPhase.keys()]) {
      if (!livePeriods.has(p)) this.oscPhase.delete(p);
    }
    for (const group of obs.oscillators ?? []) {
      const share = shares.osc.get(group.period) ?? 0;
      if (share <= 0 || group.cells.length === 0) continue;
      let hist = this.oscPhase.get(group.period);
      if (!hist || hist.length !== group.period) {
        hist = new Float32Array(group.period);
        this.oscPhase.set(group.period, hist);
      }
      const bucket = this.stepIndex % group.period;
      const ema = SCHED.oscPhaseEma;
      hist[bucket] = hist[bucket]! + (group.meanDelta - hist[bucket]!) * ema;

      let firePhase = 0;
      let best = -Infinity;
      for (let b = 0; b < hist.length; b++) {
        if (hist[b]! > best) {
          best = hist[b]!;
          firePhase = b;
        }
      }

      if (bucket !== firePhase) continue;

      // Fire the whole share as one composite hit; share + budget guards (S1)
      // are the real ceilings — oscBurstMax is a CPU rail only.
      // Snapshot osc active before the loop: grains are pushed to both
      // `active` and `events`, so counting both live would double-count and
      // cap the burst at share/2 (which silently matched the old oscBurstMax=3).
      const nBurst = Math.max(1, Math.min(SCHED.oscBurstMax, share));
      const oscActiveBefore = countActiveRegime(this.active, "osc");
      let burst = 0;
      while (
        burst < nBurst &&
        this.active.length < this.budget &&
        oscActiveBefore + countEventsRegime(events, "osc") < share
      ) {
        const ev = spawnOsc(
          group,
          obs,
          rgb,
          amp,
          bankDur,
          dtSec,
          this.segments,
          this.stepSec,
        );
        events.push(ev);
        this.rememberActive(ev, nowMs);
        burst += 1;
      }
    }

    // Texture: one voice pool per frozen colour group.
    const textureGroups =
      obs.texturedGroups && obs.texturedGroups.length > 0
        ? obs.texturedGroups
        : obs.textured.cells.length > 0
          ? [
              {
                id: -1,
                area: obs.textured.area,
                comX: (obs.width - 1) / 2,
                comY: (obs.height - 1) / 2,
                height: obs.height,
                width: obs.width,
                meanDelta: obs.textured.meanDelta,
                meanSimilarity: obs.textured.meanSimilarity,
                meanR: obs.textured.meanR,
                meanG: obs.textured.meanG,
                meanB: obs.textured.meanB,
                colourSpread: obs.textured.colourSpread,
                cells: obs.textured.cells,
              } satisfies TexturedGroup,
            ]
          : [];
    const liveTexIds = new Set(textureGroups.map((g) => g.id));
    for (const id of [...this.textureAccs.keys()]) {
      if (!liveTexIds.has(id)) this.textureAccs.delete(id);
    }
    for (const id of [...this.textureSiteSlots.keys()]) {
      if (!liveTexIds.has(id)) this.textureSiteSlots.delete(id);
    }
    for (const group of textureGroups) {
      const desiredTexture = shares.texture.get(group.id) ?? 0;
      if (desiredTexture <= 0 || group.cells.length === 0) continue;
      const texMat = materialFromTexture(group, nCells);
      const texMaskStamp = this.stampPoolMask(group.cells, nCells);
      const texPackHz = desiredTexture / Math.max(0.05, texMat.durationSec);
      const texRateHz = calmPackRateHz(texPackHz, group.meanDelta);
      let acc = this.textureAccs.get(group.id) ?? 0;
      acc += texRateHz * dtSec;
      const textureAlready = countActiveSeat(
        this.active,
        "texture",
        TEXTURE_ID_BASE + group.id,
      );
      let siteSlot = this.textureSiteSlots.get(group.id) ?? 0;
      while (
        acc >= 1 &&
        textureAlready + countEventsSeat(events, "texture", TEXTURE_ID_BASE + group.id) <
          desiredTexture &&
        this.active.length < this.budget
      ) {
        acc -= 1;
        const texSlot = siteSlot % Math.max(1, desiredTexture);
        siteSlot += 1;
        const ev = spawnTexture(
          group,
          obs,
          rgb,
          amp,
          texMat,
          bankDur,
          dtSec,
          this.segments,
          texSlot,
          this.maskStamp,
          texMaskStamp,
        );
        events.push(ev);
        this.rememberActive(ev, nowMs);
      }
      if (acc > Math.max(3, desiredTexture)) {
        acc = Math.max(3, desiredTexture);
      }
      this.textureAccs.set(group.id, acc);
      this.textureSiteSlots.set(group.id, siteSlot);
    }

    // Chaos pack-to-share: spend area budget as many short concurrent hits.
    // Spent per chaotic *area* (brief §7): each cluster's sub-share ∝ its
    // area, its rate ∝ its own δ̄, its duration from its own bag stats — so a
    // hot storm sprays fast where you see it while a cool patch patters.
    // Total spend is still bounded by the global chaos share + budget.
    const desiredChaos = shares.chaos;
    const chaosClusters: ChaosSpendBag[] =
      obs.chaotic.clusters && obs.chaotic.clusters.length > 0
        ? obs.chaotic.clusters
        : obs.chaotic.cells.length > 0
          ? [
              {
                id: -1,
                area: obs.chaotic.area,
                cells: obs.chaotic.cells,
                meanDelta: obs.chaotic.meanDelta,
                maxDelta: obs.chaotic.maxDelta,
                meanSimilarity: obs.chaotic.meanSimilarity,
              },
            ]
          : [];
    const liveChaosIds = new Set(chaosClusters.map((c) => c.id));
    for (const id of [...this.chaosAccs.keys()]) {
      if (!liveChaosIds.has(id)) this.chaosAccs.delete(id);
    }
    const clusterShares = largestRemainderSplit(
      desiredChaos,
      chaosClusters.map((c) => c.area),
    );
    // Snapshot like calm: grains pushed to active this step must not be
    // double-counted against events (that capped fill at desired/2).
    const chaosAlready = countActiveRegime(this.active, "chaos");
    const chaosRoom = () =>
      chaosAlready + countEventsRegime(events, "chaos") < desiredChaos &&
      this.active.length < this.budget;

    for (let c = 0; c < chaosClusters.length; c++) {
      const cluster = chaosClusters[c]!;
      const share = clusterShares[c]!;
      if (share <= 0 || cluster.cells.length === 0) continue;
      const clusterDur = durationChaosMean(cluster, nCells);
      const packHz = share / Math.max(0.02, clusterDur);
      const rateHz = chaosPackRateHz(packHz, cluster.meanDelta);
      // Closed decision (Implementation Filter): seed random, leftover ≤ 3.
      let acc = this.chaosAccs.get(cluster.id) ?? Math.random();
      acc += rateHz * dtSec;
      while (acc >= 1 && chaosRoom()) {
        acc -= 1;
        const ev = spawnChaos(
          cluster,
          obs,
          rgb,
          amp,
          bankDur,
          dtSec,
          this.segments,
          clusterDur,
          cluster.meanDelta,
        );
        events.push(ev);
        this.rememberActive(ev, nowMs);
      }
      if (acc > 3) acc = 3;
      this.chaosAccs.set(cluster.id, acc);
    }

    // Flow: trailing-edge piece-grains; hop-velocity conveyor follow.
    const liveFlowIds = new Set((obs.flows ?? []).map((f) => f.id));
    for (const id of [...this.flowClocks.keys()]) {
      if (!liveFlowIds.has(id)) this.flowClocks.delete(id);
    }
    for (const flow of obs.flows ?? []) {
      const trackId = FLOW_ID_BASE + flow.id;
      const w = obs.width;
      const h = obs.height;
      let clock = this.flowClocks.get(flow.id);
      if (!clock) {
        clock = {
          acc: Math.random(),
          phase: 0,
          cellCursor: 0,
          followX: 0,
          followY: 0,
          hasFollow: false,
        };
        this.flowClocks.set(flow.id, clock);
      }
      const edge = flowHeadingEdges(flow, w, h);
      if (!clock.hasFollow) {
        clock.followX = edge.trailX;
        clock.followY = edge.trailY;
        clock.hasFollow = true;
      } else {
        clock.followX =
          (((clock.followX + flow.velX) % w) + w) % w;
        clock.followY =
          (((clock.followY + flow.velY) % h) + h) % h;
      }
      tracks.push({
        regionId: trackId,
        comX: flow.comX,
        comY: flow.comY,
        anchorX: clock.followX,
        anchorY: clock.followY,
        gridWidth: w,
        gridHeight: h,
        velX: flow.velX,
        velY: flow.velY,
      });

      const share = shares.flow.get(flow.id) ?? 0;
      if (share <= 0 || flow.cells.length === 0) continue;

      const flowDur = flowConveyorDuration(flow, dtSec, edge.length);
      const flowMeanDelta = meanRawDelta(flow.cells, obs.delta);
      const travelCap = flowTravelCapSec(flow, dtSec, edge.length);
      const regionActive = () =>
        countActiveSeat(this.active, "flow", trackId);
      const room = () =>
        regionActive() < share && this.active.length < this.budget;

      const pushPiece = (meanDur: number) => {
        const ci =
          edge.ordered[clock!.cellCursor % edge.ordered.length]!;
        clock!.cellCursor += 1;
        const cellDelta = obs.delta[ci] ?? flowMeanDelta;
        const durationSec = flowDurationAroundMean(
          meanDur,
          flowMeanDelta,
          cellDelta,
          travelCap,
        );
        const ev = spawnFlow(
          flow,
          ci,
          obs,
          rgb,
          amp,
          bankDur,
          dtSec,
          this.segments,
          clock!.followX,
          clock!.followY,
          durationSec,
        );
        events.push(ev);
        this.rememberActive(ev, nowMs);
      };

      const sitePeriod = flow.period ?? 0;
      if (sitePeriod >= 2) {
        const periodSec = sitePeriod * this.stepSec;
        const pulseDur = Math.max(
          SCHED.DUR_MIN,
          SCHED.OSC_DUTY * periodSec,
          flowDur,
        );
        clock.phase += dtSec / periodSec;
        while (clock.phase >= 1 && room()) {
          clock.phase -= 1;
          const nBurst = Math.max(1, Math.min(SCHED.oscBurstMax, share));
          let burst = 0;
          while (burst < nBurst && room()) {
            pushPiece(pulseDur);
            burst += 1;
          }
        }
        if (clock.phase > 2) clock.phase = clock.phase % 1;
      } else {
        const packHz = share / Math.max(0.05, flowDur);
        clock.acc += packHz * dtSec;
        while (clock.acc >= 1 && room()) {
          clock.acc -= 1;
          pushPiece(flowDur);
        }
        if (clock.acc > Math.max(3, share)) {
          clock.acc = Math.max(3, share);
        }
      }
    }

    // Merged-region continuity: grains spawned under an id that has since
    // merged keep following the surviving body. Emit an alias track at the
    // survivor's anchor while any such grain is alive; drop stale aliases.
    if (this.mergeAliases.size > 0) {
      const trackById = new Map<number, RegionTrack>();
      for (const t of tracks) trackById.set(t.regionId, t);
      for (const [deadId, into] of [...this.mergeAliases]) {
        const hasGrains = this.active.some((a) => a.regionId === deadId);
        if (!hasGrains) {
          this.mergeAliases.delete(deadId);
          continue;
        }
        const target = resolveAlias(into, this.mergeAliases);
        const survivor = trackById.get(target);
        if (survivor) tracks.push({ ...survivor, regionId: deadId });
      }
    }

    let calmShareSum = 0;
    for (const s of shares.calm.values()) calmShareSum += s;
    let oscShareSum = 0;
    for (const s of shares.osc.values()) oscShareSum += s;
    let flowShareSum = 0;
    for (const s of shares.flow.values()) flowShareSum += s;
    let textureShareSum = 0;
    for (const s of shares.texture.values()) textureShareSum += s;

    const activeByRegion = new Map<number, number>();
    for (const a of this.active) {
      const id =
        a.regime === "calm"
          ? resolveAlias(a.regionId, this.mergeAliases)
          : a.regionId;
      activeByRegion.set(id, (activeByRegion.get(id) ?? 0) + 1);
    }
    const regionSeats: { id: number; share: number; active: number }[] = [];
    for (const [id, share] of shares.calm) {
      regionSeats.push({
        id,
        share,
        active: activeByRegion.get(id) ?? 0,
      });
    }
    for (const flow of obs.flows ?? []) {
      const id = FLOW_ID_BASE + flow.id;
      regionSeats.push({
        id,
        share: shares.flow.get(flow.id) ?? 0,
        active: activeByRegion.get(id) ?? 0,
      });
    }

    return {
      masterGain: MASTER_GAIN,
      gridWidth: obs.width,
      gridHeight: obs.height,
      events,
      tracks,
      budget: this.budget,
      measuredStepHz: 1 / Math.max(1e-3, this.stepSec),
      predictedActive: this.active.length,
      calmActive: countActiveRegime(this.active, "calm"),
      chaosActive: countActiveRegime(this.active, "chaos"),
      textureActive: countActiveRegime(this.active, "texture"),
      oscActive: countActiveRegime(this.active, "osc"),
      flowActive: countActiveRegime(this.active, "flow"),
      shares: {
        calm: calmShareSum,
        texture: textureShareSum,
        chaos: shares.chaos,
        osc: oscShareSum,
        flow: flowShareSum,
      },
      regionSeats,
      releaseGrainIds,
    };
  }

  private prune(nowMs: number): void {
    this.active = this.active.filter((a) => a.endMs > nowMs);
  }
}

function pushHistory(clock: RegionClock, value: number): void {
  const n = clock.history.length;
  clock.history[clock.histWrite] = value;
  clock.histWrite = (clock.histWrite + 1) % n;
  if (clock.histLen < n) clock.histLen += 1;
}

/**
 * Autocorrelation local-max peak on meanDelta history → period + confidence.
 * Requires a dip below RHYTHM_DIP before the peak (rejects smooth EMA false positives).
 */
function estimatePeriod(
  clock: RegionClock,
  dtSec: number,
): { periodSec: number; confidence: number } {
  const n = clock.histLen;
  if (n < Math.min(24, SCHED.rhythmHistory) || dtSec <= 0) {
    return { periodSec: 0, confidence: 0 };
  }

  const series = new Float32Array(n);
  const start = (clock.histWrite - n + clock.history.length) % clock.history.length;
  for (let i = 0; i < n; i++) {
    series[i] = clock.history[(start + i) % clock.history.length]!;
  }

  let mean = 0;
  for (let i = 0; i < n; i++) mean += series[i]!;
  mean /= n;
  let varSum = 0;
  for (let i = 0; i < n; i++) {
    const d = series[i]! - mean;
    varSum += d * d;
  }
  if (varSum < 1e-8) return { periodSec: 0, confidence: 0 };

  const minLag = Math.max(2, Math.floor(SCHED.rhythmMinSec / dtSec));
  const maxLag = Math.min(n - 2, Math.ceil(SCHED.rhythmMaxSec / dtSec));
  if (minLag >= maxLag) return { periodSec: 0, confidence: 0 };

  const corr = new Float32Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let num = 0;
    for (let i = 0; i < n - lag; i++) {
      num += (series[i]! - mean) * (series[i + lag]! - mean);
    }
    corr[lag] = num / varSum;
  }

  let bestLag = 0;
  let bestCorr = -Infinity;
  // Require a true interior local max (neighbours on both sides within range).
  for (let lag = minLag + 1; lag <= maxLag - 1; lag++) {
    const c = corr[lag]!;
    if (!(c > corr[lag - 1]! && c > corr[lag + 1]!)) continue;
    let dipped = false;
    for (let k = minLag; k < lag; k++) {
      if (corr[k]! < SCHED.RHYTHM_DIP) {
        dipped = true;
        break;
      }
    }
    if (!dipped) continue;
    if (c > bestCorr) {
      bestCorr = c;
      bestLag = lag;
    }
  }

  if (bestLag === 0) return { periodSec: 0, confidence: 0 };
  const confidence = clamp01(bestCorr);
  if (confidence < SCHED.rhythmConfidence * 0.5) {
    return { periodSec: 0, confidence: 0 };
  }
  return { periodSec: bestLag * dtSec, confidence };
}

function equalAmp(budget: number): number {
  return 1 / Math.sqrt(Math.max(1, budget));
}

type StableClaim = {
  pool: "calm" | "osc" | "flow" | "texture";
  id: number;
  exact: number;
  area: number;
};

/**
 * Hare–Niemeyer: integer seats for `room` in proportion to exact area share.
 * Used when the ¼-seat floor would overflow — floor(1 * scale) would zero
 * every strip in a many-column field.
 */
function hamiltonSeats(
  claims: StableClaim[],
  room: number,
): (StableClaim & { seats: number })[] {
  if (claims.length === 0 || room <= 0) {
    return claims.map((c) => ({ ...c, seats: 0 }));
  }
  const exactSum = claims.reduce((s, c) => s + c.exact, 0);
  if (exactSum <= 0) {
    return claims.map((c) => ({ ...c, seats: 0 }));
  }
  const parts = claims.map((c) => {
    const scaled = (c.exact / exactSum) * room;
    const base = Math.floor(scaled);
    return { ...c, seats: base, frac: scaled - base };
  });
  let used = 0;
  for (const p of parts) used += p.seats;
  const order = parts
    .map((_, i) => i)
    .sort((a, b) => {
      const pa = parts[a]!;
      const pb = parts[b]!;
      return pb.frac - pa.frac || pb.area - pa.area || pa.id - pb.id;
    });
  for (let n = 0; used < room && n < order.length; n++) {
    parts[order[n]!]!.seats += 1;
    used += 1;
  }
  return parts;
}

/** Confirmed calm/flow/osc/texture must not stay 0 while a pool holds ≥2. */
function stealQuarterSeats(
  calm: Map<number, number>,
  flow: Map<number, number>,
  osc: Map<number, number>,
  texture: Map<number, number>,
  claims: StableClaim[],
): void {
  const silent = claims.filter((c) => {
    if (c.pool === "calm") return (calm.get(c.id) ?? 0) === 0;
    if (c.pool === "flow") return (flow.get(c.id) ?? 0) === 0;
    if (c.pool === "osc") return (osc.get(c.id) ?? 0) === 0;
    if (c.pool === "texture") return (texture.get(c.id) ?? 0) === 0;
    return false;
  });
  silent.sort((a, b) => b.area - a.area || a.id - b.id);

  const takeOne = (): boolean => {
    let bestKind: "calm" | "flow" | "osc" | "texture" | null = null;
    let bestId = -1;
    let bestN = 1;
    const consider = (
      kind: "calm" | "flow" | "osc" | "texture",
      id: number,
      n: number,
    ) => {
      if (n >= 2 && n > bestN) {
        bestKind = kind;
        bestId = id;
        bestN = n;
      }
    };
    for (const [id, n] of calm) consider("calm", id, n);
    for (const [id, n] of flow) consider("flow", id, n);
    for (const [id, n] of osc) consider("osc", id, n);
    for (const [id, n] of texture) consider("texture", id, n);
    if (!bestKind) return false;
    if (bestKind === "calm") calm.set(bestId, bestN - 1);
    else if (bestKind === "flow") flow.set(bestId, bestN - 1);
    else if (bestKind === "osc") osc.set(bestId, bestN - 1);
    else texture.set(bestId, bestN - 1);
    return true;
  };

  for (const s of silent) {
    if (!takeOne()) break;
    if (s.pool === "calm") calm.set(s.id, 1);
    else if (s.pool === "flow") flow.set(s.id, 1);
    else if (s.pool === "osc") osc.set(s.id, 1);
    else if (s.pool === "texture") texture.set(s.id, 1);
  }
}

/**
 * Area-proportional concurrent shares. Every confirmed calm / flow / osc /
 * static colour group gets at least one seat; leftovers among calm are
 * redistributed by largest remainder. Leftovers must never be donated to chaos.
 */
function allocateShares(
  obs: FieldObservation,
  budget: number,
  nCells: number,
): {
  calm: Map<number, number>;
  chaos: number;
  texture: Map<number, number>;
  osc: Map<number, number>;
  flow: Map<number, number>;
} {
  const calm = new Map<number, number>();
  const osc = new Map<number, number>();
  const flow = new Map<number, number>();
  const texture = new Map<number, number>();
  let assigned = 0;
  /** Fractional remainders for largest-remainder redistribution. */
  const calmRemainders: { id: number; frac: number; area: number }[] = [];
  for (const r of obs.coherent) {
    const exact = (budget * r.area) / nCells;
    // Confirmed regions always speak — minRegionArea already culled dust.
    const share = Math.max(1, Math.floor(exact));
    calm.set(r.id, share);
    assigned += share;
    calmRemainders.push({ id: r.id, frac: exact - share, area: r.area });
  }
  let oscFromArea = 0;
  for (const g of obs.oscillators ?? []) {
    const exact = (budget * g.area) / nCells;
    const share = Math.max(1, Math.floor(exact));
    osc.set(g.period, (osc.get(g.period) ?? 0) + share);
    oscFromArea += share;
  }
  let flowFromArea = 0;
  for (const f of obs.flows ?? []) {
    const exact = (budget * f.regionArea) / nCells;
    const share = Math.max(1, Math.floor(exact));
    flow.set(f.id, (flow.get(f.id) ?? 0) + share);
    flowFromArea += share;
  }

  const texGroups =
    obs.texturedGroups && obs.texturedGroups.length > 0
      ? obs.texturedGroups
      : obs.textured?.area
        ? [
            {
              id: -1,
              area: obs.textured.area,
            },
          ]
        : [];
  let textureFromArea = 0;
  for (const g of texGroups) {
    const exact = (budget * g.area) / nCells;
    const share = Math.max(1, Math.floor(exact));
    texture.set(g.id, share);
    textureFromArea += share;
  }

  const chaosFromArea = Math.max(
    0,
    Math.round((budget * obs.chaotic.area) / nCells),
  );
  const stableAssigned =
    assigned + textureFromArea + oscFromArea + flowFromArea;
  if (stableAssigned + chaosFromArea > budget && stableAssigned > 0) {
    const roomForStable = budget - Math.min(chaosFromArea, budget);
    const claims: StableClaim[] = [];
    for (const r of obs.coherent) {
      claims.push({
        pool: "calm",
        id: r.id,
        exact: (budget * r.area) / nCells,
        area: r.area,
      });
    }
    const oscAreaByPeriod = new Map<number, number>();
    for (const g of obs.oscillators ?? []) {
      oscAreaByPeriod.set(
        g.period,
        (oscAreaByPeriod.get(g.period) ?? 0) + g.area,
      );
    }
    for (const [period, area] of oscAreaByPeriod) {
      claims.push({
        pool: "osc",
        id: period,
        exact: (budget * area) / nCells,
        area,
      });
    }
    for (const f of obs.flows ?? []) {
      claims.push({
        pool: "flow",
        id: f.id,
        exact: (budget * f.regionArea) / nCells,
        area: f.regionArea,
      });
    }
    for (const g of texGroups) {
      claims.push({
        pool: "texture",
        id: g.id,
        exact: (budget * g.area) / nCells,
        area: g.area,
      });
    }
    const filled = hamiltonSeats(claims, roomForStable);
    for (const id of calm.keys()) calm.set(id, 0);
    for (const id of osc.keys()) osc.set(id, 0);
    for (const id of flow.keys()) flow.set(id, 0);
    for (const id of texture.keys()) texture.set(id, 0);
    for (const p of filled) {
      if (p.seats <= 0) continue;
      if (p.pool === "calm") calm.set(p.id, p.seats);
      else if (p.pool === "osc") osc.set(p.id, p.seats);
      else if (p.pool === "flow") flow.set(p.id, p.seats);
      else texture.set(p.id, p.seats);
    }
    stealQuarterSeats(calm, flow, osc, texture, claims);
    let sum = 0;
    for (const n of texture.values()) sum += n;
    for (const n of calm.values()) sum += n;
    for (const n of osc.values()) sum += n;
    for (const n of flow.values()) sum += n;
    return {
      calm,
      osc,
      flow,
      texture,
      chaos: Math.min(chaosFromArea, Math.max(0, budget - sum)),
    };
  }
  const textureCapped = Math.min(
    textureFromArea,
    Math.max(0, budget - assigned - oscFromArea - flowFromArea),
  );
  if (textureCapped < textureFromArea && textureFromArea > 0) {
    const scale = textureCapped / textureFromArea;
    let sum = 0;
    for (const [id, s] of texture) {
      const ns = Math.max(0, Math.floor(s * scale));
      texture.set(id, ns);
      sum += ns;
    }
    let leftover = textureCapped - sum;
    if (leftover > 0) {
      let bestId = Number.NaN;
      let best = -1;
      for (const [id, s] of texture) {
        if (s > best) {
          best = s;
          bestId = id;
        }
      }
      if (!Number.isNaN(bestId)) {
        texture.set(bestId, (texture.get(bestId) ?? 0) + leftover);
      }
    }
  }
  const flowCapped = Math.min(
    flowFromArea,
    Math.max(0, budget - assigned - oscFromArea - textureCapped),
  );
  if (flowCapped < flowFromArea && flowFromArea > 0) {
    const scale = flowCapped / flowFromArea;
    let sum = 0;
    for (const [id, s] of flow) {
      const ns = Math.max(0, Math.floor(s * scale));
      flow.set(id, ns);
      sum += ns;
    }
    let leftover = flowCapped - sum;
    if (leftover > 0) {
      let bestId = -1;
      let best = -1;
      for (const [id, s] of flow) {
        if (s > best) {
          best = s;
          bestId = id;
        }
      }
      if (bestId >= 0) flow.set(bestId, (flow.get(bestId) ?? 0) + leftover);
    }
  }
  let chaos = Math.min(
    chaosFromArea,
    Math.max(0, budget - assigned - oscFromArea - textureCapped - flowCapped),
  );
  let used = assigned + oscFromArea + textureCapped + flowCapped + chaos;
  if (used < budget && calmRemainders.length > 0) {
    calmRemainders.sort((a, b) => b.frac - a.frac || b.area - a.area);
    let i = 0;
    while (used < budget && i < calmRemainders.length * 4) {
      const entry = calmRemainders[i % calmRemainders.length]!;
      calm.set(entry.id, (calm.get(entry.id) ?? 0) + 1);
      used += 1;
      i += 1;
    }
  }
  return {
    calm,
    osc,
    flow,
    texture,
    chaos,
  };
}

function desiredCalmConcurrent(region: CoherentRegion, share: number): number {
  if (share <= 0) return 0;
  const k = clamp01(region.meanCoherence);
  // Overlap ∝ κ̄ × size: κ shapes how the share is spent, never how much of it.
  return Math.max(1, Math.min(SCHED.maxCalmConcurrent, Math.round(share * (0.35 + 0.65 * k))));
}

/** Packing-first calm rate: sustain overlap; δ̄ nudges within a band. */
function calmPackRateHz(packHz: number, meanDelta: number): number {
  const t = clamp01(meanDelta / SCHED.deltaRateNorm);
  const scale = SCHED.calmPackRateMin + (1 - SCHED.calmPackRateMin) * t;
  return Math.max(0.05, packHz * scale);
}

/** Pack-to-share chaos rate: pure δ-proportional; hard-capped (V4.2). */
function chaosPackRateHz(packHz: number, meanDelta: number): number {
  const t = clamp01(meanDelta / SCHED.deltaRateNorm);
  const scale = t; // no floor — δ̄→0 → silence
  return Math.min(SCHED.CHAOS_EVENTS_MAX_HZ, packHz * scale);
}

/**
 * Log-area size ∈ [0,1]. Speck → 0, full field → 1. area ≤ 0 → 0 (tight).
 * Shared by duration (with fill).
 */
function areaT(area: number, nCells: number): number {
  if (area <= 0) return 0;
  const minArea = FIELD_OBS.minRegionArea;
  return clamp01(
    Math.log2(Math.max(2, area / minArea)) /
      Math.log2(Math.max(2, nCells / minArea)),
  );
}

/** Same log span as the worklet Y→frequency law (12000/80). */
const FILT_RATIO = 12000 / 80;

/**
 * Bandpass Q from a structure's vertical extent.
 * r = 150^(Δy), Q = √r/(r−1). One row ≈ 25.5; half grid ≈ 0.31.
 * Capped by how many cycles a grain of this length can carry at fc.
 */
function qFromVerticalExtent(
  heightCells: number,
  gridH: number,
  durationSec: number,
  yNorm: number,
): number {
  const dy = Math.max(1, heightCells) / Math.max(1, gridH - 1);
  const r = Math.pow(FILT_RATIO, dy);
  let q =
    r <= 1 + 1e-9 ? SCHED.Q_MAX : Math.sqrt(r) / (r - 1);
  q = clamp(q, SCHED.Q_MIN, SCHED.Q_MAX);
  const fc = 80 * Math.pow(FILT_RATIO, clamp01(yNorm));
  const cycleCeiling = Math.max(1, durationSec * fc);
  return Math.min(q, cycleCeiling);
}

/**
 * Time law only: order → duration/envelope. Q comes from vertical extent.
 */
function grainMaterial(
  delta: number,
  area: number,
  fillT: number,
  nCells: number,
): GrainMaterial {
  const stabilityT = 1 - clamp01(delta / SCHED.deltaRateNorm);
  const fillRatio = clamp01(fillT);
  // area=0 for bag/per-cell spawns: a bag is not a coherent extent, so its
  // area must not lengthen its grains. Fill weights duration only.
  const sizeForDur = areaT(area, nCells) * (0.7 + 0.3 * fillRatio);
  const order = clamp01(0.65 * stabilityT + 0.35 * sizeForDur);
  const durationSec =
    SCHED.DUR_MIN * Math.pow(SCHED.DUR_MAX / SCHED.DUR_MIN, order);
  const s = smoothstep01(order);
  return {
    order,
    durationSec,
    attackFrac: lerp(SCHED.ATT_MIN, SCHED.ATT_MAX, s),
    releaseFrac: lerp(SCHED.REL_CHAOS, SCHED.REL_CALM, s),
    q: SCHED.Q_MIN,
  };
}

function materialFromRegion(
  region: CoherentRegion,
  nCells: number,
): GrainMaterial {
  return grainMaterial(
    region.meanDelta,
    region.area,
    region.fillRatio ?? 1,
    nCells,
  );
}

/** Representative chaos duration from bag means (for packing rate). */
function durationChaosMean(chaotic: ChaosSpendBag, nCells: number): number {
  // Chaos bag: areaT = 0 (not a coherent extent).
  return grainMaterial(chaotic.meanDelta, 0, 0, nCells).durationSec;
}

function materialFromTexture(
  textured: TexturedArea | TexturedGroup,
  nCells: number,
): GrainMaterial {
  return grainMaterial(textured.meanDelta, textured.area, 1, nCells);
}

function spawnOsc(
  group: OscillatorGroup,
  obs: FieldObservation,
  rgb: RgbField,
  amplitude: number,
  bankDur: number,
  _dtSec: number,
  segments: MaterialSegment[],
  stepSec = 1 / SCHED.stepsPerSec,
): GrainSpawnEvent {
  const w = obs.width;
  const h = obs.height;
  const cells = group.cells;
  const ci =
    cells.length > 0 ? cells[(Math.random() * cells.length) | 0]! : 0;
  const x = ci % w;
  const y = (ci / w) | 0;
  const r = rgb.r[ci] ?? group.meanR;
  const g = rgb.g[ci] ?? group.meanG;
  const b = rgb.b[ci] ?? group.meanB;
  // Period in steps × measured step interval — pulses lock to the *visual*
  // period even when the CA is not running at the nominal 30 steps/s.
  const periodSec = group.period * stepSec;
  const durationSec = Math.max(SCHED.DUR_MIN, SCHED.OSC_DUTY * periodSec);
  const win = sampleWindowFromColour(r, g, b, bankDur, segments);
  const yNorm = 1 - y / Math.max(1, h - 1);
  const q = qFromVerticalExtent(1, h, durationSec, yNorm);
  return {
    x,
    y,
    r,
    g,
    b,
    durationSec,
    amplitude,
    direction: 1,
    sampleCenter: win.sampleCenter,
    sampleHalf: win.sampleHalf,
    // Onset spread inside the perceptual fusion window (~20–30 ms), capped
    // at 15 ms so a large simultaneous burst still reads as one attack.
    startOffsetSec: Math.random() * Math.min(0.15 * periodSec, 0.015),
    q,
    yNorm,
    channelMix: channelMixFromX(x, w),
    pan: panFromX(x, w),
    // Owner likes how blinkers sound — leave this envelope alone; do not
    // harmonise with the continuous ATT/REL law.
    attackFrac: 0.04,
    releaseFrac: 0.2,
    regime: "osc",
    regionId: -1,
    trackDx: 0,
    trackDy: 0,
    readOffset: Math.random() * 2 - 1,
  };
}

function spawnTexture(
  textured: TexturedGroup,
  obs: FieldObservation,
  _rgb: RgbField,
  amplitude: number,
  mat: GrainMaterial,
  bankDur: number,
  dtSec: number,
  segments: MaterialSegment[],
  siteSlot = 0,
  mask: Uint32Array = EMPTY_MASK,
  maskStamp = 0,
): GrainSpawnEvent {
  const w = obs.width;
  const h = obs.height;
  const cells = textured.cells;
  const site = pickStratifiedSite(
    siteSlot,
    SCHED.SITE_SALT_TEXTURE,
    textured.colourSpread,
    textured.comX,
    textured.comY,
    textured.width / 2,
    textured.height / 2,
    w,
    h,
    mask,
    maskStamp,
  );
  const ci =
    site.ci >= 0
      ? site.ci
      : cells.length > 0
        ? cells[Math.min(cells.length - 1, (site.fallbackU * cells.length) | 0)]!
        : 0;
  const x = ci % w;
  const y = (ci / w) | 0;
  // Group mean colour → one material window for the whole frozen voice.
  const r = textured.meanR;
  const g = textured.meanG;
  const b = textured.meanB;
  const win = sampleWindowFromColour(r, g, b, bankDur, segments);
  const yNorm = 1 - textured.comY / Math.max(1, h - 1);
  const q = qFromVerticalExtent(
    textured.height,
    h,
    mat.durationSec,
    yNorm,
  );
  return {
    x,
    y,
    r,
    g,
    b,
    durationSec: mat.durationSec,
    amplitude,
    direction: 1,
    sampleCenter: win.sampleCenter,
    sampleHalf: win.sampleHalf,
    startOffsetSec: Math.random() * dtSec,
    q,
    yNorm,
    channelMix: channelMixFromX(textured.comX, w),
    pan: panFromX(textured.comX, w),
    attackFrac: mat.attackFrac,
    releaseFrac: mat.releaseFrac,
    regime: "texture",
    regionId: TEXTURE_ID_BASE + textured.id,
    trackDx: 0,
    trackDy: 0,
    readOffset: sustainedReadOffset(site.readOffset, win, bankDur),
    siteSlot,
  };
}

/** Spawn/follow anchor: true COM when concentrated, else stable grid centre. */
function regionAnchor(
  region: CoherentRegion,
  obs: FieldObservation,
  lock?: { xCenter: boolean; yCenter: boolean },
): { x: number; y: number } {
  const w = obs.width;
  const h = obs.height;
  const enter = SCHED.SPAWN_ANCHOR_R_MIN - 0.08;
  const leave = SCHED.SPAWN_ANCHOR_R_MIN + 0.08;
  let xCenter: boolean;
  let yCenter: boolean;
  if (lock) {
    xCenter = lock.xCenter;
    yCenter = lock.yCenter;
    if (region.width >= w) xCenter = true;
    else if (region.width <= w - 3 && region.comConcX > leave) xCenter = false;
    else if (region.comConcX < enter) xCenter = true;
    if (region.height >= h) yCenter = true;
    else if (region.height <= h - 3 && region.comConcY > leave) yCenter = false;
    else if (region.comConcY < enter) yCenter = true;
    lock.xCenter = xCenter;
    lock.yCenter = yCenter;
  } else {
    xCenter = region.width >= w || region.comConcX < SCHED.SPAWN_ANCHOR_R_MIN;
    yCenter = region.height >= h || region.comConcY < SCHED.SPAWN_ANCHOR_R_MIN;
  }
  return {
    x: xCenter ? (w - 1) / 2 : region.comX,
    y: yCenter ? (h - 1) / 2 : region.comY,
  };
}

function spawnCalm(
  region: CoherentRegion,
  obs: FieldObservation,
  rgb: RgbField,
  amplitude: number,
  mat: GrainMaterial,
  bankDur: number,
  dtSec: number,
  segments: MaterialSegment[],
  siteSlot = 0,
  mask: Uint32Array = EMPTY_MASK,
  maskStamp = 0,
  anchorX = (obs.width - 1) / 2,
  anchorY = (obs.height - 1) / 2,
): GrainSpawnEvent {
  const w = obs.width;
  let ci: number;
  let readOffset: number;
  if (region.cells.length === 0) {
    const cx = Math.floor(region.comX) % w;
    const cy = Math.floor(region.comY) % obs.height;
    ci = cy * w + cx;
    readOffset = 0;
  } else {
    // Shape-true: stratified slot site snapped onto the membership mask.
    const site = pickStratifiedSite(
      siteSlot,
      SCHED.SITE_SALT_CALM,
      region.colourSpread,
      anchorX,
      anchorY,
      region.width / 2,
      region.height / 2,
      w,
      obs.height,
      mask,
      maskStamp,
    );
    ci =
      site.ci >= 0
        ? site.ci
        : region.cells[
            Math.min(
              region.cells.length - 1,
              (site.fallbackU * region.cells.length) | 0,
            )
          ]!;
    readOffset = site.readOffset;
  }
  return spawnCalmAt(
    region,
    obs,
    rgb,
    amplitude,
    mat,
    bankDur,
    dtSec,
    ci,
    segments,
    readOffset,
    siteSlot,
    anchorX,
    anchorY,
  );
}

function spawnCalmAt(
  region: CoherentRegion,
  obs: FieldObservation,
  rgb: RgbField,
  amplitude: number,
  mat: GrainMaterial,
  bankDur: number,
  dtSec: number,
  ci: number,
  segments: MaterialSegment[],
  readOffset = 0,
  siteSlot = 0,
  anchorX = (obs.width - 1) / 2,
  anchorY = (obs.height - 1) / 2,
): GrainSpawnEvent {
  const w = obs.width;
  const h = obs.height;
  const cx = ci % w;
  const cy = (ci / w) | 0;

  const r = rgb.r[ci] ?? region.meanR;
  const g = rgb.g[ci] ?? region.meanG;
  const b = rgb.b[ci] ?? region.meanB;
  const win = sampleWindowFromColour(r, g, b, bankDur, segments);
  const yNorm = 1 - cy / Math.max(1, h - 1);
  const q = qFromVerticalExtent(
    region.height,
    h,
    mat.durationSec,
    yNorm,
  );

  // Offset from the same anchor used for spawn placement (not raw COM).
  const trackDx = toroidalOffset(cx, anchorX, w);
  const trackDy = toroidalOffset(cy, anchorY, h);

  return {
    x: cx,
    y: cy,
    r,
    g,
    b,
    durationSec: mat.durationSec,
    amplitude,
    direction: region.velX < -SCHED.velDirEps ? -1 : 1,
    sampleCenter: win.sampleCenter,
    sampleHalf: win.sampleHalf,
    startOffsetSec: Math.random() * dtSec,
    q,
    yNorm,
    channelMix: channelMixFromX(cx, w),
    pan: panFromX(cx, w),
    attackFrac: mat.attackFrac,
    releaseFrac: mat.releaseFrac,
    regime: "calm",
    regionId: region.id,
    trackDx,
    trackDy,
    readOffset: sustainedReadOffset(readOffset, win, bankDur),
    siteSlot,
  };
}

function spawnChaos(
  chaotic: ChaosSpendBag,
  obs: FieldObservation,
  rgb: RgbField,
  amplitude: number,
  bankDur: number,
  dtSec: number,
  segments: MaterialSegment[],
  meanDur: number,
  bagMeanDelta: number,
): GrainSpawnEvent {
  const w = obs.width;
  const h = obs.height;
  const ci = pickChaosCell(chaotic, obs);
  const x = ci % w;
  const y = (ci / w) | 0;
  const r = rgb.r[ci] ?? 0.5;
  const g = rgb.g[ci] ?? 0.5;
  const b = rgb.b[ci] ?? 0.5;
  // Envelope from smoothed δ (regime plane); duration spray from raw δ so
  // saturated scramble still has a lifetime distribution (blur flattens).
  const deltaSmooth = obs.deltaSmooth?.[ci] ?? obs.delta[ci] ?? chaotic.meanDelta;
  const deltaRaw = obs.delta[ci] ?? deltaSmooth;
  const nCells = w * h;
  const mat = grainMaterial(deltaSmooth, 0, 0, nCells);
  const durationSec = chaosDurationAroundMean(meanDur, bagMeanDelta, deltaRaw);
  const win = sampleWindowFromColour(r, g, b, bankDur, segments);
  const yNorm = 1 - y / Math.max(1, h - 1);
  const q = qFromVerticalExtent(1, h, durationSec, yNorm);

  return {
    x,
    y,
    r,
    g,
    b,
    durationSec,
    amplitude,
    direction: 1,
    sampleCenter: win.sampleCenter,
    sampleHalf: win.sampleHalf,
    startOffsetSec: Math.random() * dtSec,
    q,
    yNorm,
    channelMix: channelMixFromX(x, w),
    pan: panFromX(x, w),
    attackFrac: mat.attackFrac,
    releaseFrac: mat.releaseFrac,
    regime: "chaos",
    regionId: -1,
    trackDx: 0,
    trackDy: 0,
    readOffset: Math.random() * 2 - 1,
  };
}

/**
 * Mean-preserving duration spray: hotter cells shorter, cooler longer.
 * Packing rate still uses durationChaosMean — this only unsyncs deaths.
 */
function chaosDurationAroundMean(
  meanDur: number,
  bagMeanDelta: number,
  cellDelta: number,
): number {
  const bag = Math.max(1e-6, bagMeanDelta);
  const cell = Math.max(1e-6, cellDelta);
  const spread = SCHED.CHAOS_DUR_SPREAD;
  const ratio = Math.pow(bag / cell, SCHED.CHAOS_DUR_EXP);
  const scale = Math.max(1 / spread, Math.min(spread, ratio));
  return Math.max(SCHED.DUR_MIN / spread, meanDur * scale);
}

/**
 * Mean-preserving flow duration spray: hotter cells shorter, cooler longer.
 * Packing rate still uses unsprayed flowConveyorDuration. Travel-time cap
 * (when it applies) is an upper bound so conveyor grains die near the lead.
 */
function flowDurationAroundMean(
  meanDur: number,
  flowMeanDelta: number,
  cellDelta: number,
  travelCapSec?: number,
): number {
  const bag = Math.max(1e-6, flowMeanDelta);
  const cell = Math.max(1e-6, cellDelta);
  const spread = SCHED.FLOW_DUR_SPREAD;
  const ratio = Math.pow(bag / cell, SCHED.FLOW_DUR_EXP);
  const scale = Math.max(1 / spread, Math.min(spread, ratio));
  let dur = Math.max(SCHED.DUR_MIN / spread, meanDur * scale);
  if (travelCapSec != null) dur = Math.min(dur, travelCapSec);
  return dur;
}

function meanRawDelta(cells: Uint32Array, delta: Float32Array): number {
  const n = cells.length;
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += delta[cells[i]!] ?? 0;
  return sum / n;
}

/** Member cells / dilated patch — dense pack → 1, thin stream → lower. */
function flowPackT(flow: FlowGroup): number {
  return clamp01(flow.area / Math.max(1, flow.regionArea));
}

/** Mid-band timeOrder from packing density (not chaos δ, not calm area growth). */
function flowTimeOrder(flow: FlowGroup): number {
  return lerp(SCHED.FLOW_ORDER_MIN, SCHED.FLOW_ORDER_MAX, flowPackT(flow));
}

/**
 * Trailing / leading edges along hop heading. Trailing = start of motion
 * (spawn); leading = end (grain dies). Ordered cells: trailing → leading.
 * Projection is toroidal about COM so a pack that straddles the seam keeps
 * a 3-cell length instead of inverting trail/lead across the whole grid.
 */
function flowHeadingEdges(
  flow: FlowGroup,
  w: number,
  h: number,
): {
  trailX: number;
  trailY: number;
  leadX: number;
  leadY: number;
  length: number;
  ordered: number[];
} {
  const cells = Array.from(flow.cells);
  const speed = Math.hypot(flow.velX, flow.velY);
  if (cells.length === 0) {
    return {
      trailX: flow.comX,
      trailY: flow.comY,
      leadX: flow.comX,
      leadY: flow.comY,
      length: 1,
      ordered: [],
    };
  }
  if (speed < 1e-4) {
    return {
      trailX: flow.comX,
      trailY: flow.comY,
      leadX: flow.comX,
      leadY: flow.comY,
      length: Math.max(1, Math.sqrt(flow.regionArea)),
      ordered: cells,
    };
  }
  const hx = flow.velX / speed;
  const hy = flow.velY / speed;
  const scored = cells.map((ci) => {
    const x = ci % w;
    const y = (ci / w) | 0;
    const dx = toroidalOffset(x, flow.comX, w);
    const dy = toroidalOffset(y, flow.comY, h);
    return { ci, x, y, proj: dx * hx + dy * hy };
  });
  scored.sort((a, b) => a.proj - b.proj);
  const trail = scored[0]!;
  const lead = scored[scored.length - 1]!;
  let length = lead.proj - trail.proj;
  if (length < 1) length = Math.max(1, scored.length);
  return {
    trailX: trail.x,
    trailY: trail.y,
    leadX: lead.x,
    leadY: lead.y,
    length,
    ordered: scored.map((s) => s.ci),
  };
}

function flowTravelCapSec(
  flow: FlowGroup,
  dtSec: number,
  streamLength: number,
): number | undefined {
  const speed = Math.hypot(flow.velX, flow.velY);
  if (speed < 0.15 || SCHED.FLOW_TRAVEL_DUR_BLEND <= 0) return undefined;
  const travelSteps = Math.max(1, streamLength / speed);
  return travelSteps * Math.max(1e-3, dtSec);
}

/** Packing mid-band duration, capped by stream travel time (conveyor). */
function flowConveyorDuration(
  flow: FlowGroup,
  dtSec: number,
  streamLength: number,
): number {
  const packDur = durationFromTimeOrder(flowTimeOrder(flow));
  const travelSec = flowTravelCapSec(flow, dtSec, streamLength);
  if (travelSec == null) return packDur;
  const lo = SCHED.DUR_MIN;
  const hi = packDur;
  const capped = Math.min(hi, Math.max(lo, travelSec));
  return lerp(packDur, capped, clamp01(SCHED.FLOW_TRAVEL_DUR_BLEND));
}

/**
 * Flow piece-grain: trailing-edge member, packing→mid envelope, follows hop
 * conveyor via trackDx/Dy against the hop-integrated follow anchor.
 */
function spawnFlow(
  flow: FlowGroup,
  ci: number,
  obs: FieldObservation,
  rgb: RgbField,
  amplitude: number,
  bankDur: number,
  dtSec: number,
  segments: MaterialSegment[],
  followX: number,
  followY: number,
  durationSec: number,
): GrainSpawnEvent {
  const w = obs.width;
  const h = obs.height;
  const x = ci % w;
  const y = (ci / w) | 0;
  const r = rgb.r[ci] ?? flow.meanR;
  const g = rgb.g[ci] ?? flow.meanG;
  const b = rgb.b[ci] ?? flow.meanB;
  const order = flowTimeOrder(flow);
  const s = smoothstep01(order);
  const attackFrac = lerp(SCHED.ATT_MIN, SCHED.ATT_MAX, s);
  const releaseFrac = lerp(SCHED.REL_CHAOS, SCHED.REL_CALM, s);
  const win = sampleWindowFromColour(r, g, b, bankDur, segments);
  const yNorm = 1 - y / Math.max(1, h - 1);
  const flowHeight = flowVerticalExtent(flow, w, h);
  const q = qFromVerticalExtent(flowHeight, h, durationSec, yNorm);
  const trackDx = toroidalOffset(x, followX, w);
  const trackDy = toroidalOffset(y, followY, h);

  return {
    x,
    y,
    r,
    g,
    b,
    durationSec,
    amplitude,
    direction: flow.velX < -SCHED.velDirEps ? -1 : 1,
    sampleCenter: win.sampleCenter,
    sampleHalf: win.sampleHalf,
    startOffsetSec: Math.random() * dtSec,
    q,
    yNorm,
    channelMix: channelMixFromX(x, w),
    pan: panFromX(x, w),
    attackFrac,
    releaseFrac,
    regime: "flow",
    regionId: FLOW_ID_BASE + flow.id,
    trackDx,
    trackDy,
    readOffset: Math.random() * 2 - 1,
  };
}

function durationFromTimeOrder(order: number): number {
  const o = clamp01(order);
  return SCHED.DUR_MIN * Math.pow(SCHED.DUR_MAX / SCHED.DUR_MIN, o);
}

/** Toroidal Y span of a flow's member cells (≥1). */
function flowVerticalExtent(flow: FlowGroup, w: number, h: number): number {
  const cells = flow.cells;
  if (cells.length === 0) return 1;
  let minDy = 0;
  let maxDy = 0;
  for (let c = 0; c < cells.length; c++) {
    const i = cells[c]!;
    const y = (i / w) | 0;
    const dy = toroidalDelta(y, flow.comY, h);
    if (c === 0) {
      minDy = maxDy = dy;
    } else {
      if (dy < minDy) minDy = dy;
      if (dy > maxDy) maxDy = dy;
    }
  }
  return Math.max(1, maxDy - minDy + 1);
}

/** δ-weighted rejection sampling over the chaos bag (uses smoothed δ). */
function pickChaosCell(chaotic: ChaosSpendBag, obs: FieldObservation): number {
  const cells = chaotic.cells;
  if (cells.length === 0) return 0;
  const bagMax = Math.max(1e-4, chaotic.maxDelta);
  const dPlane = obs.deltaSmooth ?? obs.delta;
  let last = cells[(Math.random() * cells.length) | 0]!;
  for (let t = 0; t < 8; t++) {
    const ci = cells[(Math.random() * cells.length) | 0]!;
    last = ci;
    if (Math.random() < (dPlane[ci] ?? 0) / bagMax) return ci;
  }
  return last;
}

/** Hue [0,1] from RGB; undefined hue (grey) → 0.5 (legacy helper). */
export function rgbToHueNorm(r: number, g: number, b: number): number {
  const { h, s } = rgbToHsv(r, g, b);
  return s < 1e-6 ? 0.5 : h;
}

/**
 * HSV → polar material centre + real slice bounds as the sample window.
 * Window width comes from the segment itself, not from region area.
 */
function sampleWindowFromColour(
  r: number,
  g: number,
  b: number,
  bankDur: number,
  segments: MaterialSegment[],
): { sampleCenter: number; sampleHalf: number; startPos: number; endPos: number } {
  const { h, s, v } = rgbToHsv(r, g, b);
  const mat = queryMaterialFromHsv(segments, h, s, v);
  const start = clamp01(mat.startPos);
  const end = clamp01(mat.endPos);
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  const absFloor = SCHED.WINDOW_HALF_ABS_MIN_S / Math.max(1e-3, bankDur);
  let half = Math.max(absFloor, (hi - lo) * 0.5);
  half = Math.min(0.49, half);
  const center = clamp01((lo + hi) * 0.5);
  return {
    sampleCenter: center,
    sampleHalf: Math.max(1e-4, half),
    startPos: lo,
    endPos: hi,
  };
}

/**
 * Map a full-window readOffset ∈ [-1,1] so calm/texture stay past the onset.
 * Skip the first ~80 ms (or 25% of a shorter window), then span the remainder.
 */
function sustainedReadOffset(
  rawOffset: number,
  win: { sampleCenter: number; sampleHalf: number },
  bankDur: number,
): number {
  const half = Math.max(1e-6, win.sampleHalf);
  const windowSec = 2 * half * bankDur;
  const skipSec = Math.min(
    SCHED.SUSTAINED_ONSET_SKIP_S,
    0.25 * windowSec,
  );
  const skipNorm = skipSec / Math.max(1e-6, windowSec); // fraction of full width
  // Window spans [-1,1] in readOffset; onset is at -1.
  const lo = -1 + 2 * skipNorm;
  const hi = 1;
  const t = (clamp(rawOffset, -1, 1) + 1) * 0.5; // 0..1
  return lo + t * (hi - lo);
}

function panFromX(x: number, width: number): number {
  const t = x / Math.max(1, width - 1);
  return Math.max(-1, Math.min(1, t * 2 - 1));
}

/** Source L/R mix from grid X: 0 = left channel, 1 = right. */
export function channelMixFromX(x: number, width: number): number {
  return clamp01(x / Math.max(1, width - 1));
}

const EMPTY_MASK = new Uint32Array(0);

/**
 * Small deterministic PRNG (copied from TestPatterns — that module is
 * test-only and must not be imported by the live pipeline).
 */
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

/** Box–Muller pair, radius clamped so a slot cannot fly across the torus. */
function slotOffset(rand: () => number): [number, number] {
  const u1 = Math.max(1e-9, rand());
  const u2 = rand();
  const r = Math.min(SCHED.SPAWN_SLOT_Z_MAX, Math.sqrt(-2 * Math.log(u1)));
  return [r * Math.cos(2 * Math.PI * u2), r * Math.sin(2 * Math.PI * u2)];
}

function wrapInt(v: number, period: number): number {
  const m = v % period;
  return m < 0 ? m + period : m;
}

/** Nearest mask cell to (tx,ty) by outward toroidal ring search; -1 on miss. */
function snapToMask(
  tx: number,
  ty: number,
  w: number,
  h: number,
  mask: Uint32Array,
  stamp: number,
): number {
  const i0 = ty * w + tx;
  if (mask[i0] === stamp) return i0;
  const maxR = Math.min(
    SCHED.SPAWN_SNAP_MAX_RING,
    Math.max(w >> 1, h >> 1),
  );
  for (let r = 1; r <= maxR; r++) {
    let best = -1;
    let bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      const edgeRow = dy === -r || dy === r;
      const y = wrapInt(ty + dy, h);
      for (let dx = -r; dx <= r; dx++) {
        if (!edgeRow && dx !== -r && dx !== r) continue;
        const x = wrapInt(tx + dx, w);
        const i = y * w + x;
        if (mask[i] !== stamp) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

/**
 * Stratified spawn site for slot j (calm/texture pools only).
 *
 * The site is a fixed offset from the pool's anchor, scaled by the pool's
 * measured internal diversity, snapped onto its membership mask. Seeded by
 * `salt + slot` and nothing else — no frame counter, no time, no Math.random —
 * so a frozen field resolves to the same sites every frame. One stream per
 * spawn, drawn in a fixed order so the read offset is stable for the slot too.
 *
 * Returns ci = -1 when the ring search found no member; the caller then falls
 * back to `cells[floor(fallbackU * len)]` from this same stream.
 */
function pickStratifiedSite(
  slot: number,
  salt: number,
  colourSpread: number,
  anchorX: number,
  anchorY: number,
  halfWidth: number,
  halfHeight: number,
  w: number,
  h: number,
  mask: Uint32Array,
  stamp: number,
): { ci: number; fallbackU: number; readOffset: number } {
  const rand = mulberry32((salt + slot) >>> 0);
  const spreadT = Math.min(
    1,
    Math.max(
      SCHED.SPAWN_SPREAD_MIN,
      colourSpread / SCHED.SPAWN_SPREAD_FULL,
    ),
  );
  const sigmaX = Math.max(1, spreadT * halfWidth);
  const sigmaY = Math.max(1, spreadT * halfHeight);
  const [ox, oy] = slotOffset(rand);
  const tx = wrapInt(Math.round(anchorX + ox * sigmaX), w);
  const ty = wrapInt(Math.round(anchorY + oy * sigmaY), h);
  const ci = snapToMask(tx, ty, w, h, mask, stamp);
  const fallbackU = ci < 0 ? rand() : 0;
  return { ci, fallbackU, readOffset: rand() * 2 - 1 };
}

/** Shortest signed toroidal offset from COM to cell (cells). */
function toroidalOffset(cell: number, com: number, period: number): number {
  let d = cell - com;
  if (d > period * 0.5) d -= period;
  if (d < -period * 0.5) d += period;
  return d;
}

function resolveAlias(id: number, aliases: Map<number, number>): number {
  let target = id;
  for (let hops = 0; aliases.has(target) && hops < 8; hops++) {
    target = aliases.get(target)!;
  }
  return target;
}

function countActiveSeat(
  active: ActiveRecord[],
  regime: GrainRegime,
  seatId: number,
  aliases?: Map<number, number>,
): number {
  let n = 0;
  for (const a of active) {
    if (a.regime !== regime) continue;
    const id = aliases ? resolveAlias(a.regionId, aliases) : a.regionId;
    if (id === seatId) n++;
  }
  return n;
}

function countEventsRegime(
  events: GrainSpawnEvent[],
  regime: GrainRegime,
): number {
  let n = 0;
  for (const e of events) if (e.regime === regime) n++;
  return n;
}

function countEventsSeat(
  events: GrainSpawnEvent[],
  regime: GrainRegime,
  seatId: number,
): number {
  let n = 0;
  for (const e of events) {
    if (e.regime === regime && e.regionId === seatId) n++;
  }
  return n;
}

function countActiveRegime(
  active: ActiveRecord[],
  regime: GrainRegime,
): number {
  let n = 0;
  for (const a of active) if (a.regime === regime) n++;
  return n;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep01(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
