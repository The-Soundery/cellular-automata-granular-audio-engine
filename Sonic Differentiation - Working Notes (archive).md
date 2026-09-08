# Sonic Differentiation — Working Notes

Status: EXPLORATORY. Nothing here is law yet. This is the discussion document for
why every CA rule sounds alike and what we might do about it.
North star: `Creative Brief.txt` · Constraints: `Implementation Filter.txt`

Working agreement: the Sonic Laws are treated as *amendable*. Ideas are explored
on merit first; brief and Implementation Filter updates come later, describing
only what survives listening.

---

## 1. The core diagnosis

Every sonic parameter is drawn from a single cell at a single instant, and then
several mechanisms actively average what little variation remains. `GRID_SIZE = 128`
(16,384 cells) with `GRAIN_BUDGET = 64` — each grain samples about 1/256th of the
field.

Four specific flatteners, in order of how much they now look to matter:

1. **The scrub clock** drags every active region across most of the source file
   within tens of seconds, so all rules end up playing all the material (§3a).
2. **Wide sample windows** — up to 0.8 s half-width, so one grain smears 1.6 s of
   file and colour maps to a *region* of material rather than a point (§4).
3. **Q constants too narrow to express structure** — `Q_MIN = 0.8`, `Q_MAX = 8`,
   where the geometry actually calls for roughly 0.08 to 26 (§2).
4. **One scalar (`order`) sets both duration and envelope**, so a large chaotic
   area and a small calm area can produce identical grains (§5).

Underneath all four is a structural point: the five detected regimes differ only
by *parameter values on one shared continuum*, never by *mechanism*. All of
calm, static, chaos and osc funnel through `grainMaterial`, and flow carries an
inline copy of the same formula. That is why the regimes blend into each other
instead of sounding categorically different (§7).

---

## 2. The Y axis — the centrepiece

### 2a. Bandwidth is not a new law

"A thin horizontal band should sound thin on the spectrum, a larger area should
sound wider" is the existing Y-to-frequency law applied to a region's **vertical
extent** instead of to a single cell.

The worklet maps Y to frequency as a log sweep:
`fc = FILT_FMIN * (FILT_FMAX / FILT_FMIN)^y`, with `FILT_FMAX / FILT_FMIN = 12000 / 80 = 150`.

So a region spanning `Δy` of grid height spans a frequency *ratio* `r = 150^Δy`,
and for a bandpass with geometric centre, `Q = √r / (r − 1)`:

- 1 row of 128 → r = 1.040 → **Q ≈ 25.5**
- 2 rows → r = 1.081 → **Q ≈ 12.8**
- 10 rows → r = 1.479 → **Q ≈ 2.5**
- half the grid → r = 12.25 → **Q ≈ 0.31**
- full grid → r = 150 → **Q ≈ 0.08**

Derived, not tuned. Zero free parameters. A grain's band *is* the rows its
structure occupies, mapped through the same law that already sets its centre
frequency.

### 2b. The current constants are the binding problem

`Q_MIN = 0.8` and `Q_MAX = 8` cannot express either end of that range. A one-row
structure wants Q ≈ 26 and can only reach 8 — which is exactly why thin bands do
not sound thin. Both constants need to move: floor toward ~0.1, ceiling toward
~26 or beyond.

Very low Q on the state-variable bandpass is barely a filter at all, which is the
correct behaviour for a full-height region.

### 2c. Each grain's band is its share of the extent

This resolves the allocation tension. If a region's vertical extent is divided
among the grains covering it:

- A 40-row region with 4 grains → about 10 rows each → Q ≈ 2.5, wide per grain.
- The same region with 20 grains → about 2 rows each → Q ≈ 13, and those bands
  *tile* to cover the full 40-row span.
- A 2-row region with 1 grain → 2 rows → Q ≈ 13, thin.

So thin structures sound thin, large structures with few grains sound wide per
grain, and large structures with many grains sound wide in ensemble. All three
intents hold simultaneously, and it self-normalises against seat count without
touching `allocateShares`.

### 2d. What is currently implemented (and is backwards)

Q is set in exactly one form, at two call sites (`grainMaterial` line 1548 and
`spawnFlow` line 2160):

```
q = SCHED.Q_MIN * Math.pow(qMax / SCHED.Q_MIN, spectralT)
spectralT = clamp01(similarity)
qMax = lerp(Q_MAX_SHORT /*3*/, Q_MAX /*8*/, clamp01(durationSec / 0.25))
```

`spectralT` is spatial colour similarity only — extent never enters. The one
indirect path is inverted: larger area gives larger `order`, longer
`durationSec`, and therefore the *higher* `qMax` ceiling. **Large regions
currently get narrower filters than small ones.**

The `durationSec` lerp is a frequency-blind stand-in for a real constraint;
§4f replaces it with a frequency-and-length ceiling.

Consequence for the brief: §2's "spatial similarity → Q" law is retired.
`similarity` is not orphaned — it takes read-offset spread instead (§8).

### 2e. Filter sweeps are wanted, not a hazard

Correction to earlier notes: the concern was Doppler — changing the *pitch* of
the material — not filter motion. Sweeping a narrow band through the source is
fine and desirable.

