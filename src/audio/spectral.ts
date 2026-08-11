/** Offline source prep — stereo PCM, seam crossfade, polar HSV→material map. */

/** Equal-power crossfade length at the loop seam (seconds). */
export const SEAM_FADE_SEC = 0.05;
/** Hop length for segment analysis (seconds). Hop ≤ FFT so coverage is full. */
export const CENTROID_HOP_SEC = 0.046439;
/** Analysis window for FFT (samples, power of two). ~46.4 ms at 44.1 kHz. */
const CENTROID_FFT_SIZE = 2048;
/** Soft regime preference weight toward sustained (calm) or transient (chaos). */
export const REGIME_STATIONARITY_BIAS = 0.22;
/** Polar distance weights (angle wraps). */
const W_ANGLE = 1.0;
const W_RADIUS = 0.85;
const W_BAND = 0.55;

export type RegimeMaterialBias = "sustained" | "transient" | "neutral";

export interface MaterialSegment {
  /** File position of segment midpoint [0,1]. */
  pos: number;
  centroidHz: number;
  /** 1 = sustained / low flux; 0 = transient / high flux. */
  stationarity: number;
  energy: number;
  /** Polar embedding. */
  angle: number;
  radius: number;
  band: number;
}

export interface MaterialQueryResult {
  sampleCenter: number;
  centroidHz: number;
  stationarity: number;
}

export interface SpectralBank {
  sampleRate: number;
  length: number;
  durationSec: number;
  /** Left channel (peak-normalized, seam-crossfaded). */
  pcmL: Float32Array;
  /** Right channel (duplicate of L when source is mono). */
  pcmR: Float32Array;
  /**
   * Mono mix used only for analysis / diagnostics.
   * Playback must use pcmL/pcmR.
   */
  pcm: Float32Array;
  /** Analysed segments in polar space. */
  segments: MaterialSegment[];
}

/** Build stereo PCM with loop-seam crossfade + polar material map. */
export function buildSpectralBank(audioBuffer: AudioBuffer): SpectralBank {
  const sampleRate = audioBuffer.sampleRate;
  const length = audioBuffer.length;
  const channels = audioBuffer.numberOfChannels;
  const pcmL = new Float32Array(length);
  const pcmR = new Float32Array(length);
  const pcm = new Float32Array(length);

  if (channels === 1) {
    const c0 = audioBuffer.getChannelData(0);
    pcmL.set(c0);
    pcmR.set(c0);
  } else {
    const c0 = audioBuffer.getChannelData(0);
    const c1 = audioBuffer.getChannelData(1);
    pcmL.set(c0);
    pcmR.set(c1);
  }

  for (let i = 0; i < length; i++) {
    pcm[i] = 0.5 * (pcmL[i]! + pcmR[i]!);
  }

  applySeamCrossfade(pcmL, sampleRate);
  applySeamCrossfade(pcmR, sampleRate);
  // Keep L/R seam-matched on mono mix used for analysis.
  for (let i = 0; i < length; i++) {
    pcm[i] = 0.5 * (pcmL[i]! + pcmR[i]!);
  }

  const peak = Math.max(peakAbs(pcmL), peakAbs(pcmR));
  if (peak > 1e-8) {
    const g = 0.9 / peak;
    for (let i = 0; i < length; i++) {
      pcmL[i]! *= g;
      pcmR[i]! *= g;
      pcm[i]! *= g;
    }
  }

  const segments = buildPolarSegments(pcm, sampleRate);

  return {
    sampleRate,
    length,
    durationSec: length / sampleRate,
    pcmL,
    pcmR,
    pcm,
    segments,
  };
}

/**
 * HSV → material in the polar plane.
 * hue = angle, sat = radius (grey→centre), value = energy band.
 * regimeBias soft-prefers sustained or transient segments.
 */
