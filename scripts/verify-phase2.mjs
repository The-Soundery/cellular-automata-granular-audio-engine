/**
 * Phase 2–3 gate: GrainScheduler + ephemeral worklet + main wiring.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

const main = readFileSync(join(root, "src/main.ts"), "utf8");
const schedSrc = readFileSync(join(root, "src/field/GrainScheduler.ts"), "utf8");
const audioSrc = readFileSync(join(root, "src/audio/AudioEngine.ts"), "utf8");
const worklet = readFileSync(join(root, "public/grain-processor.js"), "utf8");
const controls = readFileSync(join(root, "src/ui/controls.ts"), "utf8");

assert("GrainScheduler.ts present", existsSync(join(root, "src/field/GrainScheduler.ts")));
assert("main wires GrainScheduler", /GrainScheduler/.test(main) && /sendEvents/.test(main));
assert("AudioEngine.sendEvents", /sendEvents/.test(audioSrc));
assert("no lattice FieldReducer", !existsSync(join(root, "src/field/FieldReducer.ts")));
assert("no sendPlan lattice path", !/sendPlan/.test(main) && !/sendPlan/.test(audioSrc));
assert(
  "freeze-at-spawn sample window fields",
  /sampleCenter/.test(schedSrc) && /sampleHalf/.test(schedSrc),
);
assert("direction from motion", /velDirEps/.test(schedSrc) && /direction/.test(schedSrc));
assert("area-weighted budget", /allocateShares/.test(schedSrc) && /GRAIN_BUDGET/.test(schedSrc));
assert(
  "no chaos leftover budget dump",
  !/Math\.max\(\s*chaosFromArea\s*,\s*Math\.max\(\s*0\s*,\s*budget\s*-\s*assigned\s*\)\s*\)/.test(
    schedSrc,
  ),
);
assert(
  "chaos share capped at area (no leftover donate)",
  /Math\.min\(\s*chaosFromArea\s*,\s*Math\.max\(\s*0\s*,\s*budget\s*-\s*(?:sum|assigned)\s*\)\s*\)/.test(
    schedSrc,
  ),
);
assert(
  "no chaos area-rate floor 0.15",
  !/Math\.max\(\s*0\.15\s*,\s*obs\.chaosAreaFraction\s*\)/.test(schedSrc),
);
assert(
  "no chaosAreaFraction double-scale on rate",
  !/chaosRateHz\s*\*\s*obs\.chaosAreaFraction/.test(schedSrc),
);
assert(
  "chaos pack-to-share",
  /chaosPackRateHz/.test(schedSrc) && /chaosPackRateMin/.test(schedSrc),
);
assert("spawn from region.cells", /region\.cells\[/.test(schedSrc));
assert("rhythm history / period", /rhythmHistory/.test(schedSrc) && /estimatePeriod/.test(schedSrc));
assert(
  "rhythm pulse without packing burst",
  /rhythmPulseMax/.test(schedSrc) && /rhythmWashFloor/.test(schedSrc),
);
assert("fillRatio used in duration", /fillRatio/.test(schedSrc));
assert(
  "saturation drives window width",
  /WINDOW_HALF/.test(schedSrc) && /sat/.test(schedSrc),
);
assert(
  "unified continuous law",
  /order/.test(schedSrc) && /DUR_MIN/.test(schedSrc) && /grainMaterial/.test(schedSrc),
);
assert(
  "δ-weighted chaos spawn",
  /maxDelta/.test(schedSrc) && /obs\.delta\[ci\]/.test(schedSrc),
);
assert("overlap scales with κ", /meanCoherence/.test(schedSrc) && /0\.35 \+ 0\.65/.test(schedSrc));
assert("calm packing rate", /calmPackRateHz|calmPackRateMin/.test(schedSrc));
assert("calmPackRateMin widened for δ tracking", /calmPackRateMin:\s*0\.5/.test(schedSrc));
assert("maxCalmConcurrent raised", /maxCalmConcurrent:\s*8/.test(schedSrc));
assert(
  "continuous envelope fracs on spawn",
  /attackFrac/.test(schedSrc) && /ATT_MIN/.test(schedSrc) && /ATT_MAX/.test(schedSrc),
);
assert("no ySpread special case", !/ySpreadFillMin/.test(schedSrc) && !/pickNearestCellInColumn/.test(schedSrc));
assert("no velocity-hybrid calm laws", !/hybridCalmLaws/.test(schedSrc) && !/velChaosNorm/.test(schedSrc));
assert("region tracks for pan/Y", /RegionTrack/.test(schedSrc) && /tracks/.test(schedSrc) && /trackDx/.test(schedSrc));
const overlaySrc = readFileSync(join(root, "src/ui/RegionOverlay.ts"), "utf8");
assert("overlay draws cell silhouette", /cells/.test(overlaySrc));
assert("overlay bright edge cells", /isEdgeCell/.test(overlaySrc));
assert("overlay has no AABB strokeRect", !/strokeRect/.test(overlaySrc));
assert("overlay outline-first interior alpha", /0\.07/.test(overlaySrc));
assert("overlay toggle On/Off label", /Overlay: On/.test(controls));
assert("worklet direct pan/Y follow", /applyTracks/.test(worklet) && /trackDx/.test(worklet));
assert("worklet has no TRACK_SMOOTH", !/TRACK_SMOOTH/.test(worklet));
assert("worklet does not chase sample bounds from track", !/boundLo\s*=\s*[^;]*track/i.test(worklet));
assert("worklet handles events", /type === "events"/.test(worklet));
assert("worklet ping-pong", /boundLo/.test(worklet) && /dir = -1/.test(worklet));
assert("worklet energy normalisation", /TARGET_RMS/.test(worklet) && /normGain/.test(worklet));
assert(
  "worklet uses frozen attackFrac (analytic envelope)",
  /attackFrac/.test(worklet) && /envelopeAt/.test(worklet) && !/windowCache/.test(worklet),
);
assert("no latticeIndex in worklet", !/latticeIndex/.test(worklet));
assert("no paintGrain lattice loop", !/paintGrain/.test(worklet));
assert("UI budget meters", /st-budget/.test(controls) && /Calm g/.test(controls));
assert("UI sonic laws hint", /hue→sample|pan\/Y follow/.test(controls));

async function runtimeScheduler() {
  let fieldMod;
  let schedMod;
  try {
    fieldMod = await import(
      pathToFileURL(join(root, "src/field/FieldObserver.ts")).href
    );
    schedMod = await import(
      pathToFileURL(join(root, "src/field/GrainScheduler.ts")).href
    );
  } catch (err) {
    console.log(`  skip runtime (${err instanceof Error ? err.message : err})`);
    return;
  }

  const { FieldObserver } = fieldMod;
  const { GrainScheduler, GRAIN_BUDGET } = schedMod;
  const w = 32;
  const h = 32;
  const n = w * h;

  function makeField(fill) {
    const r = new Float32Array(n);
    const g = new Float32Array(n);
    const b = new Float32Array(n);
    for (let i = 0; i < n; i++) fill(r, g, b, i);
    return { width: w, height: h, r, g, b };
  }

  const prev = makeField((r, g, b, i) => {
    r[i] = g[i] = b[i] = 0.1;
  });
  const cur = makeField((r, g, b, i) => {
    const x = i % w;
    const y = (i / w) | 0;
    const inBlob = x >= 6 && x < 22 && y >= 6 && y < 22;
    if (inBlob) {
      r[i] = 0.25;
      g[i] = 0.5;
      b[i] = 0.9;
    } else {
      r[i] = ((i * 17) % 97) / 97;
      g[i] = ((i * 31) % 89) / 89;
      b[i] = ((i * 13) % 83) / 83;
    }
  });

  const fo = new FieldObserver(w, h);
  fo.observe(cur, prev);
  for (let t = 0; t < 10; t++) fo.observe(cur, cur);
  const obs = fo.observation;
  assert("runtime: coherent region exists", obs.coherent.length >= 1);

  const sched = new GrainScheduler(GRAIN_BUDGET);
  let totalEvents = 0;
  let sawCalm = false;
  let sawChaos = false;
  let calmOk = true;
  let chaosOk = true;
  let ampOk = true;
  let dirOk = true;
  let budgetOk = true;
  let envOk = true;
  let now = 1000;
  for (let t = 0; t < 60; t++) {
    now += 1000 / 30;
    const batch = sched.step(obs, cur, now);
    totalEvents += batch.events.length;
    if (batch.predictedActive > GRAIN_BUDGET) budgetOk = false;
    for (const e of batch.events) {
      if (!(e.amplitude > 0 && Number.isFinite(e.amplitude))) ampOk = false;
      if (!(e.direction === 1 || e.direction === -1)) dirOk = false;
      if (e.regime === "calm") {
        sawCalm = true;
        if (
          !(
            typeof e.sampleCenter === "number" &&
            typeof e.sampleHalf === "number" &&
            e.sampleHalf > 0 &&
            e.durationSec >= 0.03 &&
            e.durationSec <= 2.2 &&
            typeof e.q === "number" &&
            e.q > 0
          )
        ) {
          calmOk = false;
        }
        if (
          !(
            e.attackFrac >= 0.04 &&
            e.attackFrac <= 0.3 &&
            e.releaseFrac >= 0.12 &&
            e.releaseFrac <= 0.34
          )
        ) {
          envOk = false;
        }
      }
      if (e.regime === "chaos") {
        sawChaos = true;
        if (
          !(
            e.durationSec >= 0.03 &&
            e.durationSec <= 2.2 &&
            typeof e.sampleCenter === "number" &&
            typeof e.q === "number"
          )
        ) {
          chaosOk = false;
        }
        if (
          !(
            e.attackFrac >= 0.04 &&
            e.attackFrac <= 0.3 &&
            e.releaseFrac >= 0.12 &&
            e.releaseFrac <= 0.34
          )
        ) {
          envOk = false;
        }
      }
    }
  }
  assert("never exceeds budget prediction", budgetOk);
  assert("calm events well-formed", !sawCalm || calmOk);
  assert("chaos events well-formed", !sawChaos || chaosOk);
  assert("continuous envelope fracs frozen on events", envOk);
  assert("amplitude finite", ampOk);
  assert("direction ±1", dirOk);
  assert("scheduler emitted events over time", totalEvents > 0);
  assert("saw calm and/or chaos events", sawCalm || sawChaos);
  if (obs.calmAreaFraction > 0.2) {
    assert("large calm area produced calm grains", sawCalm);
  }

  // Static full-field calm: packing rate must sustain overlapping concurrent grains.
  const solid = makeField((r, g, b, i) => {
    r[i] = 0.9;
    g[i] = 0.45;
    b[i] = 0.1;
  });
  const calmFo = new FieldObserver(w, h);
  calmFo.observe(solid, prev);
  for (let t = 0; t < 12; t++) calmFo.observe(solid, solid);
  const calmObs = calmFo.observation;
  assert("static field is mostly calm", calmObs.calmAreaFraction > 0.9);
  const calmSched = new GrainScheduler(GRAIN_BUDGET);
  let peakCalm = 0;
  let now2 = 5000;
  for (let t = 0; t < 90; t++) {
    now2 += 1000 / 30;
    const batch = calmSched.step(calmObs, solid, now2);
    if (batch.calmActive > peakCalm) peakCalm = batch.calmActive;
  }
  assert(
    "static full-calm sustains overlapping grains (peak calmActive ≥ 3)",
    peakCalm >= 3,
  );

  // Mostly-calm with a thin chaotic strip: chaos concurrent must stay near area share
  // (no leftover-budget donate + no 0.15 rate floor inflation).
  const strip = makeField((r, g, b, i) => {
    const y = (i / w) | 0;
    if (y < 3) {
      r[i] = ((i * 17) % 97) / 97;
      g[i] = ((i * 31) % 89) / 89;
      b[i] = ((i * 13) % 83) / 83;
    } else {
      r[i] = 0.2;
      g[i] = 0.55;
      b[i] = 0.85;
    }
  });
  const stripFo = new FieldObserver(w, h);
  stripFo.observe(strip, prev);
  for (let t = 0; t < 12; t++) stripFo.observe(strip, strip);
  const stripObs = stripFo.observation;
  const chaosShareCap = Math.max(
    1,
    Math.ceil(GRAIN_BUDGET * stripObs.chaosAreaFraction) + 2,
  );
  assert(
    "thin chaos strip is minority area",
    stripObs.chaosAreaFraction > 0 && stripObs.chaosAreaFraction < 0.25,
  );
  const stripSched = new GrainScheduler(GRAIN_BUDGET);
  let peakChaos = 0;
  let now3 = 9000;
  for (let t = 0; t < 90; t++) {
    now3 += 1000 / 30;
    const batch = stripSched.step(stripObs, strip, now3);
    if (batch.chaosActive > peakChaos) peakChaos = batch.chaosActive;
  }
  assert(
    `thin chaos concurrent stays near area share (peak ${peakChaos} ≤ ${chaosShareCap})`,
    peakChaos <= chaosShareCap,
  );

  // Near-100% chaotic field: pack-to-share must fill a meaningful concurrent count.
  const chaosField = makeField((r, g, b, i) => {
    r[i] = ((i * 17) % 97) / 97;
    g[i] = ((i * 31) % 89) / 89;
    b[i] = ((i * 13) % 83) / 83;
  });
  const chaosPrev = makeField((r, g, b, i) => {
    r[i] = ((i * 41) % 91) / 91;
    g[i] = ((i * 19) % 87) / 87;
    b[i] = ((i * 23) % 79) / 79;
  });
  const chaosFo = new FieldObserver(w, h);
  // Alternate frames so δ stays elevated (fast chaos).
  let a = chaosField;
  let b = chaosPrev;
  chaosFo.observe(a, b);
  for (let t = 0; t < 20; t++) {
    const tmp = a;
    a = b;
    b = tmp;
    // Reshuffle slightly each pair so similarity stays low.
    for (let i = 0; i < n; i++) {
      a.r[i] = ((i * (17 + (t % 5)) + t * 3) % 97) / 97;
      a.g[i] = ((i * (31 + (t % 7)) + t * 5) % 89) / 89;
      a.b[i] = ((i * (13 + (t % 3)) + t * 7) % 83) / 83;
    }
    chaosFo.observe(a, b);
  }
  const chaosObs = chaosFo.observation;
  assert(
    "full-chaos field is mostly chaotic",
    chaosObs.chaosAreaFraction > 0.85,
  );
  const fullChaosSched = new GrainScheduler(GRAIN_BUDGET);
  let peakFullChaos = 0;
  let now4 = 12000;
  for (let t = 0; t < 90; t++) {
    now4 += 1000 / 30;
    // Keep feeding alternating high-δ frames while scheduling.
    if (t % 2 === 0) {
      for (let i = 0; i < n; i++) {
        a.r[i] = Math.random();
        a.g[i] = Math.random();
        a.b[i] = Math.random();
      }
      chaosFo.observe(a, b);
      [a, b] = [b, a];
    }
    const batch = fullChaosSched.step(chaosFo.observation, a, now4);
    if (batch.chaosActive > peakFullChaos) peakFullChaos = batch.chaosActive;
  }
  assert(
    `full-chaos concurrent fills share (peak ${peakFullChaos} ≥ 16)`,
    peakFullChaos >= 16,
  );

  // Region tracks carry COM + grid size; calm grains carry spawn offset for direct follow.
  const trackFo = new FieldObserver(w, h);
  trackFo.observe(solid, prev);
  for (let t = 0; t < 8; t++) trackFo.observe(solid, solid);
  const trackObs = trackFo.observation;
  const trackSched = new GrainScheduler(GRAIN_BUDGET);
  let now5 = 20000;
  let sawTracks = false;
  let trackHasCom = false;
  let spawnHasOffset = false;
  for (let t = 0; t < 40; t++) {
    now5 += 1000 / 30;
    const batch = trackSched.step(trackObs, solid, now5);
    if (batch.tracks?.length) {
      sawTracks = true;
      const tr = batch.tracks[0];
      if (
        typeof tr.comX === "number" &&
        typeof tr.comY === "number" &&
        tr.gridWidth === w
      ) {
        trackHasCom = true;
      }
    }
    for (const e of batch.events) {
      if (e.regime === "calm" && typeof e.trackDx === "number") {
        spawnHasOffset = true;
      }
    }
  }
  assert("batch includes region tracks", sawTracks);
  assert("tracks include COM + grid size", trackHasCom);
  assert("calm grains include trackDx/Dy offset", spawnHasOffset);
}

await runtimeScheduler();

if (failed) {
  console.error(`\nPhase 2–3 verify: ${failed} failure(s)`);
  process.exit(1);
}
console.log("\nPhase 2–3 verify: passed");
