import type {
  ChaoticArea,
  CoherentRegion,
  FieldObservation,
} from "./FieldObserver.ts";
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
  maxCalmConcurrent: 8,
  /** Unified continuous duration range (log-lerp by order). */
  DUR_MIN: 0.03,
  DUR_MAX: 2.2,
  /** Attack / release fraction range (chaos→calm via order). */
  ATT_MIN: 0.04,
  ATT_MAX: 0.30,
  REL_MIN: 0.12,
  REL_MAX: 0.34,
  /** κ → filter Q (spectral purity). */
  Q_MIN: 0.8,
  Q_MAX: 8.0,
  /** Saturation → window half-width (seconds). */
  WINDOW_HALF_MIN_S: 0.06,
  WINDOW_HALF_MAX_S: 0.8,
  /** Legacy calm Hz band — packing rate supersedes for calm wash. */
  calmRateMinHz: 0.8,
  calmRateMaxHz: 6,
  chaosRateMinHz: 6,
  chaosRateMaxHz: 48,
  /** δ scale for rate/duration — headroom so mid-chaos does not stick at max. */
  deltaRateNorm: 0.35,
  /**
   * Floor multiplier on packing rate when δ̄→0.
   * Keeps static calm fields overlapping; evolving calm fires denser.
   */
  calmPackRateMin: 0.5,
  /**
   * Floor multiplier on chaos pack-to-share rate when δ̄→0.
   * Static heterogeneous fields go nearly quiet.
   */
  chaosPackRateMin: 0.1,
  velDirEps: 0.08,
  stepsPerSec: 30,
  /** Samples of meanDelta kept per calm region for period detection. */
  rhythmHistory: 48,
  /** Minimum accepted observed period (seconds). */
  rhythmMinSec: 0.15,
  /** Maximum accepted observed period (seconds). */
  rhythmMaxSec: 2.0,
  /** Autocorr peak ratio above lag-0 neighbourhood to trust a period. */
  rhythmConfidence: 0.35,
  /** Max grains fired on a trusted period wrap (felt pulse, not packing burst). */
  rhythmPulseMax: 2,
  /** While period trusted, top up wash only below this fraction of desired. */
  rhythmWashFloor: 0.5,
} as const;

export type GrainRegime = "calm" | "chaos";

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
  /** Spawn offset from region COM (cells) — used for direct pan/Y follow. */
  trackDx: number;
  trackDy: number;
}

/** Per-step region COM for direct pan/Y follow (no smoothing). */
export interface RegionTrack {
  regionId: number;
  comX: number;
  comY: number;
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
  private lastStepMs = 0;
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
    this.lastStepMs = 0;
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
      tracks.push({
        regionId: region.id,
        comX: region.comX,
        comY: region.comY,
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
        };
        this.calmClocks.set(region.id, clock);
      }

      pushHistory(clock, region.meanDelta);
      const rhythm = estimatePeriod(clock, dtSec);
      clock.periodSec = rhythm.periodSec;
      clock.confidence = rhythm.confidence;

      const mat = materialFromRegion(region);
      const packHz = desired / Math.max(0.05, mat.durationSec);
      const baseHz = calmPackRateHz(packHz, region.meanDelta);
      const regionActive = () =>
        activeHere + countEventsForRegion(events, region.id);
      const room = () =>
        regionActive() < desired && this.active.length < this.budget;

      const pushCalm = () => {
        const ev = spawnCalm(
          region,
          obs,
          rgb,
          amp,
          mat,
          bankDur,
          dtSec,
          this.hueSampleLut,
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
        clock.acc += baseHz * dtSec;
        while (clock.acc >= 1 && room()) {
          clock.acc -= 1;
          pushCalm();
        }
        if (clock.acc > 2) clock.acc = 2;
      }
    }

    // Chaos pack-to-share: spend area budget as many short concurrent hits.
    const desiredChaos = shares.chaos;
    const chaosDur = durationChaosMean(obs.chaotic);
    const chaosPackHz = desiredChaos / Math.max(0.02, chaosDur);
    const chaosRateHz = chaosPackRateHz(chaosPackHz, obs.chaotic.meanDelta);
    this.chaosAcc += chaosRateHz * dtSec;

