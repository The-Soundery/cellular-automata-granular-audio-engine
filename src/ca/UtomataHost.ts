import { TYPE_U_SEED, TYPE_U_SETUP } from "./typeU.ts";

export const GRID_SIZE = 128;

export class UtomataHost {
  readonly instance: UtomataInstance;
  private targetFps = 30;
  private paused = false;
  private equation = TYPE_U_SEED;

  constructor(container: HTMLElement, canvasId = "ca-canvas") {
    if (typeof utomata !== "function") {
      throw new Error("utomata.js failed to load");
    }
    this.instance = new utomata(GRID_SIZE, GRID_SIZE, canvasId);
    this.instance.setParent(container);
    this.instance.edge("REPEAT");
    this.instance.fps(this.targetFps);
    this.instance.setup(TYPE_U_SETUP);
    this.instance.run(this.equation);
    this.fitZoom(container);
  }

  getEquation(): string {
    return this.equation;
  }

  applyEquation(eq: string): void {
    this.equation = eq.trim();
    this.instance.run(this.equation);
  }

  reset(): void {
    this.instance.setup(TYPE_U_SETUP);
  }

  pause(): void {
    this.paused = true;
    this.instance.fps(0);
  }

  play(): void {
    this.paused = false;
    this.instance.fps(this.targetFps);
  }

  togglePause(): boolean {
    if (this.paused) this.play();
    else this.pause();
    return this.paused;
  }

  isPaused(): boolean {
    return this.paused;
  }

  setFps(n: number): void {
    this.targetFps = Math.max(1, Math.min(60, n));
    if (!this.paused) this.instance.fps(this.targetFps);
  }

  getStep(): number {
    return this.instance.getStep();
  }

  getFps(): number {
    return this.instance.getFps();
  }

  getImgData(): Uint8ClampedArray {
    return this.instance.getImgData();
  }

  getWidth(): number {
    return this.instance.getWidth();
  }

  getHeight(): number {
    return this.instance.getHeight();
  }

  fitZoom(container: HTMLElement): void {
    const size = Math.min(container.clientWidth, container.clientHeight);
    if (size <= 0) return;
    const zoom = size / GRID_SIZE;
    this.instance.zoom(zoom);
  }
}
