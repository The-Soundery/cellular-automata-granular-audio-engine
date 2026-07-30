import type { RgbField } from "./FrameObserver.ts";
import {
  extractRegions,
  toroidalDelta,
  toroidalDist2,
  type RawRegion,
} from "./RegionExtractor.ts";

export interface TrackedStructure {
  id: number;
  area: number;
  mass: number;
  cx: number;
  cy: number;
  /** Shortest-path velocity in cells/frame (toroidal). */
  vx: number;
  vy: number;
  speed: number;
  extentW: number;
  extentH: number;
  /** Smoothed major-axis unit direction for stable multi-probes. */
  axisX: number;
  axisY: number;
  /** Half-extent along major axis (cells), EMA-smoothed. */
  axisSpan: number;
  tipAx: number;
  tipAy: number;
  tipBx: number;
  tipBy: number;
  meanR: number;
  meanG: number;
  meanB: number;
  colourVariance: number;
  spatialVariance: number;
  /** EMA stability: high when slow and colour-stable. */
  stability: number;
  /** Frame-to-frame colour/mass change. */
  temporalDelta: number;
  age: number;
  /** Consecutive unmatched frames (coasting). */
  missCount: number;
}

/** Generous match radius — prefer continuity of structure identity. */
const MATCH_DIST = 28;
const FORCE_MATCH_DIST = 36;
/** Slow release — don't claim calm while the structure is still changing. */
const STABILITY_EMA_DOWN = 0.94;
/** Fast attack — visible settling should register within ~0.5–1 s @ 30 fps. */
const STABILITY_EMA_UP = 0.78;
const GEOM_EMA = 0.72;
const MAX_TRACKED = 40;
/** Keep unmatched structures alive briefly so flicker doesn't kill voices. */
const COAST_MAX = 8;

export class StructureTracker {
  private nextId = 1;
  private prev: TrackedStructure[] = [];

  get structures(): readonly TrackedStructure[] {
    return this.prev;
  }

  reset(): void {
    this.nextId = 1;
    this.prev = [];
  }

  /**
   * Extract regions and match to previous structures with strong identity bias.
   * Philosophy: structures are musical objects — their IDs must persist through
   * local flicker so the ear can follow them.
   */
  update(current: RgbField, previous: RgbField): TrackedStructure[] {
    const regions = extractRegions(current);
    const w = current.width;
    const h = current.height;
    const usedPrev = new Set<number>();
    const usedReg = new Set<number>();
    const next: TrackedStructure[] = [];

    const candidates: { ri: number; pi: number; cost: number }[] = [];

    for (let ri = 0; ri < regions.length; ri++) {
      const reg = regions[ri]!;
      for (let pi = 0; pi < this.prev.length; pi++) {
        const p = this.prev[pi]!;
        const dist = Math.sqrt(toroidalDist2(p.cx, p.cy, reg.cx, reg.cy, w, h));
        if (dist > MATCH_DIST) continue;
        const areaRatio =
          Math.min(p.area, reg.area) / Math.max(1, Math.max(p.area, reg.area));
        const colourDist =
          (Math.abs(p.meanR - reg.meanR) +
            Math.abs(p.meanG - reg.meanG) +
            Math.abs(p.meanB - reg.meanB)) /
          3;
        const predX = (p.cx + p.vx + w) % w;
        const predY = (p.cy + p.vy + h) % h;
        const predDist = Math.sqrt(
          toroidalDist2(predX, predY, reg.cx, reg.cy, w, h),
        );
        // Identity-first: distance dominates; area/colour are soft ties.
        // Age bonus keeps long-lived structures preferred over newborns.
        const ageBonus = Math.min(4, p.age * 0.08);
        const cost =
          dist * 1.0 +
          predDist * 0.25 +
          (1 - areaRatio) * 2.5 +
          colourDist * 3.0 -
          ageBonus;
        candidates.push({ ri, pi, cost });
      }
    }

    candidates.sort((a, b) => a.cost - b.cost);

    for (const c of candidates) {
      if (usedReg.has(c.ri) || usedPrev.has(c.pi)) continue;
      usedReg.add(c.ri);
      usedPrev.add(c.pi);
      next.push(
        this.evolve(this.prev[c.pi]!, regions[c.ri]!, current, previous, w, h),
      );
    }

    // Force-match remaining regions to nearest unmatched track before birthing.
    for (let ri = 0; ri < regions.length; ri++) {
      if (usedReg.has(ri)) continue;
      const reg = regions[ri]!;
      let bestPi = -1;
      let bestDist = Infinity;
      for (let pi = 0; pi < this.prev.length; pi++) {
        if (usedPrev.has(pi)) continue;
        const d = Math.sqrt(
          toroidalDist2(this.prev[pi]!.cx, this.prev[pi]!.cy, reg.cx, reg.cy, w, h),
        );
        if (d < bestDist) {
          bestDist = d;
          bestPi = pi;
        }
      }
      if (bestPi >= 0 && bestDist <= FORCE_MATCH_DIST) {
        usedReg.add(ri);
        usedPrev.add(bestPi);
        next.push(
          this.evolve(this.prev[bestPi]!, reg, current, previous, w, h),
        );
      }
    }

    for (let ri = 0; ri < regions.length && next.length < MAX_TRACKED; ri++) {
      if (usedReg.has(ri)) continue;
      next.push(this.birth(regions[ri]!, w, h));
    }

    // Coast unmatched previous structures — prevents voice death on flicker.
    for (let pi = 0; pi < this.prev.length && next.length < MAX_TRACKED; pi++) {
      if (usedPrev.has(pi)) continue;
      const p = this.prev[pi]!;
      if (p.missCount >= COAST_MAX) continue;
      next.push(this.coast(p, w, h));
    }

    this.prev = next;
    return next;
  }

