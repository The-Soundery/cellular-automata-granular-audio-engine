import type { RgbField } from "./FrameObserver.ts";

export const VOICE_BUDGET = 32;

/**
 * V2 Layer 5 — finite sonic energy from visual brightness (mean RGB).
 * R/G/B are Layer-2 timbral material only (density / complexity / coherence).
 * Topology (sample + spectrum) comes from cell X/Y in the worklet.
 * Near-black → silent; mid fields ≈ unity gain.
 */
export const ENERGY_TARGET = 0.26;
const ENERGY_SILENCE = 0.03;
export const MASTER_GAIN_MAX = 2.5;

const LUMINANCE_GATE = 0.025;

/** Active (border) information-density floor. */
const DENSITY_GATE = 5e-4;

/** Sustain claim floor. */
const SUSTAIN_GATE = 0.007;
const SUSTAIN_COHERENCE_MIN = 0.3;

/**
 * Soft activity scale for busy/chaos.
 * Calm lit fields still get a listening floor from coherent coverage —
 * large structures share voices; chaos claims more slots within the budget.
 */
const CALM_LISTEN_MIN = 8;
const CALM_LISTEN_MAX = 14;
const BUSY_VOICE_CEILING = VOICE_BUDGET;

const RGB_MERGE_EPS = 0.16;
const MERGE_RADIUS_SUSTAIN = 11;
const MERGE_RADIUS_ACTIVE = 5;

/** Layer 4 stickiness — stay with coherent structures through time. */
const STICKY_RADIUS_SUSTAIN = 6;
const STICKY_RADIUS_ACTIVE = 3;
/** Previous sustain kept if score ≥ this × best fresh. */
const STICKY_SCORE_RATIO_SUSTAIN = 0.3;
const STICKY_SCORE_RATIO_ACTIVE = 0.55;

const MIN_DIST_SUSTAIN = 11;
const MIN_DIST_ACTIVE = 8;

const STABILITY_EMA = 0.95;
const INTERIOR_CLIMB_RADIUS = 7;

/** Layer 3 — coherent regions sustain longer grains. */
const GRAIN_LEN_MIN = 0.025;
const GRAIN_LEN_MAX = 0.28;

export interface VoiceParams {
  id: number;
  cellIndex: number;
  /** Cell column — worklet maps to sample position (V2 Layer 1). */
  x: number;
  /** Cell row — worklet maps to spectral position (V2 Layer 1). */
  y: number;
  /** Density — timbral material (V2 Layer 2). */
  r: number;
  /** Complexity — timbral material (V2 Layer 2). */
  g: number;
  /** Coherence — timbral material (V2 Layer 2). */
  b: number;
  grainLengthSec: number;
  overlap: number;
  persistence: number;
  amplitudeShare: number;
}

export interface VoicePlan {
  masterGain: number;
  energy: number;
  gridWidth: number;
  gridHeight: number;
  voices: VoiceParams[];
  activeVoiceCount: number;
}

function brightness(r: number, g: number, b: number): number {
  return (r + g + b) / 3;
}

