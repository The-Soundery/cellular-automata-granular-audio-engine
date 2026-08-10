import { TYPE_U_SEED } from "../ca/typeU.ts";
import { TEST_PATTERNS } from "../field/TestPatterns.ts";

export interface ControlsHandlers {
  onApplyEquation: (eq: string) => void;
  onReset: () => void;
  onTogglePause: () => boolean;
  onPrevVariation: () => string;
  onNextVariation: () => string;
  onRandomVariation: () => string;
  onLoadAudio: (file: File) => Promise<void>;
  onToggleAudio: () => Promise<boolean>;
  onToggleRecord: () => Promise<boolean>;
  onToggleOverlay: () => boolean;
  onSelectSimSource: (id: string) => void;
}

export interface AudioMeterStats {
  rms: number;
  peak: number;
  masterGain: number;
  activeVoices: number | string;
  sounding: number | string;
  triggersPerSec: number;
}

export interface FieldMeterStats {
  regions: number;
  calmPct: number;
  chaosPct: number;
  /** Textured / static fraction (Phase 4); optional until then. */
  staticPct?: number;
  /** Confirmed oscillator fraction (Phase 6). */
  oscPct?: number;
  meanKappa: number;
  /** Per-pool mean δ and chaos spend term (V4.4 Phase 7). */
  chaosMeanDelta?: number;
  chaosT?: number;
  calmMeanDelta?: number;
  staticMeanDelta?: number;
  calmGrains: number;
  chaosGrains: number;
  textureGrains?: number;
  oscGrains?: number;
  shareCalm?: number;
  shareTexture?: number;
  shareChaos?: number;
  shareOsc?: number;
  budget: number;
  predictedActive: number;
}

export interface ControlsApi {
  setEquation: (eq: string) => void;
  setPaused: (paused: boolean) => void;
  setAudioEnabled: (enabled: boolean) => void;
  setRecording: (recording: boolean) => void;
  setOverlayVisible: (visible: boolean) => void;
  setSimSource: (id: string) => void;
  setStats: (s: {
    step: number;
    fps: number;
    energy: number;
    audio: string;
    meter: AudioMeterStats | null;
    field: FieldMeterStats | null;
    gainBarMax?: number;
  }) => void;
  root: HTMLElement;
}

