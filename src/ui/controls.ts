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
  onSetOutputGain: (gain: number) => void;
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
  /** Measured CA step rate (Hz) from the scheduler's dt EMA. */
  stepHz?: number;
  /** Top regions by area (UI shows at most 6). Omit until wired. */
  regionRows?: {
    id: number;
    area: number;
    kappa: number;
    seats: number;
    active: number;
    /** Steps since birth, if known. */
    age?: number;
  }[];
  /** Preformatted ticker; used only when regionTicker is absent. */
  regionEventsLine?: string;
  /** Birth / merge / death chips; texts joined with ` · `. */
  regionTicker?: { kind: "birth" | "death" | "merge"; text: string }[];
  /**
   * Temporary flow-blink audio-impact diagnostic (gated by overlay).
   * Live membership / trigger counts — not the smoothed FLOW spend bar.
   */
  flowBlink?: {
    n: number;
    gained: number;
    lost: number;
    triggers: number;
    active: number;
    rejects: string;
  };
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
  setOutputGain: (gain: number) => void;
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
  rec: `<svg width="24" height="24" viewBox="0 0 12 12"><circle cx="6" cy="6" r="3.2" fill="none" stroke="currentColor" stroke-width="1"/></svg>`,
  recOn: `<svg width="24" height="24" viewBox="0 0 12 12"><circle cx="6" cy="6" r="3.2" fill="currentColor"/></svg>`,
  overlay: icon(
    `<path d="M2 4V2h2"/><path d="M8 2h2v2"/><path d="M10 8v2H8"/><path d="M4 10H2V8"/>`,
  ),
  load: icon(
    `<path d="M6 9.5V3.5"/><path d="M3.2 5.8 6 3l2.8 2.8"/><path d="M2 10.5h8"/>`,
  ),
  audio: icon(
    `<path d="M2 4.5h2.5L7 2v8L4.5 7.5H2z" fill="currentColor" stroke="none"/>`,
  ),
  audioOn: icon(
    `<path d="M2 4.5h2.5L7 2v8L4.5 7.5H2z" fill="currentColor" stroke="none"/><path d="M8.5 5c.7.4.7 1.6 0 2"/><path d="M10 4.2c1.2.7 1.2 2.9 0 3.6"/>`,
  ),
  reset: icon(
    `<path d="M8.5 3.3A3.6 3.6 0 1 1 6 2.4"/><path d="M8.5 1.5v2.2H6.4"/>`,
  ),
  dice: `<svg width="24" height="24" viewBox="0 0 12 12" fill="currentColor"><rect x="1.5" y="1.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1"/><circle cx="4" cy="4" r="0.8"/><circle cx="8" cy="4" r="0.8"/><circle cx="6" cy="6" r="0.8"/><circle cx="4" cy="8" r="0.8"/><circle cx="8" cy="8" r="0.8"/></svg>`,
  explore: `<svg width="24" height="24" viewBox="0 0 12 12" fill="currentColor"><rect x="4.15" y="4.15" width="3.7" height="3.7"/><rect x="5.25" y="0.35" width="1.5" height="1.5"/><rect x="9.15" y="1.4" width="1.5" height="1.5"/><rect x="10.15" y="5.25" width="1.5" height="1.5"/><rect x="9.15" y="9.1" width="1.5" height="1.5"/><rect x="5.25" y="10.15" width="1.5" height="1.5"/><rect x="1.35" y="9.1" width="1.5" height="1.5"/><rect x="0.35" y="5.25" width="1.5" height="1.5"/><rect x="1.35" y="1.4" width="1.5" height="1.5"/></svg>`,
};

function ticks(frac: number): string {
  const n = Math.max(0, Math.min(20, Math.round(frac * 20)));
  return Array.from({ length: 20 }, (_, i) => (i < n ? "<b></b>" : "<i></i>")).join(
    "",
  );
}

/** Concurrent / allocated seats for a regime pool. */
function formatSpend(active: number, share: number): string {
  return `${Math.round(active)}/${Math.round(share)}`;
}

/** Two-digit kappa, ASCII (`k.82`). VT323 has no reliable κ. */
function formatKappa(kappa: number): string {
  const k = Number.isFinite(kappa) ? Math.max(0, Math.min(1, kappa)) : 0;
  if (k >= 0.995) return "k1.0";
  return `k.${String(Math.round(k * 100)).padStart(2, "0")}`;
}

const REGION_ROW_MAX = 6;
const REGION_TICKER_MAX = 6;

