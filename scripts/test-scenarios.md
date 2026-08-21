# Test Scenarios

Shared synthetic patterns live in `src/field/TestPatterns.ts`.
Headless runs inject a synthetic polar segment map so HSV axes move
`sampleCenter` without loading a WAV (see `makeTestMaterialSegments` in the
investigate/render scripts). Live app uses `buildSpectralBank` on the upload.

These patterns often *saturate* δ. Passing rates/balance here does **not**
prove chaos is balanced on real Utomata (see Implementation Filter → live
chaos δ̄ / `deltaRateNorm` / `t = δ̄/0.35`).

## Two harnesses

1. **Event harness** — `node scripts/investigate-scenarios.mjs --stage N`  
   FieldObserver + GrainScheduler: shares, rates, sampleCenter, eventFlux (Y/Q).
2. **Audio harness** — `node scripts/render-scenarios.mjs --stage N`  
   Offline worklet: primary RMS = √mean(L²+R²); mono reported secondary;
   crest, sites, block-RMS, cold-start. Audio Welch-mel flux reported only.
   Source is sent as stereo L/R (mono duplicated).

In-app: DATA fold → SIM. Overlay off by default (1px outlines when on).
Grid 128×128 @ 30 steps/s. Default measure: last 7 s of 14 s
(frozen-noise longer for per-slot sampleCenter; breathing-uniform 13 s).

Verify: `npm run verify` runs investigate `--stage 9` and render `--stage 7`.

Regime membership (brief = observer): Osc → Calm → Flow → leftover split by δ
into Chaos (changing) or Static (still; code `textured`). A solid never-changing
colour field is **Calm**, not Static. Frozen mixed detail is **Static**. Solid
translating silhouettes stay **Calm** (persist); gappy correspondence travel is
**Flow** (hop). Scenario *names* like `uniform-static` are historical harness
labels — trust Ground truth / Observer lines for the regime.

---

## uniform-static

- **Simulates:** One solid colour, never changes.
- **Ground truth:** 100% **Calm** (connected similar colour + κ; zero temporal δ).
  Not the Static regime — Static is still *remainder*, not one filled colour.
- **Observer:** calm% ≈ 100; chaos% ≈ 0; one region.
- **Audio:** calm wash at area share (~64 concurrent), long grains (DUR_MAX),
  centred pan/yNorm, low spectral flux; mean Q high (focused).
- **Assertions:** investigate stage 1/7 (calm%, sampleCenter frozen); render
  stage 2–4 (loudness, dispersion ≤0.35/0.30, sites ≤70, flux ×2 ≤ flicker).

## hue-drift

- **Simulates:** Uniform field, hue rotates slowly (~55 s full cycle).
- **Ground truth:** Still one **Calm** mass; tiny continuous δ; not rhythmic;
  not Osc (period ≫ 8 steps).
- **Observer:** calm% ≈ 100.
- **Audio:** calm packing; sampleCenter drifts with polar hue angle;
  flux near static on a flat source spectrum.
- **Assertions:** investigate stage 4(iv) sampleCenter spread ≥½·0.0006·30·window
  (polar hue); stage 6 pulse-burst ≤1; render flux ×2 ≤ flicker.

## frozen-noise

- **Simulates:** Per-cell random colours, frozen forever.
- **Ground truth:** **Static** regime — temporally still remainder (spatially
  mixed). Not Chaos (no change); not Calm (no connected similar-colour mass).
- **Observer:** ≥95% static/textured.
- **Audio:** texture wash at share, long grains, wide pan/yNorm (≥0.7), mean Q
  low vs uniform (gated by mean-Q, not flux).
- **Assertions:** investigate stage 4 (static%, texture rate/dur, per-slot
  sampleCenter spread ≤0.005); render dispersion ≥0.7, sites ≤70, mean Q <
  uniform.

## checkerboard-static

- **Simulates:** Checkerboard contrast 0.3, never changes.
- **Ground truth:** Two interleaved **Calm** masses — same-value cells
  8-connect on diagonals, so this is not Static leftover. (Frozen mixed
  detail without a connected similar-colour mass is Static; see frozen-noise.)
- **Observer/Audio:** calm% ≈ 100; two regions; long calm grains.
- **Assertions:** investigate stage 4 (calm%, not static%); render sites/flux.

## half-half

