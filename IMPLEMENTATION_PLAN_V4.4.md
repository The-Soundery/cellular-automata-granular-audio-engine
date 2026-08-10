Cellular Automata Granular Audio Engine — Implementation Plan V4.4
Status: WORK ORDER, not yet executed. Written 2026-08-06 after the owner's
  V4.2/V4.3 listening pass.
North star: `Creative Brief v4.txt`
Agent entry: `Implementation Filter.txt`, then this file.
Ear record: `scripts/listening-gate-sonic-laws.md` (Defects / Blocked sections)
Verify: `npm run build && npm run verify`

This plan fixes four measured defects, unblocks six listening-gate items by
adding the sims they need, and corrects two wrong statements in the project
docs. It deliberately does **not** change the Q law — see Deferred.

==============================================================================
HANDOFF — READ FIRST IF YOU ARE A NEW AGENT ON THIS WORK
==============================================================================

H1. WHERE THINGS STAND

The owner ran the V4.2/V4.3 listening pass on 2026-08-06. Nothing in the
engine has been changed as a result yet. The only edits from that session are
`scripts/listening-gate-sonic-laws.md` (triaged) and this plan.

The listening gate is now triaged into: items settled by code and checked,
four Defects that code proves are broken, six Blocked items with no sim
capable of testing them, and one open doctrine question. Read that file before
this one.

H2. OPEN DECISIONS — the owner has NOT signed these off

  D1. SIGNED OFF by the owner 2026-08-07. Replacing the four `checkDisp` range
      assertions in `scripts/render-scenarios.mjs` with per-slot temporal
      stability assertions is approved, on the stated basis that the
      replacement is strictly stronger. Phase 3 is unblocked. The approval
      covers section 4b exactly and nothing else: do NOT loosen the existing
      bound instead, and do NOT touch the assertions listed as "keep
      unchanged" in 4b. If any of those fail, stop and report.

  D2. Q from region Y extent. Agreed in principle, deferred until after
      Phase 3, because it is meaningless while every grain spawns at the
      region centre and because Phase 3 may deliver most of what it is after.
      Section 10a lists the three questions it must answer. Do not implement
      it in V4.4.

  D3. The osc envelope fractions (0.04 / 0.2). The owner previously liked
      them and has now questioned whether blinkers read as rhythmic. Phase 4
      leaves them alone on purpose so the duration change can be judged
      first. Raise it separately after Gate 4.

  D4. The pan wrap at the torus seam (section 3f). A tracked grain crossing
      x=127→0 flips pan +1→−1 in one frame. Whether to saturate or keep the
      wrap is an owner call; the plan proposes saturate, in its own commit so
      it can be reverted alone.

H3. TWO CORRECTIONS MADE DURING THAT SESSION — do not re-derive from the
    old numbers

  C1. `Implementation Filter.txt` OPEN ISSUE 1 states live Utomata sits at
      δ ≈ 0.1, giving t ≈ 0.29 and a ~5 dB chaos under-spend. Measured across
      five live runs, the chaos pool is at δ̄ 0.26–0.30, so t is 0.75–0.87 and
      the under-spend is about 1 dB. The Filter is wrong. Phase 8a rewrites
      it. Do not lower `deltaRateNorm`.

  C2. It was claimed earlier in that session that spatial-similarity→Q is the
      only axis distinguishing frozen-noise from uniform-static. It is not —
      hue→sample scatter also separates them (uniform: all grains read one
      slice of the source; frozen: 64 different slices). That weakens the
      case against D2 and is reflected in section 10a.

H4. REPRODUCING THE BASELINE (plan rule R4 requires this before any change)

