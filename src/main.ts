import { UtomataHost, GRID_SIZE } from "./ca/UtomataHost.ts";
import {
  TYPE_U_SEED,
  randomVariation,
  variationAt,
} from "./ca/typeU.ts";
import { FrameObserver } from "./field/FrameObserver.ts";
import { FieldObserver, type FieldObservation } from "./field/FieldObserver.ts";
import {
  GrainScheduler,
  MASTER_GAIN,
  type GrainEventBatch,
} from "./field/GrainScheduler.ts";
import {
  fillRgba,
  getTestPattern,
  type TestPattern,
} from "./field/TestPatterns.ts";
import { AudioEngine, type RecordingResult } from "./audio/AudioEngine.ts";
import { mountControls, type AudioMeterStats } from "./ui/controls.ts";
import { RegionOverlay } from "./ui/RegionOverlay.ts";
import "./style.css";

const DEFAULT_SOURCE_URL = "/default-source.wav";
const METER_UI_HZ = 5;
const METER_EMA = 0.35;

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app missing");

app.innerHTML = `
  <div class="stage">
    <div class="ca-wrap" id="ca-wrap"></div>
  </div>
  <div id="controls-mount"></div>
`;

const caWrap = document.querySelector<HTMLElement>("#ca-wrap")!;
const controlsMount = document.querySelector<HTMLElement>("#controls-mount")!;

const host = new UtomataHost(caWrap);
const overlay = new RegionOverlay(caWrap);
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

let variationIndex = 0;
let lastObs: FieldObservation | null = null;
let lastBatch: GrainEventBatch | null = null;
let lastObservedStep = -1;
let audioStatus = "idle";
let lastMeterUiAt = 0;
let smoothMeter: AudioMeterStats | null = null;
let overlayVisible = true;
let defaultSourcePromise: Promise<void> | null = null;
/** null = live Utomata; else active synthetic pattern. */
let activePattern: TestPattern | null = null;
let patternPaused = false;
let syntheticStep = 0;
let syntheticAccSec = 0;
let lastTickMs = performance.now();

function clearPipeline(): void {
  frameObserver.reset();
  fieldObserver.reset();
  scheduler.reset();
  audio.clearGrains();
  lastObservedStep = -1;
  lastObs = null;
  lastBatch = null;
  overlay.clear();
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
  if (audio.isReady) {
    audio.sendEvents(lastBatch);
  }
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
  scheduler.setHueSampleLut(bank.hueSampleLut);
}

async function ensureDefaultSource(): Promise<void> {
  if (audio.hasSource) return;
  if (!defaultSourcePromise) {
    defaultSourcePromise = (async () => {
      await audio.loadUrl(DEFAULT_SOURCE_URL);
      syncSourceDuration();
    })().catch((err) => {
      defaultSourcePromise = null;
      throw err;
    });
  }
  await defaultSourcePromise;
}

const controls = mountControls(controlsMount, {
  onApplyEquation(eq) {
    host.applyEquation(eq);
  },
  onReset() {
    if (activePattern) {
      syntheticStep = 0;
      syntheticAccSec = 0;
      clearPipeline();
    } else {
      host.reset();
      clearPipeline();
    }
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
      return;
    }
    const pattern = getTestPattern(id);
    if (!pattern) return;
    activePattern = pattern;
    patternPaused = false;
    patternCanvas.hidden = false;
    host.pause();
    // The pattern clock is running — Pause button controls it, not Utomata.
    controls.setPaused(false);
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
    return host.togglePause();
  },
  onPrevVariation() {
    variationIndex = Math.max(0, variationIndex - 1);
    const eq = variationAt(variationIndex);
    controls.setEquation(eq);
    return eq;
  },
  onNextVariation() {
    variationIndex += 1;
    const eq = variationAt(variationIndex);
    controls.setEquation(eq);
    return eq;
  },
  onRandomVariation() {
    variationIndex = (Math.random() * 1e6) | 0;
    const eq = randomVariation(variationIndex);
    controls.setEquation(eq);
    return eq;
  },
  async onToggleAudio() {
    try {
      if (audio.isEnabled) {
        const result = await audio.stop();
        if (result) downloadRecording(result);
        controls.setRecording(false);
        audioStatus = audio.hasSource ? "stopped" : "idle";
        smoothMeter = null;
        controls.setAudioEnabled(false);
        pushStats(true);
        return false;
      }

      audioStatus = "starting…";
      pushStats(true);
      await audio.ensureRunning();
      if (!audio.hasSource) {
        audioStatus = "loading default source…";
        pushStats(true);
        await ensureDefaultSource();
      } else if (audio.contextState === "suspended") {
        await audio.ensureRunning();
      }

      audioStatus = audio.isReady
        ? "running"
        : `blocked (${audio.contextState}) — click Enable again`;
      controls.setAudioEnabled(audio.isEnabled);
      pushStats(true);
      return audio.isEnabled;
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
    return overlayVisible;
  },
  async onLoadAudio(file) {
    audioStatus = "decoding…";
    pushStats(true);
    try {
      await audio.loadFile(file);
      syncSourceDuration();
      defaultSourcePromise = Promise.resolve();
      audioStatus = audio.isReady
        ? `loaded · ${file.name}`
        : `loaded · ${file.name} · ctx ${audio.contextState}`;
      controls.setAudioEnabled(audio.isEnabled);
    } catch (err) {
      console.error(err);
      audioStatus = "load failed";
    }
    pushStats(true);
  },
});

controls.setEquation(TYPE_U_SEED);
controls.setOverlayVisible(true);
controls.setAudioEnabled(false);
controls.setRecording(false);

const ro = new ResizeObserver(() => host.fitZoom(caWrap));
ro.observe(caWrap);
window.addEventListener("resize", () => host.fitZoom(caWrap));

function pushStats(forceMeter = false) {
  const stats = audio.getStats();
  overlay.draw(lastObs, audio.isReady ? stats : null);

  const now = performance.now();
  const due =
    forceMeter || now - lastMeterUiAt >= 1000 / METER_UI_HZ;

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

  if (due || forceMeter || !audio.isReady) {
    controls.setStats({
      step: activePattern ? syntheticStep : host.getStep(),
      fps: host.getFps(),
      energy: lastObs?.meanDelta ?? 0,
      audio: audioStatus,
      meter,
      field: lastObs
        ? {
            regions: lastObs.coherent.length,
            calmPct: lastObs.calmAreaFraction,
            chaosPct: lastObs.chaosAreaFraction,
            staticPct: lastObs.texturedAreaFraction,
            oscPct:
              lastObs.oscillators.reduce((sum, g) => sum + g.area, 0) /
              (lastObs.width * lastObs.height),
            meanKappa: lastObs.meanCoherence,
            calmGrains: lastBatch?.calmActive ?? 0,
            chaosGrains: lastBatch?.chaosActive ?? 0,
            textureGrains: lastBatch?.textureActive ?? 0,
            oscGrains: lastBatch?.oscActive ?? 0,
            shareCalm: lastBatch?.shares.calm ?? 0,
            shareTexture: lastBatch?.shares.texture ?? 0,
            shareChaos: lastBatch?.shares.chaos ?? 0,
            shareOsc: lastBatch?.shares.osc ?? 0,
            budget: lastBatch?.budget ?? scheduler.budget,
            predictedActive: lastBatch?.predictedActive ?? 0,
          }
        : null,
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

requestAnimationFrame(tick);
