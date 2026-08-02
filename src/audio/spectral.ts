/** Offline source prep — mono PCM, seam crossfade, perceptual hue→sample LUT. */

/** Equal-power crossfade length at the loop seam (seconds). */
export const SEAM_FADE_SEC = 0.05;
/** Hop length for spectral-centroid segmentation (seconds). */
export const CENTROID_HOP_SEC = 0.25;
/** Discrete hue→sample LUT resolution. */
export const HUE_LUT_SIZE = 256;
/** Analysis window for centroid FFT (samples, power of two). */
const CENTROID_FFT_SIZE = 2048;

export interface SpectralBank {
  sampleRate: number;
  length: number;
  durationSec: number;
  /** Mono mix of the source (peak-normalized, seam-crossfaded). */
  pcm: Float32Array;
  /**
   * Hue [0,1] → sample position [0,1], ordered by spectral centroid
   * so adjacent hues scrub spectrally adjacent material.
   */
  hueSampleLut: Float32Array;
}

/** Build mono PCM with loop-seam crossfade + perceptual hue map. */
export function buildSpectralBank(audioBuffer: AudioBuffer): SpectralBank {
  const sampleRate = audioBuffer.sampleRate;
  const length = audioBuffer.length;
  const channels = audioBuffer.numberOfChannels;
  const pcm = new Float32Array(length);

  for (let i = 0; i < length; i++) {
    let s = 0;
    for (let c = 0; c < channels; c++) {
      s += audioBuffer.getChannelData(c)[i]!;
    }
    pcm[i] = s / channels;
  }

  applySeamCrossfade(pcm, sampleRate);
  peakNormalize(pcm, 0.9);
  const hueSampleLut = buildHueSampleLut(pcm, sampleRate);

  return {
    sampleRate,
    length,
    durationSec: length / sampleRate,
    pcm,
    hueSampleLut,
  };
}

/** Linear interpolation on the hue→sample LUT. */
export function sampleCenterFromHue(
  lut: Float32Array,
  hue: number,
): number {
  const n = lut.length;
  if (n < 2) return clamp01(hue);
  const x = clamp01(hue) * (n - 1);
  const i0 = Math.floor(x);
  const i1 = Math.min(n - 1, i0 + 1);
  const f = x - i0;
  return lut[i0]! * (1 - f) + lut[i1]! * f;
}

/** Identity LUT (hue → same file fraction) for tests / fallback. */
export function identityHueSampleLut(size = HUE_LUT_SIZE): Float32Array {
  const n = Math.max(2, size);
  const lut = new Float32Array(n);
  for (let i = 0; i < n; i++) lut[i] = i / (n - 1);
  return lut;
}

/** Blend final SEAM_FADE_SEC into the start so wrapped reads never click. */
function applySeamCrossfade(pcm: Float32Array, sampleRate: number): void {
  const n = pcm.length;
  if (n < 4) return;
  const fadeN = Math.min(
    Math.floor(SEAM_FADE_SEC * sampleRate),
    Math.floor(n / 2),
  );
  if (fadeN < 2) return;

  for (let i = 0; i < fadeN; i++) {
    const t = i / (fadeN - 1);
    // Equal-power: head fades in, tail contribution fades out into head.
    const wHead = Math.sin(t * 0.5 * Math.PI);
    const wTail = Math.cos(t * 0.5 * Math.PI);
    const head = pcm[i]!;
    const tail = pcm[n - fadeN + i]!;
    pcm[i] = head * wHead + tail * wTail;
  }
}

function peakNormalize(pcm: Float32Array, target: number): void {
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) {
    const a = Math.abs(pcm[i]!);
    if (a > peak) peak = a;
  }
  if (peak < 1e-8) return;
  const g = target / peak;
  for (let i = 0; i < pcm.length; i++) pcm[i]! *= g;
}

/**
 * Segment PCM by hop, measure spectral centroid, sort segments, build a
 * smoothed hue→file-position lookup (CataRT-style descriptor axis).
 */
