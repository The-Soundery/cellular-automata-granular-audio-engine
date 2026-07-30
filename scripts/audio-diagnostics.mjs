/**
 * Offline audio-engine diagnostics — mirrors current worklet scheduling + bin gain policy.
 * Run: node scripts/audio-diagnostics.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const MAX_VOICES = 32;
const GRAIN_CAP = 12288;
const MAX_TRIGGERS_PER_BLOCK = 12;
const BLOCK = 128;
const SR = 44100;

function clamp01(v) {
  return Math.max(0, Math.min(1, v || 0));
}

function grainSampleCount(v, sr = SR) {
  return Math.min(GRAIN_CAP, Math.max(64, Math.floor(v.grainLengthSec * sr)));
}

/** Mirrors public/grain-processor.js triggerInterval */
function triggerInterval(v, grainSamples, sr = SR) {
  let advance;
  if (v.overlap >= 0.65) {
    advance = 0.5 + 0.3 * v.overlap;
  } else {
    advance = 0.12 + 0.45 * v.overlap;
  }
  advance *= 1 - 0.12 * v.persistence;
  if (v.overlap >= 0.65) advance = Math.max(0.45, advance);
  let interval = Math.floor(grainSamples * (1 - advance));
  interval = Math.min(interval, grainSamples);
  const minInterval = Math.max(64, Math.floor(sr / 100));
  const maxInterval = Math.floor(sr * 0.5);
  return Math.max(minInterval, Math.min(maxInterval, interval));
}

function makeVoice(partial) {
  return {
    active: true,
    r: 0.5,
    g: 0.5,
    b: 0.5,
    grainLengthSec: 0.06,
    overlap: 0.5,
    persistence: 0.5,
    amplitudeShare: 1 / 32,
    samplesUntilTrigger: 0,
    grainLen: 0,
    grainPos: 0,
    grain: new Float32Array(GRAIN_CAP),
    triggers: 0,
    silentSamples: 0,
    soundingSamples: 0,
    deferredAttempts: 0,
    ...partial,
  };
}

function simulateScheduler(voices, durationSec, opts = {}) {
  const sr = opts.sr || SR;
  const block = opts.block || BLOCK;
  const maxTrig = opts.maxTrig ?? MAX_TRIGGERS_PER_BLOCK;
  const totalSamples = Math.floor(durationSec * sr);
  let sample = 0;
  let rrCursor = 0;
  let totalDeferred = 0;
  let blocksWithDefer = 0;
  let silentBlocks = 0;
  let rmsAccum = 0;
  let rmsCount = 0;

  const length = Math.max(sr, 4096);
  const tone = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    tone[i] = Math.sin((2 * Math.PI * 440 * i) / sr) * 0.5;
  }

  function triggerGrain(v) {
    const grainSamples = grainSampleCount(v, sr);
    for (let i = 0; i < grainSamples; i++) {
      v.grain[i] = tone[i % length];
    }
    v.grainLen = grainSamples;
    v.grainPos = 0;
    v.triggers++;
  }

  while (sample < totalSamples) {
    const n = Math.min(block, totalSamples - sample);
    let triggersLeft = maxTrig;
    let blockDeferred = false;
    let blockEnergy = 0;

    const order = new Array(voices.length);
    for (let k = 0; k < voices.length; k++) {
      order[k] = (rrCursor + k) % voices.length;
    }
    rrCursor = (rrCursor + 1) % voices.length;

    for (let i = 0; i < n; i++) {
      for (let k = 0; k < voices.length; k++) {
        const v = voices[order[k]];
        if (!v.active) continue;

        if (v.samplesUntilTrigger <= 0) {
          if (triggersLeft > 0) {
            triggerGrain(v);
            triggersLeft--;
            v.samplesUntilTrigger = triggerInterval(
              v,
              v.grainLen || grainSampleCount(v, sr),
              sr,
            );
          } else {
            v.samplesUntilTrigger = n - i;
            v.deferredAttempts++;
            totalDeferred++;
            blockDeferred = true;
            continue;
          }
        }
        v.samplesUntilTrigger--;

        if (v.grainPos < v.grainLen) {
          const s = v.grain[v.grainPos++] * v.amplitudeShare * 0.9;
          blockEnergy += s * s;
          v.soundingSamples++;
        } else {
          v.silentSamples++;
        }
      }
    }

    if (blockDeferred) blocksWithDefer++;
    const meanE = blockEnergy / n;
    rmsAccum += meanE;
    rmsCount++;
    if (meanE < 1e-10) silentBlocks++;
    sample += n;
  }

  return {
    durationSec,
    totalDeferred,
    blocksWithDefer,
    silentBlocks,
    silentBlockPct: (100 * silentBlocks) / rmsCount,
    meanBlockEnergy: rmsAccum / rmsCount,
    voices: voices.map((v, i) => ({
      i,
      triggers: v.triggers,
      triggerHz: v.triggers / durationSec,
      silentRatio: v.silentSamples / Math.max(1, v.silentSamples + v.soundingSamples),
      deferredAttempts: v.deferredAttempts,
      desiredHz: sr / triggerInterval(v, grainSampleCount(v, sr), sr),
    })),
  };
}

