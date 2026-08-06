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

## Observed rhythm → rate / oscillators

- [x] No imposed BPM when the field has no period
- [x] Rhythm does not raise loudness or steal area budget

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

## Failure modes (must NOT hear)

- [x] Constant repeating scrub locked to fixed posts
- [x] Mid-grain sample jumps chasing COM or colour
- [x] Chaos winning only because it fires more (without area share)
- [x] Pitch transposition / Doppler not in the source
- [x] Frozen field that still "wanders" in pan/spectrum every frame
- [x] Pattern load / reset burst of grains (cold-start)

## Defects — code says these are broken; do not ear-test until fixed

1. **Test-pattern canvas never hides.** `patternCanvas.hidden = true` loses to
   `.ca-wrap canvas { display: block }`, so a stale pattern frame stays painted
   over the live CA after switching back to Utomata. Visual only — the audio
   pipeline is unaffected.

2. **Pan/Y follow uses a meaningless COM.** `SPAWN_ANCHOR_R_MIN` guards spawn
   placement against low circular concentration; `trackDx` / `trackDy` and
   `applyTracks` do not. moving-bar background: 91% of the field, `comConcX`
   0.093, `comConcY` 5.8e-17, `comX` marching 1 cell/step, `comY` jumping up to
   60.44 cells in a single frame. Every grain in that region pans and re-tunes
   with numerical noise. This is the "background pans" observation.

3. **Calm spawn sites collapse to the centre.** `SPAWN_SPREAD_MIN = 0.08` with
   `colourSpread = 0` gives sigma 5.1 cells on a 128 grid. Measured site sd:
   uniform-static 4.6 / 5.1 and hue-drift 4.7 / 5.2, against frozen-noise
   37.8 / 36.5 and gradient-static 37.2 / 31.3. Pan lands inside ±0.15 and
   cutoff inside 650–1470 Hz, so uniform fields read narrow and centred.

4. **Oscillator pool cannot spend its share.** `oscBurstMax = 3` caps the burst
   regardless of share, and osc grains run 0.8 × period so they fill the period
   rather than pulsing within it. blinker-slow: share 6, ~2.4 concurrent, 80%
   duty (−4 dB and smeared). A live CA that went 85% period-2 had share 55 and
   still reached only 2.4 concurrent — −13.6 dB. A cap that stops a pool
   reaching its share is what the Filter STOP list calls loudness policy in
   disguise.

## Blocked — no sim can currently test these

- Adjacent different-hue calm masses stay separate / similar stable hues merge.
  Needs a sim with a parameterised hue step across a boundary, to find where
  `regionColourEps = 0.12` actually splits.
- Chaotic areas read as percussive. Needs a small-chaos-fraction sim. At 60%
  chaos the share/duration arithmetic forces roughly 600 events/s, which no
  envelope can make discrete.
- Pulsing calm can phase grain fires with visible change. `breathing-uniform`
  never locks — measured rhythm confidence 0.000 across 600 steps, because its
  3 s period falls outside the 0.15–2.0 s accept window.
- Distinct hues → distinct sample regions; similar hues feel related.
- Grey diffuse / saturated focused; left/right pan; Y → spectrum. The mapping is
  saturation → window half-width, 0.06 s (saturated) to 0.8 s (grey); X → pan;
  Y → bandpass cutoff, 80 Hz at the bottom to 12 kHz at the top, exponential.
  Needs a quadrant sim isolating one axis at a time.
- Moving bar as figure/ground. The bar is itself calm, so it correctly receives
  a few gentle grains — the sim tests the wrong thing. Needs a figure the laws
  should render distinctly.

## Open doctrine question (not pass/fail)

- Chaos broadband; calm narrower/purer; mid-κ between. Q currently follows
  spatial colour similarity. The proposal on the table is Q ← region Y extent.
  Decide, rewrite the Brief, then re-listen.

## Pass

Ear pass is complete for every item not listed under Defects, Blocked, or Open
doctrine. Re-run the Calm/texture/chaos and Region fidelity sections after the
four defects are fixed and the missing sims exist.

Do not revive lattice / ownership / 48-bin bank / Doppler /
mono-as-primary-RMS / chaos Hz as mix policy.
