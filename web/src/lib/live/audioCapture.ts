/** Captures the microphone as 16 kHz, 16-bit PCM frames (base64) for Gemini Live. */
export class AudioCapture {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private analyser: AnalyserNode | null = null;
  private levelBuf: Uint8Array<ArrayBuffer> = new Uint8Array(0);

  /** Asks for mic permission. Throws a DOMException (NotAllowedError, NotFoundError…) on failure. */
  async open(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  }

  async start(onFrame: (base64Pcm: string) => void): Promise<void> {
    if (!this.stream) await this.open();
    this.ctx = new AudioContext();
    await this.ctx.audioWorklet.addModule("/pcm-worklet.js");

    const source = this.ctx.createMediaStreamSource(this.stream!);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.levelBuf = new Uint8Array(this.analyser.fftSize);

    this.node = new AudioWorkletNode(this.ctx, "pcm-capture");
    this.node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => onFrame(toBase64(e.data));

    source.connect(this.analyser);
    source.connect(this.node);
    // The worklet must be pulled by the graph; route it to a muted gain so nothing is heard.
    const sink = this.ctx.createGain();
    sink.gain.value = 0;
    this.node.connect(sink).connect(this.ctx.destination);
  }

  /** 0..1 RMS loudness of the mic right now. */
  level(): number {
    if (!this.analyser) return 0;
    this.analyser.getByteTimeDomainData(this.levelBuf);
    return rms(this.levelBuf);
  }

  stop(): void {
    this.node?.port.close();
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.ctx = this.stream = this.node = this.analyser = null;
  }
}

export function rms(buf: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = (buf[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / buf.length);
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}