function rbjBandpass(sampleRate, fc, q) {
  const w0 = (2 * Math.PI * fc) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = sin / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: alpha / a0,
    b1: 0,
    b2: -alpha / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

function biquadProcess(input, c) {
  const out = new Float32Array(input.length);
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x0 = input[i];
    const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    out[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return out;
}

function attenuatePeak(buf, target) {
  let peak = 0;
  for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
  if (peak <= target || peak < 1e-8) return { peak, gain: 1 };
  const g = target / peak;
  for (let i = 0; i < buf.length; i++) buf[i] *= g;
  return { peak, gain: g };
}

function rms(buf) {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
}

function buildBinsFromPcm(pcm, sampleRate, binCount = 24) {
  const nyquist = sampleRate * 0.5;
  const fHigh = Math.min(8000, nyquist * 0.92);
  const fLow = Math.min(80, fHigh * 0.5);
  const relativeBw = 0.35 / binCount;
  const meta = [];
  for (let b = 0; b < binCount; b++) {
    const t = b / (binCount - 1);
    const fc = fLow * Math.pow(fHigh / fLow, t);
    const bwHz = Math.max(20, fc * relativeBw * 2);
    const q = Math.max(1.5, fc / Math.max(bwHz, 1));
    let out = biquadProcess(pcm, rbjBandpass(sampleRate, fc, q));
    out = biquadProcess(out, rbjBandpass(sampleRate, fc, q));
    let beforePeak = 0;
    for (let i = 0; i < out.length; i++) {
      beforePeak = Math.max(beforePeak, Math.abs(out[i]));
    }
    const { gain } = attenuatePeak(out, 0.95);
    meta.push({ fc, beforePeak, gain, rms: rms(out) });
  }
  return meta;
}

function synthesizeTonePcm(sec = 1, freqs = [220, 440, 880]) {
  const n = Math.floor(SR * sec);
  const pcm = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (const f of freqs) s += Math.sin((2 * Math.PI * f * i) / SR);
    pcm[i] = (0.2 * s) / freqs.length;
  }
  return pcm;
}

function loadWavPcm(filePath) {
  const buf = readFileSync(filePath);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let offset = 12;
  let channels = 1;
  let sampleRate = SR;
  let bits = 16;
  let dataOffset = 0;
  let dataSize = 0;
  while (offset + 8 <= buf.length) {
    const id = String.fromCharCode(...buf.subarray(offset, offset + 4));
    const size = dv.getUint32(offset + 4, true);
    if (id === "fmt ") {
      channels = dv.getUint16(offset + 10, true);
      sampleRate = dv.getUint32(offset + 12, true);
      bits = dv.getUint16(offset + 22, true);
    } else if (id === "data") {
      dataOffset = offset + 8;
      dataSize = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }
  const frames = dataSize / (2 * channels);
  const pcm = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < channels; c++) {
      s += dv.getInt16(dataOffset + (i * channels + c) * 2, true) / 32768;
    }
    pcm[i] = s / channels;
  }
  loadWavPcm.lastSampleRate = sampleRate;
  return pcm;
}

const findings = [];
function section(title) {
  findings.push(`\n## ${title}`);
  console.log(`\n=== ${title} ===`);
}
function log(obj) {
  const line = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  findings.push(line);
  console.log(line);
}

