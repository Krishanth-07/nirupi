import type { IncomingMessage, Server } from "node:http";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { FunctionResponseScheduling, type LiveServerMessage, type Session } from "@google/genai";
import { gemini, LIVE_MODEL } from "../gemini.js";
import { buildVivaInstruction, LANGUAGE_RULE, liveConfig, projectVocabulary, VIVA_STAGES, VIVA_TOOLS, WARMUP_INSTRUCTION } from "../ai/live.js";
import { buildBugHuntInstruction } from "../ai/bugHunt.js";
import { getDoc, getRepo, putDoc } from "../store.js";
import { vivaMode, type VivaDoc, type VivaTurn } from "../routes/viva.js";
import { countViolations, emptyIntegrity, INTEGRITY_KINDS, MAX_VIOLATIONS, VIOLATION_KINDS, type IntegrityKind, type IntegrityLog } from "./integrity.js";

/**
 * Server-side relay for the viva and bug hunt voice sessions.
 *
 * Why: if the browser talked to Gemini directly, the browser would also be the one reporting
 * the transcript — and anyone with DevTools could submit a perfect fake one. Here the server
 * holds the Gemini session, so the transcript, stage changes and timings are recorded by us.
 *
 * Browser → server:  {t:"audio", d:<base64 pcm16 16kHz>} | {t:"audioEnd"} | {t:"integrity", kind, detail?}
 *   (No text input is accepted — answers can only be spoken.)
 * Server → browser:  {t:"ready"} | {t:"audio", d} | {t:"in", d} | {t:"out", d} | {t:"turn"} | {t:"interrupted"}
 *                    | {t:"stage", stage} | {t:"finish"} | {t:"error", message}
 */

const STAGE_ORDER = ["warmup", ...VIVA_STAGES, "done"];
const MAX_SESSION_MS = 20 * 60 * 1000;
const active = new Map<string, WebSocket>(); // one live connection per viva + mode

/** True while a voice session for this viva is actually open on the server. */
export function isVivaLive(vivaId: string): boolean {
  return active.has(`${vivaId}:viva`) || active.has(`${vivaId}:bug`);
}

export function attachLiveRelay(server: Server): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "", "http://x");
    if (url.pathname !== "/api/live") return; // let other upgrade handlers (e.g. Vite HMR) deal with it
    wss.handleUpgrade(req, socket, head, (ws) => void handle(ws, req, url));
  });
}

