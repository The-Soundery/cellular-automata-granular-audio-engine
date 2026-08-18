/** Offline source prep — stereo PCM, seam crossfade, polar HSV→material map. */

/** Equal-power crossfade length at the loop seam (seconds). */
export const SEAM_FADE_SEC = 0.05;
/** Hop length for segment analysis (seconds). Hop ≤ FFT so coverage is full. */
export const CENTROID_HOP_SEC = 0.046439;
/** Analysis window for FFT (samples, power of two). ~46.4 ms at 44.1 kHz. */
const CENTROID_FFT_SIZE = 2048;
/**
 * Calm/texture listen only inside segments at or above this stationarity
 * quantile (0.5 = quieter/sustained half). Colour still chooses within that set.
 */
export const SUSTAINED_SUBSET_QUANTILE = 0.5;
/**
 * After the quantile cut, also drop sustained candidates within this fraction
 * of the file from a low-stationarity (attack) peak — stops colour landing on
 * the pad hop that shares a window with the hit.
 */
export const SUSTAINED_ATTACK_GAP = 0.05;
/** Fixed polar radius for all segments (outer annulus). Grey queries sit at 0. */
export const POLAR_SEGMENT_RADIUS = 0.85;
/** Attack mix: short-time energy jump dominates; spectral flux is secondary. */
const W_ATTACK_ENERGY = 0.65;
const W_ATTACK_FLUX = 0.35;
/** Polar distance weights (angle wraps). */
const W_ANGLE = 1.0;
const W_RADIUS = 0.85;
const W_BAND = 0.55;

export type RegimeMaterialBias = "sustained" | "transient" | "neutral";

export interface MaterialSegment {
  /** File position of segment midpoint [0,1]. */
  pos: number;
  centroidHz: number;
  /** 1 = sustained / low attack; 0 = transient / high attack. */
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
 * "sustained" restricts the map to the high-stationarity subset, then nearest
 * colour wins. "transient" / "neutral" search the full map (no soft bias).
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

