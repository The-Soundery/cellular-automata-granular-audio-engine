/**
 * AudioWorklet — ephemeral grains (V5 Polar Material + Stereo Identity).
 *
 * Sample window / ping-pong bounds freeze at spawn (no scrub chase).
 * Any grain with a regionId directly follows that region's COM for pan, Y,
 * source L/R channelMix, and filter Q from live shape extent (spawn offset
 * preserved; sample window stays frozen). Logical follow is unsmoothed;
 * audio params ramp to the new target within one render block so a
 * CA-frame step is not a sample discontinuity.
 * Calm and flow use regionId (flow ids are offset by FLOW_ID_BASE in the
 * scheduler so they never collide with calm). Envelope frozen at spawn.
 * Y→spectrum is an absolute log sweep (80 Hz bottom … 12 kHz top).
 * Stereo source read via channelMix.
 * Scale layers: half / native / double pre-rendered buffers; read still ±1.
 * loopHalf may tighten the frozen ping-pong window inside the segment.
 * Edge AM is unipolar and one-pole smoothed; interiors stay clean.
 * Ping-pong reverses in place — no fade-to-zero at the bound.
 * Slow voice-count leveler: target RMS scales with sqrt(sounding/BUDGET).
 * Fast attack is a safety duck only — not a block-RMS flattener.
 */

const MAX_GRAINS = 128;
const STATS_EVERY_BLOCKS = 8;
const GAIN_SMOOTH = 0.05;
/** Target RMS before soft clip — negotiable. */
const TARGET_RMS = 0.12;
const NORM_MIN = 0.25;
const NORM_MAX = 3.0;
/** Per-block coeffs at 48 kHz/128. Attack is a safety duck; release is a slow leveler (~10×). */
const NORM_ATTACK = 0.06;
const NORM_RELEASE = 0.0004;
/** Voice prescale smoothing — stays at the old release; must not ride the leveler. */
const PRESCALE_SMOOTH = 0.004;
const BUDGET_VOICES = 64;
/** Forced release when the scheduler reclaims a share seat. */
const SHARE_RELEASE_SEC = 0.02;
/**
 * Samples to reach a new pan/Y/mix target after applyTracks.
 * One render block at 48 kHz — zipper prevention, not follow lag.
 * The logical follow position still jumps this block; audio params arrive
 * at the new target by the last sample of the ramp.
 */
const PARAM_RAMP_SAMPLES = 128;
/**
 * Edge-AM smoother. Raw neighbour PCM as a multiplier ticks; a ~80 Hz
 * one-pole keeps the seam mark without audio-rate holes.
 */
