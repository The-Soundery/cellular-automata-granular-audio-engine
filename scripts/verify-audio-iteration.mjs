/**
 * Offline sanity checks for V2 topological sonification.
 * Run: node scripts/verify-audio-iteration.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const field = fs.readFileSync(path.join(root, "src/field/FieldMetrics.ts"), "utf8");
const spectral = fs.readFileSync(path.join(root, "src/audio/spectral.ts"), "utf8");
const worklet = fs.readFileSync(
  path.join(root, "public/grain-processor.js"),
  "utf8",
);
const engine = fs.readFileSync(
  path.join(root, "src/audio/AudioEngine.ts"),
  "utf8",
);
const observer = fs.readFileSync(
  path.join(root, "src/field/FrameObserver.ts"),
  "utf8",
);

const checks = [];

function assert(name, cond, detail = "") {
  checks.push({ name, ok: !!cond, detail });
}

// FieldMetrics — V2 layers 3–5
assert("VOICE_BUDGET=32", /VOICE_BUDGET = 32/.test(field));
assert("ENERGY_TARGET=0.26", /ENERGY_TARGET = 0\.26/.test(field));
assert("GRAIN_LEN_MIN=0.025", /GRAIN_LEN_MIN = 0\.025/.test(field));
assert("GRAIN_LEN_MAX=0.28", /GRAIN_LEN_MAX = 0\.28/.test(field));
assert("coherence-weighted length", /0\.65 \* coh \+ 0\.35 \* calm/.test(field));
assert("gridWidth on VoicePlan", /gridWidth: number/.test(field));
assert("no retriggerHz field", !/retriggerHz/.test(field));
assert("V2 Layer 5 energy comment", /V2 Layer 5/.test(field));
assert("timbral material docs", /Density — timbral material/.test(field));

// Spectral bank preserved
assert("bins=48", /SPECTRAL_BIN_COUNT = 48/.test(spectral));
assert("high=15000", /BIN_FREQ_HIGH = 15000/.test(spectral));
assert("Q=4.5", /BIN_DESIGN_Q = 4\.5/.test(spectral));

// Worklet — V2 topology + material
assert("MAX_VOICES=32", /MAX_VOICES = 32/.test(worklet));
assert("triggers=12", /MAX_TRIGGERS_PER_BLOCK = 12/.test(worklet));
assert("X sample topology", /sampleNormFromX/.test(worklet));
assert("Y spectral topology", /spectralNormFromY/.test(worklet));
assert("material weights", /buildMaterialWeights/.test(worklet));
assert("no V1 R-bin buildBinWeights", !/buildBinWeights\(r, b\)/.test(worklet));
assert("density complexity coherence", /density, complexity, coherence/.test(worklet));
assert("top is high spectrum", /1 - yClamped \/ \(h - 1\)/.test(worklet));

// Engine forwards grid size
assert("sendPlan gridWidth", /gridWidth: plan\.gridWidth/.test(engine));
assert("sendPlan gridHeight", /gridHeight: plan\.gridHeight/.test(engine));

assert(
  "FrameObserver validates before lastStep",
  /if \(imgData\.length < expected\) \{\s*return false;\s*\}\s*this\.lastStep = step/s.test(
    observer,
  ),
);

// Voice budget behaviour (mirrors FieldMetrics calm→busy curve shape)
const VOICE_BUDGET = 32;
const CALM_LISTEN_MIN = 8;
const CALM_LISTEN_MAX = 14;
function budget(activity, coherentLit = 0.5) {
  const calmListen = Math.round(
    CALM_LISTEN_MIN + coherentLit * (CALM_LISTEN_MAX - CALM_LISTEN_MIN),
  );
  return Math.max(
    calmListen,
    Math.min(
      VOICE_BUDGET,
      Math.round(calmListen + activity * (VOICE_BUDGET - calmListen)),
    ),
  );
}
assert("calm activity→floor", budget(0) <= 14, `budget=${budget(0)}`);
assert("busy activity→high", budget(0.8) >= 24, `budget=${budget(0.8)}`);
assert("max activity→32", budget(1) === 32, `budget=${budget(1)}`);

const failed = checks.filter((c) => !c.ok);
for (const c of checks) {
  console.log(
    `${c.ok ? "PASS" : "FAIL"}  ${c.name}${c.detail ? " — " + c.detail : ""}`,
  );
}
if (failed.length) {
  console.error(`\n${failed.length} check(s) failed`);
  process.exit(1);
}
console.log(`\nAll ${checks.length} checks passed`);