This turns an earlier warning into a feature. `applyTracks` already updates
`yNorm` and recomputes `fc`, so a structure moving up the grid sweeps its band up
through the source. With Q tightened, that becomes one of the strongest
visual-to-audio ties available and needs no mitigation. Vertical motion becomes
audible as vertical motion.

### 2f. Chaos and per-cell spawns

Chaos clusters carry `cells`, so vertical extent is computable for them too — a
tall storm gets broad bands, a compact one narrow. No special case needed. The
residual scatter bag has no meaningful extent and falls back to per-cell, which
means narrow.

---

## 3. Colour to material — the identity chain

**Decided: colour to material is absolute.** The same colour means the same
material regardless of regime. This is the primary route to different rules
sounding different, and two separate mechanisms currently break it.

### 3a. The scrub clock — redundant, not just too fast

**What it does.** Each calm region and the texture pool holds a `scrubSec`
accumulator, and every new grain's sample centre is offset by it:

```
sampleCenter = wrap01(win.sampleCenter + scrubSec / bankDur)
clock.scrubSec += dtSec * SCRUB_RATE_MAX * clamp01(region.meanDelta / deltaRateNorm)
```

`SCRUB_RATE_MAX = 1.0` file-second per real second at full activity. A region at
δ ≈ 0.1 advances about 0.29 file-seconds per real second — roughly 9 seconds of
source per 30 seconds of listening. Colour picks a *starting* position and
elapsed time then drags it through the whole file.

**Why this is the main cause of every rule sounding alike.** If all regions
traverse all the material, then no matter how different two rules' colour
distributions are, both end up playing the same source content. It converts a
*spatial* mapping (colour to position) into a *temporal* one (elapsed time to
position), and elapsed time is identical across every simulation.

**The stronger argument: it is redundant.** The clock is δ-scaled, so it advances
only when the region is changing — but when a region is changing, its colour is
already changing, and `queryMaterialFromHsv` is already returning a different
segment. The scrub adds a second, colour-independent motion on top of a mapping
that already moves.

It is also backwards against its own justification. The brief's §5 rationale is
that a static region should not be a frozen loop, but a static region has δ ≈ 0
and the clock does nothing for it. The clock is most active exactly where colour
already supplies evolution, and inert exactly where evolution was wanted.

**Options.** Drop it (preferred — costs no evolution, because colour change
already provides it); or bound it so position wanders only within a neighbourhood
of the colour's segment, oscillating rather than drifting.

### 3b. The regime bias — removed

`sustainedSubset` restricted calm and texture to the high-stationarity half of
the segments (`SUSTAINED_SUBSET_QUANTILE = 0.5`), with a further gap punched
around attack peaks (`SUSTAINED_ATTACK_GAP`), while chaos and osc searched the
full map. So a mid-grey cell resolved to *one* segment as calm and a *different*
one as chaos — a second break in colour to material, independent of scrub.

Under the absolute decision this goes. Dead as a result:
`sustainedSubset()`, `SUSTAINED_SUBSET_QUANTILE`, `SUSTAINED_ATTACK_GAP`, the
`RegimeMaterialBias` type, and the `regimeBias` argument threaded through
`queryMaterialFromHsv` and `sampleWindowFromColour`.

### 3c. Within-segment read placement — the replacement for regime bias

The problem `sustainedSubset` was solving is real: a calm grain landing on an
attack transient will repeat that attack, and under micro windows with overlap
(§4) it would repeat rhythmically. Removing the subset does not remove the
problem.

The resolution keeps colour to material absolute while still solving it.
**Colour picks the segment; regime picks where to read within that segment.**
Segments are already onset-aligned units — `buildPolarSegments` pins a unit's
`pos` to its onset hop when `firstAttack >= ONSET_ATTACK_MIN`, and uses the
energy-weighted centre otherwise. So the attack's location inside the unit is
already known. Calm can read past it; chaos can read straight at it.

This is not a break of colour to material: the material — the sound unit the
colour selected — is identical. Only the read offset inside it differs, and
read placement is already a per-grain concept via `readOffset`.

### 3d. Within-sim variety — accepted as-is

**Decided: material stays strictly tied to colour, and the other axes carry
within-sim variety.** A three-colour rule has three timbres, which is the point:
strong between-sim differentiation. Under the §8 mapping, even a two-colour field
still varies per grain in bandwidth (region extent), centre frequency (Y), pan
(X), duration (δ) and octave register (area). Material is the only fixed axis.

Consequently dropped: spreading material across a region's `colourSpread`, and
palette normalisation (rank-uniformising each rule's observed colour
distribution). Both were ways of manufacturing variety that is no longer wanted.

---

## 4. Windows belong to the audio; grains belong to the regime

**This section was rewritten. The earlier version had window width as a
per-regime constant, which was wrong.** A window is a property of the *source
material*, decided once at load time. The regime decides only grain length,
grain count, and overlap *inside* whichever window the colour selected.

The pipeline:

1. Source uploaded (optionally split into half / double-speed stems, §9c).
2. Sliced into windows, each at least a minimum length (~150 ms starting point).
3. Windows grouped by sonic character and placed on the colour space.
4. Colour selects a window. **Regime decides what to do inside it.**

