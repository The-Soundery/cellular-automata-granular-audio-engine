import { UtomataHost, GRID_SIZE } from "./ca/UtomataHost.ts";
import {
  randomProgram,
  cycleSlot,
  seedProgram,
  neighborPrograms,
  type TypeUDepth,
  type TypeUProgram,
} from "./ca/typeU.ts";
import { FrameObserver, type RgbField } from "./field/FrameObserver.ts";
import { FieldObserver, type FieldObservation } from "./field/FieldObserver.ts";
import {
  GrainScheduler,
  MASTER_GAIN,
  SCHED,
  type GrainEventBatch,
} from "./field/GrainScheduler.ts";
import {
  fillRgba,
  getTestPattern,
  type TestPattern,
} from "./field/TestPatterns.ts";
import { AudioEngine, type RecordingResult } from "./audio/AudioEngine.ts";
import { rgbToHsv } from "./audio/spectral.ts";
import {
  mountControls,
  type AudioMeterStats,
  type FieldMeterStats,
} from "./ui/controls.ts";
import { RegionOverlay } from "./ui/RegionOverlay.ts";
import { WaveformStrip } from "./ui/WaveformStrip.ts";
import "./style.css";

const DEFAULT_SOURCE_URL = "/default-source.wav";
const METER_UI_HZ = 5;
const METER_EMA = 0.35;
/** Softer than audio/δ meters — regime shares jump in whole seats. */
const BUDGET_METER_EMA = 0.22;
const ONSET_PERSIST_MS = 300;
const ONSET_RING_MAX = 96;
const REGION_TICKER_KEEP = 12;
const REGION_ROW_MAX = 6;

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app missing");

app.innerHTML = `
  <div class="stage">
    <div class="scope" id="scope">
      <div class="ca-wrap" id="ca-wrap">
        <span class="bracket bracket-tl"></span>
        <span class="bracket bracket-tr"></span>
        <span class="bracket bracket-bl"></span>
        <span class="bracket bracket-br"></span>
      </div>
      <div class="wave-strip" id="wave-strip"></div>
      <div class="explore-sky" id="explore-sky" hidden></div>
    </div>
  </div>
`;

const caWrap = document.querySelector<HTMLElement>("#ca-wrap")!;
const exploreSky = document.querySelector<HTMLElement>("#explore-sky")!;
const waveStrip = document.querySelector<HTMLElement>("#wave-strip")!;

const host = new UtomataHost(caWrap);
const overlay = new RegionOverlay(caWrap);
overlay.setVisible(false);
const wave = new WaveformStrip(waveStrip);
const frameObserver = new FrameObserver(GRID_SIZE, GRID_SIZE);
const fieldObserver = new FieldObserver(GRID_SIZE, GRID_SIZE);
const scheduler = new GrainScheduler();
const audio = new AudioEngine();

const patternCanvas = document.createElement("canvas");
patternCanvas.width = GRID_SIZE;
patternCanvas.height = GRID_SIZE;
patternCanvas.className = "pattern-preview";
patternCanvas.hidden = true;
caWrap.appendChild(patternCanvas);
const patternCtx = patternCanvas.getContext("2d")!;
const patternImage = patternCtx.createImageData(GRID_SIZE, GRID_SIZE);
const patternRgba = patternImage.data;

(window as unknown as {
  __fieldObserver: FieldObserver;
  __grainScheduler: GrainScheduler;
}).__fieldObserver = fieldObserver;
(
  window as unknown as { __grainScheduler: GrainScheduler }
).__grainScheduler = scheduler;

let lastObs: FieldObservation | null = null;
let lastBatch: GrainEventBatch | null = null;
let lastObservedStep = -1;
let audioStatus = "idle";
let lastMeterUiAt = 0;
let smoothMeter: AudioMeterStats | null = null;
let smoothFieldDelta: {
  chaosMeanDelta: number;
  chaosT: number;
  calmMeanDelta: number;
  staticMeanDelta: number;
} | null = null;
/** Display-only EMA for DATA regime budget meters (not scheduler truth). */
let smoothBudget: {
  calmGrains: number;
  chaosGrains: number;
  textureGrains: number;
  oscGrains: number;
  flowGrains: number;
  shareCalm: number;
  shareTexture: number;
  shareChaos: number;
  shareOsc: number;
  shareFlow: number;
  predictedActive: number;
} | null = null;
let overlayVisible = false;
let cachedColourDiag: { meanSat: number; hueSpread: number } | null = null;
let defaultSourcePromise: Promise<void> | null = null;
/** null = live Utomata; else active synthetic pattern. */
let activePattern: TestPattern | null = null;
let patternPaused = false;
let syntheticStep = 0;
let syntheticAccSec = 0;
let lastTickMs = performance.now();

