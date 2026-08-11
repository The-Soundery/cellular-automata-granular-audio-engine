# Listening gate — Sonic Laws (manual)

**Status:** V4.4 COMPLETE — owner ear-validated 2026-08-11.
V4.1 Continuous Laws ear-validated (2026-08-02).
V4.2/V4.3 defects fixed in V4.4; full re-pass signed off.
Gate record / measured findings: `scripts/v4.4-implementation-log.md`.

North star: `Creative Brief v4.txt`.
Agent map: `Implementation Filter.txt` → `scripts/v4.4-implementation-log.md`.
Automated: `npm run verify` (investigate stage 9 + render stage 7).

Use with ears + region overlay after Enable Audio. Items marked `(code)` were
settled by measurement; all ear `[x]` items passed 2026-08-11.

## Setup

- [x] App boots; CA visible; Field observation meters move
- [x] Field observation shows Chaos δ̄, Chaos t, Calm δ̄, Static δ̄ (V4.4 Phase 7);
      settled live Utomata: chaos δ̄ 0.26–0.30 and t 0.75–0.87
- [x] Enable Audio loads default source without errors
- [x] Overlay shows cell silhouettes with bright edges; Overlay On/Off works
- [x] Overlay regime colours (static grey / chaos warm / osc cool) + legend
      readable under the CA (V4.4 Phase 6)
- [x] Spend meter shows `c a/s · s a/s · x a/s · o a/s` (active/share), not just %

## Freeze-at-spawn (sample) + pan/Y track

- [x] No zipper / pitch-tear from sample scrub when calm regions move
- [x] Sample material stays locked for a grain's life (no mid-grain scrub chase)
      — (code) `spawnEvents` sets windowCenter / windowHalf / boundLo / boundHi
      once; `applyTracks` touches only x, y, pan, yNorm and pan gains.
- [x] Region grains' pan / spectrum directly follow the region (no lag/smoothing)
      — (code) `applyTracks` snaps to **anchor** + spawn offset (V4.4 Phase 2);
      pan saturates at torus seam (Phase 2f).
- [x] Chaos-bag grains keep spawn pan/Y (no region id)
      — (code) `spawnChaos` sets `regionId: -1`; `applyTracks` skips `regionId < 0`.

## Calm / texture / chaos (V4.3)

- [x] Large calm areas → long overlapping wash; Budget not stuck at 1 grain
- [x] Solid single colour → soft attack, overlap, sustained (not one lonely grain)
- [x] Frozen noise (Sim: frozen-noise) → slow textured wash, not chaos rattle;
      sites feel stable; **distinct character from uniform-static** at same level
- [x] Uniform-static / hue-drift feel spatially wide (V4.4 Phase 3 dispersion);
      not narrow-centred (Gate 3iv)
- [x] Area share spent: Spend meter active ≈ share for calm / static / chaos / osc
      — (code) V4.4 Phase 4: osc fires whole share per pulse at OSC_DUTY 0.35
- [x] Order→disorder sweep glides through materials — not a two-mood snap
- [x] Paused / static heterogeneous field → near-silence; sound resumes with change

Chaos grain length is settled by measurement — (code) 30.0 ms at saturated δ;
49–75 ms at live Utomata chaos mean. Percussiveness is a density / coverage
question — ear-passed on `chaos-blob-2pct` / `chaos-blob-10pct`.

## Real Utomata chaos balance — SETTLED

Measured 2026-08-06; Gate 7 ear-confirmed 2026-08-11:

    chaos pool δ̄ = 0.26 – 0.30   →  t = δ̄ / 0.35 = 0.75 – 0.87
    chaos area   = 52% – 66%     →  under-spend ≈ 1 dB

Do not lower `deltaRateNorm` on the old δ≈0.1 / ~5 dB premise.

## Region fidelity

- [x] Irregular shapes: grains follow the mask, not empty AABB corners
- [x] Overlay shows regime colours (calm / static / chaos / osc) with legend
      readable under the CA (half-half / chaos-blob-10pct)

## Observed rhythm → rate / oscillators

- [x] No imposed BPM when the field has no period
- [x] Rhythm does not raise loudness or steal area budget
- [x] Oscillator share spent as a discrete pulse (blinker-slow / osc-field);
      silence between hits, peak concurrency ≈ share (V4.4 Phase 4)
- [x] Pulsing calm can phase grain fires with visible change (Sim: pulse-calm;
      periodSec ≈ 1.0 s — OSC% stays 0 by design; rhythm is the calm clock)

## Neutrality

- [x] Calm-heavy vs chaos-heavy does not make one regime "louder as policy"
- [x] Uniform vs gradient / frozen vs uniform feel level-matched (share spent)
      — (code) render stage 7 asserts uniform-vs-gradient total RMS within 1 dB
- [x] Hard-panned activity does not scream or collapse oddly
- [x] No 30 Hz machine-gun comb; no normalisation pumping on density

## Identity

- [x] Motion can reverse scrub on new calm grains; rate stays ±1 (no Doppler)
- [x] Colour chooses sample / scrub, not master volume
- [x] Adjacent different-hue calm masses stay separate / similar stable hues
      merge (Sim: hue-bands)
- [x] Distinct hues → distinct sample regions; similar hues feel related
- [x] Grey diffuse / saturated focused; left/right pan; Y → spectrum
      (Sim: identity-quadrants; matched luminance)

## Failure modes (must NOT hear)

- [x] Constant repeating scrub locked to fixed posts
- [x] Mid-grain sample jumps chasing COM or colour
- [x] Chaos winning only because it fires more (without area share)
- [x] Pitch transposition / Doppler not in the source
- [x] Frozen field that still "wanders" in pan/spectrum every frame
- [x] Pattern load / reset burst of grains (cold-start)

## V4.4 fixes (ear re-pass — all passed 2026-08-11)

- [x] Test-pattern canvas hides when returning to Utomata (Phase 1)
- [x] Background on moving-bar no longer sweeps pan/Y from meaningless COM
      (Phase 2); bar still tracks
- [x] Uniform-static / hue-drift pan and spectral width opened up with
      SPAWN_SPREAD_MIN 0.5 (Phase 3 / Gate 3iv)
- [x] Chaotic areas read as percussive at small coverage (chaos-blob-2pct)
      and as a denser rattle at ~10% (chaos-blob-10pct)

## Still deferred (not ear-pass blockers)

- Moving bar as figure/ground needs a fourth regime (Filter OPEN/DEFERRED 5).
- Q ← region Y extent remains an open doctrine question (plan §10a); current
  law is spatial colour similarity → Q. Decide separately, then re-listen.

Do not revive lattice / ownership / 48-bin bank / Doppler /
mono-as-primary-RMS / chaos Hz as mix policy.
