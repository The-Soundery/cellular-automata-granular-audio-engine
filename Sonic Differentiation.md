# Sonic Differentiation — Plan

**Goal: two different CA rules should sound different.** Everything here is
judged against that and nothing else.

Detailed reasoning, rejected options and the arguments behind each decision are
in `Sonic Differentiation - Working Notes (archive).md`. This file is the plan.

Nothing has been implemented, heard, or measured yet.

---

## Why every rule currently sounds the same

**1. The scrub clock drags every region through the whole source file.**
Each calm region and the Static pool holds a `scrubSec` accumulator that offsets
every new grain's read position, advancing roughly 9 seconds of source per 30
seconds of listening. Colour picks a *starting* position and elapsed time then
drags it everywhere. Elapsed time is identical in every simulation, so all rules
converge on playing all the material.

**2. Sample windows are up to 1.6 seconds wide.** Window width comes from region
area, so a colour selects a large vague chunk of audio rather than one specific
sound. Even frozen in time, colour would not identify a timbre.

**3. All five regimes run the same formula.** Calm, static, chaos and osc all
call `grainMaterial` with different inputs; flow carries an inline copy. They are
five points on one continuum, which is why they blend instead of sounding like
categorically different things — even though the detector already distinguishes
them sharply.

---

## The three axes that separate two rules

| Axis | Mechanism | How reliably do rules differ on it? |
| --- | --- | --- |
| Palette | colour → material | **Confirmed.** Rules reliably settle into different, often very small, colour sets |
| Morphology | region shape → filter bandwidth | High. Streaks, blobs and dust always look different |
| Regime mix | how much calm / static / flow / chaos → grain behaviour | High |

Palette is the strongest axis because material dominates timbre, and it is now
confirmed rather than assumed. Phase 1 builds it.

**Consequence of "often just a few colours":** a simulation may play only two or
three windows for its whole life. That makes *repetition*, not vagueness, the
main risk — and it is why the window minimum below is set as high as it is.

---

## Phase 1 — a colour plays one specific sound

The core fix. Three changes, all subtractive except one.

**Delete the scrub clock.** Remove the `scrubSec` accumulator, `SCRUB_RATE_MAX`
and `deltaRateNorm` from `GrainScheduler.ts`. It is also redundant: it only
advances when a region is changing, and a changing region's colour is already
selecting different material.

**Give windows their real boundaries.** The slicer already cuts the source into
onset-aligned units and already knows where each starts and ends — then discards
those bounds and reinvents a width from region area. Keep `startPos` / `endPos`
on `MaterialSegment` in `spectral.ts` and use them. Delete `WINDOW_HALF_MIN_S`,
`WINDOW_HALF_MAX_S` and the `sizeT` lerp in `sampleWindowFromColour`.

**Set the minimum window length to 300 ms**, enforced at slice time by having
the onset detector refuse to open a new unit within that interval of the last
one. Three independent floors, take the largest:

- **Timbre needs 50–80 ms** to register as timbre rather than a click. At 80 Hz,
  the bottom of the filter range, one cycle is 12.5 ms, so even three cycles is
  38 ms.
- **The analyser cannot resolve finer than ~93 ms.** `CENTROID_HOP_SEC` is
  0.046439 with a 2048-sample FFT, so a sub-two-hop segment has no interior.
- **Ping-pong periodicity binds hardest.** A window traversed back and forth is
  periodic at `1 / 2W`. At 150 ms that is 3.3 Hz, an audible undulation; at
  300 ms it is 1.7 Hz, which reads as slow drift rather than repetition.

`SEGMENT_MAX_SEC = 1.0` already caps the other end, giving a 300 ms – 1 s band. A
30-second source currently yields roughly 29 segments, far more than a few-colour
simulation needs, so the length is affordable.

Unmeasured: the actual distribution of segment lengths for a real source, which
decides how often the minimum binds at all.

