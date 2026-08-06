/**
 * Load the real public/grain-processor.js under Node for offline rendering.
 * Stubs AudioWorkletProcessor / registerProcessor / sampleRate — no worklet hooks.
 */
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * @param {number} sampleRateHz
 * @returns {Promise<typeof AudioWorkletProcessor>}
 */
export async function loadWorkletClass(sampleRateHz) {
  globalThis.sampleRate = sampleRateHz;
  globalThis.AudioWorkletProcessor = class {
    constructor() {
      this.port = { postMessage() {}, onmessage: null };
    }
  };
  let Registered = null;
  globalThis.registerProcessor = (_name, cls) => {
    Registered = cls;
  };
  // Bust any prior module cache so reloads pick up worklet edits between phases.
  const href =
    pathToFileURL(join(root, "public/grain-processor.js")).href +
    `?t=${Date.now()}`;
  await import(href);
  if (!Registered) throw new Error("registerProcessor never called");
  return Registered;
}

/**
 * Mulberry32 — same as TestPatterns / investigate harness.
 * @param {number} seed
 * @returns {() => number}
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * White noise in [-1, 1], seed 11 (plan-specified).
 * @param {number} n
 * @param {number} [seed=11]
 */
export function makeWhite(n, seed = 11) {
  const rand = mulberry32(seed);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = rand() * 2 - 1;
  return out;
}

/**
 * Voss-McCartney pink noise (−3 dB/octave), fixed seed.
 * Octaves of white summed with geometric amplitude; not a one-pole lowpass.
 * @param {number} n
 * @param {number} [seed=42]
 */
export function makePink(n, seed = 42) {
  const rand = mulberry32(seed);
  const out = new Float32Array(n);
  const OCTAVES = 8;
  const rows = new Float64Array(OCTAVES);
  let running = 0;
  for (let o = 0; o < OCTAVES; o++) {
    rows[o] = rand() * 2 - 1;
    running += rows[o];
  }
  let maxAbs = 0;
  for (let i = 0; i < n; i++) {
    // Update octave o every 2^o samples.
    for (let o = 0; o < OCTAVES; o++) {
      if ((i & ((1 << o) - 1)) === 0) {
        running -= rows[o];
        rows[o] = rand() * 2 - 1;
        running += rows[o];
      }
    }
    out[i] = running;
    const a = Math.abs(running);
    if (a > maxAbs) maxAbs = a;
  }
  const inv = maxAbs > 1e-12 ? 1 / maxAbs : 1;
  for (let i = 0; i < n; i++) out[i] *= inv;
  return out;
}