const PREVIEW_SIZE = 64;
const PREVIEW_FPS = 30;
const PREVIEW_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];

let currentProgram: TypeUProgram | null = seedProgram(1);
let mappedDepth: TypeUDepth = 1;
const lastByDepth: Partial<Record<TypeUDepth, TypeUProgram>> = {
  1: currentProgram,
};
let exploring = false;
let dataOpen = false;
let explorePreviews: UtomataHost[] = [];
let wavePeaks: Float32Array | null = null;
const onsetRing: { t: number; bornMs: number }[] = [];
/** First-seen CA step per calm region id — DATA age in steps. */
const regionBirthStep = new Map<number, number>();
const regionTickerLog: { kind: "birth" | "death" | "merge"; text: string }[] =
  [];

/** Temporary flow-blink audio-impact diagnostic (strip after listen pass). */
const FLOW_BLINK_RING = 120;
type FlowBlinkSample = {
  step: number;
  n: number;
  ids: number[];
  gained: number;
  lost: number;
  triggers: number;
  active: number;
  rejects: Record<string, number>;
};
let prevFlowIds = new Set<number>();
let lastFlowBlink: FlowBlinkSample | null = null;
const flowBlinkRing: FlowBlinkSample[] = [];

(
  window as unknown as {
    __flowBlink: {
      last: () => FlowBlinkSample | null;
      ring: () => FlowBlinkSample[];
      summary: () => {
        steps: number;
        meanN: number;
        meanTriggers: number;
        meanActive: number;
        churnSteps: number;
        maxLost: number;
        maxGained: number;
        triggerDipSteps: number;
        topRejects: [string, number][];
      };
    };
  }
).__flowBlink = {
  last: () => lastFlowBlink,
  ring: () => flowBlinkRing.slice(),
  summary: () => {
    const n = flowBlinkRing.length;
    if (n === 0) {
      return {
        steps: 0,
        meanN: 0,
        meanTriggers: 0,
        meanActive: 0,
        churnSteps: 0,
        maxLost: 0,
        maxGained: 0,
        triggerDipSteps: 0,
        topRejects: [],
      };
    }
    let sumN = 0;
    let sumTrg = 0;
    let sumAct = 0;
    let churn = 0;
    let maxLost = 0;
    let maxGained = 0;
    let dip = 0;
    const rej = new Map<string, number>();
    for (const s of flowBlinkRing) {
      sumN += s.n;
      sumTrg += s.triggers;
      sumAct += s.active;
      if (s.gained > 0 || s.lost > 0) churn += 1;
      if (s.lost > maxLost) maxLost = s.lost;
      if (s.gained > maxGained) maxGained = s.gained;
      if (s.lost > 0 && s.triggers === 0 && s.n === 0) dip += 1;
      else if (s.lost >= 2 && s.triggers <= 1) dip += 1;
      for (const [k, v] of Object.entries(s.rejects)) {
        rej.set(k, (rej.get(k) ?? 0) + v);
      }
    }
    return {
      steps: n,
      meanN: sumN / n,
      meanTriggers: sumTrg / n,
      meanActive: sumAct / n,
      churnSteps: churn,
      maxLost,
      maxGained,
      triggerDipSteps: dip,
      topRejects: [...rej.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
    };
  },
};

function noteFlowBlink(
  obs: FieldObservation,
  batch: GrainEventBatch,
  step: number,
): void {
  const ids = (obs.flows ?? []).map((f) => f.id).sort((a, b) => a - b);
  const cur = new Set(ids);
  let gained = 0;
  let lost = 0;
  for (const id of cur) if (!prevFlowIds.has(id)) gained += 1;
  for (const id of prevFlowIds) if (!cur.has(id)) lost += 1;
  const triggers = batch.events.reduce(
    (n, e) => n + (e.regime === "flow" ? 1 : 0),
    0,
  );
  const sample: FlowBlinkSample = {
    step,
    n: ids.length,
    ids,
    gained,
    lost,
    triggers,
    active: batch.flowActive,
    rejects: { ...(obs.flowRejects ?? {}) },
  };
  lastFlowBlink = sample;
  flowBlinkRing.push(sample);
  if (flowBlinkRing.length > FLOW_BLINK_RING) {
    flowBlinkRing.splice(0, flowBlinkRing.length - FLOW_BLINK_RING);
  }
  prevFlowIds = cur;
}

function formatFlowRejects(rejects: Record<string, number>): string {
  const top = Object.entries(rejects)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  if (!top.length) return "";
  return top.map(([k, v]) => `${k}:${v}`).join(" ");
}

function commitProgram(next: TypeUProgram, resetColours: boolean): void {
  currentProgram = next;
  mappedDepth = next.depth;
  lastByDepth[next.depth] = next;
  if (resetColours) {
    host.reset();
    clearPipeline();
  }
  host.applyEquation(next.equation);
  controls.setProgram(next, next.equation);
  if (exploring) mountExploreNeighbors();
}

function cacheWavePeaks(): void {
  const bank = audio.getBank();
  if (!bank) {
    wavePeaks = null;
    controls.setHasSource(false);
    return;
  }
  const pcm = bank.pcmL;
  const n = 256;
  const peaks = new Float32Array(n);
  const hop = Math.max(1, Math.floor(pcm.length / n));
  for (let i = 0; i < n; i++) {
    let mag = 0;
    const start = i * hop;
    const end = i === n - 1 ? pcm.length : Math.min(pcm.length, start + hop);
    for (let j = start; j < end; j++) {
      const a = Math.abs(pcm[j]!);
      if (a > mag) mag = a;
    }
    peaks[i] = mag;
  }
  wavePeaks = peaks;
  controls.setHasSource(true);
}

function disposeExplorePreviews(): void {
  for (const preview of explorePreviews) preview.dispose();
  explorePreviews = [];
  exploreSky.replaceChildren();
}

function mountExploreNeighbors(): void {
  if (!exploring || !currentProgram) return;
  const neighbors = neighborPrograms(currentProgram);
  if (explorePreviews.length !== neighbors.length) {
    disposeExplorePreviews();
    neighbors.forEach((program, i) => {
      const star = document.createElement("button");
      star.type = "button";
      star.className = "star";
      star.style.setProperty("--a", `${PREVIEW_ANGLES[i]}deg`);
      star.title = "Travel";
      exploreSky.append(star);
      const preview = new UtomataHost(
        star,
        `preview-${i}`,
        PREVIEW_SIZE,
        PREVIEW_FPS,
      );
      preview.applyEquation(program.equation);
      if (host.isPaused()) preview.pause();
      explorePreviews.push(preview);
      star.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!currentProgram) return;
        const next = neighborPrograms(currentProgram)[i];
        if (next) commitProgram(next, true);
      });
    });
  } else {
    neighbors.forEach((program, i) => {
      const preview = explorePreviews[i]!;
      preview.reset();
      preview.applyEquation(program.equation);
    });
  }
  requestAnimationFrame(() => {
    host.fitZoom(caWrap);
    for (const preview of explorePreviews) preview.fitZoom();
  });
}

