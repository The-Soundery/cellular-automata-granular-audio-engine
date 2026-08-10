import type {
  ChaoticArea,
  CoherentRegion,
  FieldObservation,
  OscillatorGroup,
  TexturedArea,
} from "./FieldObserver.ts";
import { FIELD_OBS } from "./FieldObserver.ts";
import type { RgbField } from "./FrameObserver.ts";
import {
  identityHueSampleLut,
  sampleCenterFromHue,
} from "../audio/spectral.ts";

/** Negotiable physical budget — raise after listening + CPU check. */
export const GRAIN_BUDGET = 64;
export const MASTER_GAIN = 1.0;

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
  /** Spatial similarity → filter Q (spectral purity). */
  Q_MIN: 0.8,
  Q_MAX: 8.0,
  /** Saturation → window half-width (seconds). */
  WINDOW_HALF_MIN_S: 0.06,
  WINDOW_HALF_MAX_S: 0.8,
  /** Absolute floor on window half-width (seconds) — avoids degenerate ping-pong. */
  WINDOW_HALF_ABS_MIN_S: 0.005,
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
  /** Max grains per oscillator pulse burst. */
  oscBurstMax: 3,
  /** EMA for oscillator phase histogram buckets. */
  oscPhaseEma: 0.2,
  /** File-seconds advanced per real second at full activity (inter-grain scrub). */
  SCRUB_RATE_MAX: 1.0,
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
} as const;

export type GrainRegime = "calm" | "chaos" | "texture" | "osc";

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
}

/** Per-step region COM for direct pan/Y follow (no smoothing). */
export interface RegionTrack {
  regionId: number;
  /** True toroidal COM (kept for harness asserts; follow uses anchor). */
  comX: number;
  comY: number;
  /** Spawn/follow anchor — grid centre when COM is meaningless in that axis. */
  anchorX: number;
  anchorY: number;
  gridWidth: number;
  gridHeight: number;
}

export interface GrainEventBatch {
  masterGain: number;
  gridWidth: number;
  gridHeight: number;
  events: GrainSpawnEvent[];
  tracks: RegionTrack[];
  budget: number;
  predictedActive: number;
  calmActive: number;
  chaosActive: number;
  textureActive: number;
  oscActive: number;
  /** Area-share allocation this step (sum of per-region calm/osc shares). */
  shares: { calm: number; texture: number; chaos: number; osc: number };
}

type ActiveRecord = {
  endMs: number;
  regime: GrainRegime;
  regionId: number;
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
  /** Inter-grain scrub advance (file-seconds); frozen grains keep their window. */
  scrubSec: number;
  /** Next stratified spawn slot for this region (cursor, not ownership). */
  siteSlot: number;
};

type GrainMaterial = {
  order: number;
  durationSec: number;
  attackFrac: number;
  releaseFrac: number;
  q: number;
};

/**
 * Area-weighted ephemeral grain scheduler.
 * Activity shapes rate/length usage; area shapes budget share;
 * loudness stays neutral via equal amplitude + worklet energy norm.
 */
export class GrainScheduler {
  readonly budget: number;
  private active: ActiveRecord[] = [];
  private calmClocks = new Map<number, RegionClock>();
  private chaosAcc = 0;
  private textureAcc = 0;
  private lastStepMs = 0;
  private stepIndex = 0;
  /** Per-period phase histograms for oscillator pulse locking. */
  private oscPhase = new Map<number, Float32Array>();
  /** Textured-pool scrub clock (δ̄≈0 → frozen). */
  private textureScrubSec = 0;
  /** Next stratified spawn slot for the texture bag. */
  private textureSiteSlot = 0;
  /**
   * O(1) pool-membership test for spawn-site snapping. Stamp buffer so a
   * pool's mask never has to be cleared: a cell is a member iff its entry
   * equals the stamp handed out when that pool's mask was written.
   */
  private maskStamp = new Uint32Array(0);
  private maskStampValue = 1;
  /** Source file duration (seconds) for window-in-seconds law. */
  private sourceDurationSec = 1;
  /** Perceptual hue→sample LUT (centroid-sorted); identity until a source loads. */
  private hueSampleLut: Float32Array = identityHueSampleLut();

