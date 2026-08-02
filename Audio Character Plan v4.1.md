# Audio Character Plan — V4.1 "Continuous Laws"

**Status:** PROPOSAL (analysis + implementation plan). Nothing here is implemented yet.
**North star:** `Creative Brief v4.txt` (Sonic Laws are authoritative and unchanged).
**Scope:** How the audio output can better represent CA state, where the design can be
simplified, and how to get more varied sonic character from a changing simulation.
Architecture/code-quality cleanups are explicitly out of scope except where they
directly change what the listener hears.

This document is written to be executable by a future agent without extra context.
Read `Creative Brief v4.txt` and `Implementation Filter.txt` first — the Forbidden
list there overrides anything ambiguous here.

---

## 1. Executive summary

The V4 pipeline (FieldObserver → GrainScheduler → grain-processor worklet) is
faithful to the Sonic Laws in structure, but several implementation choices
**flatten the CA's continuous state into a small number of fixed sonic outcomes**.
The single biggest cause: almost every audible grain parameter is driven by the
binary `calm | chaos` classification, while the underlying measurements (κ, δ)
are continuous. The result is "two moods" instead of a continuum, and different
CA equations that *look* different end up *sounding* similar.

The recommended solution is a bundle of changes called **V4.1 Continuous Laws**:

1. **Per-grain resonant bandpass filter replaces the 48-bin pre-filtered bank**
   — one simplification that removes an entire subsystem, removes a hard memory
   ceiling on source length, un-quantizes the Y→spectrum law, and adds a new
   lawful timbre dimension (coherence → spectral purity). Highest value change.
2. **Continuous grain laws** — duration, envelope, and filter bandwidth become
   continuous functions of κ/δ instead of two presets. Widest audible-variety win.
3. **Change-is-the-event chaos spawning** — chaos grains spawn δ-weighted, so
   static-but-heterogeneous fields go quiet and propagating fronts localize.
   Direct fidelity win ("the sound must evolve as the visuals evolve").
4. **Colour law completion** — sample windows defined in seconds (not file
   fraction), saturation → window focus, loop-seam-safe hue wrap.
5. **Texture de-quantization** — grain onsets jittered inside the 30 Hz CA step.
6. **Neutral loudness without pumping** — asymmetric-time normalisation.

All changes stay inside the brief's NEGOTIABLE space (numeric curves, envelope
constants, observation constants) or refine an existing law's implementation
without changing its statement. §6 maps each change to the doctrine explicitly.

---

## 2. Current pipeline (as-built reference)

```
Utomata (128×128 @30fps, RGBA)
  → FrameObserver          planar RGB float fields, current + previous
  → FieldObserver          per-cell δ, s, κ, ℓ; flood-filled coherent regions
                           (area, COM, velocity, bounds, fillRatio, cells);
                           chaos = remainder bag
  → GrainScheduler         area-share budget (64); calm: packing + autocorr
                           rhythm; chaos: pack-to-share; grain identity at
                           spawn (hue→sample window, X→pan, Y→yNorm,
                           velX→direction, regime→envelope preset)
  → AudioEngine            worklet lifecycle; sends events + region COM tracks
  → grain-processor.js     128 voices; reads from 48 offline bandpass copies
                           of the source (yNorm → 2-bin blend); ping-pong in
                           hue-locked window at ±1 rate; envelope from cached
                           table; equal-power pan; direct region pan/Y follow;
                           RMS-feedback normalisation → soft clip
```

Key facts a future agent must know before editing:

- Grain playback rate is **always ±1** — there is no pitch/transposition anywhere.
  All spectral variation comes from the 48-bin bank.
- `spectral.ts` pre-renders **48 full-length bandpass copies** of the source.
  Memory = 48 × length × 4 bytes (a 3-minute source ≈ **1.5 GB** — effectively a
  hard cap on usable source length; the default bundled WAV is short, which hides
  this).
- All sample-window constants (`calmSampleHalf` etc.) are **fractions of total
  file length**, so the same CA state sounds completely different depending on
  how long the loaded source file is.
- The worklet's per-grain envelope is built as a `Float32Array(durationSamples)`
  keyed by exact duration → near-every spawn allocates and fills a large array
  **on the audio thread** (real-time hazard: dropouts under load).
- `verify` (`npm run verify`) is 4 regex/contract scripts in `scripts/`; several
  assertions pin implementation details that V4.1 changes (list in §7 Phase E).

---

## 3. Findings — where CA state is lost before it reaches the ear

Each finding has an ID used by the plan in §7. "Fidelity" = the CA state exists
but is not audible. "Character" = the mapping works but collapses variety.
"Simplification" = removable complexity with no audible loss (or an audible gain).

### F1 — Binary regime collapses the κ/δ continuum (Character, biggest)

`GrainScheduler` classifies every grain `calm | chaos` and derives duration
range, envelope preset, window width, and rate law from that single bit
(`SCHED.calmDurMin/Max` vs `chaosDurMin/Max`, `calmAttackFrac` vs
`chaosAttackFrac`, …). The observation layer produces continuous κ and δ per
cell and per region — then the scheduler throws that resolution away.