**Make colour to material absolute.** Remove `sustainedSubset`,
`SUSTAINED_SUBSET_QUANTILE`, `SUSTAINED_ATTACK_GAP`, the `RegimeMaterialBias`
type and the `regimeBias` argument. Currently the same colour resolves to
different material depending on regime.

The problem `sustainedSubset` was solving is real — a calm grain landing on an
attack transient repeats it — so replace it with **read placement inside the
window**: colour picks the window, regime picks where to read within it. Calm
reads past the onset, chaos reads at it. Segments are already onset-aligned, so
the attack's location is known.

**Grains stay inside their window by bouncing, not by being cut short.** A grain
that reaches the end of its window reverses and reads back (ping-pong). This is
the mechanism that keeps a grain inside the material its colour selected, and it
means grain length is free of window length entirely — including at half and
double speed, where a grain simply bounces more or less often.

---

## Phase 2 — morphology becomes audible

Bandwidth follows a region's vertical extent, so a thin band sounds thin and a
large mass sounds wide. This is the existing Y-to-frequency law applied to a
region instead of to a single cell, and it needs no new constants.

A region spanning `Δy` of grid height spans a frequency ratio `r = 150^Δy`
(because `FILT_FMAX / FILT_FMIN = 12000 / 80`), and a bandpass covering that
ratio has `Q = √r / (r − 1)`. One row gives Q ≈ 25.5; ten rows Q ≈ 2.5; half the
grid Q ≈ 0.31.

**Each grain gets its share of the extent**, so a large region covered by many
grains has each grain narrow and the set of them tiles the full span, while the
same region with few grains gets wide bands. Thin structures sound thin at any
seat count.

Required changes in `GrainScheduler.ts` and `public/grain-processor.js`:

- `Q_MIN` from 0.8 down to ~0.1, `Q_MAX` from 8 up to ~26. The current ceiling is
  the binding problem — a one-row structure wants Q ≈ 26 and can only reach 8.
- Drive Q from per-grain share of vertical extent, not from `similarity`.
- Replace the `Q_MAX_SHORT` duration lerp with a ceiling based on centre
  frequency and grain length. A short grain can carry a very high Q at 12 kHz and
  only about Q 4 at 80 Hz; the current constant is frequency-blind.
- **Bug, unrelated but in the same file:** `ic1eq` / `ic2eq` are zeroed only in
  the `GrainVoice` constructor, so a recycled voice inherits the previous grain's
  filter state at a different centre frequency. Reset on spawn. Worth pointing
  the existing click probes at.

Filter sweeps are wanted here, not avoided — a structure moving up the grid
sweeps its band up through the source, and that is one of the strongest
visual-to-audio ties available. This is not Doppler; material pitch never changes.

---

## Phase 3 — regimes sound categorically different

The five states are **Calm, Static, Chaos, Flow, Osc** — the names in the metrics
panel. There are no others and no sub-states.

### Evidence: a fully frozen field, measured

Screen recording of a settled Utomata field, 6.9 s at step ~1970–2070. Frame
difference over the CA canvas across 5.5 s and ~160 steps:

```
lavfi.signalstats.YAVG=0.297      # out of 255 — codec noise
```

The field is completely motionless. The panel reads:

```
CALM   1/1          REG  #2 34 k.94 1/1 a99
STAT  63/63              #1 27 k.97 0/0 a99
CHAOS  0/0               #5 26 k.97 0/0 a99
OSC    0/0               #3 24 k.94 0/0 a99
FLOW   0/0               #4 24 k.98 0/0 a99
BUDGET 64/64             #6 24 k.99 0/0 a99
```

Two separate defects, both visible here:

1. **Six coherent regions are detected and five are silent.** Areas 24–34, κ
   0.94–0.99, all aged out at a99 — and `0/0` seats each. Seat allocation is
   area-proportional, so region areas of 24 in a field where the leftover bag
   holds thousands of cells round to nothing. Detected structure that makes no
   sound.