  private birth(reg: RawRegion, w: number, h: number): TrackedStructure {
    const axis = axisFromTips(reg, w, h);
    return {
      id: this.nextId++,
      area: reg.area,
      mass: reg.mass,
      cx: reg.cx,
      cy: reg.cy,
      vx: 0,
      vy: 0,
      speed: 0,
      extentW: reg.extentW,
      extentH: reg.extentH,
      axisX: axis.x,
      axisY: axis.y,
      axisSpan: axis.span,
      tipAx: reg.tipAx,
      tipAy: reg.tipAy,
      tipBx: reg.tipBx,
      tipBy: reg.tipBy,
      meanR: reg.meanR,
      meanG: reg.meanG,
      meanB: reg.meanB,
      colourVariance: reg.colourVariance,
      spatialVariance: reg.spatialVariance,
      stability: 0.5,
      temporalDelta: 0.5,
      age: 1,
      missCount: 0,
    };
  }

  private coast(prev: TrackedStructure, w: number, h: number): TrackedStructure {
    const vx = prev.vx * 0.5;
    const vy = prev.vy * 0.5;
    return {
      ...prev,
      cx: wrap(prev.cx + vx, w),
      cy: wrap(prev.cy + vy, h),
      vx,
      vy,
      speed: Math.hypot(vx, vy),
      mass: prev.mass * 0.92,
      stability: Math.min(1, prev.stability * 0.98 + 0.02),
      temporalDelta: prev.temporalDelta * 0.85,
      age: prev.age + 1,
      missCount: prev.missCount + 1,
    };
  }