  constructor(budget = GRAIN_BUDGET) {
    this.budget = budget;
  }

  setSourceDurationSec(durationSec: number): void {
    this.sourceDurationSec = Math.max(1e-3, durationSec);
  }

  setHueSampleLut(lut: Float32Array): void {
    this.hueSampleLut = lut.length >= 2 ? lut : identityHueSampleLut();
  }

  reset(): void {
    this.active = [];
    this.calmClocks.clear();
    this.chaosAcc = 0;
    this.textureAcc = 0;
    this.lastStepMs = 0;
    this.stepIndex = 0;
    this.oscPhase.clear();
    this.textureScrubSec = 0;
    this.textureSiteSlot = 0;
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

    for (const region of obs.coherent) {
      const anchor = regionAnchor(region, obs);
      tracks.push({
        regionId: region.id,
        comX: region.comX,
        comY: region.comY,
        anchorX: anchor.x,
        anchorY: anchor.y,
        gridWidth: obs.width,
        gridHeight: obs.height,
      });

      const share = shares.calm.get(region.id) ?? 0;
      if (share <= 0) continue;

      const desired = desiredCalmConcurrent(region, share);
      const activeHere = this.active.filter((a) => a.regionId === region.id).length;
      let clock = this.calmClocks.get(region.id);
      if (!clock) {
        clock = {
          id: region.id,
          acc: Math.random(),
          phase: Math.random(),
          history: new Float32Array(SCHED.rhythmHistory),
          histLen: 0,
          histWrite: 0,
          periodSec: 0,
          confidence: 0,
          scrubSec: 0,
          siteSlot: 0,
        };
        this.calmClocks.set(region.id, clock);
      }

      clock.scrubSec +=
        dtSec *
        SCHED.SCRUB_RATE_MAX *
        clamp01(region.meanDelta / SCHED.deltaRateNorm);

      pushHistory(clock, region.meanDelta);
      const rhythm = estimatePeriod(clock, dtSec);
      clock.periodSec = rhythm.periodSec;
      clock.confidence = rhythm.confidence;

      const mat = materialFromRegion(region, nCells);
      const packHz = desired / Math.max(0.05, mat.durationSec);
      const baseHz = calmPackRateHz(packHz, region.meanDelta);
      const regionActive = () =>
        activeHere + countEventsForRegion(events, region.id);
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
          this.hueSampleLut,
          clock!.scrubSec,
          slot,
          this.maskStamp,
          calmMaskStamp,
          anchor.x,
          anchor.y,
        );
        events.push(ev);
        this.active.push({
          endMs: nowMs + ev.durationSec * 1000,
          regime: "calm",
          regionId: region.id,
        });
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

      const nBurst = Math.max(
        1,
        Math.min(SCHED.oscBurstMax, share),
      );
      let burst = 0;
      while (
        burst < nBurst &&
        this.active.length < this.budget &&
        countActiveRegime(this.active, "osc") +
          countEventsRegime(events, "osc") <
          share
      ) {
        const ev = spawnOsc(
          group,
          obs,
          rgb,
          amp,
          bankDur,
          dtSec,
          this.hueSampleLut,
        );
        events.push(ev);
        this.active.push({
          endMs: nowMs + ev.durationSec * 1000,
          regime: "osc",
          regionId: -1,
        });
        burst += 1;
      }
    }

    // Texture: long overlapping grains; identity from spawn cell.
    const desiredTexture = shares.texture;
    if (desiredTexture > 0 && obs.textured.cells.length > 0) {
      this.textureScrubSec +=
        dtSec *
        SCHED.SCRUB_RATE_MAX *
        clamp01(obs.textured.meanDelta / SCHED.deltaRateNorm);
      const texMat = materialFromTexture(obs.textured, nCells);
      const texMaskStamp = this.stampPoolMask(obs.textured.cells, nCells);
      const texPackHz = desiredTexture / Math.max(0.05, texMat.durationSec);
      const texRateHz = calmPackRateHz(texPackHz, obs.textured.meanDelta);
      this.textureAcc += texRateHz * dtSec;
      const textureAlready = countActiveRegime(this.active, "texture");
      while (
        this.textureAcc >= 1 &&
        textureAlready + countEventsRegime(events, "texture") <
          desiredTexture &&
        this.active.length < this.budget
      ) {
        this.textureAcc -= 1;
        const texSlot =
          this.textureSiteSlot % Math.max(1, desiredTexture);
        this.textureSiteSlot += 1;
        const ev = spawnTexture(
          obs.textured,
          obs,
          rgb,
          amp,
          texMat,
          bankDur,
          dtSec,
          this.hueSampleLut,
          this.textureScrubSec,
          texSlot,
          this.maskStamp,
          texMaskStamp,
        );
        events.push(ev);
        this.active.push({
          endMs: nowMs + ev.durationSec * 1000,
          regime: "texture",
          regionId: -1,
        });
      }
      if (this.textureAcc > Math.max(3, desiredTexture)) {
        this.textureAcc = Math.max(3, desiredTexture);
      }
    } else {
      this.textureAcc = 0;
    }