section("A — Mixed field: 8 stable long + 24 chaotic short (philosophy case)");
{
  const voices = [];
  for (let i = 0; i < 8; i++) {
    voices.push(
      makeVoice({
        grainLengthSec: 0.12,
        overlap: 0.85,
        persistence: 0.9,
        amplitudeShare: 0.01,
        samplesUntilTrigger: Math.floor((i * 2000) / 8),
      }),
    );
  }
  for (let i = 0; i < 24; i++) {
    voices.push(
      makeVoice({
        grainLengthSec: 0.025,
        overlap: 0.2,
        persistence: 0.1,
        amplitudeShare: 0.04,
        samplesUntilTrigger: Math.floor((i * 400) / 24),
      }),
    );
  }
  const r = simulateScheduler(voices, 2.0);
  const stable = r.voices.slice(0, 8);
  const chaotic = r.voices.slice(8);
  log({
    stableMeanTrigHz: avg(stable.map((v) => v.triggerHz)),
    chaoticMeanTrigHz: avg(chaotic.map((v) => v.triggerHz)),
    stableMeanDuty: avg(stable.map((v) => 1 - v.silentRatio)),
    chaoticMeanDuty: avg(chaotic.map((v) => 1 - v.silentRatio)),
    minTrig: Math.min(...r.voices.map((v) => v.triggers)),
    maxTrig: Math.max(...r.voices.map((v) => v.triggers)),
    totalDeferred: r.totalDeferred,
    blocksWithDeferPct: (100 * r.blocksWithDefer) / ((2 * SR) / BLOCK),
    desiredStableHz: voices[0] && SR / triggerInterval(voices[0], grainSampleCount(voices[0])),
    desiredChaoticHz: voices[8] && SR / triggerInterval(voices[8], grainSampleCount(voices[8])),
  });
}

section("B — All-due monopoly check (round-robin fairness)");
{
  const voices = Array.from({ length: 32 }, () =>
    makeVoice({
      grainLengthSec: 0.03,
      overlap: 0.2,
      persistence: 0.1,
      samplesUntilTrigger: 0,
    }),
  );
  const r = simulateScheduler(voices, 1.0);
  log({
    triggersFirst4: r.voices.slice(0, 4).map((v) => v.triggers),
    triggersLast4: r.voices.slice(28).map((v) => v.triggers),
    minTrig: Math.min(...r.voices.map((v) => v.triggers)),
    maxTrig: Math.max(...r.voices.map((v) => v.triggers)),
    ratioMaxMin:
      Math.max(...r.voices.map((v) => v.triggers)) /
      Math.max(1, Math.min(...r.voices.map((v) => v.triggers))),
  });
}

section("C — Interval philosophy (stable sparse vs chaotic dense)");
{
  const cases = [
    { name: "stable", grainLengthSec: 0.12, overlap: 0.85, persistence: 0.9 },
    { name: "mid", grainLengthSec: 0.06, overlap: 0.5, persistence: 0.5 },
    { name: "chaotic", grainLengthSec: 0.02, overlap: 0.15, persistence: 0.05 },
  ];
  for (const c of cases) {
    const gs = grainSampleCount(c);
    const iv = triggerInterval(c, gs);
    log({
      name: c.name,
      grainSamples: gs,
      interval: iv,
      effectiveHz: +(SR / iv).toFixed(2),
      triggersPerSecIf32: +((SR / iv) * 32).toFixed(1),
    });
  }
}

section("D — Bin gains attenuate-only (no boost)");
{
  const pcm = synthesizeTonePcm(1.0);
  const meta = buildBinsFromPcm(pcm, SR, 24);
  log({
    maxGain: Math.max(...meta.map((m) => m.gain)),
    minGain: Math.min(...meta.map((m) => m.gain)),
    binsBoosted: meta.filter((m) => m.gain > 1.001).length,
    peakInQuietBin: +Math.min(...meta.map((m) => m.beforePeak)).toFixed(6),
    rmsQuietBin: +Math.min(...meta.map((m) => m.rms)).toFixed(6),
    rmsLoudBin: +Math.max(...meta.map((m) => m.rms)).toFixed(4),
  });
}

section("E — test-tone.wav bins");
{
  try {
    const pcm = loadWavPcm(path.join(root, "public/test-tone.wav"));
    const sr = loadWavPcm.lastSampleRate || SR;
    const meta = buildBinsFromPcm(pcm, sr, 24);
    log({
      maxGain: +Math.max(...meta.map((m) => m.gain)).toFixed(3),
      binsBoosted: meta.filter((m) => m.gain > 1.001).length,
      rmsMin: +Math.min(...meta.map((m) => m.rms)).toFixed(5),
      rmsMax: +Math.max(...meta.map((m) => m.rms)).toFixed(4),
    });
  } catch (e) {
    log(`SKIP ${e.message}`);
  }
}

function avg(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

writeFileSync(
  path.join(root, "scripts/audio-diagnostics-report.md"),
  `# Audio diagnostics (post-fix)\n\n${findings.join("\n")}\n`,
);
console.log("\nWrote scripts/audio-diagnostics-report.md");
