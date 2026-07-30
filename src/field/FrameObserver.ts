import { GRID_SIZE } from "../ca/UtomataHost.ts";

/** Planar RGB fields (row-major, length = width * height). */
export interface RgbField {
  width: number;
  height: number;
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
}

export class FrameObserver {
  readonly width: number;
  readonly height: number;
  current: RgbField;
  previous: RgbField;
  private lastStep = -1;

  constructor(width = GRID_SIZE, height = GRID_SIZE) {
    this.width = width;
    this.height = height;
    this.current = createField(width, height);
    this.previous = createField(width, height);
  }

  /**
   * Ingest Utomata getImgData() RGBA bytes. Returns true if the field advanced
   * (new CA step observed). Never invents interpolated state.
   */
  ingest(imgData: Uint8ClampedArray, step: number): boolean {
    if (step === this.lastStep) return false;

    const n = this.width * this.height;
    const expected = n * 4;
    if (imgData.length < expected) {
      return false;
    }

    this.lastStep = step;

    const tmp = this.previous;
    this.previous = this.current;
    this.current = tmp;

    const { r, g, b } = this.current;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      r[i] = imgData[o]! / 255;
      g[i] = imgData[o + 1]! / 255;
      b[i] = imgData[o + 2]! / 255;
    }
    return true;
  }
}

function createField(width: number, height: number): RgbField {
  const n = width * height;
  return {
    width,
    height,
    r: new Float32Array(n),
    g: new Float32Array(n),
    b: new Float32Array(n),
  };
}