function buildHueSampleLut(
  pcm: Float32Array,
  sampleRate: number,
): Float32Array {
  const n = pcm.length;
  if (n < 64) return identityHueSampleLut();

  const hop = Math.max(64, Math.floor(CENTROID_HOP_SEC * sampleRate));
  const fftSize = Math.min(CENTROID_FFT_SIZE, highestPowerOfTwo(n));
  if (fftSize < 64) return identityHueSampleLut();

  type Seg = { pos: number; centroid: number; energy: number };
  const segs: Seg[] = [];

  for (let start = 0; start < n; start += hop) {
    const mid = Math.min(n - 1, start + (hop >> 1));
    const winStart = Math.max(0, Math.min(n - fftSize, mid - (fftSize >> 1)));
    const { centroid, energy } = spectralCentroid(
      pcm,
      winStart,
      fftSize,
      sampleRate,
    );
    segs.push({
      pos: mid / Math.max(1, n - 1),
      centroid,
      energy,
    });
  }

  if (segs.length === 0) return identityHueSampleLut();

  // Drop near-silent hops from ordering (keep for coverage via neighbours).
  const energetic = segs.filter((s) => s.energy > 1e-8);
  const ordered = (energetic.length >= 2 ? energetic : segs).slice();
  ordered.sort((a, b) => a.centroid - b.centroid || a.pos - b.pos);

  // Hue 0..1 walks the centroid-sorted segment midpoints.
  const lut = new Float32Array(HUE_LUT_SIZE);
  const denom = Math.max(1, HUE_LUT_SIZE - 1);
  for (let i = 0; i < HUE_LUT_SIZE; i++) {
    const t = i / denom;
    const x = t * (ordered.length - 1);
    const j0 = Math.floor(x);
    const j1 = Math.min(ordered.length - 1, j0 + 1);
    const f = x - j0;
    lut[i] = ordered[j0]!.pos * (1 - f) + ordered[j1]!.pos * f;
  }

  // Smooth so adjacent hues stay adjacent in file space.
  smoothLutInPlace(lut, 4);
  return lut;
}

function spectralCentroid(
  pcm: Float32Array,
  start: number,
  fftSize: number,
  sampleRate: number,
): { centroid: number; energy: number } {
  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
    re[i] = (pcm[start + i] ?? 0) * w;
    im[i] = 0;
  }
  fftInPlace(re, im);

  const nyquist = sampleRate * 0.5;
  let num = 0;
  let den = 0;
  const half = fftSize >> 1;
  for (let k = 1; k < half; k++) {
    const mag = Math.hypot(re[k]!, im[k]!);
    const freq = (k / half) * nyquist;
    num += freq * mag;
    den += mag;
  }
  if (den < 1e-12) return { centroid: 0, energy: 0 };
  return { centroid: num / den, energy: den };
}

/** Iterative in-place Cooley–Tukey FFT (length must be power of two). */
function fftInPlace(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wlenRe = Math.cos(ang);
    const wlenIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wRe = 1;
      let wIm = 0;
      for (let j = 0; j < len / 2; j++) {
        const uRe = re[i + j]!;
        const uIm = im[i + j]!;
        const vRe = re[i + j + len / 2]! * wRe - im[i + j + len / 2]! * wIm;
        const vIm = re[i + j + len / 2]! * wIm + im[i + j + len / 2]! * wRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + len / 2] = uRe - vRe;
        im[i + j + len / 2] = uIm - vIm;
        const nextWRe = wRe * wlenRe - wIm * wlenIm;
        wIm = wRe * wlenIm + wIm * wlenRe;
        wRe = nextWRe;
      }
    }
  }
}

function smoothLutInPlace(lut: Float32Array, passes: number): void {
  const n = lut.length;
  if (n < 3) return;
  const tmp = new Float32Array(n);
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < n; i++) {
      const a = lut[Math.max(0, i - 1)]!;
      const b = lut[i]!;
      const c = lut[Math.min(n - 1, i + 1)]!;
      tmp[i] = 0.25 * a + 0.5 * b + 0.25 * c;
    }
    lut.set(tmp);
  }
}

function highestPowerOfTwo(n: number): number {
  let p = 1;
  while (p * 2 <= n) p *= 2;
  return p;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
