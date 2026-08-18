/**
 * Oscillator vs flow classification probe (not part of CI).
 * Run: node --experimental-strip-types scripts/diagnose-osc.mjs
 */
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { FieldObserver, FIELD_OBS, rgbDelta } = await import(
  pathToFileURL(join(root, "src/field/FieldObserver.ts")).href
);

const W = 64;
const H = 64;
const N = W * H;
const BG = [0.12, 0.12, 0.14];
const A = [0.9, 0.25, 0.2];
const B = [0.2, 0.3, 0.9];
const C = [0.2, 0.85, 0.35];
const D = [0.85, 0.8, 0.15];

function hsv2rgb(h, s, v) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0:
      return [v, t, p];
    case 1:
      return [q, v, p];
    case 2:
      return [p, v, t];
    case 3:
      return [p, q, v];
    case 4:
      return [t, p, v];
    default:
      return [v, p, q];
  }
}

function blank() {
  const f = {
    width: W,
    height: H,
    r: new Float32Array(N),
    g: new Float32Array(N),
    b: new Float32Array(N),
  };
  for (let i = 0; i < N; i++) {
    f.r[i] = BG[0];
    f.g[i] = BG[1];
    f.b[i] = BG[2];
  }
  return f;
}

function fillBlock(f, x0, y0, bw, bh, rgb) {
  for (let y = y0; y < y0 + bh; y++) {
    for (let x = x0; x < x0 + bw; x++) {
      const i = ((y + H) % H) * W + ((x + W) % W);
      f.r[i] = rgb[0];
      f.g[i] = rgb[1];
      f.b[i] = rgb[2];
    }
  }
}

function paint(f, x, y, rgb) {
  const i = ((y + H) % H) * W + ((x + W) % W);
  f.r[i] = rgb[0];
  f.g[i] = rgb[1];
  f.b[i] = rgb[2];
}

function summarise(obs) {
  const o = obs.observation;
  const osc = (o.oscillators ?? []).map((g) => ({
    period: g.period,
    area: g.area,
  }));
  const oscArea = osc.reduce((s, g) => s + g.area, 0);
  const flowArea = (o.flows ?? []).reduce((s, f) => s + f.area, 0);
  const flowPatch = (o.flows ?? []).reduce((s, f) => s + f.regionArea, 0);
  return {
    osc,
    oscArea,
    flowN: (o.flows ?? []).length,
    flowArea,
    flowPatch,
    calm: (o.calmAreaFraction * N).toFixed(0),
    chaos: o.chaotic.area,
    texture: o.textured?.area ?? 0,
  };
}

function run(name, frames, make, note) {
  const observer = new FieldObserver(W, H);
  let prev = blank();
  let firstConfirm = -1;
  let last = null;
  for (let t = 0; t < frames; t++) {
    const cur = make(t, blank());
    observer.observe(cur, prev);
    prev = cur;
    last = summarise(observer);
    if (firstConfirm < 0 && last.oscArea > 0) firstConfirm = t;
  }
  const s = last;
  const oscStr =
    s.osc.length === 0
      ? "none"
      : s.osc.map((g) => `p${g.period}×${g.area}`).join(", ");
  console.log(
    `${name.padEnd(28)} osc=[${oscStr}]  flow=${s.flowArea}/${s.flowPatch} (n=${s.flowN})  ` +
      `calm=${s.calm} chaos=${s.chaos} tex=${s.texture}  confirm@${firstConfirm}`,
  );
  if (note) console.log(`${"".padEnd(28)} ${note}`);
  return s;
}

