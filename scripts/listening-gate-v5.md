# Listening gate — V5 Polar Material + Stereo Identity

Owner checklist after `npm run build && npm run verify`.
V4.4 checklist (`listening-gate-sonic-laws.md`) remains closed historical record.

## Identity / material

- [ ] Calm regions on pad-like / sustained sources do **not** click with attacks
      *(2026-08-18 mapping: sustained subset + attack-gap; fixture in verify-phase4 —
        re-listen on a mixed pad+drums upload and an all-hits upload)*
- [ ] Chaos / oscillators still find transient material when the source has attacks
      *(unchanged full-map transient query — confirm chaos still finds hits)*
- [ ] Grey / low-saturation fields still use a useful span of the file (brightness walks material)
- [ ] Saturated hue differences scrub neighbouring / related material (polar angle)
- [ ] Uploaded stereo: left of grid hears left of recording; right hears right; centre blends
- [ ] Moving calm region: pan **and** channel mix follow; sample window does not chase
- [ ] Y is the spectrum (bottom dull / 80 Hz, top bright / 12 kHz), independent of hue/snippet

## Regression (still true)

- [ ] Area share still spent (full calm ≈ budget concurrency)
- [ ] Frozen-noise vs uniform-static still distinct materials at matched loudness
- [ ] Blinker / osc pulses remain discrete; envelope left alone
- [ ] No mid-grain sample-window scrub chase

## Diagnostic UI

Field panel shows **Mean sat** and **Hue spread** so a pasted equation that is
nearly greyscale is visible (hue dead → rely on value/band).

Overlay (one colour per regime): gold calm, grey static, orange chaos, blue osc,
green flow. Gold/cyan/green dots are grains (green = flow pieces).

## Flow grains (CURRENT 2026-08-17)

Doctrine: Brief / Filter — similarity travel; grains ride hop conveyor.

- [ ] `flow-dense`: distinct moving piece-grains (not a calm wash, not a chaos
      rattle); pan/Y track the pack; Field spend shows `f` share > 0
- [ ] `flow-dots`: still chaos speckles — no green flow grains
- [ ] `moving-bar`: still calm (bar tracks as a mass); not flow
- [ ] Train-track / ladder CA: green flow follows the **hop direction**
      (e.g. down), not slow sideways structure drift; listen dots travel
      along the track and respawn at the start when they reach the end
- [ ] Diagonal / dashed / cascade / denser multi-cell cascades confirm as
      flow when heading is consistent (colour stays itself — no tint glue)
- [ ] Calm-field wavefronts (red diagonals on gold) paint green, not orange
- [ ] Dithered sliding texture (sparse same-hue diagonals) paints green
      when heading is consistent, not orange scatter
- [ ] No Doppler / pitch tears from velocity; sample window stays frozen
- [ ] Flow listen dots are green and sit on travelling pieces, not stuck
      at the COM
- [ ] Translating filled stamps / thick ribbons stay gold calm (not flow)

## Sign-off

Date: ________
Ears: ________
Notes: ________