export function queryMaterialFromHsv(
  segments: MaterialSegment[],
  hue: number,
  sat: number,
  value: number,
  regimeBias: RegimeMaterialBias = "neutral",
): MaterialQueryResult {
  if (!segments.length) {
    return { sampleCenter: clamp01(value), centroidHz: 1000, stationarity: 0.5 };
  }

  const qAngle = clamp01(hue);
  const qRadius = clamp01(sat);
  const qBand = clamp01(value);
  // Vivid: hue angle leads. Grey: ignore angle; value/band carries coverage.
  const angleW = W_ANGLE * (0.15 + 0.85 * qRadius);
  const radiusW = W_RADIUS * 0.5;
  const bandW = W_BAND * (0.25 + 0.75 * (1 - qRadius));

  let best = segments[0]!;
  let bestScore = Infinity;

  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]!;
    const dA = circularDistance01(qAngle, s.angle);
    const dR = qRadius - s.radius;
    const dB = qBand - s.band;
    let score = angleW * dA * dA + radiusW * dR * dR + bandW * dB * dB;

    if (regimeBias === "sustained") {
      score -= REGIME_STATIONARITY_BIAS * s.stationarity;
    } else if (regimeBias === "transient") {
      score -= REGIME_STATIONARITY_BIAS * (1 - s.stationarity);
    }

    if (score < bestScore) {
      bestScore = score;
      best = s;
    }
  }

  return {
    sampleCenter: best.pos,
    centroidHz: best.centroidHz,
    stationarity: best.stationarity,
  };
}

/** Fallback bank for tests before a source loads (flat mid-file material). */
export function identitySpectralBank(
  sampleRate = 48000,
  durationSec = 1,
): SpectralBank {
  const length = Math.max(64, Math.floor(sampleRate * durationSec));
  const pcm = new Float32Array(length);
  const pcmL = new Float32Array(length);
  const pcmR = new Float32Array(length);
  const segments: MaterialSegment[] = [
    {
      pos: 0.5,
      centroidHz: 1000,
      stationarity: 0.5,
      energy: 1,
      angle: 0.5,
      radius: 0.5,
      band: 0.5,
    },
  ];
  return {
    sampleRate,
    length,
    durationSec: length / sampleRate,
    pcmL,
    pcmR,
    pcm,
    segments,
  };
}

/** @deprecated Use queryMaterialFromHsv — kept for harness string continuity. */
export function sampleCenterFromHue(
  _lut: Float32Array,
  hue: number,
): number {
  return clamp01(hue);
}

/** @deprecated Use identitySpectralBank.segments */
export function identityHueSampleLut(size = 256): Float32Array {
  const n = Math.max(2, size);
  const lut = new Float32Array(n);
  for (let i = 0; i < n; i++) lut[i] = i / (n - 1);
  return lut;
}

/** RGB → HSV components in [0,1]. Grey → hue 0 (unused when sat≈0). */
export function rgbToHsv(
  r: number,
  g: number,
  b: number,
): { h: number; s: number; v: number } {
  const rr = clamp01(r);
  const gg = clamp01(g);
  const bb = clamp01(b);
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const d = max - min;
  let h = 0;
  if (d >= 1e-6) {
    if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6;
    else if (max === gg) h = ((bb - rr) / d + 2) / 6;
    else h = ((rr - gg) / d + 4) / 6;
  }
  const s = max < 1e-6 ? 0 : d / max;
  return { h: clamp01(h), s: clamp01(s), v: clamp01(max) };
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
    const wHead = Math.sin(t * 0.5 * Math.PI);
    const wTail = Math.cos(t * 0.5 * Math.PI);
    const head = pcm[i]!;
    const tail = pcm[n - fadeN + i]!;
    pcm[i] = head * wHead + tail * wTail;
  }
}

function peakAbs(pcm: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) {
    const a = Math.abs(pcm[i]!);
    if (a > peak) peak = a;
  }
  return peak;
}

/**
 * Segment PCM with hop ≈ FFT so every sample is measured; embed in polar space.
 */
