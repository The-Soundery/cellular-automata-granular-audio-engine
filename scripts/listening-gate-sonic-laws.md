# Listening gate — Sonic Laws (manual)

**Status: PASSED** for V4.1 Continuous Laws (ear-validated 2026-08-02).
Re-run after any further major scheduler / worklet / observation changes.

North star: `Creative Brief v4.txt`.
Automated checks: `npm run verify` (phases 0–4).

Use this checklist with ears + the region overlay after Enable Audio.

## Setup

- [ ] App boots; CA visible; Field observation meters move
- [ ] Enable Audio loads default source without errors
- [ ] Overlay shows **cell silhouettes** with bright edges (outline-first); toggle Overlay On/Off works
- [ ] Overlay fill is subtle (does not recolour the CA heavily)

## Freeze-at-spawn (sample) + pan/Y track

- [ ] No zipper / pitch-tear from sample scrub when calm regions move
- [ ] Sample material stays locked for a grain’s life (no mid-grain scrub chase)
- [ ] Region grains’ pan / spectrum directly follow the region as it moves (no lag/smoothing)
- [ ] Chaos-bag grains keep spawn pan/Y (no region id)

## Calm vs chaos

- [ ] Large calm areas → longer overlapping grains (continuous wash; Budget/Calm g not stuck at 1)
- [ ] **Solid single colour / 100% calm** → soft attack, audible overlap, sustained texture (not one lonely grain)
- [ ] Chaotic areas → many short grains, sharp attack, little/no overlap
- [ ] If sim is mostly calm, budget meters show most grains on calm side (area share)
- [ ] If sim is mostly chaotic, audio texture is mostly short/dense
- [ ] Order→disorder sweep glides through intermediate grain materials (length, attack, purity) — not a two-mood snap
- [ ] Chaos is broadband / noisier; calm rings narrower / purer; mid-κ sits between
- [ ] Paused / static heterogeneous field decays to near-silence; sound resumes where change resumes

## Region fidelity (shape + shared colour)

- [ ] Adjacent **different-hue** calm masses stay separate regions (overlay + distinct sample scrub)
- [ ] **Similar** (not exact) hues that are stable merge as one calm region
- [ ] Irregular / non-rectangular calm shapes: grains follow the mask, not empty AABB corners
- [ ] Sparse L / diagonal shapes do not sound like a full rectangle wash

## Observed rhythm → rate

- [ ] Pulsing / periodic calm areas can phase grain fires with visible change
- [ ] No imposed musical BPM when the field has no period (falls back to packing rate)
- [ ] Rhythm does not raise loudness or steal area budget

## Neutrality

- [ ] Switching between calm-heavy and chaos-heavy variations does not make one regime obviously “louder” as a policy
- [ ] RMS stays in a usable range (energy norm working); no constant clipping scream
- [ ] Hard-panned activity does not make the mix scream or collapse oddly
- [ ] No 30 Hz machine-gun comb in dense chaos; no normalisation pumping on density changes

## Identity (V4.1)

- [ ] Distinct hues scrub distinct sample regions; similar hues feel *sonically* related (centroid LUT)
- [ ] Grey / desaturated areas sound diffuse (wide window); saturated areas focused (tight window)
- [ ] Left-side cells lean left in the stereo field; right-side lean right
- [ ] Moving calm masses can be heard moving in pan / spectrum without sample tears
- [ ] Vertical region drift glides in spectrum (no 48-step staircase)
- [ ] Motion left/right can reverse scrub direction on new calm grains (velX); rate stays ±1 (no Doppler)
- [ ] Long source (≥3 min) loads fast; same CA state sounds comparable to a short source
- [ ] Colour chooses sample area / scrub, not master volume (envelope from κ/δ order, not RGB)

## Failure modes (must NOT hear)

- [ ] Constant repeating scrub locked to fixed posts (old lattice failure)
- [ ] Mid-grain sample jumps chasing COM or colour
- [ ] Chaos winning the mix only because it fires more (without area share)
- [ ] Pitch transposition / Doppler whistles that are not in the source material

## Pass

All boxes checked → Sonic Laws listening gate passed for this build.

**Next:** fine-tune negotiable constants (`FIELD_OBS`, `SCHED` continuous-law curves, worklet `TARGET_RMS` / filter range) — do not revive lattice / voice-ownership paths, the 48-bin bank, or Doppler rate without a new listening decision.
