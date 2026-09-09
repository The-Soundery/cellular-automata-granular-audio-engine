/** Offline source prep — stereo PCM, seam crossfade, polar HSV→material map. */

/** Equal-power crossfade length at the loop seam (seconds). */
export const SEAM_FADE_SEC = 0.05;
/** Hop length for segment analysis (seconds). Hop ≤ FFT so coverage is full. */
export const CENTROID_HOP_SEC = 0.046439;
/** Analysis window for FFT (samples, power of two). ~46.4 ms at 44.1 kHz. */
const CENTROID_FFT_SIZE = 2048;
/** Fixed polar radius for all segments (outer annulus). Grey queries sit at 0. */
export const POLAR_SEGMENT_RADIUS = 0.85;
/**
 * Attack score at/above this (and locally maximal) starts a new material
 * unit — segments align to onsets so window centres land on musical units
 * (a hit, a word, a swell) instead of arbitrary fixed-hop slices.
 */
export const ONSET_ATTACK_MIN = 0.45;
/**
 * Sustained stretches split at this length so long pads still expose many
 * selectable centres (identity coverage). Scaled down for short files so
 * fixtures keep enough segments; see maxUnitSec in buildPolarSegments.
 */
export const SEGMENT_MAX_SEC = 1.0;
/** Attack mix: short-time energy jump dominates; spectral flux is secondary. */
const W_ATTACK_ENERGY = 0.65;
const W_ATTACK_FLUX = 0.35;
/** Polar distance weights (angle wraps). */
const W_ANGLE = 1.0;
const W_RADIUS = 0.85;
const W_BAND = 0.55;
/**
 * Hops this far below the loudest analysis hop are file silence / noise floor
 * — never selectable material. Relative so a quiet pad still maps.
 */
export const SILENCE_GATE_DB = -40;
/** Mel bands for the offline timbre embedding (PCA → polar angle / band). */
const MEL_BANDS = 24;
const MEL_LO_HZ = 40;
const MEL_HI_HZ = 16000;
const PCA_ITERS = 40;

