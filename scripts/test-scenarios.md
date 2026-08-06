# Test Scenarios — V4.3 Harness

Shared synthetic patterns live in `src/field/TestPatterns.ts`.

**Agent note:** these patterns often *saturate* δ. Passing rates/balance here
does **not** prove chaos is balanced on real Utomata (see Implementation
Filter → OPEN ISSUES → `deltaRateNorm` / `t = δ̄/0.35`).

## Two harnesses

1. **Event harness** — `node scripts/investigate-scenarios.mjs --stage N`  
   FieldObserver + GrainScheduler: shares, rates, sampleCenter, eventFlux (Y/Q).
2. **Audio harness** — `node scripts/render-scenarios.mjs --stage N`  
   Offline worklet: primary RMS = √mean(L²+R²); mono reported secondary;
   crest, sites, block-RMS, cold-start. Audio Welch-mel flux reported only.

In-app: Sim select. Grid 128×128 @ 30 steps/s. Default measure: last 7 s of 14 s
(frozen-noise longer for per-slot sampleCenter; breathing-uniform 13 s).

Verify: `npm run verify` runs investigate `--stage 9` and render `--stage 7`.

---

## uniform-static

- **Simulates:** One solid colour, never changes.
- **Ground truth:** 100% calm; zero temporal δ.
- **Observer:** calm% ≈ 100; chaos% ≈ 0; one region.
- **Audio:** calm wash at area share (~64 concurrent), long grains (DUR_MAX),
  centred pan/yNorm, low spectral flux; mean Q high (focused).
- **Assertions:** investigate stage 1/7 (calm%, sampleCenter frozen); render
  stage 2–4 (loudness, dispersion ≤0.35/0.30, sites ≤70, flux ×2 ≤ flicker).

## hue-drift

- **Simulates:** Uniform field, hue rotates slowly (~55 s full cycle).
- **Ground truth:** Still one calm mass; tiny continuous δ; not rhythmic.
- **Observer:** calm% ≈ 100.
- **Audio:** calm packing; sampleCenter drifts with hue; flux near static
  (hue cannot move a flat source's spectrum).
- **Assertions:** investigate stage 4(iv) sampleCenter spread ≥½·0.0006·30·window;
  stage 6 pulse-burst ≤1; render flux ×2 ≤ flicker.

## frozen-noise

- **Simulates:** Per-cell random colours, frozen forever.
- **Ground truth:** Spatially textured, temporally static.
- **Observer:** ≥95% static/textured.
- **Audio:** texture wash at share, long grains, wide pan/yNorm (≥0.7), mean Q
  low vs uniform (complaint 3 — gated by Phase 3 mean-Q, not flux).
- **Assertions:** investigate stage 4 (static%, texture rate/dur, per-slot
  sampleCenter spread ≤0.005); render dispersion ≥0.7, sites ≤70, mean Q <
  uniform.

## checkerboard-static

- **Simulates:** Static checkerboard contrast 0.3.
- **Ground truth:** Textured stasis (no temporal change).
- **Observer/Audio:** same class as frozen-noise.
- **Assertions:** investigate stage 4; render sites/flux with other statics.

## half-half

- **Simulates:** Left half uniform static; right half fresh noise every step.
- **Ground truth:** ~50/50 calm vs true chaos.
- **Observer:** calm% in [45, 55].
- **Audio:** calm wash left; chaos right at share/duration rate (~1100 Hz ideal
  after Phase 5 DUR_MIN 0.03); pool RMS balanced within ~6 dB.
- **Assertions:** investigate stage 1/3/5 (calm active, chaos ev/s band, rail
  4000 unbound); render stage 3/5 (balance, crest ↑, RMS ≤1 dB vs Phase 4).

## moving-bar

- **Simulates:** 8-wide vertical bar moving +1 cell/step on uniform bg.
- **Ground truth:** Large calm bg + moving bar region; edge δ is real chaos.
- **Observer:** largest-region velX ≈ 0.88–1.0.
- **Audio:** background sites stay put (anchor via circular concentration);
  bar tracks. Dominant-pool pan/yNorm ≤0.35/0.30.
- **Assertions:** investigate stage 1 (velX); render stage 4 dispersion on bg.

## full-flicker

- **Simulates:** Every cell random every step.
- **Ground truth:** 100% chaos.
- **Observer:** chaos% ≥ 99.
- **Audio:** dense chaos at share/DUR_MIN (~2133 Hz ideal); concurrent ≈64;
  CHAOS_EVENTS_MAX_HZ (4000) must not bind.
- **Assertions:** investigate stage 1/5; render stage 3/5 + chaos sites ≥500.

## blinker-fast

- **Simulates:** 40×40 centre block alternates A/B every step (period 2); static bg.
- **Ground truth:** ~1600 oscillator cells at 15 Hz; not chaos.
- **Observer:** oscillator group period 2, ≥1000 cells.
- **Audio:** pulse-locked osc bursts ~15/s (envelope left at 0.04/0.2); ≤2
  chaos ev/s from block.
- **Assertions:** stage 6.

## blinker-slow

- **Simulates:** Same 40×40 block cycles through 6 HSV hues (one per step) →
  fundamental period 6 at 5 Hz.
- **Ground truth:** Oscillator period 6.
- **Audio:** osc bursts ~5/s; ≤2 chaos ev/s from the block.
- **Assertions:** stage 6.

## breathing-uniform

- **Simulates:** Whole field one colour; HSV value breathes sinusoidally (period 90 steps).
- **Ground truth:** Calm with small nonzero δ̄ (below chaos threshold).
- **Audio:** inter-grain scrub advances sampleCenter; level may breathe but
  unit-energy flux stays near static (value≠spectrum).
- **Assertions:** investigate stage 7 sampleCenter spread ≥0.005; render
  dispersion like uniform-static.

## gradient-static

- **Simulates:** Horizontal hue gradient, never changes.
- **Ground truth:** Large-scale spatial variation, zero temporal change → not chaos.
- **Audio:** many calm regions across the width; pan spread ≥0.7; RMS near
  uniform (±1 dB target, see log if marginal).
- **Assertions:** investigate stage 4; render stage 3/4.

## two-blobs-merge

- **Simulates:** Two similar-colour discs approach and overlap.
- **Ground truth:** Region ID continuity through merge → one final region; few IDs.
- **Assertions:** investigate region continuity; render excludes from block-RMS ≤1.5 dB.

## bar-left

- **Simulates:** Moving bar left (−1 cell/step).
- **Assertions:** investigate stage 7 velX ≤ −0.7 and reverse-direction calm events.

## glider-swarm

- **Simulates:** Sparse gliders on a calm background.
- **Audio:** background must not wander (dispersion ≤0.35/0.30).
- **Assertions:** render stage 4 bg dispersion; investigate as available.
