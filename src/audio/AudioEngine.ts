import type { VoicePlan } from "../field/FieldMetrics.ts";
import { buildSpectralBank, type SpectralBank } from "./spectral.ts";

export interface ListenVoice {
  structureId: number;
  probeIndex: number;
  /** Display locus (live probe); overlay prefers this over baked. */
  x: number;
  y: number;
  liveX?: number;
  liveY?: number;
  /** Last grain-trigger locus — what the ear last scrubbed. */
  bakedX?: number;
  bakedY?: number;
  r: number;
  g: number;
  b: number;
  amp: number;
  len: number;
  sounding: boolean;
  gain: number;
  extentW?: number;
  extentH?: number;
}

export interface AudioStats {
  rms: number;
  peak: number;
  masterGain: number;
  activeVoices: number;
  sounding: number;
  triggersPerSec: number;
  deferredPerSec: number;
  listen: ListenVoice[];
  updatedAt: number;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private bank: SpectralBank | null = null;
  private started = false;
  private lastPlan: VoicePlan | null = null;
  private stats: AudioStats | null = null;

  get isReady(): boolean {
    return (
      this.started &&
      this.node !== null &&
      this.bank !== null &&
      this.ctx !== null &&
      this.ctx.state === "running"
    );
  }

  get isEnabled(): boolean {
    return (
      this.started &&
      this.node !== null &&
      this.ctx !== null &&
      this.ctx.state === "running"
    );
  }

  get contextState(): string {
    return this.ctx?.state ?? "none";
  }

  get hasSource(): boolean {
    return this.bank !== null;
  }

  getBank(): SpectralBank | null {
    return this.bank;
  }

  getStats(): AudioStats | null {
    return this.stats;
  }

  /** Suspend output without destroying the worklet or loaded source. */
  async stop(): Promise<void> {
    this.started = false;
    if (this.node) {
      // Silence voices but keep the spectral bank resident in the worklet.
      this.node.port.postMessage({
        type: "plan",
        masterGain: 0,
        gridWidth: 128,
        gridHeight: 128,
        voices: [],
      });
    }
    if (this.ctx && this.ctx.state === "running") {
      await this.ctx.suspend().catch(() => undefined);
    }
  }

  /**
   * Hard-reset sounding voices while keeping the loaded spectral bank.
   * Used with CA Reset so identity/coast state cannot bleed into the new run.
   */
  clearVoices(): void {
    this.lastPlan = null;
    this.stats = null;
    if (!this.node) return;
    this.node.port.postMessage({ type: "resetVoices" });
    // Also empty the plan so older worklets without resetVoices still silence.
    this.node.port.postMessage({
      type: "plan",
      masterGain: 0,
      gridWidth: 128,
      gridHeight: 128,
      voices: [],
    });
  }

  async ensureRunning(): Promise<void> {
    try {
      if (!this.ctx || !this.node) {
        if (this.ctx && !this.node) {
          await this.ctx.close().catch(() => undefined);
          this.ctx = null;
        }
        this.ctx = new AudioContext();
        await this.ctx.audioWorklet.addModule(
          `/grain-processor.js?v=${Date.now()}`,
        );
        this.node = new AudioWorkletNode(this.ctx, "grain-processor", {
          numberOfOutputs: 1,
          outputChannelCount: [2],
        });
        this.node.port.onmessage = (ev) => {
          const msg = ev.data;
          if (msg?.type === "stats") {
            this.stats = {
              rms: msg.rms,
              peak: msg.peak,
              masterGain: msg.masterGain,
              activeVoices: msg.activeVoices,
              sounding: msg.sounding,
              triggersPerSec: msg.triggersPerSec,
              deferredPerSec: msg.deferredPerSec,
              listen: msg.listen || [],
              updatedAt: performance.now(),
            };
          }
        };
        this.node.connect(this.ctx.destination);
      }

      if (this.ctx.state === "suspended") {
        await this.ctx.resume();
      }
      if (this.ctx.state === "suspended") {
        await this.ctx.resume();
      }

      this.started = this.ctx.state === "running";

      if (this.bank && this.node) {
        this.sendSource(this.bank);
        if (this.lastPlan) this.sendPlan(this.lastPlan);
      }
    } catch (err) {
      this.started = false;
      this.node = null;
      if (this.ctx) {
        await this.ctx.close().catch(() => undefined);
        this.ctx = null;
      }
      throw err;
    }
  }

  async loadFile(file: File): Promise<SpectralBank> {
    await this.ensureRunning();
    if (!this.ctx) throw new Error("AudioContext unavailable");
    const ctx = this.ctx;
    const arrayBuf = await file.arrayBuffer();
    const audioBuf = await ctx.decodeAudioData(arrayBuf.slice(0));
    this.bank = buildSpectralBank(audioBuf);
    this.sendSource(this.bank);
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    this.started = ctx.state === "running";
    if (this.lastPlan) this.sendPlan(this.lastPlan);
    return this.bank;
  }

  /** Load and decode a URL (e.g. bundled default source). */
  async loadUrl(url: string): Promise<SpectralBank> {
    await this.ensureRunning();
    if (!this.ctx) throw new Error("AudioContext unavailable");
    const ctx = this.ctx;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${url} (${res.status})`);
    const arrayBuf = await res.arrayBuffer();
    const audioBuf = await ctx.decodeAudioData(arrayBuf.slice(0));
    this.bank = buildSpectralBank(audioBuf);
    this.sendSource(this.bank);
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    this.started = ctx.state === "running";
    if (this.lastPlan) this.sendPlan(this.lastPlan);
    return this.bank;
  }

  sendPlan(plan: VoicePlan): void {
    this.lastPlan = plan;
    if (!this.node || !this.bank) return;
    // Structure identity + topology; colour is envelope material only.
    this.node.port.postMessage({
      type: "plan",
      masterGain: plan.masterGain,
      gridWidth: plan.gridWidth,
      gridHeight: plan.gridHeight,
      voices: plan.voices.map((v) => ({
        structureId: v.structureId,
        probeIndex: v.probeIndex,
        r: v.r,
        g: v.g,
        b: v.b,
        colourCoherence: v.colourCoherence,
        x: v.x,
        y: v.y,
        grainLengthSec: v.grainLengthSec,
        overlap: v.overlap,
        persistence: v.persistence,
        amplitudeShare: v.amplitudeShare,
        motion: v.motion,
      })),
    });
  }

  private sendSource(bank: SpectralBank): void {
    if (!this.node) return;
    const transfer: ArrayBuffer[] = [];
    const binBuffers: ArrayBuffer[] = [];
    for (const bin of bank.bins) {
      const copy = bin.slice();
      binBuffers.push(copy.buffer);
      transfer.push(copy.buffer);
    }
    const pcmCopy = bank.pcm.slice();
    transfer.push(pcmCopy.buffer);

    this.node.port.postMessage(
      {
        type: "source",
        sampleRate: bank.sampleRate,
        binCount: bank.binCount,
        length: bank.length,
        bins: binBuffers,
        pcm: pcmCopy.buffer,
      },
      transfer,
    );
  }
}
