# Audio system report — V2 topological sonification

## Contract

| Axis | Role |
|------|------|
| X | Sample position in source |
| Y | Spectral position in bandpass bank (top = high) |
| R | Timbral density |
| G | Timbral complexity |
| B | Timbral coherence |
| Neighbour coherence / variance | Grain length & overlap |
| Temporal stability | Persistence / retrigger |
| Mean field energy | Master gain + voice budget |

## Pipeline

Utomata → FrameObserver → FieldMetrics → AudioEngine → grain-processor

## Performance

- Max 32 voices, 12 triggers/block
- Spectral bank built offline (48 bins)
- Material weights computed once per grain trigger