export class FieldMetrics {
  private readonly width: number;
  private readonly height: number;
  private readonly coherence: Float32Array;
  private readonly variance: Float32Array;
  private readonly delta: Float32Array;
  private readonly stability: Float32Array;
  private readonly infoDensity: Float32Array;
  private readonly sustainScore: Float32Array;
  private readonly lum: Float32Array;
  private primed = false;
  private prevSustain: number[] = [];
  private prevActive: number[] = [];

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    const n = width * height;
    this.coherence = new Float32Array(n);
    this.variance = new Float32Array(n);
    this.delta = new Float32Array(n);
    this.stability = new Float32Array(n);
    this.infoDensity = new Float32Array(n);
    this.sustainScore = new Float32Array(n);
    this.lum = new Float32Array(n);
  }

  analyze(current: RgbField, previous: RgbField): VoicePlan {
    const { width: w, height: h } = this;
    const n = w * h;

    let energySum = 0;
    let varSumField = 0;
    let deltaSumField = 0;
    let cohSumLit = 0;
    let litCount = 0;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const sr = current.r[i]!;
        const sg = current.g[i]!;
        const sb = current.b[i]!;
        const L = brightness(sr, sg, sb);
        this.lum[i] = L;
        energySum += L;

        let absDiff = 0;
        let count = 0;
        let meanR = 0;
        let meanG = 0;
        let meanB = 0;
        const samples: number[] = [];

        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = (x + dx + w) % w;
            const ny = (y + dy + h) % h;
            const ni = ny * w + nx;
            const nr = current.r[ni]!;
            const ng = current.g[ni]!;
            const nb = current.b[ni]!;
            absDiff +=
              (Math.abs(nr - sr) + Math.abs(ng - sg) + Math.abs(nb - sb)) / 3;
            meanR += nr;
            meanG += ng;
            meanB += nb;
            samples.push(nr, ng, nb);
            count++;
          }
        }

        const inv = 1 / count;
        meanR *= inv;
        meanG *= inv;
        meanB *= inv;
        let vSum = 0;
        for (let s = 0; s < samples.length; s += 3) {
          const dr = samples[s]! - meanR;
          const dg = samples[s + 1]! - meanG;
          const db = samples[s + 2]! - meanB;
          vSum += (dr * dr + dg * dg + db * db) / 3;
        }

        const coh = 1 - absDiff * inv;
        const vari = vSum * inv;
        this.coherence[i] = coh;
        this.variance[i] = vari;
        varSumField += vari;

        const pr = previous.r[i]!;
        const pg = previous.g[i]!;
        const pb = previous.b[i]!;
        const d =
          (Math.abs(sr - pr) + Math.abs(sg - pg) + Math.abs(sb - pb)) / 3;
        this.delta[i] = d;
        deltaSumField += d;

        if (!this.primed) {
          this.stability[i] = 1 - d;
        } else {
          this.stability[i] =
            STABILITY_EMA * this.stability[i]! + (1 - STABILITY_EMA) * (1 - d);
        }

        const stab = this.stability[i]!;
        const flat = clamp01(1 - vari);

        this.infoDensity[i] =
          (vari + 0.04) * Math.pow(d + 0.025, 1.6) * (L + 0.04);

        // Flat² prefers interiors. Stickiness (Layer 4) keeps large structures sounding.
        this.sustainScore[i] =
          L * flat * flat * (coh + 0.08) * (stab + 0.1);

        if (L >= LUMINANCE_GATE) {
          cohSumLit += coh;
          litCount++;
        }
      }
    }

    this.primed = true;
    const energy = energySum / n;

    let masterGain = 0;
    if (energy >= ENERGY_SILENCE) {
      masterGain = Math.min(MASTER_GAIN_MAX, ENERGY_TARGET / energy);
    }

    const meanVar = varSumField / n;
    const meanDelta = deltaSumField / n;
    const meanCohLit = litCount > 0 ? cohSumLit / litCount : 0;
    const litFraction = litCount / n;

    // Structural activity: change + differentiation. Calm flats ≈ 0; chaos ≈ 1.
    const structural =
      clamp01(meanVar * 8) * 0.45 +
      clamp01(meanDelta * 10) * 0.45 +
      clamp01(1 - meanCohLit) * 0.1;
    const activity = Math.pow(structural, 1.35);

    // Layer 5 listening floor: lit coherent coverage deserves shared wash voices.
    // Near-black → floor collapses with energy/masterGain silence path.
    const coherentLit = litFraction * meanCohLit;
    const calmListen = Math.round(
      CALM_LISTEN_MIN + coherentLit * (CALM_LISTEN_MAX - CALM_LISTEN_MIN),
    );

    const voiceBudget =
      energy < ENERGY_SILENCE
        ? 0
        : Math.max(
            calmListen,
            Math.min(
              BUSY_VOICE_CEILING,
              Math.round(
                calmListen + activity * (BUSY_VOICE_CEILING - calmListen),
              ),
            ),
          );

    if (voiceBudget <= 0 || masterGain <= 0) {
      this.prevSustain = [];
      this.prevActive = [];
      return {
        masterGain: 0,
        energy,
        gridWidth: w,
        gridHeight: h,
        voices: [],
        activeVoiceCount: 0,
      };
    }

    // Calm → mostly sustain wash (large structures). Busy → more active grain slots.
    const sustainFrac = 0.9 - activity * 0.5;
    const sustainSlots = Math.max(
      1,
      Math.min(voiceBudget, Math.round(voiceBudget * sustainFrac)),
    );
    const activeSlots = Math.max(0, voiceBudget - sustainSlots);

    const densOrder = new Int32Array(n);
    const sustainOrder = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      densOrder[i] = i;
      sustainOrder[i] = i;
    }
    densOrder.sort((a, b) => this.infoDensity[b]! - this.infoDensity[a]!);
    sustainOrder.sort(
      (a, b) => this.sustainScore[b]! - this.sustainScore[a]!,
    );

    const covered = new Uint8Array(n);

    const selectedSustain = pickPool({
      order: sustainOrder,
      scores: this.sustainScore,
      prev: this.prevSustain,
      budget: sustainSlots,
      covered,
      field: current,
      w,
      h,
      lum: this.lum,
      coherence: this.coherence,
      variance: this.variance,
      minDist: MIN_DIST_SUSTAIN,
      mergeRadius: MERGE_RADIUS_SUSTAIN,
      gate: SUSTAIN_GATE,
      coherenceMin: SUSTAIN_COHERENCE_MIN,
      stickyRadius: STICKY_RADIUS_SUSTAIN,
      stickyRatio: STICKY_SCORE_RATIO_SUSTAIN,
      refineInterior: true,
    });

    const selectedActive =
      activeSlots > 0
        ? pickPool({
            order: densOrder,
            scores: this.infoDensity,
            prev: this.prevActive,
            budget: activeSlots,
            covered,
            field: current,
            w,
            h,
            lum: this.lum,
            coherence: this.coherence,
            variance: this.variance,
            minDist: MIN_DIST_ACTIVE,
            mergeRadius: MERGE_RADIUS_ACTIVE,
            gate: DENSITY_GATE,
            coherenceMin: 0,
            stickyRadius: STICKY_RADIUS_ACTIVE,
            stickyRatio: STICKY_SCORE_RATIO_ACTIVE,
            refineInterior: false,
          })
        : [];

    if (
      (selectedSustain.length === 0 && selectedActive.length === 0) ||
      masterGain <= 0
    ) {
      this.prevSustain = [];
      this.prevActive = [];
      return {
        masterGain: 0,
        energy,
        gridWidth: w,
        gridHeight: h,
        voices: [],
        activeVoiceCount: 0,
      };
    }

    const selected = [...selectedSustain, ...selectedActive];
    const voices: VoiceParams[] = [];
    const voiceBrightness: number[] = [];

    for (let vi = 0; vi < selected.length; vi++) {
      const i = selected[vi]!;
      const x = i % w;
      const y = (i / w) | 0;
      const coh = clamp01(this.coherence[i]!);
      const vari = clamp01(this.variance[i]!);
      const stab = clamp01(this.stability[i]!);
      const dlt = clamp01(this.delta[i]!);
      const isSustain = vi < selectedSustain.length;

      // Layer 3: spatial coherence → longer grains / more overlap for structures.
      const calm = 0.55 * stab + 0.45 * (1 - dlt);
      let lengthBlend = 0.65 * coh + 0.35 * calm;
      if (isSustain) lengthBlend = Math.max(lengthBlend, 0.88);
      const grainLengthSec =
        GRAIN_LEN_MIN + lengthBlend * (GRAIN_LEN_MAX - GRAIN_LEN_MIN);

      let overlap = clamp01(0.45 * (1 - vari) + 0.55 * stab);
      if (isSustain) overlap = Math.max(overlap, 0.9);

      // Layer 4: temporal stability → persistence / slower retrigger in worklet.
      let persistence = 0.15 + 0.85 * stab;
      if (isSustain) persistence = Math.max(persistence, 0.85);

      voices.push({
        id: vi,
        cellIndex: i,
        x,
        y,
        r: current.r[i]!,
        g: current.g[i]!,
        b: current.b[i]!,
        grainLengthSec,
        overlap,
        persistence,
        amplitudeShare: 0,
      });
      voiceBrightness.push(this.lum[i]!);
    }

    this.prevSustain = selectedSustain.slice();
    this.prevActive = selectedActive.slice();

    let lumSum = 0;
    for (const L of voiceBrightness) lumSum += Math.max(0, L);
    if (lumSum <= 1e-8) {
      for (const v of voices) v.amplitudeShare = 0;
      return {
        masterGain: 0,
        energy,
        gridWidth: w,
        gridHeight: h,
        voices,
        activeVoiceCount: voices.length,
      };
    }
    for (let vi = 0; vi < voices.length; vi++) {
      voices[vi]!.amplitudeShare = Math.max(0, voiceBrightness[vi]!) / lumSum;
    }

    return {
      masterGain,
      energy,
      gridWidth: w,
      gridHeight: h,
      voices,
      activeVoiceCount: voices.length,
    };
  }
}