The only runtime rule is **grain length never exceeds its window** — enough to
stop a grain wandering into material its colour did not select, and nothing more.
There is no global grain-length floor and no per-regime window width. Regimes
keep genuinely different grain lengths, which is what makes them sound
categorically different.

### 4a. Most of this already exists

Steps 2 and 3 are largely built. Segments are already onset-aligned rather than
fixed-grid — `ONSET_ATTACK_MIN = 0.45` with the stated intent that "window centres
land on musical units (a hit, a word, a swell) instead of arbitrary fixed-hop
slices" — and `buildPolarSegments` already embeds them into polar colour space by
spectral character.

**What is missing is the extent.** `MaterialSegment` keeps only `pos`, the
midpoint. The slicer computes each unit's boundaries while building it (an
`s0..s1` hop range) and then discards them, and window width is reinvented at
spawn time from region area via the `sizeT` lerp in `sampleWindowFromColour`.

That is the architectural bug, stated precisely: **the material knows where its
own edges are, and we throw that away in favour of a number derived from
something unrelated.** The fix is to keep `startPos` / `endPos` on the segment.

Deleted as a result: `WINDOW_HALF_MIN_S`, `WINDOW_HALF_MAX_S`, and the `sizeT`
lerp. `areaT` keeps its octave-register job (§9a); area keeps its §7 job of
buying concurrency. `WINDOW_HALF_ABS_MIN_S` (5 ms) stays as a safety rail.

### 4b. The minimum length is enforced at slice time

**Decided: the slicer never emits a sub-minimum window.** Rather than a merge
pass afterwards, the onset detector simply refuses to open a new unit within the
minimum interval of the last one — which is the same thing, expressed once. Every
window is then usable by every regime, which is what keeps colour-to-material
absolute (§3b).

Preference is to merge only sonically *similar* neighbours. That cannot always be
honoured: if a source has two dissimilar events 60 ms apart, any 150 ms window
contains both. **Honest consequence — dense source material yields windows
holding more than one event, and the only lever is the minimum itself.** The
similarity preference survives as a tie-breaker on *where* to place a boundary
when several onsets are candidates, not as a veto on merging.

Rejected: making short windows available only to short-grain regimes. It would
mean a colour resolving to different material depending on regime, which is
exactly the `sustainedSubset` behaviour removed in §3b.

### 4c. Grain length, count and overlap per regime

Windows are fixed by the audio. These are the regime's choices inside one.
Starting points to be tuned by listening, with the review of each below.

- **Calm** — long grains near the window length, ~3 overlapping. Smooth.
- **Static** — ~60 ms, ~3 overlapping, looping one short moment. The freeze (§6).
- **Chaos** — ~15 ms, no overlap, many grains across the region. Particles.
- **Flow** — ~100 ms, 2 grains at 50% overlap.
- **Osc** — grain length keyed to the oscillator period, well under it.

**Calm.** Accepted, and an earlier draft's objection to it was wrong. That draft
claimed three copies at 50 ms offsets would comb. **They do not.** Comb
*coloration* needs delays under roughly 10 ms, where nulls are spaced widely
enough (>100 Hz) to land in separate critical bands. At 50 ms the nulls sit about
20 Hz apart — far denser than a critical band — so the ear integrates them and
hears thickening, not hollowness.

Two refinements to how the offset is applied:

- **Stagger in time, not in start position.** Position-staggering hits the wall:
  three heads at equal thirds of a 150 ms window, each reading forward, leaves the
  third head only 50 ms of window. Time-staggering — all heads read from the
  window start, launched a third of the grain apart — gives constant separation
  with no wall contact, and is the standard granular arrangement.
- **Equal thirds is principled, not arbitrary.** With a raised-cosine envelope,
  three copies at exactly one-third spacing sum to *constant* amplitude: the three
  offset cosines cancel. So there is no amplitude ripple either. **This requires
  attack and release each at 50% with no flat top**, which constrains the
  `stationarity`-driven envelope shape for any overlapping regime (§5).

**Static.** Length is in the right zone, but the content of the window recurs at
the *respawn hop*, not at the grain length — for a 60 ms grain three-deep that is
a 20 ms hop and about 50 Hz. It works if the material is sustained and stutters
if it is a transient. Colour picks the window absolutely so the material cannot
be chosen — but *where inside it* to read can be, which is the §3c placement
rule. Also suggests **`stationarity` should set static grain length**: sustained
material tolerates a short freeze window, transient material needs a longer one.
Hop jitter is the primary mitigation (§6).

**Chaos.** Character right. One caveat that matters: a 15 ms fragment does not
carry timbre, so chaos will sound similar across rules regardless. Arguably
correct — chaotic rules do all *look* like noise — but chaos is not where
differentiation comes from.

The Q question is handled in §4f, not here. An earlier draft made chaos a
blanket wide-band exception on the grounds that a short grain "cannot carry" a
high Q. That was overstated and is superseded.

**Flow.** No objection. 50% overlap is the exact raised-cosine constant-power hop
for two grains, as one third is for three, so it is a principled default rather
than a guess.

