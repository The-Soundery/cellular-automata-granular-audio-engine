import type {
  ChaoticArea,
  CoherentRegion,
  FieldObservation,
} from "./FieldObserver.ts";
import type { RgbField } from "./FrameObserver.ts";

/** Negotiable physical budget — raise after listening + CPU check. */
export const GRAIN_BUDGET = 64;
export const MASTER_GAIN = 1.0;

/** Negotiable scheduler curves (Sonic Laws shape; numbers are tunable). */
export const SCHED = {
  maxCalmConcurrent: 8,
  calmDurMin: 0.35,
  calmDurMax: 1.4,
  chaosDurMin: 0.045,
  chaosDurMax: 0.14,
  /** Legacy calm Hz band — packing rate supersedes for calm wash. */
  calmRateMinHz: 0.8,
  calmRateMaxHz: 6,
  chaosRateMinHz: 8,
  chaosRateMaxHz: 48,
  deltaRateNorm: 0.25,
  /**
   * Floor multiplier on packing rate when δ̄→0.
   * Keeps static calm fields at ~desired concurrent overlap.
   */
  calmPackRateMin: 0.85,
  /** Soft envelope fractions frozen at spawn (calm wash). */
  calmAttackFrac: 0.5,
  calmReleaseFrac: 0.5,
  /** Sharp envelope fractions frozen at spawn (chaos hits). */
  chaosAttackFrac: 0.06,
  chaosReleaseFrac: 0.15,
  ySpreadFrac: 0.85,
  velDirEps: 0.08,
  stepsPerSec: 30,
  /** Half-width of hue→sample window (calm). */
  calmSampleHalf: 0.04,
  /** Half-width of hue→sample window (chaos). */
  chaosSampleHalf: 0.012,
  /** Samples of meanDelta kept per calm region for period detection. */
  rhythmHistory: 48,
  /** Minimum accepted observed period (seconds). */
  rhythmMinSec: 0.15,
  /** Maximum accepted observed period (seconds). */
  rhythmMaxSec: 2.0,
  /** Autocorr peak ratio above lag-0 neighbourhood to trust a period. */
  rhythmConfidence: 0.35,
} as const;

export type GrainRegime = "calm" | "chaos";

/** Frozen-at-spawn ephemeral grain descriptor (V4: hue→sample, X→pan). */
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
  /** Locked sample window [0,1] for ping-pong (from hue). */
  sampleLo: number;
  sampleHi: number;
  /** Locked spectral position [0,1], 1 = high frequency. */
  yNorm: number;
  /** Stereo pan [-1,1] from spawn X (frozen). */
  pan: number;
  /** Envelope attack as fraction of duration (frozen at spawn). */
  attackFrac: number;
  /** Envelope release as fraction of duration (frozen at spawn). */
  releaseFrac: number;
  regime: GrainRegime;
  regionId: number;
}

export interface GrainEventBatch {
  masterGain: number;
  gridWidth: number;
  gridHeight: number;
  events: GrainSpawnEvent[];
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