function renderRegionRows(
  host: HTMLElement,
  rows: FieldMeterStats["regionRows"],
) {
  host.replaceChildren();
  if (!rows || rows.length === 0) {
    host.textContent = "—";
    return;
  }
  const n = Math.min(REGION_ROW_MAX, rows.length);
  for (let i = 0; i < n; i++) {
    const r = rows[i]!;
    const line = document.createElement("div");
    line.className = "rr";
    const parts = [
      `#${Math.round(r.id)}`,
      String(Math.round(r.area)),
      formatKappa(r.kappa),
      formatSpend(r.active, r.seats),
    ];
    if (r.age !== undefined && Number.isFinite(r.age)) {
      parts.push(`a${Math.max(0, Math.min(99, Math.round(r.age)))}`);
    }
    for (const p of parts) {
      const span = document.createElement("span");
      span.textContent = p;
      line.append(span);
    }
    host.append(line);
  }
}

function formatRegionTicker(f: FieldMeterStats): string {
  if (f.regionTicker && f.regionTicker.length > 0) {
    const texts = f.regionTicker
      .slice(-REGION_TICKER_MAX)
      .map((e) => e.text)
      .filter((t) => t.length > 0);
    if (texts.length > 0) return texts.join(" · ");
  }
  if (f.regionEventsLine && f.regionEventsLine.length > 0) {
    return f.regionEventsLine;
  }
  return "—";
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
            <span>STEP</span><b id="st-step">0</b>
            <span>RATE</span><b id="st-rate">—</b>
            <span>AUDIO</span><b id="st-audio">—</b>
          </div>
          <div class="data-regions">
            <span class="k">REG</span>
            <div id="st-regions">—</div>
            <div class="data-ticker" id="st-reg-ev">—</div>
          </div>
          <div class="data-row" id="flow-blink-row" hidden title="Live flow membership vs grain triggers (overlay diagnostic)">
            <span class="k">FBLINK</span>
            <span class="n" id="st-flow-blink" style="width:auto;flex:1;text-align:left;font-size:15px">—</span>
          </div>
          <div class="data-out" id="vu" title="Drag to set output">
            <span class="k">OUTPUT</span>
            <div class="vu-track">
              <div class="vu-leds" id="tk-out"></div>
              <div class="vu-cap" id="vu-cap"></div>
            </div>
            <span class="n" id="st-out">—</span>
          </div>
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
      <button type="button" class="hud-cell" id="audio-toggle" title="Unmute">${ICO.audio}</button>
      <label class="hud-cell" id="load-btn" title="Load audio">${ICO.load}
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

  const caption = document.createElement("div");
  caption.className = "caption";
  caption.innerHTML = `<div class="coord" id="eq-meta"></div><div class="readout"><span class="eq-tokens" id="eq-tokens"></span></div>`;
  const scope = document.getElementById("scope");
  (scope ?? parent).appendChild(caption);

  const tokensEl = caption.querySelector("#eq-tokens") as HTMLElement;
  const metaEl = caption.querySelector("#eq-meta") as HTMLElement;
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
  const vuEl = root.querySelector("#vu") as HTMLElement;
  const vuCap = root.querySelector("#vu-cap") as HTMLElement;
  const vuLedsEl = root.querySelector("#tk-out") as HTMLElement;
  const VU_N = 20;
  vuLedsEl.innerHTML = Array.from({ length: VU_N }, (_, i) => {
    const zone = i >= 18 ? "red" : i >= 14 ? "ora" : "grn";
    return `<i class="vu-led ${zone}"></i>`;
  }).join("");
  const vuLeds = [...vuLedsEl.querySelectorAll("i")];

  function setVuLevel(frac: number) {
    const n = Math.max(0, Math.min(VU_N, Math.round(frac * VU_N)));
    for (let i = 0; i < VU_N; i++) vuLeds[i]!.classList.toggle("is-lit", i < n);
  }

  function setVuCap(gain: number) {
    vuCap.style.width = `${Math.max(0, Math.min(1, gain)) * 100}%`;
  }

  function gainFromPointer(e: PointerEvent): number {
    const track = vuEl.querySelector(".vu-track") as HTMLElement;
    const box = track.getBoundingClientRect();
    if (box.width <= 0) return 0;
    return Math.max(0, Math.min(1, (e.clientX - box.left) / box.width));
  }

  let draggingVu = false;
  vuEl.addEventListener("pointerdown", (e) => {
    draggingVu = true;
    vuEl.setPointerCapture(e.pointerId);
    const g = gainFromPointer(e);
    setVuCap(g);
    handlers.onSetOutputGain(g);
  });
  vuEl.addEventListener("pointermove", (e) => {
    if (!draggingVu) return;
    const g = gainFromPointer(e);
    setVuCap(g);
    handlers.onSetOutputGain(g);
  });
  vuEl.addEventListener("pointerup", () => {
    draggingVu = false;
  });
  vuEl.addEventListener("pointercancel", () => {
    draggingVu = false;
  });

  function formatPeakDb(peak: number): string {
    if (peak <= 0.0001) return "−∞ dB";
    return `${(20 * Math.log10(peak)).toFixed(1)} dB`;
  }

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
    void handlers.onToggleAudio().then((audible) => {
      setAudioUi(audible);
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

  function setAudioUi(audible: boolean) {
    audioBtn.innerHTML = audible ? ICO.audioOn : ICO.audio;
    audioBtn.classList.toggle("is-on", audible);
    audioBtn.title = audible ? "Mute" : "Unmute";
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
    setAudioEnabled(audible) {
      setAudioUi(audible);
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
    setOutputGain(gain) {
      setVuCap(gain);
    },
    setStats(s) {
      (root.querySelector("#st-step") as HTMLElement).textContent = String(s.step);
      (root.querySelector("#st-audio") as HTMLElement).textContent =
        s.audio || "—";
      (root.querySelector("#st-rate") as HTMLElement).textContent =
        s.field?.stepHz && s.field.stepHz > 0
          ? `${s.field.stepHz.toFixed(1)}/s`
          : "—";
      const f = s.field;
      const stRegions = root.querySelector("#st-regions") as HTMLElement | null;
      const stRegEv = root.querySelector("#st-reg-ev") as HTMLElement | null;
      const flowBlinkRow = root.querySelector("#flow-blink-row") as HTMLElement | null;
      const stFlowBlink = root.querySelector("#st-flow-blink") as HTMLElement | null;
      if (!f) {
        for (const id of ["#st-calm", "#st-static", "#st-chaos", "#st-osc", "#st-flow", "#st-budget", "#st-spend"]) {
          const el = root.querySelector(id);
          if (el) el.textContent = "—";
        }
        if (stRegions) stRegions.textContent = "—";
        if (stRegEv) stRegEv.textContent = "—";
        if (flowBlinkRow) flowBlinkRow.hidden = true;
      } else {
        const budget = Math.max(1, f.budget);
        const shareCalm = f.shareCalm ?? 0;
        const shareTexture = f.shareTexture ?? 0;
        const shareChaos = f.shareChaos ?? 0;
        const shareOsc = f.shareOsc ?? 0;
        const shareFlow = f.shareFlow ?? 0;
        // Regime meters = grain-budget use (concurrent/share), not field cell %.
        (root.querySelector("#st-calm") as HTMLElement).textContent =
          formatSpend(f.calmGrains, shareCalm);
        (root.querySelector("#st-static") as HTMLElement).textContent =
          formatSpend(f.textureGrains ?? 0, shareTexture);
        (root.querySelector("#st-chaos") as HTMLElement).textContent =
          formatSpend(f.chaosGrains, shareChaos);
        (root.querySelector("#st-osc") as HTMLElement).textContent =
          formatSpend(f.oscGrains ?? 0, shareOsc);
        (root.querySelector("#st-flow") as HTMLElement).textContent =
          formatSpend(f.flowGrains ?? 0, shareFlow);
        setBar("#tk-calm", shareCalm / budget);
        setBar("#tk-static", shareTexture / budget);
        setBar("#tk-chaos", shareChaos / budget);
        setBar("#tk-osc", shareOsc / budget);
        setBar("#tk-flow", shareFlow / budget);
        (root.querySelector("#st-budget") as HTMLElement).textContent =
          `${Math.round(f.predictedActive)}/${f.budget}`;
        (root.querySelector("#st-spend") as HTMLElement).textContent =
          `c ${formatSpend(f.calmGrains, shareCalm)} · s ${formatSpend(f.textureGrains ?? 0, shareTexture)} · x ${formatSpend(f.chaosGrains, shareChaos)} · o ${formatSpend(f.oscGrains ?? 0, shareOsc)} · f ${formatSpend(f.flowGrains ?? 0, shareFlow)}`;
        if (stRegions) renderRegionRows(stRegions, f.regionRows);
        if (stRegEv) stRegEv.textContent = formatRegionTicker(f);
        if (flowBlinkRow && stFlowBlink) {
          const fb = f.flowBlink;
          if (fb) {
            flowBlinkRow.hidden = false;
            stFlowBlink.textContent =
              `n${fb.n} +${fb.gained}/-${fb.lost} trg${fb.triggers} act${fb.active}` +
              (fb.rejects ? ` ${fb.rejects}` : "");
          } else {
            flowBlinkRow.hidden = true;
          }
        }
      }
      const m = s.meter;
      const peak = m ? Math.min(1, m.peak) : 0;
      (root.querySelector("#st-out") as HTMLElement).textContent = m
        ? formatPeakDb(peak)
        : "—";
      setVuLevel(peak);
    },
  };
}