console.log("FIELD_OBS osc/flow floors:");
console.log(
  `  oscPeriodMax=${FIELD_OBS.oscPeriodMax} oscMatchEps=${FIELD_OBS.oscMatchEps} ` +
    `oscDeltaMin=${FIELD_OBS.oscDeltaMin} oscConfirmCycles=${FIELD_OBS.oscConfirmCycles}`,
);
console.log(
  `  chaosDeltaMin=${FIELD_OBS.chaosDeltaMin} flowDeltaMin=${FIELD_OBS.flowDeltaMin} ` +
    `flowMinSpeed=${FIELD_OBS.flowMinSpeed} flowEmergingOscFrac=${FIELD_OBS.flowEmergingOscFrac}`,
);
console.log(
  `  rgbDelta(A,B)=${rgbDelta(...A, ...B).toFixed(3)}  ` +
    `need streak ≥ ${FIELD_OBS.oscConfirmCycles}×period`,
);
console.log("");

const x0 = 16;
const y0 = 16;
const bw = 16;
const bh = 16;

run("p2 flip (current blinker)", 40, (t, f) => {
  fillBlock(f, x0, y0, bw, bh, t % 2 === 0 ? A : B);
  return f;
});

run("p6 unique hues (blinker-slow)", 40, (t, f) => {
  fillBlock(f, x0, y0, bw, bh, hsv2rgb((t % 6) / 6, 0.85, 0.9));
  return f;
});

run("p3 unique ABC (change every step)", 40, (t, f) => {
  const pal = [A, B, C];
  fillBlock(f, x0, y0, bw, bh, pal[t % 3]);
  return f;
});

run("p3 plateau AAB (hold frames)", 48, (t, f) => {
  const pal = [A, A, B];
  fillBlock(f, x0, y0, bw, bh, pal[t % 3]);
  return f;
}, "expect miss/misclass: static-cell guard + shortest-p prefers 2");

run("p4 plateau AABB", 48, (t, f) => {
  const pal = [A, A, B, B];
  fillBlock(f, x0, y0, bw, bh, pal[t % 4]);
  return f;
}, "hold frames; t-2 often matches A/A so looks like period 2");

run("p4 unique ABCD", 40, (t, f) => {
  const pal = [A, B, C, D];
  fillBlock(f, x0, y0, bw, bh, pal[t % 4]);
  return f;
});

run("p8 unique hues", 48, (t, f) => {
  fillBlock(f, x0, y0, bw, bh, hsv2rgb((t % 8) / 8, 0.85, 0.9));
  return f;
}, `confirm needs ${FIELD_OBS.oscConfirmCycles * 8} matching change frames`);

run("p2 subtle Δ=0.05", 40, (t, f) => {
  const on = t % 2 === 0;
  fillBlock(f, x0, y0, bw, bh, on ? [0.5, 0.5, 0.5] : [0.53, 0.48, 0.5]);
  return f;
}, `rgbΔ=${rgbDelta(0.5, 0.5, 0.5, 0.53, 0.48, 0.5).toFixed(3)} vs oscMatchEps=${FIELD_OBS.oscMatchEps} oscDeltaMin=${FIELD_OBS.oscDeltaMin}`);

run("p2 modest Δ=0.10", 40, (t, f) => {
  const on = t % 2 === 0;
  fillBlock(f, x0, y0, bw, bh, on ? [0.55, 0.2, 0.2] : [0.45, 0.22, 0.22]);
  return f;
}, `rgbΔ=${rgbDelta(0.55, 0.2, 0.2, 0.45, 0.22, 0.22).toFixed(3)}`);

run("p2 just-above-eps Δ=0.07", 40, (t, f) => {
  const on = t % 2 === 0;
  fillBlock(f, x0, y0, bw, bh, on ? [0.5, 0.2, 0.2] : [0.44, 0.22, 0.2]);
  return f;
}, `rgbΔ=${rgbDelta(0.5, 0.2, 0.2, 0.44, 0.22, 0.2).toFixed(3)}`);

run("translating solid 8x8", 40, (t, f) => {
  fillBlock(f, (8 + t) % W, 20, 8, 8, A);
  return f;
}, "sliding stamp — should be calm, not osc or flow");

run("dashed +x stream (flow-dense)", 40, (t, f) => {
  for (let iy = 0; iy < 5; iy++) {
    for (let ix = 0; ix < 5; ix++) {
      paint(f, (10 + t + ix * 3) % W, 24 + iy * 3, A);
    }
  }
  return f;
}, "site-revisit looks period-2 at a cell; flow should win");

