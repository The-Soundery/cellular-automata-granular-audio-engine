/**
 * AudioWorklet — V3 equal-share field renderer.
 *
 * Lattice slots (not curated voices):
 *   X → sample position, Y → spectral position
 *   RGB → grain envelope material ONLY (never amplitude / spectrum)
 *   localDelta → refresh rate only
 *   amplitudeShare is always equal (1/N); masterGain is a global ceiling
 */

const MAX_GRAINS = 128;
const GRAIN_CAP = 12288;
const MAX_TRIGGERS_PER_BLOCK = 24;
const GAIN_SMOOTH = 0.04;
const STATS_EVERY_BLOCKS = 8;
const SEAM_CROSSFADE_SEC = 0.035;
const PLAN_FADE_SEC = 0.02;

class GrainSlot {
  constructor() {
    this.grain = new Float32Array(GRAIN_CAP);
    this.grainB = new Float32Array(GRAIN_CAP);
    this.reset();
  }

  reset() {
    this.active = false;
    this.latticeIndex = -1;
    this.r = 0;
    this.g = 0;
    this.b = 0;
    this.x = 0;
    this.y = 0;
    this.bakedX = 0;
    this.bakedY = 0;
    this.grainLengthSec = 0.09;
    this.amplitudeShare = 0;
    this.localDelta = 0;
    this.samplesUntilTrigger = 0;
    this.grainLen = 0;
    this.grainPos = 0;
    this.grainGain = 0;
    this.gainTarget = 0;
    this.sounding = false;
    this.crossLen = 0;
    this.crossPos = 0;
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
    this.slots = Array.from({ length: MAX_GRAINS }, () => new GrainSlot());
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
      } else if (msg.type === "resetGrains" || msg.type === "resetVoices") {
        this.masterGainTarget = 0;
        this.masterGain = 0;
        for (const s of this.slots) s.reset();
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
        for (const s of this.slots) s.reset();
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

    const list = msg.grains || msg.voices || [];
    const byIndex = new Map();
    for (const p of list) {
      const idx =
        typeof p.latticeIndex === "number" ? p.latticeIndex | 0 : -1;
      if (idx >= 0 && idx < MAX_GRAINS) byIndex.set(idx, p);
    }

    for (let i = 0; i < MAX_GRAINS; i++) {
      const slot = this.slots[i];
      const p = byIndex.get(i);
      if (!p) {
        slot.gainTarget = 0;
        if (slot.active && slot.amplitudeShare <= 0 && !slot.sounding) {
          slot.active = false;
          slot.latticeIndex = -1;
        } else if (slot.active) {
          slot.amplitudeShare = 0;
        }
        continue;
      }

      const isNew = !slot.active || slot.latticeIndex !== i;
      if (isNew) {
        slot.reset();
        slot.active = true;
        slot.latticeIndex = i;
        slot.samplesUntilTrigger = Math.floor(
          (i * this.sampleRate_ * 0.09) / Math.max(1, list.length),
        );
      }

      slot.r = clamp01(p.r);
      slot.g = clamp01(p.g);
      slot.b = clamp01(p.b);
      slot.x = typeof p.x === "number" ? p.x : 0;
      slot.y = typeof p.y === "number" ? p.y : 0;
      slot.grainLengthSec =
        typeof p.grainLengthSec === "number" ? p.grainLengthSec : 0.09;
      slot.localDelta = clamp01(p.localDelta ?? 0);
      slot.amplitudeShare = Math.max(0, p.amplitudeShare || 0);
      slot.gainTarget = slot.amplitudeShare;
      slot.active = true;

      // Faster refresh where the field is changing — not a chaos aesthetic pool.
      if (!isNew && slot.localDelta > 0.08) {
        const hurry = Math.floor(
          this.sampleRate_ * (0.04 - 0.03 * slot.localDelta),
        );
        slot.samplesUntilTrigger = Math.min(
          slot.samplesUntilTrigger,
          Math.max(32, hurry),
        );
      }
    }

    let active = 0;
    for (let i = 0; i < MAX_GRAINS; i++) {
      if (this.slots[i].active) active++;
    }
    this.activeCount = active;
  }

  grainSampleCount(slot) {
    const sr = this.sampleRate_;
    return Math.min(
      GRAIN_CAP,
      Math.max(64, Math.floor(slot.grainLengthSec * sr)),
    );
  }

