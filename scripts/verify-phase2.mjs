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
  "segment bounds drive window (not area half-width lerp)",
  /WINDOW_HALF_ABS_MIN_S/.test(schedSrc) &&
    /startPos/.test(schedSrc) &&
    /function areaT/.test(schedSrc) &&
    !/WINDOW_HALF_MIN_S/.test(schedSrc) &&
    !/WINDOW_HALF_MAX_S/.test(schedSrc) &&
    !/FLOW_WINDOW_T/.test(schedSrc),
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
assert("calmPackRateMin widened for δ tracking", /calmPackRateMin:\s*1\.0/.test(schedSrc));
assert("maxCalmConcurrent raised", /maxCalmConcurrent:\s*64/.test(schedSrc));
assert(
  "continuous envelope fracs on spawn",
  /attackFrac/.test(schedSrc) && /ATT_MIN/.test(schedSrc) && /ATT_MAX/.test(schedSrc),
);
assert(
  "calm attack seconds cap + catch-up fill",
  /ATT_ABS_MAX_S/.test(schedSrc) &&
    /CALM_FILL_S/.test(schedSrc) &&
    /attackFracCapped/.test(schedSrc) &&
    /catchHz/.test(schedSrc),
);
assert(
  "DUR_MAX is 2s wash (not multi-second drone)",
  /DUR_MAX:\s*2(?:\.0)?/.test(schedSrc),
);
assert(
  "compact chaos uses measured height for Q",
  /qFromVerticalExtent\(heightCells/.test(schedSrc) &&
    /chaotic\.height/.test(schedSrc),
);
assert("no ySpread special case", !/ySpreadFillMin/.test(schedSrc) && !/pickNearestCellInColumn/.test(schedSrc));
assert("no velocity-hybrid calm laws", !/hybridCalmLaws/.test(schedSrc) && !/velChaosNorm/.test(schedSrc));
assert("region tracks for pan/Y", /RegionTrack/.test(schedSrc) && /tracks/.test(schedSrc) && /trackDx/.test(schedSrc));
assert(
  "flow fifth pool + FLOW_ID_BASE",
  /FLOW_ID_BASE/.test(schedSrc) &&
    /FLOW_ORDER_MIN/.test(schedSrc) &&
    /FLOW_ORDER_MAX/.test(schedSrc) &&
    /flowTimeOrder|flowPackT/.test(schedSrc) &&
    /flowHeadingEdges|flowConveyorDuration/.test(schedSrc) &&
    /spawnFlow/.test(schedSrc) &&
    /regime: "flow"/.test(schedSrc) &&
    /sitePeriod/.test(schedSrc),
);
assert("UI flow spend meter", /shareFlow|flowGrains/.test(controls) && /· f /.test(controls));
assert(
  "share reclaim yields dead-id / over-share grains",
  /reclaimToShares/.test(schedSrc) &&
    /releaseGrainIds/.test(schedSrc) &&
    /releaseGrainIds/.test(audioSrc) &&
    /releaseGrains/.test(worklet) &&
    /SHARE_RELEASE_SEC/.test(worklet),
);
assert(
  "flow occupancy counts live active only",
  /countActiveSeat\(this\.active, "flow"/.test(schedSrc),
);
const overlaySrc = readFileSync(join(root, "src/ui/RegionOverlay.ts"), "utf8");
const waveSrc = readFileSync(join(root, "src/ui/WaveformStrip.ts"), "utf8");
assert("overlay flow listen colour", /regime === "flow"/.test(waveSrc) && /REGIME_HEX\.flow/.test(overlaySrc));
assert("overlay draws cell silhouette", /cells/.test(overlaySrc));
assert("overlay bright edge cells", /isEdgeCell/.test(overlaySrc));
assert("overlay has no AABB strokeRect", !/strokeRect/.test(overlaySrc));
assert("overlay outline map (edge paint, no interior wash)", /strokeEdges/.test(overlaySrc) && !/0\.07/.test(overlaySrc));
assert("overlay waveform strip", existsSync(join(root, "src/ui/WaveformStrip.ts")) && /wave-strip/.test(main));
assert("overlay toggle present", /overlay-toggle/.test(controls));
assert("Type-U spatial neighbors", /neighborPrograms/.test(main) && /programAt/.test(readFileSync(join(root, "src/ca/typeU.ts"), "utf8")));
assert("explore telescope", /explore-sky/.test(main) && /mountExploreNeighbors/.test(main));
assert("worklet direct pan/Y follow", /applyTracks/.test(worklet) && /trackDx/.test(worklet));
assert(
  "worklet Q follows track qExtent",
  /qExtent/.test(worklet) && /qFromVerticalExtent/.test(worklet),
);
assert(
  "scheduler sends qExtent on region tracks",
  /qExtent: qExtentFromShape/.test(schedSrc),
);
assert(
  "merge inherits absorbed packing credit",
  /survivor\.acc = Math\.min\(3, survivor\.acc \+ absorbed\.acc\)/.test(
    schedSrc,
  ),
);
assert(
  "death short-releases that id's grains",
  /deathIds\.has\(a\.regionId\)/.test(schedSrc),
);
assert("worklet saturates pan and Y at torus seam", /panSaturated/.test(worklet) && /ySaturated/.test(worklet));
assert("worklet follow Y does not wrapCoord", !/wrapCoord\(voice\.y/.test(worklet));
assert("flow heading projection is toroidal", /function flowHeadingEdges[\s\S]*?toroidalOffset\(x, flow\.comX/.test(schedSrc));
assert("worklet has no TRACK_SMOOTH", !/TRACK_SMOOTH/.test(worklet));
assert(
  "worklet ramps pan/Y/mix inside one block (anti-click, not follow lag)",
  /PARAM_RAMP_SAMPLES/.test(worklet) &&
    /PARAM_RAMP_SAMPLES = 128/.test(worklet),
);
assert(
  "dropout clears hasFollowAnchor (no gap-as-one-hop click)",
  /hasFollowAnchor = false/.test(worklet),
);
assert("calm follow-anchor hysteresis", /anchorLocks/.test(schedSrc));
assert(
  "calm follow is velocity conveyor + capped COM correction",
  /CALM_FOLLOW_CORRECT/.test(schedSrc) && /CALM_FOLLOW_CORR_CAP/.test(schedSrc),
);
assert(
  "short-release bakes envelope (no attack→sustain snap)",
  /forceShortRelease/.test(worklet) && /voice\.amp \*= e/.test(worklet),
);
assert("worklet does not chase sample bounds from track", !/boundLo\s*=\s*[^;]*track/i.test(worklet));
assert("worklet handles events", /type === "events"/.test(worklet));
assert("worklet ping-pong", /boundLo/.test(worklet) && /dir = -1/.test(worklet));
assert("worklet energy normalisation", /TARGET_RMS/.test(worklet) && /normGain/.test(worklet));
assert(
  "slow voice-count leveler",
  /NORM_RELEASE = 0\.0004/.test(worklet) &&
    /PRESCALE_SMOOTH = 0\.004/.test(worklet) &&
    /targetRms/.test(worklet),
);
assert(
  "worklet uses frozen attackFrac (analytic envelope)",
  /attackFrac/.test(worklet) && /envelopeAt/.test(worklet) && !/windowCache/.test(worklet),
);
assert("no latticeIndex in worklet", !/latticeIndex/.test(worklet));
assert("no paintGrain lattice loop", !/paintGrain/.test(worklet));
const brief = readFileSync(join(root, "Creative Brief.txt"), "utf8");
assert(
  "UI budget meters",
  /st-budget/.test(controls) && /st-spend/.test(controls),
);
assert(
  "sonic laws polar / pan/Y still in brief",
  /polar/i.test(brief) && /pan\/Y|channel mix/i.test(brief),
);
assert("DATA output meter", /tk-out/.test(controls) && /st-out/.test(controls));

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
  const { GrainScheduler, GRAIN_BUDGET, SCHED, FLOW_ID_BASE } = schedMod;
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
            e.durationSec <= SCHED.DUR_MAX + 1e-9 &&
            typeof e.q === "number" &&
            e.q > 0
          )
        ) {
          calmOk = false;
        }
        if (
          !(
            e.attackFrac >= 0.02 &&
            e.attackFrac <= 0.3 &&
            e.releaseFrac >= 0.34 &&
            e.releaseFrac <= 0.98
          )
        ) {
          envOk = false;
        }
        if (e.attackFrac * e.durationSec > SCHED.ATT_ABS_MAX_S + 1e-6) {
          envOk = false;
        }
      }
      if (e.regime === "chaos") {
        sawChaos = true;
        if (
          !(
            e.durationSec >= 0.03 &&
            e.durationSec <= SCHED.DUR_MAX + 1e-9 &&
            typeof e.sampleCenter === "number" &&
            typeof e.q === "number"
          )
        ) {
          chaosOk = false;
        }
        if (
          !(
            e.attackFrac >= 0.02 &&
            e.attackFrac <= 0.3 &&
            e.releaseFrac >= 0.34 &&
            e.releaseFrac <= 0.98
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

  // Tall flickering chaos column: compact cluster height drives Q (not 1-row).
  {
    const FILT_RATIO = 12000 / 80;
    function qFromHeight(heightCells, gridH, durationSec, yNorm) {
      const dy = Math.max(1, heightCells) / Math.max(1, gridH - 1);
      const r = Math.pow(FILT_RATIO, dy);
      let q = r <= 1 + 1e-9 ? SCHED.Q_MAX : Math.sqrt(r) / (r - 1);
      q = Math.max(SCHED.Q_MIN, Math.min(SCHED.Q_MAX, q));
      const fc = 80 * Math.pow(FILT_RATIO, Math.max(0, Math.min(1, yNorm)));
      return Math.min(q, Math.max(1, durationSec * fc));
    }
    function fillTallChaos(field, t) {
      for (let i = 0; i < n; i++) {
        const x = i % w;
        const y = (i / w) | 0;
        if (x >= 14 && x < 18) {
          const seed = (t + 1) * 9973 + i * 17;
          field.r[i] = ((seed * 31) % 97) / 97;
          field.g[i] = ((seed * 57) % 89) / 89;
          field.b[i] = ((seed * 13) % 83) / 83;
        } else {
          field.r[i] = 0.2;
          field.g[i] = 0.55;
          field.b[i] = 0.85;
        }
      }
    }
    const tall = makeField(() => {});
    const tallPrev = makeField(() => {});
    fillTallChaos(tallPrev, 0);
    fillTallChaos(tall, 1);
    const tallFo = new FieldObserver(w, h);
    tallFo.observe(tall, tallPrev);
    for (let t = 0; t < 16; t++) {
      tallPrev.r.set(tall.r);
      tallPrev.g.set(tall.g);
      tallPrev.b.set(tall.b);
      fillTallChaos(tall, t + 2);
      tallFo.observe(tall, tallPrev);
    }
    const tallObs = tallFo.observation;
    const compact = (tallObs.chaotic.clusters ?? []).filter((c) => c.compact);
    assert(
      "tall chaos column yields a compact cluster with height ≫ 1",
      compact.some((c) => c.height >= 8),
    );
    const tallSched = new GrainScheduler(GRAIN_BUDGET);
    let nowTall = 9000;
    let chaosQOk = true;
    let sawTallChaos = false;
    let sawOpenQ = false;
    for (let t = 0; t < 45; t++) {
      nowTall += 1000 / 30;
      const batch = tallSched.step(tallObs, tall, nowTall);
      for (const e of batch.events) {
        if (e.regime !== "chaos") continue;
        sawTallChaos = true;
        const oneRow = qFromHeight(1, h, e.durationSec, e.yNorm);
        // Never sharper than a one-row sliver at the same site.
        if (e.q > oneRow + 0.05) chaosQOk = false;
        // Where the extent law actually opens (cycle ceiling does not bind
        // both to the same value), we must hear a wider bandpass.
        if (oneRow > 4 && e.q < oneRow - 0.5) sawOpenQ = true;
      }
    }
    assert("tall chaos column produced chaos grains", sawTallChaos);
    assert(
      "compact tall chaos Q never exceeds one-row Q",
      chaosQOk,
    );
    assert(
      "compact tall chaos opens bandpass vs one-row where law allows",
      sawOpenQ,
    );
  }

  // Mostly-calm with a thin chaotic strip: chaos concurrent must stay near area share
  // (no leftover-budget donate + no 0.15 rate floor inflation).
  // V4.2: strip must flicker — static noise is textured, not chaotic.
  function fillStrip(field, t) {
    for (let i = 0; i < n; i++) {
      const y = (i / w) | 0;
      if (y < 3) {
        const seed = (t + 1) * 9973 + i * 17;
        field.r[i] = ((seed * 31) % 97) / 97;
        field.g[i] = ((seed * 57) % 89) / 89;
        field.b[i] = ((seed * 13) % 83) / 83;
      } else {
        field.r[i] = 0.2;
        field.g[i] = 0.55;
        field.b[i] = 0.85;
      }
    }
  }
  const strip = makeField(() => {});
  const stripPrev = makeField(() => {});
  fillStrip(stripPrev, 0);
  fillStrip(strip, 1);
  const stripFo = new FieldObserver(w, h);
  stripFo.observe(strip, stripPrev);
  for (let t = 0; t < 12; t++) {
    stripPrev.r.set(strip.r);
    stripPrev.g.set(strip.g);
    stripPrev.b.set(strip.b);
    fillStrip(strip, t + 2);
    stripFo.observe(strip, stripPrev);
  }
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
  // Area-share fill under the δ-proportional rate scale (t = δ̄/deltaRateNorm).
  // CPU rail must not bind; concurrency ≈ share × t when duration is short.
  const deltaT = Math.min(
    1,
    Math.max(0, chaosObs.chaotic.meanDelta / SCHED.deltaRateNorm),
  );
  const chaosShareFloor = Math.max(
    8,
    Math.floor(GRAIN_BUDGET * chaosObs.chaosAreaFraction * deltaT * 0.85),
  );
  assert(
    `full-chaos concurrent fills area share (peak ${peakFullChaos} ≥ ${chaosShareFloor}, δ̄=${chaosObs.chaotic.meanDelta.toFixed(3)} t=${deltaT.toFixed(2)})`,
    peakFullChaos >= chaosShareFloor,
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

  // Flow-dense: packed travelling colour → fifth pool spends after confirm.
  const flowW = 128;
  const flowH = 128;
  const flowN = flowW * flowH;
  function makeFlowField(fill) {
    const r = new Float32Array(flowN);
    const g = new Float32Array(flowN);
    const b = new Float32Array(flowN);
    for (let i = 0; i < flowN; i++) fill(r, g, b, i);
    return { width: flowW, height: flowH, r, g, b };
  }
  function paintDense(field, step) {
    for (let i = 0; i < flowN; i++) {
      field.r[i] = 0.1;
      field.g[i] = 0.1;
      field.b[i] = 0.12;
    }
    const x0 = (((40 + step) % flowW) + flowW) % flowW;
    const y0 = 48;
    for (let iy = 0; iy < 5; iy++) {
      for (let ix = 0; ix < 5; ix++) {
        const x = (x0 + ix * 3) % flowW;
        const y = (y0 + iy * 3) % flowH;
        const i = y * flowW + x;
        field.r[i] = 0.95;
        field.g[i] = 0.82;
        field.b[i] = 0.2;
      }
    }
  }
  const flowFo = new FieldObserver(flowW, flowH);
  let flowPrev = makeFlowField((r, g, b) => {
    r.fill(0.1);
    g.fill(0.1);
    b.fill(0.12);
  });
  for (let step = 0; step < 40; step++) {
    const flowCur = makeFlowField(() => {});
    paintDense(flowCur, step);
    flowFo.observe(flowCur, flowPrev);
    flowPrev = flowCur;
  }
  const flowObs = flowFo.observation;
  assert(
    "runtime flow-dense: observer reports flow",
    (flowObs.flows ?? []).length > 0 && flowObs.flowAreaFraction > 0,
  );
  const flowSched = new GrainScheduler(GRAIN_BUDGET);
  let nowFlow = 30000;
  let flowEvents = 0;
  let flowShareMax = 0;
  let flowIdOk = true;
  let flowDurOk = true;
  for (let t = 0; t < 60; t++) {
    nowFlow += 1000 / 30;
    // Keep the pack moving so flow stays confirmed.
    const step = 40 + t;
    const flowCur = makeFlowField(() => {});
    paintDense(flowCur, step);
    flowFo.observe(flowCur, flowPrev);
    flowPrev = flowCur;
    const batch = flowSched.step(flowFo.observation, flowCur, nowFlow);
    if (batch.shares.flow > flowShareMax) flowShareMax = batch.shares.flow;
    for (const e of batch.events) {
      if (e.regime === "flow") {
        flowEvents += 1;
        if (!(e.regionId >= FLOW_ID_BASE)) flowIdOk = false;
        if (!(e.durationSec > 0.05 && e.durationSec < 1.0)) flowDurOk = false;
      }
    }
  }
  assert("runtime flow-dense: share > 0", flowShareMax > 0);
  assert("runtime flow-dense: flow events spawned", flowEvents > 0);
  assert("runtime flow-dense: regionId >= FLOW_ID_BASE", flowIdOk);
  assert(
    "runtime flow-dense: mid duration band (FLOW_ORDER_MIN..MAX)",
    flowDurOk,
  );

  // Train-track conveyor: grains spawn near trailing edge and track anchor
  // rides hop velocity (not stuck at structure COM).
  const trainW = 64;
  const trainH = 64;
  const trainN = trainW * trainH;
  function makeTrainField(fill) {
    const r = new Float32Array(trainN);
    const g = new Float32Array(trainN);
    const b = new Float32Array(trainN);
    for (let i = 0; i < trainN; i++) fill(r, g, b, i);
    return { width: trainW, height: trainH, r, g, b };
  }
  function paintTrain(field, t) {
    for (let i = 0; i < trainN; i++) {
      field.r[i] = 0.1;
      field.g[i] = 0.1;
      field.b[i] = 0.12;
    }
    const xDrift = (2 + Math.floor(t / 5) + trainW) % trainW;
    const y0 = (4 + t + trainH) % trainH;
    for (let k = 0; k < 10; k++) {
      const i = ((y0 + k * 3) % trainH) * trainW + xDrift;
      field.r[i] = 0.2;
      field.g[i] = 0.9;
      field.b[i] = 0.35;
    }
  }
  const trainFo = new FieldObserver(trainW, trainH);
  let trainPrev = makeTrainField((r, g, b) => {
    r.fill(0.1);
    g.fill(0.1);
    b.fill(0.12);
  });
  for (let t = 0; t < 40; t++) {
    const cur = makeTrainField(() => {});
    paintTrain(cur, t);
    trainFo.observe(cur, trainPrev);
    trainPrev = cur;
  }
  assert(
    "runtime train: observer reports flow",
    (trainFo.observation.flows ?? []).length > 0,
  );
  const trainSched = new GrainScheduler(GRAIN_BUDGET);
  let nowTrain = 50000;
  let trainSpawnNearTrail = 0;
  let trainSpawnTotal = 0;
  let prevAnchorY = null;
  let anchorHopSteps = 0;
  let anchorMovedDown = 0;
  let comStuckWhileHop = 0;
  for (let t = 40; t < 80; t++) {
    nowTrain += 1000 / 26;
    const cur = makeTrainField(() => {});
    paintTrain(cur, t);
    trainFo.observe(cur, trainPrev);
    trainPrev = cur;
    const obs = trainFo.observation;
    const batch = trainSched.step(obs, cur, nowTrain);
    const flow = (obs.flows ?? [])[0];
    if (!flow) continue;
    const track = batch.tracks.find((tr) => tr.regionId >= FLOW_ID_BASE);
    if (track && typeof track.velY === "number" && track.velY > 0.5) {
      if (prevAnchorY != null) {
        let dy = track.anchorY - prevAnchorY;
        if (dy > trainH * 0.5) dy -= trainH;
        if (dy < -trainH * 0.5) dy += trainH;
        anchorHopSteps += 1;
        if (dy > 0.4) anchorMovedDown += 1;
        if (Math.abs(dy) > 0.4 && Math.abs(flow.velY) > 0.7) {
          comStuckWhileHop += 1;
        }
      }
      prevAnchorY = track.anchorY;
    }
    const speed = Math.hypot(flow.velX, flow.velY);
    if (speed < 0.2) continue;
    const hx = flow.velX / speed;
    const hy = flow.velY / speed;
    let minProj = Infinity;
    let maxProj = -Infinity;
    for (const ci of flow.cells) {
      const x = ci % trainW;
      const y = (ci / trainW) | 0;
      let dx = x - flow.comX;
      if (dx > trainW * 0.5) dx -= trainW;
      if (dx < -trainW * 0.5) dx += trainW;
      let dy = y - flow.comY;
      if (dy > trainH * 0.5) dy -= trainH;
      if (dy < -trainH * 0.5) dy += trainH;
      const p = dx * hx + dy * hy;
      if (p < minProj) minProj = p;
      if (p > maxProj) maxProj = p;
    }
    const span = Math.max(1e-3, maxProj - minProj);
    for (const e of batch.events) {
      if (e.regime !== "flow") continue;
      trainSpawnTotal += 1;
      let dx = e.x - flow.comX;
      if (dx > trainW * 0.5) dx -= trainW;
      if (dx < -trainW * 0.5) dx += trainW;
      let dy = e.y - flow.comY;
      if (dy > trainH * 0.5) dy -= trainH;
      if (dy < -trainH * 0.5) dy += trainH;
      const p = dx * hx + dy * hy;
      // Trailing half of the stream (start of motion).
      if ((p - minProj) / span <= 0.55) trainSpawnNearTrail += 1;
    }
  }
  assert(
    "runtime train: flow track anchor advances with hop (+y)",
    anchorHopSteps >= 5 && anchorMovedDown / anchorHopSteps >= 0.6,
  );
  assert(
    "runtime train: hop conveyor active while flow has +y vel",
    comStuckWhileHop >= 3,
  );
  assert(
    "runtime train: spawns prefer trailing edge (start of motion)",
    trainSpawnTotal >= 3 && trainSpawnNearTrail / trainSpawnTotal >= 0.5,
  );

  // Wrapping 3×3 +y glider: heading must stay local so spawns do not jump
  // to the far seam (raw x*hx+y*hy inverts trail/lead when the pack straddles).
  function paintWrapGlider(field, t) {
    for (let i = 0; i < flowN; i++) {
      field.r[i] = 0.1;
      field.g[i] = 0.1;
      field.b[i] = 0.12;
    }
    const x0 = 48;
    const y0 = (((100 + t) % flowH) + flowH) % flowH;
    for (let oy = 0; oy < 3; oy++) {
      for (let ox = 0; ox < 3; ox++) {
        const x = (x0 + ox) % flowW;
        const y = (y0 + oy) % flowH;
        const i = y * flowW + x;
        field.r[i] = 0.95;
        field.g[i] = 0.85;
        field.b[i] = 0.2;
      }
    }
  }
  const wrapFo = new FieldObserver(flowW, flowH);
  let wrapPrev = makeFlowField((r, g, b) => {
    r.fill(0.1);
    g.fill(0.1);
    b.fill(0.12);
  });
  for (let t = 0; t < 40; t++) {
    const cur = makeFlowField(() => {});
    paintWrapGlider(cur, t);
    wrapFo.observe(cur, wrapPrev);
    wrapPrev = cur;
  }
  const wrapSched = new GrainScheduler(GRAIN_BUDGET);
  let nowWrap = 70000;
  let wrapSpawnTrail = 0;
  let wrapSpawnLead = 0;
  let wrapStraddleSteps = 0;
  for (let t = 40; t < 300; t++) {
    nowWrap += 1000 / 26;
    const cur = makeFlowField(() => {});
    paintWrapGlider(cur, t);
    wrapFo.observe(cur, wrapPrev);
    wrapPrev = cur;
    const wobs = wrapFo.observation;
    const batch = wrapSched.step(wobs, cur, nowWrap);
    const flow = (wobs.flows ?? [])[0];
    if (!flow) continue;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const ci of flow.cells) {
      const y = (ci / flowW) | 0;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (maxY - minY <= flowH * 0.5) continue;
    wrapStraddleSteps += 1;
    const speed = Math.hypot(flow.velX, flow.velY);
    if (speed < 0.2) continue;
    const hx = flow.velX / speed;
    const hy = flow.velY / speed;
    let minProj = Infinity;
    let maxProj = -Infinity;
    for (const ci of flow.cells) {
      const x = ci % flowW;
      const y = (ci / flowW) | 0;
      let dx = x - flow.comX;
      if (dx > flowW * 0.5) dx -= flowW;
      if (dx < -flowW * 0.5) dx += flowW;
      let dy = y - flow.comY;
      if (dy > flowH * 0.5) dy -= flowH;
      if (dy < -flowH * 0.5) dy += flowH;
      const p = dx * hx + dy * hy;
      if (p < minProj) minProj = p;
      if (p > maxProj) maxProj = p;
    }
    const span = Math.max(1e-3, maxProj - minProj);
    for (const e of batch.events) {
      if (e.regime !== "flow") continue;
      let dx = e.x - flow.comX;
      if (dx > flowW * 0.5) dx -= flowW;
      if (dx < -flowW * 0.5) dx += flowW;
      let dy = e.y - flow.comY;
      if (dy > flowH * 0.5) dy -= flowH;
      if (dy < -flowH * 0.5) dy += flowH;
      const p = dx * hx + dy * hy;
      if ((p - minProj) / span <= 0.55) wrapSpawnTrail += 1;
      else wrapSpawnLead += 1;
    }
  }
  assert(
    "runtime wrap-glider: pack straddles the Y seam",
    wrapStraddleSteps >= 2,
  );
  assert(
    "runtime wrap-glider: seam spawns stay on the trailing edge",
    wrapSpawnLead === 0 && wrapSpawnTrail >= 1,
  );

  // Spacing-2 hop train: Flow keeps period 2 and spends in pulses, not a flat wash.
  const hop2W = 32;
  const hop2H = 32;
  const hop2N = hop2W * hop2H;
  function makeHop2(fill) {
    const r = new Float32Array(hop2N);
    const g = new Float32Array(hop2N);
    const b = new Float32Array(hop2N);
    for (let i = 0; i < hop2N; i++) fill(r, g, b, i);
    return { width: hop2W, height: hop2H, r, g, b };
  }
  function paintHop2(field, t) {
    for (let i = 0; i < hop2N; i++) {
      field.r[i] = 0.1;
      field.g[i] = 0.1;
      field.b[i] = 0.12;
    }
    const y0 = (4 + t + hop2H) % hop2H;
    for (let k = 0; k < 10; k++) {
      const i = ((y0 + k * 2) % hop2H) * hop2W + 8;
      field.r[i] = 0.2;
      field.g[i] = 0.9;
      field.b[i] = 0.35;
    }
  }
  const hop2Fo = new FieldObserver(hop2W, hop2H);
  let hop2Prev = makeHop2((r, g, b) => {
    r.fill(0.1);
    g.fill(0.1);
    b.fill(0.12);
  });
  for (let t = 0; t < 40; t++) {
    const cur = makeHop2(() => {});
    paintHop2(cur, t);
    hop2Fo.observe(cur, hop2Prev);
    hop2Prev = cur;
  }
  assert(
    "runtime hop2: observer flow has period 2",
    (hop2Fo.observation.flows ?? []).some((f) => f.period === 2),
  );
  const hop2Sched = new GrainScheduler(GRAIN_BUDGET);
  let nowHop2 = 80000;
  let hop2BurstSteps = 0;
  let hop2Measured = 0;
  for (let t = 40; t < 80; t++) {
    nowHop2 += 1000 / 26;
    const cur = makeHop2(() => {});
    paintHop2(cur, t);
    hop2Fo.observe(cur, hop2Prev);
    hop2Prev = cur;
    const batch = hop2Sched.step(hop2Fo.observation, cur, nowHop2);
    hop2Measured += 1;
    if (batch.events.some((e) => e.regime === "flow")) hop2BurstSteps += 1;
  }
  const hop2BurstHz = hop2BurstSteps / (hop2Measured / 26);
  assert(
    "runtime hop2: flow grains pulse (not every step)",
    hop2BurstHz >= 8 && hop2BurstHz <= 20 && hop2BurstSteps < hop2Measured * 0.85,
  );

  // Many 1-cell-wide hue columns: ¼-seat floors overflow the budget.
  // floor(1 * scale) used to zero every strip (overlay full, audio empty).
  {
    const SW = 128;
    const SH = 128;
    const SN = SW * SH;
    const col = makeField(() => {});
    col.width = SW;
    col.height = SH;
    col.r = new Float32Array(SN);
    col.g = new Float32Array(SN);
    col.b = new Float32Array(SN);
    for (let i = 0; i < SN; i++) {
      const x = i % SW;
      const seed = (x * 1103515245 + 12345) >>> 0;
      const h = (seed % 1000) / 1000;
      const s = 0.95;
      const v = 0.7;
      const hi = Math.floor(h * 6);
      const f = h * 6 - hi;
      const p = v * (1 - s);
      const q = v * (1 - f * s);
      const t = v * (1 - (1 - f) * s);
      let rr = 0;
      let gg = 0;
      let bb = 0;
      switch (hi % 6) {
        case 0: rr = v; gg = t; bb = p; break;
        case 1: rr = q; gg = v; bb = p; break;
        case 2: rr = p; gg = v; bb = t; break;
        case 3: rr = p; gg = q; bb = v; break;
        case 4: rr = t; gg = p; bb = v; break;
        default: rr = v; gg = p; bb = q; break;
      }
      col.r[i] = rr;
      col.g[i] = gg;
      col.b[i] = bb;
    }
    const stripeFo = new FieldObserver(SW, SH);
    stripeFo.observe(col, col);
    for (let t = 0; t < 12; t++) stripeFo.observe(col, col);
    const stripeObs = stripeFo.observation;
    const stripeSched = new GrainScheduler(GRAIN_BUDGET);
    const stripeBatch = stripeSched.step(stripeObs, col, 90000);
    assert(
      "many calm strips are observed",
      stripeObs.coherent.length >= 80,
    );
    assert(
      "many-strip overflow still spends the calm budget",
      stripeBatch.shares.calm >= 48,
    );
    const stripeSeats = (stripeBatch.regionSeats ?? []).filter(
      (s) => s.id < 1e6 && s.share > 0,
    );
    assert(
      "many-strip overflow seats the largest columns",
      stripeSeats.length >= 48,
    );
  }

  // Dead-id / over-share calm must yield seats so a new flow share can spend.
  // Reproduces DATA 63/42 calm vs 0/19 flow: leftover DUR_MAX grains from a
  // previous occupancy sat on the budget after the field reclassified.
  {
    const solidFill = makeField((r, g, b) => {
      r.fill(0.9);
      g.fill(0.45);
      b.fill(0.1);
    });
    const stuckFo = new FieldObserver(w, h);
    stuckFo.observe(solidFill, prev);
    for (let t = 0; t < 12; t++) stuckFo.observe(solidFill, solidFill);
    const stuckSched = new GrainScheduler(GRAIN_BUDGET);
    let nowStuck = 120000;
    let filledCalm = 0;
    for (let t = 0; t < 250; t++) {
      nowStuck += 1000 / 30;
      const batch = stuckSched.step(stuckFo.observation, solidFill, nowStuck);
      filledCalm = batch.calmActive;
    }
    assert(
      "pre-switch calm occupancy is high (budget pressure)",
      filledCalm >= 20,
    );

    function paintTinyTrain(field, t) {
      for (let i = 0; i < n; i++) {
        field.r[i] = 0.1;
        field.g[i] = 0.1;
        field.b[i] = 0.12;
      }
      const xDrift = (2 + Math.floor(t / 5) + w) % w;
      const y0 = (4 + t + h) % h;
      for (let k = 0; k < 8; k++) {
        const i = ((y0 + k * 3) % h) * w + xDrift;
        field.r[i] = 0.2;
        field.g[i] = 0.9;
        field.b[i] = 0.35;
      }
    }
    const trainFo = new FieldObserver(w, h);
    let trainPrev2 = makeField((r, g, b) => {
      r.fill(0.1);
      g.fill(0.1);
      b.fill(0.12);
    });
    for (let t = 0; t < 40; t++) {
      const cur = makeField(() => {});
      paintTinyTrain(cur, t);
      trainFo.observe(cur, trainPrev2);
      trainPrev2 = cur;
    }
    let released = 0;
    let flowPeak = 0;
    let calmOverShare = false;
    let flowStarved = true;
    let overBudget = false;
    for (let t = 40; t < 80; t++) {
      nowStuck += 1000 / 30;
      const cur = makeField(() => {});
      paintTinyTrain(cur, t);
      trainFo.observe(cur, trainPrev2);
      trainPrev2 = cur;
      const batch = stuckSched.step(trainFo.observation, cur, nowStuck);
      released += batch.releaseGrainIds?.length ?? 0;
      if (batch.flowActive > flowPeak) flowPeak = batch.flowActive;
      if (batch.calmActive > batch.shares.calm + 2) calmOverShare = true;
      if (batch.shares.flow > 0 && batch.flowActive > 0) flowStarved = false;
      if (batch.predictedActive > GRAIN_BUDGET) overBudget = true;
    }
    assert("reclaim releases leftover calm grains", released > 0);
    assert(
      "flow receives seats after calm reclaim",
      !flowStarved && flowPeak > 0,
    );
    assert(
      "calm occupancy stays within share after reclaim",
      !calmOverShare,
    );
    assert("reclaim + spawn never exceeds budget prediction", !overBudget);
  }

  // Translating calm: follow hops must stay near velocity, not raw COM jumps.
  {
    const mw = 64;
    const mh = 64;
    const mn = mw * mh;
    function makeM(fill) {
      const r = new Float32Array(mn);
      const g = new Float32Array(mn);
      const b = new Float32Array(mn);
      for (let i = 0; i < mn; i++) fill(r, g, b, i);
      return { width: mw, height: mh, r, g, b };
    }
    function paintBlob(field, ox, oy, bw, bh) {
      for (let i = 0; i < mn; i++) {
        const x = i % mw;
        const y = (i / mw) | 0;
        const inB = x >= ox && x < ox + bw && y >= oy && y < oy + bh;
        if (inB) {
          field.r[i] = 0.2;
          field.g[i] = 0.55;
          field.b[i] = 0.9;
        } else {
          field.r[i] = 0.05;
          field.g[i] = 0.05;
          field.b[i] = 0.05;
        }
      }
    }
    function wrapD(to, from, period) {
      let d = to - from;
      if (d > period * 0.5) d -= period;
      if (d < -period * 0.5) d += period;
      return d;
    }
    const moveFo = new FieldObserver(mw, mh);
    const moveSched = new GrainScheduler(GRAIN_BUDGET);
    const movePrev = makeM(() => {});
    const moveCur = makeM(() => {});
    paintBlob(movePrev, 8, 20, 8, 8);
    paintBlob(moveCur, 8, 20, 8, 8);
    moveFo.observe(moveCur, movePrev);
    let nowMove = 300000;
    const walkHops = [];
    let lastAx = null;
    let lastAy = null;
    let lastId = -1;
    for (let t = 0; t < 20; t++) {
      movePrev.r.set(moveCur.r);
      movePrev.g.set(moveCur.g);
      movePrev.b.set(moveCur.b);
      paintBlob(moveCur, 8 + t, 20, 8, 8);
      const o = moveFo.observe(moveCur, movePrev);
      nowMove += 1000 / 30;
      const batch = moveSched.step(o, moveCur, nowMove);
      const calmT = batch.tracks.filter((tr) => tr.regionId < FLOW_ID_BASE);
      if (calmT.length && lastAx != null && lastId === calmT[0].regionId) {
        walkHops.push(
          Math.hypot(
            wrapD(calmT[0].anchorX, lastAx, mw),
            wrapD(calmT[0].anchorY, lastAy, mh),
          ),
        );
      }
      if (calmT.length) {
        lastAx = calmT[0].anchorX;
        lastAy = calmT[0].anchorY;
        lastId = calmT[0].regionId;
      }
    }
    const settled = walkHops.slice(4);
    const maxWalk = settled.length ? Math.max(...settled) : 99;
    assert(
      `translating calm follow hop stays near 1 cell (max ${maxWalk.toFixed(2)})`,
      settled.length >= 8 && maxWalk <= 2.5,
    );

    const preJumpAx = lastAx;
    const preJumpId = lastId;
    movePrev.r.set(moveCur.r);
    movePrev.g.set(moveCur.g);
    movePrev.b.set(moveCur.b);
    paintBlob(moveCur, 8 + 19 + 12, 20, 8, 8);
    const jumpObs = moveFo.observe(moveCur, movePrev);
    nowMove += 1000 / 30;
    const jumpBatch = moveSched.step(jumpObs, moveCur, nowMove);
    const jumpT = jumpBatch.tracks.find(
      (tr) => tr.regionId === preJumpId,
    );
    const jumpHop =
      jumpT && preJumpAx != null
        ? Math.hypot(
            wrapD(jumpT.anchorX, preJumpAx, mw),
            wrapD(jumpT.anchorY, lastAy, mh),
          )
        : 99;
    assert(
      `calm COM teleport is not one follow hop (${jumpHop.toFixed(2)} ≤ 8)`,
      jumpHop <= 8,
    );
  }
}

async function runtimeWorkletSeam() {
  let loadWorkletClass;
  let makeWhite;
  try {
    ({ loadWorkletClass, makeWhite } = await import(
      pathToFileURL(join(root, "scripts/lib/offline-worklet.mjs")).href
    ));
  } catch (err) {
    console.log(
      `  skip worklet seam (${err instanceof Error ? err.message : err})`,
    );
    return;
  }
  const FS = 48000;
  const BLOCK = 128;
  const W = 128;
  const H = 128;
  const Processor = await loadWorkletClass(FS);

  function send(proc, msg) {
    const handler = proc.port.onmessage;
    if (typeof handler === "function") handler({ data: msg });
  }
  function renderBlock(proc) {
    const L = new Float32Array(BLOCK);
    const R = new Float32Array(BLOCK);
    proc.process([], [[L, R]]);
    let maxD = 0;
    for (let i = 1; i < BLOCK; i++) {
      const d = Math.hypot(L[i] - L[i - 1], R[i] - R[i - 1]);
      if (d > maxD) maxD = d;
    }
    return { L, R, maxD };
  }
  function processBlock(proc) {
    return renderBlock(proc).maxD;
  }

  const proc = new Processor();
  const pcm = makeWhite(FS * 4, 99);
  send(proc, {
    type: "source",
    sampleRate: FS,
    length: pcm.length,
    pcmL: pcm,
    pcmR: pcm.slice(),
  });
  proc.masterGain = 1;
  proc.masterGainTarget = 1;
  proc.normGain = 1;
  proc.preScale = 1;
  send(proc, {
    type: "events",
    masterGain: 1,
    events: [
      {
        durationSec: 2,
        amplitude: 0.4,
        r: 0.9,
        g: 0.5,
        b: 0.2,
        x: 64,
        y: 125,
        yNorm: 1 - 125 / (H - 1),
        pan: 0,
        channelMix: 0.5,
        sampleCenter: 0.5,
        sampleHalf: 0.2,
        attackFrac: 0.02,
        releaseFrac: 0.1,
        q: 4,
        regime: "flow",
        regionId: 1,
        direction: 1,
      },
    ],
  });
  send(proc, {
    type: "track",
    tracks: [
      {
        regionId: 1,
        anchorX: 64,
        anchorY: 125,
        comX: 64,
        comY: 125,
        gridWidth: W,
        gridHeight: H,
      },
    ],
  });
  for (let i = 0; i < 40; i++) processBlock(proc);

  let ay = 125;
  const deltas = [];
  let yAtWrap = null;
  let yNormAtWrap = null;
  let ySatAtWrap = 0;
  for (let s = 0; s < 6; s++) {
    ay = (ay + 1) % H;
    send(proc, {
      type: "track",
      tracks: [
        {
          regionId: 1,
          anchorX: 64,
          anchorY: ay,
          comX: 64,
          comY: ay,
          gridWidth: W,
          gridHeight: H,
        },
      ],
    });
    const v = proc.voices.find((g) => g.active);
    if (ay === 0) {
      yAtWrap = v?.y;
      yNormAtWrap = v?.yNorm;
      ySatAtWrap = v?.ySaturated ?? 0;
    }
    deltas.push(processBlock(proc));
    for (let i = 1; i < 12; i++) processBlock(proc);
  }
  const wrapDelta = deltas[2];
  const preDelta = (deltas[0] + deltas[1]) / 2;
  assert(
    "worklet Y follow saturates at torus (grain stays at bottom)",
    ySatAtWrap > 0 && yAtWrap >= H - 2 && yNormAtWrap < 0.05,
  );
  assert(
    `worklet Y-seam sample Δ stays near interior (${wrapDelta.toFixed(4)} vs ${preDelta.toFixed(4)})`,
    wrapDelta <= Math.max(0.015, preDelta * 4),
  );

  const qProc = new Processor();
  send(qProc, {
    type: "source",
    sampleRate: FS,
    length: pcm.length,
    pcmL: pcm,
    pcmR: pcm.slice(),
  });
  qProc.masterGain = 1;
  qProc.masterGainTarget = 1;
  qProc.normGain = 1;
  qProc.preScale = 1;
  send(qProc, {
    type: "events",
    masterGain: 1,
    events: [
      {
        durationSec: 2,
        amplitude: 0.4,
        r: 0.9,
        g: 0.5,
        b: 0.2,
        x: 64,
        y: 64,
        yNorm: 0.5,
        pan: 0,
        channelMix: 0.5,
        sampleCenter: 0.5,
        sampleHalf: 0.2,
        attackFrac: 0.05,
        releaseFrac: 0.15,
        q: 20,
        regime: "calm",
        regionId: 1,
        direction: 1,
      },
    ],
  });
  for (let i = 0; i < 8; i++) processBlock(qProc);
  const qVoice0 = qProc.voices.find((g) => g.active);
  const qSpawn = qVoice0?.q ?? 0;
  const boundLo0 = qVoice0?.boundLo;
  send(qProc, {
    type: "track",
    tracks: [
      {
        regionId: 1,
        anchorX: 64,
        anchorY: 64,
        comX: 64,
        comY: 64,
        gridWidth: W,
        gridHeight: H,
        qExtent: 64,
      },
    ],
  });
  processBlock(qProc);
  const qVoice1 = qProc.voices.find((g) => g.active);
  assert(
    "worklet Q follows a taller mass (narrow→wide bandpass)",
    (qVoice1?.q ?? 20) < qSpawn * 0.25,
  );
  assert(
    "Q follow does not rewrite frozen sample bounds",
    qVoice1?.boundLo === boundLo0,
  );

  // Dropout then re-acquire far away must not apply the gap as one hop.
  const gapProc = new Processor();
  send(gapProc, {
    type: "source",
    sampleRate: FS,
    length: pcm.length,
    pcmL: pcm,
    pcmR: pcm.slice(),
  });
  gapProc.masterGain = 1;
  gapProc.masterGainTarget = 1;
  gapProc.normGain = 1;
  gapProc.preScale = 1;
  send(gapProc, {
    type: "events",
    masterGain: 1,
    events: [
      {
        durationSec: 2,
        amplitude: 0.4,
        r: 0.9,
        g: 0.5,
        b: 0.2,
        x: 10,
        y: 64,
        yNorm: 0.5,
        pan: (10 / (W - 1)) * 2 - 1,
        channelMix: 10 / (W - 1),
        sampleCenter: 0.5,
        sampleHalf: 0.2,
        attackFrac: 0.05,
        releaseFrac: 0.15,
        q: 4,
        regime: "flow",
        regionId: 1,
        direction: 1,
      },
    ],
    tracks: [
      {
        regionId: 1,
        anchorX: 10,
        anchorY: 64,
        comX: 10,
        comY: 64,
        gridWidth: W,
        gridHeight: H,
      },
    ],
  });
  for (let i = 0; i < 40; i++) processBlock(gapProc);
  send(gapProc, { type: "track", tracks: [] });
  for (let i = 0; i < 6; i++) processBlock(gapProc);
  const preGap = renderBlock(gapProc);
  send(gapProc, {
    type: "track",
    tracks: [
      {
        regionId: 1,
        anchorX: 90,
        anchorY: 64,
        comX: 90,
        comY: 64,
        gridWidth: W,
        gridHeight: H,
      },
    ],
  });
  const vGap = gapProc.voices.find((g) => g.active);
  const postGap = renderBlock(gapProc);
  const gapJump = Math.hypot(
    postGap.L[0] - preGap.L[BLOCK - 1],
    postGap.R[0] - preGap.R[BLOCK - 1],
  );
  let gapPre = 0;
  for (let k = BLOCK - 32; k < BLOCK; k++) {
    gapPre += Math.hypot(
      preGap.L[k] - preGap.L[k - 1],
      preGap.R[k] - preGap.R[k - 1],
    );
  }
  gapPre /= 31;
  assert(
    "dropout re-acquire does not teleport grain x",
    vGap && Math.abs(vGap.x - 10) < 1,
  );
  assert(
    `dropout re-acquire sample Δ stays small (${gapJump.toFixed(4)} vs ${gapPre.toFixed(4)})`,
    gapJump <= Math.max(0.02, gapPre * 6),
  );

  // Share-reclaim during a long calm attack must not snap env≪1 → 1.
  const relProc = new Processor();
  send(relProc, {
    type: "source",
    sampleRate: FS,
    length: pcm.length,
    pcmL: pcm,
    pcmR: pcm.slice(),
  });
  relProc.masterGain = 1;
  relProc.masterGainTarget = 1;
  relProc.normGain = 1;
  relProc.preScale = 1;
  send(relProc, {
    type: "events",
    masterGain: 1,
    events: [
      {
        grainId: 42,
        durationSec: 2,
        amplitude: 0.5,
        r: 0.8,
        g: 0.4,
        b: 0.2,
        x: 32,
        y: 64,
        yNorm: 0.5,
        pan: 0,
        channelMix: 0.5,
        sampleCenter: 0.5,
        sampleHalf: 0.2,
        attackFrac: 0.3,
        releaseFrac: 0.34,
        q: 3,
        regime: "calm",
        regionId: 7,
        direction: 1,
      },
    ],
  });
  for (let i = 0; i < 80; i++) processBlock(relProc);
  const preRel = renderBlock(relProc);
  const vRel = relProc.voices.find((g) => g.active && g.grainId === 42);
  const envBefore = vRel ? relProc.envelopeAt(vRel) : 0;
  const ampBefore = vRel?.amp ?? 0;
  const levelBefore = envBefore * ampBefore;
  send(relProc, { type: "events", masterGain: 1, events: [], releaseGrainIds: [42] });
  const vAfter = relProc.voices.find((g) => g.active && g.grainId === 42);
  const envAfter = vAfter ? relProc.envelopeAt(vAfter) : 0;
  const levelAfter = envAfter * (vAfter?.amp ?? 0);
  const postRel = renderBlock(relProc);
  const relJump = Math.hypot(
    postRel.L[0] - preRel.L[BLOCK - 1],
    postRel.R[0] - preRel.R[BLOCK - 1],
  );
  let relPre = 0;
  for (let k = BLOCK - 32; k < BLOCK; k++) {
    relPre += Math.hypot(
      preRel.L[k] - preRel.L[k - 1],
      preRel.R[k] - preRel.R[k - 1],
    );
  }
  relPre /= 31;
  assert(
    "reclaim during attack is still mid-grain (env was ≪ 1)",
    vRel && envBefore > 0.05 && envBefore < 0.85,
  );
  assert(
    `reclaim bakes envelope (level ${levelBefore.toFixed(3)} → ${levelAfter.toFixed(3)})`,
    vAfter &&
      Math.abs(levelAfter - levelBefore) <= Math.max(0.02, levelBefore * 0.08),
  );
  assert(
    `reclaim-during-attack sample Δ stays small (${relJump.toFixed(4)} vs ${relPre.toFixed(4)})`,
    relJump <= Math.max(0.02, relPre * 6),
  );
}

await runtimeScheduler();
await runtimeWorkletSeam();

if (failed) {
  console.error(`\nPhase 2–3 verify: ${failed} failure(s)`);
  process.exit(1);
}
console.log("\nPhase 2–3 verify: passed");
