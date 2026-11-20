// Runs on the audio thread. Downsamples mic audio to 16 kHz mono and
// posts 16-bit PCM frames (~40 ms each) back to the main thread.
const TARGET_RATE = 16000;
const FRAME_SAMPLES = 640; // 40 ms at 16 kHz

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / TARGET_RATE;
    this.pos = 0; // fractional read position into the incoming stream
    this.frame = new Int16Array(FRAME_SAMPLES);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;

    // Simple linear-interpolation resampler.
    while (this.pos < channel.length) {
      const i = Math.floor(this.pos);
      const frac = this.pos - i;
      const a = channel[i];
      const b = i + 1 < channel.length ? channel[i + 1] : a;
      const s = Math.max(-1, Math.min(1, a + (b - a) * frac));
      this.frame[this.filled++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.filled === FRAME_SAMPLES) {
        this.port.postMessage(this.frame.buffer, [this.frame.buffer]);
        this.frame = new Int16Array(FRAME_SAMPLES);
        this.filled = 0;
      }
      this.pos += this.ratio;
    }
    this.pos -= channel.length;
    return true;
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);
