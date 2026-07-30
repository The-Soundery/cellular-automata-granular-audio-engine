import type { AudioStats } from "../audio/AudioEngine.ts";
import { GRID_SIZE } from "../ca/UtomataHost.ts";

/** Display smoothing — live probes glide; bake thrash stays off the dots. */
const DISPLAY_EMA = 0.28;
/** Ignore sub-cell noise below this toroidal distance. */
const DISPLAY_DEADZONE = 0.12;

/**
 * Draws structure probes the audio engine is listening to (live locus).
 * Positions are EMA-smoothed so grain rebakes don't jitter the overlay.
 */
export class ListenOverlay {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private displayPos = new Map<string, { x: number; y: number }>();

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
    this.displayPos.clear();
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
    if (!stats || !stats.listen.length) {
      this.displayPos.clear();
      return;
    }

    const scale = GRID_SIZE / gridSize;
    const seen = new Set<string>();

    // Group probes by structure for extent hints.
    const byStruct = new Map<number, typeof stats.listen>();
    for (const v of stats.listen) {
      const id = v.structureId ?? -1;
      let list = byStruct.get(id);
      if (!list) {
        list = [];
        byStruct.set(id, list);
      }
      list.push(v);
    }

    for (const [, probes] of byStruct) {
      if (probes.length >= 2) {
        ctx.beginPath();
        ctx.strokeStyle = "hsla(45, 40%, 70%, 0.35)";
        ctx.lineWidth = 0.4;
        for (let i = 0; i < probes.length; i++) {
          const p = probes[i]!;
          const key = `${p.structureId}:${p.probeIndex}`;
          const pos = this.smoothPos(key, p.x, p.y, gridSize);
          seen.add(key);
          const x = (pos.x + 0.5) * scale;
          const y = (pos.y + 0.5) * scale;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      for (const v of probes) {
        const key = `${v.structureId}:${v.probeIndex}`;
        const pos = this.smoothPos(key, v.x, v.y, gridSize);
        seen.add(key);
        const x = (pos.x + 0.5) * scale;
        const y = (pos.y + 0.5) * scale;
        const radius = 1.4 + Math.sqrt(Math.max(0, v.amp)) * 5;
        // Hue from sounding Y (spectral topology); sat from regional colour mass.
        const yNorm = 1 - pos.y / Math.max(1, gridSize - 1);
        const material = (v.r + v.g + v.b) / 3;
        const hue = 210 - yNorm * 200;
        const sat = 50 + material * 35;
        const alpha = v.sounding ? 0.9 : 0.35;
        ctx.beginPath();
        ctx.fillStyle = `hsla(${hue}, ${sat}%, 60%, ${alpha})`;
        ctx.strokeStyle = `hsla(${hue}, ${sat + 5}%, 75%, ${alpha})`;
        ctx.lineWidth = 0.35;
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    for (const key of this.displayPos.keys()) {
      if (!seen.has(key)) this.displayPos.delete(key);
    }
  }

  private smoothPos(
    key: string,
    tx: number,
    ty: number,
    gridSize: number,
  ): { x: number; y: number } {
    const prev = this.displayPos.get(key);
    if (!prev) {
      const next = { x: tx, y: ty };
      this.displayPos.set(key, next);
      return next;
    }
    const dx = shortestDelta(prev.x, tx, gridSize);
    const dy = shortestDelta(prev.y, ty, gridSize);
    if (Math.hypot(dx, dy) < DISPLAY_DEADZONE) {
      return prev;
    }
    const next = {
      x: wrap(prev.x + dx * DISPLAY_EMA, gridSize),
      y: wrap(prev.y + dy * DISPLAY_EMA, gridSize),
    };
    this.displayPos.set(key, next);
    return next;
  }
}

function shortestDelta(from: number, to: number, period: number): number {
  let d = to - from;
  if (d > period * 0.5) d -= period;
  if (d < -period * 0.5) d += period;
  return d;
}

function wrap(v: number, period: number): number {
  let x = v % period;
  if (x < 0) x += period;
  return x;
}
