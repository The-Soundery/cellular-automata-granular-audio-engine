import {
  TYPE_U_DEPTHS,
  TYPE_U_SEED,
  depthLabel,
  formatCoord,
  type TypeUDepth,
  type TypeUProgram,
} from "../ca/typeU.ts";
import { TEST_PATTERNS } from "../field/TestPatterns.ts";

export interface ControlsHandlers {
  onApplyEquation: (eq: string) => void;
  onResetColours: () => void;
  onTogglePause: () => boolean;
  onUndo: () => void;
  onRedo: () => void;
  onRandomEquation: () => void;
  onCycleSlot: (slotIndex: number, dir: number) => void;
  onSetDepth: (depth: TypeUDepth) => void;
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
  /** Confirmed travelling-colour fraction (flow grain pool spends this share). */
  flowPct?: number;
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
  flowGrains?: number;
  shareCalm?: number;
  shareTexture?: number;
  shareChaos?: number;
  shareOsc?: number;
  shareFlow?: number;
  /** Mean HSV saturation of the current field (diagnostic). */
  meanSat?: number;
  /** Circular hue concentration reverse: 0 = one hue, 1 = hues all around. */
  hueSpread?: number;
  budget: number;
  predictedActive: number;
}

export interface ControlsApi {
  setEquation: (eq: string) => void;
  setProgram: (program: TypeUProgram | null, eq: string) => void;
  setTypeUEnabled: (enabled: boolean) => void;
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

function formatPct(frac: number): string {
  const pct = frac * 100;
  if (pct > 0 && pct < 0.05) return "<0.1%";
  return `${pct < 10 ? pct.toFixed(1) : pct.toFixed(0)}%`;
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
      <span>Type-U depth</span>
      <div class="depth-switch" id="depth-switch" role="group" aria-label="Type-U depth">
        ${TYPE_U_DEPTHS.map(
          (d) =>
            `<button type="button" class="depth-btn" data-depth="${d}">${depthLabel(d)}</button>`,
        ).join("")}
      </div>
    </label>
    <div class="field" id="eq-field">
      <span>Equation</span>
      <div class="eq-tokens" id="eq-tokens" aria-label="Type-U equation tokens"></div>
      <textarea id="eq" rows="3" spellcheck="false" aria-label="Paste or edit equation"></textarea>
      <div class="eq-meta" id="eq-meta"></div>
    </div>
    <div class="row">
      <button type="button" id="apply">Apply</button>
      <button type="button" id="pause">Pause</button>
    </div>
    <div class="row">
      <button type="button" id="prev">← Undo</button>
      <button type="button" id="rand">Random equation</button>
      <button type="button" id="next">Redo →</button>
    </div>
    <div class="field">
      <button type="button" id="reset">Reset colours</button>
      <p class="eq-hint">Same equation, new random field</p>
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
      <span class="leg-swatch leg-flow"></span><span>Flow</span>
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
        <div><dt>Flow %</dt><dd id="st-flow">—</dd></div>
        <div><dt>Mean κ</dt><dd id="st-kappa">—</dd></div>
        <div><dt>Chaos δ̄</dt><dd id="st-chaos-delta">—</dd></div>
        <div><dt>Chaos t</dt><dd id="st-chaos-t">—</dd></div>
        <div><dt>Calm δ̄</dt><dd id="st-calm-delta">—</dd></div>
        <div><dt>Static δ̄</dt><dd id="st-static-delta">—</dd></div>
        <div><dt>Mean sat</dt><dd id="st-mean-sat">—</dd></div>
        <div><dt>Hue spread</dt><dd id="st-hue-spread">—</dd></div>
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
      <p class="meter-hint">Sonic Laws V5 — HSV polar material (frozen window) · pan/Y/L-R follow · neutral loudness</p>
    </div>
  `;
  parent.appendChild(root);

  const eqEl = root.querySelector("#eq") as HTMLTextAreaElement;
  const tokensEl = root.querySelector("#eq-tokens") as HTMLElement;
  const metaEl = root.querySelector("#eq-meta") as HTMLElement;
  const eqField = root.querySelector("#eq-field") as HTMLElement;
  const simEl = root.querySelector("#sim-source") as HTMLSelectElement;
  const pauseBtn = root.querySelector("#pause") as HTMLButtonElement;
  const audioBtn = root.querySelector("#audio-toggle") as HTMLButtonElement;
  const recordBtn = root.querySelector("#record-toggle") as HTMLButtonElement;
  const overlayBtn = root.querySelector("#overlay-toggle") as HTMLButtonElement;
  const depthBtns = [
    ...root.querySelectorAll<HTMLButtonElement>(".depth-btn"),
  ];
  eqEl.value = TYPE_U_SEED;

  function renderTokens(program: TypeUProgram | null, eq: string) {
    tokensEl.replaceChildren();
    if (!program) {
      const span = document.createElement("span");
      span.className = "eq-token";
      span.textContent = eq.trim() || "—";
      tokensEl.append(span);
      metaEl.textContent = "Pasted equation — not on a Type-U map";
      for (const btn of depthBtns) btn.classList.remove("is-active");
      return;
    }
    for (const tok of program.tokens) {
      const span = document.createElement("span");
      span.className = "eq-token";
      span.textContent = tok.text;
      if (tok.slot !== undefined) {
        span.classList.add("is-slot");
        if (tok.kind) span.classList.add(`kind-${tok.kind}`);
        span.dataset.slot = String(tok.slot);
        span.title = "Scroll or click to cycle";
      } else {
        span.classList.add("is-punct");
      }
      tokensEl.append(span);
    }
    metaEl.textContent = formatCoord(program);
    for (const btn of depthBtns) {
      btn.classList.toggle("is-active", Number(btn.dataset.depth) === program.depth);
    }
  }

  simEl.addEventListener("change", () => {
    handlers.onSelectSimSource(simEl.value);
  });

  root.querySelector("#apply")!.addEventListener("click", () => {
    handlers.onApplyEquation(eqEl.value);
  });
  root.querySelector("#reset")!.addEventListener("click", () => {
    handlers.onResetColours();
  });
  pauseBtn.addEventListener("click", () => {
    const paused = handlers.onTogglePause();
    pauseBtn.textContent = paused ? "Play" : "Pause";
  });
  root.querySelector("#prev")!.addEventListener("click", () => {
    handlers.onUndo();
  });
  root.querySelector("#next")!.addEventListener("click", () => {
    handlers.onRedo();
  });
  root.querySelector("#rand")!.addEventListener("click", () => {
    handlers.onRandomEquation();
  });
  for (const btn of depthBtns) {
    btn.addEventListener("click", () => {
      const depth = Number(btn.dataset.depth) as TypeUDepth;
      handlers.onSetDepth(depth);
    });
  }
  tokensEl.addEventListener("click", (e) => {
    const slot = slotFromEvent(e);
    if (slot === null) return;
    handlers.onCycleSlot(slot, 1);
  });
  tokensEl.addEventListener(
    "wheel",
    (e) => {
      const slot = slotFromEvent(e);
      if (slot === null) return;
      e.preventDefault();
      handlers.onCycleSlot(slot, e.deltaY > 0 ? 1 : -1);
    },
    { passive: false },
  );

  function slotFromEvent(e: Event): number | null {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return null;
    const el = t.closest<HTMLElement>("[data-slot]");
    if (!el || !tokensEl.contains(el)) return null;
    const n = Number(el.dataset.slot);
    return Number.isInteger(n) ? n : null;
  }
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
    setProgram(program: TypeUProgram | null, eq: string) {
      eqEl.value = eq;
      renderTokens(program, eq);
    },
    setTypeUEnabled(enabled: boolean) {
      eqField.classList.toggle("is-disabled", !enabled);
      for (const btn of depthBtns) btn.disabled = !enabled;
      (root.querySelector("#prev") as HTMLButtonElement).disabled = !enabled;
      (root.querySelector("#next") as HTMLButtonElement).disabled = !enabled;
      (root.querySelector("#rand") as HTMLButtonElement).disabled = !enabled;
      (root.querySelector("#apply") as HTMLButtonElement).disabled = !enabled;
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
        (root.querySelector("#st-flow") as HTMLElement).textContent = "—";
        (root.querySelector("#st-kappa") as HTMLElement).textContent = "—";
        (root.querySelector("#st-chaos-delta") as HTMLElement).textContent = "—";
        (root.querySelector("#st-chaos-t") as HTMLElement).textContent = "—";
        (root.querySelector("#st-calm-delta") as HTMLElement).textContent = "—";
        (root.querySelector("#st-static-delta") as HTMLElement).textContent =
          "—";
        (root.querySelector("#st-mean-sat") as HTMLElement).textContent = "—";
        (root.querySelector("#st-hue-spread") as HTMLElement).textContent = "—";
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
        (root.querySelector("#st-flow") as HTMLElement).textContent =
          typeof f.flowPct === "number" ? formatPct(f.flowPct) : "—";
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
        (root.querySelector("#st-mean-sat") as HTMLElement).textContent =
          typeof f.meanSat === "number" ? f.meanSat.toFixed(2) : "—";
        (root.querySelector("#st-hue-spread") as HTMLElement).textContent =
          typeof f.hueSpread === "number" ? f.hueSpread.toFixed(2) : "—";
        (root.querySelector("#st-budget") as HTMLElement).textContent =
          `${f.predictedActive}/${f.budget}`;
        const fmt = (a: number, s: number) =>
          `${Math.round(a)}/${Math.round(s)}`;
        (root.querySelector("#st-spend") as HTMLElement).textContent =
          `c ${fmt(f.calmGrains, f.shareCalm ?? 0)} · s ${fmt(f.textureGrains ?? 0, f.shareTexture ?? 0)} · x ${fmt(f.chaosGrains, f.shareChaos ?? 0)} · o ${fmt(f.oscGrains ?? 0, f.shareOsc ?? 0)} · f ${fmt(f.flowGrains ?? 0, f.shareFlow ?? 0)}`;
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