Consequences:
- There are exactly two grain materials. Duration has a **hole between 140 ms
  and 350 ms** (chaos max → calm min) — mid-coherence textures cannot exist.
- A simulation drifting from order to disorder snaps between two sounds instead
  of gliding — precisely the "computational flow" the brief wants audible.
- Different equations with different κ/δ distributions map onto the same two
  presets → "constant repeating texture", the brief's named failure mode.

### F2 — Chaos spawning ignores δ; static heterogeneous fields sound busy (Fidelity)

`spawnChaos` picks a **uniform random cell** from the chaos bag
(`GrainScheduler.ts:592`), and the chaos rate has a floor
(`chaosPackRateMin: 0.55`) that keeps ~55% of pack rate even when δ̄ → 0.
A frozen checkerboard (low similarity → low κ → classified chaos, but δ = 0,
nothing evolving) fires grains forever at more than half rate. Conversely a
single glider crossing a quiet zone is diluted: its cells are no likelier to
spawn than any static bag cell.

The brief's one-line axiom says *change and coherence set rate*; the interview
record says *"Chaotic patterns redistribute sonic energy more rapidly because
they change more frequently."* Change should be the event. Cells that changed
should fire; cells that didn't shouldn't.

### F3 — Y→spectrum is quantized to 48 bins and thins the source (Character + Fidelity)

- 48 log-spaced narrow bandpass copies (`BIN_DESIGN_Q 4.5`) make most grains
  sound like filtered whistles — the source material's identity (transients,
  texture) is mostly destroyed before grains ever read it.
- Y resolution is 48 steps with 2-bin linear blend; the direct region Y-follow
  audibly **staircases** as a region moves vertically.
- The bank is normalized to the loudest bin (`normalizeBankRelative`), so Y
  positions where the source has little energy are near-silent → whole grid
  rows effectively mute, violating the spirit of neutrality; a hack partially
  masks this by bleeding mono PCM at −28 dB when a bin is silent
  (`grain-processor.js:289`), which quietly defeats the Y law.
- Chaos and calm both pass through the same narrow bins, so chaotic areas can
  never sound genuinely broadband/noisy — a large missing texture axis.

### F4 — Sample-window laws depend on source file length (Fidelity + Robustness)

Window half-widths are fractions of the file (`calmSampleHalf 0.035` = 2.1 s for
a 60 s file, 21 s for a 10-minute file). With rate ±1 a grain traverses only
`durationSec` of material, so for any normal-length source the read head **never
reaches the window edge**: ping-pong never engages, and the ℓ→window-width law
(`calmSampleHalfFor`) is inaudible. The engine's audible behaviour should be a
function of CA state, not of how long the user's file happens to be.

### F5 — Colour is only half-used; grey is a discontinuity (Fidelity)

Hue picks the window centre; **saturation and luminance are discarded**.
Grey/near-grey cells snap to hardcoded centre 0.5 (`rgbToHueNorm`,
`GrainScheduler.ts:636`) — a cliff: a cell drifting toward grey suddenly jumps
its sample position. The interview record explicitly allows colour to set
*micro-temporal material properties* of grains. Saturation → window width is
the natural law: saturated colour = precise material identity (tight window);
grey = diffuse identity (wide window). This also fixes the grey cliff
continuously — as saturation → 0 the window widens until hue barely matters.

### F6 — Hue is circular; the sample axis is not (Fidelity)

Hue 0.99 and hue 0.01 are both red but map to **opposite ends of the source**.
"Similar colours scrub similar sample areas" (Sonic Law 2) fails at the red
seam — and red-family palettes are common in Utomata runs. Fix in §7 Phase B
(loop-seam-crossfaded buffer + wrap-aware windows).

### F7 — All grains in a step start on the same audio block (Character)

