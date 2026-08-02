# Audio system report — V4 Sonic Laws pipeline

**Status:** Current. V4 identity + region detection + calm packing + direct region pan/Y follow. Re-run `scripts/listening-gate-sonic-laws.md`.
North star: `Creative Brief v4.txt`.

## Live pipeline

```
Utomata
  → FrameObserver          (RGB fields + previous frame)
  → FieldObserver          (δ, s, κ, ℓ → soft-colour coherent regions + chaos bag;
                            κ hysteresis; fillRatio; ID match via COM+colour+IoU)
  → GrainScheduler         (area-weighted budget; region COM tracks; packing/rhythm;
                            sample frozen at spawn)
  → AudioEngine.sendEvents (+ pan/Y tracks)
  → grain-processor.js     (locked sample window; direct region pan/Y follow;
                            regime envelope at spawn; energy norm)
```

## Grain identity

| Source | Maps to |
|--------|---------|
| Hue(RGB) | Sample window centre / scrub range — **frozen at spawn** |
| X / region COM | Stereo pan (−1…+1), equal-power — region grains **directly follow** COM + spawn offset |
| Y / region COM | Spectral bin blend — same direct follow |
| velX (calm) | Playback direction at spawn |
| Region cells (+ fillRatio) | Spawn location; Y spread only when fill is high |
| Regime | Envelope: calm attack/release 0.22 / 0.28; chaos sharp (~0.06 / 0.15) — not RGB-driven |

Chaos-bag grains have no region id and keep spawn pan/Y.

## Obsolete (do not extend)

Equal-share fixed lattice + dumb paint. Archived under `public/_obsolete/`.
Prior V3 identity (X→sample / RGB→envelope) is superseded by V4; history is in git.