export interface MaterialSegment {
  /** File position of segment midpoint [0,1]. */
  pos: number;
  /** Inclusive start of the slice in file position [0,1]. */
  startPos: number;
  /** Exclusive-ish end of the slice in file position [0,1]. */
  endPos: number;
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
  startPos: number;
  endPos: number;
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
 * hue = angle (mel-PCA 1), sat = radius (grey→centre), value = band (mel-PCA 2).
 * Colour maps absolutely — same HSV always hits the same segment.
 */
export function queryMaterialFromHsv(
  segments: MaterialSegment[],
  hue: number,
  sat: number,
  value: number,
): MaterialQueryResult {
  if (!segments.length) {
    const c = clamp01(value);
    return {
      sampleCenter: c,
      startPos: Math.max(0, c - 0.05),
      endPos: Math.min(1, c + 0.05),
      centroidHz: 1000,
      stationarity: 0.5,
    };
  }

  return nearestPolar(segments, hue, sat, value);
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
      startPos: 0,
      endPos: 1,
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
        startPos: 0,
        endPos: 1,
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
        startPos: 0,
        endPos: 1,
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
    mel: Float64Array;
  };
  const raw: Raw[] = [];
  let prevMag: Float32Array | null = null;
  const filterbank = makeMelFilterbank(fftSize >> 1, sampleRate, fftSize);

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
      mel: melPowerFromMag(mag, filterbank),
    });
  }

  if (raw.length === 0) {
    return [
      {
        pos: 0.5,
        startPos: 0,
        endPos: 1,
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

  let maxRms = 0;
  for (const s of raw) if (s.rms > maxRms) maxRms = s.rms;
  const rmsGate = maxRms * Math.pow(10, SILENCE_GATE_DB / 20);
  const energetic = raw.filter((s) => s.rms >= rmsGate);
  const pool = energetic.length >= 1 ? energetic : raw;

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

  // Per-hop attack score (energy jump leads, spectral flux secondary).
  const hopAttack = new Float32Array(pool.length);
  for (let i = 0; i < pool.length; i++) {
    const fluxN = clamp01(pool[i]!.flux / maxFlux);
    const jumpN = clamp01(energyJumps[i]! / maxJump);
    hopAttack[i] = clamp01(W_ATTACK_ENERGY * jumpN + W_ATTACK_FLUX * fluxN);
  }

  // Onset-aligned units: a boundary wherever a hop's attack is strong and
  // locally maximal; long sustained stretches split so coverage holds.
  const hopSec = hop / sampleRate;
  const durationSec = n / sampleRate;
  const maxUnitSec = Math.min(
    SEGMENT_MAX_SEC,
    Math.max(0.2, durationSec / 24),
  );
  const maxUnitHops = Math.max(1, Math.round(maxUnitSec / hopSec));
  const boundaries: number[] = [0];
  for (let i = 1; i < pool.length; i++) {
    const a = hopAttack[i]!;
    if (
      a >= ONSET_ATTACK_MIN &&
      a >= hopAttack[i - 1]! &&
      (i + 1 >= pool.length || a >= hopAttack[i + 1]!)
    ) {
      boundaries.push(i);
    }
  }
  boundaries.push(pool.length);

  const segments: MaterialSegment[] = [];
  const timbres: Float64Array[] = [];
  const meanRms: number[] = [];
  for (let b = 0; b < boundaries.length - 1; b++) {
    const unitStart = boundaries[b]!;
    const unitEnd = boundaries[b + 1]!;
    for (let s0 = unitStart; s0 < unitEnd; s0 += maxUnitHops) {
      const s1 = Math.min(unitEnd, s0 + maxUnitHops);
      let wSum = 0;
      let posSum = 0;
      let cenNum = 0;
      let cenDen = 0;
      let energySum = 0;
      let rmsSum = 0;
      let attackSum = 0;
      const melAcc = new Float64Array(MEL_BANDS);
      for (let i = s0; i < s1; i++) {
        const hopI = pool[i]!;
        // Energy-weighted position: a hit's centre sits on the hit, a pad's
        // in its middle — window centres land where the unit's energy lives.
        const wgt = hopI.rms * hopI.rms + 1e-12;
        wSum += wgt;
        posSum += hopI.pos * wgt;
        cenNum += hopI.centroid * hopI.energy;
        cenDen += hopI.energy;
        energySum += hopI.energy;
        rmsSum += hopI.rms;
        attackSum += hopAttack[i]!;
        for (let bMel = 0; bMel < MEL_BANDS; bMel++) {
          melAcc[bMel]! += hopI.mel[bMel]! * wgt;
        }
      }
      const count = Math.max(1, s1 - s0);
      const firstAttack = hopAttack[s0]!;
      const meanAttack = attackSum / count;
      const attack = clamp01(0.7 * firstAttack + 0.3 * meanAttack);
      // A unit that starts on an onset IS its attack — pin the position to
      // the onset hop so transient identity lands on the hit, not on an
      // energy-smeared tail. Sustained splits keep the energy-weighted centre.
      const pos =
        firstAttack >= ONSET_ATTACK_MIN
          ? pool[s0]!.pos
          : clamp01(posSum / wSum);
      // Half-hop pad around the hop range so the window covers the analysed
      // unit rather than only midpoints.
      const halfHop = hopSec / (2 * Math.max(1e-9, durationSec));
      const startPos = clamp01(pool[s0]!.pos - halfHop);
      const endPos = clamp01(
        pool[Math.max(s0, s1 - 1)]!.pos + halfHop,
      );
      segments.push({
        pos,
        startPos: Math.min(startPos, endPos),
        endPos: Math.max(startPos, endPos),
        centroidHz: Math.max(40, cenDen > 1e-12 ? cenNum / cenDen : 0),
        stationarity: 1 - attack,
        // Mean energy per hop so long pads don't rank top band by length.
        energy: energySum / count,
        angle: 0,
        radius: POLAR_SEGMENT_RADIUS,
        band: 0,
      });
      // Log-mel shape, L2-normalised so PCA is timbre not loudness.
      const vec = new Float64Array(MEL_BANDS);
      const invW = 1 / wSum;
      for (let bMel = 0; bMel < MEL_BANDS; bMel++) {
        vec[bMel] = Math.log(1e-12 + melAcc[bMel]! * invW);
      }
      l2Normalize(vec);
      timbres.push(vec);
      meanRms.push(rmsSum / count);
    }
  }

  if (energetic.length >= 1 && segments.length > 0) {
    let keep = 0;
    for (let i = 0; i < segments.length; i++) {
      if (meanRms[i]! >= rmsGate) {
        segments[keep] = segments[i]!;
        timbres[keep] = timbres[i]!;
        keep++;
      }
    }
    if (keep === 0) {
      let best = 0;
      for (let i = 1; i < meanRms.length; i++) {
        if (meanRms[i]! > meanRms[best]!) best = i;
      }
      segments[0] = segments[best]!;
      timbres[0] = timbres[best]!;
      keep = 1;
    }
    segments.length = keep;
    timbres.length = keep;
  }

  assignPolarFromMelPca(segments, timbres);

  // Head/tail only when that edge is itself audible — never pad silence.
  if (segments.length > 0) {
    if (
      !segments.some((s) => s.pos <= 0.01) &&
      raw.some((s) => s.pos <= 0.01 && s.rms >= rmsGate)
    ) {
      segments.push({
        ...segments[0]!,
        pos: 0,
        startPos: 0,
        endPos: Math.max(segments[0]!.endPos, 0.01),
      });
    }
    if (
      !segments.some((s) => s.pos >= 0.99) &&
      raw.some((s) => s.pos >= 0.99 && s.rms >= rmsGate)
    ) {
      const last = segments[segments.length - 1]!;
      segments.push({
        ...last,
        pos: 1,
        startPos: Math.min(last.startPos, 0.99),
        endPos: 1,
      });
    }
  }

  return segments;
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
    startPos: best.startPos,
    endPos: best.endPos,
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

function hzToMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700);
}

function melToHz(mel: number): number {
  return 700 * (Math.pow(10, mel / 2595) - 1);
}

/** Triangular mel weights, one dense vector per band, indexed by mag bin. */
function makeMelFilterbank(
  nMags: number,
  sampleRate: number,
  fftSize: number,
): Float64Array[] {
  const nyquist = sampleRate * 0.5;
  const fHi = Math.min(MEL_HI_HZ, nyquist * 0.98);
  const mLo = hzToMel(MEL_LO_HZ);
  const mHi = hzToMel(Math.max(MEL_LO_HZ + 1, fHi));
  const nPts = MEL_BANDS + 2;
  const hz = new Float64Array(nPts);
  for (let i = 0; i < nPts; i++) {
    hz[i] = melToHz(mLo + ((mHi - mLo) * i) / (nPts - 1));
  }
  const bands: Float64Array[] = [];
  for (let b = 0; b < MEL_BANDS; b++) {
    const fL = hz[b]!;
    const fC = hz[b + 1]!;
    const fR = hz[b + 2]!;
    const left = Math.max(fC - fL, 1e-9);
    const right = Math.max(fR - fC, 1e-9);
    const w = new Float64Array(nMags);
    for (let k = 1; k < nMags; k++) {
      const f = (k * sampleRate) / fftSize;
      if (f <= fL || f >= fR) continue;
      w[k] = f <= fC ? (f - fL) / left : (fR - f) / right;
    }
    bands.push(w);
  }
  return bands;
}

function melPowerFromMag(mag: Float32Array, bands: Float64Array[]): Float64Array {
  const out = new Float64Array(bands.length);
  for (let b = 0; b < bands.length; b++) {
    const w = bands[b]!;
    let e = 0;
    const n = Math.min(mag.length, w.length);
    for (let k = 1; k < n; k++) {
      const wk = w[k]!;
      if (wk === 0) continue;
      const m = mag[k]!;
      e += m * m * wk;
    }
    out[b] = e;
  }
  return out;
}

function l2Normalize(v: Float64Array): void {
  let e = 0;
  for (let i = 0; i < v.length; i++) e += v[i]! * v[i]!;
  const n = Math.sqrt(e);
  if (n < 1e-15) return;
  const inv = 1 / n;
  for (let i = 0; i < v.length; i++) v[i]! *= inv;
}

function hypotVec(v: Float64Array): number {
  let e = 0;
  for (let i = 0; i < v.length; i++) e += v[i]! * v[i]!;
  return Math.sqrt(e);
}

function dotVec(a: Float64Array, b: Float64Array): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i]! * b[i]!;
  return s;
}

