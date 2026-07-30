import type { TrackedStructure } from "./StructureTracker.ts";

export const VOICE_BUDGET = 32;
export const VOICE_BUDGET_ORDERED = 10;
export const ENERGY_TARGET = 0.26;
const ENERGY_SILENCE = 0.03;
export const MASTER_GAIN_MAX = 2.5;

const GRAIN_LEN_MIN = 0.04;
const GRAIN_LEN_MAX = 0.26;
/** Strong position smoothing — topology should glide with structures. */
const POS_EMA = 0.22;
/**
 * Only real structure translation should force grain rebake.
 * Tip flicker must not chop grains.
 */
const MOTION_REFRESH_CELLS = 1.6;

export interface VoiceParams {
  structureId: number;
  probeIndex: number;
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
  colourCoherence: number;
  grainLengthSec: number;
  overlap: number;
  persistence: number;
  amplitudeShare: number;
  /** Centroid speed only — drives topology refresh. */
  motion: number;
  extentW: number;
  extentH: number;
}

export interface VoicePlan {
  masterGain: number;
  energy: number;
  /** Field-level order proxy in [0,1] — high when the grid is settling. */
  fieldOrder: number;
  gridWidth: number;
  gridHeight: number;
  voices: VoiceParams[];
  activeVoiceCount: number;
  structureCount: number;
}

interface ProbeState {
  structureId: number;
  probeIndex: number;
  x: number;
  y: number;
}

/**
 * Neutral structure → voice allocation.
 * Probes follow smoothed centroid + major-axis span (structure geometry),
 * not flickering raw tip pixels.
 */
export class StructureAllocator {
  private readonly width: number;
  private readonly height: number;
  private probes = new Map<string, ProbeState>();
  private probeCountById = new Map<number, number>();

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  reset(): void {
    this.probes.clear();
    this.probeCountById.clear();
  }

  allocate(
    structures: TrackedStructure[],
    fieldEnergy: number,
    fieldOrder = 0,
  ): VoicePlan {
    const w = this.width;
    const h = this.height;
    const order = clamp01(fieldOrder);

    let masterGain = 0;
    if (fieldEnergy >= ENERGY_SILENCE) {
      // Soften the 1/energy boost as the field orders so settling isn't louder.
      const energyGain = Math.min(MASTER_GAIN_MAX, ENERGY_TARGET / fieldEnergy);
      masterGain = energyGain * (1 - 0.35 * order);
    }

    if (masterGain <= 0 || structures.length === 0) {
      this.probes.clear();
      this.probeCountById.clear();
      return {
        masterGain: 0,
        energy: fieldEnergy,
        fieldOrder: order,
        gridWidth: w,
        gridHeight: h,
        voices: [],
        activeVoiceCount: 0,
        structureCount: 0,
      };
    }

    const budget = Math.max(
      VOICE_BUDGET_ORDERED,
      Math.round(
        VOICE_BUDGET_ORDERED + (1 - order) * (VOICE_BUDGET - VOICE_BUDGET_ORDERED),
      ),
    );

    const scored = structures.map((s) => {
      const info =
        (s.spatialVariance + 0.04) *
        (s.temporalDelta + 0.04) *
        (s.speed * 0.15 + 0.08);
      // Chaotic fields promote flicker; ordered fields promote mass / age.
      const infoWeight = 12 * (1 - 0.9 * order);
      const massTerm =
        Math.sqrt(Math.max(1, s.area)) *
        (0.55 + (0.45 * s.mass) / Math.max(1, s.area));
      const ageTerm = Math.min(3, s.age * 0.05) * (1 + 1.5 * order);
      const calmBonus = s.stability * order * 4;
      const presence = massTerm + info * infoWeight + ageTerm + calmBonus;
      return { s, presence };
    });
    scored.sort((a, b) => b.presence - a.presence);

    type Slot = {
      s: TrackedStructure;
      probeIndex: number;
      tx: number;
      ty: number;
      nProbes: number;
    };
    const slots: Slot[] = [];
    const nextProbeCounts = new Map<number, number>();

    for (const { s } of scored) {
      if (slots.length >= budget) break;
      const nProbes = stableProbeCount(s.area, this.probeCountById.get(s.id));
      nextProbeCounts.set(s.id, nProbes);
      const points = probePoints(s, nProbes, w, h);
      for (let pi = 0; pi < points.length && slots.length < budget; pi++) {
        slots.push({
          s,
          probeIndex: pi,
          tx: points[pi]!.x,
          ty: points[pi]!.y,
          nProbes,
        });
      }
    }
    this.probeCountById = nextProbeCounts;

    const voices: VoiceParams[] = [];
    const massShares: number[] = [];
    const nextProbes = new Map<string, ProbeState>();

    for (const slot of slots) {
      const key = `${slot.s.id}:${slot.probeIndex}`;
      const prev = this.probes.get(key);
      let x = slot.tx;
      let y = slot.ty;
      if (prev) {
        const dx = shortestDelta(prev.x, slot.tx, w);
        const dy = shortestDelta(prev.y, slot.ty, h);
        x = wrap(prev.x + dx * POS_EMA, w);
        y = wrap(prev.y + dy * POS_EMA, h);
      }
      nextProbes.set(key, {
        structureId: slot.s.id,
        probeIndex: slot.probeIndex,
        x,
        y,
      });

      const s = slot.s;
      const coherence = clamp01(1 - s.colourVariance * 3);
      const calm = s.stability;
      const differentiation = clamp01(s.spatialVariance * 2.5);

      // Order → longer grains, lower overlap (clearer), stickier persistence.
      const lengthBlend = clamp01(
        0.35 + 0.5 * calm + 0.15 * (1 - differentiation) + 0.2 * order,
      );
      const grainLengthSec =
        GRAIN_LEN_MIN + lengthBlend * (GRAIN_LEN_MAX - GRAIN_LEN_MIN);
      const overlap = clamp01(
        0.22 +
          0.45 * calm * (1 - 0.55 * order) +
          0.15 * coherence -
          0.28 * order,
      );
      const persistence = clamp01(0.2 + 0.75 * calm + 0.15 * order);
      // Dampen motion so ordered fields don't force dense early rebakes.
      const motion = s.speed * (1 - 0.8 * order);

      voices.push({
        structureId: s.id,
        probeIndex: slot.probeIndex,
        x,
        y,
        r: s.meanR,
        g: s.meanG,
        b: s.meanB,
        colourCoherence: coherence,
        grainLengthSec,
        overlap,
        persistence,
        amplitudeShare: 0,
        motion,
        extentW: s.extentW,
        extentH: s.extentH,
      });
      massShares.push(s.mass / Math.max(1, slot.nProbes));
    }

    this.probes = nextProbes;

    let massSum = 0;
    for (const m of massShares) massSum += Math.max(0, m);
    if (massSum <= 1e-8) {
      for (const v of voices) v.amplitudeShare = 0;
      return {
        masterGain: 0,
        energy: fieldEnergy,
        fieldOrder: order,
        gridWidth: w,
        gridHeight: h,
        voices,
        activeVoiceCount: voices.length,
        structureCount: scored.length,
      };
    }
    for (let i = 0; i < voices.length; i++) {
      voices[i]!.amplitudeShare = Math.max(0, massShares[i]!) / massSum;
    }

    return {
      masterGain,
      energy: fieldEnergy,
      fieldOrder: order,
      gridWidth: w,
      gridHeight: h,
      voices,
      activeVoiceCount: voices.length,
      structureCount: new Set(voices.map((v) => v.structureId)).size,
    };
  }
}

