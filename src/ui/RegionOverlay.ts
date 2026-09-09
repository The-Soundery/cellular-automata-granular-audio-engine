import type { FieldObservation } from "../field/FieldObserver.ts";
import { FIELD_OBS } from "../field/FieldObserver.ts";
import type { AudioStats } from "../audio/AudioEngine.ts";

/** One colour per regime — diagnosis, not region identity. */
export const REGIME_HEX = {
  calm: "#e8c04a",
  tex: "#c2c2c8",
  chaos: "#ff3d1f",
  osc: "#3aa0ff",
  flow: "#2ee08a",
} as const;

/**
 * Outline map at display resolution: crisp 1px regime edges, L-brackets and
 * COM marks on every tracked region. No AABB rectangles, no interior wash.
 */
export class RegionOverlay {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "region-overlay";
    parent.appendChild(this.canvas);
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    this.ctx = ctx;
  }

  clear(): void {
    const { ctx, canvas } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  setVisible(visible: boolean): void {
    this.canvas.style.display = visible ? "block" : "none";
    if (!visible) this.clear();
  }

  get visible(): boolean {
    return this.canvas.style.display !== "none";
  }

  draw(
    obs: FieldObservation | null,
    stats: AudioStats | null = null,
  ): void {
    this.clear();
    if (!this.visible || !obs) return;

    const css = this.syncSize();
    if (css.w < 2 || css.h < 2) return;

    const { ctx } = this;
    const gridW = obs.width;
    const gridH = obs.height;
    const cw = css.w / gridW;
    const ch = css.h / gridH;

    ctx.lineWidth = 2;
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";
    ctx.setLineDash([]);

    if (obs.texturedGroups?.length) {
      for (const g of obs.texturedGroups) {
        if (!g.cells.length) continue;
        strokeEdges(ctx, g.cells, gridW, gridH, cw, ch, REGIME_HEX.tex);
        drawCross(ctx, g.comX * cw, g.comY * ch, REGIME_HEX.tex);
      }
    } else if (obs.textured.cells.length) {
      strokeEdges(ctx, obs.textured.cells, gridW, gridH, cw, ch, REGIME_HEX.tex);
    }
    if (obs.chaotic.cells.length) {
      strokeEdges(ctx, obs.chaotic.cells, gridW, gridH, cw, ch, REGIME_HEX.chaos);
      // COM mark per compact chaotic area (measurement, not ownership).
      for (const c of obs.chaotic.clusters ?? []) {
        if (!c.compact) continue;
        drawCross(ctx, c.comX * cw, c.comY * ch, REGIME_HEX.chaos);
      }
    }
    for (const g of obs.oscillators) {
      if (!g.cells.length) continue;
      strokeEdges(ctx, g.cells, gridW, gridH, cw, ch, REGIME_HEX.osc);
      const mark = marksOf(g.cells, gridW);
      drawBrackets(ctx, mark.box, cw, ch, REGIME_HEX.osc);
      drawCross(ctx, mark.comX * cw, mark.comY * ch, REGIME_HEX.osc);
    }
    for (const r of obs.coherent) {
      if (!r.cells.length) continue;
      strokeEdges(ctx, r.cells, gridW, gridH, cw, ch, REGIME_HEX.calm);
      drawBrackets(ctx, boundsOf(r.cells, gridW), cw, ch, REGIME_HEX.calm);
      drawCross(ctx, r.comX * cw, r.comY * ch, REGIME_HEX.calm);
      drawHeading(ctx, r.comX * cw, r.comY * ch, r.velX * cw, r.velY * ch, REGIME_HEX.calm, false);
    }
    for (const f of obs.flows ?? []) {
      if (!f.cells.length) continue;
      const cells = dilateCells(f.cells, gridW, gridH, FIELD_OBS.flowJoinRadius);
      strokeEdges(ctx, cells, gridW, gridH, cw, ch, REGIME_HEX.flow);
      drawBrackets(ctx, boundsOf(f.cells, gridW), cw, ch, REGIME_HEX.flow);
      drawCross(ctx, f.comX * cw, f.comY * ch, REGIME_HEX.flow);
      drawHeading(ctx, f.comX * cw, f.comY * ch, f.velX * cw, f.velY * ch, REGIME_HEX.flow, true);
    }

    // Live grains on the field: one dot per active voice, regime-coloured.
    // This is the see↔hear diagnostic — a structure with no dots is silent.
    if (stats?.listen?.length) {
      const r = Math.max(1.6, Math.min(cw, ch) * 0.45);
      for (const g of stats.listen) {
        const key =
          g.regime === "texture"
            ? "tex"
            : ((g.regime ?? "chaos") as keyof typeof REGIME_HEX);
        ctx.fillStyle = REGIME_HEX[key] ?? REGIME_HEX.chaos;
        ctx.globalAlpha = g.sounding ? 0.9 : 0.35;
        ctx.beginPath();
        ctx.arc(
          (g.x + 0.5) * cw,
          (g.y + 0.5) * ch,
          g.sounding ? r : r * 0.6,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  private syncSize(): { w: number; h: number } {
    const parent = this.canvas.parentElement;
    const w = Math.max(1, parent?.clientWidth ?? 0);
    const h = Math.max(1, parent?.clientHeight ?? 0);
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const bw = Math.max(1, Math.round(w * dpr));
    const bh = Math.max(1, Math.round(h * dpr));
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width = bw;
      this.canvas.height = bh;
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h };
  }
}

function strokeEdges(
  ctx: CanvasRenderingContext2D,
  cells: Uint32Array,
  w: number,
  h: number,
  cw: number,
  ch: number,
  color: string,
): void {
  const inRegion = new Set<number>();
  for (let i = 0; i < cells.length; i++) inRegion.add(cells[i]!);
  ctx.strokeStyle = color;
  ctx.beginPath();
  for (let i = 0; i < cells.length; i++) {
    const ci = cells[i]!;
    const cx = ci % w;
    const cy = (ci / w) | 0;
    if (!isEdgeCell(inRegion, cx, cy, w, h)) continue;
    const x0 = cx * cw;
    const y0 = cy * ch;
    const x1 = x0 + cw;
    const y1 = y0 + ch;
    if (!inRegion.has(cy * w + ((cx + 1) % w))) {
      ctx.moveTo(x1, y0);
      ctx.lineTo(x1, y1);
    }
    if (!inRegion.has(cy * w + ((cx - 1 + w) % w))) {
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0, y1);
    }
    if (!inRegion.has(((cy + 1) % h) * w + cx)) {
      ctx.moveTo(x0, y1);
      ctx.lineTo(x1, y1);
    }
    if (!inRegion.has(((cy - 1 + h) % h) * w + cx)) {
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y0);
    }
  }
  ctx.stroke();
}

function boundsOf(
  cells: Uint32Array,
  w: number,
): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = w;
  let minY = w;
  let maxX = 0;
  let maxY = 0;
  for (let i = 0; i < cells.length; i++) {
    const ci = cells[i]!;
    const x = ci % w;
    const y = (ci / w) | 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

function marksOf(
  cells: Uint32Array,
  w: number,
): {
  box: { minX: number; minY: number; maxX: number; maxY: number };
  comX: number;
  comY: number;
} {
  const box = boundsOf(cells, w);
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < cells.length; i++) {
    const ci = cells[i]!;
    sx += ci % w;
    sy += (ci / w) | 0;
  }
  const n = Math.max(1, cells.length);
  return { box, comX: sx / n, comY: sy / n };
}

function drawBrackets(
  ctx: CanvasRenderingContext2D,
  box: { minX: number; minY: number; maxX: number; maxY: number },
  cw: number,
  ch: number,
  color: string,
): void {
  const x0 = box.minX * cw;
  const y0 = box.minY * ch;
  const x1 = (box.maxX + 1) * cw;
  const y1 = (box.maxY + 1) * ch;
  const L = Math.max(6, Math.min(14, Math.min(x1 - x0, y1 - y0) * 0.2));
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.moveTo(x0, y0 + L);
  ctx.lineTo(x0, y0);
  ctx.lineTo(x0 + L, y0);
  ctx.moveTo(x1 - L, y0);
  ctx.lineTo(x1, y0);
  ctx.lineTo(x1, y0 + L);
  ctx.moveTo(x1, y1 - L);
  ctx.lineTo(x1, y1);
  ctx.lineTo(x1 - L, y1);
  ctx.moveTo(x0 + L, y1);
  ctx.lineTo(x0, y1);
  ctx.lineTo(x0, y1 - L);
  ctx.stroke();
}

function drawCross(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
): void {
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.moveTo(x - 4, y);
  ctx.lineTo(x + 4, y);
  ctx.moveTo(x, y - 4);
  ctx.lineTo(x, y + 4);
  ctx.stroke();
}

function drawHeading(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  vx: number,
  vy: number,
  color: string,
  dashed: boolean,
): void {
  if (Math.hypot(vx, vy) < 0.8) return;
  ctx.strokeStyle = color;
  if (dashed) ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + vx * 4, y + vy * 4);
  ctx.stroke();
  ctx.setLineDash([]);
}

function dilateCells(
  cells: Uint32Array,
  w: number,
  h: number,
  radius: number,
): Uint32Array {
  const seen = new Uint8Array(w * h);
  const out: number[] = [];
  for (let c = 0; c < cells.length; c++) {
    const i = cells[c]!;
    const x = i % w;
    const y = (i / w) | 0;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const j = ((y + dy + h) % h) * w + ((x + dx + w) % w);
        if (seen[j]) continue;
        seen[j] = 1;
        out.push(j);
      }
    }
  }
  return Uint32Array.from(out);
}

function isEdgeCell(
  inRegion: Set<number>,
  x: number,
  y: number,
  w: number,
  h: number,
): boolean {
  const nIdx = [
    y * w + ((x + 1) % w),
    y * w + ((x - 1 + w) % w),
    ((y + 1) % h) * w + x,
    ((y - 1 + h) % h) * w + x,
  ];
  for (const j of nIdx) {
    if (!inRegion.has(j)) return true;
  }
  return false;
}
