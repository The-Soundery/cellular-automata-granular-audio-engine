import type { FieldObservation } from "../field/FieldObserver.ts";
import type { AudioStats } from "../audio/AudioEngine.ts";
import { GRID_SIZE } from "../ca/UtomataHost.ts";

/**
 * Debug visualisation: observational region cell masks + faint AABB + grains.
 * Not listening posts / lattice ears.
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

    const scaleX = GRID_SIZE / obs.width;
    const scaleY = GRID_SIZE / obs.height;
    const cellW = Math.max(1, scaleX);
    const cellH = Math.max(1, scaleY);

    for (const r of obs.coherent) {
      const hue = (r.id * 47) % 360;
      ctx.fillStyle = `hsla(${hue}, 65%, 55%, 0.28)`;

      // Primary: true cell silhouette from membership mask.
      const cells = r.cells;
      if (cells && cells.length > 0) {
        for (let i = 0; i < cells.length; i++) {
          const ci = cells[i]!;
          const cx = ci % obs.width;
          const cy = (ci / obs.width) | 0;
          ctx.fillRect(cx * scaleX, cy * scaleY, cellW, cellH);
        }
      }

      // Secondary: faint AABB for extent reference only.
      ctx.strokeStyle = `hsla(${hue}, 70%, 62%, 0.28)`;
      ctx.lineWidth = 1;
      const x0 = r.minX * scaleX;
      const y0 = r.minY * scaleY;
      const bw = r.width * scaleX;
      const bh = r.height * scaleY;
      ctx.strokeRect(x0 + 0.5, y0 + 0.5, Math.max(1, bw - 1), Math.max(1, bh - 1));

      const cx = r.comX * scaleX;
      const cy = r.comY * scaleY;
      ctx.beginPath();
      ctx.fillStyle = `hsla(${hue}, 80%, 70%, 0.95)`;
      ctx.arc(cx, cy, 2.2, 0, Math.PI * 2);
      ctx.fill();

      const vx = r.velX * scaleX * 4;
      const vy = r.velY * scaleY * 4;
      if (Math.hypot(vx, vy) > 0.5) {
        ctx.beginPath();
        ctx.strokeStyle = `hsla(${hue}, 80%, 75%, 0.9)`;
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + vx, cy + vy);
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
