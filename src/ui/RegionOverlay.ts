import type { FieldObservation } from "../field/FieldObserver.ts";
import { FIELD_OBS } from "../field/FieldObserver.ts";
import type { AudioStats } from "../audio/AudioEngine.ts";
import { GRID_SIZE } from "../ca/UtomataHost.ts";

/** One colour per regime — diagnosis, not region identity. */
const CALM_RGB = [196, 163, 90] as const;
const TEX_RGB = [150, 150, 155] as const;
const CHAOS_RGB = [230, 72, 36] as const;
const OSC_RGB = [55, 130, 190] as const;
const FLOW_RGB = [70, 175, 120] as const;

/**
 * Debug visualisation: regime base layer + observational calm silhouettes.
 * Not listening posts / lattice ears. No AABB rectangles.
 */
export class RegionOverlay {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly regimeImage: ImageData;
  private readonly regimeBuf: Uint8ClampedArray;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "region-overlay";
    this.canvas.width = GRID_SIZE;
    this.canvas.height = GRID_SIZE;
    parent.appendChild(this.canvas);
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    this.ctx = ctx;
    this.regimeImage = ctx.createImageData(GRID_SIZE, GRID_SIZE);
    this.regimeBuf = this.regimeImage.data;
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

    this.paintRegimeLayer(obs, w, h);
    ctx.putImageData(this.regimeImage, 0, 0);

    for (const r of obs.coherent) {
      const cells = r.cells;
      if (!cells || cells.length === 0) continue;

      const inRegion = new Set<number>();
      for (let i = 0; i < cells.length; i++) inRegion.add(cells[i]!);

      // Interior: dim gold fill. Edge cells: brighter gold outline.
      for (let i = 0; i < cells.length; i++) {
        const ci = cells[i]!;
        const cx = ci % w;
        const cy = (ci / w) | 0;
        const edge = isEdgeCell(inRegion, cx, cy, w, h);
        ctx.fillStyle = edge
          ? "rgba(220, 185, 95, 0.8)"
          : "rgba(196, 163, 90, 0.07)";
        ctx.fillRect(cx * scaleX, cy * scaleY, cellW, cellH);
      }

      const comX = r.comX * scaleX;
      const comY = r.comY * scaleY;
      ctx.beginPath();
      ctx.fillStyle = "rgba(220, 185, 95, 0.9)";
      ctx.arc(comX, comY, 1.8, 0, Math.PI * 2);
      ctx.fill();

      const vx = r.velX * scaleX * 4;
      const vy = r.velY * scaleY * 4;
      if (Math.hypot(vx, vy) > 0.5) {
        ctx.beginPath();
        ctx.strokeStyle = "rgba(220, 185, 95, 0.85)";
        ctx.moveTo(comX, comY);
        ctx.lineTo(comX + vx, comY + vy);
        ctx.stroke();
      }
    }

    for (const f of obs.flows ?? []) {
      const cells = f.cells;
      if (!cells || cells.length === 0) continue;
      const comX = f.comX * scaleX;
      const comY = f.comY * scaleY;
      ctx.beginPath();
      ctx.fillStyle = "rgba(90, 210, 140, 0.9)";
      ctx.arc(comX, comY, 2.2, 0, Math.PI * 2);
      ctx.fill();
      const vx = f.velX * scaleX * 4;
      const vy = f.velY * scaleY * 4;
      if (Math.hypot(vx, vy) > 0.5) {
        ctx.beginPath();
        ctx.strokeStyle = "rgba(90, 210, 140, 0.85)";
        ctx.moveTo(comX, comY);
        ctx.lineTo(comX + vx, comY + vy);
        ctx.stroke();
      }
    }

    if (stats?.listen?.length) {
      for (const g of stats.listen) {
        const x = (g.x + 0.5) * scaleX;
        const y = (g.y + 0.5) * scaleY;
        ctx.beginPath();
        if (g.regime === "calm") {
          ctx.fillStyle = "rgba(196, 163, 90, 0.9)";
        } else if (g.regime === "flow") {
          ctx.fillStyle = "rgba(90, 210, 140, 0.9)";
        } else {
          ctx.fillStyle = "rgba(120, 180, 200, 0.75)";
        }
        ctx.arc(x, y, g.sounding ? 2.4 : 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /** One ImageData put — textured / chaotic / oscillator / flow cells. */
  private paintRegimeLayer(obs: FieldObservation, w: number, h: number): void {
    const buf = this.regimeBuf;
    buf.fill(0);
    const sx = GRID_SIZE / w;
    const sy = GRID_SIZE / h;

    const paint = (
      cells: Uint32Array,
      r: number,
      g: number,
      b: number,
      a: number,
    ) => {
      for (let i = 0; i < cells.length; i++) {
        const ci = cells[i]!;
        const cx = ci % w;
        const cy = (ci / w) | 0;
        const x0 = Math.floor(cx * sx);
        const y0 = Math.floor(cy * sy);
        const x1 = Math.max(x0 + 1, Math.floor((cx + 1) * sx));
        const y1 = Math.max(y0 + 1, Math.floor((cy + 1) * sy));
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const o = (y * GRID_SIZE + x) * 4;
            buf[o] = r;
            buf[o + 1] = g;
            buf[o + 2] = b;
            buf[o + 3] = a;
          }
        }
      }
    };

    // Dim fills so the CA stays readable beneath. One colour per regime.
    // Chaos last among remainder so it is not buried under gold calm.
    if (obs.textured.cells.length) {
      paint(obs.textured.cells, TEX_RGB[0], TEX_RGB[1], TEX_RGB[2], 55);
    }
    for (const r of obs.coherent) {
      if (r.cells.length) paint(r.cells, CALM_RGB[0], CALM_RGB[1], CALM_RGB[2], 55);
    }
    for (const g of obs.oscillators) {
      if (g.cells.length) paint(g.cells, OSC_RGB[0], OSC_RGB[1], OSC_RGB[2], 80);
    }
    if (obs.chaotic.cells.length) {
      paint(obs.chaotic.cells, CHAOS_RGB[0], CHAOS_RGB[1], CHAOS_RGB[2], 140);
    }
    for (const f of obs.flows ?? []) {
      if (f.cells.length) {
        paint(
          dilateCells(f.cells, w, h, FIELD_OBS.flowJoinRadius),
          FLOW_RGB[0],
          FLOW_RGB[1],
          FLOW_RGB[2],
          75,
        );
      }
    }
  }
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