export function mountControls(
  parent: HTMLElement,
  handlers: ControlsHandlers,
): ControlsApi {
  const root = document.createElement("aside");
  root.className = "controls";
  root.innerHTML = `
    <div class="brand">CA Granular</div>
    <label class="field">
      <span>Sim</span>
      <select id="sim-source">
        <option value="utomata">Utomata (live CA)</option>
        ${TEST_PATTERNS.map(
          (p) => `<option value="${p.id}">${p.label}</option>`,
        ).join("")}
      </select>
    </label>
    <label class="field">
      <span>Equation</span>
      <textarea id="eq" rows="3" spellcheck="false"></textarea>
    </label>
    <div class="row">
      <button type="button" id="apply">Apply</button>
      <button type="button" id="reset">Reset</button>
      <button type="button" id="pause">Pause</button>
    </div>
    <div class="row">
      <button type="button" id="prev">← Var</button>
      <button type="button" id="rand">Random</button>
      <button type="button" id="next">Var →</button>
    </div>
    <div class="row">
      <button type="button" id="audio-toggle">Enable Audio</button>
      <label class="file-btn">
        Load Audio
        <input id="file" type="file" accept="audio/*,.wav,.mp3,.aiff,.aif,.ogg" hidden />
      </label>
    </div>
    <div class="row">
      <button type="button" id="record-toggle">Record</button>
      <button type="button" id="overlay-toggle">Overlay: On</button>
    </div>
    <div class="overlay-legend" aria-label="Overlay regime colours">
      <span class="leg-swatch leg-calm"></span><span>Calm</span>
      <span class="leg-swatch leg-tex"></span><span>Static</span>
      <span class="leg-swatch leg-chaos"></span><span>Chaos</span>
      <span class="leg-swatch leg-osc"></span><span>Osc</span>
    </div>
    <dl class="stats">
      <div><dt>Step</dt><dd id="st-step">0</dd></div>
      <div><dt>FPS</dt><dd id="st-fps">0</dd></div>
      <div><dt>Field Δ</dt><dd id="st-energy">0</dd></div>
      <div><dt>Audio</dt><dd id="st-audio">idle</dd></div>
    </dl>
    <div class="meter-block">
      <div class="meter-title">Field observation</div>
      <dl class="stats stats-audio">
        <div><dt>Regions</dt><dd id="st-regions">—</dd></div>
        <div><dt>Calm %</dt><dd id="st-calm">—</dd></div>
        <div><dt>Static %</dt><dd id="st-static">—</dd></div>
        <div><dt>Chaos %</dt><dd id="st-chaos">—</dd></div>
        <div><dt>Osc %</dt><dd id="st-osc">—</dd></div>
        <div><dt>Mean κ</dt><dd id="st-kappa">—</dd></div>
        <div><dt>Chaos δ̄</dt><dd id="st-chaos-delta">—</dd></div>
        <div><dt>Chaos t</dt><dd id="st-chaos-t">—</dd></div>
        <div><dt>Calm δ̄</dt><dd id="st-calm-delta">—</dd></div>
        <div><dt>Static δ̄</dt><dd id="st-static-delta">—</dd></div>
        <div><dt>Budget</dt><dd id="st-budget">—</dd></div>
        <div><dt>Spend</dt><dd id="st-spend">—</dd></div>
      </dl>
    </div>
    <div class="meter-block">
      <div class="meter-title">Listening</div>
      <div class="meter-bars">
        <div class="meter-row"><span>RMS</span><div class="bar"><i id="bar-rms"></i></div><em id="st-rms">—</em></div>
        <div class="meter-row"><span>Peak</span><div class="bar"><i id="bar-peak"></i></div><em id="st-peak">—</em></div>
        <div class="meter-row"><span>Gain</span><div class="bar"><i id="bar-gain"></i></div><em id="st-gain">—</em></div>
      </div>
      <dl class="stats stats-audio">
        <div><dt>Grains</dt><dd id="st-voices">—</dd></div>
        <div><dt>Sounding</dt><dd id="st-sounding">—</dd></div>
        <div><dt>Events/s</dt><dd id="st-trigs">—</dd></div>
      </dl>
      <p class="meter-hint">Sonic Laws V4 — hue→sample (frozen) · pan/Y follow region · neutral loudness</p>
    </div>
  `;
  parent.appendChild(root);

  const eqEl = root.querySelector("#eq") as HTMLTextAreaElement;
  const simEl = root.querySelector("#sim-source") as HTMLSelectElement;
  const pauseBtn = root.querySelector("#pause") as HTMLButtonElement;
  const audioBtn = root.querySelector("#audio-toggle") as HTMLButtonElement;
  const recordBtn = root.querySelector("#record-toggle") as HTMLButtonElement;
  const overlayBtn = root.querySelector("#overlay-toggle") as HTMLButtonElement;
  eqEl.value = TYPE_U_SEED;

  simEl.addEventListener("change", () => {
    handlers.onSelectSimSource(simEl.value);
  });

  root.querySelector("#apply")!.addEventListener("click", () => {
    handlers.onApplyEquation(eqEl.value);
  });
  root.querySelector("#reset")!.addEventListener("click", () => {
    handlers.onReset();
  });
  pauseBtn.addEventListener("click", () => {
    const paused = handlers.onTogglePause();
    pauseBtn.textContent = paused ? "Play" : "Pause";
  });
  root.querySelector("#prev")!.addEventListener("click", () => {
    eqEl.value = handlers.onPrevVariation();
    handlers.onApplyEquation(eqEl.value);
  });
  root.querySelector("#next")!.addEventListener("click", () => {
    eqEl.value = handlers.onNextVariation();
    handlers.onApplyEquation(eqEl.value);
  });
  root.querySelector("#rand")!.addEventListener("click", () => {
    eqEl.value = handlers.onRandomVariation();
    handlers.onApplyEquation(eqEl.value);
  });
  audioBtn.addEventListener("click", () => {
    void handlers.onToggleAudio().then((enabled) => {
      audioBtn.textContent = enabled ? "Stop Audio" : "Enable Audio";
    });
  });
  recordBtn.addEventListener("click", () => {
    void handlers.onToggleRecord().then((recording) => {
      setRecordingUi(recording);
    });
  });
  overlayBtn.addEventListener("click", () => {
    const visible = handlers.onToggleOverlay();
    overlayBtn.textContent = visible ? "Overlay: On" : "Overlay: Off";
  });
  root.querySelector("#file")!.addEventListener("change", (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void handlers.onLoadAudio(file);
  });

  function setRecordingUi(recording: boolean) {
    recordBtn.textContent = recording ? "Stop Recording" : "Record";
    recordBtn.classList.toggle("recording", recording);
  }

  function setBar(id: string, value: number, max: number) {
    const el = root.querySelector(id) as HTMLElement;
    const pct = Math.max(0, Math.min(100, (value / max) * 100));
    el.style.width = `${pct}%`;
  }

  return {
    root,
    setEquation(eq: string) {
      eqEl.value = eq;
    },
    setPaused(paused: boolean) {
      pauseBtn.textContent = paused ? "Play" : "Pause";
    },
    setAudioEnabled(enabled: boolean) {
      audioBtn.textContent = enabled ? "Stop Audio" : "Enable Audio";
    },
    setRecording(recording: boolean) {
      setRecordingUi(recording);
    },
    setOverlayVisible(visible: boolean) {
      overlayBtn.textContent = visible ? "Overlay: On" : "Overlay: Off";
    },
    setSimSource(id: string) {
      simEl.value = id;
    },
    setStats(s) {
      (root.querySelector("#st-step") as HTMLElement).textContent = String(s.step);
      (root.querySelector("#st-fps") as HTMLElement).textContent =
        s.fps.toFixed(1);
      (root.querySelector("#st-energy") as HTMLElement).textContent =
        s.energy.toFixed(3);
      (root.querySelector("#st-audio") as HTMLElement).textContent = s.audio;

      const f = s.field;
      if (!f) {
        (root.querySelector("#st-regions") as HTMLElement).textContent = "—";
        (root.querySelector("#st-calm") as HTMLElement).textContent = "—";
        (root.querySelector("#st-static") as HTMLElement).textContent = "—";
        (root.querySelector("#st-chaos") as HTMLElement).textContent = "—";
        (root.querySelector("#st-osc") as HTMLElement).textContent = "—";
        (root.querySelector("#st-kappa") as HTMLElement).textContent = "—";
        (root.querySelector("#st-chaos-delta") as HTMLElement).textContent = "—";
        (root.querySelector("#st-chaos-t") as HTMLElement).textContent = "—";
        (root.querySelector("#st-calm-delta") as HTMLElement).textContent = "—";
        (root.querySelector("#st-static-delta") as HTMLElement).textContent =
          "—";
        (root.querySelector("#st-budget") as HTMLElement).textContent = "—";
        (root.querySelector("#st-spend") as HTMLElement).textContent = "—";
      } else {
        (root.querySelector("#st-regions") as HTMLElement).textContent = String(
          f.regions,
        );
        (root.querySelector("#st-calm") as HTMLElement).textContent =
          `${(f.calmPct * 100).toFixed(0)}%`;
        (root.querySelector("#st-static") as HTMLElement).textContent =
          typeof f.staticPct === "number"
            ? `${(f.staticPct * 100).toFixed(0)}%`
            : "—";
        (root.querySelector("#st-chaos") as HTMLElement).textContent =
          `${(f.chaosPct * 100).toFixed(0)}%`;
        (root.querySelector("#st-osc") as HTMLElement).textContent =
          typeof f.oscPct === "number"
            ? `${(f.oscPct * 100).toFixed(0)}%`
            : "—";
        (root.querySelector("#st-kappa") as HTMLElement).textContent =
          f.meanKappa.toFixed(3);
        (root.querySelector("#st-chaos-delta") as HTMLElement).textContent =
          typeof f.chaosMeanDelta === "number"
            ? f.chaosMeanDelta.toFixed(3)
            : "—";
        (root.querySelector("#st-chaos-t") as HTMLElement).textContent =
          typeof f.chaosT === "number" ? f.chaosT.toFixed(2) : "—";
        (root.querySelector("#st-calm-delta") as HTMLElement).textContent =
          typeof f.calmMeanDelta === "number"
            ? f.calmMeanDelta.toFixed(3)
            : "—";
        (root.querySelector("#st-static-delta") as HTMLElement).textContent =
          typeof f.staticMeanDelta === "number"
            ? f.staticMeanDelta.toFixed(3)
            : "—";
        (root.querySelector("#st-budget") as HTMLElement).textContent =
          `${f.predictedActive}/${f.budget}`;
        const fmt = (a: number, s: number) =>
          `${Math.round(a)}/${Math.round(s)}`;
        (root.querySelector("#st-spend") as HTMLElement).textContent =
          `c ${fmt(f.calmGrains, f.shareCalm ?? 0)} · s ${fmt(f.textureGrains ?? 0, f.shareTexture ?? 0)} · x ${fmt(f.chaosGrains, f.shareChaos ?? 0)} · o ${fmt(f.oscGrains ?? 0, f.shareOsc ?? 0)}`;
      }

      const m = s.meter;
      if (!m) {
        (root.querySelector("#st-rms") as HTMLElement).textContent = "—";
        (root.querySelector("#st-peak") as HTMLElement).textContent = "—";
        (root.querySelector("#st-gain") as HTMLElement).textContent = "—";
        (root.querySelector("#st-voices") as HTMLElement).textContent = "—";
        (root.querySelector("#st-sounding") as HTMLElement).textContent = "—";
        (root.querySelector("#st-trigs") as HTMLElement).textContent = "—";
        setBar("#bar-rms", 0, 1);
        setBar("#bar-peak", 0, 1);
        setBar("#bar-gain", 0, 1);
        return;
      }

      (root.querySelector("#st-rms") as HTMLElement).textContent =
        m.rms.toFixed(3);
      (root.querySelector("#st-peak") as HTMLElement).textContent =
        m.peak.toFixed(3);
      (root.querySelector("#st-gain") as HTMLElement).textContent =
        m.masterGain.toFixed(2);
      (root.querySelector("#st-voices") as HTMLElement).textContent = String(
        m.activeVoices,
      );
      (root.querySelector("#st-sounding") as HTMLElement).textContent = String(
        m.sounding,
      );
      (root.querySelector("#st-trigs") as HTMLElement).textContent =
        m.triggersPerSec.toFixed(0);

      setBar("#bar-rms", m.rms, 0.5);
      setBar("#bar-peak", m.peak, 1);
      setBar("#bar-gain", m.masterGain, s.gainBarMax ?? 1);
    },
  };
}