Events are batched per CA step (30 Hz) and spawned on message arrival, so
simultaneous grains start sample-aligned: chaos spray becomes a 30 Hz
machine-gun comb, and same-cell calm grains phase-align. Granular practice
(Roads; every serious granulator's "jitter/spray" control) spreads onsets.
Doctrinally clean: the CA defines *which step* an event belongs to, not its
sub-step phase — uniform spread inside the step interval is neutral physics,
not aesthetics.

### F8 — Chaos duration law is inverted (Fidelity, small)

`durationChaosAt` gives **longer** grains for **higher** δ (t rises with δ,
duration = min + (max−min)·t). Faster change should produce shorter-lived
events. F1's unified continuous law removes this by construction.

### F9 — RMS-feedback normalisation pumps and blurs texture (Character)

The worklet chases `TARGET_RMS` with a single smoothing constant
(`NORM_SMOOTH 0.05`/block ≈ 50 ms) and caps gain 0.2–3.5×. This is a fast
compressor: chaos onsets duck the wash, single sparse grains get boosted 3.5×
then collapse when density returns. Neutral *macro* loudness is sacred; a
pumping *micro* envelope is not required by it — it's an artifact. Fix:
asymmetric time constants (fast protect, slow recover) + analytic pre-scaling
by active-voice count.

### F10 — Envelope tables are built per-spawn on the audio thread (Robustness → audible)

`getEnvelope` caches by exact sample-duration; continuous durations mean ~every
spawn allocates a `Float32Array(up to ~67k)` and fills it with `Math.pow` on
the render thread, and the cache is cleared wholesale at 64 entries. This is a
dropout/glitch source — the interview record explicitly lists "glitches, pops,
clicks" as a failure. Replace with an analytic per-sample envelope (no tables).

### F11 — Region speed is almost inaudible (Fidelity, optional)

Region COM velocity currently drives only playback *direction* sign
(`velDirEps`) plus the pan/Y follow. A fast-moving region and a slow-drifting
region sound identical per-grain. A spawn-frozen Doppler-style rate offset
(±few %) proportional to velocity magnitude is a physically-motivated extension
of the existing "Motion → direction" spawn law. **Optional; needs its own
listening decision** (it touches grain pitch, which V4 has never had).

### S1 — The spectral bin bank is removable (Simplification, pairs with F3)

Replacing bank-reads with a **per-grain resonant bandpass filter** over the raw
mono PCM deletes: the 48× memory blowup, the offline pre-render wait on every
load, the giant transfer to the worklet, the silent-bin mono-bleed hack, and Y
staircasing — while *adding* continuous Y, per-grain bandwidth as a lawful
dimension, and full-band chaos textures. CPU is trivial (64 voices × ~10
flops/sample ≈ 30 MFLOPs at 48 kHz). Per-grain resonant filtering is
established practice (NIME 2025 "Sculpting the Sound Atom" adds a tunable
resonant filter per grain).

### S2 — Coherence length ℓ is ~40% of observation cost for an inaudible payoff (Simplification)

`measureCoherenceLength` runs 4 rays × up to 24 steps × 16 384 cells × 30 Hz
(~47 M colour-distance ops/s on the main thread). ℓ feeds only (a) calm window
width — inaudible per F4 — and (b) 15% of the calm duration mix, which κ/area
already dominate. Drop the per-cell ℓ pass entirely; where a "spatial extent"
term is wanted, `region.width/height/area` (already computed) serve. Keeps the
brief's ℓ concept as satisfied-by-region-extent rather than per-cell rays.
(Brief lists ℓ under field observation, but exact metrics/curves are
NEGOTIABLE; region extent *is* a coherence-length measurement.)

### S3 — The tall-region Y-spread special case is redundant (Simplification)

`spawnCalm`'s conditional column-search re-pick (`pickNearestCellInColumn`,
O(cells) per spawn) biases Y diversity that **uniform mask sampling already
provides** — cells are picked uniformly from `region.cells`, which spans the
region's full Y extent by definition. Delete the special case, its constants
(`ySpreadFrac`, `ySpreadFillMin`), and the helper. If listening later shows
tall filled regions feel spectrally thin, revisit with a measurement, not a
patch.

### S4 — (Deferred) Region ID matching cost

`cellIoU` builds a JS `Set` per region pair per frame. Fine at current region
counts; a labels-grid overlap count would be O(cells). **Do not do this now** —
it's invisible to the listener; noted only so a future perf pass knows.

---

## 4. Research notes (what related work says)

- **Miranda's ChaOs / Chaosynth** (1991–1995): the canonical CA→granular
  system — CA state mapped to grain parameters per tick, valued precisely
  because *grain-level* CA control yields evolving, organic textures rather
  than event-level MIDI-ish mappings. Validates this project's grain-level
  approach and its emphasis on CA dynamics (not static state) as the driver.
