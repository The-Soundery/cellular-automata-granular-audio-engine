# Listening gate — Sonic Laws (manual)

**Status: PASSED** (author listening, 2026-08-01) for V4 identity remap on branch `v4`.

North star: `Creative Brief v4.txt`.
Automated checks: `npm run verify` (phases 0–4).

Use this checklist with ears + the region overlay after Enable Audio.
Re-run after major scheduler / worklet / observation changes.

## Setup

- [x] App boots; CA visible; Field observation meters move
- [x] Enable Audio loads default source without errors
- [x] Overlay shows region bounds (not a fixed lattice grid)

## Freeze-at-spawn

- [x] No zipper / pitch-tear glitches when calm regions move
- [x] Texture follows motion via *new* grains, not one grain being dragged
- [x] Pan stays fixed for the life of a grain (no mid-grain stereo chase)

## Calm vs chaos

- [x] Large calm areas → fewer, longer, overlapping grains (wash of one texture)
- [x] Chaotic areas → many short grains, little/no overlap
- [x] If sim is mostly calm, budget meters show most grains on calm side (area share)
- [x] If sim is mostly chaotic, audio texture is mostly short/dense

## Neutrality

- [x] Switching between calm-heavy and chaos-heavy variations does not make one regime obviously “louder” as a policy
- [x] RMS stays in a usable range (energy norm working); no constant clipping scream
- [x] Hard-panned activity does not make the mix scream or collapse oddly

## Identity (V4)

- [x] Distinct hues scrub distinct sample regions; similar hues feel related
- [x] Left-side cells lean left in the stereo field; right-side lean right
- [x] Motion left/right can reverse scrub direction on new calm grains (velX)
- [x] Tall calm regions feel spectrally fuller (Y spread)
- [x] Colour chooses sample area, not envelope shape or master volume

## Failure modes (must NOT hear)

- [x] Constant repeating scrub locked to fixed posts (old lattice failure)
- [x] Mid-grain sample jumps chasing COM or colour
- [x] Mid-grain pan chasing cell X
- [x] Chaos winning the mix only because it fires more (without area share)

## Pass

All boxes checked → Sonic Laws listening gate passed for this build.

**Next:** fine-tune negotiable constants (`FIELD_OBS`, `SCHED`, worklet `TARGET_RMS` / budget) — do not revive lattice / voice-ownership paths or V3 identity without a new listening decision.
