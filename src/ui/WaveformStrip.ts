import type { AudioStats } from "../audio/AudioEngine.ts";
import { REGIME_HEX } from "./RegionOverlay.ts";

/** Source waveform + live grain ticks. Chrome, not part of the CA field. */
export class WaveformStrip {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "wave-canvas";
    parent.appendChild(this.canvas);
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    this.ctx = ctx;
  }

  draw(peaks: Float32Array | null, stats: AudioStats | null): void {
    const css = this.syncSize();
    const { ctx } = this;
    ctx.clearRect(0, 0, css.w, css.h);
    const mid = css.h / 2;
    ctx.strokeStyle = "#7a7a7a";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(css.w, mid);
    ctx.stroke();

    if (peaks && peaks.length > 0) {
      ctx.strokeStyle = "#cfcfcf";
      ctx.beginPath();
      const n = peaks.length;
      for (let i = 0; i < n; i++) {
        const x = ((i + 0.5) / n) * css.w;
        const mag = Math.min(1, peaks[i]! * 2.4);
        const h = mag * (css.h * 0.42);
        ctx.moveTo(x, mid - h);
        ctx.lineTo(x, mid + h);
      }
      ctx.stroke();
    }

    if (!stats?.listen?.length) return;
    for (const g of stats.listen) {
      if (typeof g.t !== "number") continue;
      const x = Math.max(0.5, Math.min(css.w - 0.5, g.t * css.w));
      if (g.regime === "calm") ctx.strokeStyle = REGIME_HEX.calm;
      else if (g.regime === "flow") ctx.strokeStyle = REGIME_HEX.flow;
      else if (g.regime === "osc") ctx.strokeStyle = REGIME_HEX.osc;
      else if (g.regime === "texture" || g.regime === "static")
        ctx.strokeStyle = REGIME_HEX.tex;
      else ctx.strokeStyle = REGIME_HEX.chaos;
      const h = g.sounding ? css.h * 0.42 : css.h * 0.22;
      ctx.beginPath();
      ctx.moveTo(x, mid - h);
      ctx.lineTo(x, mid + h);
      ctx.stroke();
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
