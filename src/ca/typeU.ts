/** Lab Type-U (1st). Each cell copies a neighbour; this tree is one operator per axis. */
export const TYPE_U_SEED = "U(add(V.b,V8.b),sub(V4.b,V8.b))";

export const TYPE_U_SETUP = "rand(1.0, 2.0, 3.0)";

export const TYPE_U_SEEDS: Record<TypeUDepth, string> = {
  1: TYPE_U_SEED,
  2: "U(sub(add(V24.b,V24.b),mlt(V24.r,V4.b)),div(sub(V8.r,V24.g),add(V8.r,V8.r)))",
  3: "U(sub(div(div(V.r,V4.g),div(V8.g,V4.g)),div(add(V8.g,V8.r),add(V4.r,V8.r))),add(div(mlt(V4.r,V.b),sub(V24.r,V4.r)),div(mlt(V8.g,V8.r),sub(V24.b,V8.b))))",
};

export const TYPE_U_DEPTHS = [1, 2, 3] as const;
export type TypeUDepth = (typeof TYPE_U_DEPTHS)[number];

export const OPS = ["add", "sub", "mlt", "div"] as const;
export const COLOURS = ["r", "g", "b"] as const;
export const NEIGH_SHALLOW = ["V", "V4", "V8"] as const;
export const NEIGH_DEEP = ["V", "V4", "V8", "V24"] as const;

export type SlotKind = "F" | "Q" | "C";

export interface EqToken {
  text: string
  /** Index into `program.slots` when this token is a swappable part. */
  slot?: number
  kind?: SlotKind
}

export interface TypeUProgram {
  depth: TypeUDepth
  slots: number[]
  equation: string
  tokens: EqToken[]
  x: number
  y: number
}

const DEPTH_LABEL: Record<TypeUDepth, string> = {
  1: "1st",
  2: "2nd",
  3: "3rd",
};

export function depthLabel(depth: TypeUDepth): string {
  return DEPTH_LABEL[depth];
}

export function neighbourhoods(depth: TypeUDepth): readonly string[] {
  return depth === 1 ? NEIGH_SHALLOW : NEIGH_DEEP;
}

export function domainSize(kind: SlotKind, depth: TypeUDepth): number {
  if (kind === "F") return OPS.length;
  if (kind === "C") return COLOURS.length;
  return neighbourhoods(depth).length;
}

export function domainOf(kind: SlotKind, depth: TypeUDepth): readonly string[] {
  if (kind === "F") return OPS;
  if (kind === "C") return COLOURS;
  return neighbourhoods(depth);
}

export function slotKinds(depth: TypeUDepth): SlotKind[] {
  const kinds: SlotKind[] = [];
  const expr = (order: number) => {
    if (order === 0) {
      kinds.push("Q", "C");
      return;
    }
    kinds.push("F");
    expr(order - 1);
    expr(order - 1);
  };
  expr(depth);
  expr(depth);
  return kinds;
}

function slotBases(depth: TypeUDepth): number[] {
  return slotKinds(depth).map((k) => domainSize(k, depth));
}

function mixedToDec(digits: number[], bases: number[]): number {
  let n = 0;
  let power = 1;
  for (let i = digits.length - 1; i >= 0; i--) {
    n += digits[i]! * power;
    power *= bases[i]!;
  }
  return n;
}

function decToMixed(n: number, bases: number[]): number[] {
  const digits = new Array<number>(bases.length);
  let rest = n;
  for (let i = bases.length - 1; i >= 0; i--) {
    const b = bases[i]!;
    digits[i] = rest % b;
    rest = Math.floor(rest / b);
  }
  return digits;
}

export function axisSize(depth: TypeUDepth): { w: number; h: number } {
  const bases = slotBases(depth);
  const mid = bases.length / 2;
  const prod = (xs: number[]) => xs.reduce((a, b) => a * b, 1);
  return { w: prod(bases.slice(0, mid)), h: prod(bases.slice(mid)) };
}

function wrapAxis(n: number, size: number): number {
  return ((n % size) + size) % size;
}

export function programAt(
  depth: TypeUDepth,
  x: number,
  y: number,
): TypeUProgram {
  const bases = slotBases(depth);
  const { w, h } = axisSize(depth);
  const mid = bases.length / 2;
  const left = decToMixed(wrapAxis(x, w), bases.slice(0, mid));
  const right = decToMixed(wrapAxis(y, h), bases.slice(mid));
  return composeTypeU(depth, [...left, ...right]);
}

/** Compass order: N, NE, E, SE, S, SW, W, NW. */
export const NEIGHBOR_DIRS = [
  { dx: 0, dy: -1 },
  { dx: 1, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 1, dy: 1 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 1 },
  { dx: -1, dy: 0 },
  { dx: -1, dy: -1 },
] as const;

export function neighborPrograms(program: TypeUProgram): TypeUProgram[] {
  return NEIGHBOR_DIRS.map(({ dx, dy }) =>
    programAt(program.depth, program.x + dx, program.y + dy),
  );
}

function slotsToXY(slots: number[], depth: TypeUDepth): { x: number; y: number } {
  const bases = slotBases(depth);
  const mid = slots.length / 2;
  return {
    x: mixedToDec(slots.slice(0, mid), bases.slice(0, mid)),
    y: mixedToDec(slots.slice(mid), bases.slice(mid)),
  };
}

