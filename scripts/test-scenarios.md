# Test Scenarios

Shared synthetic patterns live in `src/field/TestPatterns.ts`.
Headless runs inject a synthetic polar segment map so HSV axes move
`sampleCenter` without loading a WAV (see `makeTestMaterialSegments` in the
investigate/render scripts). Live app uses `buildSpectralBank` on the upload:
onset-aligned units, mel-spectrum PCA → polar angle/band (rank-uniform),
hops below `SILENCE_GATE_DB` dropped so colour never chooses silence
(contiguous audible runs only — windows do not bridge silent gaps).

These patterns often *saturate* δ. Passing rates/balance here does **not**
prove chaos is balanced on real Utomata (see Implementation Filter → live
chaos δ̄ / `deltaRateNorm` / `t = δ̄/0.35`).

## Harnesses

1. **Event harness** — `node scripts/investigate-scenarios.mjs --stage N`  
   FieldObserver + GrainScheduler: shares, rates, sampleCenter, eventFlux (Y/Q).
2. **Audio harness** — `node scripts/render-scenarios.mjs --stage N`  
   Offline worklet: primary RMS = √mean(L²+R²); mono reported secondary;
   crest, sites, block-RMS, cold-start. Audio Welch-mel flux reported only.
   Source is sent as stereo L/R (mono duplicated).
3. **See↔hear probes** (not in `npm run verify`) —
   `node scripts/probe-see-hear.mjs` (synthetic + one Type-U) and
   `node scripts/probe-typeu-see-hear.mjs` (4 depth-1 + 4 depth-2, settle
   then measure; `--seed` / `--depth` to run one). Report JSON is
   generated and gitignored.

In-app: DATA fold → SIM. Overlay off by default (1px outlines when on).
Grid 128×128 @ 30 steps/s. Default measure: last 7 s of 14 s
(frozen-noise longer for per-slot sampleCenter; breathing-uniform 13 s).

Verify: `npm run verify` runs investigate `--stage 9` and render `--stage 7`.

Regime membership (brief = observer): Osc → Calm → Flow → leftover split by δ
into Chaos (changing) or Texture (still, no body; code `textured`). A solid
never-changing colour field is **Calm**, not Texture. Frozen mixed detail is
**Texture**. Speckles below min area are silent residual. Solid translating
silhouettes stay **Calm** (persist); gappy correspondence travel is **Flow**
(hop).

---

## uniform-calm

- **Simulates:** One solid colour, never changes.
- **Ground truth:** 100% **Calm** (connected similar colour + κ; zero temporal δ).
  Not Texture — Texture is still cells with no similar-colour body.
- **Observer:** calm% ≈ 100; chaos% ≈ 0; one region.
- **Audio:** calm wash at area share (~64 concurrent), grains up to DUR_MAX
  (~2s — overlap, not one drone), centred pan/yNorm, low spectral flux;
  mean Q low on a full-height field (vertical extent → wide bandpass).
  Living calm/flow grains follow that extent while they last (Q on the
  region track; sample window stays frozen).
  Full-field mass → half-speed layer; full segment window (no microloop).
- **Assertions:** investigate stage 1/7 (calm%, sampleCenter frozen — no scrub);
  render stage 2–4 (loudness, dispersion ≤0.35/0.30, sites ≤70, flux ×2 ≤ flicker).

## hue-drift

- **Simulates:** Uniform field, hue rotates slowly (~55 s full cycle).
- **Ground truth:** Still one **Calm** mass; tiny continuous δ; not rhythmic;
  not Osc (period ≫ 8 steps).
- **Observer:** calm% ≈ 100.
- **Audio:** calm packing; sampleCenter drifts with polar hue angle (absolute
  colour→material; no scrub clock); flux near static on a flat source spectrum.
- **Assertions:** investigate stage 4(iv) sampleCenter spread ≥½·0.0006·30·window
  (polar hue); stage 6 max calm same-id/step ≤12; render flux ×2 ≤ flicker.

## frozen-noise

- **Simulates:** Per-cell random colours, frozen forever.
- **Ground truth:** **Texture** regime — still cells with no connected
  similar-colour mass, partitioned into deterministic hue groups (plus grey).
  Not Chaos (no change); not Calm (no body).
- **Observer:** ≥90% textured (accidental sub-minArea κ-islands are silent residual).
  Hue bins split into spatial islands (each with its own COM).
- **Audio:** several frozen colour voices (one window each from **site** colour),
  packing rate higher than a single bag because island areas are smaller; pan/yNorm
  from each island’s COM/extent. Concurrent tracks textured area (not full grid).
  Tight microloops (glassy / phasey); small islands may use double-speed.
- **Assertions:** investigate stage 4 (static%/textured% ≥90, texture rate/dur,
  avg active ∈ [45, 64], per-group slot sampleCenter spread ≤0.005); render
  dispersion ≥0.7, sites ≤70.

## checkerboard-calm