function covMatVec(C: Float64Array, d: number, v: Float64Array): Float64Array {
  const w = new Float64Array(d);
  for (let i = 0; i < d; i++) {
    let s = 0;
    const row = i * d;
    for (let j = 0; j < d; j++) s += C[row + j]! * v[j]!;
    w[i] = s;
  }
  return w;
}

function rayleigh(C: Float64Array, d: number, v: Float64Array): number {
  return dotVec(v, covMatVec(C, d, v));
}

function deflate(C: Float64Array, d: number, v: Float64Array, lam: number): void {
  for (let i = 0; i < d; i++) {
    for (let j = 0; j < d; j++) {
      C[i * d + j]! -= lam * v[i]! * v[j]!;
    }
  }
}

function powerIterate(
  C: Float64Array,
  d: number,
  orthogonalTo: Float64Array | null,
): Float64Array {
  const v = new Float64Array(d);
  for (let i = 0; i < d; i++) v[i] = 1;
  if (orthogonalTo) {
    const p = dotVec(v, orthogonalTo);
    for (let i = 0; i < d; i++) v[i]! -= p * orthogonalTo[i]!;
  }
  let n0 = hypotVec(v);
  if (n0 < 1e-15) {
    v.fill(0);
    v[0] = 1;
    if (orthogonalTo) {
      const p = dotVec(v, orthogonalTo);
      for (let i = 0; i < d; i++) v[i]! -= p * orthogonalTo[i]!;
      n0 = hypotVec(v);
    }
  }
  if (n0 > 1e-15) {
    const inv = 1 / n0;
    for (let i = 0; i < d; i++) v[i]! *= inv;
  }

  for (let it = 0; it < PCA_ITERS; it++) {
    const w = covMatVec(C, d, v);
    if (orthogonalTo) {
      const p = dotVec(w, orthogonalTo);
      for (let i = 0; i < d; i++) w[i]! -= p * orthogonalTo[i]!;
    }
    const n = hypotVec(w);
    if (n < 1e-18) break;
    const inv = 1 / n;
    for (let i = 0; i < d; i++) v[i] = w[i]! * inv;
  }
  return v;
}