interface PickOpts {
  order: Int32Array;
  scores: Float32Array;
  prev: number[];
  budget: number;
  covered: Uint8Array;
  field: RgbField;
  w: number;
  h: number;
  lum: Float32Array;
  coherence: Float32Array;
  variance: Float32Array;
  minDist: number;
  mergeRadius: number;
  gate: number;
  coherenceMin: number;
  stickyRadius: number;
  stickyRatio: number;
  refineInterior: boolean;
}

function pickPool(opts: PickOpts): number[] {
  const {
    order,
    scores,
    prev,
    budget,
    covered,
    field,
    w,
    h,
    lum,
    coherence,
    variance,
    minDist,
    mergeRadius,
    gate,
    coherenceMin,
    stickyRadius,
    stickyRatio,
    refineInterior,
  } = opts;

  if (budget <= 0) return [];

  const selected: number[] = [];

  let bestFresh = 0;
  for (let k = 0; k < Math.min(order.length, 128); k++) {
    const i = order[k]!;
    if (lum[i]! < LUMINANCE_GATE) continue;
    if (coherenceMin > 0 && coherence[i]! < coherenceMin) continue;
    if (scores[i]! > bestFresh) bestFresh = scores[i]!;
  }
  if (bestFresh <= 0) bestFresh = gate;

  // Layer 4: keep previous voices while they remain competitive (especially sustain).
  for (const p of prev) {
    if (selected.length >= budget) break;
    if (p < 0 || p >= scores.length) continue;

    let sticky = -1;
    let stickyScore = -Infinity;
    const px = p % w;
    const py = (p / w) | 0;
    for (let dy = -stickyRadius; dy <= stickyRadius; dy++) {
      for (let dx = -stickyRadius; dx <= stickyRadius; dx++) {
        const x = (px + dx + w) % w;
        const y = (py + dy + h) % h;
        const i = y * w + x;
        if (covered[i]) continue;
        if (lum[i]! < LUMINANCE_GATE) continue;
        if (coherenceMin > 0 && coherence[i]! < coherenceMin) continue;
        if (scores[i]! < gate) continue;
        if (scores[i]! < bestFresh * stickyRatio) continue;
        if (scores[i]! > stickyScore) {
          stickyScore = scores[i]!;
          sticky = i;
        }
      }
    }
    if (sticky < 0) continue;

    if (refineInterior) {
      sticky = climbToInterior(sticky, scores, variance, lum, w, h);
    }
    if (covered[sticky] || lum[sticky]! < LUMINANCE_GATE) continue;
    if (!farEnough(sticky, selected, w, h, minDist)) continue;

    selected.push(sticky);
    markPatch(
      covered,
      w,
      h,
      sticky % w,
      (sticky / w) | 0,
      field,
      sticky,
      mergeRadius,
    );
  }

  for (let k = 0; k < order.length && selected.length < budget; k++) {
    let i = order[k]!;
    if (covered[i]) continue;
    if (lum[i]! < LUMINANCE_GATE) continue;
    if (coherenceMin > 0 && coherence[i]! < coherenceMin) continue;
    if (scores[i]! < gate && selected.length >= Math.min(1, budget)) break;

    if (refineInterior) {
      i = climbToInterior(i, scores, variance, lum, w, h);
      if (covered[i] || lum[i]! < LUMINANCE_GATE) continue;
    }
    if (!farEnough(i, selected, w, h, minDist)) continue;

    selected.push(i);
    markPatch(covered, w, h, i % w, (i / w) | 0, field, i, mergeRadius);
  }

  return selected;
}

