# Audio system report — V4 Sonic Laws pipeline

**Status:** Current. V4 identity + region detection + calm packing wash / regime envelopes. Re-run `scripts/listening-gate-sonic-laws.md`.
North star: `Creative Brief v4.txt`.

## Live pipeline

```
Utomata
  → FrameObserver          (RGB fields + previous frame)
  → FieldObserver          (δ, s, κ, ℓ → soft-colour coherent regions + chaos bag;
                            κ hysteresis; fillRatio; ID match via COM+colour+IoU)
  → GrainScheduler         (area-weighted budget; spawn from cells; packing-driven calm
                            rate for overlap wash; optional period phase; freeze-at-spawn)
  → AudioEngine.sendEvents
  → grain-processor.js     (ephemeral voices; ping-pong in locked window;
                            regime envelope at spawn; equal-power pan; energy norm)
```

## Grain identity (locked at spawn)

| Source | Maps to |
|--------|---------|
| Hue(RGB) | Sample window centre / scrub range (similar colours → similar areas) |
| X | Stereo pan (−1…+1), equal-power |
| Y | Spectral bin blend |
| velX (calm) | Playback direction |
| Region cells (+ fillRatio) | Spawn location; Y spread only when fill is high |
| Regime | Envelope: calm attack/release 0.5 / 0.5; chaos sharp (~0.06 / 0.15) — not RGB-driven |

## Obsolete (do not extend)

Equal-share fixed lattice + dumb paint. Archived under `public/_obsolete/`.
Prior V3 identity (X→sample / RGB→envelope) is superseded by V4; history is in git.