Grain material, dispersion and area fractions on the synthetic patterns —
this produced every figure in sections 1a and 1b:

    node --input-type=module -e '
    const root = process.cwd();
    const { pathToFileURL } = await import("node:url");
    const { join } = await import("node:path");
    const { FieldObserver } = await import(pathToFileURL(join(root,"src/field/FieldObserver.ts")).href);
    const { GrainScheduler } = await import(pathToFileURL(join(root,"src/field/GrainScheduler.ts")).href);
    const { TEST_PATTERNS } = await import(pathToFileURL(join(root,"src/field/TestPatterns.ts")).href);
    const W=128,H=128,N=W*H;
    const mk=()=>({width:W,height:H,r:new Float32Array(N),g:new Float32Array(N),b:new Float32Array(N)});
    const quant=f=>{for(let i=0;i<N;i++){f.r[i]=Math.round(f.r[i]*255)/255;f.g[i]=Math.round(f.g[i]*255)/255;f.b[i]=Math.round(f.b[i]*255)/255;}};
    function run(id, steps=420, from=300){
      const p = TEST_PATTERNS.find(p=>p.id===id);
      const fo = new FieldObserver(W,H); const sch = new GrainScheduler();
      let cur=mk(), prev=mk(); p.fill(prev,0); quant(prev);
      const acc={}; let lastObs=null,lastBatch=null;
      for(let s=1;s<=steps;s++){
        p.fill(cur,s); quant(cur);
        const obs=fo.observe(cur,prev);
        const batch=sch.step(obs,cur,s*(1000/30),4.0);
        if(s>=from){ lastObs=obs; lastBatch=batch;
          for(const e of batch.events){ const k=e.regime;
            acc[k]??={n:0,dur:0,att:0,rel:0,q:0,xs:[],ys:[]};
            const a=acc[k]; a.n++; a.dur+=e.durationSec; a.att+=e.attackFrac;
            a.rel+=e.releaseFrac; a.q+=e.q; a.xs.push(e.x); a.ys.push(e.y); } }
        const t=prev; prev=cur; cur=t;
      }
      const sd=v=>{if(!v.length)return 0;const m=v.reduce((x,y)=>x+y,0)/v.length;
        return Math.sqrt(v.reduce((s,x)=>s+(x-m)**2,0)/v.length);};
      console.log("=== "+id+"  calm%="+(lastObs.calmAreaFraction*100).toFixed(1)+
        " static%="+(lastObs.texturedAreaFraction*100).toFixed(1)+
        " chaos%="+(lastObs.chaosAreaFraction*100).toFixed(1)+
        " osc%="+((lastObs.oscillators.reduce((s,g)=>s+g.area,0)/N)*100).toFixed(1));
      console.log("    meanDelta="+lastObs.meanDelta.toFixed(4)+"  active="+
        lastBatch.predictedActive+"/"+lastBatch.budget+"  shares c/s/x/o="+
        lastBatch.shares.calm+"/"+lastBatch.shares.texture+"/"+
        lastBatch.shares.chaos+"/"+lastBatch.shares.osc);
      for(const [k,a] of Object.entries(acc)){ const dur=a.dur/a.n;
        console.log("    "+k.padEnd(8)+" n="+String(a.n).padStart(6)+
          "  dur="+(dur*1000).toFixed(1)+"ms  att="+(a.att/a.n*dur*1000).toFixed(2)+
          "ms  rel="+(a.rel/a.n*dur*1000).toFixed(1)+"ms  Q="+(a.q/a.n).toFixed(2)+
          "  sd(x)="+sd(a.xs).toFixed(1)+"  sd(y)="+sd(a.ys).toFixed(1)); }
    }
    for(const id of ["uniform-static","hue-drift","frozen-noise","full-flicker",
      "half-half","blinker-slow","blinker-fast","moving-bar","gradient-static"]) run(id);
    '

Swap the `run(...)` body for a per-step region dump to reproduce section 1c
(`comConcX`, `comConcY`, `comX`, `velX` on moving-bar).

Live Utomata figures (section 1d) come from the browser, because Utomata needs
a canvas and cannot be driven headless. `src/main.ts` exposes the observer on
`window`. Start `npm run dev`, load the page, let the CA settle 8 s, then in
the console:

    (()=>{ const o = window.__fieldObserver.observation;
      return { calm:o.calmAreaFraction, static:o.texturedAreaFraction,
        chaos:o.chaosAreaFraction, chaosMeanDelta:o.chaotic.meanDelta,
        t: Math.min(1, o.chaotic.meanDelta/0.35),
        regions:o.coherent.length,
        osc:o.oscillators.map(g=>({period:g.period, area:g.area})) }; })()

Audio does not need to be enabled — the observation pipeline runs regardless.
Note that many random equations produce a dead field; reload to get a live one.

H5. WHAT WAS TRIED AND FAILED

The owner reports light clicking and popping on live CA. It could not be
reproduced offline. Rendering moving-bar, uniform-static and frozen-noise
through the real worklet with a deliberately smooth 3-tone source, comparing
pan/Y tracking on versus off, produced no sample-level discontinuity above the
source's own slope (max step 0.0299 against a source stepping 0.0346). An
early hypothesis about a ~10 dB `bpGain` step at COM jumps was wrong; the
filter's own settling absorbs it. The meaningless-COM defect is real but will
read as pitch and pan warble, not as a click. The clicking is still unexplained
and needs a recording captured from a live CA run via the Record button.

==============================================================================
0. RULES FOR THE IMPLEMENTING AGENT
==============================================================================

Read these before writing code. They override any instinct to make the build
go green.

R1. NEVER weaken, delete, skip, or loosen an assertion to make a change pass.
    If an assertion blocks you, stop and report it. Phase 3 contains one
    assertion that must change; it has its own sign-off gate and the change is
    a strengthening, not a loosening. No other assertion may be touched.