function buildPolarSegments(
  pcm: Float32Array,
  sampleRate: number,
): MaterialSegment[] {
  const n = pcm.length;
  if (n < 64) {
    return [
      {
        pos: 0.5,
        centroidHz: 1000,
        stationarity: 0.5,
        energy: 1,
        angle: 0.5,
        radius: 0.5,
        band: 0.5,
      },
    ];
  }

  const fftSize = Math.min(CENTROID_FFT_SIZE, highestPowerOfTwo(n));
  if (fftSize < 64) {
    return [
      {
        pos: 0.5,
        centroidHz: 1000,
        stationarity: 0.5,
        energy: 1,
        angle: 0.5,
        radius: 0.5,
        band: 0.5,
      },
    ];
  }

  // Hop ≤ fft so analysis covers the file; midpoints can sit at 0 and 1.
  const hop = Math.max(64, Math.min(fftSize, Math.floor(CENTROID_HOP_SEC * sampleRate)));
  type Raw = {
    pos: number;
    centroid: number;
    energy: number;
    flux: number;
  };
  const raw: Raw[] = [];
  let prevMag: Float32Array | null = null;

  for (let start = 0; start < n; start += hop) {
    const mid = Math.min(n - 1, start + Math.min(hop, fftSize) / 2);
    const winStart = Math.max(0, Math.min(n - fftSize, Math.floor(mid - fftSize / 2)));
    const { centroid, energy, mag } = spectralFrame(
      pcm,
      winStart,
      fftSize,
      sampleRate,
    );
    let flux = 0;
    if (prevMag) {
      for (let k = 1; k < mag.length; k++) {
        const d = mag[k]! - prevMag[k]!;
        if (d > 0) flux += d;
      }
    }
    prevMag = mag;
    const pos = n <= 1 ? 0.5 : mid / (n - 1);
    raw.push({ pos: clamp01(pos), centroid, energy, flux });
  }

  if (raw.length === 0) {
    return [
      {
        pos: 0.5,
        centroidHz: 1000,
        stationarity: 0.5,
        energy: 1,
        angle: 0.5,
        radius: 0.5,
        band: 0.5,
      },
    ];
  }

  const energetic = raw.filter((s) => s.energy > 1e-8);
  const pool = energetic.length >= 2 ? energetic : raw;

  // Normalise flux → stationarity.
  let maxFlux = 1e-12;
  for (const s of pool) if (s.flux > maxFlux) maxFlux = s.flux;

  const byCentroid = pool
    .map((s, i) => ({ i, c: s.centroid }))
    .sort((a, b) => a.c - b.c || a.i - b.i);
  const byEnergy = pool
    .map((s, i) => ({ i, e: Math.log10(1e-12 + s.energy) }))
    .sort((a, b) => a.e - b.e || a.i - b.i);

  const angleOf = new Float32Array(pool.length);
  const bandOf = new Float32Array(pool.length);
  const denom = Math.max(1, pool.length - 1);
  for (let rank = 0; rank < byCentroid.length; rank++) {
    angleOf[byCentroid[rank]!.i] = rank / denom;
  }
  for (let rank = 0; rank < byEnergy.length; rank++) {
    bandOf[byEnergy[rank]!.i] = rank / denom;
  }

  const segments: MaterialSegment[] = [];
  for (let i = 0; i < pool.length; i++) {
    const s = pool[i]!;
    const stationarity = 1 - clamp01(s.flux / maxFlux);
    // Segments live in an outer annulus (vivid colours). Grey queries sit at
    // the origin — radially equidistant — so value/band selects material.
    segments.push({
      pos: s.pos,
      centroidHz: Math.max(40, s.centroid),
      stationarity,
      energy: s.energy,
      angle: angleOf[i]!,
      radius: 0.7 + 0.3 * stationarity,
      band: bandOf[i]!,
    });
  }

  // Guarantee head/tail of file are selectable centres.
  if (segments.length > 0) {
    const head = { ...segments[0]!, pos: 0 };
    const tail = { ...segments[segments.length - 1]!, pos: 1 };
    if (!segments.some((s) => s.pos <= 0.01)) segments.push(head);
    if (!segments.some((s) => s.pos >= 0.99)) segments.push(tail);
  }

  return segments;
}

function spectralFrame(
  pcm: Float32Array,
  start: number,
  fftSize: number,
  sampleRate: number,
): { centroid: number; energy: number; mag: Float32Array } {
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
  const mag = new Float32Array(half);
  for (let k = 1; k < half; k++) {
    const m = Math.hypot(re[k]!, im[k]!);
    mag[k] = m;
    const freq = (k / half) * nyquist;
    num += freq * m;
    den += m;
  }
  if (den < 1e-12) return { centroid: 0, energy: 0, mag };
  return { centroid: num / den, energy: den, mag };
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

function highestPowerOfTwo(n: number): number {
  let p = 1;
  while (p * 2 <= n) p *= 2;
  return p;
}

function circularDistance01(a: number, b: number): number {
  let d = Math.abs(a - b);
  if (d > 0.5) d = 1 - d;
  return d;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
