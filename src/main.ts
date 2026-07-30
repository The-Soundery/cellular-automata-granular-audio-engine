import { UtomataHost, GRID_SIZE } from "./ca/UtomataHost.ts";
import {
  TYPE_U_SEED,
  randomVariation,
  variationAt,
} from "./ca/typeU.ts";
import { FrameObserver } from "./field/FrameObserver.ts";
import { FieldMetrics, MASTER_GAIN_MAX } from "./field/FieldMetrics.ts";
import { AudioEngine } from "./audio/AudioEngine.ts";
import { mountControls, type AudioMeterStats } from "./ui/controls.ts";
import { ListenOverlay } from "./ui/listenOverlay.ts";
import "./style.css";

/** Listening meters refresh ~5 Hz so Trig/s is readable. */
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
const overlay = new ListenOverlay(caWrap);
const observer = new FrameObserver(GRID_SIZE, GRID_SIZE);
const metrics = new FieldMetrics(GRID_SIZE, GRID_SIZE);
const audio = new AudioEngine();

let variationIndex = 0;
let lastEnergy = 0;
let lastObservedStep = -1;
let audioStatus = "idle";
let lastMeterUiAt = 0;
let smoothMeter: AudioMeterStats | null = null;

function ema(prev: number, next: number, a = METER_EMA): number {
  return prev + (next - prev) * a;
}

const controls = mountControls(controlsMount, {
  onApplyEquation(eq) {
    host.applyEquation(eq);
  },
  onReset() {
    host.reset();
  },
  onTogglePause() {
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
  async onStartAudio() {
    try {
      await audio.ensureRunning();
      audioStatus = audio.isReady
        ? audio.hasSource
          ? "running"
          : "awaiting source"
        : `blocked (${audio.contextState}) — click Enable again`;
    } catch (err) {
      console.error(err);
      audioStatus = "audio init failed";
    }
    pushStats(true);
  },
  async onLoadAudio(file) {
    audioStatus = "decoding…";
    pushStats(true);
    try {
      await audio.loadFile(file);
      audioStatus = audio.isReady
        ? `loaded · ${file.name}`
        : `loaded · ${file.name} · ctx ${audio.contextState} — click Enable`;
    } catch (err) {
      console.error(err);
      audioStatus = "load failed";
    }
    pushStats(true);
  },
});

controls.setEquation(TYPE_U_SEED);

const ro = new ResizeObserver(() => host.fitZoom(caWrap));
ro.observe(caWrap);
window.addEventListener("resize", () => host.fitZoom(caWrap));

function pushStats(forceMeter = false) {
  const stats = audio.getStats();
  overlay.draw(audio.isReady ? stats : null);

  const now = performance.now();
  const due =
    forceMeter || now - lastMeterUiAt >= 1000 / METER_UI_HZ;

  let meter: AudioMeterStats | null = smoothMeter;
  if (audio.isReady && stats && due) {
    lastMeterUiAt = now;
    const listen = stats.listen;
    const n = listen.length || 1;
    const meanR = listen.reduce((a, v) => a + v.r, 0) / n;
    const meanG = listen.reduce((a, v) => a + v.g, 0) / n;
    const meanLen = listen.reduce((a, v) => a + v.len, 0) / n;
    const raw: AudioMeterStats = {
      rms: stats.rms,
      peak: stats.peak,
      masterGain: stats.masterGain,
      activeVoices: stats.activeVoices,
      sounding: stats.sounding,
      triggersPerSec: stats.triggersPerSec,
      deferredPerSec: stats.deferredPerSec,
      meanR,
      meanG,
      meanLen,
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
        deferredPerSec: ema(smoothMeter.deferredPerSec, raw.deferredPerSec),
        meanR: ema(smoothMeter.meanR, raw.meanR),
        meanG: ema(smoothMeter.meanG, raw.meanG),
        meanLen: ema(smoothMeter.meanLen, raw.meanLen),
      };
    }
    meter = smoothMeter;
  } else if (!audio.isReady) {
    smoothMeter = null;
    meter = null;
  }

  if (due || forceMeter || !audio.isReady) {
    controls.setStats({
      step: host.getStep(),
      fps: host.getFps(),
      energy: lastEnergy,
      audio: audioStatus,
      meter,
      gainBarMax: MASTER_GAIN_MAX,
    });
  }
}

function tick() {
  const step = host.getStep();

  if (step !== lastObservedStep) {
    let img: Uint8ClampedArray;
    try {
      img = host.getImgData();
    } catch {
      requestAnimationFrame(tick);
      return;
    }

    const advanced = observer.ingest(img, step);
    if (advanced) {
      lastObservedStep = step;
      const plan = metrics.analyze(observer.current, observer.previous);
      lastEnergy = plan.energy;
      if (audio.isReady) {
        audio.sendPlan(plan);
      }
    }
  }

  pushStats();
  requestAnimationFrame(tick);
}

requestAnimationFrame(tick);
