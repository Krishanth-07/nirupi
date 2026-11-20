import { useCallback, useEffect, useRef, useState } from "react";
import { FunctionResponseScheduling, GoogleGenAI, Modality, type LiveServerMessage, type Session } from "@google/genai";
import { AudioCapture } from "./audioCapture";
import { AudioPlayer } from "./audioPlayer";

export type LiveStatus = "idle" | "connecting" | "live" | "ended" | "error";
export type Speaker = "ai" | "student" | "none";
export type LiveErrorKind = "mic" | "network" | "dropped";

export interface Turn {
  id: string;
  role: "ai" | "student";
  text: string;
  final: boolean;
  /** Which part of the viva this was said in (warmup, q1, q2, q3, done, bug). */
  stage: string;
  at: string;
}

export interface LiveError {
  kind: LiveErrorKind;
  message: string;
}

export interface StartOptions {
  /**
   * Relay mode (viva, bug hunt): returns the /api/live URL. The server holds the Gemini session and
   * records the transcript itself, so the browser can't alter it.
   */
  relay?: () => Promise<string>;
  /** Direct mode (warm-up only): a short-lived token from our server. */
  getToken?: () => Promise<{ token: string; model: string }>;
  /** Direct mode only: text sent once connected so the examiner speaks first. */
  kickoff?: string;
  /** The examiner moved to a new stage or finished (set_stage / finish_viva). */
  onToolCall?: (name: string, args: Record<string, unknown>) => void;
}

/** What the hook needs from either connection type. */
interface Transport {
  sendAudio(base64Pcm: string): void;
  audioEnd(): void;
  integrity(kind: string, detail?: string): void;
  close(): void;
}

const MIC_SPEAKING_THRESHOLD = 0.04;

