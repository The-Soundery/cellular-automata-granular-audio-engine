/**
 * AudioWorklet grain executor — no realtime FFT.
 *
 * Performance rules (stutter fixes):
 * - Iterate only active voices (not the full pool every sample)
 * - Precompute spectral bin weights once per grain trigger
 * - Single pass to fill the grain (no double energy scan)
 * - Hard caps on polyphony and triggers per quantum
 */

const MAX_VOICES = 32;
const GRAIN_CAP = 12288;
const MAX_TRIGGERS_PER_BLOCK = 12;
const GAIN_SMOOTH = 0.04;
const BLUR_RADIUS = 3;
const STATS_EVERY_BLOCKS = 8;

class GrainVoice {
  constructor() {
    this.grain = new Float32Array(GRAIN_CAP);
    this.reset();
  }

  reset() {
    this.active = false;
    this.r = 0;
    this.g = 0;
    this.b = 0;
    this.x = 0;
    this.y = 0;
    this.grainLengthSec = 0.06;
    this.overlap = 0.5;
    this.persistence = 0.5;
    this.amplitudeShare = 0;
    this.samplesUntilTrigger = 0;
    this.grainLen = 0;
    this.grainPos = 0;
    this.grainGain = 0;
    this.sounding = false;
  }
}

class GrainProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    /** @type {Float32Array[]} */
    this.bins = [];
    /** @type {Float32Array | null} */
    this.pcm = null;
    this.length = 0;
    this.binCount = 0;
    this.sampleRate_ = sampleRate;
    this.masterGainTarget = 0;
    this.masterGain = 0;
    this.activeCount = 0;
    this.rrCursor = 0;
    this.voices = Array.from({ length: MAX_VOICES }, () => new GrainVoice());
    this.windowCache = new Map();
    this.blockCounter = 0;
    this.statsTriggers = 0;
    this.statsDeferred = 0;
    this.statsPeak = 0;
    this.statsEnergy = 0;
    this.statsSamples = 0;

    this.port.onmessage = (ev) => {
      const msg = ev.data;
      if (!msg || !msg.type) return;
      if (msg.type === "source") {
        this.sampleRate_ = msg.sampleRate || sampleRate;
        this.binCount = msg.binCount || 0;
        this.length = msg.length || 0;
        this.bins = [];
        if (msg.bins && msg.bins.length) {
          for (let i = 0; i < msg.bins.length; i++) {
            this.bins.push(new Float32Array(msg.bins[i]));
          }
        }
        this.pcm = msg.pcm ? new Float32Array(msg.pcm) : null;
        if (!this.length && this.bins[0]) this.length = this.bins[0].length;
      } else if (msg.type === "plan") {
        this.applyPlan(msg);
      } else if (msg.type === "clear") {
        this.bins = [];
        this.pcm = null;
        this.length = 0;
        this.binCount = 0;
        this.masterGainTarget = 0;
        for (const v of this.voices) v.reset();
        this.activeCount = 0;
      }
    };
  }

  applyPlan(msg) {
    this.masterGainTarget =
      typeof msg.masterGain === "number" ? msg.masterGain : 0;
    const list = msg.voices || [];
    this.activeCount = Math.min(list.length, MAX_VOICES);
    const n = this.activeCount || 1;

    for (let i = 0; i < MAX_VOICES; i++) {
      const v = this.voices[i];
      if (i >= list.length) {
        v.active = false;
        v.sounding = false;
        continue;
      }
      const p = list[i];
      const wasActive = v.active;
      v.active = true;
      v.r = clamp01(p.r);
      v.g = clamp01(p.g);
      v.b = clamp01(p.b);
      v.x = p.x | 0;
      v.y = p.y | 0;
      v.grainLengthSec = p.grainLengthSec;
      v.overlap = clamp01(p.overlap);
      v.persistence = clamp01(p.persistence ?? 0.5);
      v.amplitudeShare = Math.max(0, p.amplitudeShare || 0);

      if (!wasActive) {
        const grainSamples = this.grainSampleCount(v);
        const interval = this.triggerInterval(v, grainSamples);
        v.samplesUntilTrigger = Math.floor((i * interval) / n);
      }
    }
  }

  grainSampleCount(v) {
    const sr = this.sampleRate_;
    return Math.min(
      GRAIN_CAP,
      Math.max(64, Math.floor(v.grainLengthSec * sr)),
    );
  }

  triggerInterval(v, grainSamples) {
    const sr = this.sampleRate_;
    // Layer 2: overlap drives grain-cloud density.
    // High overlap (stable wash) → interval ≪ grain length → continuous cloud.
    // Low overlap (edges) → sparser, more audible as discrete grains.
    // Layer 3 persistence keeps voice identity sticky in FieldMetrics; it must NOT
    // force gaps here (that made 140ms wash sound robotic).
    let advance;
    if (v.overlap >= 0.65) {
      // Wash: target ~55–75% of each grain still sounding when the next fires.
      advance = 0.5 + 0.3 * v.overlap;
    } else {
      advance = 0.12 + 0.45 * v.overlap;
    }
    // Mild persistence temper only — never drop wash below ~45% stacking.
    advance *= 1 - 0.12 * v.persistence;
    if (v.overlap >= 0.65) advance = Math.max(0.45, advance);

    let interval = Math.floor(grainSamples * (1 - advance));
    interval = Math.min(interval, grainSamples);
    const minInterval = Math.max(64, Math.floor(sr / 100));
    const maxInterval = Math.floor(sr * 0.5);
    return Math.max(minInterval, Math.min(maxInterval, interval));
  }

  /** Build bin weight table once per grain (not per sample). */
  buildBinWeights(r, b) {
    const binCount = this.binCount;
    const scaled = r * Math.max(1, binCount - 1);
    const blur = clamp01(b) * BLUR_RADIUS;
    /** @type {{ bin: number, w: number }[]} */
    const weights = [];

    if (blur < 1e-3) {
      const bin0 = Math.max(0, Math.min(binCount - 1, Math.floor(scaled)));
      const bin1 = Math.max(0, Math.min(binCount - 1, bin0 + 1));
      const frac = scaled - Math.floor(scaled);
      weights.push({ bin: bin0, w: 1 - frac });
      if (bin1 !== bin0) weights.push({ bin: bin1, w: frac });
      return weights;
    }

    const lo = Math.max(0, Math.floor(scaled - blur));
    const hi = Math.min(binCount - 1, Math.ceil(scaled + blur));
    const sigma = Math.max(0.35, blur * 0.65);
    const twoSig2 = 2 * sigma * sigma;
    let wSum = 0;
    for (let bin = lo; bin <= hi; bin++) {
      const d = bin - scaled;
      const w = Math.exp((-d * d) / twoSig2);
      if (w < 1e-5) continue;
      weights.push({ bin, w });
      wSum += w;
    }
    if (wSum > 0) {
      for (const row of weights) row.w /= wSum;
    }
    return weights;
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || !output[0]) return true;
    const outL = output[0];
    const outR = output[1] || outL;
    const n = outL.length;

    for (let i = 0; i < n; i++) {
      outL[i] = 0;
      if (outR !== outL) outR[i] = 0;
    }

    if (!this.bins.length || this.length < 2) {
      this.emitStats(0);
      return true;
    }

    this.masterGain +=
      (this.masterGainTarget - this.masterGain) * GAIN_SMOOTH;

    const active = this.activeCount;
    let triggersLeft = MAX_TRIGGERS_PER_BLOCK;
    let sounding = 0;

    // Only walk active voice slots; rotate start for fairness
    const startIdx = this.rrCursor % Math.max(1, active);
    this.rrCursor = (this.rrCursor + 1) % Math.max(1, active);

    for (let i = 0; i < n; i++) {
      for (let k = 0; k < active; k++) {
        const v = this.voices[(startIdx + k) % active];
        if (!v || !v.active) continue;

        if (v.samplesUntilTrigger <= 0) {
          if (triggersLeft > 0) {
            this.triggerGrain(v);
            this.statsTriggers++;
            triggersLeft--;
            const grainSamples = v.grainLen || this.grainSampleCount(v);
            v.samplesUntilTrigger = this.triggerInterval(v, grainSamples);
          } else {
            this.statsDeferred++;
            v.samplesUntilTrigger = n - i;
            continue;
          }
        }
        v.samplesUntilTrigger--;

        if (v.grainPos < v.grainLen) {
          const s = v.grain[v.grainPos++] * v.grainGain * this.masterGain;
          outL[i] += s;
          if (outR !== outL) outR[i] += s;
          v.sounding = true;
        } else {
          v.sounding = false;
        }
      }
    }

    let blockPeak = 0;
    let blockEnergy = 0;
    for (let i = 0; i < n; i++) {
      outL[i] = softClip(outL[i]);
      if (outR !== outL) outR[i] = softClip(outR[i]);
      const a = Math.abs(outL[i]);
      if (a > blockPeak) blockPeak = a;
      blockEnergy += outL[i] * outL[i];
    }

    for (let i = 0; i < active; i++) {
      if (this.voices[i].sounding) sounding++;
    }

    this.statsPeak = Math.max(this.statsPeak, blockPeak);
    this.statsEnergy += blockEnergy;
    this.statsSamples += n;
    this.blockCounter++;
    this.emitStats(sounding);

    return true;
  }

  emitStats(soundingNow) {
    if (this.blockCounter % STATS_EVERY_BLOCKS !== 0) return;
    const secs = this.statsSamples / this.sampleRate_;
    const rms =
      this.statsSamples > 0
        ? Math.sqrt(this.statsEnergy / this.statsSamples)
        : 0;

    /** @type {object[]} */
    const listen = [];
    for (let i = 0; i < this.activeCount; i++) {
      const v = this.voices[i];
      if (!v.active) continue;
      listen.push({
        x: v.x,
        y: v.y,
        r: v.r,
        g: v.g,
        b: v.b,
        amp: v.amplitudeShare,
        len: v.grainLengthSec,
        sounding: v.sounding,
        gain: v.grainGain * this.masterGain,
      });
    }

    this.port.postMessage({
      type: "stats",
      rms,
      peak: this.statsPeak,
      masterGain: this.masterGain,
      activeVoices: this.activeCount,
      sounding: soundingNow,
      triggersPerSec: secs > 0 ? this.statsTriggers / secs : 0,
      deferredPerSec: secs > 0 ? this.statsDeferred / secs : 0,
      listen,
    });

    this.statsTriggers = 0;
    this.statsDeferred = 0;
    this.statsPeak = 0;
    this.statsEnergy = 0;
    this.statsSamples = 0;
  }

  triggerGrain(v) {
    const grainSamples = this.grainSampleCount(v);
    const len = this.length;
    const start = Math.floor(v.g * Math.max(0, len - grainSamples));
    const pcm = this.pcm;
    if (!this.bins.length) return;

    const env = this.getWindow(grainSamples, v.b);
    const grain = v.grain;
    const weights = this.buildBinWeights(v.r, v.b);

    // Single pass: spectral mix (+ tiny PCM rescue if band is empty)
    let binEnergy = 0;
    let pcmEnergy = 0;
    const stride = Math.max(1, (grainSamples / 32) | 0); // subsample for dry decision
    for (let i = 0; i < grainSamples; i += stride) {
      const idx = start + i;
      if (idx >= len) break;
      let band = 0;
      for (const row of weights) {
        const src = this.bins[row.bin];
        if (src) band += src[idx] * row.w;
      }
      binEnergy += band * band;
      if (pcm) pcmEnergy += pcm[idx] * pcm[idx];
    }
    const samplesChecked = Math.ceil(grainSamples / stride);
    const binRms = Math.sqrt(binEnergy / Math.max(1, samplesChecked));
    const pcmRms = pcm
      ? Math.sqrt(pcmEnergy / Math.max(1, samplesChecked))
      : 0;
    let dry = 0;
    if (pcm && pcmRms > 1e-5) {
      const ratio = binRms / pcmRms;
      dry = ratio < 0.12 ? 0.18 : ratio < 0.3 ? 0.08 : 0;
    }

    for (let i = 0; i < grainSamples; i++) {
      const idx = start + i;
      let s = 0;
      if (idx < len) {
        let band = 0;
        for (const row of weights) {
          const src = this.bins[row.bin];
          if (src) band += src[idx] * row.w;
        }
        const p = pcm ? pcm[idx] : 0;
        s = band * (1 - dry) + p * dry;
      }
      grain[i] = s * env[i];
    }

    v.grainLen = grainSamples;
    v.grainPos = 0;
    v.grainGain = v.amplitudeShare;
  }

  getWindow(n, b) {
    const morph = clamp01(b);
    const key = n + ":" + morph.toFixed(2);
    let w = this.windowCache.get(key);
    if (w) return w;
    w = new Float32Array(n);
    const taper = 0.5 * (1 - morph * 0.85);
    for (let i = 0; i < n; i++) {
      const x = n === 1 ? 0 : i / (n - 1);
      const hann = 0.5 * (1 - Math.cos(2 * Math.PI * x));
      let tukey = 1;
      if (taper > 1e-6) {
        if (x < taper) {
          tukey = 0.5 * (1 + Math.cos(Math.PI * (x / taper - 1)));
        } else if (x > 1 - taper) {
          tukey = 0.5 * (1 + Math.cos(Math.PI * ((x - 1 + taper) / taper)));
        }
      }
      w[i] = hann * (1 - morph) + tukey * morph;
    }
    this.windowCache.set(key, w);
    return w;
  }
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v || 0));
}

function softClip(x) {
  if (x > 1) return 1 + Math.tanh(x - 1) * 0.1;
  if (x < -1) return -1 + Math.tanh(x + 1) * 0.1;
  return x;
}

registerProcessor("grain-processor", GrainProcessor);
