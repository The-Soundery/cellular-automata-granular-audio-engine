import type { AudioStats } from "../audio/AudioEngine.ts";
import { GRID_SIZE } from "../ca/UtomataHost.ts";

/** Draws which CA cells the audio engine is currently listening to. */
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

  draw(stats: AudioStats | null, gridSize = GRID_SIZE): void {
    const { ctx } = this;
    ctx.clearRect(0, 0, GRID_SIZE, GRID_SIZE);
    if (!stats || !stats.listen.length) return;

    const scale = GRID_SIZE / gridSize;
    for (const v of stats.listen) {
      const x = (v.x + 0.5) * scale;
      const y = (v.y + 0.5) * scale;
      const radius = 1.2 + Math.sqrt(Math.max(0, v.amp)) * 5;
      // Hue from spectral R (low→blue/cyan, high→yellow/red)
      const hue = 200 - v.r * 200;
      const alpha = v.sounding ? 0.85 : 0.35;
      ctx.beginPath();
      ctx.fillStyle = `hsla(${hue}, 85%, 60%, ${alpha})`;
      ctx.strokeStyle = `hsla(${hue}, 90%, 75%, ${alpha})`;
      ctx.lineWidth = 0.35;
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
}