R2. Do not "fix" anything listed under STOP in `Implementation Filter.txt`.
    In particular: no fixed listening posts, no voice ownership, no
    luminance→volume, no mid-grain scrub chase, and CHAOS_EVENTS_MAX_HZ stays
    a CPU rail.

R3. Every phase has a Gate. Run it and paste the real output into the phase
    log before starting the next phase. "Passed" without output is not a
    result.

R4. If a measured baseline in section 1 does not reproduce on your machine,
    stop and report the discrepancy before changing anything. The plan is
    calibrated to those numbers. Read the tolerance note at the head of
    section 1 first — some figures are stochastic and have a stated spread.

R5. One phase per commit. Do not batch.

R6. Where this plan gives a constant, it also gives the derivation. If you
    change the constant, change the derivation with it or say why.

==============================================================================
1. MEASURED BASELINE — reproduce before you start
==============================================================================

All figures measured 2026-08-06 on the current tree. Grid 128×128, 30 steps/s,
measured over the last 4 s of a 14 s run unless noted. Reproduce with the probe
in H4.

TOLERANCE. Spawn placement is randomised, so not every figure below is
reproducible to the digit. Re-running the probe on 2026-08-06 gave:

  Reproduce exactly (deterministic — treat any change as a real regression):
    all four calm/texture durations, attacks, releases and Q
    full-flicker chaos duration/attack/release
    every area fraction, share split and meanDelta
    uniform-static, hue-drift, frozen-noise sd(x) and sd(y)

  Vary run to run (do not stop on these):
    gradient-static sd(x)     37.2 … 37.8
    full-flicker sd(x)/sd(y)  36.7 … 37.2
    moving-bar chaos          dur 259 … 305 ms, att 28 … 36 ms,
                              rel 201 … 230 ms, Q 3.99 … 4.88
    blinker-slow osc Q        7.03 … 7.81

The moving-bar chaos row is the loosest because only ~16 chaos grains fire in
the window. Judge it on order of magnitude, not on the value.

1a. Spawn-site standard deviation, in cells (a 128-wide grid):

    uniform-static    sd(x) 4.6   sd(y) 5.1
    hue-drift         sd(x) 4.7   sd(y) 5.2
    frozen-noise      sd(x) 37.8  sd(y) 36.5
    gradient-static   sd(x) 37.2  sd(y) 31.3
    full-flicker      sd(x) 36.7  sd(y) 36.9

1b. Grain material by pool:

    uniform-static  calm     8000.0 ms  att 2400 ms  rel 2720 ms  Q 8.00
    frozen-noise    texture  8000.0 ms  att 2400 ms  rel 2720 ms  Q 1.32
    full-flicker    chaos      30.0 ms  att 0.60 ms  rel 29.4 ms  Q 1.33
    moving-bar      chaos     304.9 ms  att 36.4 ms  rel 229.5 ms Q 3.99
    blinker-slow    osc       160.0 ms  att 6.40 ms  rel 32.0 ms  Q 7.03

1c. moving-bar regions at step 337:

    background  area 14976  comConcX 0.093  comConcY 5.8e-17  velX 1.00
    bar         area   640  comConcX 0.998  comConcY 0.000    velX 1.00

    Background comY jumps up to 60.44 cells between consecutive frames
    (sequence 62.61, 60.82, 3.54, 1.47, 61.92 …). comConcY is float noise.

1d. Live Utomata, five runs, read from `window.__fieldObserver.observation`:

    chaos pool δ̄   0.26 – 0.30      →  t = δ̄/0.35 = 0.75 – 0.87
    chaos area     52% – 66%
    calm area      31% – 40%
    coherent regions 25 – 33
    One equation drove the field to 85% period-2 oscillator (area 14004).

1e. breathing-uniform rhythm lock: confidence 0.000 across 600 steps.

1f. `npm run verify` — all stage ≤ 9 and stage ≤ 7 assertions pass.

GATE 0
  npm run build && npm run verify
  Expect: build clean, "All stage ≤ 9 assertions passed" and
  "All stage ≤ 7 assertions passed". Paste both.

==============================================================================
2. PHASE 1 — Test-pattern canvas never hides
==============================================================================

Defect. `src/main.ts` sets `patternCanvas.hidden = true` when returning to
Utomata, but `.ca-wrap canvas { display: block }` in `src/style.css` outranks
the user-agent `[hidden] { display: none }` rule, so the canvas stays visible
and a stale pattern frame sits on top of the live CA. Verified in-browser:
computed `display` remains "block" while `hidden` is true, and the canvas
pixels are byte-identical one second apart.

Audio is unaffected. This is a visual bug only.

FIX — `src/style.css`, add after the `.ca-wrap canvas` block:

    .ca-wrap canvas[hidden] {
      display: none;
    }

Specificity (0,2,1) beats (0,1,1), so the attribute wins without `!important`.
Do not change `main.ts`; the `hidden` property is the right API.

