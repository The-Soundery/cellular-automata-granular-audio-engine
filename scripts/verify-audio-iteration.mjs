/**
 * Offline sanity checks for the audio detail iteration.
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
const observer = fs.readFileSync(
  path.join(root, "src/field/FrameObserver.ts"),
  "utf8",
);

const checks = [];

function assert(name, cond, detail = "") {
  checks.push({ name, ok: !!cond, detail });
}

assert("VOICE_BUDGET=96", /VOICE_BUDGET = 96/.test(field));
assert("GRAIN_LEN_MIN=0.01", /GRAIN_LEN_MIN = 0\.01/.test(field));
assert("GRAIN_LEN_MAX=0.15", /GRAIN_LEN_MAX = 0\.15/.test(field));
assert("coherence weight 0.55", /0\.55 \* coh \+ 0\.45 \* calm/.test(field));
assert("no retriggerHz field", !/retriggerHz/.test(field));
assert("DENSITY_GATE raised", /DENSITY_GATE = 4e-4/.test(field));
assert("ACTIVITY_SCALE=14", /ACTIVITY_SCALE = 14/.test(field));
assert("bins=48", /SPECTRAL_BIN_COUNT = 48/.test(spectral));
assert("high=15000", /BIN_FREQ_HIGH = 15000/.test(spectral));
assert("Q=4.5", /BIN_DESIGN_Q = 4\.5/.test(spectral));
assert("MAX_VOICES=96", /MAX_VOICES = 96/.test(worklet));
assert("triggers=24", /MAX_TRIGGERS_PER_BLOCK = 24/.test(worklet));
assert("dry cap 0.2", /ratio < 0\.15 \? 0\.2/.test(worklet));
assert("spectral blur helper", /sampleSpectral/.test(worklet));
assert("BLUR_RADIUS", /BLUR_RADIUS = 3/.test(worklet));
assert(
  "FrameObserver validates before lastStep",
  /if \(imgData\.length < expected\) \{\s*return false;\s*\}\s*this\.lastStep = step/s.test(
    observer,
  ),
);

const VOICE_BUDGET = 96;
const ACTIVITY_SCALE = 14;
function budget(densAcc) {
  const activity = Math.min(1, densAcc * ACTIVITY_SCALE);
  return Math.max(
    4,
    Math.min(VOICE_BUDGET, Math.ceil(4 + activity * (VOICE_BUDGET - 4))),
  );
}
assert("calm densAcc→near floor", budget(0.01) <= 20, `budget=${budget(0.01)}`);
assert("busy densAcc→high", budget(0.05) >= 48, `budget=${budget(0.05)}`);
assert("saturated densAcc→96", budget(0.08) === 96, `budget=${budget(0.08)}`);

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
