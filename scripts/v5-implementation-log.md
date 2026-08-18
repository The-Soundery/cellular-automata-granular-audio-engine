# V5 implementation log — Polar Material + Stereo Identity

Started: 2026-08-11
Status: code + harness green (`npm run verify`)

## Assert replacements (signed into harness)

| Old (V4.4) | New (V5) | Why |
| --- | --- | --- |
| verify-phase4: `hueSampleLut` / `buildHueSampleLut` / `sampleCenterFromHue` | polar map / `queryMaterialFromHsv` / `setMaterialSegments` / stereo pcmL·pcmR / channelMix / absolute Y | Identity law changed; relative Y later reverted |
| verify-phase4 listening gate → `listening-gate-sonic-laws.md` | also requires `listening-gate-v5.md` (polar/stereo/absolute Y) | New ear checklist |
| investigate Gate 4(iv) hue-drift sampleCenter floor | same geometric floor; comment updated to V5 polar hue | Hue still an axis on saturated fields |
| investigate frozen-noise per-slot stasis | unchanged | Polar query deterministic for fixed RGB |
| render `loadSource` mono `pcm` | stereo `pcmL`/`pcmR` (mono duplicated) | Worklet V5 source message |
| Headless schedulers with empty identity LUT | `makeTestMaterialSegments(64)` | Without a WAV, need a spanning polar map |

## Polar axes (first cut)

- Angle: centroid rank / N
- Radius embedding: fixed `POLAR_SEGMENT_RADIUS` 0.85 (outer annulus; not stationarity)
- Band: log-energy rank
- Query: hue→angle, sat→radius, value→band; grey de-weights angle, boosts band
- Attack score: energy jump (0.65) + flux (0.35); first hop scored vs next (no zero-flux lie)
- Calm/texture: polar HSV inside the high-stationarity half + 5% file gap around real attacks
- Chaos/osc/flow: full-map polar query (no soft 0.22 bias)

## Stereo / Y

- Source keeps L/R; analysis uses mono mix
- `channelMix = x/(w-1)`; follows region with pan
- Y (current): `fc = 80 × (12000/80)^yNorm` — absolute log spectrum
- Y (V5 original, REVERTED 2026-08-14 listening): relative ±2 octaves around
  material centroid — restored absolute so vertical position is the spectrum again

## Owner ears

Checklist: `scripts/listening-gate-v5.md` (open until signed off).

## Flow — observation + grain pool (CURRENT 2026-08-17)

Doctrine: Brief. Implementation: Filter items 5 + 8. Similarity travel
(block correspondence), not pack-COM / heading-chain flood-fill.

Harness: verify-phase1 (dense/stream/diagonal/train; cascade / wavefront /
denser cascade; solids / thin-thick bars / L / ribbon / flicker ≠ flow;
flow-dots 0; twins stay two). verify-phase2 (spend + FLOW_ID_BASE + mid
duration; train grain Y tracks hop). diagnose-live-flow (calm-edge
diagonals, wavefront leading edge, dithered diagonal texture). Patterns:
`flow-dense` flow; `flow-dots` chaos; `moving-bar` calm. Ears:
`scripts/listening-gate-v5.md`.
