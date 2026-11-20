import { rms } from "./audioCapture";

const OUTPUT_RATE = 24000; // Gemini Live always returns 24 kHz 16-bit PCM

/** Gapless playback of streamed PCM chunks, with instant flush for barge-in. */
export class AudioPlayer {
  private ctx: AudioContext;
  private out: GainNode;
  private analyser: AnalyserNode;
  private levelBuf: Uint8Array<ArrayBuffer>;
  private nextStart = 0;
  private sources = new Set<AudioBufferSourceNode>();

  constructor() {
    this.ctx = new AudioContext({ sampleRate: OUTPUT_RATE });
    this.out = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.levelBuf = new Uint8Array(this.analyser.fftSize);
    this.out.connect(this.analyser).connect(this.ctx.destination);
  }

  /** Must be called from a user gesture on some browsers (Safari). */
  async resume(): Promise<void> {
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  play(base64Pcm: string): void {
    const bytes = Uint8Array.from(atob(base64Pcm), (c) => c.charCodeAt(0));
    const pcm = new Int16Array(bytes.buffer, 0, bytes.byteLength >> 1);
    const buffer = this.ctx.createBuffer(1, pcm.length, OUTPUT_RATE);
    const ch = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.out);
    const startAt = Math.max(this.nextStart, this.ctx.currentTime + 0.02);
    src.start(startAt);
    this.nextStart = startAt + buffer.duration;
    this.sources.add(src);
    src.onended = () => this.sources.delete(src);
  }

  /** Stop everything queued (the user interrupted). */
  flush(): void {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.sources.clear();
    this.nextStart = 0;
  }

  isPlaying(): boolean {
    return this.sources.size > 0;
  }

  level(): number {
    this.analyser.getByteTimeDomainData(this.levelBuf);
    return rms(this.levelBuf);
  }

  close(): void {
    this.flush();
    void this.ctx.close();
  }
}