    while (
      this.chaosAcc >= 1 &&
      countActiveRegime(this.active, "chaos") +
        countEventsRegime(events, "chaos") <
        desiredChaos &&
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
 * Autocorrelation peak on meanDelta history → period + confidence.
 * Returns periodSec=0 when history is too short or no clear peak.
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

  let bestLag = 0;
  let bestCorr = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let num = 0;
    for (let i = 0; i < n - lag; i++) {
      num += (series[i]! - mean) * (series[i + lag]! - mean);
    }
    const corr = num / varSum;
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

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
 * Area-proportional concurrent shares. Rounding leftovers stay unused —
 * unused calm packing capacity must not be donated to chaos.
 */
function allocateShares(
  obs: FieldObservation,
  budget: number,
  nCells: number,
): { calm: Map<number, number>; chaos: number } {
  const calm = new Map<number, number>();
  let assigned = 0;
  for (const r of obs.coherent) {
    const share = Math.max(0, Math.round((budget * r.area) / nCells));
    calm.set(r.id, share);
    assigned += share;
  }
  const chaosFromArea = Math.max(
    0,
    Math.round((budget * obs.chaotic.area) / nCells),
  );
  if (assigned + chaosFromArea > budget && assigned > 0) {
    const roomForCalm = budget - Math.min(chaosFromArea, budget);
    const scale = roomForCalm / assigned;
    let sum = 0;
    for (const [id, s] of calm) {
      const ns = Math.max(0, Math.floor(s * scale));
      calm.set(id, ns);
      sum += ns;
    }
    // Cap chaos at its area share (and remaining slots) — do not dump leftovers.
    return {
      calm,
      chaos: Math.min(chaosFromArea, Math.max(0, budget - sum)),
    };
  }
  return {
    calm,
    chaos: Math.min(chaosFromArea, Math.max(0, budget - assigned)),
  };
}

function desiredCalmConcurrent(region: CoherentRegion, share: number): number {
  if (share <= 0) return 0;
  const fromArea = 1 + Math.floor(Math.log2(Math.max(2, region.area / 24)));
  const k = clamp01(region.meanCoherence);
  // Overlap ∝ κ̄ × size — κ scales the area-derived concurrent count.
  const fromLaws = Math.max(1, Math.round(fromArea * (0.35 + 0.65 * k)));
  return Math.max(1, Math.min(SCHED.maxCalmConcurrent, share, fromLaws));
}

/** Packing-first calm rate: sustain overlap; δ̄ nudges within a band. */
function calmPackRateHz(packHz: number, meanDelta: number): number {
  const t = clamp01(meanDelta / SCHED.deltaRateNorm);
  const scale = SCHED.calmPackRateMin + (1 - SCHED.calmPackRateMin) * t;
  return Math.max(0.05, packHz * scale);
}

/** Pack-to-share chaos rate: fill area concurrent; δ̄ scales toward full share. */
function chaosPackRateHz(packHz: number, meanDelta: number): number {
  const t = clamp01(meanDelta / SCHED.deltaRateNorm);
  const scale = SCHED.chaosPackRateMin + (1 - SCHED.chaosPackRateMin) * t;
  return Math.max(0.05, packHz * scale);
}

/** Unified continuous grain material from κ/δ/area/fill. */
function grainMaterial(
  kappa: number,
  delta: number,
  areaT: number,
  fillT: number,
): GrainMaterial {
  const order = clamp01(
    0.55 * clamp01(kappa) +
      0.15 * (1 - clamp01(delta / SCHED.deltaRateNorm)) +
      0.2 * clamp01(areaT) +
      0.1 * clamp01(fillT),
  );
  const durationSec =
    SCHED.DUR_MIN * Math.pow(SCHED.DUR_MAX / SCHED.DUR_MIN, order);
  const s = smoothstep01(order);
  return {
    order,
    durationSec,
    attackFrac: lerp(SCHED.ATT_MIN, SCHED.ATT_MAX, s),
    releaseFrac: lerp(SCHED.REL_MIN, SCHED.REL_MAX, s),
    q: SCHED.Q_MIN * Math.pow(SCHED.Q_MAX / SCHED.Q_MIN, clamp01(kappa)),
  };
}

function materialFromRegion(region: CoherentRegion): GrainMaterial {
  const areaT = clamp01(Math.log2(Math.max(2, region.area)) / 10);
  const fillT = clamp01(region.fillRatio ?? 1);
  return grainMaterial(
    region.meanCoherence,
    region.meanDelta,
    areaT,
    fillT,
  );
}

/** Representative chaos duration from bag means (for packing rate). */
function durationChaosMean(chaotic: ChaoticArea): number {
  return grainMaterial(chaotic.meanCoherence, chaotic.meanDelta, 0, 0)
    .durationSec;
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
): GrainSpawnEvent {
  const w = obs.width;
  const h = obs.height;
  let ci: number;
  if (region.cells.length === 0) {
    const cx = Math.floor(region.comX) % w;
    const cy = Math.floor(region.comY) % h;
    ci = cy * w + cx;
  } else {
    // Shape-true: uniform pick from membership mask (not AABB jitter).
    ci = region.cells[(Math.random() * region.cells.length) | 0]!;
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
): GrainSpawnEvent {
  const w = obs.width;
  const h = obs.height;
  const cx = ci % w;
  const cy = (ci / w) | 0;

  const r = rgb.r[ci] ?? region.meanR;
  const g = rgb.g[ci] ?? region.meanG;
  const b = rgb.b[ci] ?? region.meanB;
  const { sampleCenter, sampleHalf } = sampleWindowFromColour(
    r,
    g,
    b,
    bankDur,
    hueLut,
  );

  // Toroidal offset from COM so pan/Y follow keeps relative placement in the mass.
  const trackDx = toroidalOffset(cx, region.comX, w);
  const trackDy = toroidalOffset(cy, region.comY, h);

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
  const kappa = obs.coherence[ci] ?? chaotic.meanCoherence;
  const delta = obs.delta[ci] ?? chaotic.meanDelta;
  const mat = grainMaterial(kappa, delta, 0, 0);
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
  };
}

/** δ-weighted rejection sampling over the chaos bag. */
function pickChaosCell(chaotic: ChaoticArea, obs: FieldObservation): number {
  const cells = chaotic.cells;
  if (cells.length === 0) return 0;
  const bagMax = Math.max(1e-4, chaotic.maxDelta);
  let last = cells[(Math.random() * cells.length) | 0]!;
  for (let t = 0; t < 8; t++) {
    const ci = cells[(Math.random() * cells.length) | 0]!;
    last = ci;
    if (Math.random() < (obs.delta[ci] ?? 0) / bagMax) return ci;
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
  const sampleHalf = Math.min(0.49, halfSec / Math.max(1e-3, bankDur));
  return { sampleCenter, sampleHalf: Math.max(1e-4, sampleHalf) };
}

function panFromX(x: number, width: number): number {
  const t = x / Math.max(1, width - 1);
  return Math.max(-1, Math.min(1, t * 2 - 1));
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