async function handle(ws: WebSocket, _req: IncomingMessage, url: URL) {
  const vivaId = url.searchParams.get("vivaId") ?? "";
  const rawMode = url.searchParams.get("mode");
  const mode = rawMode === "bug" ? "bug" : rawMode === "warmup" ? "warmup" : "viva";
  const key = `${vivaId}:${mode}`;
  const send = (m: object) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m));
  const fail = (message: string, code = 4000) => {
    send({ t: "error", message });
    ws.close(code, message.slice(0, 120));
  };

  if (mode === "warmup") {
    let session: Session | null = null;
    let finished = false;
    const pinger = setInterval(() => ws.readyState === WebSocket.OPEN && ws.ping(), 20_000);
    const cap = setTimeout(() => fail("The warm-up reached its time limit.", 4008), MAX_SESSION_MS);
    const cleanup = () => {
      clearInterval(pinger);
      clearTimeout(cap);
      try {
        session?.close();
      } catch {
        /* already closed */
      }
      session = null;
    };
    ws.on("close", cleanup);
    ws.on("message", (raw: RawData) => {
      let msg: { t?: string; d?: unknown };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.t === "audio" && typeof msg.d === "string" && msg.d.length <= 64_000) {
        session?.sendRealtimeInput({ audio: { data: msg.d, mimeType: "audio/pcm;rate=16000" } });
      } else if (msg.t === "audioEnd") {
        session?.sendRealtimeInput({ audioStreamEnd: true });
      }
    });
    try {
      session = await gemini().live.connect({
        model: LIVE_MODEL,
        config: liveConfig(WARMUP_INSTRUCTION),
        callbacks: {
          onmessage: (m: LiveServerMessage) => {
            const sc = m.serverContent;
            if (!sc) return;
            if (sc.interrupted) send({ t: "interrupted" });
            for (const part of sc.modelTurn?.parts ?? []) {
              if (part.inlineData?.data) send({ t: "audio", d: part.inlineData.data });
            }
            if (sc.outputTranscription?.text) send({ t: "out", d: sc.outputTranscription.text });
            if (sc.inputTranscription?.text) send({ t: "in", d: sc.inputTranscription.text });
            if (sc.turnComplete) send({ t: "turn" });
          },
          onerror: (e) => console.error("[relay:warmup] gemini error", (e as ErrorEvent).message ?? e),
          onclose: (e) => {
            if (finished || ws.readyState !== WebSocket.OPEN) return;
            finished = true;
            fail(e.code === 1000 ? "The session ended." : "The voice connection dropped. Let's pick it back up.", 4011);
          },
        },
      });
      if (ws.readyState !== WebSocket.OPEN) return cleanup();
      session.sendRealtimeInput({ text: "Hi, I'm ready to start." });
      send({ t: "ready", stage: "warmup" });
    } catch (err) {
      console.error("[relay:warmup] connect failed", err);
      fail("We couldn't reach the examiner. Please try again.", 4012);
    }
    return;
  }

  const viva = await getDoc<VivaDoc>("vivas", vivaId);
  if (!viva) return fail("We couldn't find that viva.", 4004);
  if (active.has(key)) return fail("This viva is already open in another tab or window.", 4009);
  if (viva.integrity?.terminated) return fail("This viva was ended after integrity violations and can't be reopened.", 4013);
  if (mode === "viva" && viva.status !== "live") return fail("This viva has already finished. Start a new one to try again.", 4010);
  if (mode === "bug" && (!viva.bugHunt || viva.bugResult)) return fail("This bug hunt isn't available.", 4010);
  const repo = await getRepo(viva.repoId);
  if (!repo?.analysis) return fail("We couldn't find the project for this viva.", 4004);
  active.set(key, ws);
  const practice = vivaMode(viva) === "practice";

  /* ---------------- state recorded by the server ---------------- */
  let stage = mode === "bug" ? "bug" : viva.stage || "warmup";
  const turns: VivaTurn[] = mode === "bug" ? [] : [...(viva.turns ?? [])];
  const integrity: IntegrityLog = viva.integrity ?? emptyIntegrity();
  let open: VivaTurn | null = null;
  let finished = false;
  let dirty = false;
  const now = () => new Date().toISOString();
  // A second voice connection for the same viva/bug hunt is worth noting for the reviewer.
  if (viva.liveOpened?.[mode]) integrity.events.push({ kind: "reconnect", stage, at: now() });
  const bugStartedAt = mode === "bug" ? (viva.bugStartedAt ?? now()) : viva.bugStartedAt;

  // Answer-delay timing (server clock): when the examiner's question has finished *playing*.
  let aiTurnStartedAt = 0;
  let aiTurnAudioBytes = 0;
  let awaitingAnswerSince: number | null = null;

  const append = (role: VivaTurn["role"], text: string) => {
    text = text.replace(/<[^<>]{1,40}>/g, "");
    if (!text.trim()) return;
    if (open && open.role === role) open.text += text;
    else {
      open = { role, text: text.trimStart(), stage, at: now() };
      turns.push(open);
    }
    dirty = true;
  };

  const persist = async (final = false) => {
    if (!dirty && !final) return;
    dirty = false;
    const patch: Partial<VivaDoc> = { integrity, updatedAt: now(), liveOpened: { ...viva.liveOpened, [mode]: true } };
    const clean = turns.map((t) => ({ ...t, text: t.text.trim() })).filter((t) => t.text);
    if (mode === "viva") {
      patch.turns = clean;
      patch.stage = stage;
      if (final) patch.status = stage === "done" ? "completed" : "ended_early";
    } else {
      patch.bugTurns = clean;
      patch.bugStartedAt = bugStartedAt;
    }
    await putDoc("vivas", vivaId, patch).catch((e) => console.error("[relay] save failed", e));
  };

  /* ---------------- Gemini session (server-side, real API key) ---------------- */
  const config =
    mode === "viva"
      ? liveConfig(buildVivaInstruction(repo, repo.analysis), { tools: VIVA_TOOLS, vocabulary: projectVocabulary(repo.analysis) })
      : liveConfig(buildBugHuntInstruction(viva.bugHunt!, LANGUAGE_RULE), {
          vocabulary: [viva.bugHunt!.functionName, ...projectVocabulary(repo.analysis)],
        });

  let session: Session | null = null;
  /** Set once Gemini actually says or does something (used by the silence watchdog below). */
  let heardFromGemini = false;
  const onMessage = (m: LiveServerMessage) => {
    if (m.toolCall?.functionCalls) {
      session?.sendToolResponse({
        functionResponses: m.toolCall.functionCalls.map((fc) => ({
          id: fc.id,
          name: fc.name,
          response: { result: "ok", scheduling: FunctionResponseScheduling.SILENT },
        })),
      });
      for (const fc of m.toolCall.functionCalls) {
        const next = fc.name === "finish_viva" ? "done" : String((fc.args as { stage?: string })?.stage ?? "");
        // Stages only move forward — the model can't jump back, and nobody else can move them.
        if (mode === "viva" && STAGE_ORDER.indexOf(next) > STAGE_ORDER.indexOf(stage)) {
          stage = next;
          open = null;
          dirty = true;
          send({ t: "stage", stage });
          if (stage === "done") {
            finished = true;
            send({ t: "finish" });
          }
          void persist();
        }
      }
    }

    const sc = m.serverContent;
    if (!sc) return;
    if (sc.interrupted) send({ t: "interrupted" });
    for (const part of sc.modelTurn?.parts ?? []) {
      if (part.inlineData?.data) {
        if (!aiTurnStartedAt) aiTurnStartedAt = Date.now();
        aiTurnAudioBytes += Math.floor((part.inlineData.data.length * 3) / 4);
        send({ t: "audio", d: part.inlineData.data });
      }
    }
    if (sc.outputTranscription?.text) {
      append("ai", sc.outputTranscription.text);
      send({ t: "out", d: sc.outputTranscription.text });
    }
    if (sc.inputTranscription?.text) {
      if (awaitingAnswerSince !== null && sc.inputTranscription.text.trim() && /^q\d$/.test(stage)) {
        integrity.answerDelays[stage] ??= Math.max(0, Math.round((Date.now() - awaitingAnswerSince) / 1000));
        awaitingAnswerSince = null;
      }
      append("student", sc.inputTranscription.text);
      send({ t: "in", d: sc.inputTranscription.text });
    }
    if (sc.turnComplete) {
      open = null;
      if (aiTurnStartedAt) {
        // The question has finished *playing* once its audio length has elapsed (24 kHz, 16-bit mono).
        const playbackEnds = aiTurnStartedAt + (aiTurnAudioBytes / 48_000) * 1000;
        awaitingAnswerSince = Math.max(Date.now(), playbackEnds);
      }
      aiTurnStartedAt = 0;
      aiTurnAudioBytes = 0;
      send({ t: "turn" });
    }
  };

  const saver = setInterval(() => void persist(), 10_000);
  const pinger = setInterval(() => ws.readyState === WebSocket.OPEN && ws.ping(), 20_000);
  const cap = setTimeout(() => fail("The session reached its time limit.", 4008), MAX_SESSION_MS);

  const cleanup = async () => {
    clearInterval(saver);
    clearInterval(pinger);
    clearTimeout(cap);
    if (active.get(key) === ws) active.delete(key);
    try {
      session?.close();
    } catch {
      /* already closed */
    }
    session = null;
    await persist(true);
  };

  /** Too many violations: end the session for good and flag it. */
  const terminate = async (violations: number) => {
    integrity.terminated = { at: now(), stage, violations };
    finished = true;
    dirty = true;
    if (mode === "bug") await putDoc("vivas", vivaId, { bugClosed: true }).catch(() => {});
    await persist(true);
    send({
      t: "terminated",
      message: `Your ${mode === "bug" ? "bug hunt" : "viva"} was ended because the exam window was left ${violations} times. This is flagged in your report.`,
    });
    ws.close(4013, "Ended after integrity violations");
  };

  ws.on("close", () => void cleanup());
  ws.on("message", (raw: RawData) => {
    let msg: { t?: string; d?: unknown; kind?: string; detail?: unknown };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.t === "audio" && typeof msg.d === "string" && msg.d.length <= 64_000) {
      session?.sendRealtimeInput({ audio: { data: msg.d, mimeType: "audio/pcm;rate=16000" } });
    } else if (msg.t === "audioEnd") {
      session?.sendRealtimeInput({ audioStreamEnd: true });
    } else if (msg.t === "integrity" && INTEGRITY_KINDS.includes(msg.kind as (typeof INTEGRITY_KINDS)[number])) {
      if (integrity.events.length < 1000 && !integrity.terminated) {
        const kind = msg.kind as IntegrityKind;
        integrity.events.push({
          kind,
          stage,
          at: now(),
          ...(typeof msg.detail === "string" ? { detail: msg.detail.slice(0, 80) } : {}),
        });
        dirty = true;
        if (VIOLATION_KINDS.includes(kind)) {
          const violations = countViolations(integrity.events);
          // The server decides the count, so the browser can't reset or hide it.
          // Practice sessions only warn (max 0 = no limit); assessments end at the limit.
          send({ t: "violation", count: violations, max: practice ? 0 : MAX_VIOLATIONS });
          if (!practice && violations >= MAX_VIOLATIONS) void terminate(violations);
        }
      }
    }
    // Anything else — including text — is ignored: answers must be spoken.
  });

  // Each Gemini session gets a number, so a replaced session's late "close" event is ignored.
  let generation = 0;
  const openSession = async () => {
    const mine = ++generation;
    session = await gemini().live.connect({
      model: LIVE_MODEL,
      config,
      callbacks: {
        onmessage: (m) => {
          if (mine !== generation) return;
          if (m.toolCall || m.serverContent?.modelTurn || m.serverContent?.outputTranscription) heardFromGemini = true;
          onMessage(m);
        },
        onerror: (e) => console.error("[relay] gemini error", (e as ErrorEvent).message ?? e),
        onclose: (e) => {
          if (mine !== generation || finished || ws.readyState !== WebSocket.OPEN) return;
          fail(e.code === 1000 ? "The session ended." : "The voice connection dropped. Let's pick it back up.", 4011);
        },
      },
    });
    // The server (not the browser) starts the conversation.
    session.sendRealtimeInput({
      text: mode === "viva" ? "The student has joined and is ready for the viva." : "The student has started the bug hunt.",
    });
  };

  /**
   * Watchdog: on a busy or rate-limited key, Gemini sometimes accepts a session and then never answers,
   * with no error. If the examiner hasn't said anything within 10s, open a fresh session once;
   * if that's silent too, end with a clear message instead of leaving the student waiting.
   */
  const SILENCE_MS = 10_000;
  const watchdog = async (attempt: number) => {
    if (heardFromGemini || finished || ws.readyState !== WebSocket.OPEN) return;
    if (attempt === 1) {
      console.warn(`[relay] ${vivaId}: no reply from Gemini in ${SILENCE_MS / 1000}s; opening a fresh session`);
      const old = session;
      try {
        await openSession(); // bumps the generation, so the old session's close is ignored
        old?.close();
        setTimeout(() => void watchdog(2), SILENCE_MS);
      } catch (err) {
        console.error("[relay] retry connect failed", err);
        fail("We couldn't reach the examiner. Please try again in a minute.", 4012);
      }
    } else {
      console.warn(`[relay] ${vivaId}: still no reply from Gemini after a retry`);
      fail(
        "The examiner isn't responding right now. Google's voice service may be busy, or this API key may have hit its limit. Please try again in a minute.",
        4014,
      );
    }
  };

  try {
    await openSession();
    if (ws.readyState !== WebSocket.OPEN) return void cleanup();
    dirty = true; // record bugStartedAt / reconnect events straight away
    void persist();
    send({ t: "ready", stage });
    setTimeout(() => void watchdog(1), SILENCE_MS);
  } catch (err) {
    console.error("[relay] connect failed", err);
    fail("We couldn't reach the examiner. Please try again.", 4012);
  }
}