function rankUniformAssign(
  segments: MaterialSegment[],
  scores: Float64Array,
  axis: "angle" | "band",
): void {
  const order: { i: number; c: number }[] = [];
  for (let i = 0; i < scores.length; i++) order.push({ i, c: scores[i]! });
  order.sort((a, b) => a.c - b.c || a.i - b.i);
  const denom = Math.max(1, segments.length - 1);
  for (let rank = 0; rank < order.length; rank++) {
    const t = rank / denom;
    const s = segments[order[rank]!.i]!;
    if (axis === "angle") s.angle = t;
    else s.band = t;
  }
}

/**
 * PC1 → angle, PC2 → band, then rank-uniformise so the colour circle is filled.
 * Per-vector L2 already stripped gain; this is shape variation in the file.
 */
function assignPolarFromMelPca(
  segments: MaterialSegment[],
  vectors: Float64Array[],
): void {
  const n = segments.length;
  const d = MEL_BANDS;
  if (n === 0) return;
  if (n === 1 || vectors.length !== n) {
    for (const s of segments) {
      s.angle = 0.5;
      s.band = 0.5;
    }
    return;
  }

  const mean = new Float64Array(d);
  for (let i = 0; i < n; i++) {
    const v = vectors[i]!;
    for (let j = 0; j < d; j++) mean[j]! += v[j]!;
  }
  const invN = 1 / n;
  for (let j = 0; j < d; j++) mean[j]! *= invN;

  const X: Float64Array[] = [];
  for (let i = 0; i < n; i++) {
    const v = vectors[i]!;
    const row = new Float64Array(d);
    for (let j = 0; j < d; j++) row[j] = v[j]! - mean[j]!;
    X.push(row);
  }

  const C = new Float64Array(d * d);
  for (let i = 0; i < n; i++) {
    const row = X[i]!;
    for (let a = 0; a < d; a++) {
      const ra = row[a]!;
      if (ra === 0) continue;
      for (let b = a; b < d; b++) {
        const s = ra * row[b]!;
        C[a * d + b]! += s;
        if (a !== b) C[b * d + a]! += s;
      }
    }
  }
  for (let i = 0; i < C.length; i++) C[i]! *= invN;

  const v1 = powerIterate(C, d, null);
  const lam1 = rayleigh(C, d, v1);
  deflate(C, d, v1, lam1);
  const v2 = powerIterate(C, d, v1);

  const pc1 = new Float64Array(n);
  const pc2 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    pc1[i] = dotVec(X[i]!, v1);
    pc2[i] = dotVec(X[i]!, v2);
  }

  rankUniformAssign(segments, pc1, "angle");
  rankUniformAssign(segments, pc2, "band");
}
