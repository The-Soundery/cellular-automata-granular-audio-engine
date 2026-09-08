import { buildSpectralBank, type SpectralBank } from "./spectral.ts";
import { concatFloat32, encodeWav } from "./wav.ts";
import type { GrainEventBatch } from "../field/GrainScheduler.ts";

export { MASTER_GAIN } from "../field/GrainScheduler.ts";

export interface ListenGrain {
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
  regime?: string;
  /** Normalised read head in the source [0,1]. */
  t?: number;
}

export interface AudioStats {
  rms: number;
  peak: number;
  masterGain: number;
  activeGrains: number;
  activeVoices: number;
  sounding: number;
  triggersPerSec: number;
  deferredPerSec: number;
  listen: ListenGrain[];
  updatedAt: number;
}

export interface RecordingResult {
  blob: Blob;
  mimeType: string;
  extension: string;
}

/**
 * AudioContext + worklet lifecycle. Sends ephemeral GrainEventBatch messages.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private recorderNode: AudioWorkletNode | null = null;
  private recording = false;
  private recordLeft: Float32Array[] = [];
  private recordRight: Float32Array[] = [];
  private stopWaiters: Array<() => void> = [];
  private bank: SpectralBank | null = null;
  private started = false;
  private muted = false;
  private outputGain = 1;
  private muteGain: GainNode | null = null;
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

  /** Speakers on: engine running and not muted. */
  get isAudible(): boolean {
    return this.isEnabled && !this.muted;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  get isRecording(): boolean {
    return this.recording;
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

  getOutputGain(): number {
    return this.outputGain;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applySpeakerGain();
  }

  setOutputGain(gain: number): void {
    this.outputGain = Math.max(0, Math.min(1, gain));
    this.applySpeakerGain();
  }

  private applySpeakerGain(): void {
    if (this.muteGain) {
      this.muteGain.gain.value = this.muted ? 0 : this.outputGain;
    }
  }

  async stop(): Promise<RecordingResult | null> {
    this.started = false;
    let result: RecordingResult | null = null;
    if (this.recording) {
      result = await this.stopRecording().catch(() => null);
    }
    if (this.node) {
      this.node.port.postMessage({ type: "resetGrains" });
    }
    if (this.ctx && this.ctx.state === "running") {
      await this.ctx.suspend().catch(() => undefined);
    }
    return result;
  }

  /** Capture the live stereo mix as PCM for a WAV download. */
  startRecording(): void {
    if (!this.isEnabled || !this.recorderNode || !this.ctx) {
      throw new Error("Enable audio before recording");
    }
    if (this.recording) return;

    this.recordLeft = [];
    this.recordRight = [];
    this.recording = true;
    this.recorderNode.port.postMessage({ type: "start" });
  }

  /** Finalize PCM buffers into a 16-bit WAV blob. */
  async stopRecording(): Promise<RecordingResult | null> {
    if (!this.recording || !this.recorderNode || !this.ctx) {
      this.recording = false;
      return null;
    }

    const stopped = new Promise<void>((resolve) => {
      this.stopWaiters.push(resolve);
      // Safety timeout if the worklet never acknowledges.
      setTimeout(resolve, 500);
    });
    this.recorderNode.port.postMessage({ type: "stop" });
    await stopped;

    const left = concatFloat32(this.recordLeft);
    const right = concatFloat32(this.recordRight);
    this.recordLeft = [];
    this.recordRight = [];
    this.recording = false;

    if (left.length === 0) return null;

    const blob = encodeWav(left, right, this.ctx.sampleRate);
    return {
      blob,
      mimeType: "audio/wav",
      extension: "wav",
    };
  }

  clearGrains(): void {
    this.stats = null;
    if (!this.node) return;
    this.node.port.postMessage({ type: "resetGrains" });
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
        const bust = Date.now();
        await this.ctx.audioWorklet.addModule(`/grain-processor.js?v=${bust}`);
        await this.ctx.audioWorklet.addModule(
          `/recorder-processor.js?v=${bust}`,
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
              deferredPerSec: msg.deferredPerSec ?? 0,
              listen: msg.listen || [],
              updatedAt: performance.now(),
            };
          }
        };

        this.recorderNode = new AudioWorkletNode(
          this.ctx,
          "recorder-processor",
          {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [2],
            channelCount: 2,
          },
        );
        this.recorderNode.port.onmessage = (ev) => {
          const msg = ev.data;
          if (msg?.type === "pcm") {
            // Accept late flush chunks that arrive with the stop ack.
            if (msg.left instanceof Float32Array) this.recordLeft.push(msg.left);
            if (msg.right instanceof Float32Array) {
              this.recordRight.push(msg.right);
            }
          } else if (msg?.type === "stopped") {
            const waiters = this.stopWaiters.splice(0);
            for (const w of waiters) w();
          }
        };

        // grain → recorder (passthrough) → mute → speakers
        this.muteGain = this.ctx.createGain();
        this.applySpeakerGain();
        this.node.connect(this.recorderNode);
        this.recorderNode.connect(this.muteGain);
        this.muteGain.connect(this.ctx.destination);
      }

      if (this.ctx.state === "suspended") {
        await this.ctx.resume();
      }
      if (this.ctx.state === "suspended") {
        await this.ctx.resume();
      }

      this.started = this.ctx.state === "running";
      this.applySpeakerGain();

      if (this.bank && this.node) {
        this.sendSource(this.bank);
      }
    } catch (err) {
      this.started = false;
      this.recording = false;
      this.recordLeft = [];
      this.recordRight = [];
      this.node = null;
      this.recorderNode = null;
      this.muteGain = null;
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
    return this.bank;
  }

  /** Push spawn events + region pan/Y tracks to the worklet. */
  sendEvents(batch: GrainEventBatch): void {
    if (!this.node || !this.bank) return;
    const tracks = batch.tracks ?? [];
    const releases = batch.releaseGrainIds ?? [];
    if (!batch.events.length && !tracks.length && !releases.length) return;
    this.node.port.postMessage({
      type: "events",
      masterGain: batch.masterGain,
      gridWidth: batch.gridWidth,
      gridHeight: batch.gridHeight,
      events: batch.events.map((e) => ({
        ...e,
        gridWidth: batch.gridWidth,
        gridHeight: batch.gridHeight,
      })),
      tracks,
      releaseGrainIds: releases,
    });
  }

  private sendSource(bank: SpectralBank): void {
    if (!this.node) return;
    const pcmL = bank.pcmL.slice();
    const pcmR = bank.pcmR.slice();
    this.node.port.postMessage(
      {
        type: "source",
        sampleRate: bank.sampleRate,
        length: bank.length,
        pcmL: pcmL.buffer,
        pcmR: pcmR.buffer,
      },
      [pcmL.buffer, pcmR.buffer],
    );
  }
}
