/**
 * Static contract checks for Creative Brief V3.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const reducer = readFileSync(join(root, "src/field/FieldReducer.ts"), "utf8");
const worklet = readFileSync(join(root, "public/grain-processor.js"), "utf8");
const engine = readFileSync(join(root, "src/audio/AudioEngine.ts"), "utf8");
const main = readFileSync(join(root, "src/main.ts"), "utf8");

function assert(name, cond) {
  if (!cond) {
    console.error("FAIL:", name);
    process.exitCode = 1;
  } else {
    console.log("OK:", name);
  }
}

assert("GRAIN_BUDGET=64", /GRAIN_BUDGET = 64/.test(reducer));
assert("equal share 1/n", /amp = 1 \/ n/.test(reducer) || /1 \/ n/.test(reducer));
assert("no StructureTracker import", !/StructureTracker/.test(main));
assert("no FieldMetrics import", !/FieldMetrics/.test(main));
assert("uses FieldReducer", /FieldReducer/.test(main));
assert("worklet colour envelope only comment", /envelope material ONLY/i.test(worklet));
assert("worklet no structureId ownership", !/structureId/.test(worklet));
assert("worklet latticeIndex", /latticeIndex/.test(worklet));
assert("AudioEngine sends grains", /grains:/.test(engine));
assert("spectral Y-only in worklet", /buildSpectralWeights\(yNorm\)/.test(worklet));

if (process.exitCode) {
  console.error("verify-v3-contract FAILED");
  process.exit(1);
}
console.log("verify-v3-contract OK");