- **Simulates:** Checkerboard contrast 0.3, never changes.
- **Ground truth:** Two interleaved **Calm** masses — same-value cells
  8-connect on diagonals, so this is not Texture leftover. (Frozen mixed
  detail without a connected similar-colour mass is Texture; see frozen-noise.)
- **Observer/Audio:** calm% ≈ 100; two regions; calm grains up to DUR_MAX (~2s).
- **Assertions:** investigate stage 4 (calm%, not textured%); render sites/flux.

## half-half

- **Simulates:** Left half one solid colour (still); right half fresh noise every step.
- **Ground truth:** ~50/50 **Calm** vs **Chaos** (left is Calm, not Texture).
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
  bar tracks in pan/Y/Q. Dominant-pool pan/yNorm ≤0.35/0.30.
- **Assertions:** investigate stage 1 (velX); render stage 4 dispersion on bg.

## full-flicker

- **Simulates:** Every cell random every step.
- **Ground truth:** 100% **Chaos** (changing remainder). Scramble is not Flow.
- **Observer:** chaos% ≥ 99; Flow % = 0 (scramble is not flow).
- **Audio:** dense chaos at share / bag-mean duration (~2133 Hz ideal when
  mean → DUR_MIN); concurrent ≈64; CHAOS_EVENTS_MAX_HZ (4000) must not bind.
  Per-grain duration is a spray around that mean (raw cell δ vs bag mean;
  CHAOS_DUR_SPREAD / CHAOS_DUR_EXP), not a lock to one CA frame — p5/p95
  ratio clearly above 1. Large chaotic coverage mixes native / half / double
  layers so the storm occupies more of the spectrum — not all double.
- **Assertions:** investigate stage 1/5; render stage 3/5 + chaos sites ≥500.

## palette-chaos

- **Simulates:** Every cell independently picks one of two complementary
  hues each step (aperiodic; not a blinker).
- **Ground truth:** **Chaos** (changing remainder). Limited palette, high δ.
  Not Osc (no confirmed period 2..8); not Calm; scramble of two hues is
  not Flow.
- **Observer:** chaos% high (~97%; a few cells may confirm period 2 by
  chance and sit in Osc — the bag stays Chaos). Each chaotic area's
  paletteT high (few occupied hue bins) vs full-flicker near 0.
- **Audio:** same Chaos pool and area share as a full scramble, but bag-mean
  duration sits in the flow mid-band (longer decay tails). Packing rate
  follows the new mean — less of a click spray, not a calm wash. Spawn
  cells are only those two hues, so material is those two polar windows.
- **Assertions:** investigate stage 5 (paletteT vs full-flicker; mean chaos
  duration longer at the law, not from a δ confound in the fixture test).

## blinker-fast

- **Simulates:** 40×40 centre block alternates A/B every step (period 2); still bg.
- **Ground truth:** ~1600 **Osc** cells at 15 Hz (sitting period 2); not Chaos.
  Background is Calm.
- **Observer:** one spatial oscillator group at period 2 (≥1000 cells), with
  COM/extent matching the block (not a period-bag of the whole field).
- **Audio:** pulse-locked osc bursts ~15/s (envelope left at 0.04/0.2); Q from
  block height; ≤2 chaos ev/s from block.
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
- **Audio:** sampleCenter drifts with polar value/hue of the breathing colour
  (absolute map; no scrub); level may breathe but unit-energy flux stays near
  static (value≠spectrum).
- **Assertions:** investigate stage 7 sampleCenter spread ≥0.005; render
  dispersion like uniform-calm.

## gradient-calm

- **Simulates:** Horizontal hue gradient, never changes
  (`hsv(x/w, 0.7, 0.8)` — hue only; sat/value fixed; not the full HSV volume).
- **Ground truth:** Zero temporal change → not Chaos. Adjacent similar hues join
  as multiple **Calm** regions across the width (not Texture — connected
  similar colour still qualifies as Calm).
- **Audio:** many calm regions across the width; pan spread ≥0.7; RMS near
  uniform (±1 dB target, see log if marginal). Absolute colour→material means
  unique `sampleCenter` counts track distinct polar neighbours — expected to
  be below the hue count when the file has few distinct textures.
- **Assertions:** investigate stage 4; render stage 3/4.

## two-blobs-merge

- **Simulates:** Two similar-colour discs approach and overlap.
- **Ground truth:** Region ID continuity through merge → one final region; few IDs.
- **Audio:** living grains of the absorbed id keep following the survivor;
  the survivor inherits packing credit. Q follows the combined extent.
- **Assertions:** investigate region continuity; render excludes from block-RMS ≤5 dB.

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
  discrete clicks? Native-speed layer (coverage below the occupancy floor).
  No verify assertions yet.

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
  identity axes — segment window, X→pan, Y→cutoff, shape extent→Q — without
  loudness confounding.
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
  hop-velocity conveyor. Empty seated non-pulsed flow catch-up fills in
  ~FLOW_FILL_S (force one grain if share>0 and the budget has room).
  Elongated streams use minor-axis thickness for Q; Q follows live extent.
  Chaos bag excludes flow cells.
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
