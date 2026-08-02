import type { FieldObservation } from "../field/FieldObserver.ts";
import type { AudioStats } from "../audio/AudioEngine.ts";
import { GRID_SIZE } from "../ca/UtomataHost.ts";

/**
 * Debug visualisation: observational region cell silhouettes with bright edges.
 * Not listening posts / lattice ears. No AABB rectangles.
 */
export class RegionOverlay {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "region-overlay";
    this.canvas.width = GRID_SIZE;
    this.canvas.height = GRID_SIZE;
    parent.appendChild(this.canvas);
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    this.ctx = ctx;
  }

  clear(): void {
    this.ctx.clearRect(0, 0, GRID_SIZE, GRID_SIZE);
  }

  setVisible(visible: boolean): void {
    this.canvas.style.display = visible ? "block" : "none";
    if (!visible) this.clear();
  }

  get visible(): boolean {
    return this.canvas.style.display !== "none";
  }

  draw(obs: FieldObservation | null, stats: AudioStats | null = null): void {
    const { ctx } = this;
    ctx.clearRect(0, 0, GRID_SIZE, GRID_SIZE);
    if (!this.visible || !obs) return;

    const w = obs.width;
    const h = obs.height;
    const scaleX = GRID_SIZE / w;
    const scaleY = GRID_SIZE / h;
    const cellW = Math.max(1, scaleX);
    const cellH = Math.max(1, scaleY);

    for (const r of obs.coherent) {
      const hue = (r.id * 47) % 360;
      const cells = r.cells;
      if (!cells || cells.length === 0) continue;

      const inRegion = new Set<number>();
      for (let i = 0; i < cells.length; i++) inRegion.add(cells[i]!);

      // Interior: dim fill. Edge cells (missing 4-neighbour): brighter outline.
      for (let i = 0; i < cells.length; i++) {
        const ci = cells[i]!;
        const cx = ci % w;
        const cy = (ci / w) | 0;
        const edge = isEdgeCell(inRegion, cx, cy, w, h);
        ctx.fillStyle = edge
          ? `hsla(${hue}, 75%, 70%, 0.7)`
          : `hsla(${hue}, 55%, 50%, 0.07)`;
        ctx.fillRect(cx * scaleX, cy * scaleY, cellW, cellH);
      }

      const comX = r.comX * scaleX;
      const comY = r.comY * scaleY;
      ctx.beginPath();
      ctx.fillStyle = `hsla(${hue}, 70%, 68%, 0.65)`;
      ctx.arc(comX, comY, 1.8, 0, Math.PI * 2);
      ctx.fill();

      const vx = r.velX * scaleX * 4;
      const vy = r.velY * scaleY * 4;
      if (Math.hypot(vx, vy) > 0.5) {
        ctx.beginPath();
        ctx.strokeStyle = `hsla(${hue}, 75%, 72%, 0.7)`;
        ctx.moveTo(comX, comY);
        ctx.lineTo(comX + vx, comY + vy);
        ctx.stroke();
      }
    }

    if (stats?.listen?.length) {
      for (const g of stats.listen) {
        const x = (g.x + 0.5) * scaleX;
        const y = (g.y + 0.5) * scaleY;
        const calm = g.regime === "calm";
        ctx.beginPath();
        ctx.fillStyle = calm
          ? "rgba(196, 163, 90, 0.9)"
          : "rgba(120, 180, 200, 0.75)";
        ctx.arc(x, y, g.sounding ? 2.4 : 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

/** True when any 4-neighbour is outside the region mask (toroidal). */
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
