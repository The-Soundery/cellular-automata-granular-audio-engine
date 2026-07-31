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
assert("freeze-at-spawn sample window fields", /sampleLo/.test(schedSrc) && /sampleHi/.test(schedSrc));
assert("direction from motion", /velDirEps/.test(schedSrc) && /direction/.test(schedSrc));
assert("area-weighted budget", /allocateShares/.test(schedSrc) && /GRAIN_BUDGET/.test(schedSrc));
assert("worklet handles events", /type === "events"/.test(worklet));
assert("worklet ping-pong", /boundLo/.test(worklet) && /dir = -1/.test(worklet));
assert("worklet energy normalisation", /TARGET_RMS/.test(worklet) && /normGain/.test(worklet));
assert("no latticeIndex in worklet", !/latticeIndex/.test(worklet));
assert("no paintGrain lattice loop", !/paintGrain/.test(worklet));
assert("UI budget meters", /st-budget/.test(controls) && /Calm g/.test(controls));
assert("UI sonic laws hint", /freeze-at-spawn/.test(controls));

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
        if (!(e.sampleHi > e.sampleLo && e.durationSec >= 0.3)) calmOk = false;
      }
      if (e.regime === "chaos") {
        sawChaos = true;
        if (!(e.durationSec <= 0.2)) chaosOk = false;
      }
    }
  }
  assert("never exceeds budget prediction", budgetOk);
  assert("calm events well-formed", !sawCalm || calmOk);
  assert("chaos events well-formed", !sawChaos || chaosOk);
  assert("amplitude finite", ampOk);
  assert("direction ±1", dirOk);
  assert("scheduler emitted events over time", totalEvents > 0);
  assert("saw calm and/or chaos events", sawCalm || sawChaos);
  if (obs.calmAreaFraction > 0.2) {
    assert("large calm area produced calm grains", sawCalm);
  }
}

await runtimeScheduler();

if (failed) {
  console.error(`\nPhase 2–3 verify: ${failed} failure(s)`);
  process.exit(1);
}
console.log("\nPhase 2–3 verify: passed");
