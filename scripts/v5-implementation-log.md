# V5 implementation log — Polar Material + Stereo Identity

Started: 2026-08-11
Status: code + harness green (`npm run verify`)

## Assert replacements (signed into harness)

| Old (V4.4) | New (V5) | Why |
| --- | --- | --- |
| verify-phase4: `hueSampleLut` / `buildHueSampleLut` / `sampleCenterFromHue` | polar map / `queryMaterialFromHsv` / `setMaterialSegments` / stereo pcmL·pcmR / channelMix / relative Y | Identity law changed |
| verify-phase4 listening gate → `listening-gate-sonic-laws.md` | also requires `listening-gate-v5.md` (polar/stereo/relative Y) | New ear checklist |
| investigate Gate 4(iv) hue-drift sampleCenter floor | same geometric floor; comment updated to V5 polar hue | Hue still an axis on saturated fields |
| investigate frozen-noise per-slot stasis | unchanged | Polar query deterministic for fixed RGB |
| render `loadSource` mono `pcm` | stereo `pcmL`/`pcmR` (mono duplicated) | Worklet V5 source message |
| Headless schedulers with empty identity LUT | `makeTestMaterialSegments(64)` | Without a WAV, need a spanning polar map |

## Polar axes (first cut)

- Angle: centroid rank / N
- Radius embedding: 0.7 + 0.3 × stationarity (outer annulus)
- Band: log-energy rank
- Query: hue→angle, sat→radius, value→band; grey de-weights angle, boosts band
- Regime bias: calm/texture prefer high stationarity; chaos/osc prefer low (`REGIME_STATIONARITY_BIAS = 0.22`)

## Stereo / Y

- Source keeps L/R; analysis uses mono mix
- `channelMix = x/(w-1)`; follows region with pan
- Y: `fc = centroidHz × 2^((yNorm−0.5)×Y_OCTAVE_SPAN)` clamped

## Owner ears

Checklist: `scripts/listening-gate-v5.md` (open until signed off).