export function useLiveSession() {
  const [status, setStatus] = useState<LiveStatus>("idle");
  const [error, setError] = useState<LiveError | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [muted, setMuted] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);

  const transportRef = useRef<Transport | null>(null);
  const captureRef = useRef<AudioCapture | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const mutedRef = useRef(false);
  const endingRef = useRef(false);
  const stageRef = useRef("warmup");
  const toolRef = useRef<StartOptions["onToolCall"]>(undefined);

  /** New transcript bubbles are tagged with this stage. */
  const setStageTag = useCallback((stage: string) => {
    stageRef.current = stage;
  }, []);

  const appendText = useCallback((role: Turn["role"], text: string) => {
    // Drop transcription placeholders like "<no speech detected>" / "<noise>" and system artefacts.
    text = text.replace(/<[^<>]{1,40}>/g, "");
    if (!text.trim() || /^\s*invalid voice selected\.?\s*$/i.test(text)) return;
    setTurns((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === role && !last.final) {
        return [...prev.slice(0, -1), { ...last, text: last.text + text }];
      }
      // A new speaker closes the other side's open bubble.
      const closed = prev.map((t) => (t.final ? t : { ...t, final: true }));
      return [
        ...closed,
        { id: crypto.randomUUID(), role, text: text.trimStart(), final: false, stage: stageRef.current, at: new Date().toISOString() },
      ];
    });
  }, []);

  const closeOpenTurns = useCallback(() => {
    setTurns((prev) => (prev.some((t) => !t.final) ? prev.map((t) => ({ ...t, final: true })) : prev));
  }, []);

  const teardown = useCallback(() => {
    captureRef.current?.stop();
    playerRef.current?.close();
    captureRef.current = null;
    playerRef.current = null;
    const t = transportRef.current;
    transportRef.current = null;
    try {
      t?.close();
    } catch {
      /* already closed */
    }
  }, []);

  const dropped = useCallback(
    (message = "The voice connection dropped. Let's pick it back up.") => {
      if (endingRef.current) return;
      endingRef.current = true;
      teardown();
      setStatus("error");
      setError({ kind: "dropped", message });
    },
    [teardown],
  );

  /* ---------------- relay transport (viva, bug hunt) ---------------- */
  const connectRelay = useCallback(
    async (path: string): Promise<Transport> => {
      const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${path}`;
      const ws = new WebSocket(url);
      const send = (m: object) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m));

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("We couldn't reach the examiner. Check your connection and try again.")), 20_000);
        ws.onmessage = (e) => {
          const m = JSON.parse(e.data as string);
          if (m.t === "ready") {
            clearTimeout(timer);
            resolve();
          } else if (m.t === "error") {
            clearTimeout(timer);
            reject(new Error(m.message));
          }
        };
        ws.onclose = (e) => {
          clearTimeout(timer);
          reject(new Error(e.reason || "We couldn't reach the examiner. Please try again."));
        };
      });

      ws.onmessage = (e) => {
        const m = JSON.parse(e.data as string) as { t: string; d?: string; stage?: string; message?: string };
        switch (m.t) {
          case "audio":
            if (m.d) playerRef.current?.play(m.d);
            break;
          case "in":
            if (m.d) appendText("student", m.d);
            break;
          case "out":
            if (m.d) appendText("ai", m.d);
            break;
          case "turn":
            closeOpenTurns();
            break;
          case "interrupted":
            playerRef.current?.flush();
            break;
          case "stage":
            toolRef.current?.("set_stage", { stage: m.stage });
            break;
          case "finish":
            toolRef.current?.("finish_viva", {});
            break;
          case "error":
            dropped(m.message);
            break;
        }
      };
      ws.onclose = (e) => dropped(e.code >= 4000 && e.reason ? e.reason : undefined);

      return {
        sendAudio: (d) => send({ t: "audio", d }),
        audioEnd: () => send({ t: "audioEnd" }),
        integrity: (kind, detail) => send({ t: "integrity", kind, ...(detail ? { detail } : {}) }),
        close: () => ws.close(1000),
      };
    },
    [appendText, closeOpenTurns, dropped],
  );

  /* ---------------- direct transport (warm-up only) ---------------- */
  const connectDirect = useCallback(
    async (getToken: NonNullable<StartOptions["getToken"]>, kickoff?: string): Promise<Transport> => {
      const { token, model } = await getToken();
      const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: "v1beta" } });
      let session: Session | null = null;
      const onmessage = (msg: LiveServerMessage) => {
        if (msg.toolCall?.functionCalls) {
          session?.sendToolResponse({
            functionResponses: msg.toolCall.functionCalls.map((fc) => ({
              id: fc.id,
              name: fc.name,
              response: { result: "ok", scheduling: FunctionResponseScheduling.SILENT },
            })),
          });
          for (const fc of msg.toolCall.functionCalls) toolRef.current?.(fc.name ?? "", (fc.args as Record<string, unknown>) ?? {});
        }
        const sc = msg.serverContent;
        if (!sc) return;
        if (sc.interrupted) playerRef.current?.flush();
        for (const part of sc.modelTurn?.parts ?? []) if (part.inlineData?.data) playerRef.current?.play(part.inlineData.data);
        if (sc.inputTranscription?.text) appendText("student", sc.inputTranscription.text);
        if (sc.outputTranscription?.text) appendText("ai", sc.outputTranscription.text);
        if (sc.turnComplete) closeOpenTurns();
      };
      session = await ai.live.connect({
        model,
        config: { responseModalities: [Modality.AUDIO] },
        callbacks: { onmessage, onerror: (e) => console.error("[live] error", e), onclose: () => dropped() },
      });
      session.sendRealtimeInput({ text: kickoff ?? "Hi, I'm ready to start." });
      const s = session;
      return {
        sendAudio: (d) => s.sendRealtimeInput({ audio: { data: d, mimeType: "audio/pcm;rate=16000" } }),
        audioEnd: () => s.sendRealtimeInput({ audioStreamEnd: true }),
        integrity: () => {},
        close: () => s.close(),
      };
    },
    [appendText, closeOpenTurns, dropped],
  );

  const start = useCallback(
    async (opts: StartOptions) => {
      endingRef.current = false;
      toolRef.current = opts.onToolCall;
      setError(null);
      setTurns([]);
      setMuted(false);
      mutedRef.current = false;
      setStatus("connecting");

      // 1. Mic first, so the permission prompt doesn't eat into any connection window.
      const capture = new AudioCapture();
      try {
        await capture.open();
      } catch (e) {
        setStatus("error");
        setError({
          kind: "mic",
          message:
            (e as DOMException)?.name === "NotFoundError"
              ? "We couldn't find a microphone. Plug one in and try again."
              : "Nirupi needs your microphone to hear your answers.",
        });
        return;
      }
      captureRef.current = capture;

      const player = new AudioPlayer();
      playerRef.current = player;
      await player.resume();

      try {
        // 2. Connect: through our server (viva, bug hunt) or directly with a token (warm-up).
        const transport = opts.relay
          ? await connectRelay(await opts.relay())
          : await connectDirect(opts.getToken!, opts.kickoff);
        transportRef.current = transport;

        // 3. Stream mic frames.
        await capture.start((data) => {
          if (mutedRef.current) return;
          transportRef.current?.sendAudio(data);
        });

        setStartedAt(Date.now());
        setStatus("live");
      } catch (e) {
        console.error("[live] start failed", e);
        endingRef.current = true;
        teardown();
        setStatus("error");
        setError({
          kind: "network",
          message:
            e instanceof Error && e.message !== "Failed to fetch"
              ? e.message
              : "We couldn't reach the examiner. Check your connection and try again.",
        });
      }
    },
    [connectRelay, connectDirect, teardown],
  );

  const end = useCallback(() => {
    endingRef.current = true;
    teardown();
    closeOpenTurns();
    setStatus("ended");
  }, [teardown, closeOpenTurns]);

  /** Resolves once the examiner has finished speaking (or after `maxMs`). */
  const whenSilent = useCallback(async (maxMs = 15000) => {
    const until = Date.now() + maxMs;
    // Give the last audio chunks a moment to arrive before we start checking.
    await new Promise((r) => setTimeout(r, 1200));
    while (playerRef.current?.isPlaying() && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 250));
    }
  }, []);

  const toggleMute = useCallback(() => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    // Tell the server the stream paused so it doesn't wait on a half-finished utterance.
    if (next) transportRef.current?.audioEnd();
  }, []);

  /** Report an integrity signal (tab switch, paste attempt…). The server timestamps it. */
  const reportIntegrity = useCallback((kind: string, detail?: string) => {
    transportRef.current?.integrity(kind, detail);
  }, []);

  /** Read every animation frame by the orb — no React re-render per frame. */
  const getLevels = useCallback((): { level: number; speaker: Speaker } => {
    const player = playerRef.current;
    const capture = captureRef.current;
    if (player?.isPlaying()) return { level: Math.min(1, player.level() * 4), speaker: "ai" };
    const mic = mutedRef.current ? 0 : capture?.level() ?? 0;
    if (mic > MIC_SPEAKING_THRESHOLD) return { level: Math.min(1, mic * 5), speaker: "student" };
    return { level: 0, speaker: "none" };
  }, []);

  useEffect(
    () => () => {
      endingRef.current = true;
      teardown();
    },
    [teardown],
  );

  return { status, error, turns, muted, startedAt, start, end, whenSilent, toggleMute, getLevels, setStageTag, reportIntegrity };
}