- **Simulates:** Left half one solid colour (still); right half fresh noise every step.
- **Ground truth:** ~50/50 **Calm** vs **Chaos** (left is Calm, not Static).
- **Observer:** calm% in [45, 55].
- **Audio:** calm wash left; chaos right at share/duration rate (~1100 Hz ideal
  after DUR_MIN 0.03); pool RMS balanced within ~6 dB.
- **Assertions:** investigate stage 1/3/5 (calm active, chaos ev/s band, rail
  4000 unbound); render stage 3/5 (balance, crest ↑, RMS ≤1 dB).

## moving-bar

- **Simulates:** 8-wide vertical bar moving +1 cell/step on uniform bg.
- **Ground truth:** Large calm bg + moving bar as a **Calm** region (persist —
  solid translating colour is not Flow). Edge δ is real Chaos.
- **Observer:** largest-region velX ≈ 0.88–1.0; Flow % ≈ 0.
- **Audio:** background sites stay put (anchor via circular concentration);
  bar tracks. Dominant-pool pan/yNorm ≤0.35/0.30.
- **Assertions:** investigate stage 1 (velX); render stage 4 dispersion on bg.

## full-flicker

- **Simulates:** Every cell random every step.
- **Ground truth:** 100% **Chaos** (changing remainder). Scramble is not Flow.
- **Observer:** chaos% ≥ 99; Flow % = 0 (scramble is not flow).
- **Audio:** dense chaos at share / bag-mean duration (~2133 Hz ideal when
  mean → DUR_MIN); concurrent ≈64; CHAOS_EVENTS_MAX_HZ (4000) must not bind.
  Per-grain duration is a spray around that mean (raw cell δ vs bag mean;
  CHAOS_DUR_SPREAD / CHAOS_DUR_EXP), not a lock to one CA frame — p5/p95
  ratio clearly above 1.
- **Assertions:** investigate stage 1/5; render stage 3/5 + chaos sites ≥500.

## blinker-fast

- **Simulates:** 40×40 centre block alternates A/B every step (period 2); still bg.
- **Ground truth:** ~1600 **Osc** cells at 15 Hz (sitting period 2); not Chaos.
  Background is Calm.
- **Observer:** oscillator group period 2, ≥1000 cells.
- **Audio:** pulse-locked osc bursts ~15/s (envelope left at 0.04/0.2); ≤2
  chaos ev/s from block.
- **Assertions:** stage 6.

## blinker-slow

- **Simulates:** Same 40×40 block cycles through 6 HSV hues (one per step) →
  fundamental period 6 at 5 Hz.
- **Ground truth:** **Osc** period 6 (sitting); not Chaos.
- **Audio:** osc bursts ~5/s; ≤2 chaos ev/s from the block.
- **Assertions:** stage 6.

## breathing-uniform

- **Simulates:** Whole field one colour; HSV value breathes sinusoidally (period 90 steps).
- **Ground truth:** **Calm** with small nonzero δ̄ (below chaos floor). Not Osc
  (period ≫ 8 steps); not Chaos.
- **Audio:** inter-grain scrub advances sampleCenter; level may breathe but
  unit-energy flux stays near static (value≠spectrum).
- **Assertions:** investigate stage 7 sampleCenter spread ≥0.005; render
  dispersion like uniform-static.

## gradient-static

- **Simulates:** Horizontal hue gradient, never changes.
- **Ground truth:** Zero temporal change → not Chaos. Adjacent similar hues join
  as multiple **Calm** regions across the width (not one Static bag of mixed
  leftover — connected similar colour still qualifies as Calm).
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

## chaos-blob-2pct

- **Simulates:** Uniform calm field + centred 18×18 (324 cells, 1.98%) of
  fresh per-step random colour.
- **Ground truth:** Chaos share rounds to 1; event rate ≈ share×t/duration ≈ 16/s
  at saturated δ.
- **Purpose:** Percussive-chaos question — does small-coverage chaos read as
  discrete clicks? No verify assertions yet.

## chaos-blob-10pct

- **Simulates:** Same as 2pct with a 40×40 blob (1600 cells, 9.8%).
- **Ground truth:** Chaos share 6; event rate ≈ 96/s — denser, expected to read
  as a rattle not clicks.
- **Purpose:** Bracket density arithmetic with chaos-blob-2pct. No verify
  assertions yet.

## hue-bands

- **Simulates:** Eight still vertical bands, 16 columns each, band k at HSV
  hue = k×0.02, sat 0.8, value 0.8.
- **Ground truth:** Each band is a candidate **Calm** mass. Adjacent-band RGB
  distance vs `regionColourEps` (0.12) decides whether bands merge or split.