export function composeTypeU(
  depth: TypeUDepth,
  slotIndices: readonly number[],
): TypeUProgram {
  const kinds = slotKinds(depth);
  if (slotIndices.length !== kinds.length) {
    throw new Error(
      `Type-U depth ${depth} needs ${kinds.length} slots, got ${slotIndices.length}`,
    );
  }
  const slots = kinds.map((kind, i) => {
    const size = domainSize(kind, depth);
    const raw = slotIndices[i] ?? 0;
    return ((raw % size) + size) % size;
  });

  const tokens: EqToken[] = [];
  let cursor = 0;
  const take = (kind: SlotKind): string => {
    const domain = domainOf(kind, depth);
    const idx = slots[cursor]!;
    const text = domain[idx]!;
    tokens.push({ text, slot: cursor, kind });
    cursor += 1;
    return text;
  };
  const punct = (text: string) => {
    tokens.push({ text });
  };

  const expr = (order: number): string => {
    if (order === 0) {
      const q = take("Q");
      punct(".");
      const c = take("C");
      return `${q}.${c}`;
    }
    const op = take("F");
    punct("(");
    const left = expr(order - 1);
    punct(",");
    const right = expr(order - 1);
    punct(")");
    return `${op}(${left},${right})`;
  };

  punct("U");
  punct("(");
  const left = expr(depth);
  punct(",");
  const right = expr(depth);
  punct(")");

  const equation = `U(${left},${right})`;
  const { x, y } = slotsToXY(slots, depth);
  return { depth, slots, equation, tokens, x, y };
}

function parseAtDepth(raw: string, depth: TypeUDepth): TypeUProgram | null {
  let i = 0;
  const slots: number[] = [];
  const neigh = neighbourhoods(depth);
  const neighLongest = [...neigh].sort((a, b) => b.length - a.length);

  const eat = (s: string): boolean => {
    if (!raw.startsWith(s, i)) return false;
    i += s.length;
    return true;
  };

  const parseLeaf = (): boolean => {
    let q: string | null = null;
    for (const n of neighLongest) {
      if (raw.startsWith(n, i)) {
        q = n;
        i += n.length;
        break;
      }
    }
    if (!q) return false;
    if (!eat(".")) return false;
    const c = raw[i];
    if (c !== "r" && c !== "g" && c !== "b") return false;
    i += 1;
    slots.push(neigh.indexOf(q));
    slots.push(COLOURS.indexOf(c));
    return true;
  };

  const parseExpr = (order: number): boolean => {
    if (order === 0) return parseLeaf();
    let op: (typeof OPS)[number] | null = null;
    for (const o of OPS) {
      if (raw.startsWith(o, i)) {
        op = o;
        i += o.length;
        break;
      }
    }
    if (!op) return false;
    slots.push(OPS.indexOf(op));
    if (!eat("(")) return false;
    if (!parseExpr(order - 1)) return false;
    if (!eat(",")) return false;
    if (!parseExpr(order - 1)) return false;
    if (!eat(")")) return false;
    return true;
  };

  if (!eat("U(")) return null;
  if (!parseExpr(depth)) return null;
  if (!eat(",")) return null;
  if (!parseExpr(depth)) return null;
  if (!eat(")")) return null;
  if (i !== raw.length) return null;
  return composeTypeU(depth, slots);
}

export function parseTypeU(eq: string): TypeUProgram | null {
  const raw = eq.replace(/\s+/g, "");
  if (!raw) return null;
  for (const depth of TYPE_U_DEPTHS) {
    const parsed = parseAtDepth(raw, depth);
    if (parsed) return parsed;
  }
  return null;
}

export function seedProgram(depth: TypeUDepth): TypeUProgram {
  const parsed = parseTypeU(TYPE_U_SEEDS[depth]);
  if (!parsed || parsed.depth !== depth) {
    throw new Error(`Type-U seed for depth ${depth} failed to parse`);
  }
  return parsed;
}

export function randomProgram(
  depth: TypeUDepth,
  rnd: () => number = Math.random,
): TypeUProgram {
  const kinds = slotKinds(depth);
  const slots = kinds.map((kind) => Math.floor(rnd() * domainSize(kind, depth)));
  return composeTypeU(depth, slots);
}

export function cycleSlot(
  program: TypeUProgram,
  slotIndex: number,
  dir: number,
): TypeUProgram {
  const kinds = slotKinds(program.depth);
  const kind = kinds[slotIndex];
  if (!kind) return program;
  const size = domainSize(kind, program.depth);
  const slots = program.slots.slice();
  const step = dir < 0 ? -1 : 1;
  slots[slotIndex] = (slots[slotIndex]! + step + size) % size;
  return composeTypeU(program.depth, slots);
}

export function formatCoord(program: TypeUProgram): string {
  return `${depthLabel(program.depth)} · x ${program.x.toLocaleString("en-US")} · y ${program.y.toLocaleString("en-US")}`;
}

export function formatHud(program: TypeUProgram): string {
  return `${depthLabel(program.depth).toUpperCase()}  ·  X ${program.x}  ·  Y ${program.y}`;
}