**Osc.** Already implemented as `durationSec = max(DUR_MIN, OSC_DUTY × periodSec)`
with `OSC_DUTY = 0.35`, and the existing choice is better than matching the full
period. Fill the period and the oscillation becomes inaudible — the *gap* is what
makes a blinker sound like a blinker.

### 4d. Direction — forward and reverse per regime

Already wired and mostly unused. `voice.dir` exists, ping-pong flips it at the
bounds, and `direction` is a `GrainSpawnEvent` field. Flow and oscillating-flow
set it from horizontal velocity (`region.velX < -SCHED.velDirEps ? -1 : 1`);
calm, static, chaos and texture all hardcode `direction: 1`.

**Ping-pong: settled, and it never fires.** This flip-flopped twice, so the
argument is recorded rather than just the conclusion. Ping-pong looks attractive
in isolation because its turnaround is continuous in position — a slope change,
not a step — which is why it is the standard click-free loop. But **with multiple
heads in one window it makes them cross and momentarily coincide**, reading
identical material and summing coherently: a level spike several times a second.
Under the §4 rule that a grain never exceeds its window, no head ever reaches a
wall, so ping-pong simply never triggers and the heads hold constant separation.
The rule was right; the case for reviving ping-pong was reasoning about one head
instead of three. Ping-pong stays in the worklet as a safety rail only.

- **Calm — random forward or reverse per grain.** Worth having because it removes
  any sense of time direction, which is what calm is, and it adds free variety.
  Note this is a *weaker* claim than an earlier draft made: that draft said
  direction randomisation "solves the comb problem," but there is no comb problem
  at these offsets (§4c), and reverse does not fix the recurrence issue below
  either.
- **Static — forward, time-staggered, no ping-pong.** Freeze comes from continuous
  respawn, not from reversal (§6).
- **Chaos — random per grain.** Nearly free, adds texture breadth, low stakes at
  15 ms.
- **Flow — keep, but fix an asymmetry.** It tests horizontal velocity only, so a
  purely vertical flow always reads forward. Should use the dominant axis.
- **Osc — tie direction to oscillator phase.** Material runs forward on one phase
  and reverse on the other, mirroring the oscillator alternating between states.
  The `oscPhase` histogram already exists to drive it.

### 4e. Rate breaks the cap — the one real collision

The half and double-speed stems (§9c) invalidate a naive length comparison. A
150 ms window played at half speed takes 300 ms to traverse; at double speed it
takes 75 ms, so a 150 ms grain on a double-speed stem overruns a 150 ms window.

**The cap is grain duration against window *traversal* time, not window length.**
This is the only place the read-rate axis and the window rule interact, and it
has to be handled wherever the cap is applied.

### 4f. Short grains and high Q — the real constraint

An earlier draft claimed a short grain through a high-Q filter "yields almost
nothing or a click," and made chaos a blanket wide-band exception on that basis.
**Both were wrong.** The corrected version is narrower and gives a better rule.

**It is not silent, and the envelope sits after the filter.** The chain is
`readPcm → bandpass → × envelope`, so the filter sees raw material and the
envelope shapes the filtered output — meaning the filter's ring cannot outlast
the grain, it gets enveloped away.

**The constraint is frequency-dependent.** Settling time is roughly Q cycles of
the centre frequency. For a 15 ms grain that allows a Q in the hundreds at 12 kHz,
about 47 at 1 kHz, and about 4 at 80 Hz — the bottom of the `FILT_FMIN` …
`FILT_FMAX` span. So it only bites at the very bottom of the Y range.

**What goes wrong when it does bite** is not silence but a few cycles of the
filter's own frequency: a pitched blip whose pitch comes from the Q setting rather
than the material. That is the ringing ruled out in §6, so the concern survives —
just far narrower than stated.

**Decided: cap Q as a function of centre frequency and grain length.** One
expression, no tuning constants, constraining only where the physics constrains.
This replaces:

- the chaos-only wide-band exception, which was too blunt;
- `Q_MAX_SHORT: 3` lerping to `Q_MAX: 8` by duration — a frequency-blind
  approximation that is roughly right at 80 Hz and needlessly conservative
  everywhere above;
- the special-case osc length floor an earlier draft needed, since a period-2
  oscillator at 30 steps/s (`0.35 × 67 ms ≈ 23 ms`, floored to `DUR_MIN`) is now
  covered by the same rule.

It also makes raising `Q_MAX` well above 8 for §2 safe, since the ceiling
self-limits.

Whether very fast oscillators should attempt to pulse at all remains open (§12).

**Two related findings from reading the worklet:**

- **Filter state is never reset between grains.** `ic1eq` / `ic2eq` are zeroed in
  the `GrainVoice` constructor only, and voices are recycled, so every grain after
  the first on a slot inherits the previous grain's filter state at a possibly very
  different centre frequency. The envelope attack attenuates it (smoothstep starts
  at 0) but chaos uses a fast attack, so the suppression window is short. Worth
  checking as a click source given `probe-depth2-clicks.mjs` and
  `probe-live-ca-clicks.mjs` already exist.
- **`bpGain` is calibrated for steady-state RMS** (`sqrt(q/Q_REF)/q` times a tilt
  term). A short high-Q grain that never settles comes out quieter than the
  compensation assumes, which matters for §10.

---

## 5. Duration — redesign, not rebalance

