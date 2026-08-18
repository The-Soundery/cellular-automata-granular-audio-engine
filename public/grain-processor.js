/**
 * AudioWorklet — ephemeral grains (V5 Polar Material + Stereo Identity).
 *
 * Sample window / ping-pong bounds freeze at spawn (no scrub chase).
 * Any grain with a regionId directly follows that region's COM for pan, Y,
 * and source L/R channelMix (spawn offset preserved). No smoothing.
 * Calm and flow use regionId (flow ids are offset by FLOW_ID_BASE in the
 * scheduler so they never collide with calm). Envelope frozen at spawn.
 * Y→spectrum is an absolute log sweep (80 Hz bottom … 12 kHz top).
 * Stereo source read via channelMix.
 * Energy normalisation keeps loudness roughly neutral (asymmetric).
 */

const MAX_GRAINS = 128;
const STATS_EVERY_BLOCKS = 8;
const GAIN_SMOOTH = 0.05;
/** Target RMS before soft clip — negotiable. */
const TARGET_RMS = 0.12;
const NORM_MIN = 0.25;
const NORM_MAX = 3.0;
/** Per-block coeffs: ~12 ms duck at 48 kHz/128 — fast enough to protect, slow enough not to pump. */
const NORM_ATTACK = 0.06;
const NORM_RELEASE = 0.004;
const PRESCALE_SMOOTH = NORM_RELEASE;
const BUDGET_VOICES = 64;
/** Chaos defaults when spawn omits attack/release (regime packing material). */
const ENV_ATTACK_CHAOS = 0.06;
const ENV_RELEASE_CHAOS = 0.15;
const ENV_ATTACK_CALM = 0.22;
const ENV_RELEASE_CALM = 0.28;
/** Absolute Y→bandpass floor/ceiling (Hz). Bottom of grid = FMIN, top = FMAX. */
const FILT_FMIN = 80;
const FILT_FMAX = 12000;
/** Fallback Q when spawn omits q (scheduler always sends continuous q). */
const Q_DEFAULT = 2.0;
/** Reference Q for bandwidth-compensated gain — keeps absolute level familiar. */
const Q_REF = 2.0;
/** Geometric centre of the Y bandpass span (loudness reference). */
const FC_REF = Math.sqrt(FILT_FMIN * FILT_FMAX); // ≈ 980 Hz
/** 0 = no cutoff-bandwidth compensation, 1 = full. Negotiable. */
const SPECTRAL_TILT_COMP = 1.0;
/** ∫₀¹ smoothstep(t)² dt — mean-square of attack/release ramp. */
const ENV_RAMP_MS = 0.3714285714;

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
    this.windowCenter = 0;
    this.windowHalf = 1;
    this.yNorm = 0.5;
    this.channelMix = 0.5;
    this.r = 0.5;
    this.g = 0.5;
    this.b = 0.5;
    this.amp = 0;
    this.x = 0;
    this.y = 0;
    this.pan = 0;
    this.trackDx = 0;
    this.trackDy = 0;
    /** Once set to ±1, pan holds at that extreme for the rest of the grain. */
    this.panSaturated = 0;
    /** Last follow-anchor; used so COM wraps move the grain by +1, not ±width. */
    this.lastAnchorX = 0;
    this.lastAnchorY = 0;
    this.hasFollowAnchor = false;
    this.gainL = 1;
    this.gainR = 1;
    this.regime = "chaos";
    this.regionId = -1;
    this.attackFrac = ENV_ATTACK_CHAOS;
    this.releaseFrac = ENV_RELEASE_CHAOS;
    this.attackN = 1;
    this.releaseN = 1;
    this.delaySamples = 0;
    this.q = Q_DEFAULT;
    this.fcNorm = -1;
    this.filtQ = -1;
    this.ic1eq = 0;
    this.ic2eq = 0;
    this.a1 = 0;
    this.a2 = 0;
    this.a3 = 0;
    this.k = 1;
    this.bpGain = 1 / Q_REF;
    this.envNorm = 1;
    this.sounding = false;
  }
}

class GrainProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    /** @type {Float32Array | null} */
    this.pcmL = null;
    /** @type {Float32Array | null} */
    this.pcmR = null;
    /** Legacy alias — points at left (or mono) for length checks. */
    this.pcm = null;
    this.length = 0;
    this.sampleRate_ = sampleRate;
    this.masterGainTarget = 1;
    this.masterGain = 0;
    this.normGain = 1;
    this.preScale = 1;
    this.voices = Array.from({ length: MAX_GRAINS }, () => new GrainVoice());
    this.blockCounter = 0;
    this.statsTriggers = 0;
    this.statsPeak = 0;
    this.statsEnergy = 0;
    this.statsSamples = 0;
    this.rrCursor = 0;
    this.pendingResetBlocks = 0;
    this.savedMasterGainTarget = 1;

    this.port.onmessage = (ev) => {
      const msg = ev.data;
      if (!msg || !msg.type) return;
      if (msg.type === "source") {
        this.sampleRate_ = msg.sampleRate || sampleRate;
        this.length = msg.length || 0;
        if (msg.pcmL && msg.pcmR) {
          this.pcmL = new Float32Array(msg.pcmL);
          this.pcmR = new Float32Array(msg.pcmR);
          this.pcm = this.pcmL;
        } else if (msg.pcm) {
          // Mono fallback — duplicate into both channels.
          this.pcmL = new Float32Array(msg.pcm);
          this.pcmR = this.pcmL.slice();
          this.pcm = this.pcmL;
        } else {
          this.pcmL = null;
          this.pcmR = null;
          this.pcm = null;
        }
        if (!this.length && this.pcmL) this.length = this.pcmL.length;
      } else if (msg.type === "events") {
        this.masterGainTarget =
          typeof msg.masterGain === "number" ? msg.masterGain : 1;
        this.savedMasterGainTarget = this.masterGainTarget;
        this.spawnEvents(msg.events || []);
        if (msg.tracks && msg.tracks.length) this.applyTracks(msg.tracks);
      } else if (msg.type === "track") {
        if (msg.tracks && msg.tracks.length) this.applyTracks(msg.tracks);
      } else if (msg.type === "resetGrains" || msg.type === "resetVoices") {
        // Fade master gain then clear voices — avoid instant silence click.
        this.savedMasterGainTarget = this.masterGainTarget;
        this.masterGainTarget = 0;
        this.pendingResetBlocks = 10;
        this.statsTriggers = 0;
      } else if (msg.type === "clear") {
        this.pcm = null;
        this.pcmL = null;
        this.pcmR = null;
        this.length = 0;
        this.masterGainTarget = 0;
        this.masterGain = 0;
        this.pendingResetBlocks = 0;
        for (const v of this.voices) v.reset();
      }
    };
  }

  spawnEvents(list) {
    if (!this.pcmL || this.length < 2) return;
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
      voice.channelMix = clamp01(
        typeof e.channelMix === "number" ? e.channelMix : 0.5,
      );
      voice.dir = e.direction < 0 ? -1 : 1;
      // Chaos keeps percussive defaults; calm / texture / osc / flow use calm defaults
      // when spawn omits attack/release (scheduler always sends explicit fractions).
      voice.regime =
        e.regime === "chaos"
          ? "chaos"
          : e.regime === "flow"
            ? "flow"
            : e.regime || "calm";
      voice.regionId = typeof e.regionId === "number" ? e.regionId : -1;
      // Envelope shape frozen at spawn — not RGB-driven.
      const defA =
        voice.regime === "chaos" ? ENV_ATTACK_CHAOS : ENV_ATTACK_CALM;
      const defR =
        voice.regime === "chaos" ? ENV_RELEASE_CHAOS : ENV_RELEASE_CALM;
      voice.attackFrac = clamp01(
        typeof e.attackFrac === "number" ? e.attackFrac : defA,
      );
      voice.releaseFrac = clamp01(
        typeof e.releaseFrac === "number" ? e.releaseFrac : defR,
      );
      let aN = Math.max(1, Math.floor(voice.duration * voice.attackFrac));
      let rN = Math.max(1, Math.floor(voice.duration * voice.releaseFrac));
      if (aN + rN > voice.duration) {
        const scale = voice.duration / (aN + rN);
        aN = Math.max(1, Math.floor(aN * scale));
        rN = Math.max(1, voice.duration - aN);
      }
      voice.attackN = aN;
      voice.releaseN = rN;
      // Envelope energy normalisation — after rescale so shape matches what plays.
      const sustainN = Math.max(0, voice.duration - aN - rN);
      const envMs =
        (aN * ENV_RAMP_MS + sustainN + rN * ENV_RAMP_MS) / voice.duration;
      voice.envNorm = 1 / Math.sqrt(Math.max(1e-6, envMs));

      voice.q = typeof e.q === "number" && e.q > 0 ? e.q : Q_DEFAULT;

      const delaySec =
        typeof e.startOffsetSec === "number" ? e.startOffsetSec : 0;
      voice.delaySamples = Math.max(
        0,
        Math.floor(delaySec * this.sampleRate_),
      );

      voice.trackDx = typeof e.trackDx === "number" ? e.trackDx : 0;
      voice.trackDy = typeof e.trackDy === "number" ? e.trackDy : 0;
      voice.panSaturated = 0;
      const pan =
        typeof e.pan === "number" ? Math.max(-1, Math.min(1, e.pan)) : 0;
      voice.pan = pan;
      applyEqualPowerPan(voice, pan);

      let center;
      let half;
      if (
        typeof e.sampleCenter === "number" &&
        typeof e.sampleHalf === "number"
      ) {
        center = clamp01(e.sampleCenter);
        half = Math.max(1 / len, e.sampleHalf);
      } else {
        let lo = clamp01(e.sampleLo ?? 0);
        let hi = clamp01(e.sampleHi ?? 1);
        if (hi < lo) {
          const t = lo;
          lo = hi;
          hi = t;
        }
        if (hi - lo < 1 / len) hi = Math.min(1, lo + 2 / len);
        center = (lo + hi) * 0.5;
        half = (hi - lo) * 0.5;
      }
      half = Math.min(0.49, half);

      const maxIdx = Math.max(0, len - 1);
      voice.windowCenter = center * maxIdx;
      voice.windowHalf = Math.max(1, half * maxIdx);
      // Unwrapped window coordinates (verify-phase4 pins boundLo/Hi names).
      voice.boundLo = voice.windowCenter - voice.windowHalf;
      voice.boundHi = voice.windowCenter + voice.windowHalf;

      // Start at midpoint of hue-locked window (frozen; no later chase).
      // readOffset ∈ [-1,1] decorrelates concurrent grains sharing a window.
      const off = typeof e.readOffset === "number" ? e.readOffset : 0;
      voice.readPos = voice.windowCenter + off * voice.windowHalf;

      this.updateFilterCoeffs(voice);
      this.statsTriggers++;
    }
  }

  /**
   * Direct pan/Y/channelMix follow: any voice with regionId tracks the
   * region's anchor by the shortest toroidal step (spawn offset preserved).
   * Sample window stays frozen. No smoothing.
   *
   * Calm anchors are region COM (or grid centre). Flow anchors are
   * hop-integrated conveyors from the scheduler so grains ride perceptual
   * motion, not a stuck structure COM.
   *
   * Pan saturates at the torus seam instead of wrapping (avoids a one-frame
   * +1→−1 flip). Follow uses anchor *deltas*, not absolute `anchor+trackDx`,
   * so when the COM itself wraps 127→0 the grain steps by +1 instead of
   * jumping by −width and falsely latching panSaturated.
   */
  applyTracks(tracks) {
    /** @type {Map<number, {comX:number,comY:number,w:number,h:number}>} */
    const byId = new Map();
    for (const t of tracks) {
      if (typeof t.regionId !== "number") continue;
      byId.set(t.regionId, {
        comX: t.anchorX ?? t.comX ?? 0,
        comY: t.anchorY ?? t.comY ?? 0,
        w: Math.max(1, t.gridWidth || 1),
        h: Math.max(1, t.gridHeight || 1),
      });
    }
    for (const voice of this.voices) {
      if (!voice.active || voice.regionId < 0) continue;
      const t = byId.get(voice.regionId);
      if (!t) continue;

      const dx = voice.hasFollowAnchor
        ? toroidalDelta(t.comX, voice.lastAnchorX, t.w)
        : 0;
      const dy = voice.hasFollowAnchor
        ? toroidalDelta(t.comY, voice.lastAnchorY, t.h)
        : 0;
      voice.lastAnchorX = t.comX;
      voice.lastAnchorY = t.comY;
      voice.hasFollowAnchor = true;

      let x;
      if (voice.panSaturated < 0) {
        x = 0;
      } else if (voice.panSaturated > 0) {
        x = t.w - 1;
      } else {
        x = voice.x + dx;
        if (x < 0) {
          voice.panSaturated = -1;
          x = 0;
        } else if (x >= t.w) {
          voice.panSaturated = 1;
          x = t.w - 1;
        }
      }
      const y = wrapCoord(voice.y + dy, t.h);
      voice.x = x;
      voice.y = y;
      voice.pan = panFromX(x, t.w);
      voice.yNorm = 1 - y / Math.max(1, t.h - 1);
      voice.channelMix = clamp01(x / Math.max(1, t.w - 1));
      applyEqualPowerPan(voice, voice.pan);
      // Absolute Y follows region — refresh filter coeffs next process block.
      voice.fcNorm = -1;
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
    // Overload: force ~3 ms release on oldest chaos voice; drop the incoming event.
    let oldest = null;
    let oldestAge = -1;
    for (const v of this.voices) {
      if (v.regime === "chaos" && v.age > oldestAge) {
        oldestAge = v.age;
        oldest = v;
      }
    }
    if (oldest && oldest.active) {
      const releaseSamples = Math.max(
        1,
        Math.ceil(0.003 * this.sampleRate_),
      );
      const age = oldest.age;
      oldest.duration = age + releaseSamples;
      oldest.releaseN = releaseSamples;
      if (oldest.attackN > age) oldest.attackN = Math.max(1, age);
    }
    return null;
  }

  updateFilterCoeffs(voice) {
    const y = clamp01(voice.yNorm);
    const q = Math.max(0.5, voice.q);
    if (
      Math.abs(y - voice.fcNorm) < 1e-6 &&
      Math.abs(q - voice.filtQ) < 1e-6
    ) {
      return;
    }
    voice.fcNorm = y;
    voice.filtQ = q;
    const fs = this.sampleRate_;
    // Absolute Y: log sweep 80 Hz (bottom) … 12 kHz (top).
    let fc = FILT_FMIN * Math.pow(FILT_FMAX / FILT_FMIN, y);
    const fcMax = 0.45 * fs;
    if (fc > fcMax) fc = fcMax;
    const g = Math.tan((Math.PI * fc) / fs);
    const k = 1 / q;
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;
    voice.a1 = a1;
    voice.a2 = a2;
    voice.a3 = a3;
    voice.k = k;
    // Bandwidth compensation: through-RMS ∝ sqrt(fc/Q); flatten vs Q_REF/FC_REF.
    voice.bpGain =
      (Math.sqrt(q / Q_REF) / q) *
      Math.pow(FC_REF / fc, 0.5 * SPECTRAL_TILT_COMP);
  }

  /** Analytic smoothstep envelope — no tables / no allocation. */
  envelopeAt(voice) {
    const age = voice.age;
    const dur = voice.duration;
    const aN = voice.attackN;
    const rN = voice.releaseN;
    if (age < aN) {
      const t = age / aN;
      return t * t * (3 - 2 * t);
    }
    if (age > dur - 1 - rN) {
      const t = (dur - 1 - age) / rN;
      const u = Math.max(0, t);
      return u * u * (3 - 2 * u);
    }
    return 1;
  }

  readPcm(pos, channelMix = 0.5) {
    const len = this.length;
    const idx = wrapIndex(Math.round(pos), len);
    const l = this.pcmL ? this.pcmL[idx] || 0 : 0;
    const r = this.pcmR ? this.pcmR[idx] || 0 : l;
    const t = clamp01(channelMix);
    return l * (1 - t) + r * t;
  }

  bandpass(voice, v0) {
    const v3 = v0 - voice.ic2eq;
    const v1 = voice.a1 * voice.ic1eq + voice.a2 * v3;
    const v2 = voice.ic2eq + voice.a2 * voice.ic1eq + voice.a3 * v3;
    voice.ic1eq = 2 * v1 - voice.ic1eq;
    voice.ic2eq = 2 * v2 - voice.ic2eq;
    return v1 * voice.bpGain;
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

    if (!this.pcmL || this.length < 2) {
      this.emitStats(0, 0);
      return true;
    }

    this.masterGain +=
      (this.masterGainTarget - this.masterGain) * GAIN_SMOOTH;

    let sounding = 0;
    let active = 0;
    let soundingCount = 0;
    for (const voice of this.voices) {
      if (!voice.active) continue;
      active++;
      if (voice.delaySamples <= 0 && voice.age < voice.duration) soundingCount++;
    }

    const desiredPre = Math.sqrt(
      BUDGET_VOICES / Math.max(1, soundingCount),
    );
    const preClamped = Math.max(0.5, Math.min(2.5, desiredPre));
    this.preScale += (preClamped - this.preScale) * PRESCALE_SMOOTH;

    for (const voice of this.voices) {
      if (!voice.active) continue;

      this.updateFilterCoeffs(voice);
      const gL = voice.gainL;
      const gR = voice.gainR;
      let voiceSounded = false;

      for (let i = 0; i < n; i++) {
        if (voice.delaySamples > 0) {
          voice.delaySamples--;
          continue;
        }
        if (voice.age >= voice.duration) {
          voice.active = false;
          voice.sounding = false;
          break;
        }

        const e = this.envelopeAt(voice);
        const raw = this.readPcm(voice.readPos, voice.channelMix);
        const band = this.bandpass(voice, raw);
        const s =
          band *
          e *
          voice.envNorm *
          voice.amp *
          this.masterGain *
          this.preScale;

        outL[i] += s * gL;
        if (outR !== outL) outR[i] += s * gR;

        // Ping-pong in unwrapped window coords; wrap only for PCM read.
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
      const desired = Math.max(
        NORM_MIN,
        Math.min(NORM_MAX, TARGET_RMS / blockRms),
      );
      const coeff = desired < this.normGain ? NORM_ATTACK : NORM_RELEASE;
      this.normGain += (desired - this.normGain) * coeff;
    } else if (active === 0) {
      this.normGain += (1 - this.normGain) * NORM_RELEASE;
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

    // After rendering a faded block, clear voices (reset was requested earlier).
    // GAIN_SMOOTH alone leaves ~60% gain after 10 blocks; force a decisive
    // decay so the hard clear lands below audibility (0.7^10 ≈ −31 dB).
    if (this.pendingResetBlocks > 0) {
      this.masterGain *= 0.7;
      this.pendingResetBlocks -= 1;
      if (this.pendingResetBlocks === 0) {
        for (const v of this.voices) v.reset();
        this.masterGain = 0;
        this.masterGainTarget = 0;
      }
    }
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
        gain: s.amp * this.masterGain * this.normGain * this.preScale,
        regime: s.regime,
      });
    }

    this.port.postMessage({
      type: "stats",
      rms,
      peak: this.statsPeak,
      masterGain: this.masterGain * this.normGain * this.preScale,
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

function wrapIndex(i, len) {
  if (len <= 0) return 0;
  let x = i % len;
  if (x < 0) x += len;
  return x;
}

function softClip(x) {
  if (x > 1) return 1 + Math.tanh(x - 1) * 0.1;
  if (x < -1) return -1 + Math.tanh(x + 1) * 0.1;
  return x;
}

function wrapCoord(v, period) {
  return ((v % period) + period) % period;
}

/** Shortest signed step from `from` to `to` on a torus of length `period`. */
function toroidalDelta(to, from, period) {
  let d = to - from;
  if (d > period * 0.5) d -= period;
  if (d < -period * 0.5) d += period;
  return d;
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
