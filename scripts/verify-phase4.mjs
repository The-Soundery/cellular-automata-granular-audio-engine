/**
 * Phase 4 — Sonic Laws listening / contract gate (automated portion).
 * Manual listening checklist: scripts/listening-gate-sonic-laws.md
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

const brief = readFileSync(join(root, "Creative Brief v4.txt"), "utf8");
const worklet = readFileSync(join(root, "public/grain-processor.js"), "utf8");
const sched = readFileSync(join(root, "src/field/GrainScheduler.ts"), "utf8");
const main = readFileSync(join(root, "src/main.ts"), "utf8");
const gate = join(root, "scripts/listening-gate-sonic-laws.md");

assert("Sonic Laws in brief", /Sonic Laws \(authoritative\)/.test(brief));
assert("freeze-at-spawn in brief", /Freeze at spawn/.test(brief));
assert(
  "brief allows direct pan/Y region follow",
  /directly follow|Allowed to track directly/i.test(brief),
);
assert("brief has no velocity-hybrid", !/velocity-hybrid/i.test(brief));
assert(
  "brief forbids sample scrub chase",
  /sample scrub window|Sample \/ scrub window/i.test(brief),
);
assert("listening gate doc present", existsSync(gate));
const gateSrc = readFileSync(gate, "utf8");
assert(
  "listening gate allows direct pan/Y follow",
  /directly follow|pan \/ spectrum directly/i.test(gateSrc),
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
assert("lattice archive only under _obsolete", existsSync(join(root, "public/_obsolete/grain-processor-lattice.js")));
assert("live worklet is not lattice archive", !/latticeIndex/.test(worklet));

if (failed) {
  console.error(`\nPhase 4 verify: ${failed} failure(s)`);
  process.exit(1);
}
console.log("\nPhase 4 verify: passed (automated). Complete manual checklist in listening-gate-sonic-laws.md");
