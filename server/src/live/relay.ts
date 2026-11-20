import type { IncomingMessage, Server } from "node:http";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { FunctionResponseScheduling, type LiveServerMessage, type Session } from "@google/genai";
import { gemini, LIVE_MODEL } from "../gemini.js";
import { buildVivaInstruction, LANGUAGE_RULE, liveConfig, projectVocabulary, VIVA_STAGES, VIVA_TOOLS } from "../ai/live.js";
import { buildBugHuntInstruction } from "../ai/bugHunt.js";
import { getDoc, getRepo, putDoc } from "../store.js";
import type { VivaDoc, VivaTurn } from "../routes/viva.js";
import { emptyIntegrity, INTEGRITY_KINDS, type IntegrityKind, type IntegrityLog } from "./integrity.js";

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
  const mode = url.searchParams.get("mode") === "bug" ? "bug" : "viva";
  const key = `${vivaId}:${mode}`;
  const send = (m: object) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m));
  const fail = (message: string, code = 4000) => {
    send({ t: "error", message });
    ws.close(code, message.slice(0, 120));
  };

  const viva = await getDoc<VivaDoc>("vivas", vivaId);
  if (!viva) return fail("We couldn't find that viva.", 4004);
  if (active.has(key)) return fail("This viva is already open in another tab or window.", 4009);
  if (mode === "viva" && viva.status !== "live") return fail("This viva has already finished. Start a new one to try again.", 4010);
  if (mode === "bug" && (!viva.bugHunt || viva.bugResult)) return fail("This bug hunt isn't available.", 4010);
  const repo = await getRepo(viva.repoId);
  if (!repo?.analysis) return fail("We couldn't find the project for this viva.", 4004);
  active.set(key, ws);

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
      if (integrity.events.length < 1000) {
        integrity.events.push({
          kind: msg.kind as IntegrityKind,
          stage,
          at: now(),
          ...(typeof msg.detail === "string" ? { detail: msg.detail.slice(0, 80) } : {}),
        });
        dirty = true;
      }
    }
    // Anything else — including text — is ignored: answers must be spoken.
  });

  try {
    session = await gemini().live.connect({
      model: LIVE_MODEL,
      config,
      callbacks: {
        onmessage: onMessage,
        onerror: (e) => console.error("[relay] gemini error", (e as ErrorEvent).message ?? e),
        onclose: (e) => {
          if (finished || ws.readyState !== WebSocket.OPEN) return;
          fail(e.code === 1000 ? "The session ended." : "The voice connection dropped. Let's pick it back up.", 4011);
        },
      },
    });
    if (ws.readyState !== WebSocket.OPEN) return void cleanup();
    // The server (not the browser) starts the conversation.
    session.sendRealtimeInput({
      text: mode === "viva" ? "The student has joined and is ready for the viva." : "The student has started the bug hunt.",
    });
    dirty = true; // record bugStartedAt / reconnect events straight away
    void persist();
    send({ t: "ready", stage });
  } catch (err) {
    console.error("[relay] connect failed", err);
    fail("We couldn't reach the examiner. Please try again.", 4012);
  }
}
