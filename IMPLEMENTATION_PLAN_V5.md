# IMPLEMENTATION_PLAN_V5 — Polar Material + Stereo Identity

Status: CODE COMPLETE — harness green 2026-08-11; owner ears open (`listening-gate-v5.md`)
North star: Creative Brief v4.txt (V5 addendum)
Entry: Implementation Filter.txt

Supersedes V4.4 colour→sample identity (1D centroid hue LUT, mono bank,
absolute Y bandpass). Keeps ephemeral grains, area share, freeze-at-spawn
window, stratified calm/texture sites.

## Settled decisions

1. HSV → **2D polar descriptor plane** (hue angle, sat radius, value band).
2. Stereo source retained; **X → L/R channel mix** + pan; mix **follows** region.
3. **Y** = relative bandpass offset around chosen segment centroid.
4. Regime soft-bias: calm/texture → sustained; chaos/osc → transient.
5. Prev/Next/Random equation greyscale fix is out of scope.

## Polar axes (first cut, measured on default-source)

| Axis | Segment embedding | HSV query |
| --- | --- | --- |
| Angle | Centroid rank → [0,1) around circle | Hue |
| Radius | Stationarity ∈ [0,1] (1 − normalised spectral flux) | Saturation (grey → centre) |
| Band | Log-energy rank ∈ [0,1] | Value (brightness) |

Query: nearest segment in polar space with soft stationarity preference by
regime. Saturation still sets window half-width (seconds). Sample window
frozen at spawn; channel mix + pan + Y follow for region-bound grains.

## Phases

0. Doctrine (Brief / Filter / this file)
1. Stereo bank + worklet L/R + channelMix follow
2. Full-coverage analysis + polar query API
3. Scheduler HSV / regime / relative Y / channelMix
4. Harness: replace obsolete asserts (see v5 log)
5. Listening checklist

## Verify

`npm run build && npm run verify`

## STOP (unchanged)

No mid-grain sample-window chase. No colour→loudness. No 48-bin bank.
Stratified sites calm/texture only. CHAOS_EVENTS_MAX_HZ is CPU rail only.