- **Purpose:** Read off where the colour gate actually splits calm masses.
  Print RGB distance + region count. No verify assertions yet.

## pulse-calm

- **Simulates:** Uniform calm colour; every 30th step HSV value jumps for 2
  steps then returns (period 1.0 s).
- **Ground truth:** Remains **Calm** (not Osc — scheduler rhythm on a coherent
  mass). Period inside `rhythmMinSec`..`rhythmMaxSec` with a clear dip for
  `RHYTHM_DIP`; expect detected periodSec ≈ 1.0 and confidence ≥ 0.72.
- **Purpose:** Pulsing calm can phase grain fires with visible change —
  breathing-uniform's 3 s period is out of range.

## identity-quadrants

- **Simulates:** Four still quadrants at matched luminance — left grey
  (sat 0), right saturated; upper/lower halves.
- **Ground truth:** Four **Calm** masses (connected similar colour). Isolates
  identity axes — sat→window half-width, X→pan, Y→cutoff — without loudness
  confounding.
- **Purpose:** Isolates identity axes for a single listen.

## osc-field

- **Simulates:** Whole grid alternates between two distinct colours every step
  (period 2).
- **Ground truth:** One large period-2 **Osc** group (~100% of field), share
  ~55 — a whole-field sitting oscillator (not Chaos, not Calm).
- **Purpose:** Harness coverage for a whole-share osc burst at the extreme.
  Pulse-mod assert applies when present.

## flow-dots

- **Simulates:** Sparse same-colour particles, widely spaced, all moving +x.
- **Ground truth:** Not Flow (isolated 2D scatter). Changing specks are **Chaos**.
- **Observer:** Flow % = 0. Overlay: orange chaos edge fragments, no green.
- **Audio:** chaos pool (four/five-pool remainder); no flow grains.
- **Assertions:** `scripts/verify-phase1.mjs` (widely spaced dots are not flow).

## flow-dense

- **Simulates:** 5×5 packed particles 3 cells apart, one colour, moving +1 x.
- **Ground truth:** **Flow** — similarity travel (hop), one flow group. DATA
  FLOW meter is grain-budget concurrent/share (not member-cell %). Scheduler
  share uses regionArea (occupied patch); patches ≥¼ seat get a floor of 1 voice.
  Overlay green is dilated for visibility only.
- **Observer:** Flow after ~8 steps of consistent heading + travel floor
  (~1.5 cells). Similarity travel (colour correspondence), not pack-COM.
  Overlay green outlines. Solid translating blocks (`moving-bar`) stay Calm
  (persist). Diagonal / dashed / vertical-train / denser cascade streams also
  confirm (verify-phase1). Colour stays itself — no tint glue.
- **Audio:** fifth pool spends area share from regionArea; piece-grains on
  member cells with packing→mid duration band; pan/Y follow via FLOW_ID_BASE
  hop-velocity conveyor. Chaos bag excludes flow cells.
- **Assertions:** verify-phase1 (packed travelling colour is flow; members
  not also counted as chaos; train vel primarily +y; cascade / wavefront
  correspondence); verify-phase2 runtime (regime flow, share > 0,
  regionId ≥ FLOW_ID_BASE; train grain rides hop).

## flow-cascade

- **Simulates:** Curved dashed hop stream (sinusoidal x, +y each step).
- **Ground truth:** One flow via colour + heading + lane cluster (not H/V/diag strip).
- **Assertions:** verify-phase1 cascade case.

## flow-wavefront

- **Simulates:** Staggered short dashes at different x, shared +y hop.
- **Ground truth:** Flow (similarity travel / heading-connected cascade), not 2D scatter.
- **Assertions:** verify-phase1 wavefront case.

## flow-dense-cascade

- **Simulates:** Several 2×3 same-colour clumps spaced along +y hop.
- **Ground truth:** Flow (denser uneven cascade — not an evenly filled calm mass).
- **Assertions:** verify-phase1 denser multi-cell cascade case.

## flow-dither

- **Simulates:** A 2D band of same-hue speckles (~42% fill) translating +1 x.
- **Ground truth:** Flow (dithered sliding texture / heading-connected sheet).
  Not a filled stamp; not isolated scatter.
- **Observer:** Flow after confirm; overlay green on the speckle band.
- **Assertions:** verify-phase1 dither sheet; two interacting hues can confirm;
  value-flicker same-hue stream still confirms.
