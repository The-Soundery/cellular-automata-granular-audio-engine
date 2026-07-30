import { TYPE_U_SEED } from "../ca/typeU.ts";

export interface ControlsHandlers {
  onApplyEquation: (eq: string) => void;
  onReset: () => void;
  onTogglePause: () => boolean;
  onPrevVariation: () => string;
  onNextVariation: () => string;
  onRandomVariation: () => string;
  onLoadAudio: (file: File) => Promise<void>;
  /** Toggle audio engine on/off. Returns whether audio is now enabled. */
  onToggleAudio: () => Promise<boolean>;
  /** Toggle listen overlay. Returns whether overlay is now visible. */
  onToggleOverlay: () => boolean;
}

export interface AudioMeterStats {
  rms: number;
  peak: number;
  masterGain: number;
  activeVoices: number | string;
  sounding: number | string;
  triggersPerSec: number;
  deferredPerSec: number;
  meanR: number;
  meanG: number;
  meanLen: number;
}

export interface ControlsApi {
  setEquation: (eq: string) => void;
  setPaused: (paused: boolean) => void;
  setAudioEnabled: (enabled: boolean) => void;
  setOverlayVisible: (visible: boolean) => void;
  setStats: (s: {
    step: number;
    fps: number;
    energy: number;
    audio: string;
    meter: AudioMeterStats | null;
    /** Display scale for the Gain bar (defaults to 2.5). */
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
      <button type="button" id="overlay-toggle">Hide Overlay</button>
    </div>
    <dl class="stats">
      <div><dt>Step</dt><dd id="st-step">0</dd></div>
      <div><dt>FPS</dt><dd id="st-fps">0</dd></div>
      <div><dt>Energy</dt><dd id="st-energy">0</dd></div>
      <div><dt>Audio</dt><dd id="st-audio">idle</dd></div>
    </dl>
    <div class="meter-block">
      <div class="meter-title">Listening</div>
      <div class="meter-bars">
        <div class="meter-row"><span>RMS</span><div class="bar"><i id="bar-rms"></i></div><em id="st-rms">—</em></div>
        <div class="meter-row"><span>Peak</span><div class="bar"><i id="bar-peak"></i></div><em id="st-peak">—</em></div>
        <div class="meter-row"><span>Gain</span><div class="bar"><i id="bar-gain"></i></div><em id="st-gain">—</em></div>
      </div>
      <dl class="stats stats-audio">
        <div><dt>Voices</dt><dd id="st-voices">—</dd></div>
        <div><dt>Sounding</dt><dd id="st-sounding">—</dd></div>
        <div><dt>Trig/s</dt><dd id="st-trigs">—</dd></div>
        <div><dt>Defer/s</dt><dd id="st-defer">—</dd></div>
        <div><dt>Mean R</dt><dd id="st-mean-r">—</dd></div>
        <div><dt>Mean G</dt><dd id="st-mean-g">—</dd></div>
        <div><dt>Mean len</dt><dd id="st-mean-len">—</dd></div>
      </dl>
      <p class="meter-hint">Overlay: live structure probes · X/Y = sample/spectrum · colour = grain envelope</p>
    </div>
  `;
  parent.appendChild(root);

  const eqEl = root.querySelector("#eq") as HTMLTextAreaElement;
  const pauseBtn = root.querySelector("#pause") as HTMLButtonElement;
  const audioBtn = root.querySelector("#audio-toggle") as HTMLButtonElement;
  const overlayBtn = root.querySelector("#overlay-toggle") as HTMLButtonElement;
  eqEl.value = TYPE_U_SEED;

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
  overlayBtn.addEventListener("click", () => {
    const visible = handlers.onToggleOverlay();
    overlayBtn.textContent = visible ? "Hide Overlay" : "Show Overlay";
  });
  root.querySelector("#file")!.addEventListener("change", (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void handlers.onLoadAudio(file);
  });

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
    setOverlayVisible(visible: boolean) {
      overlayBtn.textContent = visible ? "Hide Overlay" : "Show Overlay";
    },
    setStats(s) {
      (root.querySelector("#st-step") as HTMLElement).textContent = String(s.step);
      (root.querySelector("#st-fps") as HTMLElement).textContent =
        s.fps.toFixed(1);
      (root.querySelector("#st-energy") as HTMLElement).textContent =
        s.energy.toFixed(3);
      (root.querySelector("#st-audio") as HTMLElement).textContent = s.audio;

      const m = s.meter;
      if (!m) {
        (root.querySelector("#st-rms") as HTMLElement).textContent = "—";
        (root.querySelector("#st-peak") as HTMLElement).textContent = "—";
        (root.querySelector("#st-gain") as HTMLElement).textContent = "—";
        (root.querySelector("#st-voices") as HTMLElement).textContent = "—";
        (root.querySelector("#st-sounding") as HTMLElement).textContent = "—";
        (root.querySelector("#st-trigs") as HTMLElement).textContent = "—";
        (root.querySelector("#st-defer") as HTMLElement).textContent = "—";
        (root.querySelector("#st-mean-r") as HTMLElement).textContent = "—";
        (root.querySelector("#st-mean-g") as HTMLElement).textContent = "—";
        (root.querySelector("#st-mean-len") as HTMLElement).textContent = "—";
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
      (root.querySelector("#st-defer") as HTMLElement).textContent =
        m.deferredPerSec.toFixed(0);
      (root.querySelector("#st-mean-r") as HTMLElement).textContent =
        m.meanR.toFixed(2);
      (root.querySelector("#st-mean-g") as HTMLElement).textContent =
        m.meanG.toFixed(2);
      (root.querySelector("#st-mean-len") as HTMLElement).textContent =
        `${(m.meanLen * 1000).toFixed(0)}ms`;

      setBar("#bar-rms", m.rms, 0.5);
      setBar("#bar-peak", m.peak, 1);
      setBar("#bar-gain", m.masterGain, s.gainBarMax ?? 2.5);
    },
  };
}
