/**
 * Passthrough stereo worklet that copies input PCM to the main thread while recording.
 * Buffers ~8192 frames per message to limit postMessage traffic.
 */
class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._recording = false;
    this._left = [];
    this._right = [];
    this._frames = 0;
    this.port.onmessage = (ev) => {
      const msg = ev.data;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "start") {
        this._recording = true;
        this._left = [];
        this._right = [];
        this._frames = 0;
      } else if (msg.type === "stop") {
        this._flush();
        this._recording = false;
        this.port.postMessage({ type: "stopped" });
      }
    };
  }

  _flush() {
    if (this._frames === 0) return;
    const left = new Float32Array(this._frames);
    const right = new Float32Array(this._frames);
    let offset = 0;
    for (let i = 0; i < this._left.length; i++) {
      left.set(this._left[i], offset);
      right.set(this._right[i], offset);
      offset += this._left[i].length;
    }
    this._left = [];
    this._right = [];
    this._frames = 0;
    this.port.postMessage({ type: "pcm", left, right }, [left.buffer, right.buffer]);
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input[0] || !output || !output[0]) return true;

    const chL = input[0];
    const chR = input[1] && input[1].length ? input[1] : input[0];
    output[0].set(chL);
    if (output[1]) output[1].set(chR);

    if (this._recording) {
      this._left.push(chL.slice());
      this._right.push(chR.slice());
      this._frames += chL.length;
      if (this._frames >= 8192) this._flush();
    }

    return true;
  }
}

registerProcessor("recorder-processor", RecorderProcessor);