`order` is one 0..1 scalar that sets *both* duration and envelope:

```
order = clamp01(0.65 * stabilityT + 0.35 * sizeForDur)
durationSec = DUR_MIN * (DUR_MAX / DUR_MIN)^order      // 0.03 → 8.0
attackFrac / releaseFrac = lerp(..., smoothstep01(order))
```

Three problems:

1. **Two unrelated things collapse into one number.** Stillness and bigness both
   push toward "long," so a large chaotic area and a small calm area can produce
   the same `order` and therefore identical grains despite looking nothing alike.
2. **Hypersensitive.** A 266× duration ratio compressed into a 0..1 input means a
   0.1 change in `order` is a 1.8× change in duration, and stability carries 0.65
   of the blend, so δ dominates and structure barely registers.
3. **Chaos and osc are pinned.** Both pass `area = 0`, so `order = 0.65 * stabilityT`,
   capped at 0.65; high δ drives it to 0 and gives exactly `DUR_MIN`. Chaos always
   lands on the same 30 ms.

**Replacement, revised: regime sets grain length; δ does not need a second job.**

An earlier draft here proposed `stepSec / δ` — "how long until this cell changes"
— as a zero-parameter duration law. §4c supersedes it, and the reason is worth
stating because it is a cleaner argument than the law it replaces:

**δ is already what classifies the regime.** Chaos *is* high δ; static *is* low δ.
So regime already encodes δ, and having δ *also* set duration is the same
double-dipping that made `order` bad. One measurement, one job — the discipline
of §8 — points at regime setting length, not δ.

That kills `order`, keeps the per-regime lengths in §4c, and leaves δ doing only
the classification it already does. `flowTravelCapSec` (stream length over hop
speed) stays as flow's own correct version of a travel-time bound.

What remains genuinely open is whether length should vary *within* a regime, and
if so from what. Two candidates already have a reason to exist:

- **Static from `stationarity`** (§4c) — sustained material tolerates a shorter
  freeze window, transient material needs a longer one.
- **Osc from period** — already implemented via `OSC_DUTY`.

Calm, chaos and flow currently have no within-regime variation proposed. Whether
they need any is a listening question; a fixed length per regime is the simpler
starting point and should be tried first.

**Envelope shape comes from segment `stationarity`, but only where overlap
allows.** That measurement is currently used *only* by `sustainedSubset`, so
removing the regime bias (§3b) would otherwise orphan it. Giving it the envelope
job is also just correct DSP: a slow attack on a transient unit chops its onset
off.

**The constraint from §4c.** Constant-amplitude overlap requires a full
raised-cosine envelope — attack and release each 50%, no flat top. The current
`envelopeAt` returns a literal `1` between attack and release, so any grain with
`attackFrac + releaseFrac < 1` has a plateau and a set of overlapping copies will
*not* sum flat. The ripple lands at the hop rate, which for calm is around 20 Hz —
squarely in the buzz range.

So the split is by overlap, not by regime preference:

- **Overlapping regimes (calm, static, flow)** — fixed raised-cosine, no plateau.
  `stationarity` does not get to shape these.
- **Non-overlapping regimes (chaos, osc pulses)** — free to take shape from
  `stationarity`, since nothing has to sum with them.

That is a narrower job for `stationarity` than the earlier draft claimed. It keeps
the static freeze-span job (§4c) and gains chaos envelope shape, which is enough
to justify keeping the measurement.

Note the doubling if `stationarity` also sets static grain length above. That is
acceptable — it is one measurement shaping one grain in two consistent ways, not
two unrelated inputs collapsed into one scalar — but it is worth flagging rather
than hiding.

---

## 6. Freeze — emergent, probably no new mechanism

**Decided: freeze the read position with a short, smoothly overlapping window.**
No resonance, no ringing frequencies. Phase vocoder and resonator freeze are both
dropped.

**The new realisation: with §3 and §4 in place, freeze is what already happens.**
Trace it through:

1. Scrub dropped (§3a) → `sampleCenter` is the segment position, fixed.
2. Static region, colour not changing → every grain queries the same colour →
   the same segment → the same `sampleCenter`.
3. Window bounds come from the segment's own extent (§4a), fixed.
4. Roughly three concurrent ~60 ms grains, forward, time-staggered by a third of
   their length, continuously respawning with raised-cosine envelopes → an
   unbroken stream of overlapping reads of the same short stretch of file.

That is a sustained, held, spectrally static texture — freeze, with no new DSP
and no new voice type. It is also exactly how a granular freeze pedal works.
Ping-pong is not involved and never fires (§4d).

**Recurrence is the inherent limitation, and it cannot be offset away.** Reading
one fixed window continuously means its content recurs at the respawn hop — about
50 Hz for a 20 ms hop, about 20 Hz for a 50 ms hop. No arrangement of read
positions removes this; it is what granular freeze *is*. It is inaudible on
uniform material and a rattle on transient material.

**Parameters that decide whether it reads as sustain or as a loop:**

- **Jitter on the respawn hop is essential, not cosmetic.** A fixed hop puts the
  recurrence on a single frequency, which the ear hears as a pitch or a buzz.
  Randomising the hop spreads it into noise. This is the primary mitigation and
  the reason the item exists.