  private evolve(
    prev: TrackedStructure,
    reg: RawRegion,
    current: RgbField,
    previous: RgbField,
    w: number,
    h: number,
  ): TrackedStructure {
    const rawVx = toroidalDelta(prev.cx, reg.cx, w);
    const rawVy = toroidalDelta(prev.cy, reg.cy, h);
    // EMA centroid so probe topology doesn't jitter with region flicker.
    const cx = wrap(prev.cx + rawVx * (1 - GEOM_EMA), w);
    const cy = wrap(prev.cy + rawVy * (1 - GEOM_EMA), h);
    const vx = toroidalDelta(prev.cx, cx, w);
    const vy = toroidalDelta(prev.cy, cy, h);
    const speed = Math.hypot(vx, vy);

    const colourDist =
      (Math.abs(prev.meanR - reg.meanR) +
        Math.abs(prev.meanG - reg.meanG) +
        Math.abs(prev.meanB - reg.meanB)) /
      3;

    let temporalDelta = colourDist;
    if (reg.cells.length > 0 && previous) {
      let dSum = 0;
      const step = Math.max(1, (reg.cells.length / 32) | 0);
      let samples = 0;
      for (let k = 0; k < reg.cells.length; k += step) {
        const i = reg.cells[k]!;
        dSum +=
          (Math.abs(current.r[i]! - previous.r[i]!) +
            Math.abs(current.g[i]! - previous.g[i]!) +
            Math.abs(current.b[i]! - previous.b[i]!)) /
          3;
        samples++;
      }
      temporalDelta = samples > 0 ? dSum / samples : colourDist;
    }

    const instantStab = clamp01(1 - temporalDelta * 2.2) * clamp01(1 - speed / 6);
    const stabEma =
      instantStab >= prev.stability ? STABILITY_EMA_UP : STABILITY_EMA_DOWN;
    const stability = stabEma * prev.stability + (1 - stabEma) * instantStab;

    const rawAxis = axisFromTips(reg, w, h);
    let axisX = prev.axisX * GEOM_EMA + rawAxis.x * (1 - GEOM_EMA);
    let axisY = prev.axisY * GEOM_EMA + rawAxis.y * (1 - GEOM_EMA);
    const alen = Math.hypot(axisX, axisY) || 1;
    axisX /= alen;
    axisY /= alen;
    // Flip if reversed relative to previous (PCA sign flip).
    if (axisX * prev.axisX + axisY * prev.axisY < 0) {
      axisX = -axisX;
      axisY = -axisY;
    }
    const axisSpan =
      prev.axisSpan * GEOM_EMA + rawAxis.span * (1 - GEOM_EMA);
    const extentW = prev.extentW * GEOM_EMA + reg.extentW * (1 - GEOM_EMA);
    const extentH = prev.extentH * GEOM_EMA + reg.extentH * (1 - GEOM_EMA);

    const tipAx = wrap(cx + axisX * axisSpan, w);
    const tipAy = wrap(cy + axisY * axisSpan, h);
    const tipBx = wrap(cx - axisX * axisSpan, w);
    const tipBy = wrap(cy - axisY * axisSpan, h);

    return {
      id: prev.id,
      area: Math.round(prev.area * GEOM_EMA + reg.area * (1 - GEOM_EMA)),
      mass: prev.mass * GEOM_EMA + reg.mass * (1 - GEOM_EMA),
      cx,
      cy,
      vx,
      vy,
      speed,
      extentW,
      extentH,
      axisX,
      axisY,
      axisSpan,
      tipAx,
      tipAy,
      tipBx,
      tipBy,
      meanR: prev.meanR * GEOM_EMA + reg.meanR * (1 - GEOM_EMA),
      meanG: prev.meanG * GEOM_EMA + reg.meanG * (1 - GEOM_EMA),
      meanB: prev.meanB * GEOM_EMA + reg.meanB * (1 - GEOM_EMA),
      colourVariance:
        prev.colourVariance * GEOM_EMA + reg.colourVariance * (1 - GEOM_EMA),
      spatialVariance:
        prev.spatialVariance * GEOM_EMA + reg.spatialVariance * (1 - GEOM_EMA),
      stability,
      temporalDelta,
      age: prev.age + 1,
      missCount: 0,
    };
  }
}

function axisFromTips(
  reg: RawRegion,
  w: number,
  h: number,
): { x: number; y: number; span: number } {
  const dx = toroidalDelta(reg.cx, reg.tipAx, w);
  const dy = toroidalDelta(reg.cy, reg.tipAy, h);
  const span = Math.max(1, Math.max(reg.extentW, reg.extentH) * 0.45);
  const len = Math.hypot(dx, dy);
  if (len < 1e-3) {
    if (reg.extentW >= reg.extentH) return { x: 1, y: 0, span };
    return { x: 0, y: 1, span };
  }
  return { x: dx / len, y: dy / len, span };
}

function wrap(v: number, period: number): number {
  let x = v % period;
  if (x < 0) x += period;
  return x;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
