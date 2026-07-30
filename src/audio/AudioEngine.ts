import type { VoicePlan } from "../field/FieldMetrics.ts";
import { buildSpectralBank, type SpectralBank } from "./spectral.ts";

export interface ListenVoice {
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
  amp: number;
  len: number;
  sounding: boolean;
  gain: number;
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

  sendPlan(plan: VoicePlan): void {
    this.lastPlan = plan;
    if (!this.node || !this.bank) return;
    // V2: x/y → topology in worklet; r/g/b → density/complexity/coherence material.
    this.node.port.postMessage({
      type: "plan",
      masterGain: plan.masterGain,
      gridWidth: plan.gridWidth,
      gridHeight: plan.gridHeight,
      voices: plan.voices.map((v) => ({
        r: v.r,
        g: v.g,
        b: v.b,
        x: v.x,
        y: v.y,
        grainLengthSec: v.grainLengthSec,
        overlap: v.overlap,
        persistence: v.persistence,
        amplitudeShare: v.amplitudeShare,
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
