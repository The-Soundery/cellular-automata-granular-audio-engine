# Listening gate — V5 Polar Material + Stereo Identity

Owner checklist after `npm run build && npm run verify`.
V4.4 checklist (`listening-gate-sonic-laws.md`) remains closed historical record.

## Identity / material

- [ ] Calm regions on pad-like / sustained sources do **not** click with attacks
- [ ] Chaos / oscillators still find transient material when the source has attacks
- [ ] Grey / low-saturation fields still use a useful span of the file (brightness walks material)
- [ ] Saturated hue differences scrub neighbouring / related material (polar angle)
- [ ] Uploaded stereo: left of grid hears left of recording; right hears right; centre blends
- [ ] Moving calm region: pan **and** channel mix follow; sample window does not chase
- [ ] Y moves the filter around the chosen material (relative), not an absolute fight with hue

## Regression (still true)

- [ ] Area share still spent (full calm ≈ budget concurrency)
- [ ] Frozen-noise vs uniform-static still distinct materials at matched loudness
- [ ] Blinker / osc pulses remain discrete; envelope left alone
- [ ] No mid-grain sample-window scrub chase

## Diagnostic UI

Field panel shows **Mean sat** and **Hue spread** so a pasted equation that is
nearly greyscale is visible (hue dead → rely on value/band).

## Sign-off

Date: ________
Ears: ________
Notes: ________
