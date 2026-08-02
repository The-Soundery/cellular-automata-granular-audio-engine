# Audio system report — V4.1 Continuous Laws

**Status:** Current on branch `v4.1`. Continuous Laws ear-validated (2026-08-02).
North star: `Creative Brief v4.txt`. Listening gate: `scripts/listening-gate-sonic-laws.md`.

## Live pipeline

```
Utomata
  → FrameObserver          (RGB fields + previous frame)
  → FieldObserver          (δ, s, κ → soft-colour coherent regions + chaos bag;
                            κ hysteresis; fillRatio; maxDelta; ID match via COM+colour+IoU)
  → GrainScheduler         (area-weighted budget; region COM tracks; packing/rhythm;
                            continuous order→duration/envelope/Q; saturation→window;
                            perceptual hue→sample LUT; sample frozen at spawn)
  → AudioEngine.sendEvents (+ pan/Y tracks)
  → grain-processor.js     (raw PCM + per-grain resonant bandpass; wrap-aware window;
                            analytic envelope; onset jitter; asymmetric energy norm)
```

Source prep (`spectral.ts`): mono mixdown, loop-seam crossfade, peak normalize,
spectral-centroid hue→sample LUT. No 48-bin bank.

## Grain identity

| Source | Maps to |
|--------|---------|
| Hue(RGB) via centroid LUT | Sample window centre — **frozen at spawn** |
| Saturation | Window half-width in seconds (grey = wide / diffuse) |
| X / region COM | Stereo pan (−1…+1), equal-power — region grains **directly follow** COM + spawn offset |
| Y / region COM | Bandpass cutoff (continuous) — same direct follow |
| κ (coherence) | Filter Q (spectral purity) + contribution to grain `order` |
| δ / area / fill | Grain `order` → duration, attack, release (continuous, not binary regime) |
| velX (calm) | Playback direction at spawn (±1 only; no Doppler rate) |
| Region cells | Spawn location (uniform mask sample) |

Chaos-bag grains have no region id, keep spawn pan/Y, and spawn δ-weighted.

## Obsolete (do not extend)

Equal-share fixed lattice + dumb paint. Archived under `public/_obsolete/`.
Prior V3 identity (X→sample / RGB→envelope) is superseded by V4; history is in git.
48-bin offline spectral bank removed in V4.1.
