# Audio system report — V3 equal-share field renderer

## Musical objects

None curated. The ear hears redistribution of sonic energy through a finite
equal-share lattice. Structures may emerge psychoacoustically; they are never
selected or scored.

## Contract

| Axis | Role |
|------|------|
| Lattice X | Sample position |
| Lattice Y | Spectral position |
| RGB | Grain envelope material only |
| Amplitude | Always `1/N` (luminance ≠ volume) |
| localDelta | Refresh rate only |
| Master gain | Global energy ceiling |

## Pipeline

Utomata → FrameObserver → FieldReducer → AudioEngine → grain-processor

## Performance (v3.0)

- Grain budget: 64 (8×8 lattice on 128²)
- Max worklet slots: 128
- Max triggers/block: 24
- Spectral bank offline (48 bins), Y-only at trigger