GATE 1
  Load the app. Select "Full flicker noise", wait 2 s, switch back to
  "Utomata (live CA)". Confirm the live CA is visible and animating.
  Then in the console:
    getComputedStyle(document.querySelector('.pattern-preview')).display
  Expect: "none". Paste the value.

==============================================================================
3. PHASE 2 — Pan/Y follow uses a meaningless centre of mass
==============================================================================

Defect. A region spread around the torus has no usable COM in that axis.
`SPAWN_ANCHOR_R_MIN` (0.5) already guards *spawn placement* against this, but
`trackDx`/`trackDy` and the worklet's `applyTracks` use the raw COM. On
moving-bar the background is 91% of the field with comConcX 0.093 and comConcY
5.8e-17, so every one of its grains pans continuously with a COM that is
marching, and re-tunes its bandpass with a comY that is numerical noise.

The root cause is that spawn and tracking use two different anchors. The fix
is to make them use one.

3a. `src/field/GrainScheduler.ts` — extract the existing anchor rule that is
    currently inline in `spawnCalm` into a shared function:

      function regionAnchor(region, obs) {
        const x =
          region.width >= obs.width || region.comConcX < SCHED.SPAWN_ANCHOR_R_MIN
            ? (obs.width - 1) / 2
            : region.comX;
        const y =
          region.height >= obs.height || region.comConcY < SCHED.SPAWN_ANCHOR_R_MIN
            ? (obs.height - 1) / 2
            : region.comY;
        return { x, y };
      }

    Behaviour must be identical to the current inline rule. Call it from
    `spawnCalm` in place of the inline computation.

3b. Compute the anchor once per region per step in `step()` and use it for
    BOTH the spawn call and the track message.

3c. `RegionTrack` gains `anchorX` and `anchorY`.

    KEEP `comX` and `comY` on the interface with their existing true-COM
    values. `scripts/verify-phase2.mjs` asserts `typeof tr.comX === "number"`
    and `typeof tr.comY === "number"`; removing or renaming them would break
    that assert, and R1 forbids touching it. Add the new fields alongside.

3d. `spawnCalmAt` — compute `trackDx`/`trackDy` from the anchor, not the COM:

      const trackDx = toroidalOffset(cx, anchorX, w);
      const trackDy = toroidalOffset(cy, anchorY, h);

3e. `public/grain-processor.js` — `applyTracks` reads `anchorX`/`anchorY`,
    falling back to `comX`/`comY` when absent:

      comX: t.anchorX ?? t.comX ?? 0,
      comY: t.anchorY ?? t.comY ?? 0,

    Nothing else in `applyTracks` changes. It must stay unsmoothed — there is
    a `TRACK_SMOOTH` absence assert in verify-phase2.

Result: a region whose COM is meaningful in an axis still follows directly in
that axis (bar, comConcX 0.998). A region whose COM is noise in an axis holds
still in that axis (background, comConcX 0.093) because the anchor is the
fixed grid centre.

3f. SECONDARY, separate commit — pan wrap at the torus seam.

    `wrapCoord(anchorX + trackDx, w)` steps a grain from x=127 to x=0, which
    flips pan from +1 to −1 in one frame. After 3a–3e only genuinely localised
    moving regions can hit this, so it is rare, but it is an audible click.
    Change the follow to saturate rather than wrap: if applying the offset
    would cross the seam, hold the grain at the pan extreme for the rest of its
    life. Do this only after Gate 2 passes, and log it separately so it can be
    reverted independently if the owner prefers the wrap.

GATE 2
  (i)  npm run build && npm run verify   → both "all passed" lines.
  (ii) Re-run the moving-bar probe from section 1c and additionally record,
       for the background region, the per-frame change in the pan of a
       tracked grain. Expect: 0.00 for the background, non-zero for the bar.
  (iii) Load the app on moving-bar and confirm by ear the background no
       longer sweeps.

==============================================================================
4. PHASE 3 — Calm spawn sites collapse to the centre
==============================================================================

Defect. In `pickStratifiedSite`, dispersion is scaled by the region's measured
`colourSpread`. A uniform region has `colourSpread` exactly 0, so it falls to
`SPAWN_SPREAD_MIN = 0.08`, giving sigma = 0.08 × 64 = 5.1 cells on a 128 grid.
Measured site sd 4.6/5.1 (section 1a). Pan lands inside ±0.15 and cutoff
inside roughly 650–1470 Hz, so uniform fields read narrow, centred and
spectrally thin.

>>> SIGN-OFF GRANTED 2026-08-07. This phase is unblocked. The approval is for
>>> the 4b replacement as written; it is not permission to adjust any other
>>> assertion. R1 still applies to everything else. <<<

4a. THE BLOCKING PROBLEM

