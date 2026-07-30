/**
 * AudioWorklet — V2 structure-centric topological sonification.
 *
 * Layer 1: structure probe X/Y → sample / spectral position (motion-continuous)
 * Layer 2: region colour → grain envelope material ONLY
 * Layers 3–4: overlap / persistence / motion from structure behaviour
 *
 * Voices remapped by structureId+probeIndex (never list order).
 */

const MAX_VOICES = 32;
const GRAIN_CAP = 12288;
const MAX_TRIGGERS_PER_BLOCK = 12;
const GAIN_SMOOTH = 0.04;
const STATS_EVERY_BLOCKS = 8;
const MOTION_REFRESH_CELLS = 1.6;
const SEAM_CROSSFADE_SEC = 0.045;
const FADE_OUT_SEC = 0.08;

class GrainVoice {
  constructor() {
    this.grain = new Float32Array(GRAIN_CAP);
    this.grainB = new Float32Array(GRAIN_CAP);
    this.reset();
  }

  reset() {
    this.active = false;
    this.structureId = -1;
    this.probeIndex = 0;
    this.r = 0;
    this.g = 0;
    this.b = 0;
    this.colourCoherence = 0.5;
    this.x = 0;
    this.y = 0;
    this.bakedX = 0;
    this.bakedY = 0;
    this.grainLengthSec = 0.06;
    this.overlap = 0.5;
    this.persistence = 0.5;
    this.amplitudeShare = 0;
    this.motion = 0;
    this.samplesUntilTrigger = 0;
    this.grainLen = 0;
    this.grainPos = 0;
    this.grainGain = 0;
    this.sounding = false;
    this.fadeSamples = 0;
    this.fadePos = 0;
    this.crossLen = 0;
    this.crossPos = 0;
    this.crossGainFrom = 0;
    this.crossFromIsB = false;
    this.usingB = false;
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
      } else if (msg.type === "resetVoices") {
        // Keep spectral bank; wipe voice / gain state for CA Reset.
        this.masterGainTarget = 0;
        this.masterGain = 0;
        for (const v of this.voices) v.reset();
        this.activeCount = 0;
        this.statsTriggers = 0;
        this.statsDeferred = 0;
      } else if (msg.type === "clear") {
        this.bins = [];
        this.pcm = null;
        this.length = 0;
        this.binCount = 0;
        this.masterGainTarget = 0;
        this.masterGain = 0;
        for (const v of this.voices) v.reset();
        this.activeCount = 0;
      }
    };
  }

  voiceKey(structureId, probeIndex) {
    return structureId + ":" + probeIndex;
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
    const byKey = new Map();
    for (const p of list) {
      byKey.set(this.voiceKey(p.structureId | 0, p.probeIndex | 0), p);
    }

    const assigned = new Uint8Array(MAX_VOICES);
    const claimedKeys = new Set();

    // Remap existing voices by identity.
    for (let i = 0; i < MAX_VOICES; i++) {
      const v = this.voices[i];
      if (!v.active || v.structureId < 0) continue;
      const key = this.voiceKey(v.structureId, v.probeIndex);
      const p = byKey.get(key);
      if (!p) {
        // Structure gone — fade out once (do not restart fade every plan).
        v.amplitudeShare = 0;
        if (v.fadeSamples <= 0) {
          v.fadeSamples = Math.floor(FADE_OUT_SEC * this.sampleRate_);
          v.fadePos = 0;
        }
        continue;
      }
      this.writeParams(v, p, false);
      assigned[i] = 1;
      claimedKeys.add(key);
    }

    // Bind new identities to free slots.
    for (const p of list) {
      const key = this.voiceKey(p.structureId | 0, p.probeIndex | 0);
      if (claimedKeys.has(key)) continue;
      let slot = -1;
      for (let i = 0; i < MAX_VOICES; i++) {
        if (!assigned[i] && !this.voices[i].active) {
          slot = i;
          break;
        }
      }
      if (slot < 0) {
        for (let i = 0; i < MAX_VOICES; i++) {
          if (!assigned[i]) {
            slot = i;
            break;
          }
        }
      }
      if (slot < 0) break;
      const v = this.voices[slot];
      v.reset();
      v.active = true;
      this.writeParams(v, p, true);
      const grainSamples = this.grainSampleCount(v);
      const interval = this.triggerInterval(v, grainSamples);
      v.samplesUntilTrigger = Math.floor((slot * interval) / Math.max(1, list.length));
      assigned[slot] = 1;
      claimedKeys.add(key);
    }

    // Deactivate unassigned slots that finished fading.
    for (let i = 0; i < MAX_VOICES; i++) {
      if (assigned[i]) continue;
      const v = this.voices[i];
      if (v.active && v.amplitudeShare <= 0 && !v.sounding && v.fadeSamples <= 0) {
        v.active = false;
        v.structureId = -1;
      } else if (v.active && !claimedKeys.has(this.voiceKey(v.structureId, v.probeIndex))) {
        v.amplitudeShare = 0;
        if (v.fadeSamples <= 0) {
          v.fadeSamples = Math.floor(FADE_OUT_SEC * this.sampleRate_);
          v.fadePos = 0;
        }
      }
    }

    let active = 0;
    for (let i = 0; i < MAX_VOICES; i++) {
      if (this.voices[i].active) active++;
    }
    this.activeCount = active;
  }

  writeParams(v, p, isNew) {
    const prevX = v.x;
    const prevY = v.y;
    v.structureId = p.structureId | 0;
    v.probeIndex = p.probeIndex | 0;
    v.r = clamp01(p.r);
    v.g = clamp01(p.g);
    v.b = clamp01(p.b);
    v.colourCoherence = clamp01(p.colourCoherence ?? 0.5);
    v.x = typeof p.x === "number" ? p.x : 0;
    v.y = typeof p.y === "number" ? p.y : 0;
    v.grainLengthSec = p.grainLengthSec;
    v.overlap = clamp01(p.overlap);
    v.persistence = clamp01(p.persistence ?? 0.5);
    v.amplitudeShare = Math.max(0, p.amplitudeShare || 0);
    v.motion = Math.max(0, p.motion || 0);
    v.active = true;

    if (!isNew) {
      const dx = Math.abs(shortestDelta(prevX, v.x, this.gridWidth));
      const dy = Math.abs(shortestDelta(prevY, v.y, this.gridHeight));
      const moved = Math.hypot(dx, dy);
      // Only rebake early on genuine translation — not tip/allocation flicker.
      if (v.motion >= MOTION_REFRESH_CELLS && moved >= MOTION_REFRESH_CELLS * 0.6) {
        v.samplesUntilTrigger = Math.min(
          v.samplesUntilTrigger,
          Math.floor(this.sampleRate_ * 0.012),
        );
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
    let advance;
    if (v.overlap >= 0.65) {
      advance = 0.5 + 0.3 * v.overlap;
    } else {
      advance = 0.12 + 0.45 * v.overlap;
    }
    advance *= 1 - 0.18 * v.persistence;
    // Moving structures retrigger denser for audible topology chase.
    const motionBoost = clamp01(v.motion / 5);
    advance *= 1 - 0.22 * motionBoost;
    if (v.overlap >= 0.65 && motionBoost < 0.35) {
      advance = Math.max(0.42, advance);
    }

    let interval = Math.floor(grainSamples * (1 - advance));
    interval = Math.min(interval, grainSamples);
    if (motionBoost > 0.55) {
      interval = Math.min(interval, Math.floor(sr * 0.055));
    }
    const minInterval = Math.max(64, Math.floor(sr / 100));
    const maxInterval = Math.floor(sr * 0.55);
    return Math.max(minInterval, Math.min(maxInterval, interval));
  }

  spectralNormFromY(y) {
    const h = Math.max(2, this.gridHeight);
    const yc = Math.max(0, Math.min(h - 1, y));
    return 1 - yc / (h - 1);
  }

  sampleNormFromX(x) {
    const w = Math.max(2, this.gridWidth);
    const xc = ((x % w) + w) % w;
    return xc / (w - 1);
  }

  /** Y-only spectral focus — colour never enters here. */
  buildSpectralWeights(yNorm) {
    const binCount = this.binCount;
    const scaled = clamp01(yNorm) * Math.max(1, binCount - 1);
    /** @type {{ bin: number, w: number }[]} */
    const weights = [];
    const bin0 = Math.max(0, Math.min(binCount - 1, Math.floor(scaled)));
    const bin1 = Math.max(0, Math.min(binCount - 1, bin0 + 1));
    const frac = scaled - Math.floor(scaled);
    weights.push({ bin: bin0, w: 1 - frac });
    if (bin1 !== bin0) weights.push({ bin: bin1, w: frac });
    return weights;
  }

  /**
   * Colour → envelope material only.
   * R → attack sharpness, G → release length, B → curvature / energy distribution.
   * colourCoherence pulls toward smoother symmetric Hann.
   */
  getRegionEnvelope(n, r, g, b, coherence) {
    const attack = 0.08 + clamp01(r) * 0.35;
    const release = 0.12 + clamp01(g) * 0.45;
    const curve = 0.4 + clamp01(b) * 0.9;
    const coh = clamp01(coherence);
    const key =
      n +
      ":" +
      attack.toFixed(2) +
      ":" +
      release.toFixed(2) +
      ":" +
      curve.toFixed(2) +
      ":" +
      coh.toFixed(2);
    let w = this.windowCache.get(key);
    if (w) return w;
    w = new Float32Array(n);
    const aN = Math.max(1, Math.floor(n * attack * (1.15 - coh * 0.4)));
    const rN = Math.max(1, Math.floor(n * release * (1.15 - coh * 0.35)));
    for (let i = 0; i < n; i++) {
      let env = 1;
      if (i < aN) {
        const t = i / aN;
        env = Math.pow(t, 0.6 + curve * 0.8);
      } else if (i > n - 1 - rN) {
        const t = (n - 1 - i) / rN;
        env = Math.pow(Math.max(0, t), 0.7 + (1.2 - curve) * 0.5);
      }
      const x = n === 1 ? 0 : i / (n - 1);
      const hann = 0.5 * (1 - Math.cos(2 * Math.PI * x));
      // Coherent regions → more Hann; differentiated colour → more asymmetric ADS.
      w[i] = env * (1 - coh * 0.55) + hann * (0.35 + coh * 0.65);
    }
    this.windowCache.set(key, w);
    return w;
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

    const startIdx = this.rrCursor % Math.max(1, MAX_VOICES);
    this.rrCursor = (this.rrCursor + 1) % Math.max(1, MAX_VOICES);

    for (let i = 0; i < n; i++) {
      for (let k = 0; k < MAX_VOICES; k++) {
        const v = this.voices[(startIdx + k) % MAX_VOICES];
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

        let s = 0;
        if (v.crossPos < v.crossLen) {
          const t = v.crossPos / Math.max(1, v.crossLen - 1);
          const a = Math.cos(t * Math.PI * 0.5);
          const b = Math.sin(t * Math.PI * 0.5);
          const fromBuf = v.crossFromIsB ? v.grainB : v.grain;
          const toBuf = v.usingB ? v.grainB : v.grain;
          const fromIdx = Math.min(v.crossPos, GRAIN_CAP - 1);
          const toIdx = Math.min(v.grainPos, GRAIN_CAP - 1);
          const from = fromBuf[fromIdx] || 0;
          const to = toBuf[toIdx] || 0;
          s = (from * a + to * b) * v.grainGain * this.masterGain;
          v.crossPos++;
          if (v.grainPos < v.grainLen) v.grainPos++;
          v.sounding = true;
        } else if (v.grainPos < v.grainLen) {
          const buf = v.usingB ? v.grainB : v.grain;
          s = buf[v.grainPos++] * v.grainGain * this.masterGain;
          v.sounding = true;
        } else {
          v.sounding = false;
        }

        if (v.fadeSamples > 0) {
          const f = 1 - v.fadePos / Math.max(1, v.fadeSamples);
          s *= Math.max(0, f);
          v.fadePos++;
          if (v.fadePos >= v.fadeSamples) {
            v.fadeSamples = 0;
            if (v.amplitudeShare <= 0) {
              v.active = false;
              v.structureId = -1;
              v.sounding = false;
            }
          }
        }

        outL[i] += s;
        if (outR !== outL) outR[i] += s;
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

    for (let i = 0; i < MAX_VOICES; i++) {
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
    for (let i = 0; i < MAX_VOICES; i++) {
      const v = this.voices[i];
      if (!v.active) continue;
      listen.push({
        structureId: v.structureId,
        probeIndex: v.probeIndex,
        // Prefer live probe for overlay; baked is available for diagnostics.
        x: v.x,
        y: v.y,
        liveX: v.x,
        liveY: v.y,
        bakedX: v.bakedX,
        bakedY: v.bakedY,
        r: v.r,
        g: v.g,
        b: v.b,
        amp: v.amplitudeShare,
        len: v.grainLengthSec,
        sounding: v.sounding,
        gain: v.grainGain * this.masterGain,
        extentW: 0,
        extentH: 0,
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
    if (!this.bins.length) return;

    const w = this.gridWidth;
    const h = this.gridHeight;
    const xNorm = this.sampleNormFromX(v.x);
    const yNorm = this.spectralNormFromY(v.y);

    const dx = Math.abs(shortestDelta(v.bakedX, v.x, w));
    const dy = Math.abs(shortestDelta(v.bakedY, v.y, h));
    const wrapJump =
      v.grainLen > 0 &&
      (Math.abs(v.bakedX - v.x) > w * 0.45 ||
        Math.abs(v.bakedY - v.y) > h * 0.45);
    const motionRefresh =
      v.grainLen > 0 &&
      v.grainPos < v.grainLen &&
      dx + dy > MOTION_REFRESH_CELLS;

    const start = Math.floor(xNorm * Math.max(0, len - grainSamples));
    const env = this.getRegionEnvelope(
      grainSamples,
      v.r,
      v.g,
      v.b,
      v.colourCoherence,
    );
    const weights = this.buildSpectralWeights(yNorm);

    // Always write into the inactive buffer, then swap (optional crossfade).
    const writeToB = !v.usingB;
    const target = writeToB ? v.grainB : v.grain;
    const pcm = this.pcm;

    for (let i = 0; i < grainSamples; i++) {
      const idx = start + i;
      let s = 0;
      if (idx < len) {
        let band = 0;
        for (const row of weights) {
          const src = this.bins[row.bin];
          if (src) band += src[idx] * row.w;
        }
        if (pcm && Math.abs(band) < 1e-6) {
          s = pcm[idx] * 0.04;
        } else {
          s = band;
        }
      }
      target[i] = s * env[i];
    }

    if (wrapJump || motionRefresh) {
      v.crossLen = Math.min(
        grainSamples,
        Math.floor(SEAM_CROSSFADE_SEC * this.sampleRate_),
      );
      v.crossPos = 0;
      v.crossFromIsB = v.usingB;
    } else {
      v.crossLen = 0;
      v.crossPos = 0;
    }

    v.usingB = writeToB;
    v.grainLen = grainSamples;
    v.grainPos = 0;
    v.grainGain = v.amplitudeShare;
    v.bakedX = v.x;
    v.bakedY = v.y;
  }
}

function shortestDelta(from, to, period) {
  let d = to - from;
  if (d > period * 0.5) d -= period;
  if (d < -period * 0.5) d += period;
  return d;
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
