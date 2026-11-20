import { Router } from "express";
import { scoreViva, SCORING_VERSION, type Scores } from "../ai/score.js";
import { getDoc, getRepo, listDocs, putDoc } from "../store.js";
import { ensureGitEvidence, type GitEvidence } from "../ingest/gitEvidence.js";
import { summariseIntegrity, type IntegritySummary } from "../live/integrity.js";
import { BUG_HUNT_SECONDS } from "../ai/bugHunt.js";
import { isVivaLive } from "../live/relay.js";
import { QuotaError } from "../gemini.js";
import { vivaMode, type VivaDoc } from "./viva.js";

export interface ReportDoc extends Scores {
  id: string; // same as the viva id
  vivaId: string;
  repoName: string;
  repoUrl: string;
  owner: string;
  createdAt: string;
  vivaStatus: VivaDoc["status"];
  /** Attempt number for this repo, and how many attempts exist in total. */
  attempt: number;
  totalAttempts: number;
  /** No sign-in yet: the report shows who owns the repo, not who took the viva. */
  identityVerified: false;
  isDemo: boolean;
  /** practice = the student's own training report; assessment = for hiring. */
  mode: "practice" | "assessment";
  git: GitEvidence | null;
  integrity: IntegritySummary;
  questions: { id: string; file: string; line: number; question: string }[];
  bugHunt: null | {
    file: string;
    functionName: string;
    startLine: number;
    taskText: string;
    originalCode: string;
    buggyCode: string;
    studentCode: string | null;
    result: "solved" | "partial" | "not_solved" | "not_attempted";
    reason: string;
    secondsUsed: number;
    timedOut: boolean;
  };
  model: string;
}

export const reportRouter = Router();
const inFlight = new Map<string, Promise<ReportDoc>>();

/** GET /api/report/:id — the shareable report (404 if it hasn't been generated yet). */
reportRouter.get("/report/:id", async (req, res) => {
  const report = await getDoc<ReportDoc>("reports", req.params.id);
  // Missing, or scored under older rules → the page will (re)generate it.
  if (!report || report.scoringVersion !== SCORING_VERSION) return void res.status(404).json({ error: "This report isn't ready yet." });
  res.json(report);
});

/**
 * POST /api/report/:id — score the viva (once) and store the report.
 * NDJSON so the page can show progress: {type:"stage"} … {type:"done", report} | {type:"error"}
 */
reportRouter.post("/report/:id", async (req, res) => {
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  const send = (e: object) => res.write(JSON.stringify(e) + "\n");
  const ping = setInterval(() => send({ type: "ping" }), 10_000);
  try {
    send({ type: "stage", stage: "scoring" });
    const report = await ensureReport(req.params.id);
    send({ type: "done", report });
  } catch (err) {
    const message = err instanceof QuotaError
      ? err.message
      : (err as Error).message?.startsWith("!")
      ? (err as Error).message.slice(1)
      : "We couldn't finish your report just now. Please try again — your answers are safe.";
    send({ type: "error", message });
  } finally {
    clearInterval(ping);
    res.end();
  }
});

function ensureReport(vivaId: string): Promise<ReportDoc> {
  const existing = inFlight.get(vivaId);
  if (existing) return existing;
  const job = (async () => {
    const cached = await getDoc<ReportDoc>("reports", vivaId);
    if (cached && cached.scoringVersion === SCORING_VERSION) return cached; // older rules → re-score

    const viva = await getDoc<VivaDoc>("vivas", vivaId);
    if (!viva) throw new Error("!We couldn't find that viva.");
    const repo = await getRepo(viva.repoId);
    if (!repo?.analysis) throw new Error("!We couldn't find the project for this viva.");

    // Don't freeze a score while the viva or bug hunt is still running.
    if (isVivaLive(vivaId)) {
      throw new Error("!Your viva is still in progress. Finish it first, then open the report.");
    }
    if (viva.status === "live") {
      viva.status = "ended_early"; // no open session: whatever was said is final
      await putDoc("vivas", vivaId, { status: "ended_early" });
    }
    if (viva.bugStartedAt && !viva.bugResult && Date.now() - Date.parse(viva.bugStartedAt) < (BUG_HUNT_SECONDS + 15) * 1000) {
      throw new Error("!Your bug hunt is still running. Submit your fix first, then open the report.");
    }

    const turns = (viva.turns ?? []).filter((t) => t.text?.trim());
    // A viva ended for integrity reasons always gets a report, so the flag is visible to reviewers.
    if (!turns.some((t) => t.role === "student") && !viva.bugResult && !viva.integrity?.terminated) {
      throw new Error("!There's nothing to score yet — answer at least one question in the viva first.");
    }
    // The report reveals the bug hunt's original code, so an unsubmitted bug hunt is closed for good.
    if (viva.bugHunt && !viva.bugResult && !viva.bugClosed) await putDoc("vivas", vivaId, { bugClosed: true });

    const [git, allVivas] = await Promise.all([
      Promise.race([ensureGitEvidence(repo), new Promise<undefined>((r) => setTimeout(() => r(undefined), 12_000))]).catch(() => undefined),
      listDocs<VivaDoc>("vivas"),
    ]);
    const attempts = allVivas.filter((v) => v.repoId === repo.id && vivaMode(v) === vivaMode(viva) && (v.turns?.length ?? 0) > 0);

    const started = Date.now();
    const scores = await scoreViva({
      repoName: viva.repoName,
      analysis: repo.analysis,
      turns,
      hunt: viva.bugHunt,
      bugResult: viva.bugResult,
    });
    console.log(`[report] ${vivaId} scored in ${((Date.now() - started) / 1000).toFixed(1)}s by ${scores.model}`);

    const hunt = viva.bugHunt;
    const result = viva.bugResult;
    const report: ReportDoc = {
      ...scores,
      id: vivaId,
      vivaId,
      repoName: viva.repoName,
      repoUrl: repo.url,
      owner: repo.owner,
      createdAt: new Date().toISOString(),
      vivaStatus: viva.status,
      attempt: viva.attempt ?? 1,
      totalAttempts: Math.max(attempts.length, viva.attempt ?? 1),
      identityVerified: false,
      isDemo: !!repo.isDemo,
      mode: vivaMode(viva),
      git: git ?? null,
      integrity: summariseIntegrity(viva.integrity),
      questions: viva.questions,
      bugHunt: hunt
        ? {
            file: hunt.file,
            functionName: hunt.functionName,
            startLine: hunt.startLine,
            taskText: hunt.taskText,
            originalCode: hunt.originalCode,
            buggyCode: hunt.buggyCode,
            studentCode: result?.studentCode ?? null,
            result: result?.result ?? "not_attempted",
            reason: result?.reason ?? "The bug hunt wasn't attempted.",
            secondsUsed: result?.secondsUsed ?? 0,
            timedOut: result?.timedOut ?? false,
          }
        : null,
    };
    await putDoc("reports", vivaId, report, false);
    return report;
  })();
  inFlight.set(vivaId, job);
  job.catch((err) => console.error("[report]", err)).finally(() => inFlight.delete(vivaId));
  return job;
}
