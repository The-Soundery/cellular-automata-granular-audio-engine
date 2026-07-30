/**
 * AudioWorklet grain executor — V2 topological sonification.
 *
 * Layer 1 — Topology: X → sample position, Y → spectral position
 * Layer 2 — Timbral material: R density, G complexity, B coherence
 * Layers 3–4 — overlap / persistence drive cloud density & retrigger
 *
 * Performance rules:
 * - Iterate only active voices
 * - Precompute spectral bin weights once per grain trigger
 * - Single pass to fill the grain
 * - Hard caps on polyphony and triggers per quantum
 */

const MAX_VOICES = 32;
const GRAIN_CAP = 12288;
const MAX_TRIGGERS_PER_BLOCK = 12;
const GAIN_SMOOTH = 0.04;
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
    this.gridWidth = 128;
    this.gridHeight = 128;
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
    if (typeof msg.gridWidth === "number" && msg.gridWidth > 1) {
      this.gridWidth = msg.gridWidth | 0;
    }
    if (typeof msg.gridHeight === "number" && msg.gridHeight > 1) {
      this.gridHeight = msg.gridHeight | 0;
    }
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

  /**
   * Layer 3–4: overlap drives cloud density; persistence slows retrigger
   * in temporally stable regions without collapsing wash stacking.
   */
  triggerInterval(v, grainSamples) {
    const sr = this.sampleRate_;
    let advance;
    if (v.overlap >= 0.65) {
      advance = 0.5 + 0.3 * v.overlap;
    } else {
      advance = 0.12 + 0.45 * v.overlap;
    }
    // Stable cells retrigger less often; wash stays continuous.
    advance *= 1 - 0.22 * v.persistence;
    if (v.overlap >= 0.65) advance = Math.max(0.42, advance);

    let interval = Math.floor(grainSamples * (1 - advance));
    interval = Math.min(interval, grainSamples);
    const minInterval = Math.max(64, Math.floor(sr / 100));
    const maxInterval = Math.floor(sr * 0.55);
    return Math.max(minInterval, Math.min(maxInterval, interval));
  }

  /** Image Y=0 is top → high spectrum; bottom → low (V2 Layer 1). */
  spectralNormFromY(y) {
    const h = Math.max(2, this.gridHeight);
    const yClamped = Math.max(0, Math.min(h - 1, y | 0));
    return 1 - yClamped / (h - 1);
  }

  /** Image X=0 is left → start of source (V2 Layer 1). */
  sampleNormFromX(x) {
    const w = Math.max(2, this.gridWidth);
    const xClamped = Math.max(0, Math.min(w - 1, x | 0));
    return xClamped / (w - 1);
  }

  /**
   * V2 Layer 2 — continuous timbral material around a Y spectral center.
   * R density: focused / crystal → narrow energy
   * G complexity: organic / intricate → wider uneven multi-bin mix
   * B coherence: smooth / liquid → soft falloff
   */
  buildMaterialWeights(yNorm, density, complexity, coherence) {
    const binCount = this.binCount;
    const scaled = clamp01(yNorm) * Math.max(1, binCount - 1);
    /** @type {{ bin: number, w: number }[]} */
    const weights = [];

    // Spread in bins: density collapses, complexity expands.
    const spread = Math.max(
      0.2,
      (1.15 - density * 0.95) * (0.55 + complexity * 2.4),
    );
    // Coherence softens the Gaussian (liquid) vs harder edges (brittle).
    const sigma = Math.max(0.28, spread * (0.4 + coherence * 0.75));
    const radius = Math.max(1, Math.ceil(sigma * 3.2));
    const lo = Math.max(0, Math.floor(scaled - radius));
    const hi = Math.min(binCount - 1, Math.ceil(scaled + radius));
    const twoSig2 = 2 * sigma * sigma;

    let wSum = 0;
    for (let bin = lo; bin <= hi; bin++) {
      const d = bin - scaled;
      let w = Math.exp((-d * d) / twoSig2);
      // Complexity adds uneven spectral detail without leaving the bank.
      if (complexity > 0.05) {
        const ripple =
          1 +
          complexity *
            0.55 *
            Math.sin(bin * 1.7 + density * 4.1 + coherence * 2.3);
        w *= Math.max(0.15, ripple);
      }
      if (w < 1e-5) continue;
      // Density concentrates: raise center relative to skirts.
      if (density > 0.05) {
        const centerBoost = 1 + density * 1.4 * Math.exp((-d * d) / (sigma * sigma + 0.01));
        w *= centerBoost;
      }
      weights.push({ bin, w });
      wSum += w;
    }

    if (weights.length === 0) {
      const bin0 = Math.max(0, Math.min(binCount - 1, Math.round(scaled)));
      weights.push({ bin: bin0, w: 1 });
      return weights;
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
    const xNorm = this.sampleNormFromX(v.x);
    const yNorm = this.spectralNormFromY(v.y);
    const start = Math.floor(xNorm * Math.max(0, len - grainSamples));
    const pcm = this.pcm;
    if (!this.bins.length) return;

    const density = clamp01(v.r);
    const complexity = clamp01(v.g);
    const coherence = clamp01(v.b);

    const env = this.getMaterialWindow(grainSamples, density, complexity, coherence);
    const grain = v.grain;
    const weights = this.buildMaterialWeights(
      yNorm,
      density,
      complexity,
      coherence,
    );

    let binEnergy = 0;
    let pcmEnergy = 0;
    const stride = Math.max(1, (grainSamples / 32) | 0);
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

    // Complexity invites a little dry richness; density keeps focus on the band.
    let dry = 0;
    if (pcm && pcmRms > 1e-5) {
      const ratio = binRms / pcmRms;
      const rescue =
        ratio < 0.1 ? 0.16 : ratio < 0.25 ? 0.07 : ratio < 0.4 ? 0.03 : 0;
      dry = rescue * (0.35 + complexity * 0.65) * (1 - density * 0.55);
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

  /**
   * Material window: coherence → smooth Hann; density → cleaner focus;
   * complexity → slightly harder / more Tukey character.
   */
  getMaterialWindow(n, density, complexity, coherence) {
    const morph = clamp01(
      complexity * 0.55 + (1 - coherence) * 0.35 + (1 - density) * 0.15,
    );
    const key =
      n +
      ":" +
      morph.toFixed(2) +
      ":" +
      density.toFixed(2) +
      ":" +
      coherence.toFixed(2);
    let w = this.windowCache.get(key);
    if (w) return w;
    w = new Float32Array(n);
    // High coherence → longer smooth taper; high density → cleaner Hann dominance.
    const taper = 0.5 * (1 - morph * 0.85) * (0.55 + coherence * 0.45);
    const hannMix = clamp01(0.35 + coherence * 0.45 + density * 0.25);
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
      w[i] = hann * hannMix + tukey * (1 - hannMix);
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
