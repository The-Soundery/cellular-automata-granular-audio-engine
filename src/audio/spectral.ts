/** Offline spectral bin bank — V2 selects by structure Y only; colour never enters. */

export const SPECTRAL_BIN_COUNT = 48;
export const BIN_FREQ_LOW = 80;
export const BIN_FREQ_HIGH = 15000;
/** Design Q for offline bandpass centers — higher = narrower, clearer Y motion. */
export const BIN_DESIGN_Q = 4.5;

export interface SpectralBank {
  sampleRate: number;
  binCount: number;
  length: number;
  durationSec: number;
  /** Mono mix of the source (same timeline as bins). */
  pcm: Float32Array;
  /** Sharp bandpass-filtered copies; each length === pcm.length */
  bins: Float32Array[];
  /** Center frequency of each bin (Hz) */
  centersHz: Float32Array;
}

/** Build mono PCM + N sharp bandpass bins (offline; not for the audio thread). */
export function buildSpectralBank(
  audioBuffer: AudioBuffer,
  binCount = SPECTRAL_BIN_COUNT,
): SpectralBank {
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

  const nyquist = sampleRate * 0.5;
  const fHigh = Math.min(BIN_FREQ_HIGH, nyquist * 0.92);
  const fLow = Math.min(BIN_FREQ_LOW, fHigh * 0.5);
  const centersHz = new Float32Array(binCount);
  const bins: Float32Array[] = [];

  const q = BIN_DESIGN_Q;

  for (let b = 0; b < binCount; b++) {
    const t = binCount === 1 ? 0 : b / (binCount - 1);
    const fc = fLow * Math.pow(fHigh / fLow, t);
    centersHz[b] = fc;
    const bwHz = Math.max(40, fc / q);
    bins.push(bandpassFilter(pcm, sampleRate, fc, bwHz));
  }

  // Preserve relative bin energy; set overall peak from the loudest bin only.
  normalizeBankRelative(bins, 0.9);

  return {
    sampleRate,
    binCount,
    length,
    durationSec: length / sampleRate,
    pcm,
    bins,
    centersHz,
  };
}

/**
 * Single-stage RBJ bandpass (wider, less ringy than cascaded ultra-narrow).
 * No per-bin boost — relative levels fixed later across the bank.
 */
function bandpassFilter(
  input: Float32Array,
  sampleRate: number,
  fc: number,
  bwHz: number,
): Float32Array {
  const q = Math.max(0.7, fc / Math.max(bwHz, 1));
  const coeffs = rbjBandpass(sampleRate, fc, q);
  return biquadProcess(input, coeffs);
}

interface BiquadCoeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

function rbjBandpass(sampleRate: number, fc: number, q: number): BiquadCoeffs {
  const w0 = (2 * Math.PI * fc) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = sin / (2 * q);
  const b0 = alpha;
  const b1 = 0;
  const b2 = -alpha;
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: a1 / a0,
    a2: a2 / a0,
  };
}

function biquadProcess(input: Float32Array, c: BiquadCoeffs): Float32Array {
  const out = new Float32Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x0 = input[i]!;
    const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    out[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return out;
}

/** Scale entire bank by one gain so the loudest bin peaks at target — no empty-bin boost. */
function normalizeBankRelative(bins: Float32Array[], target: number): void {
  let peak = 0;
  for (const buf of bins) {
    for (let i = 0; i < buf.length; i++) {
      const a = Math.abs(buf[i]!);
      if (a > peak) peak = a;
    }
  }
  if (peak < 1e-8) return;
  const g = target / peak;
  for (const buf of bins) {
    for (let i = 0; i < buf.length; i++) buf[i]! *= g;
  }
}
