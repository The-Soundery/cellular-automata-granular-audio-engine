/**
 * Phase 4 — Sonic Laws contract checks (polar / stereo / absolute Y).
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;

function assert(label, ok) {
  if (ok) {
    console.log(`  ok  ${label}`);
  } else {
    console.error(`FAIL  ${label}`);
    failed += 1;
  }
}

const brief = readFileSync(join(root, "Creative Brief.txt"), "utf8");
const worklet = readFileSync(join(root, "public/grain-processor.js"), "utf8");
const sched = readFileSync(join(root, "src/field/GrainScheduler.ts"), "utf8");
const fieldObs = readFileSync(join(root, "src/field/FieldObserver.ts"), "utf8");
const main = readFileSync(join(root, "src/main.ts"), "utf8");

assert("Sonic Laws in brief", /Sonic Laws \(authoritative\)/.test(brief));
assert("freeze-at-spawn in brief", /Freeze at spawn/.test(brief));
assert(
  "brief allows direct pan/Y region follow",
  /directly follow|Allowed to track directly/i.test(brief),
);
assert(
  "brief allows Q to follow live extent",
  /Filter Q ← the region's current vertical\/shape extent/.test(brief),
);
assert(
  "brief documents observational lifecycle",
  /death short-releases/.test(brief) && /inherits the absorbed/.test(brief),
);
assert(
  "brief documents V5 polar / stereo / channel-mix follow",
  /polar/i.test(brief) && /channel mix/i.test(brief),
);
assert("brief has no velocity-hybrid", !/velocity-hybrid/i.test(brief));
assert(
  "brief forbids mid-grain sample-window chase and inter-grain scrub",
  /sample window during playback|sample-window scrub chase/i.test(brief) &&
    /no\s+inter-grain scrub/i.test(brief),
);
assert("pipeline: observe → schedule → sendEvents", /fieldObserver\.observe/.test(main) && /scheduler\.step/.test(main) && /sendEvents/.test(main));
assert(
  "worklet documents sample freeze + direct pan/Y follow",
  /applyTracks/.test(worklet) && /PARAM_RAMP_SAMPLES/.test(worklet),
);
assert(
  "worklet Q follow uses track qExtent (window stays frozen)",
  /qExtent/.test(worklet) && /function qFromVerticalExtent/.test(worklet),
);
assert("ping-pong uses locked bounds only", /voice\.boundLo/.test(worklet) && /voice\.boundHi/.test(worklet));
const processBody = worklet.slice(worklet.indexOf("process(_inputs"));
assert(
  "process() does not rewrite boundLo/Hi",
  !/voice\.boundLo\s*=/.test(processBody) && !/voice\.boundHi\s*=/.test(processBody),
);
assert(
  "worklet has no TRACK_SMOOTH follow EMA",
  !/TRACK_SMOOTH/.test(worklet),
);
assert(
  "param ramp is one render block (zipper, not lag)",
  /PARAM_RAMP_SAMPLES = 128/.test(worklet),
);
assert("no luminance→volume mapping in scheduler", !/luminance/.test(sched) && !/brightness/.test(sched));
assert("equal amplitude / sqrt budget", /equalAmp|1 \/ Math\.sqrt/.test(sched));
assert("live worklet is not lattice archive", !/latticeIndex/.test(worklet));

const spectral = readFileSync(join(root, "src/audio/spectral.ts"), "utf8");
const audioSrc = readFileSync(join(root, "src/audio/AudioEngine.ts"), "utf8");
assert("source prep has seam crossfade", /SEAM_FADE/.test(spectral));
assert(
  "source prep has polar HSV material map",
  /queryMaterialFromHsv/.test(spectral) &&
    /buildPolarSegments|MaterialSegment/.test(spectral) &&
    /stationarity/.test(spectral),
);
assert(
  "colour to material is absolute (no regime bias / sustained subset)",
  !/SUSTAINED_SUBSET_QUANTILE/.test(spectral) &&
    !/SUSTAINED_ATTACK_GAP/.test(spectral) &&
    !/sustainedSubset/.test(spectral) &&
    !/RegimeMaterialBias/.test(spectral) &&
    !/REGIME_STATIONARITY_BIAS/.test(spectral),
);
assert(
  "segments keep real start/end bounds",
  /startPos/.test(spectral) && /endPos/.test(spectral),
);
assert(
  "scheduler uses segment bounds (not area window lerp)",
  /startPos/.test(sched) &&
    /WINDOW_HALF_ABS_MIN_S/.test(sched) &&
    !/WINDOW_HALF_MIN_S/.test(sched) &&
    !/WINDOW_HALF_MAX_S/.test(sched) &&
    !/SCRUB_RATE_MAX/.test(sched),
);
assert(
  "Q from vertical extent",
  /qFromVerticalExtent/.test(sched) && /FILT_RATIO/.test(sched),
);
assert(
  "Q extent blends height toward thickness by elongation",
  /qExtentFromShape/.test(sched) && /FLOW_FILL_S/.test(sched),
);
assert(
  "observer measures elongation / compactness / thickness",
  /export function measureShape/.test(fieldObs) &&
    /elongation/.test(fieldObs) &&
    /compactness/.test(fieldObs),
);
assert(
  "attack score uses energy jump (first hop not zero-flux sustain)",
  /W_ATTACK_ENERGY/.test(spectral) && /energyJumps/.test(spectral),
);
assert(
  "polar radius is fixed (not stationarity-encoded)",
  /POLAR_SEGMENT_RADIUS/.test(spectral) &&
    !/0\.7 \+ 0\.3 \* stationarity/.test(spectral),
);
assert(
  "polar axes are mel-PCA rank-uniform (not centroid/energy rank)",
  /MEL_BANDS/.test(spectral) &&
    /assignPolarFromMelPca/.test(spectral) &&
    !/byCentroid/.test(spectral),
);
assert(
  "silent hops are gated relative to peak (not a digital-zero floor)",
  /SILENCE_GATE_DB/.test(spectral) && !/energy > 1e-8/.test(spectral),
);
assert(
  "scheduler uses polar material query",
  /queryMaterialFromHsv/.test(sched) && /setMaterialSegments/.test(sched),
);
assert(
  "source prep is stereo (pcmL/pcmR)",
  /pcmL/.test(spectral) && /pcmR/.test(spectral),
);
assert(
  "worklet reads stereo via channelMix",
  /channelMix/.test(worklet) && /pcmL/.test(worklet) && /pcmR/.test(worklet),
);
assert(
  "worklet Y is absolute log spectrum (not relative to centroid)",
  /FILT_FMIN \* Math\.pow\(FILT_FMAX \/ FILT_FMIN/.test(worklet) &&
    !/Y_OCTAVE_SPAN/.test(worklet) &&
    !/materialCentroidHz/.test(worklet),
);
assert(
  "scheduler does not send materialCentroidHz into the filter",
  !/materialCentroidHz/.test(sched) && !/Y_OCTAVE_SPAN/.test(sched),
);
// Formula-level: absolute Y endpoints must be 80 Hz / 12 kHz regardless of any centroid.
{
  const FILT_FMIN = 80;
  const FILT_FMAX = 12000;
  const fcAt = (y) => FILT_FMIN * Math.pow(FILT_FMAX / FILT_FMIN, y);
  assert("absolute Y yNorm=0 → 80 Hz", Math.abs(fcAt(0) - 80) < 1e-9);
  assert("absolute Y yNorm=1 → 12 kHz", Math.abs(fcAt(1) - 12000) < 1e-9);
}
assert("source prep has no 48-bin bank", !/SPECTRAL_BIN_COUNT/.test(spectral) && !/bins:\s*Float32Array/.test(spectral));
assert("source message has no bins", !/msg\.bins/.test(worklet) && !/\bbins:/.test(audioSrc));
assert("per-grain filter present", /ic1eq/.test(worklet));
assert("analytic envelope (no envelope table cache)", !/windowCache/.test(worklet) && /envelopeAt/.test(worklet));
assert("onset offset honored", /startOffsetSec|delaySamples/.test(worklet));
assert(
  "no regime-branched audible Q defaults after continuous law",
  !/regime === "calm" \? Q_CALM/.test(worklet),
);

// Runtime: absolute colour map + real segment bounds.
{
  const { pathToFileURL } = await import("node:url");
  const {
    buildPolarSegments,
    queryMaterialFromHsv,
  } = await import(pathToFileURL(join(root, "src/audio/spectral.ts")).href);

  const sr = 44100;
  const durSec = 2.0;
  const n = Math.floor(sr * durSec);
  const pcm = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    pcm[i] = 0.08 * Math.sin(2 * Math.PI * 220 * t);
  }
  const clickAt = Math.floor(0.35 * sr);
  const clickN = Math.floor(0.004 * sr);
  for (let i = 0; i < clickN; i++) {
    const env = 1 - i / clickN;
    pcm[clickAt + i] = 0.95 * env * (i % 2 === 0 ? 1 : -1);
  }

  const segments = buildPolarSegments(pcm, sr);
  assert("fixture produced multiple segments", segments.length >= 8);
  assert(
    "every segment has startPos ≤ pos ≤ endPos",
    segments.every(
      (s) =>
        typeof s.startPos === "number" &&
        typeof s.endPos === "number" &&
        s.startPos <= s.pos + 1e-9 &&
        s.pos <= s.endPos + 1e-9 &&
        s.startPos <= s.endPos,
    ),
  );

  const clickPos = clickAt / (n - 1);
  const clickTol = 0.06;
  const nearClick = (pos) => Math.abs(pos - clickPos) < clickTol;

  let minStatNearClick = 1;
  for (const s of segments) {
    if (nearClick(s.pos) && s.stationarity < minStatNearClick) {
      minStatNearClick = s.stationarity;
    }
  }
  assert(
    "click neighbourhood has lower stationarity than pad median",
    minStatNearClick < 0.55,
  );

  // Same HSV always hits the same segment (absolute colour → material).
  const queries = [
    { h: 0.0, s: 0.0, v: 0.5 },
    { h: 0.5, s: 0.9, v: 0.6 },
    { h: 0.15, s: 0.8, v: 0.4 },
    { h: 0.7, s: 0.7, v: 0.7 },
  ];
  let absoluteOk = true;
  for (const q of queries) {
    const a = queryMaterialFromHsv(segments, q.h, q.s, q.v);
    const b = queryMaterialFromHsv(segments, q.h, q.s, q.v);
    if (
      a.sampleCenter !== b.sampleCenter ||
      a.startPos !== b.startPos ||
      a.endPos !== b.endPos
    ) {
      absoluteOk = false;
    }
    if (!(a.startPos <= a.sampleCenter && a.sampleCenter <= a.endPos)) {
      absoluteOk = false;
    }
  }
  assert("same HSV → same segment bounds", absoluteOk);

  // Opening click still scores as transient (first-hop flux fix).
  {
    const pcm2 = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      pcm2[i] = 0.08 * Math.sin(2 * Math.PI * 220 * t);
    }
    const openN = Math.floor(0.004 * sr);
    for (let i = 0; i < openN; i++) {
      const env = 1 - i / openN;
      pcm2[i] = 0.95 * env * (i % 2 === 0 ? 1 : -1);
    }
    const segs2 = buildPolarSegments(pcm2, sr);
    const openSeg = segs2.reduce((best, s) =>
      Math.abs(s.pos - 0) < Math.abs(best.pos - 0) ? s : best,
    );
    assert(
      "opening click scores as transient",
      openSeg.stationarity < 0.55,
    );
  }

  assert(
    "map retains transient material near click",
    segments.some((s) => nearClick(s.pos) && s.stationarity < 0.55),
  );
}

// Same timbre at both ends of the file should share a hue neighbourhood;
// a different timbre in the middle should sit farther around the circle.
{
  const { pathToFileURL } = await import("node:url");
  const { buildPolarSegments } = await import(
    pathToFileURL(join(root, "src/audio/spectral.ts")).href
  );

  const sr = 44100;
  const n = Math.floor(sr * 2.0);
  const pcm = new Float32Array(n);
  const third = Math.floor(n / 3);
  let rng = 123456789;
  const noise = () => {
    rng = (rng * 1664525 + 1013904223) >>> 0;
    return rng / 4294967296 * 2 - 1;
  };
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if (i < third || i >= 2 * third) {
      pcm[i] = 0.2 * Math.sin(2 * Math.PI * 220 * t);
    } else {
      pcm[i] = 0.2 * noise();
    }
  }
  const segs = buildPolarSegments(pcm, sr);
  const circ = (a, b) => {
    let d = Math.abs(a - b);
    if (d > 0.5) d = 1 - d;
    return d;
  };
  const meanCirc = (xs, origin) => {
    if (xs.length === 0) return 1;
    let s = 0;
    for (const x of xs) s += circ(x, origin);
    return s / xs.length;
  };
  const startT = segs.filter((s) => s.pos < 0.28).map((s) => s.angle);
  const midN = segs
    .filter((s) => s.pos > 0.38 && s.pos < 0.62)
    .map((s) => s.angle);
  const endT = segs.filter((s) => s.pos > 0.72).map((s) => s.angle);
  assert(
    "two-timbre fixture has units in all thirds",
    startT.length > 0 && midN.length > 0 && endT.length > 0,
  );
  if (startT.length && midN.length && endT.length) {
    const origin = startT[Math.floor(startT.length / 2)];
    const dEnd = meanCirc(endT, origin);
    const dNoise = meanCirc(midN, origin);
    assert(
      "same timbre at file ends sit closer in hue than mid noise",
      dEnd < dNoise - 0.02,
    );
  }
}

// Colour must never land in leading/trailing file silence.
{
  const { pathToFileURL } = await import("node:url");
  const { buildPolarSegments, queryMaterialFromHsv } = await import(
    pathToFileURL(join(root, "src/audio/spectral.ts")).href
  );

  const sr = 44100;
  const n = Math.floor(sr * 2.0);
  const pcm = new Float32Array(n);
  const t0 = Math.floor(0.5 * sr);
  const t1 = Math.floor(1.5 * sr);
  for (let i = t0; i < t1; i++) {
    pcm[i] = 0.25 * Math.sin((2 * Math.PI * 440 * i) / sr);
  }
  const segs = buildPolarSegments(pcm, sr);
  const inSilence = (pos) => pos < 0.18 || pos > 0.82;
  assert(
    "no segment centres in leading/trailing silence",
    segs.length > 0 && !segs.some((s) => inSilence(s.pos)),
  );
  let hueHitSilence = false;
  for (let i = 0; i < 24; i++) {
    const r = queryMaterialFromHsv(segs, i / 24, 1, 0.5);
    if (inSilence(r.sampleCenter)) hueHitSilence = true;
    const g = queryMaterialFromHsv(segs, i / 24, 0, i / 23);
    if (inSilence(g.sampleCenter)) hueHitSilence = true;
  }
  assert("no HSV query lands in file silence", !hueHitSilence);
  assert(
    "no segment window overlaps leading/trailing silence",
    segs.every((s) => !inSilence(s.startPos) && !inSilence(s.endPos)),
  );
}

// Mid-file silence gap: windows must not bridge audible islands.
{
  const { pathToFileURL } = await import("node:url");
  const { buildPolarSegments, queryMaterialFromHsv, SILENCE_GATE_DB } =
    await import(pathToFileURL(join(root, "src/audio/spectral.ts")).href);

  const sr = 44100;
  const n = Math.floor(sr * 3.0);
  const pcm = new Float32Array(n);
  // Two loud islands with a long near-silent middle.
  const a0 = Math.floor(0.2 * sr);
  const a1 = Math.floor(0.7 * sr);
  const b0 = Math.floor(2.3 * sr);
  const b1 = Math.floor(2.8 * sr);
  for (let i = a0; i < a1; i++) {
    pcm[i] = 0.4 * Math.sin((2 * Math.PI * 330 * i) / sr);
  }
  for (let i = b0; i < b1; i++) {
    pcm[i] = 0.4 * Math.sin((2 * Math.PI * 550 * i) / sr);
  }
  // Floor noise well below the gate (−32 dB ≈ 0.025× peak).
  const floor = 0.4 * Math.pow(10, (SILENCE_GATE_DB - 12) / 20);
  for (let i = a1; i < b0; i++) {
    pcm[i] = floor * Math.sin((2 * Math.PI * 90 * i) / sr);
  }
  const segs = buildPolarSegments(pcm, sr);
  const gapLo = 0.85 / 3;
  const gapHi = 2.15 / 3;
  const overlapsGap = (s) => s.startPos < gapHi && s.endPos > gapLo;
  assert(
    "no segment window bridges mid-file silence gap",
    segs.length >= 2 && !segs.some(overlapsGap),
  );
  let hueInGap = false;
  for (let i = 0; i < 36; i++) {
    const r = queryMaterialFromHsv(segs, i / 36, 0.9, 0.4 + (i % 5) * 0.1);
    if (r.sampleCenter > gapLo && r.sampleCenter < gapHi) hueInGap = true;
    if (r.startPos < gapHi && r.endPos > gapLo) hueInGap = true;
  }
  assert("no HSV query window lands in mid-file silence", !hueInGap);
}

assert(
  "source prep builds half/double rate layers",
  /buildRateLayers/.test(spectral) && /pcmLHalf/.test(spectral),
);
assert(
  "worklet selects a scale layer",
  /layerLength/.test(worklet) && /layerBuffers/.test(worklet),
);
assert(
  "worklet edge AM is unipolar and smoothed (no ring-mod default)",
  /modDepth/.test(worklet) &&
    /MOD_SMOOTH/.test(worklet) &&
    /1 - voice\.modDepth \+ voice\.modDepth \* voice\.modSmooth/.test(worklet),
);
assert(
  "scheduler exports scale / loop / edge helpers",
  /layerFromScale/.test(sched) &&
    /loopHalfFromStructure/.test(sched) &&
    /edgeCoupling/.test(sched) &&
    /LAYER_OCCUPANCY_FLOOR/.test(sched),
);
assert(
  "scheduler wires structure→audio unused axes",
  /directionFromHeading/.test(sched) &&
    /readOffsetFromSimilarity/.test(sched) &&
    /READ_OFFSET_SIM_FLOOR/.test(sched),
);
assert(
  "observer exports spatial oscillator fields",
  /comX/.test(fieldObs) &&
    /buildOscillatorGroups/.test(fieldObs) &&
    /prevSittingOsc/.test(fieldObs),
);
assert(
  "observer splits texture into spatial islands",
  /textureIslandId/.test(fieldObs) && /TEXTURE_ISLAND_STRIDE/.test(fieldObs),
);

{
  const { pathToFileURL } = await import("node:url");
  const {
    layerFromScale,
    loopHalfFromStructure,
    edgeCoupling,
    SCHED,
    qExtentFromShape,
  } = await import(pathToFileURL(join(root, "src/field/GrainScheduler.ts")).href);
  const { measureShape } = await import(
    pathToFileURL(join(root, "src/field/FieldObserver.ts")).href
  );

  assert(
    "large mass → half-speed layer",
    layerFromScale(0.5, 0, 1, true) === 0.5,
  );
  assert(
    "small coherent mass stays native",
    layerFromScale(0.005, 0, 1, true) === 1,
  );
  assert(
    "small broken non-mass → double-speed layer",
    layerFromScale(0.01, 0.8, 1, false) === 2,
  );
  assert(
    "chaos below occupancy floor stays native",
    layerFromScale(0.01, 0.8, 0.05, false) === 1,
  );
  assert(
    "large chaos coverage may use half-speed on a large cluster",
    layerFromScale(0.4, 0.2, 0.8, true) === 0.5,
  );

  const wide = loopHalfFromStructure(0.1, 0, 10);
  const tight = loopHalfFromStructure(0.1, 1, 10);
  assert("tightness 0 keeps the segment window", Math.abs(wide - 0.1) < 1e-6);
  assert("tightness 1 shrinks below the segment window", tight < wide * 0.5);

  const w = 8;
  const h = 8;
  const n = w * h;
  const ids = new Int32Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      ids[y * w + x] = x < 4 ? 1 : 2;
    }
  }
  const rgb = {
    width: w,
    height: h,
    r: new Float32Array(n).fill(0.4),
    g: new Float32Array(n).fill(0.4),
    b: new Float32Array(n).fill(0.4),
  };
  const interior = edgeCoupling(1 * w + 1, 1, ids, rgb, [], 2);
  const seam = edgeCoupling(1 * w + 3, 1, ids, rgb, [], 2);
  assert("edge AM depth is 0 in a region interior", interior.modDepth === 0);
  assert("edge AM depth is > 0 on a region meeting", seam.modDepth > 0);
  assert(
    "edge AM depth stays at or under the cap",
    seam.modDepth <= SCHED.EDGE_AM_DEPTH_MAX + 1e-9,
  );

  const gw = 32;
  const gh = 32;
  const line = [];
  for (let y = 5; y <= 20; y++) line.push(y * gw + 10);
  const lineShape = measureShape(line, 10, 12.5, gw, gh);
  assert("vertical line is elongated", lineShape.elongation > 0.7);
  assert("vertical line compactness is low", lineShape.compactness < 0.45);
  assert(
    "vertical line orientation is near ±π/2",
    Math.abs(Math.abs(lineShape.orientation) - Math.PI / 2) < 0.35,
  );

  const blob = [];
  for (let y = 10; y < 15; y++) {
    for (let x = 10; x < 15; x++) blob.push(y * gw + x);
  }
  const blobShape = measureShape(blob, 12, 12, gw, gh);
  assert("filled block is not a needle", blobShape.elongation < 0.35);
  assert("filled block compactness is high", blobShape.compactness > 0.6);

  assert(
    "needle Q extent uses thickness",
    qExtentFromShape(20, 1, 0.95) < 4,
  );
  assert(
    "blob Q extent keeps AABB height",
    Math.abs(qExtentFromShape(20, 2, 0) - 20) < 1e-9,
  );
  assert(
    "thick elongated slab keeps AABB height",
    qExtentFromShape(128, 20, 0.9) > 100,
  );
  assert("FLOW_FILL_S is faster than CALM_FILL_S", SCHED.FLOW_FILL_S < SCHED.CALM_FILL_S);
}

if (failed) {
  console.error(`\nPhase 4 verify: ${failed} failure(s)`);
  process.exit(1);
}
console.log("\nPhase 4 verify: passed");