function climbToInterior(
  seed: number,
  scores: Float32Array,
  variance: Float32Array,
  lum: Float32Array,
  w: number,
  h: number,
): number {
  let best = seed;
  let bestScore = -Infinity;
  const sx = seed % w;
  const sy = (seed / w) | 0;

  for (let dy = -INTERIOR_CLIMB_RADIUS; dy <= INTERIOR_CLIMB_RADIUS; dy++) {
    for (let dx = -INTERIOR_CLIMB_RADIUS; dx <= INTERIOR_CLIMB_RADIUS; dx++) {
      const x = (sx + dx + w) % w;
      const y = (sy + dy + h) % h;
      const i = y * w + x;
      if (lum[i]! < LUMINANCE_GATE) continue;
      const flatness = clamp01(1 - variance[i]!);
      if (flatness < 0.5) continue;
      const score = scores[i]! * (0.2 + 0.8 * flatness * flatness);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
  }
  return bestScore > -Infinity ? best : seed;
}

function farEnough(
  cell: number,
  selected: number[],
  w: number,
  h: number,
  minDist: number,
): boolean {
  if (selected.length === 0) return true;
  const cx = cell % w;
  const cy = (cell / w) | 0;
  for (const s of selected) {
    const sx = s % w;
    const sy = (s / w) | 0;
    let dx = Math.abs(cx - sx);
    let dy = Math.abs(cy - sy);
    dx = Math.min(dx, w - dx);
    dy = Math.min(dy, h - dy);
    if (dx * dx + dy * dy < minDist * minDist) return false;
  }
  return true;
}

function markPatch(
  covered: Uint8Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  field: RgbField,
  seedIndex: number,
  radius: number,
): void {
  const sr = field.r[seedIndex]!;
  const sg = field.g[seedIndex]!;
  const sb = field.b[seedIndex]!;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = (cx + dx + w) % w;
      const y = (cy + dy + h) % h;
      const i = y * w + x;
      const dist =
        (Math.abs(field.r[i]! - sr) +
          Math.abs(field.g[i]! - sg) +
          Math.abs(field.b[i]! - sb)) /
        3;
      if (dist < RGB_MERGE_EPS) covered[i] = 1;
    }
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
