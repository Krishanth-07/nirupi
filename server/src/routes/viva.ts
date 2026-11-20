import { Router } from "express";
import { randomUUID } from "node:crypto";
import { BUG_HUNT_SECONDS, generateBugHunt, judgeFix, publicView, type BugHunt, type BugResult } from "../ai/bugHunt.js";
import { getDoc, getRepo, getRepoContents, listDocs, putDoc } from "../store.js";
import type { IntegrityLog } from "../live/integrity.js";

export interface VivaTurn {
  role: "ai" | "student";
  text: string;
  stage: string; // warmup | q1 | q2 | q3 | done | bug
  at: string;
}

export interface VivaDoc {
  id: string;
  repoId: string;
  repoName: string;
  status: "live" | "completed" | "ended_early";
  stage: string;
  createdAt: string;
  updatedAt: string;
  /**
   * practice: a student training on their own; the report is theirs alone and integrity rules only warn.
   * assessment: for hiring; strict integrity rules and it appears in the company's hiring dashboard.
   */
  mode: VivaMode;
  /** Which attempt this is for the same repo and mode (1 = first). Retakes are visible to reviewers. */
  attempt: number;
  questions: { id: string; file: string; line: number; question: string }[];
  /** Recorded by the server relay — the browser can't write these. */
  turns: VivaTurn[];
  integrity?: IntegrityLog;
  /** Which voice sessions have been opened at least once (to spot re-connections). */
  liveOpened?: { viva?: boolean; bug?: boolean };
  bugHunt?: BugHunt;
  bugStartedAt?: string; // server clock
  bugTurns?: VivaTurn[]; // recorded by the server relay
  bugResult?: BugResult;
  /** Set when the report is generated before the bug hunt was submitted: it can't be submitted later. */
  bugClosed?: boolean;
}

/** Bug hunt time is measured on the server; a little grace covers network delay. */
const GRACE_SECONDS = 15;

export type VivaMode = "practice" | "assessment";
export const vivaMode = (v: { mode?: string } | null | undefined): VivaMode => (v?.mode === "practice" ? "practice" : "assessment");

export const vivaRouter = Router();

/**
 * POST /api/viva { repoId }
 * Creates a viva record. The voice session itself runs through the server relay (/api/live),
 * so the transcript is recorded server-side.
 */
vivaRouter.post("/viva", async (req, res) => {
  try {
    const repo = await getRepo(String(req.body?.repoId ?? ""));
    if (!repo) return void res.status(404).json({ error: "We couldn't find that project. Try connecting it again." });
    if (!repo.analysis) return void res.status(409).json({ error: "Your questions aren't ready yet. Go back and let us finish reading your code." });

    const mode = vivaMode(req.body);
    const previous = (await listDocs<VivaDoc>("vivas")).filter((v) => v.repoId === repo.id && vivaMode(v) === mode).length;
    const now = new Date().toISOString();
    const viva: VivaDoc = {
      id: randomUUID(),
      repoId: repo.id,
      repoName: `${repo.owner}/${repo.repo}`,
      status: "live",
      stage: "warmup",
      createdAt: now,
      updatedAt: now,
      mode,
      attempt: previous + 1,
      questions: repo.analysis.questions.map(({ id, file, line, question }) => ({ id, file, line, question })),
      turns: [],
    };
    await putDoc("vivas", viva.id, viva, false);
    // Prepare the bug hunt while the student talks, so it's ready the moment questions end.
    void ensureBugHunt(viva.id).catch(() => {});

    res.json({
      vivaId: viva.id,
      repoName: viva.repoName,
      mode: viva.mode,
      attempt: viva.attempt,
      // File + line + nearby code for the progress rail. Question wording stays spoken-only.
      questions: repo.analysis.questions.map(({ id, file, line, excerpt }) => ({ id, file, line, excerpt })),
    });
  } catch (err) {
    console.error("[viva]", err);
    res.status(500).json({ error: "We couldn't start your viva right now. Please try again in a moment." });
  }
});

/** GET /api/viva/:id — progress only. Never the bug hunt's original code or the expected answers. */
vivaRouter.get("/viva/:id", async (req, res) => {
  const viva = await getDoc<VivaDoc>("vivas", req.params.id);
  if (!viva) return void res.status(404).json({ error: "Viva not found." });
  res.json({
    id: viva.id,
    repoId: viva.repoId,
    repoName: viva.repoName,
    status: viva.status,
    stage: viva.stage,
    attempt: viva.attempt,
    createdAt: viva.createdAt,
    hasBugResult: !!viva.bugResult,
  });
});

/* ---------------- Step 5: bug hunt ---------------- */

const pending = new Map<string, Promise<BugHunt>>();

