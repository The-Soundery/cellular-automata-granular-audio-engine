import type { RgbField } from "./FrameObserver.ts";
import { StructureTracker } from "./StructureTracker.ts";
import {
  StructureAllocator,
  VOICE_BUDGET,
  ENERGY_TARGET,
  MASTER_GAIN_MAX,
  type VoiceParams,
  type VoicePlan,
} from "./StructureAllocator.ts";

export {
  VOICE_BUDGET,
  ENERGY_TARGET,
  MASTER_GAIN_MAX,
  type VoiceParams,
  type VoicePlan,
};

/** Fast attack toward order so settling is audible within ~1 s. */
const FIELD_ORDER_EMA_UP = 0.82;
/** Slower release so brief flicker doesn't dump the field back to chaos. */
const FIELD_ORDER_EMA_DOWN = 0.92;

export interface V2DiagSnapshot {
  frames: number;
  structureCountMean: number;
  idBirths: number;
  idDeaths: number;
  /** Fraction of voice keys that disappear between consecutive plans. */
  voiceKeyChurnRate: number;
  /** Mean toroidal jump of surviving probe positions (cells). */
  meanProbeJump: number;
  /** Mean tip-extrema jump for structures that kept their id. */
  meanTipJump: number;
  meanStructureAge: number;
  medianMotion: number;
  probesForcedByMotionShare: number;
  fieldOrder: number;
}

/**
 * Thin orchestrator: regions → tracked structures → neutral voice plan.
 * Includes temporary diagnostics for allocation thrash investigation.
 */
export class FieldMetrics {
  private readonly tracker: StructureTracker;
  private readonly allocator: StructureAllocator;
  private readonly width: number;
  private readonly height: number;

  private fieldOrder = 0;

  private prevIds = new Set<number>();
  private prevKeys = new Set<string>();
  private prevPos = new Map<string, { x: number; y: number }>();
  private prevTips = new Map<number, { ax: number; ay: number; bx: number; by: number }>();

