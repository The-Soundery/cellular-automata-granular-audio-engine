/**
 * Click probe, part 4 — investigation only, changes nothing.
 *
 * Part 3's seam test happened to use a grain sitting to the RIGHT of the COM,
 * which is the direction panSaturated protects. This tests the other direction,
 * plus the ping-pong read-pointer bounce, both with a single grain sounding so
 * nothing can mask the result.
 *
 * Run: node scripts/probe-clicks4.mjs
 */
import { loadWorkletClass, makePink } from "./lib/offline-worklet.mjs";

const W = 128, H = 128;
const FS = 48000, BLOCK = 128;
const SOURCE_DUR_SEC = 30;

const fmt = (x, n = 2) => (Number.isFinite(x) ? x.toFixed(n) : "n/a");
const send = (proc, msg) => {
  const h = proc.port.onmessage;
  if (typeof h === "function") h({ data: msg });
};

const pcm = makePink(FS * SOURCE_DUR_SEC);
const Processor = await loadWorkletClass(FS);

function newProc() {
  const p = new Processor();
  send(p, { type: "source", sampleRate: FS, length: pcm.length, pcm });
  p.masterGain = 1; p.masterGainTarget = 1; p.normGain = 1; p.preScale = 1;
  return p;
}
function render(proc, n) {
  const L = [], R = [], M = [];
  for (let b = 0; b < n; b++) {
    const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
    proc.process([], [[l, r]]);
    proc.normGain = 1; proc.preScale = 1; proc.masterGain = 1;
    for (let i = 0; i < BLOCK; i++) { L.push(l[i]); R.push(r[i]); M.push(0.5 * (l[i] + r[i])); }
  }
  return { L, R, M };
}
function measure(arr, k, span = 1024) {
  const d = Math.abs(arr[k] - arr[k - 1]);
  let e = 0, n = 0, re = 0, rn = 0;
  for (let i = Math.max(1, k - span); i < Math.min(arr.length, k + span); i++) {
    if (Math.abs(i - k) >= 4) { const dd = arr[i] - arr[i - 1]; e += dd * dd; n++; }
    re += arr[i] * arr[i]; rn++;
  }
  const s = n ? Math.sqrt(e / n) : 0;
  return { jump: d, ratio: s > 0 ? d / s : Infinity, rms: rn ? Math.sqrt(re / rn) : 0 };
}

const baseEvent = (over = {}) => ({
  x: 100, y: 64, r: 0.5, g: 0.3, b: 0.7,
  durationSec: 3.0, amplitude: 0.5, direction: 1,
  sampleCenter: 0.5, sampleHalf: 0.02, startOffsetSec: 0,
  q: 2, yNorm: 0.5, pan: 0,
  attackFrac: 0.1, releaseFrac: 0.1,
  regime: "calm", regionId: 0, trackDx: 0, trackDy: 0, readOffset: 0,
  ...over,
});
const track = (ax, ay = 64) => ([{
  regionId: 0, comX: ax, comY: ay, anchorX: ax, anchorY: ay,
  gridWidth: W, gridHeight: H,
}]);

console.log("=== A. seam wrap with the grain LEFT of the COM (negative trackDx) ===");
console.log("    one grain sounding, nothing else in the mix\n");
{
  const proc = newProc();
  send(proc, {
    type: "events", masterGain: 1,
    events: [baseEvent({ x: 121, pan: (121 / 127) * 2 - 1, trackDx: -3, regionId: 0 })],
    tracks: track(124),
  });
  render(proc, 60);
  const v = proc.voices.find((z) => z.active);

  for (const a of [125, 126, 127, 0.4, 3, 20, 60]) {
    const panBefore = v.pan, gL = v.gainL, gR = v.gainR, sat = v.panSaturated;
    const pre = render(proc, 2);
    send(proc, { type: "track", tracks: track(a) });
    const post = render(proc, 2);
    const merged = pre.M.concat(post.M);
    const m = measure(merged, pre.M.length);
    const mL = measure(pre.L.concat(post.L), pre.L.length);
    const flag = m.ratio > 6 ? "   <<< CLICK" : "";
    console.log(
      `  anchorX -> ${String(a).padStart(5)}  pan ${fmt(panBefore, 3).padStart(6)} -> ${fmt(v.pan, 3).padStart(6)}` +
      `  gainL ${fmt(gL, 3)} -> ${fmt(v.gainL, 3)}  sat ${sat} -> ${v.panSaturated}` +
      `  monoJump ${fmt(m.jump, 4)} (rms ${fmt(m.rms, 4)}) ratio ${fmt(m.ratio, 1).padStart(6)}` +
      `  L-jump ${fmt(mL.jump, 4)} ratio ${fmt(mL.ratio, 1)}${flag}`,
    );
  }
  console.log("\n  panSaturated latches permanently — the grain stays pinned to that");
  console.log("  extreme for the rest of its life even as the region moves back.\n");
}