2. **The 63 Static grains are not regions at all.** Traced through
   `spawnTexture` (`GrainScheduler.ts:1659`), each grain independently:
   - picks a random cell across the **whole grid** — `pickStratifiedSite` is
     called with centre `(w-1)/2, (h-1)/2` and spread `w/2, h/2`, because "a bag
     has no COM"
   - takes `r,g,b` from **that one cell**, so 63 grains fetch 63 different
     colours and therefore 63 different material windows
   - sizes its window from `areaT(textured.area)` — the bag is nearly the whole
     grid, so every window is at maximum width
   - takes `readOffset` full-width random, which the worklet turns into
     `readPos = windowCenter ± windowHalf`

   Sixty-three voices, every colour at once, widest possible windows, each
   reading a random point inside its window. That is "grains all over the
   waveform", and `regionId: -1` is why nothing is positioned.

   Scrub is a *secondary* contributor here, not the main one:
   `textureScrubSec += dtSec × 1.0 × clamp01(meanDelta / 0.35)` at line 818, and
   a frozen bag has `meanDelta < 0.045`, so it creeps at under 13% of real time
   rather than racing. It does accumulate without bound, so it still needs to go,
   but the travelling you heard is mostly the 63 independent colours and the
   full-width read offset.

So Static is not mis-thresholded — `detectTexturedArea` correctly found the
frozen area. It is that the frozen area is delivered as **one undifferentiated
bag** rather than as located, single-colour masses.

### The root cause: one score multiplies space by time

```
κ = similarity × stability          // FieldObserver.ts:645
```

`similarity` is spatial (how like its neighbours a cell is). `stability` is
temporal (how little it changed). Multiplying them means there are two completely
different ways to fail the calm gate — *moving* and *spatially busy* — and the
product cannot tell them apart. Everything that fails either way lands in the
same leftover bag.

Your three definitions sit on those two axes independently:

| | spatially coherent mass | broken up |
| --- | --- | --- |
| **moving** | **Calm** — moving mass | **Flow** if it has a heading, **Chaos** if not |
| **frozen** | **Static** — frozen mass | **Static** — still frozen, just more colours in it |

Stillness spans the whole bottom row. So **stillness must be the first split, and
it must be temporal only.** Coherence then does its real job: segmenting the
moving cells into calm masses and separating Flow from Chaos.

### Fix 1 — split on stillness before coherence

A cell with `deltaSmooth` below the stasis line is Static, whatever its
neighbours look like. Reuse the existing `chaosDeltaMin = 0.045`; the code already
treats smoothed δ below it as stasis, at `FieldObserver.ts:2386` and `:2190`, so
no new constant. Hysteresis on the enter/exit pair, as calm has for κ, or long
frozen drones will flicker in and out.

**This is what guarantees Calm and Static never get confused.** The test is
per-cell, temporal, and mutually exclusive: the interior of a moving calm mass is
moving, so it cannot qualify as static no matter how uniform its colour is. Your
worry about static latching onto the centre of a calm region cannot happen,
because coherence is not consulted. And a calm mass that genuinely stops moving
*becomes* static — which is the behaviour you want, not a failure.

### Fix 2 — group the frozen cells by colour, not by contiguity

This is the piece that makes "detect the individual colours that are static"
implementable, and it is why spatial flood-fill was never going to work on the
recorded field: those frozen stripes are near-pixel-scale, so no amount of
threshold tuning finds coherent masses in them. But there are only about five
colours present.

So replace the single bag with **one group per distinct frozen colour**. Cluster
in hue plus a dark/desaturated bin (the material map is polar HSV, so hue is the
axis that already selects material), keep bins above a minimum cell count, merge
the rest into the nearest kept bin. Cheap, deterministic, and stable frame to
frame — which matters when these are multi-second drones.

Each group then has what the bag lacked:

- **one mean colour → one material window.** Colour = material restored, and a
  static red group plays the same material as a calm red region because it calls
  the same `sampleWindowFromColour`.
