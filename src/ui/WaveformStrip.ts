import type { AudioStats } from "../audio/AudioEngine.ts";
import { type MaterialSegment } from "../audio/spectral.ts";
import { REGIME_HEX } from "./RegionOverlay.ts";

const ONSET_PERSIST_MS = 300;
const MIN_SEGMENT_SPAN_PX = 3;
const SEGMENT_LINE = "#5a5a5a";
const SEGMENT_FILL = "rgba(207, 207, 207, 0.10)";
const ONSET_TICK = "#cfcfcf";

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

  draw(
    peaks: Float32Array | null,
    stats: AudioStats | null,
    diagnostics?: {
      segments?: MaterialSegment[] | null;
      onsets?: { t: number; bornMs: number }[];
      nowMs?: number;
    },
  ): void {
    const css = this.syncSize();
    const { ctx } = this;
    ctx.clearRect(0, 0, css.w, css.h);
    const mid = css.h / 2;

    const segments = diagnostics?.segments;
    if (segments && segments.length > 0) {
      this.drawSegmentBands(segments, css.w, css.h);
      this.drawSegmentBoundaries(segments, css.w, css.h);
    }

    ctx.globalAlpha = 1;
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

    if (stats?.listen?.length) {
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

    const onsets = diagnostics?.onsets;
    if (onsets && onsets.length > 0) {
      const nowMs = diagnostics?.nowMs ?? performance.now();
      this.drawOnsetTicks(onsets, nowMs, css.w, css.h);
    }
  }

  private drawSegmentBands(
    segments: MaterialSegment[],
    w: number,
    h: number,
  ): void {
    const { ctx } = this;
    ctx.fillStyle = SEGMENT_FILL;
    for (const seg of segments) {
      let x0 = seg.startPos * w;
      let x1 = seg.endPos * w;
      if (x1 - x0 < MIN_SEGMENT_SPAN_PX) {
        const mid = seg.pos * w;
        x0 = mid - MIN_SEGMENT_SPAN_PX * 0.5;
        x1 = mid + MIN_SEGMENT_SPAN_PX * 0.5;
      }
      x0 = Math.max(0, x0);
      x1 = Math.min(w, x1);
      if (x1 > x0) ctx.fillRect(x0, 0, x1 - x0, h);
    }
  }

  private drawSegmentBoundaries(
    segments: MaterialSegment[],
    w: number,
    h: number,
  ): void {
    const { ctx } = this;
    ctx.strokeStyle = SEGMENT_LINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const seg of segments) {
      const x = Math.max(0.5, Math.min(w - 0.5, seg.pos * w));
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    ctx.stroke();
  }

  private drawOnsetTicks(
    onsets: { t: number; bornMs: number }[],
    nowMs: number,
    w: number,
    h: number,
  ): void {
    const { ctx } = this;
    ctx.lineWidth = 1;
    ctx.strokeStyle = ONSET_TICK;
    for (const onset of onsets) {
      const alpha = clamp(1 - (nowMs - onset.bornMs) / ONSET_PERSIST_MS, 0, 1);
      if (alpha <= 0) continue;
      const x = Math.max(0.5, Math.min(w - 0.5, onset.t * w));
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
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

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