    // Chaos pack-to-share: spend area budget as many short concurrent hits.
    const desiredChaos = shares.chaos;
    const chaosDur = durationChaosMean(obs.chaotic, nCells);
    const chaosPackHz = desiredChaos / Math.max(0.02, chaosDur);
    const chaosRateHz = chaosPackRateHz(chaosPackHz, obs.chaotic.meanDelta);
    this.chaosAcc += chaosRateHz * dtSec;
    // Snapshot like calm: grains pushed to active this step must not be
    // double-counted against events (that capped fill at desired/2).
    const chaosAlready = countActiveRegime(this.active, "chaos");

    while (
      this.chaosAcc >= 1 &&
      chaosAlready + countEventsRegime(events, "chaos") < desiredChaos &&
      this.active.length < this.budget &&
      obs.chaotic.cells.length > 0
    ) {
      this.chaosAcc -= 1;
      const ev = spawnChaos(
        obs.chaotic,
        obs,
        rgb,
        amp,
        bankDur,
        dtSec,
        this.hueSampleLut,
      );
      events.push(ev);
      this.active.push({
        endMs: nowMs + ev.durationSec * 1000,
        regime: "chaos",
        regionId: -1,
      });
    }
    // Allow multi-spawn per step at high pack rates; do not stall at 3.
    if (this.chaosAcc > Math.max(3, desiredChaos)) {
      this.chaosAcc = Math.max(3, desiredChaos);
    }

    let calmShareSum = 0;
    for (const s of shares.calm.values()) calmShareSum += s;
    let oscShareSum = 0;
    for (const s of shares.osc.values()) oscShareSum += s;

