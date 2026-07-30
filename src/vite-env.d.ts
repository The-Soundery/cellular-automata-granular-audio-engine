/// <reference types="vite/client" />

interface UtomataInstance {
  run(transition?: string): void;
  step(): void;
  stop(): void;
  setup(conf?: string): void;
  update(update: string): void;
  fps(n: number): void;
  zoom(mag: number): void;
  edge(type: string): void;
  width(w: number): void;
  height(h: number): void;
  setParent(parent: HTMLElement): void;
  getImgData(): Uint8ClampedArray;
  getStep(): number;
  getFps(): number;
  getWidth(): number;
  getHeight(): number;
  getUpdate(): string;
  getSetup(): string;
  errors(): string[];
}

interface Window {
  utomata: new (width: number, height: number, canvasId?: string) => UtomataInstance;
}

declare const utomata: new (
  width: number,
  height: number,
  canvasId?: string,
) => UtomataInstance;