  /** Fixed medium overlap; localDelta shortens interval (field change). */
  triggerInterval(slot, grainSamples) {
    const sr = this.sampleRate_;
    // ~55% hop → continuous fusion when field is steady.
    let advance = 0.55;
    advance *= 1 + 0.35 * clamp01(slot.localDelta);
    let interval = Math.floor(grainSamples * (1 - Math.min(0.85, advance)));
    const minInterval = Math.max(64, Math.floor(sr / 80));
    const maxInterval = Math.floor(sr * 0.2);
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

  /** Colour → envelope material only. Never amplitude. */
  getRegionEnvelope(n, r, g, b) {
    const attack = 0.08 + clamp01(r) * 0.35;
    const release = 0.12 + clamp01(g) * 0.45;
    const curve = 0.4 + clamp01(b) * 0.9;
    const key =
      n +
      ":" +
      attack.toFixed(2) +
      ":" +
      release.toFixed(2) +
      ":" +
      curve.toFixed(2);
    let w = this.windowCache.get(key);
    if (w) return w;
    w = new Float32Array(n);
    const aN = Math.max(1, Math.floor(n * attack));
    const rN = Math.max(1, Math.floor(n * release));
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
      w[i] = env * 0.55 + hann * 0.45;
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

    let triggersLeft = MAX_TRIGGERS_PER_BLOCK;
    let sounding = 0;
    const fadeSamples = Math.max(1, Math.floor(PLAN_FADE_SEC * this.sampleRate_));

    const startIdx = this.rrCursor % Math.max(1, MAX_GRAINS);
    this.rrCursor = (this.rrCursor + 1) % Math.max(1, MAX_GRAINS);

    for (let i = 0; i < n; i++) {
      for (let k = 0; k < MAX_GRAINS; k++) {
        const slot = this.slots[(startIdx + k) % MAX_GRAINS];
        if (!slot || !slot.active) continue;

        // Smooth gain toward equal-share target to avoid plan-swap clicks.
        const gStep = (slot.gainTarget - slot.grainGain) / fadeSamples;
        slot.grainGain += gStep;
        if (Math.abs(slot.grainGain - slot.gainTarget) < 1e-5) {
          slot.grainGain = slot.gainTarget;
        }
        if (slot.grainGain <= 1e-5 && slot.gainTarget <= 0 && !slot.sounding) {
          slot.active = false;
          slot.latticeIndex = -1;
          continue;
        }

        if (slot.samplesUntilTrigger <= 0) {
          if (triggersLeft > 0 && slot.gainTarget > 0) {
            this.triggerGrain(slot);
            this.statsTriggers++;
            triggersLeft--;
            const grainSamples = slot.grainLen || this.grainSampleCount(slot);
            slot.samplesUntilTrigger = this.triggerInterval(slot, grainSamples);
          } else if (slot.gainTarget > 0) {
            this.statsDeferred++;
            slot.samplesUntilTrigger = n - i;
            continue;
          } else {
            slot.samplesUntilTrigger = Math.floor(this.sampleRate_ * 0.05);
          }
        }
        slot.samplesUntilTrigger--;

        let s = 0;
        if (slot.crossPos < slot.crossLen) {
          const t = slot.crossPos / Math.max(1, slot.crossLen - 1);
          const a = Math.cos(t * Math.PI * 0.5);
          const b = Math.sin(t * Math.PI * 0.5);
          const fromBuf = slot.crossFromIsB ? slot.grainB : slot.grain;
          const toBuf = slot.usingB ? slot.grainB : slot.grain;
          const from = fromBuf[Math.min(slot.crossPos, GRAIN_CAP - 1)] || 0;
          const to = toBuf[Math.min(slot.grainPos, GRAIN_CAP - 1)] || 0;
          s = (from * a + to * b) * slot.grainGain * this.masterGain;
          slot.crossPos++;
          if (slot.grainPos < slot.grainLen) slot.grainPos++;
          slot.sounding = true;
        } else if (slot.grainPos < slot.grainLen) {
          const buf = slot.usingB ? slot.grainB : slot.grain;
          s = buf[slot.grainPos++] * slot.grainGain * this.masterGain;
          slot.sounding = true;
        } else {
          slot.sounding = false;
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

    for (let i = 0; i < MAX_GRAINS; i++) {
      if (this.slots[i].sounding) sounding++;
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
    for (let i = 0; i < MAX_GRAINS; i++) {
      const s = this.slots[i];
      if (!s.active) continue;
      listen.push({
        latticeIndex: s.latticeIndex,
        x: s.x,
        y: s.y,
        r: s.r,
        g: s.g,
        b: s.b,
        amp: s.amplitudeShare,
        len: s.grainLengthSec,
        localDelta: s.localDelta,
        sounding: s.sounding,
        gain: s.grainGain * this.masterGain,
      });
    }

    this.port.postMessage({
      type: "stats",
      rms,
      peak: this.statsPeak,
      masterGain: this.masterGain,
      activeVoices: this.activeCount,
      activeGrains: this.activeCount,
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

  triggerGrain(slot) {
    const grainSamples = this.grainSampleCount(slot);
    const len = this.length;
    if (!this.bins.length) return;

    const w = this.gridWidth;
    const h = this.gridHeight;
    const xNorm = this.sampleNormFromX(slot.x);
    const yNorm = this.spectralNormFromY(slot.y);

    const wrapJump =
      slot.grainLen > 0 &&
      (Math.abs(slot.bakedX - slot.x) > w * 0.45 ||
        Math.abs(slot.bakedY - slot.y) > h * 0.45);

    const start = Math.floor(xNorm * Math.max(0, len - grainSamples));
    const env = this.getRegionEnvelope(
      grainSamples,
      slot.r,
      slot.g,
      slot.b,
    );
    const weights = this.buildSpectralWeights(yNorm);

    const writeToB = !slot.usingB;
    const target = writeToB ? slot.grainB : slot.grain;
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

    if (wrapJump || slot.localDelta > 0.2) {
      slot.crossLen = Math.min(
        grainSamples,
        Math.floor(SEAM_CROSSFADE_SEC * this.sampleRate_),
      );
      slot.crossPos = 0;
      slot.crossFromIsB = slot.usingB;
    } else {
      slot.crossLen = 0;
      slot.crossPos = 0;
    }

    slot.usingB = writeToB;
    slot.grainLen = grainSamples;
    slot.grainPos = 0;
    slot.bakedX = slot.x;
    slot.bakedY = slot.y;
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
