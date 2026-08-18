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
const main = readFileSync(join(root, "src/main.ts"), "utf8");

assert("Sonic Laws in brief", /Sonic Laws \(authoritative\)/.test(brief));
assert("freeze-at-spawn in brief", /Freeze at spawn/.test(brief));
assert(
  "brief allows direct pan/Y region follow",
  /directly follow|Allowed to track directly/i.test(brief),
);
assert(
  "brief documents V5 polar / stereo / channel-mix follow",
  /polar/i.test(brief) && /channel mix/i.test(brief),
);
assert("brief has no velocity-hybrid", !/velocity-hybrid/i.test(brief));
assert(
  "brief forbids sample scrub chase",
  /sample scrub window|Sample \/ scrub window/i.test(brief),
);
assert("pipeline: observe → schedule → sendEvents", /fieldObserver\.observe/.test(main) && /scheduler\.step/.test(main) && /sendEvents/.test(main));
assert(
  "worklet documents sample freeze + direct pan/Y follow",
  /applyTracks/.test(worklet) && /No smoothing/.test(worklet),
);
assert("ping-pong uses locked bounds only", /voice\.boundLo/.test(worklet) && /voice\.boundHi/.test(worklet));
const processBody = worklet.slice(worklet.indexOf("process(_inputs"));
assert(
  "process() does not rewrite boundLo/Hi",
  !/voice\.boundLo\s*=/.test(processBody) && !/voice\.boundHi\s*=/.test(processBody),
);
assert(
  "worklet has no pan/Y lerp smoothing",
  !/TRACK_SMOOTH/.test(worklet) && !/panTarget/.test(worklet),
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
  "calm sustained subset (not soft 0.22 bias)",
  /SUSTAINED_SUBSET_QUANTILE/.test(spectral) &&
    /SUSTAINED_ATTACK_GAP/.test(spectral) &&
    /sustainedSubset/.test(spectral) &&
    !/REGIME_STATIONARITY_BIAS/.test(spectral),
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

// Runtime: sustain tone + one click — calm must miss the click hop.
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
  // Quiet sustained tone for most of the file.
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    pcm[i] = 0.08 * Math.sin(2 * Math.PI * 220 * t);
  }
  // One short click ~0.35 s in (well clear of the seam fade).
  const clickAt = Math.floor(0.35 * sr);
  const clickN = Math.floor(0.004 * sr);
  for (let i = 0; i < clickN; i++) {
    const env = 1 - i / clickN;
    pcm[clickAt + i] = 0.95 * env * (i % 2 === 0 ? 1 : -1);
  }

  const segments = buildPolarSegments(pcm, sr);
  assert("fixture produced multiple segments", segments.length >= 8);

  const clickPos = clickAt / (n - 1);
  const clickTol = 0.06; // ~±120 ms at 2 s
  const nearClick = (pos) => Math.abs(pos - clickPos) < clickTol;

  // Some segment near the click should score as relatively transient.
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

  // Grey + mid-hue sustained queries must not land on the click.
  const queries = [
    { h: 0.0, s: 0.0, v: 0.5, label: "grey mid" },
    { h: 0.5, s: 0.9, v: 0.6, label: "vivid mid-hue" },
    { h: 0.15, s: 0.8, v: 0.4, label: "vivid warm" },
    { h: 0.7, s: 0.7, v: 0.7, label: "vivid cool" },
  ];
  let sustainedMissed = true;
  for (const q of queries) {
    const r = queryMaterialFromHsv(segments, q.h, q.s, q.v, "sustained");
    if (nearClick(r.sampleCenter)) {
      sustainedMissed = false;
      console.error(
        `  sustained (${q.label}) landed near click at ${r.sampleCenter.toFixed(3)}`,
      );
    }
  }
  assert("sustained queries miss the click hop", sustainedMissed);

  // File-start must not win grey sustained just because first-hop flux was 0.
  // Build a second fixture that *opens* with a click, then pad.
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
    const startHit = queryMaterialFromHsv(segs2, 0.5, 0, 0.5, "sustained");
    assert(
      "grey sustained does not pin to opening click (first-hop lie)",
      startHit.sampleCenter > 0.05,
    );
    const openSeg = segs2.reduce((best, s) =>
      Math.abs(s.pos - 0) < Math.abs(best.pos - 0) ? s : best,
    );
    assert(
      "opening click scores as transient",
      openSeg.stationarity < 0.55,
    );
  }

  // Transient may still find the click (colour + chance — at least allowed).
  let transientNear = false;
  for (const q of queries) {
    const r = queryMaterialFromHsv(segments, q.h, q.s, q.v, "transient");
    if (nearClick(r.sampleCenter)) transientNear = true;
  }
  // Not required to hit — only that the map still has low-stationarity material.
  assert(
    "map retains transient material near click",
    segments.some((s) => nearClick(s.pos) && s.stationarity < 0.55) ||
      transientNear,
  );
}

if (failed) {
  console.error(`\nPhase 4 verify: ${failed} failure(s)`);
  process.exit(1);
}
console.log("\nPhase 4 verify: passed");