- **a centre of mass from its own member cells → real pan.** Computed with the
  circular mean already used for flow at `FieldObserver.ts:2314`, since the grid
  is a torus.
- **a Y extent from its own members → real filter band and Q**, instead of
  per-cell Y scattered across the spectrum.
- **its own area → its own seat share and its own window width**, rather than
  every window sitting at maximum because the bag covers the grid.

N groups gives N frozen voices, so it sounds like several things at once *only*
when several colours are genuinely frozen — and each one still sounds like its own
colour.

### Fix 3 — every detected region gets at least one seat

Guarantee one seat per detected region or colour group before area-proportional
distribution runs, prioritising by area if they ever outnumber the budget. Without
this, defect 1 above persists into the new scheme and small frozen colour groups
stay silent.

### What Static needs to sound like

A small, specific frozen moment: heavy overlap over a **short read span** inside
one window, producing a consistent frozen-in-time drone.

Once each frozen colour group is its own voice, all of its grains share one
material window. What remains is to stop them scattering inside it:

```
// GrainScheduler.ts:2378, pickStratifiedSite
return { ci, fallbackU, readOffset: rand() * 2 - 1 };
```

Full-width random, for every grain in every state. **Static instead uses a narrow
read span** — a few milliseconds wide rather than the whole window. Not zero, so
that overlapping copies are not bit-identical and summing coherently, and with
onsets staggered rather than positions staggered.

Its seats come free: the frozen area already commands most of the budget, so
dividing 63 seats across five colour groups leaves each group with roughly a dozen
concurrent grains on one window at one read point. That is a dense frozen drone
without adding any voices.

The other two behaviours a frozen drone needs are long grains and no file
travel — long grains follow from the duration mapping once change rate is low, and
the travel is removed by deleting scrub and narrowing the span.

### Grain behaviour per state

| State | Sonic intent | Grain length | Read span | Direction | Envelope fades |
| --- | --- | --- | --- | --- | --- |
| Calm | alive, breathing, moving | 1–2 s | most of the window | ping-pong, random start | ~25% |
| Static | frozen drone, one moment | 2–3 s | a few ms | ping-pong | ~30% |
| Chaos | particulate spray | 20–50 ms | whole window | forward, read at onsets | fast attack, long release |
| Flow | audible motion | 300–500 ms | whole window | one direction, from velocity sign | ~15% |
| Osc | rhythmic pulse | 0.35 × period | whole window | alternating with phase | as now |

Read span is the whole calm/static difference. Everything else about them is
similar, which is correct — a static region *is* a calm region that stopped.

Overlap is not a parameter to set — it is whatever the seat allocation gives, and
that is generous. A mid-size calm region gets about 8 seats from area, but
leftover budget only ever redistributes to calm, so it typically inflates to
19–20 with 13–17 sounding concurrently. A single large region can absorb the
whole 64.

Reasons behind the two non-obvious numbers:

- **Calm grains are long to stay responsive**, not only to be smooth. Grain
  lifetime is how fast the audio tracks a colour change, so 1–2 s follows the
  field without constant respawning.
- **Flow grains are long so they can sweep.** `applyTracks` moves pan and filter
  frequency on a *living* grain, so a 300–500 ms flow grain audibly travels
  during its life. That sweep is the motion cue; short grains lose it entirely.

Chaos at 20–50 ms rather than 15 ms so grains carry some timbre instead of
becoming a click track. Drop it if chaos should be harsher.

This deletes `order`, the single scalar that currently sets both duration and
envelope and lets a large chaotic area produce the same grain as a small calm one.

### Why ping-pong for Calm and Static

It gives continuous sound with no boundary to handle, and it makes grain length
independent of window length — which is what removes the collision between long
grains and the half/double-speed stems.

Head crossings are not a concern at these seat counts: three heads bouncing in
one window would cross audibly, but thirteen to seventeen at random phases
average out, and density makes it smoother rather than worse.