`scripts/render-scenarios.mjs` asserts UPPER bounds on spawn spread:

    checkDisp("uniform-static",    0.35, 0.3);
    checkDisp("breathing-uniform", 0.35, 0.3);
    checkDisp("glider-swarm",      0.35, 0.3);
    checkDisp("moving-bar",        0.35, 0.3);

where `panSpread = panMax - panMin` over the whole measurement window. That is
a RANGE, so these assertions encode the centre-collapse as required behaviour.
Widening dispersion will fail them.

Why the assertion is wrong, not the change: its stated intent (see the
listening gate failure mode "Frozen field that still wanders in pan/spectrum
every frame", and V4.3 law 4 "sampling must not manufacture change") is to
catch TEMPORAL WANDER. A range over the window conflates two different things:

  - temporal wander of a given site  — forbidden
  - spatial spread across a large region — required by Brief §6

For uniform-static those are indistinguishable in this metric because the
region covers the whole grid, so the check cannot express "spread widely but
do not wander".

4b. THE REPLACEMENT — strictly stronger

Replace the range bound with per-slot temporal stability. The sampler is
already built for this: `pickStratifiedSite` seeds `mulberry32(salt + slot)`
with no frame counter and no time, so slot j must resolve to the same cell on
every frame of a frozen field.

  New assertion, for uniform-static / breathing-uniform / glider-swarm /
  moving-bar:
      for each site slot j, the standard deviation of that slot's (pan, yNorm)
      ACROSS FRAMES must be ≤ 0.01
  Spread ACROSS slots becomes unbounded.

  AMENDED BY OWNER 2026-08-10: moving-bar is EXCLUDED from this assertion.
  Its background mask has a moving hole (the bar), so slots near the bar's
  path legitimately snap a few cells aside when it passes (measured max
  per-slot pan sd ~0.02–0.03, e.g. x 83↔87 on the frames the bar crosses).
  That is sound reacting to real field change, which the stasis law permits;
  the check's premise (frozen field) does not hold on this sim. The real CA
  never produces a fixed background — everything is one moving layer — so the
  scenario is not representative of the case the check guards. The three
  frozen-mask sims pass at sd exactly 0 and fully cover sampler stasis. Do
  not re-add moving-bar here or widen its bound.

This is stronger than the current check: it catches a region that wanders
inside a narrow band, which passes 0.35 today. Follow the existing per-slot
pattern already used for "frozen-noise per-slot sampleCenter spread ≤ 0.005".

Keep unchanged and expect them to still pass:
  - `mean pan ∈ [-0.15, 0.15]` for uniform-static (symmetric spread, mean ~0;
    current measured value −0.003)
  - `distinct sites ≤ 70` (site count follows slot count, not spread)
  - `checkDispMin` lower bounds for frozen-noise and gradient-static
  - the spectral-flux bounds (each grain is still static; flux measures
    frame-to-frame change, which does not rise)
If any of those do fail, STOP and report — do not adjust them.

4c. THE CHANGE, once signed off

`src/field/GrainScheduler.ts`:

    SPAWN_SPREAD_MIN: 0.08  →  0.5

Derivation, to replace the current comment: offsets are clamped at
`SPAWN_SLOT_Z_MAX = 2` sigmas, and sigma = spreadT × halfExtent. At
spreadT = 0.5 the 2-sigma envelope is exactly the region's half-extent, so a
uniform region samples its own full extent and no more. 0.08 was not derived.

Leave `SPAWN_SPREAD_FULL`, `SPAWN_SLOT_Z_MAX` and the colourSpread modulation
alone. The floor is the only change; colour diversity still widens dispersion
above the floor.

4d. NOTED, NOT DONE

A Gaussian at sigma = half/2 still concentrates 68% of sites within the
middle half of the region. Uniform-in-mask or blue-noise placement would cover
a uniform region more evenly. That is a bigger change with its own listening
question — do not do it in this phase. Record it as a follow-up.

GATE 3
  (i)   npm run build && npm run verify → both "all passed" lines.
  (ii)  Re-run the section 1a probe. Expect uniform-static and hue-drift sd to
        rise from ~4.6/5.1 toward the 25–40 range; frozen-noise and
        gradient-static roughly unchanged.
  (iii) Report the new per-slot temporal sd for all four checkDisp scenarios.
  (iv)  Owner listens to hue-drift and uniform-static and confirms the pan and
        spectral width opened up.

==============================================================================
5. PHASE 4 — Oscillator pool cannot spend its share; blinkers smear
==============================================================================

Defect, two causes:

  - `SCHED.oscBurstMax = 3` caps the burst regardless of share. A cap that
    stops a pool reaching its share is what the Filter STOP list calls
    loudness policy in disguise.
  - Osc grain duration is `0.8 × period`, so the grain fills the period and
    leaves no silence.

Measured: blinker-slow share 6, ~2.4 concurrent, 80% duty (−4 dB and smeared).
The live CA that went 85% period-2 had share 55 and still reached 2.4
concurrent — −13.6 dB.

5a. THE SHAPE OF THE FIX

Invert how the share is spent. Fire the WHOLE share as one simultaneous
composite hit, and shorten the grain so real silence follows. On blinker-slow
that is six grains together, ~60 ms long, from six different cells in the
block, with ~140 ms of silence — one percussive event five times a second.

Firing is already quantised to the oscillator: `spawnOsc` fires when
`stepIndex % period === firePhase`, where firePhase is the argmax of an
EMA'd per-phase δ histogram. That machinery is correct and stays.

5b. STACKING SAFETY NET

The owner asked how to stop grains piling up. Four measures, none of which is
a spend cap:

  S1. The existing guards already bound this. The burst loop is conditioned on
      `this.active.length < this.budget` AND
      `countActiveRegime(active,"osc") + countEventsRegime(events,"osc") < share`.
      Osc concurrency therefore cannot exceed `share`, and total cannot exceed
      `budget`, no matter how large the burst constant is. `oscBurstMax` is
      not what keeps the engine safe; those two conditions are. Keep them
      exactly as they are.

  S2. Duty floor. Set `OSC_DUTY = 0.35` and
      `durationSec = max(SCHED.DUR_MIN, OSC_DUTY * period / SCHED.stepsPerSec)`.
      The DUR_MIN floor matters at short periods: at period 2 the raw value is
      0.35 × 66.7 = 23 ms, which floors to 30 ms (duty 0.45). Without the
      floor a fast oscillator degenerates into a spike train.

  S3. Onset spread inside the perceptual fusion window. Replace
      `startOffsetSec: Math.random() * dtSec * 0.25` (currently up to 8.3 ms,
      tied to the CA step rather than the pulse) with
      `Math.random() * Math.min(0.15 * periodSec, 0.015)`.
      Up to 15 ms of onset spread still fuses into a single perceived attack
      (fusion window is roughly 20–30 ms) but spreads 55 simultaneous attacks
      over ~700 samples instead of landing them on one.

  S4. A measured pumping guard, which is the real safety net because it is
      falsifiable. Add a render-harness metric: block-RMS modulation depth at
      the pulse rate, on blinker-fast, blinker-slow and the new `osc-field`
      sim. Assert it stays below a bound derived from the pre-change baseline.
      Rationale: average concurrency for a pulsed pool is `share × duty`, so
      the worklet's `preScale = sqrt(BUDGET/soundingCount)` settles for the
      average and the pulse runs about `1/sqrt(duty)` hot — roughly +4.6 dB at
      duty 0.35. That is musically correct for a percussive hit, but it must
      not turn into normaliser pumping, and only a measurement can tell you.

5c. THE EDITS

`src/field/GrainScheduler.ts`:
  - Add `OSC_DUTY: 0.35` to SCHED with the S2 derivation as its comment.
  - Retire `oscBurstMax` as a spend cap. Keep the name in SCHED set to the
    budget (so the STOP-list grep history and any tune notes still resolve)
    and comment it as "CPU rail only, never a mix control", mirroring how
    CHAOS_EVENTS_MAX_HZ is handled. Burst size becomes `share`.
  - `spawnOsc`: duration per S2, `startOffsetSec` per S3. `spawnOsc` needs the
    period in seconds; it already receives the group.
  - Leave the 0.04 / 0.2 envelope fractions alone in this phase. The owner
    previously liked them; let the shorter duration do the work first, then
    re-listen. If the pulse still reads as a gated tone after Gate 4, raise it
    as a separate decision.

5d. WHAT MUST NOT CHANGE

`oscBurstsPerSec` in `scripts/investigate-scenarios.mjs` counts STEPS on which
any osc grain fired, not grains. Stage 6 asserts
`blinker-fast osc bursts/s ∈ [12,18]` and `blinker-slow ∈ [3.5,6.5]`. Neither
burst size nor duration changes the number of firing steps, so both assertions
must still pass untouched. If either fails, you have changed the firing phase
logic — stop and report.

GATE 4
  (i)   npm run build && npm run verify → both "all passed" lines, INCLUDING
        the two stage-6 osc bursts/s assertions, unmodified.
  (ii)  Report osc mean concurrency vs share for blinker-fast, blinker-slow
        and osc-field. Expect mean ≈ share × duty and peak ≈ share.
  (iii) Report the new block-RMS pulse modulation metric before and after.
  (iv)  Owner listens to blinker-slow and confirms a discrete pulse.

==============================================================================
6. PHASE 5 — New test sims (unblocks six listening-gate items)
==============================================================================

All in `src/field/TestPatterns.ts`, appended to `TEST_PATTERNS`. Each also
needs an entry in `scripts/test-scenarios.md` stating what it simulates, the
ground truth, and what it is for. Adding a sim to the array automatically adds
it to the UI Sim dropdown.

Do NOT add assertions for these to `npm run verify` in this phase unless the
ground truth is unambiguous. They exist first as listening instruments.

6a. `chaos-blob-2pct` — uniform calm field, plus an 18×18 square (324 cells,
    1.98% of the grid) of fresh per-step random colour.
    Purpose: the percussive-chaos question. Prediction to falsify — share
    rounds to 1, event rate ≈ 16/s, and chaos reads as discrete clicks.

6b. `chaos-blob-10pct` — same, 40×40 (1600 cells, 9.8%).
    Prediction: share 6, event rate ≈ 96/s, reads as a rattle, not clicks.
    Together with 6a this brackets the density arithmetic:
      concurrency = share × t,  events/s = share × t ÷ duration.

6c. `hue-bands` — eight static vertical bands, 16 columns each, band k at
    HSV hue = k × 0.02, saturation 0.8, value 0.8.
    Purpose: find where `FIELD_OBS.regionColourEps = 0.12` actually splits two
    adjacent calm masses. The harness must PRINT the RGB distance between
    adjacent bands and the resulting region count, so the threshold is read
    off rather than guessed.

6d. `pulse-calm` — uniform calm field at a steady colour; every 30th step the
    HSV value jumps for 2 steps then returns. Period 1.0 s, inside the
    `rhythmMinSec` 0.15 – `rhythmMaxSec` 2.0 accept window, with a clear dip
    between impulses so the `RHYTHM_DIP` requirement is satisfiable.
    Purpose: "Pulsing calm can phase grain fires with visible change", which
    is currently untestable — `breathing-uniform` measures rhythm confidence
    0.000 across 600 steps because its 3 s period is out of range.
    Gate: report the detected periodSec and confidence. Expect ≈1.0 s and
    confidence ≥ `rhythmConfidence` (0.72).

6e. `identity-quadrants` — four static quadrants at matched luminance:
      top-left     grey (saturation 0), upper half
      top-right    saturated, upper half
      bottom-left  grey, lower half
      bottom-right saturated, lower half
    Purpose: isolates the three identity axes in one listen — saturation →
    window half-width (0.06 s saturated, 0.8 s grey, so focused vs diffuse),
    X → pan, Y → cutoff (80 Hz bottom, 12 kHz top). Matched luminance keeps
    loudness out of it.

6f. `osc-field` — the whole grid alternates between two distinct colours every
    step (period 2).
    Purpose: reproduce the pathological live case from section 1d (85% of the
    field in one period-2 group, share ~55) so Phase 4's burst change has
    harness coverage at the extreme.

GATE 5
  npm run build && npm run verify → unchanged, both "all passed".
  Then for each new sim print: area fractions, share per pool, events/s per
  pool, mean concurrency, grain duration. Paste the table.

==============================================================================
7. PHASE 6 — Regime colour coding on the overlay
==============================================================================

`src/ui/RegionOverlay.ts` currently draws only coherent (calm) regions, with
hue from region id, plus grain dots in two colours. Static, chaotic and
oscillator cells are not drawn at all, so the owner cannot see which regime a
part of the field is in.

Add a regime layer beneath the existing region silhouettes:

    calm        existing per-id hue silhouette, unchanged
    textured    dim neutral grey fill
    chaotic     dim warm fill
    oscillator  dim cool fill

Constraints:
  - Do NOT draw 16384 cells with `fillRect`. Build one `ImageData` per frame
    and `putImageData` it. The existing per-cell `fillRect` loop over region
    membership is already the slow path; if frame time regresses, move that to
    the ImageData too.
  - Keep alpha low enough that the CA remains readable.
  - Add a small static legend to the controls panel so the colours are
    self-describing.
  - `scripts/verify-phase2.mjs` asserts the overlay still draws cell
    silhouettes (`/cells/`) and keeps the `0.07` interior alpha. Both must
    still hold.

GATE 6
  npm run build && npm run verify → unchanged.
  Screenshot the overlay on `half-half` and on `chaos-blob-10pct`.
  Report frame time before and after on live Utomata.

==============================================================================
8. PHASE 7 — Per-pool δ̄ and the t term on the meters
==============================================================================

The Field observation panel shows a single whole-field `Field Δ`. The chaos
balance question needs per-pool numbers, and the plan's own baseline had to be
gathered through the console because the UI does not show them.

`src/ui/controls.ts` and `src/main.ts` — add to the Field observation block:

    chaos δ̄       obs.chaotic.meanDelta
    chaos t       clamp01(obs.chaotic.meanDelta / SCHED.deltaRateNorm)
    calm δ̄        area-weighted mean over obs.coherent
    static δ̄      obs.textured.meanDelta

Reuse the existing 5 Hz meter throttle and EMA. Do not add a new render loop.

GATE 7
  Load live Utomata, let it settle, and confirm the displayed chaos δ̄ falls in
  0.26–0.30 and t in 0.75–0.87, matching section 1d. Paste a screenshot.

==============================================================================
9. PHASE 8 — Correct the docs
==============================================================================

9a. `Implementation Filter.txt` — OPEN ISSUE 1 is factually wrong and is
    steering future agents toward an unnecessary change. Rewrite it:

    The claim "on real sims at δ ≈ 0.1, t ≈ 0.29, chaos spends under a third
    of its area share (~5 dB down)" does not hold. Measured across five live
    Utomata runs the chaos pool sits at δ̄ 0.26–0.30, so t is 0.75–0.87 and the
    under-spend is about 1 dB. Do not lower `deltaRateNorm` on the strength of
    the old figure. Replace the issue with the measurement and mark it closed.

9b. `Implementation Filter.txt` — OPEN ISSUE 3 ("do short chaos grains read as
    clicks?") gains the density finding: at 60% chaos coverage the
    share ÷ duration arithmetic forces roughly 600 events/s, which no envelope
    can make discrete. Point it at `chaos-blob-2pct` / `chaos-blob-10pct`.

9c. `Creative Brief v4.txt` — two addenda, both flagged PROPOSED pending the
    owner's listen, consistent with how the V4.3 addendum is handled:

    - Percussiveness is a coverage consequence, not an envelope setting.
      Event rate is share ÷ duration, so spending a large area share always
      produces a dense event stream. Chaos reads as discrete events only at
      small coverage. Shortening grains raises the event rate and makes this
      worse, not better.

    - For a pulsed pool the area share is spent AT THE PULSE. Peak concurrency
      equals share; average concurrency is share × duty. A rhythm has silence
      by definition, and that silence is not an unspent share.

9d. `scripts/test-scenarios.md` — entries for all six new sims (section 6).

9e. `scripts/listening-gate-sonic-laws.md` — as each defect is fixed and each
    sim lands, move the corresponding item out of Defects / Blocked and back
    into the ear pass, UNCHECKED. Do not check them on the owner's behalf.

GATE 8
  Diff review only. No code changes in this phase.

==============================================================================
10. DEFERRED — do not implement in V4.4
==============================================================================

10a. Q from region Y extent.

The owner's proposal is that filter Q should follow a region's Y-axis extent —
narrow areas get narrow sounds — replacing the current spatial-similarity→Q
law. Agreed in principle, deliberately deferred, for two reasons.

  - It is meaningless until Phase 3 lands. Extent cannot drive spectrum while
    every grain sits within ±10 cells of the region centre.
  - Phase 3 alone may deliver most of what the proposal is after. Once grains
    spread across a region's true extent, a four-row region's grains occupy
    only four rows' worth of cutoff, so "narrow areas get narrow sounds"
    already holds through spectral PLACEMENT without touching per-grain
    bandwidth.

When it is picked up, it must answer these first:

  - A full-screen single flat colour has full Y extent and would therefore get
    Q_MIN — the most visually unified state the system can reach becomes its
    least spectrally focused sound, while a four-row strip of the same colour
    becomes a pure tone. Listen to that before committing.
  - Chaos and texture are bags, not coherent extents; the code deliberately
    sets `areaT = 0` for them. What Q does a bag get?
  - V4.3 law 3 would need rewriting. Note that hue→sample scatter still
    separates frozen-noise from uniform-static (all grains reading one slice
    versus 64 different slices), so the distinction survives — it is not, as
    was previously claimed, the only axis.

Implement it behind a single constant so uniform-static and frozen-noise can
be A/B'd in one listening session, and rewrite the Brief after that listen,
not before.

10b. Uniform-in-mask or blue-noise spawn placement (section 4d).

10c. Moving coherent structures as figure (Filter OPEN ISSUE 5). κ =
     similarity × stability means a mover never forms a region. Needs a fourth
     regime. Unchanged by this plan.

==============================================================================
11. PHASE ORDER AND DEPENDENCIES
==============================================================================

    Phase 1  canvas hide            independent, do first (unblocks visual QA)
    Phase 2  COM anchor             independent
    Phase 3  spawn dispersion       sign-off granted 2026-08-07, unblocked
    Phase 4  osc burst + duty       independent
    Phase 5  new sims               after 1 (needs reliable sim switching)
    Phase 6  overlay regimes        after 5 (new sims are what it visualises)
    Phase 7  per-pool meters        independent
    Phase 8  docs                   last

All phases can proceed. Run them in the order listed; the only hard
dependencies are 5-after-1 and 6-after-5.

Final gate: `npm run build && npm run verify` green, then hand back to the
owner for a full re-run of the listening gate.
