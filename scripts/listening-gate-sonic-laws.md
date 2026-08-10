# Listening gate — Sonic Laws (manual)

**Status:** V4.1 Continuous Laws ear-validated (2026-08-02).
V4.2/V4.3 owner listening pass 2026-08-06 — triaged below.

North star: `Creative Brief v4.txt`.
Agent map: `Implementation Filter.txt` (OPEN ISSUES).
Automated: `npm run verify` (investigate stage 9 + render stage 7).

Use this checklist with ears + the region overlay after Enable Audio.

Items settled by reading or measuring the code are marked `(code)` and are no
longer ear questions. Items the code shows are **broken** are under Defects;
items no sim can currently test are under Blocked. Neither belongs in an ear
pass until cleared.

## Setup

- [x] App boots; CA visible; Field observation meters move
- [x] Enable Audio loads default source without errors
- [x] Overlay shows cell silhouettes with bright edges; Overlay On/Off works
- [x] Spend meter shows `c a/s · s a/s · x a/s · o a/s` (active/share), not just %

## Freeze-at-spawn (sample) + pan/Y track

- [x] No zipper / pitch-tear from sample scrub when calm regions move
- [x] Sample material stays locked for a grain's life (no mid-grain scrub chase)
      — (code) `spawnEvents` sets windowCenter / windowHalf / boundLo / boundHi
      once and nothing writes them again; `applyTracks` touches only
      x, y, pan, yNorm and the pan gains.
- [x] Region grains' pan / spectrum directly follow the region (no lag/smoothing)
      — (code) `applyTracks` snaps to COM + spawn offset with no filtering.
      *What* it follows is wrong for low-concentration regions — see Defect 2.
- [x] Chaos-bag grains keep spawn pan/Y (no region id)
      — (code) `spawnChaos` sets `regionId: -1`; `applyTracks` skips
      `regionId < 0`.

## Calm / texture / chaos (V4.3)

- [x] Large calm areas → long overlapping wash; Budget not stuck at 1 grain
- [x] Solid single colour → soft attack, overlap, sustained (not one lonely grain)
- [ ] Frozen noise (Sim: frozen-noise) → slow textured wash, not chaos rattle;
      sites feel stable; **distinct character from uniform-static** at same level
- [x] Area share spent: Spend meter active ≈ share for calm / static / chaos
      — (code) calm, texture and chaos all reach share. The **osc** pool does
      not — see Defect 4.
- [x] Order→disorder sweep glides through materials — not a two-mood snap
- [x] Paused / static heterogeneous field → near-silence; sound resumes with change

Chaos grain length is settled by measurement, not ears — (code) 30.0 ms at
saturated δ (0.60 ms attack, 29.4 ms release, no sustain), and 49–75 ms at the
live Utomata chaos mean. Whether that *reads* as percussive is a density
question, not an envelope question, and needs the small-chaos sim (Blocked).

## Real Utomata chaos balance — SETTLED (code)

Measured 2026-08-06 across five live Utomata runs via
`window.__fieldObserver.observation`:

    chaos pool δ̄ = 0.26 – 0.30   →  t = δ̄ / 0.35 = 0.75 – 0.87
    chaos area   = 52% – 66%     →  under-spend ≈ 1 dB

The "δ ≈ 0.1, so chaos spends under a third of its share, ~5 dB down" premise
in Filter OPEN ISSUE 1 does not hold for live Utomata. Do not lower
`deltaRateNorm` on the strength of it. Both ear items here are withdrawn.

## Region fidelity

- [x] Irregular shapes: grains follow the mask, not empty AABB corners
- [ ] Overlay shows regime colours (calm / static / chaos / osc) with legend
      readable under the CA (V4.4 Phase 6 — re-check on half-half and
      chaos-blob-10pct)

## Observed rhythm → rate / oscillators

- [x] No imposed BPM when the field has no period
- [x] Rhythm does not raise loudness or steal area budget
- [ ] Oscillator share spent as a discrete pulse (blinker-slow / osc-field);
      silence between hits, peak concurrency ≈ share (V4.4 Phase 4)
- [ ] Pulsing calm can phase grain fires with visible change (Sim: pulse-calm;
      expect periodSec ≈ 1.0 s — note: with rhythmHistory 48, confidence may
      sit below 0.72; listen anyway)

## Neutrality

- [x] Calm-heavy vs chaos-heavy does not make one regime "louder as policy"
- [x] Uniform vs gradient / frozen vs uniform feel level-matched (share spent)
      — (code) render stage 7 asserts uniform-vs-gradient total RMS within 1 dB
      and passes. No ear A/B exists and none is needed.
- [x] Hard-panned activity does not scream or collapse oddly
- [x] No 30 Hz machine-gun comb; no normalisation pumping on density

## Identity

- [x] Motion can reverse scrub on new calm grains; rate stays ±1 (no Doppler)
- [x] Colour chooses sample / scrub, not master volume
- [ ] Adjacent different-hue calm masses stay separate / similar stable hues
      merge (Sim: hue-bands — print RGB distance vs regionColourEps)
- [ ] Distinct hues → distinct sample regions; similar hues feel related
- [ ] Grey diffuse / saturated focused; left/right pan; Y → spectrum
      (Sim: identity-quadrants; matched luminance)

## Failure modes (must NOT hear)

- [x] Constant repeating scrub locked to fixed posts
- [x] Mid-grain sample jumps chasing COM or colour
- [x] Chaos winning only because it fires more (without area share)
- [x] Pitch transposition / Doppler not in the source
- [x] Frozen field that still "wanders" in pan/spectrum every frame
- [x] Pattern load / reset burst of grains (cold-start)

## Re-listen after V4.4 fixes (formerly Defects — now unchecked)

- [ ] Test-pattern canvas hides when returning to Utomata (Phase 1)
- [ ] Background on moving-bar no longer sweeps pan/Y from meaningless COM
      (Phase 2); bar still tracks
- [ ] Uniform-static / hue-drift pan and spectral width opened up with
      SPAWN_SPREAD_MIN 0.5 (Phase 3) — owner Gate 3(iv)
- [ ] Chaotic areas read as percussive at small coverage (Sim: chaos-blob-2pct)
      and as a denser rattle at ~10% (Sim: chaos-blob-10pct)

## Still blocked

- Moving bar as figure/ground. The bar is itself calm, so it correctly receives
  a few gentle grains — the sim tests the wrong thing. Needs a figure the laws
  should render distinctly (Filter OPEN ISSUE 5 / fourth regime).

## Open doctrine question (not pass/fail)

- Chaos broadband; calm narrower/purer; mid-κ between. Q currently follows
  spatial colour similarity. The proposal on the table is Q ← region Y extent.
  Deferred in V4.4 (IMPLEMENTATION_PLAN_V4.4 §10a). Decide after Phase 3 listen,
  rewrite the Brief, then re-listen.

## Pass

Re-run the unchecked items above after V4.4. Items still under Still blocked
or Open doctrine are not ear-pass blockers for the rest.

Do not revive lattice / ownership / 48-bin bank / Doppler /
mono-as-primary-RMS / chaos Hz as mix policy.