**Combine it with reading past the onset.** Segments are onset-aligned so the
attack sits at the window *start*; if the ping-pong range excludes the first
stretch, the attack is never hit in either direction. Reverse passes soften any
transients that remain, which is the cheapest transient avoidance available.

**Caveat that only ears settle:** ping-pong means hearing the source backwards
half the time. Unnoticeable on textural material, very noticeable on speech or
melody.

---

## Falls out free

**Freeze.** It is Static's read span, not a feature of its own: a narrow slice of
the window with the overlap the region already has. Long grains and scrub-stopping
already happen for still regions, and narrow windows arrive with Phase 1. No new
DSP, no new voice type, no resonance and no ringing frequencies.

A field settling into several still colours gives several frozen voices, each on
its own colour's material, each positioned at its own region's X and Y. A field
settling to one colour gives one frozen voice. That is the intended design and it
needs no new machinery.

Freeze is a *character* feature rather than a differentiation one — it does not by
itself make two simulations sound unlike each other. It arrives free rather than
earning its own phase.

---

## Deferred

Not wrong, just not serving the goal yet: read rate and octave registers,
loudness from correlation, oscillator-specific work (they are rare), and audible
region births / deaths / merges.

**Explicitly not pursuing: differentiating chaos.** A grain that short carries
little timbre, so chaotic rules will sound alike regardless. Chaotic rules also
all look like noise, so this is honest rather than defeatist.

---

## Nothing left to decide before starting

Every number above is a defensible starting point with a stated reason, and the
remaining questions are all listening calls that require the thing to exist
first. In rough order of how likely they are to need changing:

- **300 ms minimum window.** Raise it if calm sounds repetitive; lower it if
  timbres feel indistinct.
- **Whether ping-pong suits the source.** Reversed audio is unnoticeable on
  texture and obvious on speech or melody. If it fails, the fallback is
  forward-only with grain length capped to window traversal.
- **Chaos at 20–50 ms.** Drop toward 15 ms for a harsher, more particulate spray.
- **Calm and static grain lengths.** Longer is smoother but slower to track the
  field.
- **Where the Calm/Static stasis line sits.** Reusing `chaosDeltaMin = 0.045`
  costs no new constant but may be generous — a region drifting slowly would read
  as frozen. Lower it if Static catches things that are visibly still moving.
- **How wide Static's read span is.** Too narrow and it buzzes; too wide and it
  stops sounding frozen.

Unmeasured, and worth a probe at some point but not blocking: the actual
distribution of segment lengths for a real source, and the spawn-rate cost once
grain lengths change.

---

## Closed — do not re-litigate

- Colour to material is absolute. No regime-dependent material selection.
- No pitch shifting of material. Filter sweeps are fine; Doppler is not.
- No ringing or resonant freeze. No phase vocoder.
- Loudness may vary, via correlation physics rather than a mix decision.
- **Ping-pong is the boundary mechanism for sustained regimes.** It was argued
  both ways twice; it is settled. Grain length is independent of window length.
- **The five states are Calm, Static, Chaos, Flow, Osc**, as named in the metrics
  panel. No sub-states, no "texture" as a state name — `TexturedArea` is the code
  identifier for the Static pool.
- **Stillness is a temporal test, taken before coherence.** `κ = similarity ×
  stability` multiplies a spatial property by a temporal one, so it cannot
  distinguish "moving" from "spatially busy" and dumps both into one bag. Calm is
  a moving mass, Static is a frozen mass of any size, Flow is broken-up motion
  with a heading. Splitting on δ first makes Calm and Static mutually exclusive
  by construction.
- **The frozen area is grouped by colour, not by spatial contiguity.** Measured
  on a settled field: frozen stripes are near-pixel-scale, so no coherence
  threshold finds masses in them, but only about five colours are present. One
  voice per frozen colour, each with its own COM, Y extent and material window.
- Dropped for good: `fillRatio` mappings (four incompatible definitions in the
  codebase), colourSpread to material spread, flow heading as a separate gesture,
  oscillator harmonic intervals.
