# Audio system report — V4 Sonic Laws pipeline

**Status:** Current (2026-08-01). V4 identity remap listening-validated.
North star: `Creative Brief v4.txt`.

## Live pipeline

```
Utomata
  → FrameObserver          (RGB fields + previous frame)
  → FieldObserver          (δ, s, κ, ℓ → coherent regions + chaotic area)
  → GrainScheduler         (area-weighted budget; hue→sample; X→pan; freeze-at-spawn)
  → AudioEngine.sendEvents
  → grain-processor.js     (ephemeral voices; ping-pong in locked window;
                            equal-power stereo pan; global energy normalisation)
```

## Grain identity (locked at spawn)

| Source | Maps to |
|--------|---------|
| Hue(RGB) | Sample window centre / scrub range (similar colours → similar areas) |
| X | Stereo pan (−1…+1), equal-power |
| Y | Spectral bin blend |
| velX (calm) | Playback direction |
| Region height | Y spawn spread |
| Envelope | Fixed (not RGB-driven) |

## Obsolete (do not extend)

Equal-share fixed lattice + dumb paint. Archived under `public/_obsolete/`.
V3 identity (X→sample / RGB→envelope): see `Creative Brief v3.txt` (superseded).
See also superseded notes in `scripts/listening-gate-v3.md`.