  const pool =
    regimeBias === "sustained" ? sustainedSubset(segments) : segments;
  return nearestPolar(pool, hue, sat, value);
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
      radius: POLAR_SEGMENT_RADIUS,
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

/**
 * Segment mono PCM into the polar material map.
 * Exported for harness fixtures (Node has no AudioBuffer).
 */
export function buildPolarSegments(
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
        radius: POLAR_SEGMENT_RADIUS,
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
        radius: POLAR_SEGMENT_RADIUS,
        band: 0.5,
      },
    ];
  }

  // Hop ≤ fft so analysis covers the file; midpoints can sit at 0 and 1.
  const hop = Math.max(
    64,
    Math.min(fftSize, Math.floor(CENTROID_HOP_SEC * sampleRate)),
  );
  type Raw = {
    pos: number;
    centroid: number;
    energy: number;
    rms: number;
    flux: number;
    mag: Float32Array;
  };
  const raw: Raw[] = [];
  let prevMag: Float32Array | null = null;

  for (let start = 0; start < n; start += hop) {
    const mid = Math.min(n - 1, start + Math.min(hop, fftSize) / 2);
    const winStart = Math.max(
      0,
      Math.min(n - fftSize, Math.floor(mid - fftSize / 2)),
    );
    const { centroid, energy, mag } = spectralFrame(
      pcm,
      winStart,
      fftSize,
      sampleRate,
    );
    const rms = windowRms(pcm, winStart, fftSize);
    let flux = 0;
    if (prevMag) {
      for (let k = 1; k < mag.length; k++) {
        const d = mag[k]! - prevMag[k]!;
        if (d > 0) flux += d;
      }
    }
    prevMag = mag;
    const pos = n <= 1 ? 0.5 : mid / (n - 1);
    raw.push({
      pos: clamp01(pos),
      centroid,
      energy,
      rms,
      flux,
      mag,
    });
  }

  if (raw.length === 0) {
    return [
      {
        pos: 0.5,
        centroidHz: 1000,
        stationarity: 0.5,
        energy: 1,
        angle: 0.5,
        radius: POLAR_SEGMENT_RADIUS,
        band: 0.5,
      },
    ];
  }

  // First hop has no previous mag → flux was 0 (falsely "perfect sustain").
  // Score it against the next hop: louder/brighter than what follows = attack.
  if (raw.length >= 2) {
    const a = raw[0]!;
    const b = raw[1]!;
    let flux0 = 0;
    for (let k = 1; k < a.mag.length; k++) {
      const d = a.mag[k]! - b.mag[k]!;
      if (d > 0) flux0 += d;
    }
    a.flux = flux0;
  }

  const energetic = raw.filter((s) => s.energy > 1e-8);
  const pool = energetic.length >= 2 ? energetic : raw;

  const rmsFloor = 1e-8;
  const energyJumps = new Float32Array(pool.length);
  for (let i = 0; i < pool.length; i++) {
    const e = pool[i]!.rms;
    if (i === 0 && pool.length >= 2) {
      // vs next: start click then quiet → high; pad→pad → ~0.
      const next = pool[1]!.rms;
      energyJumps[i] = Math.max(0, e - next) / Math.max(next, rmsFloor);
    } else if (i === 0) {
      energyJumps[i] = 0;
    } else {
      const prev = pool[i - 1]!.rms;
      energyJumps[i] = Math.max(0, e - prev) / Math.max(prev, rmsFloor);
    }
  }

  let maxFlux = 1e-12;
  let maxJump = 1e-12;
  for (let i = 0; i < pool.length; i++) {
    if (pool[i]!.flux > maxFlux) maxFlux = pool[i]!.flux;
    if (energyJumps[i]! > maxJump) maxJump = energyJumps[i]!;
  }

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
    const fluxN = clamp01(s.flux / maxFlux);
    const jumpN = clamp01(energyJumps[i]! / maxJump);
    const attack = clamp01(W_ATTACK_ENERGY * jumpN + W_ATTACK_FLUX * fluxN);
    const stationarity = 1 - attack;
    segments.push({
      pos: s.pos,
      centroidHz: Math.max(40, s.centroid),
      stationarity,
      energy: s.energy,
      angle: angleOf[i]!,
      radius: POLAR_SEGMENT_RADIUS,
      band: bandOf[i]!,
    });
  }

  // Guarantee head/tail of file are selectable centres (keep true stationarity).
  if (segments.length > 0) {
    const head = { ...segments[0]!, pos: 0 };
    const tail = { ...segments[segments.length - 1]!, pos: 1 };
    if (!segments.some((s) => s.pos <= 0.01)) segments.push(head);
    if (!segments.some((s) => s.pos >= 0.99)) segments.push(tail);
  }

  return segments;
}

/** High-stationarity quantile, with a gap punched around real attack peaks. */
function sustainedSubset(segments: MaterialSegment[]): MaterialSegment[] {
  if (segments.length < 2) return segments;
  const scores = segments.map((s) => s.stationarity).sort((a, b) => a - b);
  const q = clamp01(SUSTAINED_SUBSET_QUANTILE);
  const idx = Math.min(
    scores.length - 1,
    Math.max(0, Math.floor(q * (scores.length - 1))),
  );
  const threshold = scores[idx]!;
  let kept = segments.filter((s) => s.stationarity >= threshold);
  if (kept.length === 0) return segments;

  // Only punch around clearly transient hops. Comparing to the median cut
  // alone treats pad micro-jitter (0.995 vs 0.999) as attacks and empties
  // the subset, which then falls back to the un-punched half.
  const attackCut = Math.min(0.5, threshold - 0.15);
  const attacks = segments.filter((s) => s.stationarity <= attackCut);
  if (attacks.length > 0 && attacks.length < segments.length) {
    const gap = Math.max(1e-4, SUSTAINED_ATTACK_GAP);
    const cleared = kept.filter((s) => {
      for (const a of attacks) {
        if (Math.abs(s.pos - a.pos) < gap) return false;
      }
      return true;
    });
    if (cleared.length > 0) kept = cleared;
  }

  return kept.length > 0 ? kept : segments;
}

function nearestPolar(
  segments: MaterialSegment[],
  hue: number,
  sat: number,
  value: number,
): MaterialQueryResult {
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
    const score = angleW * dA * dA + radiusW * dR * dR + bandW * dB * dB;
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

function windowRms(pcm: Float32Array, start: number, length: number): number {
  let e = 0;
  let n = 0;
  for (let i = 0; i < length; i++) {
    const s = pcm[start + i] ?? 0;
    e += s * s;
    n++;
  }
  return n > 0 ? Math.sqrt(e / n) : 0;
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