  constructor(budget = GRAIN_BUDGET) {
    this.budget = budget;
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
   */
  step(
    obs: FieldObservation,
    rgb: RgbField,
    nowMs = performance.now(),
  ): GrainEventBatch {
    this.prune(nowMs);
    const events: GrainSpawnEvent[] = [];
    const nCells = obs.width * obs.height;
    const dtSec =
      this.lastStepMs > 0
        ? Math.min(0.25, (nowMs - this.lastStepMs) / 1000)
        : 1 / SCHED.stepsPerSec;
    this.lastStepMs = nowMs;

    const shares = allocateShares(obs, this.budget, nCells);
    const amp = equalAmp(this.budget);

    const liveCalmIds = new Set(obs.coherent.map((r) => r.id));
    for (const id of [...this.calmClocks.keys()]) {
      if (!liveCalmIds.has(id)) this.calmClocks.delete(id);
    }

    for (const region of obs.coherent) {
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

      const durationSec = durationFromRegion(region);
      const packHz = desired / Math.max(0.05, durationSec);
      const baseHz = calmPackRateHz(packHz, region.meanDelta);
      // events are also recorded in this.active — budget check uses active only.
      const room = () =>
        activeHere + countEventsForRegion(events, region.id) < desired &&
        this.active.length < this.budget;

      if (
        rhythm.confidence >= SCHED.rhythmConfidence &&
        rhythm.periodSec > 0
      ) {
        // Phase fires on period wrap; keep packing density (do not under-fire).
        clock.phase += dtSec / rhythm.periodSec;
        const firesThisStep = Math.min(
          desired,
          Math.max(1, Math.round(baseHz * rhythm.periodSec)),
        );
        while (clock.phase >= 1 && room()) {
          clock.phase -= 1;
          let burst = 0;
          while (burst < firesThisStep && room()) {
            const ev = spawnCalm(region, obs, rgb, amp, durationSec);
            events.push(ev);
            this.active.push({
              endMs: nowMs + ev.durationSec * 1000,
              regime: "calm",
              regionId: region.id,
            });
            burst += 1;
          }
        }
        if (clock.phase > 2) clock.phase = clock.phase % 1;
      } else {
        clock.acc += baseHz * dtSec;
        while (clock.acc >= 1 && room()) {
          clock.acc -= 1;
          const ev = spawnCalm(region, obs, rgb, amp, durationSec);
          events.push(ev);
          this.active.push({
            endMs: nowMs + ev.durationSec * 1000,
            regime: "calm",
            regionId: region.id,
          });
        }
        if (clock.acc > 2) clock.acc = 2;
      }
    }

    const desiredChaos = shares.chaos;
    const chaosRateHz = rateFromDelta(obs.chaotic.meanDelta, false);
    const chaosAreaScale = Math.max(0.15, obs.chaosAreaFraction);
    this.chaosAcc += chaosRateHz * chaosAreaScale * dtSec;

    while (
      this.chaosAcc >= 1 &&
      countActiveRegime(this.active, "chaos") +
        countEventsRegime(events, "chaos") <
        desiredChaos &&
      this.active.length < this.budget &&
      obs.chaotic.cells.length > 0
    ) {
      this.chaosAcc -= 1;
      const ev = spawnChaos(obs.chaotic, obs, rgb, amp);
      events.push(ev);
      this.active.push({
        endMs: nowMs + ev.durationSec * 1000,
        regime: "chaos",
        regionId: -1,
      });
    }
    if (this.chaosAcc > 3) this.chaosAcc = 3;

    return {
      masterGain: MASTER_GAIN,
      gridWidth: obs.width,
      gridHeight: obs.height,
      events,
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
    const scale = (budget - Math.min(chaosFromArea, budget)) / assigned;
    let sum = 0;
    for (const [id, s] of calm) {
      const ns = Math.max(0, Math.floor(s * scale));
      calm.set(id, ns);
      sum += ns;
    }
    return { calm, chaos: Math.max(0, budget - sum) };
  }
  return {
    calm,
    chaos: Math.max(chaosFromArea, Math.max(0, budget - assigned)),
  };
}

function desiredCalmConcurrent(region: CoherentRegion, share: number): number {
  if (share <= 0) return 0;
  const fromArea = 1 + Math.floor(Math.log2(Math.max(2, region.area / 24)));
  return Math.max(1, Math.min(SCHED.maxCalmConcurrent, share, fromArea));
}

function rateFromDelta(meanDelta: number, calm: boolean): number {
  const t = clamp01(meanDelta / SCHED.deltaRateNorm);
  if (calm) {
    return SCHED.calmRateMinHz + (SCHED.calmRateMaxHz - SCHED.calmRateMinHz) * t;
  }
  return (
    SCHED.chaosRateMinHz + (SCHED.chaosRateMaxHz - SCHED.chaosRateMinHz) * t
  );
}

/** Packing-first calm rate: sustain overlap; δ̄ nudges within a band. */
function calmPackRateHz(packHz: number, meanDelta: number): number {
  const t = clamp01(meanDelta / SCHED.deltaRateNorm);
  const scale = SCHED.calmPackRateMin + (1 - SCHED.calmPackRateMin) * t;
  return Math.max(0.05, packHz * scale);
}

function durationFromRegion(region: CoherentRegion): number {
  const k = clamp01(region.meanCoherence);
  const areaT = clamp01(Math.log2(Math.max(2, region.area)) / 10);
  const fill = clamp01(region.fillRatio ?? 1);
  // Sparse shapes slightly shorter; κ + area still dominate.
  const t = 0.5 * k + 0.4 * areaT + 0.1 * fill;
  return SCHED.calmDurMin + (SCHED.calmDurMax - SCHED.calmDurMin) * t;
}

function durationChaos(chaotic: ChaoticArea): number {
  const t = 1 - clamp01(chaotic.meanCoherence);
  return SCHED.chaosDurMin + (SCHED.chaosDurMax - SCHED.chaosDurMin) * t;
}

function spawnCalm(
  region: CoherentRegion,
  obs: FieldObservation,
  rgb: RgbField,
  amplitude: number,
  durationSec: number,
): GrainSpawnEvent {
  const w = obs.width;
  const h = obs.height;
  if (region.cells.length === 0) {
    const cx = Math.floor(region.comX) % w;
    const cy = Math.floor(region.comY) % h;
    return spawnCalmAt(region, obs, rgb, amplitude, durationSec, cy * w + cx);
  }

  // Shape-true: uniform pick from membership mask (not AABB jitter).
  const ci = region.cells[(Math.random() * region.cells.length) | 0]!;

  // Optional mild Y diversity for tall filled regions only.
  const fill = clamp01(region.fillRatio ?? 1);
  if (
    fill > 0.45 &&
    region.height > h * 0.12 &&
    Math.random() < fill * SCHED.ySpreadFrac
  ) {
    const cy0 = (ci / w) | 0;
    const targetY = wrap(
      cy0 + (Math.random() - 0.5) * region.height * fill * SCHED.ySpreadFrac,
      h,
    );
    const cx = ci % w;
    const alt = pickNearestCellInColumn(region.cells, cx, targetY, w);
    return spawnCalmAt(region, obs, rgb, amplitude, durationSec, alt);
  }

  return spawnCalmAt(region, obs, rgb, amplitude, durationSec, ci);
}

function spawnCalmAt(
  region: CoherentRegion,
  obs: FieldObservation,
  rgb: RgbField,
  amplitude: number,
  durationSec: number,
  ci: number,
): GrainSpawnEvent {
  const w = obs.width;
  const h = obs.height;
  const cx = ci % w;
  const cy = (ci / w) | 0;

  const r = rgb.r[ci] ?? region.meanR;
  const g = rgb.g[ci] ?? region.meanG;
  const b = rgb.b[ci] ?? region.meanB;
  const { sampleLo, sampleHi } = sampleWindowFromHue(
    r,
    g,
    b,
    SCHED.calmSampleHalf,
  );

  return {
    x: cx,
    y: cy,
    r,
    g,
    b,
    durationSec,
    amplitude,
    direction: region.velX < -SCHED.velDirEps ? -1 : 1,
    sampleLo,
    sampleHi,
    yNorm: 1 - cy / Math.max(1, h - 1),
    pan: panFromX(cx, w),
    attackFrac: SCHED.calmAttackFrac,
    releaseFrac: SCHED.calmReleaseFrac,
    regime: "calm",
    regionId: region.id,
  };
}

function spawnChaos(
  chaotic: ChaoticArea,
  obs: FieldObservation,
  rgb: RgbField,
  amplitude: number,
): GrainSpawnEvent {
  const w = obs.width;
  const h = obs.height;
  const ci = chaotic.cells[(Math.random() * chaotic.cells.length) | 0]!;
  const x = ci % w;
  const y = (ci / w) | 0;
  const r = rgb.r[ci] ?? 0.5;
  const g = rgb.g[ci] ?? 0.5;
  const b = rgb.b[ci] ?? 0.5;
  const { sampleLo, sampleHi } = sampleWindowFromHue(
    r,
    g,
    b,
    SCHED.chaosSampleHalf,
  );

  return {
    x,
    y,
    r,
    g,
    b,
    durationSec: durationChaos(chaotic),
    amplitude,
    direction: 1,
    sampleLo,
    sampleHi,
    yNorm: 1 - y / Math.max(1, h - 1),
    pan: panFromX(x, w),
    attackFrac: SCHED.chaosAttackFrac,
    releaseFrac: SCHED.chaosReleaseFrac,
    regime: "chaos",
    regionId: -1,
  };
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

function sampleWindowFromHue(
  r: number,
  g: number,
  b: number,
  half: number,
): { sampleLo: number; sampleHi: number } {
  const sampleC = rgbToHueNorm(r, g, b);
  let sampleLo = clamp01(sampleC - half);
  let sampleHi = clamp01(sampleC + half);
  if (sampleHi - sampleLo < 0.002) {
    sampleLo = Math.max(0, sampleC - 0.001);
    sampleHi = Math.min(1, sampleLo + 0.002);
  }
  return { sampleLo, sampleHi };
}

function panFromX(x: number, width: number): number {
  const t = x / Math.max(1, width - 1);
  return Math.max(-1, Math.min(1, t * 2 - 1));
}

function pickNearestCellInColumn(
  cells: Uint32Array,
  x: number,
  y: number,
  w: number,
): number {
  if (cells.length === 0) return (y | 0) * w + (x | 0);
  let best = cells[0]!;
  let bestD = Infinity;
  for (let i = 0; i < cells.length; i++) {
    const ci = cells[i]!;
    const cx = ci % w;
    const cy = (ci / w) | 0;
    const d = (cx - x) * (cx - x) * 4 + (cy - y) * (cy - y);
    if (d < bestD) {
      bestD = d;
      best = ci;
    }
  }
  return best;
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

function wrap(v: number, period: number): number {
  return ((v % period) + period) % period;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
