import {
  TYPE_U_DEPTHS,
  formatHud,
  type TypeUDepth,
  type TypeUProgram,
} from "../ca/typeU.ts";
import { TEST_PATTERNS } from "../field/TestPatterns.ts";

export interface ControlsHandlers {
  onTogglePause: () => boolean;
  onResetColours: () => void;
  onRandomEquation: () => void;
  onCycleSlot: (slotIndex: number, dir: number) => void;
  onSetDepth: (depth: TypeUDepth) => void;
  onLoadAudio: (file: File) => Promise<void>;
  onToggleAudio: () => Promise<boolean>;
  onToggleRecord: () => Promise<boolean>;
  onToggleOverlay: () => boolean;
  onToggleData: () => boolean;
  onToggleExplore: () => boolean;
  onSelectSimSource: (id: string) => void;
  onArmAudio: () => Promise<void>;
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
  staticPct?: number;
  oscPct?: number;
  flowPct?: number;
  meanKappa: number;
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
  meanSat?: number;
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
  setExplore: (open: boolean) => void;
  setDataOpen: (open: boolean) => void;
  setSimSource: (id: string) => void;
  setHasSource: (has: boolean) => void;
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

function icon(svg: string): string {
  return `<svg width="24" height="24" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1">${svg}</svg>`;
}

const ICO = {
  pause: `<svg width="24" height="24" viewBox="0 0 12 12"><rect x="2.5" y="2" width="2.5" height="8" fill="currentColor"/><rect x="7" y="2" width="2.5" height="8" fill="currentColor"/></svg>`,
  play: `<svg width="24" height="24" viewBox="0 0 12 12"><path fill="currentColor" d="M3 2v8l8-4z"/></svg>`,
  rec: `<svg width="24" height="24" viewBox="0 0 12 12"><rect x="3" y="3" width="6" height="6" fill="none" stroke="currentColor" stroke-width="1"/></svg>`,
  recOn: `<svg width="24" height="24" viewBox="0 0 12 12"><rect x="3" y="3" width="6" height="6" fill="currentColor"/></svg>`,
  overlay: icon(
    `<path d="M2 4V2h2"/><path d="M8 2h2v2"/><path d="M10 8v2H8"/><path d="M4 10H2V8"/>`,
  ),
  wave: icon(
    `<path d="M1 6h1l1-3 1 6 1-4 1 2H11"/>`,
  ),
  audio: icon(
    `<path d="M2 4.5h2.5L7 2v8L4.5 7.5H2z" fill="currentColor" stroke="none"/><path d="M8.5 5c.7.4.7 1.6 0 2"/><path d="M10 4.2c1.2.7 1.2 2.9 0 3.6"/>`,
  ),
  reset: icon(
    `<path d="M8.5 3.3A3.6 3.6 0 1 1 6 2.4"/><path d="M8.5 1.5v2.2H6.4"/>`,
  ),
  dice: `<svg width="24" height="24" viewBox="0 0 12 12" fill="currentColor"><rect x="1.5" y="1.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1"/><circle cx="4" cy="4" r="0.8"/><circle cx="8" cy="4" r="0.8"/><circle cx="6" cy="6" r="0.8"/><circle cx="4" cy="8" r="0.8"/><circle cx="8" cy="8" r="0.8"/></svg>`,
  explore: `<svg width="24" height="24" viewBox="0 0 12 12" fill="currentColor"><rect x="5" y="5" width="2" height="2"/><rect x="5" y="1" width="2" height="2"/><rect x="9" y="5" width="2" height="2"/><rect x="5" y="9" width="2" height="2"/><rect x="1" y="5" width="2" height="2"/></svg>`,
};

function ticks(frac: number): string {
  const n = Math.max(0, Math.min(20, Math.round(frac * 20)));
  return Array.from({ length: 20 }, (_, i) => (i < n ? "<b></b>" : "<i></i>")).join(
    "",
  );
}

function formatPct(frac: number): string {
  const pct = frac * 100;
  if (pct > 0 && pct < 0.05) return "<0.1";
  return `${pct < 10 ? pct.toFixed(1) : pct.toFixed(0)}`;
}

export function mountControls(
  parent: HTMLElement,
  handlers: ControlsHandlers,
): ControlsApi {
  const root = document.createElement("div");
  root.className = "hud";
  root.innerHTML = `
    <nav class="hud-corner hud-tl">
      <button type="button" class="hud-cell is-on" id="pause" title="Pause">${ICO.pause}</button>
      <button type="button" class="hud-cell" id="record-toggle" title="Record">${ICO.rec}</button>
    </nav>
    <nav class="hud-corner hud-tr">
      <button type="button" class="hud-cell" id="overlay-toggle" title="Overlay">${ICO.overlay}</button>
      <button type="button" class="hud-cell data-lbl" id="data-toggle" title="DATA">DATA</button>
      <aside class="data-fold" id="data-fold" hidden>
        <div class="head" id="data-close">DATA</div>
        <div class="body">
          <div class="data-row"><span class="k">CALM</span><span class="data-ticks" id="tk-calm"></span><span class="n" id="st-calm">—</span></div>
          <div class="data-row"><span class="k">STAT</span><span class="data-ticks" id="tk-static"></span><span class="n" id="st-static">—</span></div>
          <div class="data-row"><span class="k">CHAOS</span><span class="data-ticks" id="tk-chaos"></span><span class="n" id="st-chaos">—</span></div>
          <div class="data-row"><span class="k">OSC</span><span class="data-ticks" id="tk-osc"></span><span class="n" id="st-osc">—</span></div>
          <div class="data-row"><span class="k">FLOW</span><span class="data-ticks" id="tk-flow"></span><span class="n" id="st-flow">—</span></div>
          <div class="data-meta">
            <span>SPEND</span><b id="st-spend">—</b>
            <span>BUDGET</span><b id="st-budget">—</b>
            <span>CLIP</span><b id="st-peak">—</b>
            <span>STEP</span><b id="st-step">0</b>
          </div>
          <p class="data-hint">Sonic Laws V5 — HSV polar material (frozen window) · pan/Y/L-R follow · neutral loudness</p>
          <label class="data-row" style="margin-top:6px">
            <span class="k">SIM</span>
            <select id="sim-source">
              <option value="utomata">Utomata</option>
              ${TEST_PATTERNS.map((p) => `<option value="${p.id}">${p.label}</option>`).join("")}
            </select>
          </label>
        </div>
      </aside>
    </nav>
    <nav class="hud-corner hud-bl">
      <button type="button" class="hud-cell" id="audio-toggle" title="Audio">${ICO.audio}</button>
      <label class="hud-cell" id="load-btn" title="Load audio">${ICO.wave}
        <input id="file" type="file" accept="audio/*,.wav,.mp3,.aiff,.aif,.ogg" hidden />
      </label>
      <button type="button" class="hud-cell" id="reset" title="Reset colours">${ICO.reset}</button>
      <button type="button" class="hud-cell" id="rand" title="Random equation">${ICO.dice}</button>
    </nav>
    <nav class="hud-corner hud-br">
      <button type="button" class="hud-cell" id="explore-toggle" title="Explore">${ICO.explore}</button>
      ${TYPE_U_DEPTHS.map(
        (d) =>
          `<button type="button" class="hud-cell d depth-btn" data-depth="${d}" title="${d}">${d}</button>`,
      ).join("")}
    </nav>
  `;
  parent.appendChild(root);

  const readout = document.createElement("div");
  readout.className = "readout";
  readout.innerHTML = `<span class="eq-tokens" id="eq-tokens"></span><span class="eq-meta" id="eq-meta"></span>`;
  const scope = document.getElementById("scope");
  (scope ?? parent).appendChild(readout);

  const tokensEl = readout.querySelector("#eq-tokens") as HTMLElement;
  const metaEl = readout.querySelector("#eq-meta") as HTMLElement;
  const pauseBtn = root.querySelector("#pause") as HTMLButtonElement;
  const audioBtn = root.querySelector("#audio-toggle") as HTMLButtonElement;
  const recordBtn = root.querySelector("#record-toggle") as HTMLButtonElement;
  const overlayBtn = root.querySelector("#overlay-toggle") as HTMLButtonElement;
  const dataBtn = root.querySelector("#data-toggle") as HTMLButtonElement;
  const dataFold = root.querySelector("#data-fold") as HTMLElement;
  const exploreBtn = root.querySelector("#explore-toggle") as HTMLButtonElement;
  const loadBtn = root.querySelector("#load-btn") as HTMLElement;
  const simEl = root.querySelector("#sim-source") as HTMLSelectElement;
  const depthBtns = [...root.querySelectorAll<HTMLButtonElement>(".depth-btn")];
  const typeUBtns = [
    root.querySelector("#rand") as HTMLButtonElement,
    exploreBtn,
    ...depthBtns,
  ];

  function renderTokens(program: TypeUProgram | null, eq: string) {
    tokensEl.replaceChildren();
    if (!program) {
      const span = document.createElement("span");
      span.className = "eq-token";
      span.textContent = eq.trim() || "—";
      tokensEl.append(span);
      metaEl.textContent = "";
      for (const btn of depthBtns) btn.classList.remove("is-hot");
      return;
    }
    for (const tok of program.tokens) {
      const span = document.createElement("span");
      span.className = "eq-token";
      span.textContent = tok.text;
      if (tok.slot !== undefined) {
        span.classList.add("is-slot");
        span.dataset.slot = String(tok.slot);
        span.title = "Drag vertically to cycle";
      } else {
        span.classList.add("is-punct");
      }
      tokensEl.append(span);
    }
    metaEl.textContent = formatHud(program);
    for (const btn of depthBtns) {
      btn.classList.toggle("is-hot", Number(btn.dataset.depth) === program.depth);
    }
  }

  pauseBtn.addEventListener("click", () => {
    const paused = handlers.onTogglePause();
    pauseBtn.innerHTML = paused ? ICO.play : ICO.pause;
    pauseBtn.title = paused ? "Play" : "Pause";
    pauseBtn.classList.toggle("is-on", !paused);
  });
  recordBtn.addEventListener("click", () => {
    void handlers.onToggleRecord().then((recording) => {
      setRecordingUi(recording);
    });
  });
  overlayBtn.addEventListener("click", () => {
    const visible = handlers.onToggleOverlay();
    overlayBtn.classList.toggle("is-hot", visible);
  });
  dataBtn.addEventListener("click", () => {
    const open = handlers.onToggleData();
    setDataUi(open);
  });
  root.querySelector("#data-close")!.addEventListener("click", () => {
    const open = handlers.onToggleData();
    setDataUi(open);
  });
  exploreBtn.addEventListener("click", () => {
    const open = handlers.onToggleExplore();
    exploreBtn.classList.toggle("is-hot", open);
  });
  root.querySelector("#reset")!.addEventListener("click", () => {
    handlers.onResetColours();
  });
  root.querySelector("#rand")!.addEventListener("click", () => {
    handlers.onRandomEquation();
  });
  audioBtn.addEventListener("click", () => {
    void handlers.onToggleAudio().then((enabled) => {
      audioBtn.classList.toggle("is-on", enabled);
    });
  });
  for (const btn of depthBtns) {
    btn.addEventListener("click", () => {
      handlers.onSetDepth(Number(btn.dataset.depth) as TypeUDepth);
    });
  }
  simEl.addEventListener("change", () => {
    handlers.onSelectSimSource(simEl.value);
  });
  loadBtn.addEventListener("pointerdown", () => {
    void handlers.onArmAudio();
  });
  root.querySelector("#file")!.addEventListener("change", (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      void handlers.onLoadAudio(file);
      input.value = "";
    }
  });
  const DRAG_PX = 10;
  let drag: { slot: number; lastY: number } | null = null;
  tokensEl.addEventListener("pointerdown", (e) => {
    const slot = slotFromEvent(e);
    if (slot === null) return;
    e.preventDefault();
    const el = e.target instanceof HTMLElement ? e.target : tokensEl;
    el.setPointerCapture?.(e.pointerId);
    drag = { slot, lastY: e.clientY };
  });
  tokensEl.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dy = e.clientY - drag.lastY;
    if (Math.abs(dy) < DRAG_PX) return;
    handlers.onCycleSlot(drag.slot, dy > 0 ? 1 : -1);
    drag.lastY = e.clientY;
  });
  tokensEl.addEventListener("pointerup", () => {
    drag = null;
  });
  tokensEl.addEventListener("pointercancel", () => {
    drag = null;
  });

  function slotFromEvent(e: Event): number | null {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return null;
    const el = t.closest<HTMLElement>("[data-slot]");
    if (!el || !tokensEl.contains(el)) return null;
    const n = Number(el.dataset.slot);
    return Number.isInteger(n) ? n : null;
  }

  function setRecordingUi(recording: boolean) {
    recordBtn.innerHTML = recording ? ICO.recOn : ICO.rec;
    recordBtn.classList.toggle("is-rec", recording);
    recordBtn.title = recording ? "Stop recording" : "Record";
  }

  function setDataUi(open: boolean) {
    dataFold.hidden = !open;
    dataBtn.hidden = open;
    dataBtn.classList.toggle("is-hot", open);
  }

  function setBar(id: string, frac: number) {
    const el = root.querySelector(id);
    if (el) el.innerHTML = ticks(frac);
  }

  return {
    root,
    setEquation(_eq: string) {},
    setProgram(program, eq) {
      renderTokens(program, eq);
    },
    setTypeUEnabled(enabled) {
      for (const btn of typeUBtns) btn.disabled = !enabled;
      tokensEl.style.pointerEvents = enabled ? "auto" : "none";
      tokensEl.style.opacity = enabled ? "1" : "0.45";
    },
    setPaused(paused) {
      pauseBtn.innerHTML = paused ? ICO.play : ICO.pause;
      pauseBtn.title = paused ? "Play" : "Pause";
      pauseBtn.classList.toggle("is-on", !paused);
    },
    setAudioEnabled(enabled) {
      audioBtn.classList.toggle("is-on", enabled);
    },
    setRecording(recording) {
      setRecordingUi(recording);
    },
    setOverlayVisible(visible) {
      overlayBtn.classList.toggle("is-hot", visible);
    },
    setExplore(open) {
      exploreBtn.classList.toggle("is-hot", open);
    },
    setDataOpen(open) {
      setDataUi(open);
    },
    setSimSource(id) {
      simEl.value = id;
    },
    setHasSource(has) {
      loadBtn.classList.toggle("is-on", has);
    },
    setStats(s) {
      (root.querySelector("#st-step") as HTMLElement).textContent = String(s.step);
      const f = s.field;
      if (!f) {
        for (const id of ["#st-calm", "#st-static", "#st-chaos", "#st-osc", "#st-flow", "#st-budget", "#st-spend"]) {
          const el = root.querySelector(id);
          if (el) el.textContent = "—";
        }
      } else {
        (root.querySelector("#st-calm") as HTMLElement).textContent = formatPct(f.calmPct);
        (root.querySelector("#st-static") as HTMLElement).textContent =
          typeof f.staticPct === "number" ? formatPct(f.staticPct) : "—";
        (root.querySelector("#st-chaos") as HTMLElement).textContent = formatPct(f.chaosPct);
        (root.querySelector("#st-osc") as HTMLElement).textContent =
          typeof f.oscPct === "number" ? formatPct(f.oscPct) : "—";
        (root.querySelector("#st-flow") as HTMLElement).textContent =
          typeof f.flowPct === "number" ? formatPct(f.flowPct) : "—";
        setBar("#tk-calm", f.calmPct);
        setBar("#tk-static", f.staticPct ?? 0);
        setBar("#tk-chaos", f.chaosPct);
        setBar("#tk-osc", f.oscPct ?? 0);
        setBar("#tk-flow", f.flowPct ?? 0);
        (root.querySelector("#st-budget") as HTMLElement).textContent =
          `${f.predictedActive}/${f.budget}`;
        const fmt = (a: number, sh: number) => `${Math.round(a)}/${Math.round(sh)}`;
        (root.querySelector("#st-spend") as HTMLElement).textContent =
          `c ${fmt(f.calmGrains, f.shareCalm ?? 0)} · s ${fmt(f.textureGrains ?? 0, f.shareTexture ?? 0)} · x ${fmt(f.chaosGrains, f.shareChaos ?? 0)} · o ${fmt(f.oscGrains ?? 0, f.shareOsc ?? 0)} · f ${fmt(f.flowGrains ?? 0, f.shareFlow ?? 0)}`;
      }
      const m = s.meter;
      (root.querySelector("#st-peak") as HTMLElement).textContent = m
        ? m.peak.toFixed(2)
        : "—";
    },
  };
}
