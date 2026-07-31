/**
 * Phase 0 gate: lattice path must be gone from the live tree.
 */
import { existsSync, readFileSync } from "node:fs";
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

const main = readFileSync(join(root, "src/main.ts"), "utf8");
const audio = readFileSync(join(root, "src/audio/AudioEngine.ts"), "utf8");
const controls = readFileSync(join(root, "src/ui/controls.ts"), "utf8");
const worklet = readFileSync(join(root, "public/grain-processor.js"), "utf8");

assert("FieldReducer.ts removed from src", !existsSync(join(root, "src/field/FieldReducer.ts")));
assert("listenOverlay.ts removed from src", !existsSync(join(root, "src/ui/listenOverlay.ts")));
assert("main does not import FieldReducer", !/FieldReducer/.test(main));
assert("main does not import ListenOverlay", !/ListenOverlay/.test(main));
assert("main does not sendPlan", !/sendPlan/.test(main));
assert("AudioEngine has no sendPlan", !/sendPlan/.test(audio));
assert("controls has no Paint/s", !/Paint\/s/.test(controls));
assert("controls has no lattice hint", !/Sonic-state lattice/.test(controls));
assert("worklet has no paintGrain (lattice)", !/paintGrain/.test(worklet));
assert("worklet has no latticeIndex", !/latticeIndex/.test(worklet));
assert(
  "obsolete archive kept for Phase 2 mining",
  existsSync(join(root, "public/_obsolete/grain-processor-lattice.js")),
);

if (failed) {
  console.error(`\nPhase 0 verify: ${failed} failure(s)`);
  process.exit(1);
}
console.log("\nPhase 0 verify: passed");
