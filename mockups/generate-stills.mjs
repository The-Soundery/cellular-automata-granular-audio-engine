/**
 * Writes 9 pixelated 128×128 PNG stills for UI mockups.
 * Mix of Type-U-ish colour noise and structured fields — not the live engine.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const W = 128;
const H = 128;
const DIR = join(dirname(fileURLToPath(import.meta.url)), "stills");

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function writePng(path, rgb) {
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0;
    rgb.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  writeFileSync(path, png);
}

function hsv(h, s, v) {
  h = ((h % 1) + 1) % 1;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const tbl = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ];
  const [r, g, b] = tbl[i % 6];
  return [(r * 255) | 0, (g * 255) | 0, (b * 255) | 0];
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function paint(fn) {
  const rgb = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [r, g, b] = fn(x, y);
      const i = (y * W + x) * 3;
      rgb[i] = r;
      rgb[i + 1] = g;
      rgb[i + 2] = b;
    }
  }
  return rgb;
}

const fields = [
  // 0 centre — noisy high-chroma field (hero)
  () => {
    const rnd = mulberry(7);
    return paint((x, y) => {
      const n = Math.sin(x * 0.17) * Math.cos(y * 0.13) + rnd() * 0.4;
      return hsv((x * 0.01 + y * 0.007 + n) % 1, 0.85, 0.55 + rnd() * 0.45);
    });
  },
  // 1 calm-ish block
  () =>
    paint((x, y) => {
      const cx = x - 40;
      const cy = y - 50;
      const inBlk = cx > 0 && cx < 55 && cy > 0 && cy < 40;
      if (inBlk) return hsv(0.08, 0.7, 0.9);
      return hsv(0.62, 0.35, 0.18 + ((x + y) & 3) * 0.04);
    }),
  // 2 stripes / flow
  () =>
    paint((x, y) => {
      const t = (x + y * 0.3) % 18;
      return hsv(0.33 + t * 0.01, 0.8, t < 9 ? 0.85 : 0.25);
    }),
  // 3 oscillator checker
  () =>
    paint((x, y) => {
      const on = ((x >> 2) + (y >> 2)) & 1;
      return on ? hsv(0.78, 0.7, 0.95) : hsv(0.12, 0.8, 0.9);
    }),
  // 4 sparse dots
  () => {
    const rnd = mulberry(99);
    return paint((x, y) => {
      if (rnd() > 0.97) return hsv(rnd(), 0.9, 1);
      return hsv(0.55, 0.2, 0.08);
    });
  },
  // 5 wavefront
  () =>
    paint((x, y) => {
      const d = Math.hypot(x - 64, y - 64);
      const ring = Math.abs((d % 14) - 7) < 1.6;
      return ring ? hsv(0.92, 0.85, 1) : hsv(0.6, 0.4, 0.12);
    }),
  // 6 greyscale (honest Type-U neighbour)
  () => {
    const rnd = mulberry(3);
    return paint(() => {
      const v = (40 + rnd() * 180) | 0;
      return [v, v, v];
    });
  },
  // 7 hue bands
  () =>
    paint((x) => hsv((Math.floor(x / 16) / 8 + 0.05) % 1, 0.75, 0.7)),
  // 8 grainy fire
  () => {
    const rnd = mulberry(21);
    return paint((x, y) => {
      const heat = 1 - y / H + rnd() * 0.2;
      return hsv(0.06 * heat, 0.9, Math.min(1, heat));
    });
  },
];

mkdirSync(DIR, { recursive: true });
fields.forEach((make, i) => {
  const name = `tile-${i}.png`;
  writePng(join(DIR, name), make());
  console.log("wrote", name);
});
