import type { AudioStats } from "../audio/AudioEngine.ts";
import { GRID_SIZE } from "../ca/UtomataHost.ts";

/**
 * Draws the equal-share lattice the audio renderer is listening through.
 * Not curated structure probes — every active lattice point is shown.
 */
export class ListenOverlay {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "listen-overlay";
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

  draw(stats: AudioStats | null, gridSize = GRID_SIZE): void {
    const { ctx } = this;
    ctx.clearRect(0, 0, GRID_SIZE, GRID_SIZE);
    if (!this.visible) return;
    if (!stats || !stats.listen.length) return;

    const scale = GRID_SIZE / gridSize;

    for (const v of stats.listen) {
      const x = (v.x + 0.5) * scale;
      const y = (v.y + 0.5) * scale;
      const radius = 1.2 + (v.sounding ? 1.4 : 0.4);
      const yNorm = 1 - v.y / Math.max(1, gridSize - 1);
      const material = (v.r + v.g + v.b) / 3;
      const hue = 210 - yNorm * 200;
      const sat = 45 + material * 40;
      const alpha = v.sounding ? 0.85 : 0.4;
      ctx.beginPath();
      ctx.fillStyle = `hsla(${hue}, ${sat}%, 62%, ${alpha})`;
      ctx.strokeStyle = `hsla(${hue}, ${sat + 5}%, 78%, ${alpha * 0.9})`;
      ctx.lineWidth = 0.3;
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
}
