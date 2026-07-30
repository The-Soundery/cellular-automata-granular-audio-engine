# Audio System Overview Report

Generated from focused agent audits of the load path, worklet playback, and FieldMetrics→plan pipeline, plus gain quantification.

## System map

```
User gesture (Enable / Load)
  → AudioContext + AudioWorkletNode
  → decode file → buildSpectralBank (24 sharp bins, attenuate-only)
  → postMessage source (transferable bins)

Utomata CA step
  → getImgData (only on step change)
  → FieldMetrics.analyze → VoicePlan
  → postMessage plan (if audio.isReady)

Worklet process()
  → if no bins: silence
  → EMA masterGain toward plan.masterGain
  → trigger grains (RR, budget 12/block)
  → sample = grain * amplitudeShare * 0.9 * masterGain * 1/√N
```

---

## Why you can see Voices > 0 and still hear nothing

UI “Voices” counts **FieldMetrics plan slots**, not “sound is coming out of the speakers.” Several independent layers can zero or bury the signal after that count is shown.

---

## Critical — can cause total silence

### 1. AudioContext suspended while UI says ready
`isReady` is `started && node && bank`. It does **not** check `ctx.state === "running"`.  
`await audioWorklet.addModule(...)` can expire the user-gesture window before `resume()`. Status still shows `loaded · file`. Destination never runs → **total silence**.

**Likelihood when testing after async load:** High.

### 2. Half-init poison
If `new AudioContext()` succeeds but `addModule` / `AudioWorkletNode` throws, `ctx` is set and `node` stays null. Later calls skip creation (`if (!this.ctx)`), `sendSource` no-ops (`if (!this.node) return`). Bank exists; worklet never gets bins → **permanent silence** until full page reload.

**Likelihood after a failed first Enable:** Medium (sticky once it happens).

### 3. Source without plans → masterGain stays 0
Worklet starts with `masterGain = 0` / `masterGainTarget = 0`. Output is multiplied by `masterGain`. Plans only send when `isReady`. Until the first CA step after ready, or if CA is paused (`fps(0)`), gain never rises → **silence**.

**Likelihood right after load before CA advances:** Short (~one step). **If paused:** permanent.

---

## High — can cause perceptual silence (engine “working”)

### 4. Gain stacking: `amplitudeShare × 0.9 × masterGain × 1/√N`
For **N = 32** equal shares and typical bright-field `masterGain ≈ 0.22–0.55`:

| energy | masterGain | per-voice product | coherent peak (×0.5 sample) |
|--------|------------|-------------------|------------------------------|
| 0.4 | 0.55 | ~0.0027 | ~0.044 |
| 1.0 | 0.22 | ~0.0011 | ~0.018 |

That is already very quiet. With headphones / laptop speakers / OS volume, it can register as **no audio**.

### 5. Attenuate-only spectral bins + R mapping
Empty / off-harmonic bins are **not boosted** (fix for glitches). If CA **R** lands on a quiet bin, grain PCM ≈ 0. Combined with #4 → **effective silence while Voices = 32**.

Black / uniform CA → all voices use **R=0, G=0** → bin 0 (~80 Hz) at sample start. If that region of the file is quiet in that band → silence.

### 6. Info-density floor always fills 32 voices
Even static fields get `infoDensity ≳ 1e-4` ≫ `1e-6` gate → always up to 32 candidates. UI always looks “busy.” Spreads gain thin (#4) on fields that philosophically should use **few** voices.

---

## Medium

### 7. UI honesty gaps
Status never shows `ctx.state`. Voices show `—` only when `!isReady`, not when suspended or gain≈0.

### 8. `retriggerHz` computed but never sent
Dead parameter; intervals use grain length / overlap / persistence only. Confuses debugging, not silence by itself.

### 9. FrameObserver short-buffer edge case
If `imgData` is short, `lastStep` advances before fail → that step never analyzes. Recovers on next CA step with current 128² wiring.

### 10. masterGain EMA
~50% of target in ~23 blocks (~60 ms). Not stuck silence if target > 0.

---

## Design risks (philosophy vs implementation)

| Intent | Current behaviour | Risk |
|--------|-------------------|------|
| Stable regions use fewer voices | Density floor still allocates 32; stable only gets longer grains / slightly slower triggers | Trigger budget OK, but **level** diluted across dummy voices |
| Changing regions get more voice access | Density weighting helps selection order | Undermined if 32 slots always filled |
| R = spectral bin of the source | Narrow BP + no boost | Faithful but **inaudible** when bin empty |
| Finite sonic energy | `masterGain = 0.22/energy` | Bright CA → **quieter** audio (inverse of visual brightness) |

---

## Ranked most likely explanations for “I can’t hear anything”

1. **Suspended AudioContext** after Load (UI lies)  
2. **Gain stacking** with 32 voices + low masterGain → below hearing threshold  
3. **Quiet spectral bins** (attenuate-only) for current CA R values  
4. **Poisoned AudioEngine** after a failed worklet init (needs hard refresh)  
5. **CA paused** / no plans → masterGain stuck at 0  

---

## What would confirm each (manual)

1. DevTools: `audioContext.state` (need a temporary expose) or click **Enable Audio again** after load  
2. Raise system volume fully; watch whether any hiss appears when CA is dark (masterGain→4) vs bright (→0.22)  
3. Hard refresh, Enable first, then Load; if still silent → likely #2/#3 design level, not gesture  
4. If Enable once failed earlier in the session → hard refresh fixes #4  

---

## Recommended fix directions (not implemented in this pass)

1. Treat ready as `ctx.state === "running" && node && bank`; surface state in UI; retry `resume()` on Enable  
2. Reset `ctx/node` on init failure (no half-init poison)  
3. Replace `1/√N × 1/N` with energy-preserving gain (e.g. shares sum to 1 without extra √N, or `1/√N` only)  
4. Raise density gate / adaptive voice budget so calm fields use few voices  
5. Optional: floor bin mix with a tiny dry/PCM tap or wider bins so R always has *some* energy when source has energy  
6. Send an immediate plan (or default audible gain) when source loads so masterGain is not 0 waiting on CA  

---

## Agents

- [Load path audit](9aeeb6a9-e05f-42fd-9132-4dd5f99d128c) — AudioContext / worklet / UI gating  
- [Worklet silence audit](48f4923a-7ab3-4148-99f0-c42256fc4fa7) — gain math / bins / EMA  
- [Plan pipeline audit](d166f679-019c-4484-a6c9-a2f234b00bd3) — FieldMetrics → sendPlan  

**Not verified in this report:** measured live worklet RMS in your browser session (would need an injected probe or temporary debug meters).