function stableProbeCount(area: number, previous: number | undefined): number {
  const target = Math.max(1, Math.min(5, Math.round(Math.sqrt(area) / 4.5)));
  if (previous === undefined) return target;
  // Hysteresis: only change count when area clearly crosses a band.
  if (target > previous) {
    const need = Math.pow((previous + 0.5) * 4.5, 2);
    return area >= need * 1.25 ? target : previous;
  }
  if (target < previous) {
    const need = Math.pow((previous - 0.5) * 4.5, 2);
    return area <= need * 0.75 ? target : previous;
  }
  return previous;
}

/**
 * Geometry probes from smoothed centroid + major axis.
 * Large structures get extent samples; small ones stay at the centroid.
 */
function probePoints(
  s: TrackedStructure,
  n: number,
  w: number,
  h: number,
): { x: number; y: number }[] {
  if (n <= 1) return [{ x: s.cx, y: s.cy }];
  const span = Math.max(1, s.axisSpan);
  const ax = s.axisX;
  const ay = s.axisY;
  if (n === 2) {
    return [
      { x: wrap(s.cx + ax * span, w), y: wrap(s.cy + ay * span, h) },
      { x: wrap(s.cx - ax * span, w), y: wrap(s.cy - ay * span, h) },
    ];
  }
  const points = [
    { x: s.cx, y: s.cy },
    { x: wrap(s.cx + ax * span, w), y: wrap(s.cy + ay * span, h) },
    { x: wrap(s.cx - ax * span, w), y: wrap(s.cy - ay * span, h) },
  ];
  if (n >= 4) {
    points.push({
      x: wrap(s.cx + ax * span * 0.5, w),
      y: wrap(s.cy + ay * span * 0.5, h),
    });
  }
  if (n >= 5) {
    points.push({
      x: wrap(s.cx - ax * span * 0.5, w),
      y: wrap(s.cy - ay * span * 0.5, h),
    });
  }
  return points.slice(0, n);
}

function shortestDelta(from: number, to: number, period: number): number {
  let d = to - from;
  if (d > period * 0.5) d -= period;
  if (d < -period * 0.5) d += period;
  return d;
}

function wrap(v: number, period: number): number {
  let x = v % period;
  if (x < 0) x += period;
  return x;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export { MOTION_REFRESH_CELLS };