function closeExplore(): void {
  if (!exploring) return;
  exploring = false;
  document.body.classList.remove("exploring");
  caWrap.classList.remove("is-settle");
  for (const preview of explorePreviews) preview.pause();
  exploreSky.hidden = true;
  controls.setExplore(false);
  host.fitZoom(caWrap);
}

function openExplore(): boolean {
  if (!currentProgram || activePattern) return false;
  exploring = true;
  document.body.classList.add("exploring");
  caWrap.classList.add("is-settle");
  exploreSky.hidden = false;
  controls.setExplore(true);
  mountExploreNeighbors();
  if (!host.isPaused()) {
    for (const preview of explorePreviews) preview.play();
  }
  requestAnimationFrame(() => host.fitZoom(caWrap));
  return true;
}

function clearPipeline(): void {
  frameObserver.reset();
  fieldObserver.reset();
  scheduler.reset();
  audio.clearGrains();
  lastObservedStep = -1;
  lastObs = null;
  lastBatch = null;
  overlay.clear();
  onsetRing.length = 0;
  regionBirthStep.clear();
  regionTickerLog.length = 0;
  prevFlowIds = new Set();
  lastFlowBlink = null;
  flowBlinkRing.length = 0;
}

function pushFieldThroughPipeline(step: number): void {
  lastObservedStep = step;
  lastObs = fieldObserver.observe(
    frameObserver.current,
    frameObserver.previous,
  );
  lastBatch = scheduler.step(
    lastObs,
    frameObserver.current,
    performance.now(),
    audio.getBank()?.durationSec,
  );
  noteOnsets(lastBatch, performance.now());
  noteRegionLifecycle(lastObs, step);
  noteFlowBlink(lastObs, lastBatch, step);
  if (audio.isReady) {
    audio.sendEvents(lastBatch);
  }
}