    return {
      masterGain: MASTER_GAIN,
      gridWidth: obs.width,
      gridHeight: obs.height,
      events,
      tracks,
      budget: this.budget,
      predictedActive: this.active.length,
      calmActive: countActiveRegime(this.active, "calm"),
      chaosActive: countActiveRegime(this.active, "chaos"),
      textureActive: countActiveRegime(this.active, "texture"),
      oscActive: countActiveRegime(this.active, "osc"),
      shares: {
        calm: calmShareSum,
        texture: shares.texture,
        chaos: shares.chaos,
        osc: oscShareSum,
      },
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

/**
 * Area-proportional concurrent shares. Rounding leftovers among calm regions
 * are redistributed by largest remainder so a full-calm field reaches the
 * budget; leftovers must never be donated to chaos.
 */
function allocateShares(
  obs: FieldObservation,
  budget: number,
  nCells: number,
): {
  calm: Map<number, number>;
  chaos: number;
  texture: number;
  osc: Map<number, number>;
} {
  const calm = new Map<number, number>();
  const osc = new Map<number, number>();
  let assigned = 0;
  /** Fractional remainders for largest-remainder redistribution. */
  const calmRemainders: { id: number; frac: number; area: number }[] = [];
  for (const r of obs.coherent) {
    const exact = (budget * r.area) / nCells;
    const share = Math.max(0, Math.floor(exact));
    calm.set(r.id, share);
    assigned += share;
    calmRemainders.push({ id: r.id, frac: exact - share, area: r.area });
  }
  let oscFromArea = 0;
  for (const g of obs.oscillators ?? []) {
    const share = Math.max(0, Math.round((budget * g.area) / nCells));
    osc.set(g.period, (osc.get(g.period) ?? 0) + share);
    oscFromArea += share;
  }
  const texturedArea = obs.textured?.area ?? 0;
  const textureFromArea = Math.max(
    0,
    Math.round((budget * texturedArea) / nCells),
  );
  const chaosFromArea = Math.max(
    0,
    Math.round((budget * obs.chaotic.area) / nCells),
  );
  // Overflow scaling treats texture/osc like calm (stable pools yield to chaos).
  const stableAssigned = assigned + textureFromArea + oscFromArea;
  if (stableAssigned + chaosFromArea > budget && stableAssigned > 0) {
    const roomForStable = budget - Math.min(chaosFromArea, budget);
    const scale = roomForStable / stableAssigned;
    let sum = 0;
    for (const [id, s] of calm) {
      const ns = Math.max(0, Math.floor(s * scale));
      calm.set(id, ns);
      sum += ns;
    }
    for (const [p, s] of osc) {
      const ns = Math.max(0, Math.floor(s * scale));
      osc.set(p, ns);
      sum += ns;
    }
    const texture = Math.max(0, Math.floor(textureFromArea * scale));
    sum += texture;
    return {
      calm,
      osc,
      texture,
      chaos: Math.min(chaosFromArea, Math.max(0, budget - sum)),
    };
  }
  const texture = Math.min(
    textureFromArea,
    Math.max(0, budget - assigned - oscFromArea),
  );
  let chaos = Math.min(
    chaosFromArea,
    Math.max(0, budget - assigned - oscFromArea - texture),
  );
  // Largest-remainder: give unused seats to calm regions (never to chaos).
  let used = assigned + oscFromArea + texture + chaos;
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
 * Split material law: timeOrder → duration/envelope; spectralT → Q only.
 * similarity is the spatial axis (not κ — κ would double-count stability into Q).
 */
function grainMaterial(
  similarity: number,
  delta: number,
  area: number,
  fillT: number,
  nCells: number,
): GrainMaterial {
  const minArea = FIELD_OBS.minRegionArea;
  const stabilityT = 1 - clamp01(delta / SCHED.deltaRateNorm);
  const fillRatio = clamp01(fillT);
  // area=0 for bag/per-cell spawns: a bag is not a coherent extent, so its
  // area must not lengthen its grains.
  const areaT =
    area > 0
      ? clamp01(
          Math.log2(Math.max(2, area / minArea)) /
            Math.log2(Math.max(2, nCells / minArea)),
        ) *
        (0.7 + 0.3 * fillRatio)
      : 0;
  const order = clamp01(0.65 * stabilityT + 0.35 * areaT);
  const spectralT = clamp01(similarity);
  const durationSec =
    SCHED.DUR_MIN * Math.pow(SCHED.DUR_MAX / SCHED.DUR_MIN, order);
  const s = smoothstep01(order);
  return {
    order,
    durationSec,
    attackFrac: lerp(SCHED.ATT_MIN, SCHED.ATT_MAX, s),
    releaseFrac: lerp(SCHED.REL_CHAOS, SCHED.REL_CALM, s),
    q: SCHED.Q_MIN * Math.pow(SCHED.Q_MAX / SCHED.Q_MIN, spectralT),
  };
}

function materialFromRegion(
  region: CoherentRegion,
  nCells: number,
): GrainMaterial {
  return grainMaterial(
    region.meanSimilarity,
    region.meanDelta,
    region.area,
    region.fillRatio ?? 1,
    nCells,
  );
}

/** Representative chaos duration from bag means (for packing rate). */
function durationChaosMean(chaotic: ChaoticArea, nCells: number): number {
  // Chaos bag: areaT = 0 (not a coherent extent).
  return grainMaterial(
    chaotic.meanSimilarity,
    chaotic.meanDelta,
    0,
    0,
    nCells,
  ).durationSec;
}

function materialFromTexture(
  textured: TexturedArea,
  nCells: number,
): GrainMaterial {
  return grainMaterial(
    textured.meanSimilarity,
    textured.meanDelta,
    textured.area,
    1,
    nCells,
  );
}

function spawnOsc(
  group: OscillatorGroup,
  obs: FieldObservation,
  rgb: RgbField,
  amplitude: number,
  bankDur: number,
  dtSec: number,
  hueLut: Float32Array,
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
  const similarity = obs.similarity[ci] ?? 0.5;
  const delta = obs.deltaSmooth?.[ci] ?? obs.delta[ci] ?? group.meanDelta;
  const nCells = obs.width * obs.height;
  const mat = grainMaterial(similarity, delta, 0, 0, nCells);
  const durationSec = (0.8 * group.period) / SCHED.stepsPerSec;
  const { sampleCenter, sampleHalf } = sampleWindowFromColour(
    r,
    g,
    b,
    bankDur,
    hueLut,
  );
  return {
    x,
    y,
    r,
    g,
    b,
    durationSec,
    amplitude,
    direction: 1,
    sampleCenter,
    sampleHalf,
    startOffsetSec: Math.random() * dtSec * 0.25,
    q: mat.q,
    yNorm: 1 - y / Math.max(1, h - 1),
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
  textured: TexturedArea,
  obs: FieldObservation,
  rgb: RgbField,
  amplitude: number,
  mat: GrainMaterial,
  bankDur: number,
  dtSec: number,
  hueLut: Float32Array,
  scrubSec = 0,
  siteSlot = 0,
  mask: Uint32Array = EMPTY_MASK,
  maskStamp = 0,
): GrainSpawnEvent {
  const w = obs.width;
  const h = obs.height;
  const cells = textured.cells;
  // A bag has no COM; any point on a torus is equivalent, so use the stable
  // grid centre — it is also what puts a uniform field at centre pan.
  const site = pickStratifiedSite(
    siteSlot,
    SCHED.SITE_SALT_TEXTURE,
    textured.colourSpread,
    (w - 1) / 2,
    (h - 1) / 2,
    w / 2,
    h / 2,
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
  const r = rgb.r[ci] ?? textured.meanR;
  const g = rgb.g[ci] ?? textured.meanG;
  const b = rgb.b[ci] ?? textured.meanB;
  const { sampleCenter: lutCenter, sampleHalf } = sampleWindowFromColour(
    r,
    g,
    b,
    bankDur,
    hueLut,
  );
  const sampleCenter = wrap01(lutCenter + scrubSec / bankDur);
  return {
    x,
    y,
    r,
    g,
    b,
    durationSec: mat.durationSec,
    amplitude,
    direction: 1,
    sampleCenter,
    sampleHalf,
    startOffsetSec: Math.random() * dtSec,
    q: mat.q,
    yNorm: 1 - y / Math.max(1, h - 1),
    pan: panFromX(x, w),
    attackFrac: mat.attackFrac,
    releaseFrac: mat.releaseFrac,
    regime: "texture",
    regionId: -1,
    trackDx: 0,
    trackDy: 0,
    readOffset: site.readOffset,
    siteSlot,
  };
}

function wrap01(x: number): number {
  return ((x % 1) + 1) % 1;
}

/** Spawn/follow anchor: true COM when concentrated, else stable grid centre. */
function regionAnchor(
  region: CoherentRegion,
  obs: FieldObservation,
): { x: number; y: number } {
  const x =
    region.width >= obs.width || region.comConcX < SCHED.SPAWN_ANCHOR_R_MIN
      ? (obs.width - 1) / 2
      : region.comX;
  const y =
    region.height >= obs.height || region.comConcY < SCHED.SPAWN_ANCHOR_R_MIN
      ? (obs.height - 1) / 2
      : region.comY;
  return { x, y };
}

function spawnCalm(
  region: CoherentRegion,
  obs: FieldObservation,
  rgb: RgbField,
  amplitude: number,
  mat: GrainMaterial,
  bankDur: number,
  dtSec: number,
  hueLut: Float32Array,
  scrubSec = 0,
  siteSlot = 0,
  mask: Uint32Array = EMPTY_MASK,
  maskStamp = 0,
  anchorX = (obs.width - 1) / 2,
  anchorY = (obs.height - 1) / 2,
): GrainSpawnEvent {
  const w = obs.width;
  const h = obs.height;
  let ci: number;
  let readOffset: number;
  if (region.cells.length === 0) {
    const cx = Math.floor(region.comX) % w;
    const cy = Math.floor(region.comY) % h;
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
      h,
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
    hueLut,
    scrubSec,
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
  hueLut: Float32Array,
  scrubSec = 0,
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
  const { sampleCenter: lutCenter, sampleHalf } = sampleWindowFromColour(
    r,
    g,
    b,
    bankDur,
    hueLut,
  );
  const sampleCenter = wrap01(lutCenter + scrubSec / bankDur);

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
    sampleCenter,
    sampleHalf,
    startOffsetSec: Math.random() * dtSec,
    q: mat.q,
    yNorm: 1 - cy / Math.max(1, h - 1),
    pan: panFromX(cx, w),
    attackFrac: mat.attackFrac,
    releaseFrac: mat.releaseFrac,
    regime: "calm",
    regionId: region.id,
    trackDx,
    trackDy,
    readOffset,
    siteSlot,
  };
}

function spawnChaos(
  chaotic: ChaoticArea,
  obs: FieldObservation,
  rgb: RgbField,
  amplitude: number,
  bankDur: number,
  dtSec: number,
  hueLut: Float32Array,
): GrainSpawnEvent {
  const w = obs.width;
  const h = obs.height;
  const ci = pickChaosCell(chaotic, obs);
  const x = ci % w;
  const y = (ci / w) | 0;
  const r = rgb.r[ci] ?? 0.5;
  const g = rgb.g[ci] ?? 0.5;
  const b = rgb.b[ci] ?? 0.5;
  const similarity = obs.similarity[ci] ?? chaotic.meanSimilarity;
  const delta = obs.deltaSmooth?.[ci] ?? obs.delta[ci] ?? chaotic.meanDelta;
  const nCells = w * h;
  const mat = grainMaterial(similarity, delta, 0, 0, nCells);
  const { sampleCenter, sampleHalf } = sampleWindowFromColour(
    r,
    g,
    b,
    bankDur,
    hueLut,
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
    sampleCenter,
    sampleHalf,
    startOffsetSec: Math.random() * dtSec,
    q: mat.q,
    yNorm: 1 - y / Math.max(1, h - 1),
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

/** δ-weighted rejection sampling over the chaos bag (uses smoothed δ). */
function pickChaosCell(chaotic: ChaoticArea, obs: FieldObservation): number {
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

/** Hue [0,1] from RGB; undefined hue (grey) → 0.5. */
export function rgbToHueNorm(r: number, g: number, b: number): number {
  const rr = clamp01(r);
  const gg = clamp01(g);
  const bb = clamp01(b);
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const d = max - min;
  if (d < 1e-6) return 0.5;
  let h = 0;
  if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6;
  else if (max === gg) h = ((bb - rr) / d + 2) / 6;
  else h = ((rr - gg) / d + 4) / 6;
  return clamp01(h);
}

/** HSV saturation → window half-width in seconds; hue → perceptual centre. */
function sampleWindowFromColour(
  r: number,
  g: number,
  b: number,
  bankDur: number,
  hueLut: Float32Array,
): { sampleCenter: number; sampleHalf: number } {
  const rr = clamp01(r);
  const gg = clamp01(g);
  const bb = clamp01(b);
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const sat = (max - min) / Math.max(1e-4, max);
  const halfSec = lerp(
    SCHED.WINDOW_HALF_MIN_S,
    SCHED.WINDOW_HALF_MAX_S,
    1 - sat,
  );
  const hue = rgbToHueNorm(rr, gg, bb);
  const sampleCenter = sampleCenterFromHue(hueLut, hue);
  const absFloor = SCHED.WINDOW_HALF_ABS_MIN_S / Math.max(1e-3, bankDur);
  const sampleHalf = Math.min(
    0.49,
    Math.max(absFloor, halfSec / Math.max(1e-3, bankDur)),
  );
  return { sampleCenter, sampleHalf: Math.max(1e-4, sampleHalf) };
}

function panFromX(x: number, width: number): number {
  const t = x / Math.max(1, width - 1);
  return Math.max(-1, Math.min(1, t * 2 - 1));
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

function countEventsForRegion(events: GrainSpawnEvent[], id: number): number {
  let n = 0;
  for (const e of events) if (e.regionId === id) n++;
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

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