  private frames = 0;
  private structureCountSum = 0;
  private idBirths = 0;
  private idDeaths = 0;
  private voiceKeyGone = 0;
  private voiceKeyPrev = 0;
  private probeJumpSum = 0;
  private probeJumpN = 0;
  private tipJumpSum = 0;
  private tipJumpN = 0;
  private ageSum = 0;
  private ageN = 0;
  private motionSamples: number[] = [];
  private motionForceN = 0;
  private motionVoiceN = 0;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.tracker = new StructureTracker();
    this.allocator = new StructureAllocator(width, height);
  }

  /** Clear tracker, allocator, and order state — call with CA Reset. */
  reset(): void {
    this.tracker.reset();
    this.allocator.reset();
    this.fieldOrder = 0;
    this.prevIds = new Set();
    this.prevKeys = new Set();
    this.prevPos = new Map();
    this.prevTips = new Map();
    this.resetDiag();
  }

  getFieldOrder(): number {
    return this.fieldOrder;
  }

  analyze(current: RgbField, previous: RgbField): VoicePlan {
    const structures = this.tracker.update(current, previous);
    let energySum = 0;
    const n = this.width * this.height;
    for (let i = 0; i < n; i++) {
      energySum +=
        (current.r[i]! + current.g[i]! + current.b[i]!) / 3;
    }
    const energy = energySum / n;
    this.fieldOrder = this.updateFieldOrder(structures);
    const plan = this.allocator.allocate(structures, energy, this.fieldOrder);
    this.recordDiag(structures, plan);
    return plan;
  }

  getDiag(): V2DiagSnapshot {
    const frames = Math.max(1, this.frames);
    const motions = this.motionSamples.slice().sort((a, b) => a - b);
    const medianMotion =
      motions.length === 0
        ? 0
        : motions[Math.floor(motions.length / 2)]!;
    return {
      frames: this.frames,
      structureCountMean: this.structureCountSum / frames,
      idBirths: this.idBirths,
      idDeaths: this.idDeaths,
      voiceKeyChurnRate:
        this.voiceKeyPrev > 0 ? this.voiceKeyGone / this.voiceKeyPrev : 0,
      meanProbeJump:
        this.probeJumpN > 0 ? this.probeJumpSum / this.probeJumpN : 0,
      meanTipJump: this.tipJumpN > 0 ? this.tipJumpSum / this.tipJumpN : 0,
      meanStructureAge: this.ageN > 0 ? this.ageSum / this.ageN : 0,
      medianMotion,
      probesForcedByMotionShare:
        this.motionVoiceN > 0 ? this.motionForceN / this.motionVoiceN : 0,
      fieldOrder: this.fieldOrder,
    };
  }

  resetDiag(): void {
    this.frames = 0;
    this.structureCountSum = 0;
    this.idBirths = 0;
    this.idDeaths = 0;
    this.voiceKeyGone = 0;
    this.voiceKeyPrev = 0;
    this.probeJumpSum = 0;
    this.probeJumpN = 0;
    this.tipJumpSum = 0;
    this.tipJumpN = 0;
    this.ageSum = 0;
    this.ageN = 0;
    this.motionSamples = [];
    this.motionForceN = 0;
    this.motionVoiceN = 0;
  }

  private updateFieldOrder(structures: ReturnType<StructureTracker["update"]>): number {
    if (structures.length === 0) {
      return this.fieldOrder * FIELD_ORDER_EMA_DOWN;
    }
    let deltaSum = 0;
    let speedSum = 0;
    let stabSum = 0;
    for (const s of structures) {
      deltaSum += s.temporalDelta;
      speedSum += s.speed;
      stabSum += s.stability;
    }
    const n = structures.length;
    const meanDelta = deltaSum / n;
    const meanSpeed = speedSum / n;
    const meanStab = stabSum / n;
    const instant = clamp01(
      (1 - meanDelta * 2.4) * (1 - meanSpeed / 4) * (0.35 + 0.65 * meanStab),
    );
    const ema =
      instant >= this.fieldOrder ? FIELD_ORDER_EMA_UP : FIELD_ORDER_EMA_DOWN;
    return ema * this.fieldOrder + (1 - ema) * instant;
  }

  private recordDiag(
    structures: ReturnType<StructureTracker["update"]>,
    plan: VoicePlan,
  ): void {
    const w = this.width;
    const h = this.height;
    const ids = new Set(structures.map((s) => s.id));
    this.frames++;
    this.structureCountSum += structures.length;

    for (const id of ids) {
      if (!this.prevIds.has(id)) this.idBirths++;
    }
    for (const id of this.prevIds) {
      if (!ids.has(id)) this.idDeaths++;
    }

    const keys = new Set(
      plan.voices.map((v) => `${v.structureId}:${v.probeIndex}`),
    );
    let gone = 0;
    for (const k of this.prevKeys) {
      if (!keys.has(k)) gone++;
    }
    this.voiceKeyGone += gone;
    this.voiceKeyPrev += this.prevKeys.size;

    for (const v of plan.voices) {
      const key = `${v.structureId}:${v.probeIndex}`;
      const prev = this.prevPos.get(key);
      if (prev) {
        const jump = Math.hypot(
          shortestDelta(prev.x, v.x, w),
          shortestDelta(prev.y, v.y, h),
        );
        this.probeJumpSum += jump;
        this.probeJumpN++;
      }
      this.motionSamples.push(v.motion);
      this.motionVoiceN++;
      if (v.motion >= 1.6) this.motionForceN++;
    }

    for (const s of structures) {
      this.ageSum += s.age;
      this.ageN++;
      const prevTip = this.prevTips.get(s.id);
      if (prevTip) {
        const ja = Math.hypot(
          shortestDelta(prevTip.ax, s.tipAx, w),
          shortestDelta(prevTip.ay, s.tipAy, h),
        );
        const jb = Math.hypot(
          shortestDelta(prevTip.bx, s.tipBx, w),
          shortestDelta(prevTip.by, s.tipBy, h),
        );
        this.tipJumpSum += (ja + jb) * 0.5;
        this.tipJumpN++;
      }
    }

    this.prevIds = ids;
    this.prevKeys = keys;
    this.prevPos = new Map(
      plan.voices.map((v) => [
        `${v.structureId}:${v.probeIndex}`,
        { x: v.x, y: v.y },
      ]),
    );
    this.prevTips = new Map(
      structures.map((s) => [
        s.id,
        { ax: s.tipAx, ay: s.tipAy, bx: s.tipBx, by: s.tipBy },
      ]),
    );
  }
}

function shortestDelta(from: number, to: number, period: number): number {
  let d = to - from;
  if (d > period * 0.5) d -= period;
  if (d < -period * 0.5) d += period;
  return d;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
