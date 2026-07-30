/** Type U seed from the Utomata Lab series (parens balanced for a valid program). */
export const TYPE_U_SEED =
  "sub(add(V24.b,V24.b),mlt(V24.r,V4.b))";

export const TYPE_U_SETUP = "rand(1.0, 2.0, 3.0)";

const NEIGHBOURHOODS = [
  "V4",
  "V5",
  "V8",
  "V9",
  "V24",
  "V25",
] as const;

const CHANNELS = ["r", "g", "b"] as const;

const BINARY_OPS = ["add", "sub", "mlt", "div"] as const;

export interface TypeUTokens {
  opOuter: (typeof BINARY_OPS)[number];
  opInner: (typeof BINARY_OPS)[number];
  opRight: (typeof BINARY_OPS)[number];
  leftN: (typeof NEIGHBOURHOODS)[number];
  leftC: (typeof CHANNELS)[number];
  midN: (typeof NEIGHBOURHOODS)[number];
  midC: (typeof CHANNELS)[number];
  rightLN: (typeof NEIGHBOURHOODS)[number];
  rightLC: (typeof CHANNELS)[number];
  rightRN: (typeof NEIGHBOURHOODS)[number];
  rightRC: (typeof CHANNELS)[number];
}

/** Skeleton: opOuter(opInner(left, mid), opRight(rightL, rightR)) with channel swizzles. */
export function composeTypeU(t: TypeUTokens): string {
  const left = `${t.leftN}.${t.leftC}`;
  const mid = `${t.midN}.${t.midC}`;
  const rightL = `${t.rightLN}.${t.rightLC}`;
  const rightR = `${t.rightRN}.${t.rightRC}`;
  return `${t.opOuter}(${t.opInner}(${left},${mid}),${t.opRight}(${rightL},${rightR}))`;
}

export function parseTypeU(eq: string): TypeUTokens | null {
  const re =
    /^(add|sub|mlt|div)\((add|sub|mlt|div)\((V\d+)\.([rgb]),(V\d+)\.([rgb])\),(add|sub|mlt|div)\((V\d+)\.([rgb]),(V\d+)\.([rgb])\)\)$/;
  const m = eq.trim().match(re);
  if (!m) return null;
  const neigh = new Set<string>(NEIGHBOURHOODS);
  const ch = new Set<string>(CHANNELS);
  if (
    !neigh.has(m[3]) ||
    !neigh.has(m[5]) ||
    !neigh.has(m[8]) ||
    !neigh.has(m[10]) ||
    !ch.has(m[4]) ||
    !ch.has(m[6]) ||
    !ch.has(m[9]) ||
    !ch.has(m[11])
  ) {
    return null;
  }
  return {
    opOuter: m[1] as TypeUTokens["opOuter"],
    opInner: m[2] as TypeUTokens["opInner"],
    leftN: m[3] as TypeUTokens["leftN"],
    leftC: m[4] as TypeUTokens["leftC"],
    midN: m[5] as TypeUTokens["midN"],
    midC: m[6] as TypeUTokens["midC"],
    opRight: m[7] as TypeUTokens["opRight"],
    rightLN: m[8] as TypeUTokens["rightLN"],
    rightLC: m[9] as TypeUTokens["rightLC"],
    rightRN: m[10] as TypeUTokens["rightRN"],
    rightRC: m[11] as TypeUTokens["rightRC"],
  };
}

function pick<T>(arr: readonly T[], rnd: () => number): T {
  return arr[Math.floor(rnd() * arr.length)]!;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedTokens(): TypeUTokens {
  return {
    opOuter: "sub",
    opInner: "add",
    opRight: "mlt",
    leftN: "V24",
    leftC: "b",
    midN: "V24",
    midC: "b",
    rightLN: "V24",
    rightLC: "r",
    rightRN: "V4",
    rightRC: "b",
  };
}

export function randomVariation(seed = Date.now()): string {
  const rnd = mulberry32(seed);
  return composeTypeU({
    opOuter: pick(BINARY_OPS, rnd),
    opInner: pick(BINARY_OPS, rnd),
    opRight: pick(BINARY_OPS, rnd),
    leftN: pick(NEIGHBOURHOODS, rnd),
    leftC: pick(CHANNELS, rnd),
    midN: pick(NEIGHBOURHOODS, rnd),
    midC: pick(CHANNELS, rnd),
    rightLN: pick(NEIGHBOURHOODS, rnd),
    rightLC: pick(CHANNELS, rnd),
    rightRN: pick(NEIGHBOURHOODS, rnd),
    rightRC: pick(CHANNELS, rnd),
  });
}

/** Deterministic walk through the Type U family from an index. */
export function variationAt(index: number): string {
  const rnd = mulberry32((index * 2654435761) >>> 0);
  return randomVariation((rnd() * 1e9) | 0);
}

export function stepVariation(
  current: string,
  delta: number,
  indexRef: { value: number },
): string {
  indexRef.value = Math.max(0, indexRef.value + delta);
  const parsed = parseTypeU(current);
  if (!parsed && delta === 0) return TYPE_U_SEED;
  return variationAt(indexRef.value);
}