- **The material has to cooperate.** Sustained material freezes cleanly; a
  transient stutters. Colour picks the window absolutely (§3b) so the material
  cannot be chosen — the mitigations are §3c read placement (sit after the
  attack) and letting `stationarity` set the freeze span (§4c).
- Narrow read spread, so copies stay spectrally similar. This is the opposite of
  calm, and under §8 that spread is driven by `similarity`.
- Overlapping copies of nearly the same material sum coherently, so level rises
  with copy count and needs compensation. This is the same effect §10 wants to
  expose deliberately elsewhere.

**Calm has the same recurrence issue with a real escape.** Where static is stuck
with one window by definition, a calm region's cells vary slightly in colour
(§3d), so its grains draw from several nearby windows and the recurrence never
settles on one period. That, not read offsetting, is what keeps calm smooth.

---

## 7. Regimes need mechanisms, not parameter values

The third key area: detected states should sound categorically different based on
what actually happens in the sim.

They currently do not, and the reason is structural. Calm, static, chaos and osc
all call `grainMaterial`, differing only in their inputs; flow carries an inline
copy of the same formula. So the five regimes are five points on one continuum,
which is why they blend.

Giving each regime its own *mechanism*:

- **Calm** — long grains near the window length, ~3 overlapping, random forward
  or reverse, reading past segment onsets (§3c). A held timbre that moves as
  colour moves.
- **Static** — ~60 ms grains, ~3 overlapping, forward and time-staggered, narrow
  offset spread and no colour motion, which is freeze (§6). Emergent, not a
  separate feature.
- **Chaos** — ~15 ms hits, no overlap, random direction, reading *at* segment
  onsets (§3c). Spray.
- **Flow** — ~100 ms grains at 50% overlap, direction from velocity sign, read
  rate from velocity (§9b), band sweeping as the stream moves vertically (§2e).
- **Osc** — pulse-locked bursts well under the visual period, direction alternating
  with oscillator phase.

Note how much of this needs no new code paths. The regimes differ in grain
length, overlap count, playback direction, and where they read within the window
— and every one of those is an existing `GrainSpawnEvent` field. §7 is mostly
assembly of §4c and §4d, not new machinery.

---

## 8. The unified mapping — one job per measurement

The organising rule is dimensional hygiene: spatial measurements set spatial
parameters, temporal measurements set temporal ones, and no measurement has two
jobs.

- Region **vertical extent** (share per grain) → filter bandwidth / Q, subject to
  a frequency-and-length ceiling (§4f) that binds only at the bottom of the Y span
- Cell **Y position** → band centre frequency
- Region **horizontal extent** → pan spread
- Cell **X position** → pan and source channel mix
- Region **area** → seat count only (brief §7), no longer window width or duration
- Cell **colour** → material window, absolute across regimes, no scrub
- **Segment extent** → window bounds (§4a), replacing the area-derived width
- Segment **stationarity** → envelope shape, and static freeze span (§4c)
- Cell **similarity** → read-offset spread within the window
- **δ** → regime classification only. No second job; regime carries length (§5)
- **Regime** → grain length, grain count, overlap, playback direction (§4d), and
  read placement within the window
- Region **velocity sign** → playback direction for flow; **oscillator phase** →
  direction for osc (§4d)
- Region **log-area** → read-rate register (octave), for calm and static
- Region **velocity** → read rate for flow, and follow motion for tracked regimes

`similarity` lands here having lost its Q job to vertical extent (§2d). It is a
spatial-uniformity measure, and offset spread is precisely "how alike should these
concurrent grains be" — high similarity gives narrow spread, low similarity gives
wide. That turns what would otherwise be a hardcoded per-regime constant into a
measurement.

Everything currently doubled up — area into duration, area into window width,
similarity into Q, elapsed time into material position, regime into which
*segments* exist — is removed. That decomposition is what "the Y axis needs to be
properly integrated across the whole system" resolves to.

Regime now carries several jobs rather than one, which bends the discipline. That
is deliberate: regime is not a measurement, it is the *classification* of a
measurement, so it is the right place for mechanism selection and for bounds on
other laws.

---

## 9. Read rate

### 9a. Register from spatial scale (accepted)

Large coherent mass down an octave, fine dust up. Reuses the `areaT` that
currently sets window half-width — since area is losing that job (§8), this is
where its size information goes instead.

### 9b. Rate from region velocity, for flow (accepted)

**Not Doppler, and the distinction is precise.** Doppler is an observer-relative
frequency shift. This is the field's own advance rate. CA velocity is in
cells/step, playback rate is samples/sample; declare one mapping — grid distance
corresponds to file time — and velocity becomes rate with no free parameter.

Clean pool split so it does not fight the area register: flow has velocity, calm
and static essentially do not. `flowMinSpeed = 0.65` to `flowMaxSpeed = 6`
cells/step is a 9× range, roughly three octaves. Frozen at spawn, so successive
grains from an accelerating flow step in rate rather than sliding.

### 9c. Pre-rendered buffers (accepted)

