/**
 * Offline sanity checks for V2 structure-centric architecture.
 * Run: node scripts/verify-audio-iteration.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const field = fs.readFileSync(path.join(root, "src/field/FieldMetrics.ts"), "utf8");
const allocator = fs.readFileSync(
  path.join(root, "src/field/StructureAllocator.ts"),
  "utf8",
);
const extractor = fs.readFileSync(
  path.join(root, "src/field/RegionExtractor.ts"),
  "utf8",
);
const tracker = fs.readFileSync(
  path.join(root, "src/field/StructureTracker.ts"),
  "utf8",
);
const spectral = fs.readFileSync(path.join(root, "src/audio/spectral.ts"), "utf8");
const worklet = fs.readFileSync(
  path.join(root, "public/grain-processor.js"),
  "utf8",
);
const engine = fs.readFileSync(
  path.join(root, "src/audio/AudioEngine.ts"),
  "utf8",
);
const brief = fs.readFileSync(path.join(root, "Creative Brief v2.txt"), "utf8");

const checks = [];
function assert(name, cond, detail = "") {
  checks.push({ name, ok: !!cond, detail });
}

assert("RegionExtractor exists", /extractRegions/.test(extractor));
assert("toroidal circular mean", /circularMean/.test(extractor));
assert("StructureTracker persistent ids", /nextId/.test(tracker));
assert("StructureAllocator probe mass", /stableProbeCount|probeCountFor/.test(allocator));
assert("VOICE_BUDGET=32", /VOICE_BUDGET = 32/.test(allocator));
assert("no sustainFrac wash bias", !/sustainFrac/.test(allocator));
assert("structureId on voices", /structureId: number/.test(allocator));
assert("colourCoherence envelope only", /colourCoherence/.test(allocator));
assert("FieldMetrics is orchestrator", /StructureTracker/.test(field));
assert("bins=48", /SPECTRAL_BIN_COUNT = 48/.test(spectral));
assert("Y-only spectral comment", /colour never enters/i.test(spectral));

assert("identity remap", /voiceKey/.test(worklet));
assert("Y-only buildSpectralWeights", /buildSpectralWeights\(yNorm\)/.test(worklet));
assert("no RGB material weights", !/buildMaterialWeights/.test(worklet));
assert("region envelope", /getRegionEnvelope/.test(worklet));
assert("motion refresh", /MOTION_REFRESH_CELLS/.test(worklet));
assert("seam crossfade", /SEAM_CROSSFADE_SEC/.test(worklet));
assert("sendPlan structureId", /structureId: v\.structureId/.test(engine));
assert("brief structures axiom", /fundamental musical objects/i.test(brief));
assert("brief colour envelope only", /temporal material properties/i.test(brief));
assert("brief forbids spectral colour", /must NOT affect/i.test(brief));
assert("brief toroidal", /toroidal/i.test(brief));

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
