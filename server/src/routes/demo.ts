import { Router } from "express";
import { ingestToStore, repoIdFor } from "../ingest/ingest.js";
import { ensureGitEvidence } from "../ingest/gitEvidence.js";
import { analyseRepo } from "../ai/analyse.js";
import { generateBugHunt } from "../ai/bugHunt.js";
import { getRepo, getRepoContents, patchRepo, type RepoDoc } from "../store.js";

/**
 * Demo mode: one repo, fully prepared ahead of time (code, questions, bug hunt, git evidence),
 * so a live demo never waits on — or fails because of — GitHub or Gemini text calls.
 * Only the voice conversation itself is live.
 */
export const DEMO_REPO_URL = process.env.DEMO_REPO_URL || "https://github.com/expressjs/express";
const DEMO_PREFIX = "demo__";

let preparing: Promise<RepoDoc> | null = null;

export function ensureDemo(): Promise<RepoDoc> {
  if (preparing) return preparing;
  preparing = (async () => {
    const id = repoIdFor(DEMO_REPO_URL, DEMO_PREFIX);
    let repo = await getRepo(id);
    if (repo?.isDemo && repo.analysis && repo.demoBugHunt) {
      void ensureGitEvidence(repo).catch(() => {}); // refresh git evidence in the background if it failed before
      return repo; // fully cached: instant
    }

    const started = Date.now();
    if (!repo) repo = await ingestToStore(DEMO_REPO_URL, { idPrefix: DEMO_PREFIX });
    const contents = (await getRepoContents(repo.id))!;

    if (!repo.analysis) {
      repo.analysis = await analyseRepo(repo, contents, { onStage: () => {} });
      await patchRepo(repo.id, { analysis: repo.analysis });
    }
    if (!repo.demoBugHunt) {
      repo.demoBugHunt = await generateBugHunt(repo, contents, repo.analysis);
      await patchRepo(repo.id, { demoBugHunt: repo.demoBugHunt });
    }
    await ensureGitEvidence(repo).catch(() => {});
    await patchRepo(repo.id, { isDemo: true });
    console.log(`[demo] ${DEMO_REPO_URL} ready in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    return { ...repo, isDemo: true };
  })();
  // A failed preparation can be retried later.
  preparing.catch((err) => {
    console.error("[demo] preparation failed:", (err as Error).message);
    preparing = null;
  });
  return preparing;
}

export const demoRouter = Router();

/** POST /api/demo → { repoId } — instant once prepared (it's prepared at server start). */
demoRouter.post("/demo", async (_req, res) => {
  try {
    const repo = await ensureDemo();
    void getRepo(repo.id).then((r) => r && ensureGitEvidence(r)).catch(() => {});
    res.json({ repoId: repo.id, repoName: `${repo.owner}/${repo.repo}` });
  } catch {
    res.status(503).json({ error: "The demo project isn't ready yet. Please try again in a moment." });
  }
});