/** Returns the viva's bug hunt, generating it once (concurrent callers share the same promise). */
export function ensureBugHunt(vivaId: string): Promise<BugHunt> {
  const inFlight = pending.get(vivaId);
  if (inFlight) return inFlight;
  const job = (async () => {
    const viva = await getDoc<VivaDoc>("vivas", vivaId);
    if (!viva) throw new Error("viva not found");
    if (viva.bugHunt) return viva.bugHunt;
    const [repo, contents] = await Promise.all([getRepo(viva.repoId), getRepoContents(viva.repoId)]);
    if (!repo?.analysis || !contents) throw new Error("repo not found");
    const started = Date.now();
    // Demo repo: use the bug hunt prepared ahead of time (no live Gemini call on stage).
    const hunt = repo.demoBugHunt ? { ...repo.demoBugHunt, createdAt: new Date().toISOString() } : await generateBugHunt(repo, contents, repo.analysis);
    console.log(`[bughunt] ${vivaId} ready in ${((Date.now() - started) / 1000).toFixed(1)}s: ${hunt.file} ${hunt.functionName}`);
    await putDoc("vivas", vivaId, { bugHunt: hunt });
    return hunt;
  })();
  pending.set(vivaId, job);
  job.catch((err) => console.error("[bughunt]", err)).finally(() => pending.delete(vivaId));
  return job;
}

/** GET /api/viva/:id/bughunt — the buggy function + task (never the original or the answer). */
vivaRouter.get("/viva/:id/bughunt", async (req, res) => {
  try {
    const viva = await getDoc<VivaDoc>("vivas", req.params.id);
    if (!viva) return void res.status(404).json({ error: "We couldn't find that viva." });
    const hunt = await ensureBugHunt(viva.id);
    res.json({
      ...publicView(hunt),
      // The code is released only once the server clock has started — no reading it early.
      buggyCode: viva.bugStartedAt ? hunt.buggyCode : null,
      repoName: viva.repoName,
      startedAt: viva.bugStartedAt ?? null,
      closed: !!viva.bugClosed,
      result: viva.bugResult ? pickResult(viva.bugResult) : null,
    });
  } catch {
    res.status(500).json({ error: "We couldn't prepare your bug hunt. Please try again." });
  }
});

/**
 * POST /api/viva/:id/bughunt/start — starts the 3-minute clock on the SERVER (once).
 * Reloading the page doesn't reset it.
 */
vivaRouter.post("/viva/:id/bughunt/start", async (req, res) => {
  const viva = await getDoc<VivaDoc>("vivas", req.params.id);
  if (!viva?.bugHunt) return void res.status(404).json({ error: "We couldn't find that bug hunt." });
  if (viva.bugResult || viva.bugClosed) return void res.status(409).json({ error: "This bug hunt is already finished." });
  const startedAt = viva.bugStartedAt ?? new Date().toISOString();
  if (!viva.bugStartedAt) await putDoc("vivas", viva.id, { bugStartedAt: startedAt });
  res.json({ startedAt, serverNow: new Date().toISOString(), durationSec: BUG_HUNT_SECONDS, buggyCode: viva.bugHunt.buggyCode });
});

/**
 * POST /api/viva/:id/bughunt/submit { code }
 * Time and the spoken explanation come from the server's own records, not the browser.
 * Gemini compares original / buggy / student versions (code is never executed).
 */
vivaRouter.post("/viva/:id/bughunt/submit", async (req, res) => {
  try {
    const viva = await getDoc<VivaDoc>("vivas", req.params.id);
    if (!viva?.bugHunt) return void res.status(404).json({ error: "We couldn't find that bug hunt." });
    if (viva.bugResult) return void res.json(pickResult(viva.bugResult)); // one submission only
    if (viva.bugClosed) return void res.status(409).json({ error: "This bug hunt was closed when the report was generated." });
    if (!viva.bugStartedAt) return void res.status(409).json({ error: "Start the bug hunt before submitting." });

    const elapsed = Math.round((Date.now() - Date.parse(viva.bugStartedAt)) / 1000);
    const timedOut = elapsed > BUG_HUNT_SECONDS + GRACE_SECONDS;
    // After time runs out, the code submitted is what counts only if it arrived in time; otherwise the buggy code stands.
    const code = timedOut ? viva.bugHunt.buggyCode : String(req.body?.code ?? "").slice(0, 50_000);
    const explanation = (viva.bugTurns ?? []).filter((t) => t.role === "student").map((t) => t.text).join(" ");

    const verdict = await judgeFix(viva.bugHunt, code, explanation);
    const bugResult: BugResult = {
      ...verdict,
      ...(timedOut ? { reason: `Submitted after the 3-minute limit, so the fix couldn't be counted. ${verdict.reason}` } : {}),
      studentCode: code,
      secondsUsed: Math.min(elapsed, BUG_HUNT_SECONDS),
      timedOut: timedOut || elapsed >= BUG_HUNT_SECONDS,
      submittedAt: new Date().toISOString(),
    };
    // Bug-hunt talk (recorded server-side) joins the main transcript for scoring.
    await putDoc("vivas", viva.id, {
      bugResult,
      turns: [...(viva.turns ?? []).filter((t) => t.stage !== "bug"), ...(viva.bugTurns ?? [])],
      updatedAt: new Date().toISOString(),
    });
    res.json(pickResult(bugResult));
  } catch (err) {
    console.error("[bughunt:submit]", err);
    res.status(500).json({ error: "We couldn't check your fix just now. Please try submitting again." });
  }
});

function pickResult(r: BugResult) {
  return { result: r.result, reason: r.reason, secondsUsed: r.secondsUsed, timedOut: r.timedOut };
}
