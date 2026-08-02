/**
 * AudioWorklet — ephemeral grains (V4 Sonic Laws: hue→sample, X→pan).
 *
 * Sample window / ping-pong bounds freeze at spawn (no scrub chase).
 * Any grain with a regionId directly follows that region's COM for pan + Y
 * (spawn offset preserved). No smoothing. Envelope frozen at spawn.
 * Energy normalisation keeps loudness roughly neutral.
 */

const MAX_GRAINS = 128;
const STATS_EVERY_BLOCKS = 8;
const GAIN_SMOOTH = 0.05;
const ENV_CACHE_MAX = 64;
/** Target RMS before soft clip — negotiable. */
const TARGET_RMS = 0.12;
const NORM_SMOOTH = 0.05;
/** Chaos defaults when spawn omits attack/release (regime packing material). */
const ENV_ATTACK_CHAOS = 0.06;
const ENV_RELEASE_CHAOS = 0.15;
const ENV_ATTACK_CALM = 0.22;
const ENV_RELEASE_CALM = 0.28;
const ENV_CURVE = 0.875;

class GrainVoice {
  constructor() {
    this.reset();
  }

  reset() {
    this.active = false;
    this.age = 0;
    this.duration = 1;
    this.readPos = 0;
    this.dir = 1;
    this.boundLo = 0;
    this.boundHi = 1;
    this.yNorm = 0.5;
    this.r = 0.5;
    this.g = 0.5;
    this.b = 0.5;
    this.amp = 0;
    this.x = 0;
    this.y = 0;
    this.pan = 0;
    this.trackDx = 0;
    this.trackDy = 0;
    this.gainL = 1;
    this.gainR = 1;
    this.regime = "chaos";
    this.regionId = -1;
    this.attackFrac = ENV_ATTACK_CHAOS;
    this.releaseFrac = ENV_RELEASE_CHAOS;
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
    this.masterGainTarget = 1;
    this.masterGain = 0;
    this.normGain = 1;
    this.voices = Array.from({ length: MAX_GRAINS }, () => new GrainVoice());
    this.windowCache = new Map();
    this.blockCounter = 0;
    this.statsTriggers = 0;
    this.statsPeak = 0;
    this.statsEnergy = 0;
    this.statsSamples = 0;
    this.rrCursor = 0;

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
      } else if (msg.type === "events") {
        this.masterGainTarget =
          typeof msg.masterGain === "number" ? msg.masterGain : 1;
        this.spawnEvents(msg.events || []);
        if (msg.tracks && msg.tracks.length) this.applyTracks(msg.tracks);
      } else if (msg.type === "track") {
        if (msg.tracks && msg.tracks.length) this.applyTracks(msg.tracks);
      } else if (msg.type === "resetGrains" || msg.type === "resetVoices") {
        this.masterGainTarget = 0;
        this.masterGain = 0;
        for (const v of this.voices) v.reset();
        this.statsTriggers = 0;
      } else if (msg.type === "clear") {
        this.bins = [];
        this.pcm = null;
        this.length = 0;
        this.binCount = 0;
        this.masterGainTarget = 0;
        this.masterGain = 0;
        for (const v of this.voices) v.reset();
      }
    };
  }

  spawnEvents(list) {
    if (!this.bins.length || this.length < 2) return;
    const len = this.length;
    for (const e of list) {
      const voice = this.allocVoice();
      if (!voice) break;

      voice.reset();
      voice.active = true;
      voice.age = 0;
      voice.duration = Math.max(
        32,
        Math.floor((e.durationSec || 0.1) * this.sampleRate_),
      );
      voice.r = clamp01(e.r);
      voice.g = clamp01(e.g);
      voice.b = clamp01(e.b);
      voice.amp = Math.max(0, e.amplitude || 0);
      voice.x = e.x || 0;
      voice.y = e.y || 0;
      voice.yNorm = clamp01(typeof e.yNorm === "number" ? e.yNorm : 0.5);
      voice.dir = e.direction < 0 ? -1 : 1;
      voice.regime = e.regime === "calm" ? "calm" : "chaos";
      voice.regionId = typeof e.regionId === "number" ? e.regionId : -1;
      // Envelope shape frozen at spawn (calm soft / chaos sharp) — not RGB-driven.
      const defA =
        voice.regime === "calm" ? ENV_ATTACK_CALM : ENV_ATTACK_CHAOS;
      const defR =
        voice.regime === "calm" ? ENV_RELEASE_CALM : ENV_RELEASE_CHAOS;
      voice.attackFrac = clamp01(
        typeof e.attackFrac === "number" ? e.attackFrac : defA,
      );
      voice.releaseFrac = clamp01(
        typeof e.releaseFrac === "number" ? e.releaseFrac : defR,
      );

      voice.trackDx = typeof e.trackDx === "number" ? e.trackDx : 0;
      voice.trackDy = typeof e.trackDy === "number" ? e.trackDy : 0;
      const pan =
        typeof e.pan === "number" ? Math.max(-1, Math.min(1, e.pan)) : 0;
      voice.pan = pan;
      applyEqualPowerPan(voice, pan);

      let lo = clamp01(e.sampleLo ?? 0);
      let hi = clamp01(e.sampleHi ?? 1);
      if (hi < lo) {
        const t = lo;
        lo = hi;
        hi = t;
      }
      if (hi - lo < 1 / len) hi = Math.min(1, lo + 2 / len);

      voice.boundLo = lo * Math.max(0, len - 1);
      voice.boundHi = hi * Math.max(0, len - 1);
      if (voice.boundHi <= voice.boundLo + 1) {
        voice.boundHi = voice.boundLo + 2;
      }

      // Start at midpoint of hue-locked window (frozen; no later chase).
      voice.readPos = (voice.boundLo + voice.boundHi) * 0.5;

      this.statsTriggers++;
    }
  }

  /**
   * Direct pan/Y follow: any voice with regionId snaps to COM + spawn offset.
   * Sample window stays frozen. No smoothing.
   */
  applyTracks(tracks) {
    /** @type {Map<number, {comX:number,comY:number,w:number,h:number}>} */
    const byId = new Map();
    for (const t of tracks) {
      if (typeof t.regionId !== "number") continue;
      byId.set(t.regionId, {
        comX: t.comX ?? 0,
        comY: t.comY ?? 0,
        w: Math.max(1, t.gridWidth || 1),
        h: Math.max(1, t.gridHeight || 1),
      });
    }
    for (const voice of this.voices) {
      if (!voice.active || voice.regionId < 0) continue;
      const t = byId.get(voice.regionId);
      if (!t) continue;
      const x = wrapCoord(t.comX + voice.trackDx, t.w);
      const y = wrapCoord(t.comY + voice.trackDy, t.h);
      voice.x = x;
      voice.y = y;
      voice.pan = panFromX(x, t.w);
      voice.yNorm = 1 - y / Math.max(1, t.h - 1);
      applyEqualPowerPan(voice, voice.pan);
    }
  }

  allocVoice() {
    for (let i = 0; i < MAX_GRAINS; i++) {
      const idx = (this.rrCursor + i) % MAX_GRAINS;
      if (!this.voices[idx].active) {
        this.rrCursor = (idx + 1) % MAX_GRAINS;
        return this.voices[idx];
      }
    }
    let oldest = null;
    let oldestAge = -1;
    for (const v of this.voices) {
      if (v.regime === "chaos" && v.age > oldestAge) {
        oldestAge = v.age;
        oldest = v;
      }
    }
    return oldest;
  }

  buildSpectralWeights(yNorm) {
    const binCount = this.binCount;
    const scaled = clamp01(yNorm) * Math.max(1, binCount - 1);
    const weights = [];
    const bin0 = Math.max(0, Math.min(binCount - 1, Math.floor(scaled)));
    const bin1 = Math.max(0, Math.min(binCount - 1, bin0 + 1));
    const frac = scaled - Math.floor(scaled);
    weights.push({ bin: bin0, w: 1 - frac });
    if (bin1 !== bin0) weights.push({ bin: bin1, w: frac });
    return weights;
  }

  getEnvelope(n, attackFrac, releaseFrac) {
    const attack = clamp01(
      typeof attackFrac === "number" ? attackFrac : ENV_ATTACK_CHAOS,
    );
    const release = clamp01(
      typeof releaseFrac === "number" ? releaseFrac : ENV_RELEASE_CHAOS,
    );
    const curve = ENV_CURVE;
    const key = `${n}|${attack.toFixed(3)}|${release.toFixed(3)}`;
    let w = this.windowCache.get(key);
    if (w) return w;
    if (this.windowCache.size > ENV_CACHE_MAX) this.windowCache.clear();
    w = new Float32Array(n);
    let aN = Math.max(1, Math.floor(n * attack));
    let rN = Math.max(1, Math.floor(n * release));
    if (aN + rN > n) {
      const scale = n / (aN + rN);
      aN = Math.max(1, Math.floor(aN * scale));
      rN = Math.max(1, n - aN);
    }
    for (let i = 0; i < n; i++) {
      let env = 1;
      if (i < aN) {
        const t = i / aN;
        env = Math.pow(t, 0.65 + curve * 0.6);
      } else if (i > n - 1 - rN) {
        const t = (n - 1 - i) / rN;
        env = Math.pow(Math.max(0, t), 0.7 + (1.15 - curve) * 0.45);
      }
      const x = n === 1 ? 0 : i / (n - 1);
      const hann = 0.5 * (1 - Math.cos(2 * Math.PI * x));
      w[i] = env * 0.65 + hann * 0.35;
    }
    this.windowCache.set(key, w);
    return w;
  }

  readSample(pos, weights) {
    const len = this.length;
    const idx = Math.max(0, Math.min(len - 1, pos | 0));
    let band = 0;
    for (const row of weights) {
      const src = this.bins[row.bin];
      if (src) band += src[idx] * row.w;
    }
    if (this.pcm && Math.abs(band) < 1e-6) {
      return this.pcm[idx] * 0.04;
    }
    return band;
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
      this.emitStats(0, 0);
      return true;
    }

    this.masterGain +=
      (this.masterGainTarget - this.masterGain) * GAIN_SMOOTH;

    let sounding = 0;
    let active = 0;

    for (const voice of this.voices) {
      if (!voice.active) continue;
      active++;

      const env = this.getEnvelope(
        voice.duration,
        voice.attackFrac,
        voice.releaseFrac,
      );
      const weights = this.buildSpectralWeights(voice.yNorm);
      const gL = voice.gainL;
      const gR = voice.gainR;
      let voiceSounded = false;

      for (let i = 0; i < n; i++) {
        if (voice.age >= voice.duration) {
          voice.active = false;
          voice.sounding = false;
          break;
        }

        const e = env[Math.min(voice.age, env.length - 1)] || 0;
        const s =
          this.readSample(voice.readPos, weights) *
          e *
          voice.amp *
          this.masterGain;

        outL[i] += s * gL;
        if (outR !== outL) outR[i] += s * gR;

        voice.readPos += voice.dir;
        if (voice.readPos >= voice.boundHi) {
          voice.readPos = voice.boundHi;
          voice.dir = -1;
        } else if (voice.readPos <= voice.boundLo) {
          voice.readPos = voice.boundLo;
          voice.dir = 1;
        }

        voice.age++;
        voiceSounded = true;
      }
      voice.sounding = voiceSounded && voice.active;
      if (voice.sounding) sounding++;
    }

    // Measure mono mix so hard-panned grains don't skew RMS
    let blockEnergy = 0;
    for (let i = 0; i < n; i++) {
      const m = outR !== outL ? (outL[i] + outR[i]) * 0.5 : outL[i];
      blockEnergy += m * m;
    }
    const blockRms = Math.sqrt(blockEnergy / Math.max(1, n));
    if (blockRms > 1e-5) {
      const desired = TARGET_RMS / blockRms;
      const capped = Math.max(0.2, Math.min(3.5, desired));
      this.normGain += (capped - this.normGain) * NORM_SMOOTH;
    } else if (active === 0) {
      this.normGain += (1 - this.normGain) * NORM_SMOOTH;
    }

    let blockPeak = 0;
    blockEnergy = 0;
    for (let i = 0; i < n; i++) {
      outL[i] = softClip(outL[i] * this.normGain);
      if (outR !== outL) outR[i] = softClip(outR[i] * this.normGain);
      const aL = Math.abs(outL[i]);
      const aR = outR !== outL ? Math.abs(outR[i]) : aL;
      if (aL > blockPeak) blockPeak = aL;
      if (aR > blockPeak) blockPeak = aR;
      const m = outR !== outL ? (outL[i] + outR[i]) * 0.5 : outL[i];
      blockEnergy += m * m;
    }

    this.statsPeak = Math.max(this.statsPeak, blockPeak);
    this.statsEnergy += blockEnergy;
    this.statsSamples += n;
    this.blockCounter++;
    this.emitStats(sounding, active);
    return true;
  }

  emitStats(soundingNow, activeCount) {
    if (this.blockCounter % STATS_EVERY_BLOCKS !== 0) return;
    const secs = this.statsSamples / this.sampleRate_;
    const rms =
      this.statsSamples > 0
        ? Math.sqrt(this.statsEnergy / this.statsSamples)
        : 0;

    const listen = [];
    for (const s of this.voices) {
      if (!s.active) continue;
      listen.push({
        x: s.x,
        y: s.y,
        r: s.r,
        g: s.g,
        b: s.b,
        amp: s.amp,
        len: s.duration / this.sampleRate_,
        sounding: s.sounding,
        gain: s.amp * this.masterGain * this.normGain,
        regime: s.regime,
      });
    }

    this.port.postMessage({
      type: "stats",
      rms,
      peak: this.statsPeak,
      masterGain: this.masterGain * this.normGain,
      activeVoices: activeCount,
      activeGrains: activeCount,
      sounding: soundingNow,
      triggersPerSec: secs > 0 ? this.statsTriggers / secs : 0,
      deferredPerSec: 0,
      listen,
    });

    this.statsTriggers = 0;
    this.statsPeak = 0;
    this.statsEnergy = 0;
    this.statsSamples = 0;
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

function wrapCoord(v, period) {
  return ((v % period) + period) % period;
}

function panFromX(x, width) {
  const t = x / Math.max(1, width - 1);
  return Math.max(-1, Math.min(1, t * 2 - 1));
}

function applyEqualPowerPan(voice, pan) {
  const p = Math.max(-1, Math.min(1, pan));
  const angle = ((p + 1) * 0.5 * Math.PI) / 2;
  voice.gainL = Math.cos(angle);
  voice.gainR = Math.sin(angle);
}

registerProcessor("grain-processor", GrainProcessor);