function noteOnsets(batch: GrainEventBatch, nowMs: number): void {
  for (const ev of batch.events) {
    onsetRing.push({ t: ev.sampleCenter, bornMs: nowMs });
  }
  pruneOnsets(nowMs);
  if (onsetRing.length > ONSET_RING_MAX) {
    onsetRing.splice(0, onsetRing.length - ONSET_RING_MAX);
  }
}

function pruneOnsets(nowMs: number): void {
  const cutoff = nowMs - ONSET_PERSIST_MS;
  let drop = 0;
  while (drop < onsetRing.length && onsetRing[drop]!.bornMs < cutoff) {
    drop += 1;
  }
  if (drop > 0) onsetRing.splice(0, drop);
}

function noteRegionLifecycle(obs: FieldObservation, step: number): void {
  const ev = obs.regionEvents;
  if (ev) {
    for (const id of ev.births) {
      regionBirthStep.set(id, step);
      regionTickerLog.push({ kind: "birth", text: `+${id}` });
    }
    for (const m of ev.merges) {
      regionBirthStep.delete(m.from);
      regionTickerLog.push({
        kind: "merge",
        text: `${m.from}→${m.into}`,
      });
    }
    for (const id of ev.deaths) {
      regionBirthStep.delete(id);
      regionTickerLog.push({ kind: "death", text: `-${id}` });
    }
    if (regionTickerLog.length > REGION_TICKER_KEEP) {
      regionTickerLog.splice(0, regionTickerLog.length - REGION_TICKER_KEEP);
    }
  }
  const live = new Set(obs.coherent.map((r) => r.id));
  for (const id of [...regionBirthStep.keys()]) {
    if (!live.has(id)) regionBirthStep.delete(id);
  }
  for (const r of obs.coherent) {
    if (!regionBirthStep.has(r.id)) regionBirthStep.set(r.id, step);
  }
}

function buildRegionRows(
  obs: FieldObservation,
  batch: GrainEventBatch | null,
  step: number,
): {
  id: number;
  area: number;
  kappa: number;
  seats: number;
  active: number;
  age?: number;
}[] {
  const seatsById = new Map<number, { share: number; active: number }>();
  for (const s of batch?.regionSeats ?? []) {
    seatsById.set(s.id, s);
  }
  const rows: {
    id: number;
    area: number;
    kappa: number;
    seats: number;
    active: number;
    age?: number;
  }[] = [];
  for (const r of obs.coherent) {
    const seat = seatsById.get(r.id);
    const born = regionBirthStep.get(r.id);
    rows.push({
      id: r.id,
      area: r.area,
      kappa: r.meanCoherence,
      seats: seat?.share ?? 0,
      active: seat?.active ?? 0,
      age: born !== undefined ? Math.max(0, step - born) : undefined,
    });
  }
  rows.sort((a, b) => b.area - a.area || a.id - b.id);
  return rows.slice(0, REGION_ROW_MAX);
}

function ema(prev: number, next: number, a = METER_EMA): number {
  return prev + (next - prev) * a;
}

