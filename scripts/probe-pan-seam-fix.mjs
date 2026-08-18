/**
 * Verify pan follow across a COM wrap: no click, no false panSaturated latch.
 * Also checks a grain that truly walks off the edge still saturates.
 *
 * Run: node scripts/probe-pan-seam-fix.mjs
 */
import { loadWorkletClass, makePink } from "./lib/offline-worklet.mjs";

const W = 128;
const FS = 48000;
const BLOCK = 128;
const pcm = makePink(FS * 8);
const Processor = await loadWorkletClass(FS);

const send = (proc, msg) => {
  const h = proc.port.onmessage;
  if (typeof h === "function") h({ data: msg });
};
const fmt = (x, n = 3) => (Number.isFinite(x) ? x.toFixed(n) : "n/a");

function newProc() {
  const p = new Processor();
  send(p, {
    type: "source",
    sampleRate: FS,
    length: pcm.length,
    pcmL: pcm,
    pcmR: pcm,
  });
  p.masterGain = 1;
  p.masterGainTarget = 1;
  p.normGain = 1;
  p.preScale = 1;
  return p;
}

function render(proc, n) {
  const L = [];
  for (let b = 0; b < n; b++) {
    const l = new Float32Array(BLOCK);
    const r = new Float32Array(BLOCK);
    proc.process([], [[l, r]]);
    proc.normGain = 1;
    proc.preScale = 1;
    proc.masterGain = 1;
    for (let i = 0; i < BLOCK; i++) L.push(l[i]);
  }
  return L;
}

function track(ax, ay = 64) {
  return [
    {
      regionId: 0,
      comX: ax,
      comY: ay,
      anchorX: ax,
      anchorY: ay,
      gridWidth: W,
      gridHeight: W,
    },
  ];
}

function spawn(proc, { x, trackDx, pan, anchorX }) {
  send(proc, {
    type: "events",
    masterGain: 1,
    events: [
      {
        x,
        y: 64,
        r: 0.5,
        g: 0.3,
        b: 0.7,
        durationSec: 4,
        amplitude: 0.5,
        direction: 1,
        sampleCenter: 0.5,
        sampleHalf: 0.02,
        startOffsetSec: 0,
        q: 2,
        yNorm: 0.5,
        pan,
        channelMix: x / (W - 1),
        attackFrac: 0.1,
        releaseFrac: 0.1,
        regime: "calm",
        regionId: 0,
        trackDx,
        trackDy: 0,
        readOffset: 0,
      },
    ],
    tracks: track(anchorX),
  });
}

let fails = 0;
function check(name, pass, detail = "") {
  if (pass) console.log(`  PASS  ${name}${detail ? " — " + detail : ""}`);
  else {
    fails++;
    console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`);
  }
}

console.log("=== 1. COM wraps past seam; grain is LEFT of COM (was the click) ===");
{
  const proc = newProc();
  // Grain at x=121, COM at 124, trackDx=-3. Sweep COM across 127 → 0.
  spawn(proc, {
    x: 121,
    trackDx: -3,
    pan: (121 / 127) * 2 - 1,
    anchorX: 124,
  });
  render(proc, 40);
  const v = proc.voices.find((z) => z.active);
  const pans = [];
  let maxPanStep = 0;
  let flippedToLeft = false;
  // Only the wrap itself (127 → 0.4). Further motion may later pin at +1
  // for real — that is saturate working, not the old false latch to −1.
  for (const a of [125, 126, 127, 0.4]) {
    const before = v.pan;
    const pre = render(proc, 1);
    send(proc, { type: "track", tracks: track(a) });
    const post = render(proc, 1);
    const step = Math.abs(v.pan - before);
    if (step > maxPanStep) maxPanStep = step;
    if (v.pan < 0 || v.panSaturated < 0) flippedToLeft = true;
    const merged = pre.concat(post);
    const k = pre.length;
    const jump = Math.abs(merged[k] - merged[k - 1]);
    pans.push(
      `${a}: pan ${fmt(before)}→${fmt(v.pan)} sat=${v.panSaturated} Ljump=${fmt(jump, 4)}`,
    );
  }
  for (const line of pans) console.log("   ", line);
  check(
    "no hard-left flip across COM wrap",
    !flippedToLeft && v.panSaturated === 0,
    `pan=${fmt(v.pan)} sat=${v.panSaturated}`,
  );
  check(
    "pan steps stay small across wrap",
    maxPanStep < 0.1,
    `max |Δpan|=${fmt(maxPanStep)}`,
  );
  check(
    "channelMix still tracks x",
    Math.abs(v.channelMix - v.x / 127) < 1e-6,
  );
}

console.log("\n=== 2. Grain truly walks off the right edge → still saturates ===");
{
  const proc = newProc();
  // Grain at COM (trackDx=0), start near right edge and keep walking right.
  spawn(proc, { x: 120, trackDx: 0, pan: (120 / 127) * 2 - 1, anchorX: 120 });
  render(proc, 20);
  const v = proc.voices.find((z) => z.active);
  for (const a of [122, 124, 126, 127, 1, 5, 40]) {
    send(proc, { type: "track", tracks: track(a) });
    render(proc, 1);
  }
  check("panSaturated latched at +1", v.panSaturated === 1, `sat=${v.panSaturated}`);
  check("pan held at +1 after wrap", Math.abs(v.pan - 1) < 1e-6, `pan=${fmt(v.pan)}`);
  check("channelMix held at 1", Math.abs(v.channelMix - 1) < 1e-6, `mix=${fmt(v.channelMix)}`);
  // After latch, further COM motion must not release.
  send(proc, { type: "track", tracks: track(64) });
  render(proc, 1);
  check("latch does not release", v.panSaturated === 1 && Math.abs(v.pan - 1) < 1e-6);
}

console.log("\n=== 3. Grain walks off the left edge → saturates at −1 ===");
{
  const proc = newProc();
  spawn(proc, { x: 8, trackDx: 0, pan: (8 / 127) * 2 - 1, anchorX: 8 });
  render(proc, 20);
  const v = proc.voices.find((z) => z.active);
  for (const a of [6, 3, 1, 0, 126, 100, 64]) {
    send(proc, { type: "track", tracks: track(a) });
    render(proc, 1);
  }
  check("panSaturated latched at −1", v.panSaturated === -1, `sat=${v.panSaturated}`);
  check("pan held at −1", Math.abs(v.pan - -1) < 1e-6, `pan=${fmt(v.pan)}`);
  check("channelMix held at 0", Math.abs(v.channelMix) < 1e-6, `mix=${fmt(v.channelMix)}`);
}

console.log(fails === 0 ? "\nall passed" : `\n${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
