# Audio system report — V2 structure-centric sonification

## Musical objects

Coherent regions (structures) derived from neighbour RGB similarity — not individual cells.

## Contract

| Axis | Role |
|------|------|
| Structure probe X | Sample position |
| Structure probe Y | Spectral position |
| Region colour | Grain envelope material only |
| Structure area/mass | Voice mass / amplitude share |
| Structure stability/speed | Grain length, overlap, motion refresh |
| Mean field energy | Master gain |

## Pipeline

Utomata → FrameObserver → RegionExtractor → StructureTracker → StructureAllocator → AudioEngine → grain-processor

## Performance

- Max 32 voices, 12 triggers/block
- Region extract capped at 48 regions/frame
- Spectral bank offline (48 bins), Y-only at trigger