- **Naive Game-of-Life sonifications** (cell→pitch/tone mappings, e.g. the
  Cornell FPGA project, little-scale's GoL): consistently demonstrate the
  failure mode the brief already rejects — per-cell → note mappings read as
  arbitrary blips; the interesting sound lives at the *aggregate/texture*
  level. Supports the region/field-measurement approach.
- **CataRT / corpus-based concatenative synthesis** (Schwarz): grains selected
  by proximity in *descriptor space* (spectral centroid, loudness…), i.e. the
  playback axis is perceptually organized rather than file-ordered. Directly
  relevant to the hue→sample law: hue adjacency currently guarantees *file*
  adjacency, not *sonic* adjacency. An offline centroid-sorted segment map
  would make "similar colours sound similar" perceptually true (§7 Phase D2,
  optional).
- **Roads, *Microsound* / granular practice**: onset jitter ("spray") is the
  standard cure for machine-gun/comb textures; grain size classes have
  characteristic sonic identities (sub-20 ms clicky → 100 ms+ tonal), which
  argues for the widened continuous duration range; envelope families
  (expodec/Gaussian/tapers) are material properties — consistent with
  envelope-from-κ rather than two presets.
- **Per-grain DSP** (NIME 2025, "Sculpting the Sound Atom"): per-grain
  tunable resonant filters are practical and idiomatic; supports S1/F3.

Sources:
- [Chaosynth introduction](https://granularsynthesis.com/chaosynth.php)
- [Miranda — Granular Synthesis of Sounds by Means of a Cellular Automaton](https://www.semanticscholar.org/paper/Granular-Synthesis-of-Sounds-by-Means-of-a-Cellular-Miranda/3ce94b601bda797799cb8a6af04a4e02de143076)
- [Cellular automata in generative electronic music and sonic art: a historical and technical review](https://www.academia.edu/2888899/Cellular_automata_in_generative_electronic_music_and_sonic_art_a_historical_and_technical_review)
- [The art of rendering sounds from emergent behaviour: CA granular synthesis](https://www.researchgate.net/publication/3867381_The_art_of_rendering_sounds_from_emergent_behaviour_cellular_automata_granular_synthesis)
- [Real-Time Corpus-Based Concatenative Synthesis with CataRT (DAFx-06)](https://www.dafx.de/paper-archive/2006/papers/p_279.pdf)
- [Schwarz — Interacting with a Corpus of Sounds](https://econtact.ca/16_2/schwarz_corpus.html)
- [Sculpting the Sound Atom: Towards Per-Grain DSP (NIME 2025)](https://nime.org/proceedings/2025/nime2025_21.pdf)
- [SuperCollider granular synthesis tutorial (grain scheduling)](https://composerprogrammer.com/teaching/supercollider/sctutorial/5.2%20Granular%20Synthesis.html)
- [Game of Life Music Synthesizer (Cornell ECE 5760)](https://people.ece.cornell.edu/land/courses/ece5760/FinalProjects/f2011/lba36_wl336/lba36_wl336/)
- [little-scale — Sonifying Conway's Game of Life](http://little-scale.blogspot.com/2009/08/sonifying-conways-game-of-life.html)

---

## 5. Recommended solution

Implement **V4.1 Continuous Laws** = Phases A–C below (F1–F10, S1–S3).
Phase D items (Doppler rate F11, perceptual sample map) are prepared but
**gated on separate listening decisions** — do not implement them in the same
pass, or a failed gate can't be attributed.

Why this bundle and not something bigger: the brief's handoff note says *"Next
work is fine-tuning negotiable constants — not architectural rewrites."* V4.1
deliberately keeps the pipeline shape, the message flow, the region/budget
model, the freeze-at-spawn contract, and the rhythm system **unchanged**. Every
change is either a negotiable-constant restructure (presets → curves), a
subsystem swap invisible outside the worklet (bin bank → per-grain filter), or
a spawn-site selection rule (δ-weighting) — all inside the audio renderer's
existing responsibilities.

Expected audible outcome (success criteria for the listening gate):

1. Sweeping equations from ordered → disordered produces a *continuum* of
   grain materials (length, attack, spectral purity), not a two-mood switch.
2. A static-but-patterned field is nearly silent; the moment it starts
   evolving, sound returns where the change is.
3. Chaotic areas sound genuinely broadband/noisy; calm masses ring purer and
   narrower; mid-κ areas sit between.
4. Vertical region motion glides (no 48-step staircase); horizontal motion
   pans as before.
5. Same CA behaviour sounds equivalent with a 10 s or a 5 min source file;
   long sources load fast and don't blow memory.
6. No 30 Hz machine-gun comb during dense chaos; no normalisation pumping.

---

## 6. Doctrine compliance map

| Change | Doctrine status |
|---|---|
| Continuous duration/envelope/bandwidth from κ/δ | NEGOTIABLE ("exact numeric curves"); implements Law 4's "change and coherence set rate, length, and overlap" with more resolution. Envelope remains frozen at spawn (Law 5). Not RGB-driven. |
| Per-grain bandpass replaces bin bank | Y→spectrum law unchanged in statement; implementation detail of the renderer. `spectral.ts` is listed under KEEP in the brief — §7 Phase A explains the deviation and requires noting it in the brief's rebuild section when shipped. |
| Bandwidth/Q ∝ κ | New *material* micro-property from field mathematics (coherence = spectral order). Never touches loudness, allocation, or macro schedule. Aligned with interview Q3 clarification. |
| δ-weighted chaos spawn | Implements Law 3/4 (δ is the observation; "faster change → more frequent fires"). Area-share budget untouched — activity still cannot buy budget beyond area share (Law 7). |
| Saturation → window width | Colour sets micro-material only (interview Q3). Hue→position law unchanged. Luminance still unused. |
| Windows in seconds; seam-crossfaded loop; wrap windows | Freeze-at-spawn untouched — window still locked at spawn, ping-pong preserved (Law 5/6). |
| Onset jitter within CA step | Physical neutrality: sub-step timing is undefined by the CA; uniform spread imposes no aesthetic. |
| Analytic + asymmetric normalisation | Serves Law 8 (neutral energy) better, with less artifact. Equal per-grain amplitude retained. |
| Drop per-cell ℓ; use region extent | Observation metrics/curves are NEGOTIABLE; ℓ concept preserved via region width/height/area. |
| Doppler rate at spawn (Phase D1) | Extension of Law 6 "Motion → direction". **Requires new listening decision** — grain pitch is new territory. Frozen at spawn; NOT mid-grain modulation. |
| Centroid-sorted sample map (Phase D2) | Refines Law 2's *intent* (similar colours → similar sound) but changes the letter (hue→file-position). **Requires new listening decision.** |

Explicitly NOT touched (Forbidden or validated): fixed listening points;
voice ownership; luminance→volume; mid-grain scrub chase; pan/Y follow stays
direct and unsmoothed; area-share budget; rhythm system (validated by ear);
no effects rack (the per-grain filter *is* the Y law's renderer, not an
effect); no interestingness anywhere.

---

## 7. Implementation plan

Phases are ordered so each is independently shippable and listenable.
**After every phase:** `npm run verify` must pass (with the assertion updates
listed in Phase E applied alongside whichever phase breaks them), and the
relevant new rows of `scripts/listening-gate-sonic-laws.md` must be checked by
ear before moving on. Commit per phase.

### Phase A — Worklet foundation (S1, F3, F7, F9, F10)

All in `public/grain-processor.js`, `src/audio/spectral.ts`,
`src/audio/AudioEngine.ts`. No scheduler-law changes yet — wire-compatible:
until Phase B, the worklet derives Q from the existing `regime` field.

**A1. Source prep replaces the bin bank** (`spectral.ts`)
- Keep `buildSpectralBank`'s mono mixdown; delete the 48-bin filtering,
  `BIN_DESIGN_Q`, `normalizeBankRelative`, and the `bins` array.
- Add a **loop-seam crossfade**: offline, blend the final `SEAM_FADE_SEC`
  (0.05 s) into the first `SEAM_FADE_SEC` with an equal-power fade so wrapped
  reads (A4) never click. Peak-normalize mono PCM to 0.9.
- New export shape: `{ sampleRate, length, durationSec, pcm }` (rename type to
  `SourceBank` or keep `SpectralBank` name to minimize churn — keep name).
- `AudioEngine.sendSource` sends only `pcm` (+ `sampleRate`, `length`).
  Message type stays `"source"`; drop `bins`/`binCount` fields.

**A2. Per-grain TPT state-variable bandpass** (worklet)
- Voice state: `ic1eq`, `ic2eq` (reset at spawn), `fcNorm` (from `yNorm`),
  `q` (from event; interim default: calm 6.0, chaos 1.0 by `regime`).
- Cutoff law (worklet-side constants): `fc = FILT_FMIN * (FILT_FMAX/FILT_FMIN)^yNorm`
  with `FILT_FMIN = 80`, `FILT_FMAX = 12000`, clamped ≤ `0.45 * sampleRate`.
- Per block, if `yNorm` or `q` changed: recompute coefficients
  `g = tan(π·fc/fs)`, `k = 1/q`, `a1 = 1/(1+g·(g+k))`, `a2 = g·a1`,
  `a3 = g·a2`.
- Per sample (input `v0` = raw PCM read):
  ```
  v3 = v0 - ic2eq
  v1 = a1*ic1eq + a2*v3        // band-ish intermediate
  v2 = ic2eq + a2*ic1eq + a3*v3
  ic1eq = 2*v1 - ic1eq
  ic2eq = 2*v2 - ic2eq
  band = v1                     // unity peak gain at fc for all q
  ```
  Grain output = `band * envelope * amp * masterGain` (pan gains as now).
- Y-follow (`applyTracks`) keeps updating `yNorm` exactly as today; the filter
  recompute per block makes vertical motion continuous. **Do not smooth yNorm**
  (doctrine: direct follow).
- Delete `buildSpectralWeights`, `readSample`'s bin blending and the
  `pcm * 0.04` silent-bin bleed; read raw `pcm[readPos|0]` (Phase D1 would add
  2-tap interpolation; not needed at ±1 rate).

**A3. Analytic envelope — no tables** (worklet)
- Delete `getEnvelope`, `windowCache`, `ENV_CACHE_MAX`, `ENV_CURVE`.
- Per sample, from `age`, `duration`, `attackFrac`, `releaseFrac`:
  ```
  aN = max(1, floor(duration*attackFrac)); rN = max(1, floor(duration*releaseFrac))
  if aN + rN > duration: scale both so they exactly fill duration (as today)
  if age < aN:            t = age/aN;              env = t*t*(3-2t)      // smoothstep
  else if age > dur-rN:   t = (duration-1-age)/rN; env = t*t*(3-2t)
  else:                   env = 1
  ```
  Compute `aN`/`rN` once at spawn and store on the voice. Smoothstep replaces
  the pow/Hann blend — click-free, cheap, and the attack/release *fractions*
  (the lawful part) are unchanged in meaning.

**A4. Wrap-aware ping-pong window** (worklet; pairs with F6)
- Keep `boundLo`/`boundHi` names (verify-phase4 pins them) but define them in
  **unwrapped window coordinates**: voice stores `windowCenterSamples`
  (from event) and treats `boundLo = center - halfSamples`,
  `boundHi = center + halfSamples`; the actual read index is
  `wrapIndex(round(readPos), length)`. With the seam crossfade from A1, a
  window spanning the file seam is inaudible.
- `process()` still never rewrites bounds (verify-phase4 contract).
- Event fields change from `sampleLo/sampleHi` to `sampleCenter/sampleHalf`
  (normalized 0..1 of file length on the wire; worklet converts to samples).
  **Until Phase B ships, scheduler translation:** `center=(lo+hi)/2`,
  `half=(hi-lo)/2` — add this shim in `AudioEngine.sendEvents` so Phase A is
  independently shippable, and remove it in Phase B.

**A5. Sample-accurate onset offsets** (F7)
- Event gains `startOffsetSec` (0 if absent). Voice starts with
  `delaySamples = startOffsetSec * sampleRate`; while `delaySamples > 0`
  decrement per sample and output nothing (don't advance `age` or filter).
- Until Phase B, `AudioEngine.sendEvents` shim may set
  `startOffsetSec = Math.random() * (1/30)` per event. (Doctrinally uniform;
  moves to the scheduler with proper step-interval knowledge in Phase B.)

**A6. Normalisation without pumping** (F9)
- Keep mono-mix RMS measurement and `TARGET_RMS`.
- Replace single `NORM_SMOOTH` with asymmetric response:
  ```
  desired = clamp(TARGET_RMS / blockRms, NORM_MIN 0.25, NORM_MAX 3.0)
  normGain += (desired - normGain) * (desired < normGain ? 0.25 : 0.004)
  ```
  (≈3 ms protect, ≈0.7 s recover at 128-sample blocks / 48 kHz.)
- Add analytic pre-scale so the feedback loop works less: per block,
  `preScale = 1 / sqrt(max(1, soundingCount))` smoothed with the *slow*
  coefficient, multiplied into the mix before RMS measurement; scheduler's
  `equalAmp` then becomes `1` … **no — keep `equalAmp` as-is** (verify-phase4
  pins `1 / Math.sqrt` in the scheduler and the brief cites amplitude
  normalisation across grains). Instead use
  `preScale = sqrt(budget / max(1, soundingCount))` clamped 0.5–2.5 — it
  re-centers equal-amp for actual density. Soft clip stays as final guard.

**Phase A acceptance**
- Load a ≥3-minute file: loads in < a few seconds, memory sane, all Y
  positions audible (no mute rows).
- Solid calm field: sustained wash, no staircase when the mass drifts
  vertically (compare against `v4` HEAD by ear).
- Dense chaos: no 30 Hz comb, no pumping duck on the calm wash.
- No dropouts at 64 concurrent grains (perf trace: worklet callback well under
  budget; no allocation in `process()` on steady state).
- `npm run verify` green after Phase-E assertion updates for phase2/phase4
  worklet checks.

### Phase B — Continuous laws in the scheduler (F1, F2, F4, F5, F8, S3)

All in `src/field/GrainScheduler.ts` (+ event type). Region model, budget
allocation, rhythm system, pan/X law, direction law: **unchanged**.

**B1. Unified continuous grain material law**
Replace the four duration constants and two envelope presets with one law
evaluated per spawn. Define grain context:
- calm grain: `κ_ctx = region.meanCoherence`, `δ_ctx = region.meanDelta`,
  `areaT = clamp01(log2(max(2, region.area)) / 10)`, `fillT = region.fillRatio`
- chaos grain: `κ_ctx = obs.coherence[ci]`, `δ_ctx = obs.delta[ci]` (spawn
  cell; bag means as fallback), `areaT = 0`, `fillT = 0`

```
order  = clamp01( 0.55*κ_ctx + 0.15*(1 - clamp01(δ_ctx / SCHED.deltaRateNorm))
                + 0.20*areaT + 0.10*fillT )
durationSec  = DUR_MIN * (DUR_MAX / DUR_MIN)^order          // log-space lerp
attackFrac   = lerp(ATT_MIN, ATT_MAX, smoothstep(order))
releaseFrac  = lerp(REL_MIN, REL_MAX, smoothstep(order))
q            = Q_MIN * (Q_MAX / Q_MIN)^clamp01(κ_ctx)       // spectral purity
```
Starting constants (all NEGOTIABLE, add to `SCHED`):
`DUR_MIN 0.03`, `DUR_MAX 2.2`, `ATT_MIN 0.04`, `ATT_MAX 0.30`,
`REL_MIN 0.12`, `REL_MAX 0.34`, `Q_MIN 0.8`, `Q_MAX 8.0`.
- `q` is a new `GrainSpawnEvent` field; worklet drops its interim
  regime-default Q from A2.
- Keep the `regime` field on events (stats/overlay use it) but nothing
  audible may branch on it anymore.
- Packing math needs no change: `packHz = desired / durationSec` still holds;
  chaos representative duration (`durationChaosMean`) becomes the same law
  evaluated at bag means. This also fixes F8 (higher δ → lower order →
  shorter grains) by construction.
- Delete: `calmDurMin/Max`, `chaosDurMin/Max`, `calmAttackFrac`,
  `calmReleaseFrac`, `chaosAttackFrac`, `chaosReleaseFrac`,
  `durationChaosAt`, `durationFromRegion` (folded into the unified law).
  Worklet `ENV_ATTACK/RELEASE_*` defaults may stay as fallbacks.

**B2. δ-weighted chaos spawning**
In the chaos spawn loop, replace uniform cell pick with rejection sampling:
```
for try in 1..8:
  ci = chaotic.cells[random]
  if random() < obs.delta[ci] / max(1e-4, δ_bagMax): accept
fallback after 8 tries: accept last candidate
```
Track `δ_bagMax` while building the chaos bag in `FieldObserver.buildChaotic`
(one extra `max` per cell — add `maxDelta` to `ChaoticArea`).
Also lower the rate floor so static fields go quiet:
`chaosPackRateMin: 0.55 → 0.10`. (Keep the floor > 0 so a *slowly* evolving
heterogeneous field still whispers; 0 is defensible but check by ear.)

**B3. Window law in seconds + saturation focus + wrap (F4, F5, F6)**
Replace `sampleWindowFromHue` + `calmSampleHalfFor`:
```
sat        = (max(r,g,b) - min(r,g,b)) / max(1e-4, max(r,g,b))   // HSV S
halfSec    = lerp(WINDOW_HALF_MIN_S, WINDOW_HALF_MAX_S, 1 - sat)
sampleCenter = rgbToHueNorm(r,g,b)          // unchanged hue law
sampleHalf   = min(0.49, halfSec / bank.durationSec)
```
Constants: `WINDOW_HALF_MIN_S 0.06`, `WINDOW_HALF_MAX_S 0.8`.
- Events carry `sampleCenter/sampleHalf` (A4 wire format); remove the
  `sampleLo/sampleHi` translation shim from `AudioEngine`.
- Scheduler needs `bank.durationSec`: pass it into `GrainScheduler.step` via
  the batch call in `main.ts` (`audio.getBank()?.durationSec ?? 1`), or set it
  on the scheduler when a source loads. Either is fine; keep it explicit.
- Grey now degrades gracefully: sat→0 widens the window to ±0.8 s instead of
  snapping centre to 0.5. `rgbToHueNorm`'s grey guard can stay as-is (with a
  wide window the centre barely matters).
- Delete `calmSampleHalf`, `calmSampleHalfMax`, `chaosSampleHalf`,
  `lengthNorm` (see B5), and `SCHED.stepsPerSec` if now unused.
- Move onset jitter here from the A5 shim: `startOffsetSec =
  Math.random() * dtSec` using the scheduler's real step interval.

**B4. Delete the Y-spread special case (S3)**
Remove the `fillRatio`/height conditional re-pick in `spawnCalm`,
`pickNearestCellInColumn`, `ySpreadFrac`, `ySpreadFillMin`. Uniform mask
sampling already yields the region's true Y distribution.

**B5. Drop ℓ from the law inputs**
With B1+B3, `meanLength` no longer feeds anything. Leave the field on
`CoherentRegion` for one phase (Phase C removes the measurement) so B and C
stay independently revertable.

**Phase B acceptance**
- Sweep `Var →` through ~20 equations: duration/attack/purity vary visibly
  per `listen` stats and audibly; no two-mood snap. Overlay + budget meters
  behave as before (area share untouched).
- Freeze a heterogeneous pattern (pause CA): audio decays to near-silence;
  unpause: sound returns where change resumes.
- A moving glider/front produces localized, travelling spatter (pan follows
  the front's X extent).
- 10 s source vs 3 min source: comparable texture for the same CA state.
- Listening-gate rows in Phase E all pass.

### Phase C — Observer simplification (S2)

`src/field/FieldObserver.ts`:
- Delete `measureCoherenceLength`, the per-cell `coherenceLength` array, its
  `reset`/`observe` writes, `lengthColourEps`, `lengthMaxSteps`, and
  `CoherentRegion.meanLength` (+ its accumulation in `extractRegions`).
- Remove `coherenceLength` from `FieldObservation` and `emptyObservation`.
- Grep for remaining consumers first (`RegionOverlay`, verify scripts, window
  debug) and update them.
- Measure main-thread frame time before/after (expect the observe pass to drop
  by roughly a third); note it in the commit message.

### Phase D — Optional, each gated on its own listening decision

**D1. Doppler rate at spawn (F11).** Add `rate` to events:
`rate = clamp(1 + region.velX * DOPPLER_PER_CELL, 1±DOPPLER_MAX)` with
`DOPPLER_PER_CELL 0.01`, `DOPPLER_MAX 0.04`; frozen at spawn; chaos grains
`rate = 1`. Worklet: `readPos += dir * rate` + 2-tap linear interpolation in
the PCM read. **Before implementing:** add a listening-gate row; if it fails,
revert cleanly (one event field + one worklet line).
**D2. Perceptual sample map.** Offline (in source prep): segment the mono PCM
into ~250 ms hops, compute spectral centroid per segment, build a
`hue → file-position` lookup sorted by centroid, smoothed so adjacent hues map
to adjacent-centroid segments. `sampleCenter = lut(hue)` instead of raw hue.
Makes "similar colours sound similar" perceptually true (CataRT precedent).
**This changes the letter of Sonic Law 2 — needs a creative sign-off recorded
in the brief before implementation, not just a gate row.**

### Phase E — Contract, docs, and gate updates (ship with A/B/C as relevant)

`npm run verify` assertions that must change:
- `verify-phase1.mjs:33,115-116` — remove/replace `meanLength` assertions
  (Phase C).
- `verify-phase2.mjs:65` — remove "ℓ drives calm sample + duration"
  (Phase B/C); replace with "saturation drives window width"
  (`/WINDOW_HALF|sat/` on scheduler) and "unified continuous law"
  (`/order/ && /DUR_MIN/`).
- `verify-phase2.mjs` chaos asserts — keep pack-to-share asserts; add
  "δ-weighted chaos spawn" (`/maxDelta|δ_bagMax|rejection/`-ish literal:
  assert `/obs\.delta\[ci\]/` in the chaos spawn path).
- `verify-phase4.mjs` — keep: freeze-at-spawn, no-smoothing, bounds-not-
  rewritten, equal-amp. Add: "no regime-branched audible params in worklet"
  (assert worklet has no `regime === "calm" ?` around gain/duration/Q once B1
  ships), "analytic envelope (no envelope table cache)"
  (`!/windowCache/`), "per-grain filter present" (`/ic1eq/`).
- New assertions to add: source message has no `bins`
  (`!/msg\.bins/` in worklet), seam crossfade present in source prep
  (`/SEAM_FADE/` in spectral.ts), onset offset honored
  (`/startOffsetSec|delaySamples/`).

Docs to update in the same commits:
- `scripts/audio-system-report.md` — new pipeline table (per-grain filter, Q
  law, δ-weighted spawn, windows-in-seconds, saturation law).
- `scripts/listening-gate-sonic-laws.md` — add rows:
  - [ ] Order→disorder sweep glides through intermediate grain materials
  - [ ] Paused/static heterogeneous field decays to near-silence; resumes with change
  - [ ] Chaos is broadband; calm rings narrow; mid-κ sits between
  - [ ] Vertical region drift glides in spectrum (no stepping)
  - [ ] Long source file (≥3 min) loads fast; texture matches short-source behaviour
  - [ ] No 30 Hz machine-gun comb in dense chaos; no normalisation pumping
  - [ ] Grey areas sound diffuse (wide window), saturated areas focused
- `Creative Brief v4.txt` — after V4.1 passes its listening gate (not before),
  append to the rebuild section: spectral bank replaced by per-grain filter
  (Y law unchanged), note the KEEP-list deviation for `spectral.ts`, and record
  the new negotiable constants. Do not edit the Sonic Laws text.
- `Implementation Filter.txt` — refresh module list + negotiable tuneables.

---

## 8. Constants quick reference (all NEGOTIABLE, starting values)

| Constant | Where | Value | Meaning |
|---|---|---|---|
| `SEAM_FADE_SEC` | spectral.ts | 0.05 | loop-seam crossfade for wrap-safe windows |
| `FILT_FMIN` / `FILT_FMAX` | worklet | 80 / 12000 | Y→cutoff exponential range (Hz) |
| `DUR_MIN` / `DUR_MAX` | SCHED | 0.03 / 2.2 | unified grain duration range (s, log-lerp by `order`) |
| `ATT_MIN` / `ATT_MAX` | SCHED | 0.04 / 0.30 | attack fraction range (chaos→calm) |
| `REL_MIN` / `REL_MAX` | SCHED | 0.12 / 0.34 | release fraction range |
| `Q_MIN` / `Q_MAX` | SCHED | 0.8 / 8.0 | κ→filter Q (spectral purity) |
| `WINDOW_HALF_MIN_S` / `MAX_S` | SCHED | 0.06 / 0.8 | saturation→window half-width (s) |
| `chaosPackRateMin` | SCHED | 0.55 → 0.10 | rate floor as δ̄→0 (static fields ≈ quiet) |
| `NORM_MIN` / `NORM_MAX` | worklet | 0.25 / 3.0 | normalisation gain clamp |
| norm attack / release coeff | worklet | 0.25 / 0.004 | per-block; ≈3 ms protect / ≈0.7 s recover |
| `DOPPLER_PER_CELL` / `DOPPLER_MAX` | SCHED (D1) | 0.01 / 0.04 | optional velocity→rate at spawn |

Weights inside `order` (0.55 κ / 0.15 stability / 0.20 area / 0.10 fill) are
the first knobs to touch if the continuum feels biased calm or chaotic.

## 9. Out of scope / do-not-do (restated for future agents)

- Anything on the brief's FORBIDDEN list (lattice ears, voice ownership,
  luminance→volume, mid-grain scrub chase, colour→loudness, aesthetic
  optimisation, activity buying loudness/budget).
- No smoothing on region pan/Y follow (validated doctrine; verify pins it).
- No reverb/delay/effects rack; the per-grain filter is the Y-law renderer.
- Don't refactor module structure, rename files, or "clean up" beyond the
  edits listed — the owner has deferred architecture work deliberately.
- Don't implement Phase D items together with A–C, and never without their
  listening decisions.
