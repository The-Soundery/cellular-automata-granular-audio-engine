# Audio system report — V3 Sonic Laws pipeline

**Status:** Current (2026-08-01). Listening gate passed.
North star: `Creative Brief v3.txt`.

## Live pipeline

```
Utomata
  → FrameObserver          (RGB fields + previous frame)
  → FieldObserver          (δ, s, κ, ℓ → coherent regions + chaotic area)
  → GrainScheduler         (area-weighted budget; freeze-at-spawn events)
  → AudioEngine.sendEvents
  → grain-processor.js     (ephemeral voices; ping-pong in locked window;
                            global energy normalisation)
```

## Grain identity (locked at spawn)

| Source | Maps to |
|--------|---------|
| X | Sample position / scrub start inside locked window |
| Y | Spectral bin blend |
| RGB | Envelope material only (not loudness) |
| Region geometry / velocity | Direction, Y spread, sample window + ping-pong |

## Obsolete (do not extend)

Equal-share fixed lattice + dumb paint. Archived under `public/_obsolete/`.
See also superseded notes in `scripts/listening-gate-v3.md`.