const MOD_SMOOTH = 0.0104;
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
const Q_MIN = 0.1;
const Q_MAX = 26.0;
const FILT_RATIO = FILT_FMAX / FILT_FMIN;
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
    this.panTarget = 0;
    this.yNormTarget = 0.5;
    this.mixTarget = 0.5;
    this.rampN = 0;
    this.trackDx = 0;
    this.trackDy = 0;
    /** Once set to ±1, pan holds at that extreme for the rest of the grain. */
    this.panSaturated = 0;
    /** Once set to ±1, Y/spectrum holds at that extreme for the rest of the grain. */
    this.ySaturated = 0;
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
    this.qTarget = Q_DEFAULT;
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
    this.grainId = -1;
    this.layer = 1;
    this.modSmooth = 0.5;
    this.modDepth = 0;
    this.modPos = 0;
    this.modDir = 1;
    this.modLo = 0;
    this.modHi = 1;
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
    this.pcmLHalf = null;
    this.pcmRHalf = null;
    this.lengthHalf = 0;
    this.pcmLDbl = null;
    this.pcmRDbl = null;
    this.lengthDbl = 0;
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
        if (msg.pcmLHalf && msg.pcmRHalf) {
          this.pcmLHalf = new Float32Array(msg.pcmLHalf);
          this.pcmRHalf = new Float32Array(msg.pcmRHalf);
          this.lengthHalf = this.pcmLHalf.length;
        } else {
          this.pcmLHalf = this.pcmL;
          this.pcmRHalf = this.pcmR;
          this.lengthHalf = this.length;
        }
        if (msg.pcmLDbl && msg.pcmRDbl) {
          this.pcmLDbl = new Float32Array(msg.pcmLDbl);
          this.pcmRDbl = new Float32Array(msg.pcmRDbl);
          this.lengthDbl = this.pcmLDbl.length;
        } else {
          this.pcmLDbl = this.pcmL;
          this.pcmRDbl = this.pcmR;
          this.lengthDbl = this.length;
        }
      } else if (msg.type === "events") {
        this.masterGainTarget =
          typeof msg.masterGain === "number" ? msg.masterGain : 1;
        this.savedMasterGainTarget = this.masterGainTarget;
        if (msg.releaseGrainIds && msg.releaseGrainIds.length) {
          this.releaseGrains(msg.releaseGrainIds);
        }
        this.spawnEvents(msg.events || []);
        this.applyTracks(msg.tracks || []);
      } else if (msg.type === "track") {
        this.applyTracks(msg.tracks || []);
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
        this.pcmLHalf = null;
        this.pcmRHalf = null;
        this.lengthHalf = 0;
        this.pcmLDbl = null;
        this.pcmRDbl = null;
        this.lengthDbl = 0;
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
      voice.grainId = typeof e.grainId === "number" ? e.grainId : -1;
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
      voice.qTarget = voice.q;

      const delaySec =
        typeof e.startOffsetSec === "number" ? e.startOffsetSec : 0;
      voice.delaySamples = Math.max(
        0,
        Math.floor(delaySec * this.sampleRate_),
      );

      voice.trackDx = typeof e.trackDx === "number" ? e.trackDx : 0;
      voice.trackDy = typeof e.trackDy === "number" ? e.trackDy : 0;
      voice.panSaturated = 0;
      voice.ySaturated = 0;
      const pan =
        typeof e.pan === "number" ? Math.max(-1, Math.min(1, e.pan)) : 0;
      voice.pan = pan;
      voice.panTarget = pan;
      voice.yNormTarget = voice.yNorm;
      voice.mixTarget = voice.channelMix;
      voice.rampN = 0;
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
      if (typeof e.loopHalf === "number" && e.loopHalf > 0) {
        half = Math.min(half, Math.max(1 / len, e.loopHalf));
      }

      voice.layer =
        e.layer === 0.5 || e.layer === 2 ? e.layer : 1;
      const layerLen = this.layerLength(voice.layer);
      const maxIdx = Math.max(0, layerLen - 1);
      voice.windowCenter = center * maxIdx;
      voice.windowHalf = Math.max(1, half * maxIdx);
      // Unwrapped window coordinates (verify-phase4 pins boundLo/Hi names).
      voice.boundLo = voice.windowCenter - voice.windowHalf;
      voice.boundHi = voice.windowCenter + voice.windowHalf;

      // Start at midpoint of hue-locked window (frozen; no later chase).
      // readOffset ∈ [-1,1] decorrelates concurrent grains sharing a window.
      const off = typeof e.readOffset === "number" ? e.readOffset : 0;
      voice.readPos = voice.windowCenter + off * voice.windowHalf;
      const minHalfSamp = Math.max(32, Math.floor(0.004 * this.sampleRate_));
      const segHalfNorm =
        typeof e.sampleHalf === "number" ? Math.min(0.49, e.sampleHalf) : half;
      const maxHalfSamp = Math.max(minHalfSamp, segHalfNorm * maxIdx);
      if (voice.windowHalf < minHalfSamp && maxHalfSamp > voice.windowHalf) {
        voice.windowHalf = Math.min(minHalfSamp, maxHalfSamp);
        voice.boundLo = voice.windowCenter - voice.windowHalf;
        voice.boundHi = voice.windowCenter + voice.windowHalf;
        voice.readPos = voice.windowCenter + off * voice.windowHalf;
      }

      voice.modDepth =
        typeof e.modDepth === "number" ? clamp01(e.modDepth) : 0;
      if (voice.modDepth > 0 && typeof e.modCenter === "number") {
        const modHalf =
          typeof e.modHalf === "number" ? Math.max(1 / layerLen, e.modHalf) : half;
        const mc = clamp01(e.modCenter) * maxIdx;
        const mh = Math.max(1, Math.min(0.49, modHalf) * maxIdx);
        voice.modLo = mc - mh;
        voice.modHi = mc + mh;
        voice.modPos = mc;
        voice.modDir = 1;
        voice.modSmooth = 0.5;
      } else {
        voice.modDepth = 0;
      }

      this.updateFilterCoeffs(voice);
      this.statsTriggers++;
    }
  }

  /**
   * Short-release a live voice without a level jump. Baking the current
   * envelope into amp is required: the old path forced attackN≤age so a
   * grain still in attack (env≪1) snapped to sustain (env=1) then faded —
   * a hard click whenever share-reclaim hit a long calm attack.
   */
  forceShortRelease(voice, releaseSamples) {
    if (voice.delaySamples > 0 && voice.age === 0) {
      voice.reset();
      return;
    }
    const e = this.envelopeAt(voice);
    voice.amp *= e;
    const age = voice.age;
    const remaining = Math.max(1, voice.duration - age);
    const rN = Math.min(remaining, releaseSamples);
    voice.duration = age + rN;
    voice.releaseN = rN;
    voice.attackN = Math.min(voice.attackN, age);
  }

  /**
   * Scheduler reclaimed these seats: fade the matching voices so a new
   * area share can occupy the budget. Delayed unstarted grains drop now.
   */
  releaseGrains(ids) {
    const want = new Set(ids);
    const releaseSamples = Math.max(
      1,
      Math.ceil(SHARE_RELEASE_SEC * this.sampleRate_),
    );
    for (const voice of this.voices) {
      if (!voice.active || !want.has(voice.grainId)) continue;
      this.forceShortRelease(voice, releaseSamples);
    }
  }

  /**
   * Direct pan/Y/channelMix/Q follow: any voice with regionId tracks the
   * region's anchor by the shortest toroidal step (spawn offset preserved).
   * Sample window stays frozen. Q follows live qExtent (same log law as
   * spawn). Logical x/y/Q jump this message; pan/Y/mix/Q audio params
   * ramp to that target within PARAM_RAMP_SAMPLES.
   *
   * Calm and flow anchors are hop-integrated conveyors from the scheduler
   * (calm also soft-corrects toward COM). Grains ride perceptual motion,
   * not a raw COM teleport.
   *
   * Pan and Y saturate at the torus seam instead of wrapping (avoids a
   * one-frame +1→−1 pan flip and an 80 Hz↔12 kHz cutoff jump). Follow uses
   * anchor *deltas*, not absolute `anchor+trackDx`, so when the COM itself
   * wraps 127→0 the grain steps by +1 instead of jumping by −width and
   * falsely latching panSaturated / ySaturated.
   *
   * If this region's track is missing, drop hasFollowAnchor so a later
   * re-acquire (new flow clock snapped to trailing edge) does not apply
   * the gap as one hop.
   */
  applyTracks(tracks) {
    /** @type {Map<number, {comX:number,comY:number,w:number,h:number,qExtent:number}>} */
    const byId = new Map();
    for (const t of tracks) {
      if (typeof t.regionId !== "number") continue;
      byId.set(t.regionId, {
        comX: t.anchorX ?? t.comX ?? 0,
        comY: t.anchorY ?? t.comY ?? 0,
        w: Math.max(1, t.gridWidth || 1),
        h: Math.max(1, t.gridHeight || 1),
        qExtent: typeof t.qExtent === "number" ? t.qExtent : 0,
      });
    }
    for (const voice of this.voices) {
      if (!voice.active || voice.regionId < 0) continue;
      const t = byId.get(voice.regionId);
      if (!t) {
        // Dropout: freeze pan/Y. Next re-acquire must not apply the gap as
        // one toroidal hop (flow clock snap / COM teleport → 50–80 cell click).
        voice.hasFollowAnchor = false;
        continue;
      }

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
      let y;
      if (voice.ySaturated < 0) {
        y = 0;
      } else if (voice.ySaturated > 0) {
        y = t.h - 1;
      } else {
        y = voice.y + dy;
        if (y < 0) {
          voice.ySaturated = -1;
          y = 0;
        } else if (y >= t.h) {
          voice.ySaturated = 1;
          y = t.h - 1;
        }
      }
      voice.x = x;
      voice.y = y;
      const pan = panFromX(x, t.w);
      const yNorm = 1 - y / Math.max(1, t.h - 1);
      const mix = clamp01(x / Math.max(1, t.w - 1));
      voice.panTarget = pan;
      voice.yNormTarget = yNorm;
      voice.mixTarget = mix;
      if (t.qExtent > 0) {
        const durSec = voice.duration / Math.max(1, this.sampleRate_);
        voice.qTarget = qFromVerticalExtent(t.qExtent, t.h, durSec, yNorm);
      }
      const jumped =
        Math.abs(pan - voice.pan) > 1e-6 ||
        Math.abs(yNorm - voice.yNorm) > 1e-6 ||
        Math.abs(mix - voice.channelMix) > 1e-6 ||
        Math.abs(voice.qTarget - voice.q) > 1e-6;
      if (jumped) voice.rampN = PARAM_RAMP_SAMPLES;
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
    // Overload: force share-release on oldest chaos voice; drop the incoming event.
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
        Math.ceil(SHARE_RELEASE_SEC * this.sampleRate_),
      );
      this.forceShortRelease(oldest, releaseSamples);
    }
    return null;
  }

  updateFilterCoeffs(voice) {
    const y = clamp01(voice.yNorm);
    const q = Math.max(Q_MIN, voice.q);
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

  layerLength(layer) {
    if (layer === 0.5) return this.lengthHalf || this.length;
    if (layer === 2) return this.lengthDbl || this.length;
    return this.length;
  }

  layerBuffers(layer) {
    if (layer === 0.5) {
      return {
        L: this.pcmLHalf || this.pcmL,
        R: this.pcmRHalf || this.pcmR,
      };
    }
    if (layer === 2) {
      return {
        L: this.pcmLDbl || this.pcmL,
        R: this.pcmRDbl || this.pcmR,
      };
    }
    return { L: this.pcmL, R: this.pcmR };
  }

  readPcm(pos, channelMix = 0.5, layer = 1) {
    const buf = this.layerBuffers(layer);
    const len = this.layerLength(layer);
    if (!buf.L || len < 2) return 0;
    const idx = wrapIndex(Math.round(pos), len);
    const l = buf.L[idx] || 0;
    const r = buf.R ? buf.R[idx] || 0 : l;
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
      let voiceSounded = false;

      for (let i = 0; i < n; i++) {
        if (voice.rampN > 0) {
          const a = 1 / voice.rampN;
          voice.pan += (voice.panTarget - voice.pan) * a;
          voice.yNorm += (voice.yNormTarget - voice.yNorm) * a;
          voice.channelMix += (voice.mixTarget - voice.channelMix) * a;
          voice.q += (voice.qTarget - voice.q) * a;
          applyEqualPowerPan(voice, voice.pan);
          voice.fcNorm = -1;
          this.updateFilterCoeffs(voice);
          voice.rampN--;
        }
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
        let raw = this.readPcm(voice.readPos, voice.channelMix, voice.layer);
        if (voice.modDepth > 0) {
          const mod = this.readPcm(
            voice.modPos,
            voice.channelMix,
            voice.layer,
          );
          const uni = 0.5 + 0.5 * Math.max(-1, Math.min(1, mod));
          voice.modSmooth += (uni - voice.modSmooth) * MOD_SMOOTH;
          const gain =
            1 - voice.modDepth + voice.modDepth * voice.modSmooth;
          const mean = 1 - 0.5 * voice.modDepth;
          raw *= gain / Math.max(1e-6, mean);
        }
        const band = this.bandpass(voice, raw);
        const layerGain = Math.sqrt(voice.layer || 1);
        const s =
          band *
          e *
          voice.envNorm *
          voice.amp *
          layerGain *
          this.masterGain *
          this.preScale;

        outL[i] += s * voice.gainL;
        if (outR !== outL) outR[i] += s * voice.gainR;

        // Ping-pong in unwrapped window coords; wrap only for PCM read.
        voice.readPos += voice.dir;
        if (voice.readPos >= voice.boundHi) {
          voice.readPos = voice.boundHi;
          voice.dir = -1;
        } else if (voice.readPos <= voice.boundLo) {
          voice.readPos = voice.boundLo;
          voice.dir = 1;
        }
        if (voice.modDepth > 0) {
          voice.modPos += voice.modDir;
          if (voice.modPos >= voice.modHi) {
            voice.modPos = voice.modHi;
            voice.modDir = -1;
          } else if (voice.modPos <= voice.modLo) {
            voice.modPos = voice.modLo;
            voice.modDir = 1;
          }
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
    const voiceT = Math.min(1, Math.max(1, soundingCount) / BUDGET_VOICES);
    const targetRms = TARGET_RMS * Math.sqrt(voiceT);
    if (blockRms > 1e-5) {
      const desired = Math.max(
        NORM_MIN,
        Math.min(NORM_MAX, targetRms / blockRms),
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
        t: this.length > 0 ? s.readPos / this.length : 0,
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

/** Same log law as scheduler qFromVerticalExtent. */
function qFromVerticalExtent(heightCells, gridH, durationSec, yNorm) {
  const dy = Math.max(1, heightCells) / Math.max(1, gridH - 1);
  const r = Math.pow(FILT_RATIO, dy);
  let q = r <= 1 + 1e-9 ? Q_MAX : Math.sqrt(r) / (r - 1);
  q = Math.max(Q_MIN, Math.min(Q_MAX, q));
  const y = Math.max(0, Math.min(1, yNorm));
  const fc = FILT_FMIN * Math.pow(FILT_RATIO, y);
  return Math.min(q, Math.max(1, durationSec * fc));
}

function applyEqualPowerPan(voice, pan) {
  const p = Math.max(-1, Math.min(1, pan));
  const angle = ((p + 1) * 0.5 * Math.PI) / 2;
  voice.gainL = Math.cos(angle);
  voice.gainR = Math.sin(angle);
}

registerProcessor("grain-processor", GrainProcessor);