function downloadRecording(result: RecordingResult): void {
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
  const url = URL.createObjectURL(result.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ca-granular_${stamp}.${result.extension}`;
  a.click();
  URL.revokeObjectURL(url);
}

function syncSourceDuration(): void {
  const bank = audio.getBank();
  if (!bank) return;
  scheduler.setSourceDurationSec(bank.durationSec);
  scheduler.setMaterialSegments(bank.segments);
}

async function ensureDefaultSource(): Promise<void> {
  if (audio.hasSource) return;
  if (!defaultSourcePromise) {
    defaultSourcePromise = (async () => {
      await audio.loadUrl(DEFAULT_SOURCE_URL);
      syncSourceDuration();
      cacheWavePeaks();
    })().catch((err) => {
      defaultSourcePromise = null;
      throw err;
    });
  }
  await defaultSourcePromise;
}

const controls = mountControls(app, {
  onResetColours() {
    if (activePattern) {
      syntheticStep = 0;
      syntheticAccSec = 0;
      clearPipeline();
      return;
    }
    host.reset();
    clearPipeline();
  },
  onSelectSimSource(id) {
    if (id === "utomata" || id === "") {
      activePattern = null;
      patternPaused = false;
      patternCanvas.hidden = true;
      syntheticStep = 0;
      syntheticAccSec = 0;
      clearPipeline();
      host.play();
      controls.setPaused(false);
      controls.setTypeUEnabled(true);
      return;
    }
    closeExplore();
    const pattern = getTestPattern(id);
    if (!pattern) return;
    activePattern = pattern;
    patternPaused = false;
    patternCanvas.hidden = false;
    host.pause();
    // The pattern clock is running — Pause button controls it, not Utomata.
    controls.setPaused(false);
    controls.setTypeUEnabled(false);
    syntheticStep = 0;
    syntheticAccSec = 0;
    clearPipeline();
  },
  onTogglePause() {
    if (activePattern) {
      patternPaused = !patternPaused;
      if (!patternPaused) syntheticAccSec = 0;
      return patternPaused;
    }
    const paused = host.togglePause();
    for (const preview of explorePreviews) {
      if (paused) preview.pause();
      else preview.play();
    }
    return paused;
  },
  onRandomEquation() {
    commitProgram(randomProgram(mappedDepth), true);
  },
  onCycleSlot(slotIndex, dir) {
    if (!currentProgram) return;
    commitProgram(cycleSlot(currentProgram, slotIndex, dir), false);
  },
  onSetDepth(depth) {
    if (currentProgram?.depth === depth) return;
    const next = lastByDepth[depth] ?? seedProgram(depth);
    commitProgram(next, true);
  },
  async onToggleAudio() {
    try {
      if (audio.isAudible) {
        audio.setMuted(true);
        audioStatus = "muted";
        controls.setAudioEnabled(false);
        pushStats(true);
        return false;
      }

      audio.setMuted(false);
      audioStatus = "starting…";
      pushStats(true);
      await audio.ensureRunning();
      if (!audio.hasSource) {
        audioStatus = "loading default source…";
        pushStats(true);
        await ensureDefaultSource();
      }

      audioStatus = audio.isAudible
        ? "running"
        : `blocked (${audio.contextState}) — click again`;
      controls.setAudioEnabled(audio.isAudible);
      pushStats(true);
      return audio.isAudible;
    } catch (err) {
      console.error(err);
      audioStatus = "audio init failed";
      controls.setAudioEnabled(false);
      controls.setRecording(false);
      pushStats(true);
      return false;
    }
  },
  async onToggleRecord() {
    try {
      if (audio.isRecording) {
        const result = await audio.stopRecording();
        controls.setRecording(false);
        if (result) {
          downloadRecording(result);
          audioStatus = audio.isReady ? "running · saved recording" : "stopped";
        } else {
          audioStatus = audio.isReady
            ? "running · empty recording"
            : "stopped";
        }
        pushStats(true);
        return false;
      }

      if (!audio.isEnabled) {
        audioStatus = "enable audio to record";
        pushStats(true);
        return false;
      }

      audio.startRecording();
      controls.setRecording(true);
      audioStatus = "recording…";
      pushStats(true);
      return true;
    } catch (err) {
      console.error(err);
      controls.setRecording(false);
      audioStatus =
        err instanceof Error ? err.message : "recording failed";
      pushStats(true);
      return false;
    }
  },
  onToggleOverlay() {
    overlayVisible = !overlayVisible;
    overlay.setVisible(overlayVisible);
    controls.setOverlayVisible(overlayVisible);
    if (!overlayVisible) overlay.clear();
    pushStats(true);
    return overlayVisible;
  },
  onToggleData() {
    dataOpen = !dataOpen;
    return dataOpen;
  },
  onToggleExplore() {
    if (exploring) {
      closeExplore();
      return false;
    }
    return openExplore();
  },
  async onArmAudio() {
    try {
      await audio.ensureRunning();
    } catch (err) {
      console.error(err);
    }
  },
  onSetOutputGain(gain) {
    audio.setOutputGain(gain);
  },
  async onLoadAudio(file) {
    audioStatus = "decoding…";
    pushStats(true);
    try {
      audio.setMuted(false);
      await audio.loadFile(file);
      syncSourceDuration();
      cacheWavePeaks();
      defaultSourcePromise = Promise.resolve();
      if (!audio.isEnabled) {
        await audio.ensureRunning();
      }
      audioStatus = audio.isAudible
        ? `loaded · ${file.name}`
        : `loaded · ${file.name} · ctx ${audio.contextState}`;
      controls.setAudioEnabled(audio.isAudible);
    } catch (err) {
      console.error(err);
      audioStatus = "load failed";
    }
    pushStats(true);
  },
});

const startProgram = seedProgram(1);
controls.setProgram(startProgram, startProgram.equation);
controls.setTypeUEnabled(true);
overlay.setVisible(false);
controls.setOverlayVisible(false);
controls.setAudioEnabled(false);
controls.setRecording(false);
controls.setHasSource(audio.hasSource);
controls.setOutputGain(audio.getOutputGain());

caWrap.addEventListener("click", () => {
  if (exploring) closeExplore();
});

const ro = new ResizeObserver(() => {
  host.fitZoom(caWrap);
  for (const preview of explorePreviews) preview.fitZoom();
});
ro.observe(caWrap);
window.addEventListener("resize", () => {
  host.fitZoom(caWrap);
  for (const preview of explorePreviews) preview.fitZoom();
});

function pushStats(forceMeter = false) {
  const stats = audio.getStats();
  const now = performance.now();
  // Diagnostics stay live while muted — gate on engine-ready, not audible.
  overlay.draw(lastObs, audio.isReady ? stats : null);
  pruneOnsets(now);
  wave.draw(wavePeaks, audio.isReady ? stats : null, {
    segments: audio.getBank()?.segments ?? null,
    onsets: onsetRing,
    nowMs: now,
  });

  const due =
    forceMeter ||
    now - lastMeterUiAt >= 1000 / (overlayVisible ? 15 : METER_UI_HZ);

  let meter: AudioMeterStats | null = smoothMeter;
  if (audio.isReady && stats && due) {
    lastMeterUiAt = now;
    const raw: AudioMeterStats = {
      rms: stats.rms,
      peak: stats.peak,
      masterGain: stats.masterGain,
      activeVoices: stats.activeGrains,
      sounding: stats.sounding,
      triggersPerSec: stats.triggersPerSec,
    };
    if (!smoothMeter) {
      smoothMeter = { ...raw };
    } else {
      smoothMeter = {
        rms: ema(smoothMeter.rms, raw.rms),
        peak: ema(smoothMeter.peak, raw.peak),
        masterGain: ema(smoothMeter.masterGain, raw.masterGain),
        activeVoices: raw.activeVoices,
        sounding: raw.sounding,
        triggersPerSec: ema(smoothMeter.triggersPerSec, raw.triggersPerSec),
      };
    }
    meter = smoothMeter;
  } else if (!audio.isReady) {
    smoothMeter = null;
    meter = null;
  }

  let field: FieldMeterStats | null = null;
  if (lastObs) {
    let calmMeanDelta = 0;
    let calmArea = 0;
    for (const r of lastObs.coherent) {
      calmMeanDelta += r.meanDelta * r.area;
      calmArea += r.area;
    }
    calmMeanDelta = calmArea > 0 ? calmMeanDelta / calmArea : 0;
    const chaosMeanDelta = lastObs.chaotic.meanDelta;
    const chaosT = Math.min(
      1,
      Math.max(0, chaosMeanDelta / SCHED.deltaRateNorm),
    );
    const staticMeanDelta = lastObs.textured.meanDelta;
    const rawDelta = {
      chaosMeanDelta,
      chaosT,
      calmMeanDelta,
      staticMeanDelta,
    };
    if (due || forceMeter || !smoothFieldDelta) {
      if (!smoothFieldDelta || forceMeter) {
        smoothFieldDelta = { ...rawDelta };
      } else {
        smoothFieldDelta = {
          chaosMeanDelta: ema(
            smoothFieldDelta.chaosMeanDelta,
            rawDelta.chaosMeanDelta,
          ),
          chaosT: ema(smoothFieldDelta.chaosT, rawDelta.chaosT),
          calmMeanDelta: ema(
            smoothFieldDelta.calmMeanDelta,
            rawDelta.calmMeanDelta,
          ),
          staticMeanDelta: ema(
            smoothFieldDelta.staticMeanDelta,
            rawDelta.staticMeanDelta,
          ),
        };
      }
      if (!audio.isReady && due) lastMeterUiAt = now;
    }
    // 16k HSV conversions — meter-rate only, not every rAF frame.
    if (due || forceMeter || !cachedColourDiag) {
      cachedColourDiag = fieldColourDiagnostics(frameObserver.current);
    }
    const colourDiag = cachedColourDiag;
    const rawBudget = {
      calmGrains: lastBatch?.calmActive ?? 0,
      chaosGrains: lastBatch?.chaosActive ?? 0,
      textureGrains: lastBatch?.textureActive ?? 0,
      oscGrains: lastBatch?.oscActive ?? 0,
      flowGrains: lastBatch?.flowActive ?? 0,
      shareCalm: lastBatch?.shares.calm ?? 0,
      shareTexture: lastBatch?.shares.texture ?? 0,
      shareChaos: lastBatch?.shares.chaos ?? 0,
      shareOsc: lastBatch?.shares.osc ?? 0,
      shareFlow: lastBatch?.shares.flow ?? 0,
      predictedActive: lastBatch?.predictedActive ?? 0,
    };
    if (due || forceMeter || !smoothBudget) {
      if (!smoothBudget || forceMeter) {
        smoothBudget = { ...rawBudget };
      } else {
        smoothBudget = {
          calmGrains: ema(
            smoothBudget.calmGrains,
            rawBudget.calmGrains,
            BUDGET_METER_EMA,
          ),
          chaosGrains: ema(
            smoothBudget.chaosGrains,
            rawBudget.chaosGrains,
            BUDGET_METER_EMA,
          ),
          textureGrains: ema(
            smoothBudget.textureGrains,
            rawBudget.textureGrains,
            BUDGET_METER_EMA,
          ),
          oscGrains: ema(
            smoothBudget.oscGrains,
            rawBudget.oscGrains,
            BUDGET_METER_EMA,
          ),
          flowGrains: ema(
            smoothBudget.flowGrains,
            rawBudget.flowGrains,
            BUDGET_METER_EMA,
          ),
          shareCalm: ema(
            smoothBudget.shareCalm,
            rawBudget.shareCalm,
            BUDGET_METER_EMA,
          ),
          shareTexture: ema(
            smoothBudget.shareTexture,
            rawBudget.shareTexture,
            BUDGET_METER_EMA,
          ),
          shareChaos: ema(
            smoothBudget.shareChaos,
            rawBudget.shareChaos,
            BUDGET_METER_EMA,
          ),
          shareOsc: ema(
            smoothBudget.shareOsc,
            rawBudget.shareOsc,
            BUDGET_METER_EMA,
          ),
          shareFlow: ema(
            smoothBudget.shareFlow,
            rawBudget.shareFlow,
            BUDGET_METER_EMA,
          ),
          predictedActive: ema(
            smoothBudget.predictedActive,
            rawBudget.predictedActive,
            BUDGET_METER_EMA,
          ),
        };
      }
    }
    field = {
      regions: lastObs.coherent.length,
      calmPct: lastObs.calmAreaFraction,
      chaosPct: lastObs.chaosAreaFraction,
      staticPct: lastObs.texturedAreaFraction,
      oscPct:
        lastObs.oscillators.reduce((sum, g) => sum + g.area, 0) /
        (lastObs.width * lastObs.height),
      flowPct: lastObs.flowAreaFraction,
      meanKappa: lastObs.meanCoherence,
      chaosMeanDelta: smoothFieldDelta!.chaosMeanDelta,
      chaosT: smoothFieldDelta!.chaosT,
      calmMeanDelta: smoothFieldDelta!.calmMeanDelta,
      staticMeanDelta: smoothFieldDelta!.staticMeanDelta,
      meanSat: colourDiag.meanSat,
      hueSpread: colourDiag.hueSpread,
      calmGrains: smoothBudget!.calmGrains,
      chaosGrains: smoothBudget!.chaosGrains,
      textureGrains: smoothBudget!.textureGrains,
      oscGrains: smoothBudget!.oscGrains,
      flowGrains: smoothBudget!.flowGrains,
      shareCalm: smoothBudget!.shareCalm,
      shareTexture: smoothBudget!.shareTexture,
      shareChaos: smoothBudget!.shareChaos,
      shareOsc: smoothBudget!.shareOsc,
      shareFlow: smoothBudget!.shareFlow,
      budget: lastBatch?.budget ?? scheduler.budget,
      predictedActive: smoothBudget!.predictedActive,
      stepHz: lastBatch?.measuredStepHz,
      regionRows: buildRegionRows(
        lastObs,
        lastBatch,
        lastObservedStep,
      ),
      regionTicker: regionTickerLog.slice(),
      flowBlink:
        overlayVisible && lastFlowBlink
          ? {
              n: lastFlowBlink.n,
              gained: lastFlowBlink.gained,
              lost: lastFlowBlink.lost,
              triggers: lastFlowBlink.triggers,
              active: lastFlowBlink.active,
              rejects: formatFlowRejects(lastFlowBlink.rejects),
            }
          : undefined,
    };
  } else {
    smoothFieldDelta = null;
    smoothBudget = null;
  }

  if (due || forceMeter || !audio.isReady) {
    const outMeter =
      meter && audio.isAudible
        ? {
            ...meter,
            rms: meter.rms * audio.getOutputGain(),
            peak: Math.min(1, meter.peak * audio.getOutputGain()),
          }
        : meter
          ? { ...meter, rms: 0, peak: 0 }
          : null;
    controls.setStats({
      step: activePattern ? syntheticStep : host.getStep(),
      fps: host.getFps(),
      energy: lastObs?.meanDelta ?? 0,
      audio: audioStatus,
      meter: outMeter,
      field,
      gainBarMax: MASTER_GAIN * 2,
    });
  }
}

function tick() {
  const now = performance.now();
  const dtSec = Math.min(0.1, (now - lastTickMs) / 1000);
  lastTickMs = now;

  if (activePattern && !patternPaused) {
    syntheticAccSec += dtSec;
    const stepSec = 1 / 30;
    while (syntheticAccSec >= stepSec) {
      syntheticAccSec -= stepSec;
      syntheticStep += 1;
      fillRgba(
        activePattern,
        patternRgba,
        GRID_SIZE,
        GRID_SIZE,
        syntheticStep,
      );
      patternCtx.putImageData(patternImage, 0, 0);
      const advanced = frameObserver.ingest(patternRgba, syntheticStep);
      if (advanced) {
        pushFieldThroughPipeline(syntheticStep);
      }
    }
  } else {
    const step = host.getStep();
    if (step !== lastObservedStep) {
      let img: Uint8ClampedArray;
      try {
        img = host.getImgData();
      } catch {
        requestAnimationFrame(tick);
        return;
      }

      const advanced = frameObserver.ingest(img, step);
      if (advanced) {
        pushFieldThroughPipeline(step);
      }
    }
  }

  pushStats();
  requestAnimationFrame(tick);
}

/** Diagnostic: mean saturation + hue spread (1 − mean resultant length). */
function fieldColourDiagnostics(field: RgbField): {
  meanSat: number;
  hueSpread: number;
} {
  const n = field.width * field.height;
  let sumSat = 0;
  let sumC = 0;
  let sumS = 0;
  let coloured = 0;
  for (let i = 0; i < n; i++) {
    const { h, s } = rgbToHsv(field.r[i]!, field.g[i]!, field.b[i]!);
    sumSat += s;
    if (s > 0.05) {
      const ang = h * Math.PI * 2;
      sumC += Math.cos(ang);
      sumS += Math.sin(ang);
      coloured += 1;
    }
  }
  const meanSat = sumSat / Math.max(1, n);
  if (coloured < 1) return { meanSat, hueSpread: 0 };
  const R = Math.hypot(sumC / coloured, sumS / coloured);
  return { meanSat, hueSpread: Math.max(0, Math.min(1, 1 - R)) };
}

requestAnimationFrame(tick);