console.log("=== B. does the latch ever release? region sweeps back and forth ===");
{
  const proc = newProc();
  send(proc, {
    type: "events", masterGain: 1,
    events: [baseEvent({ x: 121, pan: (121 / 127) * 2 - 1, trackDx: -3, regionId: 0 })],
    tracks: track(124),
  });
  render(proc, 20);
  const v = proc.voices.find((z) => z.active);
  send(proc, { type: "track", tracks: track(1) });  // trip the latch
  const latched = v.panSaturated;
  const pans = [];
  for (const a of [64, 100, 64, 30, 64]) {
    send(proc, { type: "track", tracks: track(a) });
    render(proc, 1);
    pans.push(`${a}->pan ${fmt(v.pan, 2)}`);
  }
  console.log(`  latch value after seam: ${latched}`);
  console.log(`  subsequent anchors: ${pans.join(", ")}`);
  console.log(`  final panSaturated: ${v.panSaturated}  (0 would mean released)\n`);
}

console.log("=== C. ping-pong read-pointer reversal ===");
{
  const proc = newProc();
  // Narrow window so bounces are frequent and easy to locate.
  send(proc, {
    type: "events", masterGain: 1,
    events: [baseEvent({
      durationSec: 2.0, sampleHalf: 0.005 / SOURCE_DUR_SEC * 1, // ~5 ms half-width
      sampleCenter: 0.5, pan: 0, regionId: -1, regime: "calm",
      attackFrac: 0.05, releaseFrac: 0.05, q: 2,
    })],
    tracks: [],
  });
  const v0 = proc.voices.find((z) => z.active);
  const halfSamples = v0.windowHalf;
  console.log(`  window half-width ${fmt(halfSamples, 0)} samples (${fmt((halfSamples / FS) * 1000, 2)} ms)` +
    ` -> reversal every ${fmt((2 * halfSamples / FS) * 1000, 2)} ms`);

  const { M } = render(proc, 200);
  // Locate bounces by tracking dir flips.
  const proc2 = newProc();
  send(proc2, {
    type: "events", masterGain: 1,
    events: [baseEvent({
      durationSec: 2.0, sampleHalf: 0.005 / SOURCE_DUR_SEC * 1,
      sampleCenter: 0.5, pan: 0, regionId: -1, regime: "calm",
      attackFrac: 0.05, releaseFrac: 0.05, q: 2,
    })],
    tracks: [],
  });
  const v = proc2.voices.find((z) => z.active);
  const out = [];
  const bounceAt = [];
  let lastDir = v.dir;
  for (let b = 0; b < 200; b++) {
    const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
    // Step one sample at a time is not possible; detect per block and refine
    // by watching dir either side of the block.
    const before = v.dir;
    proc2.process([], [[l, r]]);
    proc2.normGain = 1; proc2.preScale = 1; proc2.masterGain = 1;
    for (let i = 0; i < BLOCK; i++) out.push(0.5 * (l[i] + r[i]));
    if (v.dir !== before) bounceAt.push(out.length - BLOCK);
    lastDir = v.dir;
  }
  // Worst first-difference anywhere in the steady middle of the grain.
  let worst = 0, worstIdx = 0;
  const from = 20 * BLOCK, to = 150 * BLOCK;
  let e = 0, n = 0;
  for (let i = from; i < to; i++) { const d = out[i] - out[i - 1]; e += d * d; n++; if (Math.abs(d) > worst) { worst = Math.abs(d); worstIdx = i; } }
  const diffRms = Math.sqrt(e / n);
  console.log(`  ${bounceAt.length} blocks contained a direction reversal over ${fmt((200 * BLOCK) / FS, 2)} s`);
  console.log(`  worst first-difference in the grain body: ${fmt(worst, 5)} vs diff-RMS ${fmt(diffRms, 5)}` +
    `  ratio ${fmt(worst / diffRms, 1)}`);
  console.log(`  (ratio near 3-4 is ordinary bandlimited noise; >8 would indicate a step)\n`);
}

console.log("=== D. what a pan flip costs when it is the only thing playing ===");
{
  // Direct comparison: same grain, with and without the seam wrap.
  const mk = () => {
    const p = newProc();
    send(p, {
      type: "events", masterGain: 1,
      events: [baseEvent({ x: 121, pan: (121 / 127) * 2 - 1, trackDx: -3, regionId: 0 })],
      tracks: track(124),
    });
    render(p, 60);
    return p;
  };
  const withWrap = mk(), without = mk();
  const preA = render(withWrap, 2), preB = render(without, 2);
  send(withWrap, { type: "track", tracks: track(0.4) });   // seam wrap
  send(without, { type: "track", tracks: track(126) });    // keeps going right
  const postA = render(withWrap, 6), postB = render(without, 6);

  const a = preA.L.concat(postA.L), b = preB.L.concat(postB.L);
  const k = preA.L.length;
  const mA = measure(a, k), mB = measure(b, k);
  console.log(`  left channel, seam wrap:    jump ${fmt(mA.jump, 4)}  local rms ${fmt(mA.rms, 4)}  ratio ${fmt(mA.ratio, 1)}`);
  console.log(`  left channel, no wrap:      jump ${fmt(mB.jump, 4)}  local rms ${fmt(mB.rms, 4)}  ratio ${fmt(mB.ratio, 1)}`);
  const peakA = Math.max(...postA.L.slice(0, 256).map(Math.abs));
  const prevPeak = Math.max(...preA.L.slice(-256).map(Math.abs));
  console.log(`  left-channel peak before wrap ${fmt(prevPeak, 4)} -> after ${fmt(peakA, 4)}` +
    `  (${fmt(20 * Math.log10(Math.max(1e-9, peakA) / Math.max(1e-9, prevPeak)), 1)} dB in one sample)\n`);
}
