import { Router } from "express";
import { IngestError } from "../ingest/github.js";
import { ingestToStore } from "../ingest/ingest.js";
import { getRepo, getRepoContents, patchRepo, saveAnalysis } from "../store.js";
import { fetchGitEvidence } from "../ingest/gitEvidence.js";
import { analyseRepo, publicAnalysis } from "../ai/analyse.js";
import { QuotaError } from "../gemini.js";

export const repoRouter = Router();

/**
 * POST /api/repo { url }
 * Streams progress as NDJSON so the UI can show real steps:
 *   {type:"stage", stage:"download", bytes}
 *   {type:"stage", stage:"read", files}
 *   {type:"stage", stage:"save"}
 *   {type:"done", repo}
 *   {type:"error", message}
 */
repoRouter.post("/repo", async (req, res) => {
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  const send = (event: object) => res.write(JSON.stringify(event) + "\n");

  try {
    const doc = await ingestToStore(String(req.body?.url ?? ""), {
      onProgress: (p) => send({ type: "stage", ...p }),
    });
    send({ type: "done", repo: doc });
  } catch (err) {
    const message =
      err instanceof IngestError ? err.message : "Something went wrong while reading your repo. Please try again.";
    if (!(err instanceof IngestError)) console.error("[repo]", err);
    send({ type: "error", message });
  } finally {
    res.end();
  }
});

/**
 * POST /api/repo/:id/analyse
 * Gemini reads the stored code and returns the code map + 3 questions. NDJSON:
 *   {type:"stage", stage:"map" | "questions"}
 *   {type:"notice", message}   (e.g. Gemini busy, retrying)
 *   {type:"ping"}              (heartbeat every 10s)
 *   {type:"done", analysis}
 *   {type:"error", message}
 */
repoRouter.post("/repo/:id/analyse", async (req, res) => {
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  const send = (event: object) => res.write(JSON.stringify(event) + "\n");

  try {
    const [repo, contents] = await Promise.all([getRepo(req.params.id), getRepoContents(req.params.id)]);
    if (!repo || !contents) throw new IngestError("We couldn't find that project. Try connecting it again.", 404);

    // Stop paying for Gemini if the browser goes away (tab closed, React dev double-mount, etc.).
    const abort = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) abort.abort();
    });

    const started = Date.now();
    // Heartbeat so proxies/browsers never see an idle connection while Gemini thinks.
    const ping = setInterval(() => send({ type: "ping" }), 10_000);
    res.on("close", () => clearInterval(ping));

    const analysis = await analyseRepo(repo, contents, {
      onStage: (stage) => send({ type: "stage", stage }),
      onNotice: (message) => send({ type: "notice", message }),
      signal: abort.signal,
    });
    console.log(`[analyse] ${repo.id} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    await saveAnalysis(repo.id, analysis);
    send({ type: "done", analysis: publicAnalysis(analysis, { showQuestions: !!repo.isDemo }) });
    // Ownership evidence from GitHub history, collected in the background for the report.
    void fetchGitEvidence(repo.owner, repo.repo, analysis.questions.map((q) => q.file))
      .then((git) => patchRepo(repo.id, { git }))
      .catch(() => {});
  } catch (err) {
    if (res.destroyed) return void console.log("[analyse] client left; stopped");
    console.error("[analyse]", err);
    send({
      type: "error",
      message:
        err instanceof IngestError || err instanceof QuotaError
          ? err.message
          : "We couldn't prepare your questions this time. Please try again — it usually works on a second go.",
    });
  } finally {
    res.end();
  }
});

/** GET /api/repo/:id — metadata + file list (no contents). */
repoRouter.get("/repo/:id", async (req, res) => {
  const doc = await getRepo(req.params.id);
  if (!doc) return void res.status(404).json({ error: "We couldn't find that project. Try connecting it again." });
  // Never send expected answers, the demo's ready-made bug hunt, or (for real vivas) question wording.
  const { demoBugHunt: _hunt, analysis, ...rest } = doc;
  res.json({ ...rest, analysis: analysis ? publicAnalysis(analysis, { showQuestions: !!doc.isDemo }) : undefined });
});