Pre-rendered 0.5× / 1× / 2× buffers: cheapest, no interpolation risk, 3× memory.
Segment positions scale linearly so the polar map indexes straight into them.
Also sidesteps `readPcm`'s `wrapIndex(Math.round(pos), len)`, which is
nearest-neighbour and exact only at rate ±1.

Discrete octaves only — but with freeze now read-position based (§6) rather than
rate based, that is no longer a limitation.

### 9d. Dropped

Oscillator period to harmonic interval. Oscillators are rare in the sim, and
introducing harmony that is not there is not wanted.

---

## 10. Loudness — accepted

Loudness follows **correlation**. Coherent sources add in amplitude (N×),
uncorrelated ones add in power (√N×); at 64 voices that is an 18 dB spread, and
it is not a mix decision but what happens when waveforms are added. One large
coherent structure sums loud; a scrambled field partially cancels and sums quiet.

This answers "what is more important in the CA?" with: nothing is, but coherent
things add up and incoherent things cancel. Activity still buys nothing —
coherence buys loudness, and coherence is not activity.

Two things that make it cheap:

- The engine currently spends effort *erasing* this.
  `preScale = Math.sqrt(BUDGET_VOICES / soundingCount)`, clamped [0.5, 2.5],
  divides the voice count back out. Exposing the physics is mostly deletion.
- **The current law is not constant-loudness anyway.**
  `targetRms = TARGET_RMS * Math.sqrt(voiceT)` with `voiceT = soundingCount / 64`
  already gives roughly 6 dB of variation tied to voice count.

Honest risk: full physics could leave a scrambled field ~18 dB down, which may
read as the instrument breaking. Mitigation is a partial exponent — compensate at
`sqrt(N)^0.5` rather than `sqrt(N)`.

Interacts with onset coupling (§12): coherence only becomes audible as loudness
if grain onsets are actually correlated for coherent regions, which they
currently are not (`startOffsetSec: Math.random() * dtSec` for everyone).

---

## 11. Dropped or resolved

- **Q from stability** — rejected. Bandwidth comes from vertical extent (§2).
- **`sustainedSubset` / regime material bias** — removed. Colour to material is
  absolute (§3b), with within-segment read placement as the replacement (§3c).
- **colourSpread to material spread** — dropped. Within-sim variety comes from
  the other axes (§3d).
- **Palette normalisation** — dropped, same reason (§3d).
- **Fill ratio to density** — dropped. Four incompatible definitions: calm
  computes `area / (width * height)` for real; static is hardcoded
  (`materialFromTexture` passes literal `1`, and `TexturedArea` has no
  `fillRatio` field); chaos is hardcoded `0, 0`; flow uses
  `flowPackT = area / regionArea`, member cells over dilated patch rather than
  over AABB. No single law can ride on it.
- **Flow heading to gesture** — dropped as redundant; pan and Y already follow.
- **Pitch-glide mitigation** — not needed. Filter sweeps are wanted (§2e).
- **Phase-vocoder freeze, resonator freeze, per-region resonant bodies** —
  dropped. No ringing frequencies (§6).
- **Oscillator harmonic intervals** — dropped (§9d).
- **A separate freeze mechanism** — dropped as unnecessary; freeze is emergent
  from §3a plus §4 (§6).
- **Window width from area** — replaced by the segment's own extent (§4a). Two
  earlier proposals were both wrong and are recorded so they are not revived: a
  per-regime window constant (windows belong to the audio, not the regime), and a
  global grain-length floor with all regimes capped at it (which needlessly threw
  away the calm-versus-chaos length difference).
- **`stepSec / δ` as the duration law** — superseded (§5). δ already classifies
  the regime, and regime sets grain length, so δ setting duration too is the same
  double-dipping that made `order` bad.
- **Ping-pong** — settled after flip-flopping twice: it never fires under the
  grain-never-exceeds-window rule, and reviving it for static was wrong because
  multiple heads in one window cross and coincide (§4d). Safety rail only.
- **Comb filtering from overlapping calm grains** — was never a real risk. Comb
  *coloration* needs sub-10 ms delays; at 50 ms the nulls are denser than a
  critical band and the ear hears thickening (§4c).
- **"Short grains cannot carry high Q"** — overstated. The constraint is
  frequency-dependent and binds only near `FILT_FMIN`; the failure mode is a
  pitched blip, not silence (§4f).
- **Chaos-only wide-band exception** — replaced by a frequency-and-length Q
  ceiling that also subsumes `Q_MAX_SHORT` and the osc length floor (§4f).
- **Envelope sharing `order`** — replaced by segment `stationarity` for shape,
  with length coming from the regime (§5) — but only for non-overlapping regimes,
  since overlap requires a fixed raised cosine (§4c, §5).
- **`similarity` orphaned** — reassigned to read-offset spread (§8).
- **Regime-dependent window availability** — rejected. Restricting short windows
  to short-grain regimes would make a colour resolve to different material per
  regime, which is the `sustainedSubset` behaviour already removed (§4b).

---

## 12. Still open

- **The minimum window length** (§4b). ~150 ms is a starting guess, and it is the
  number the whole scheme hangs on. Raising it makes calm smoother but forces
  more multi-event windows on dense sources; lowering it sharpens identity but
  starves calm of grain length.
