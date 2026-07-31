# Listening gate — Sonic Laws (manual)

**Status: PASSED** (author listening, 2026-08-01).

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

## Calm vs chaos

- [x] Large calm areas → fewer, longer, overlapping grains (wash of one texture)
- [x] Chaotic areas → many short grains, little/no overlap
- [x] If sim is mostly calm, budget meters show most grains on calm side (area share)
- [x] If sim is mostly chaotic, audio texture is mostly short/dense

## Neutrality

- [x] Switching between calm-heavy and chaos-heavy variations does not make one regime obviously “louder” as a policy
- [x] RMS stays in a usable range (energy norm working); no constant clipping scream

## Identity

- [x] Motion left/right can reverse scrub direction on new calm grains
- [x] Tall calm regions feel spectrally fuller (Y spread)
- [x] Colour changes material/envelope, not master volume

## Failure modes (must NOT hear)

- [x] Constant repeating scrub locked to fixed posts (old lattice failure)
- [x] Mid-grain sample jumps chasing COM
- [x] Chaos winning the mix only because it fires more (without area share)

## Pass

All boxes checked → Sonic Laws listening gate passed for this build.

**Next:** fine-tune negotiable constants (`FIELD_OBS`, `SCHED`, worklet `TARGET_RMS` / budget) — do not revive lattice / voice-ownership paths.
