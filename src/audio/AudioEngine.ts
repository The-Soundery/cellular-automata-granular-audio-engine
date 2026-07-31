import type { GrainPlan } from "../field/FieldReducer.ts";
import { buildSpectralBank, type SpectralBank } from "./spectral.ts";

export interface ListenGrain {
  latticeIndex: number;
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
  amp: number;
  len: number;
  localDelta?: number;
  sounding: boolean;
  gain: number;
}

export interface AudioStats {
  rms: number;
  peak: number;
  masterGain: number;
  activeGrains: number;
  /** Alias for meters that still say "voices". */
  activeVoices: number;
  sounding: number;
  triggersPerSec: number;
  deferredPerSec: number;
  listen: ListenGrain[];
  updatedAt: number;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private bank: SpectralBank | null = null;
  private started = false;
  private lastPlan: GrainPlan | null = null;
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

  async stop(): Promise<void> {
    this.started = false;
    if (this.node) {
      this.node.port.postMessage({
        type: "plan",
        masterGain: 0,
        gridWidth: 128,
        gridHeight: 128,
        grains: [],
      });
    }
    if (this.ctx && this.ctx.state === "running") {
      await this.ctx.suspend().catch(() => undefined);
    }
  }

  /** Hard-reset grain slots while keeping the spectral bank. */
  clearGrains(): void {
    this.lastPlan = null;
    this.stats = null;
    if (!this.node) return;
    this.node.port.postMessage({ type: "resetGrains" });
    this.node.port.postMessage({
      type: "plan",
      masterGain: 0,
      gridWidth: 128,
      gridHeight: 128,
      grains: [],
    });
  }

  /** @deprecated use clearGrains */
  clearVoices(): void {
    this.clearGrains();
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
            const active = msg.activeGrains ?? msg.activeVoices ?? 0;
            this.stats = {
              rms: msg.rms,
              peak: msg.peak,
              masterGain: msg.masterGain,
              activeGrains: active,
              activeVoices: active,
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

  sendPlan(plan: GrainPlan): void {
    this.lastPlan = plan;
    if (!this.node || !this.bank) return;
    this.node.port.postMessage({
      type: "plan",
      masterGain: plan.masterGain,
      gridWidth: plan.gridWidth,
      gridHeight: plan.gridHeight,
      grains: plan.grains.map((g) => ({
        latticeIndex: g.latticeIndex,
        r: g.r,
        g: g.g,
        b: g.b,
        x: g.x,
        y: g.y,
        grainLengthSec: g.grainLengthSec,
        amplitudeShare: g.amplitudeShare,
        localDelta: g.localDelta,
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