- **The per-regime grain lengths, counts and overlaps** (§4c). Starting points.
- **Whether static freeze survives its recurrence rate** (§6). Recurrence at the
  respawn hop is inherent and only hop jitter mitigates it. Biggest single
  listening risk in the plan.
- **Whether calm's colour variation is enough to break recurrence** (§6). The
  claim is that a calm region's cells vary enough to draw from several windows, so
  no single period establishes itself. Untested, and it is the difference between
  calm sounding smooth and calm buzzing at around 20 Hz.
- **Whether the uncleaned filter state is an audible click source** (§4f).
  `ic1eq` / `ic2eq` persist across grain reuse. Directly testable with the
  existing click probes.
- **Whether very fast oscillators should pulse at all** (§4c). A period-2 group at
  30 steps/s pulses at 15 Hz, which is flutter rather than rhythm.
- **Whether within-regime length variation is needed** for calm, chaos and flow
  (§5). Fixed per regime is the simpler start.
- **Spawn-rate cost of short grains.** Shorter grains cycle faster, so scheduler
  spawns per second rise even though concurrency does not. `nearestPolar` is
  O(segments) per spawn and `snapToMask` is a bounded ring search, so neither
  should dominate — but unmeasured.
- **Onset coupling from spatial coherence** — `startOffsetSec` currently
  decorrelates every grain uniformly. §10 depends on this to be audible.
- **Audible lifecycle events** — `regionEvents` provides births, deaths and
  merges; births only fire an early first grain and deaths and merges are silent.
- **Regime-transition events** — derivatives of `calmAreaFraction` and
  `chaosAreaFraction`; a rule oscillating calm-to-chaos currently sounds like one
  holding a steady mix.
- **Reusing `estimatePeriod`** — real autocorrelation with a confidence value,
  currently feeding only pulse timing.
- **Greyscale fields.** With palette normalisation dropped, a greyscale rule has
  limited material variation by design: `angleW = W_ANGLE * (0.15 + 0.85 * qRadius)`
  collapses to 0.15 at s ≈ 0, so only value-to-band carries information. Accepted
  as a consequence of §3d, but worth confirming it sounds acceptable rather than
  broken, since the Implementation Filter notes random Type-U can emit greyscale.

---

## 13. Step 0 — measure before building

Extend `scripts/investigate-scenarios.mjs` and `scripts/probe-live-ca-clicks.mjs`
to dump per-rule histograms across several Type-U programs at all three depths:

- **`scrubSec` drift over a 30-second run** — highest priority after §3a
- **Distinct segments actually visited per rule** — the direct measure of whether
  colour distributions produce different characters
- **Same-colour segment divergence between calm and chaos** — quantifies what
  removing `sustainedSubset` changes
- Region vertical extents, and the Q the §2 law would produce for them
- Y occupancy, hue / sat / value, region area and count
- resulting `sampleCenter`, `q`, `durationSec`, `pan`

Claims here that are code-reading rather than measurement: that Y occupancy is
near-uniform for real Type-U fields, and that greyscale fields are common enough
to matter.

---

## 14. Rough sequencing

1. **Step 0 probe** — `scrubSec` drift and segments-visited-per-rule first.
2. **Drop or bound the scrub clock** (§3a). One constant, possibly the largest
   single effect, and it directly targets the main complaint.
3. **Absolute colour to material** (§3b) — remove `sustainedSubset` and the
   regime bias plumbing.
4. **Y axis properly** (§2) — extend `Q_MIN` / `Q_MAX` to the derived range and
   drive bandwidth from per-grain share of region vertical extent, with the
   frequency-and-length Q ceiling replacing `Q_MAX_SHORT` (§4f). Reset `ic1eq` /
   `ic2eq` on spawn while in this file.
5. **Segment extents** (§4a) — keep `startPos` / `endPos` on `MaterialSegment`,
   enforce the minimum at slice time (§4b), and delete the area-derived width.
   Ships with step 7, since windows and grain lengths must agree.
6. **Within-window read placement** (§3c) — the replacement for regime bias,
   with the start constrained to leave traversal room (§4e).
7. **Per-regime grain length, count and overlap** (§4c) — kills `order`. Fixed
   raised-cosine envelopes for overlapping regimes, `stationarity` shape only for
   non-overlapping ones (§5), and hop jitter from the start rather than as a later
   fix (§6). Freeze falls out of this plus steps 2 and 5.
8. **Direction per regime** (§4d) — cheapest item in the plan; `voice.dir` and
   the `direction` spawn field already exist and are only used by flow.
9. **Regime mechanisms** (§7) — mostly assembly of steps 4 through 8.
10. **Read rate** (§9) — pre-rendered octave buffers, area register, flow
    velocity. Bring the §4e traversal cap in with this, not before.
11. **Loudness correlation** (§10), which needs onset coupling to be audible.
12. **Remaining open items** (§12).

Brief and Implementation Filter updates follow each accepted change.

---

## 15. Not yet done or verified

The instrument has not been heard, `npm run verify` has not been run, and no real
field has been measured. Everything above is a mechanism-level read of the code
with line-level evidence where claims are specific. §13 exists to settle the parts
that need measurement. The Q figures in §2a are arithmetic from the worklet's own
constants and do not need measurement; whether they *sound* right does.