run("traveling p2 block +1x/step", 48, (t, f) => {
  fillBlock(f, (8 + t) % W, 20, 12, 12, t % 2 === 0 ? A : B);
  return f;
}, "occupancy travels — stripped from osc (stamp → chaos, not flow)");

run("gol-style blinker 1x3", 40, (t, f) => {
  const cx = 32;
  const cy = 32;
  if (t % 2 === 0) {
    paint(f, cx - 1, cy, A);
    paint(f, cx, cy, A);
    paint(f, cx + 1, cy, A);
  } else {
    paint(f, cx, cy - 1, A);
    paint(f, cx, cy, A);
    paint(f, cx, cy + 1, A);
  }
  return f;
}, "only the centre cell is on every step; ends swap");

run("rotating dipole (swap 2 cells)", 40, (t, f) => {
  if (t % 2 === 0) {
    paint(f, 30, 30, A);
    paint(f, 31, 30, B);
  } else {
    paint(f, 30, 30, B);
    paint(f, 31, 30, A);
  }
  return f;
}, "sits still as a pair; each cell is a p2 blinker");

run("wave train period 4", 48, (t, f) => {
  for (let x = 0; x < W; x++) {
    const phase = ((x - t) % 4 + 4) % 4;
    const pal = [A, B, C, D];
    for (let y = 20; y < 28; y++) paint(f, x, y, pal[phase]);
  }
  return f;
}, "colour hop has a heading — stripped from osc");

run("pulse-calm p30 (out of osc range)", 60, (t, f) => {
  const v = t % 30 < 2 ? 0.7 : 0.5;
  const rgb = hsv2rgb(0.58, 0.75, v);
  for (let i = 0; i < N; i++) {
    f.r[i] = rgb[0];
    f.g[i] = rgb[1];
    f.b[i] = rgb[2];
  }
  return f;
}, "period 30 > oscPeriodMax 8 — OSC% = 0 by design");

run("breathing p90 whole field", 50, (t, f) => {
  const v = 0.55 + 0.15 * Math.sin((2 * Math.PI * t) / 90);
  const rgb = hsv2rgb(0.55, 0.7, v);
  for (let i = 0; i < N; i++) {
    f.r[i] = rgb[0];
    f.g[i] = rgb[1];
    f.b[i] = rgb[2];
  }
  return f;
});

run("glider 3x3 blocks", 40, (t, f) => {
  const starts = [
    [8, 8],
    [40, 12],
    [16, 40],
  ];
  const dirs = [
    [1, 1],
    [1, -1],
    [-1, 1],
  ];
  for (let g = 0; g < starts.length; g++) {
    const x0g = (starts[g][0] + t * dirs[g][0] + W) % W;
    const y0g = (starts[g][1] + t * dirs[g][1] + H) % H;
    fillBlock(f, x0g, y0g, 3, 3, [0.95, 0.85, 0.2]);
  }
  return f;
});

console.log("\nOverlap: traveling p2 block — cell in BOTH osc and flow?");
{
  const observer = new FieldObserver(W, H);
  let prev = blank();
  for (let t = 0; t < 48; t++) {
    const cur = blank();
    fillBlock(cur, (8 + t) % W, 20, 12, 12, t % 2 === 0 ? A : B);
    observer.observe(cur, prev);
    prev = cur;
  }
  const o = observer.observation;
  const oscSet = new Set();
  for (const g of o.oscillators ?? []) {
    for (const i of g.cells) oscSet.add(i);
  }
  let both = 0;
  for (const f of o.flows ?? []) {
    for (const i of f.cells) if (oscSet.has(i)) both += 1;
  }
  console.log(
    `  osc cells=${oscSet.size} flow cells=${(o.flows ?? []).reduce((s, f) => s + f.area, 0)} overlap=${both}`,
  );
}
