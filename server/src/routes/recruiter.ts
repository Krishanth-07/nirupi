import { Router, type Request } from "express";
import { timingSafeEqual } from "node:crypto";
import { listDocs } from "../store.js";
import type { ReportDoc } from "./report.js";
import type { VivaDoc } from "./viva.js";
import { SCORING_VERSION } from "../ai/score.js";

/**
 * Recruiter view: every candidate in one list. Protected by RECRUITER_KEY (header or ?key=).
 * If no key is configured (local dev / demo), access is open and the UI says so loudly.
 */
export const recruiterRouter = Router();

function authorised(req: Request): boolean {
  const expected = process.env.RECRUITER_KEY;
  if (!expected) return true;
  const given = String(req.get("x-recruiter-key") ?? req.query.key ?? "");
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

recruiterRouter.get("/recruiter/candidates", async (req, res) => {
  if (!authorised(req)) return void res.status(401).json({ error: "That access key isn't right." });

  const [reports, vivas] = await Promise.all([listDocs<ReportDoc>("reports"), listDocs<VivaDoc>("vivas")]);
  const reported = new Set(reports.map((r) => r.id));

  const rows = reports
    .filter((r) => r.scoringVersion === SCORING_VERSION || r.technicalScore0to100 !== undefined)
    .map((r) => ({
      id: r.id,
      status: "scored" as const,
      repoName: r.repoName,
      owner: r.owner,
      createdAt: r.createdAt,
      technical: r.technicalScore0to100,
      communication: r.communicationScore0to100,
      ownership: r.ownershipVerdict,
      bug: r.bugHunt?.result ?? "not_attempted",
      answered: r.perQuestion?.filter((q) => q.answered).length ?? null,
      attempt: r.attempt ?? 1,
      totalAttempts: r.totalAttempts ?? 1,
      isDemo: !!r.isDemo,
      git: r.git?.available
        ? { ownerShare: r.git.ownerCommitShare ?? null, isFork: r.git.isFork, commits: r.git.totalCommits ?? null }
        : null,
      flags: [...(r.integrity?.flags ?? []), ...(r.git?.flags ?? [])],
      integrity: r.integrity?.status ?? null,
      stale: r.scoringVersion !== SCORING_VERSION,
    }));

  // Finished vivas that haven't been scored yet — opening them generates the report.
  const pendingRows = vivas
    .filter((v) => !reported.has(v.id) && v.status !== "live" && (v.turns ?? []).some((t) => t.role === "student"))
    .map((v) => ({
      id: v.id,
      status: "unscored" as const,
      repoName: v.repoName,
      owner: v.repoName.split("/")[0],
      createdAt: v.updatedAt,
      technical: null,
      communication: null,
      ownership: null,
      bug: v.bugResult?.result ?? "not_attempted",
      answered: null,
      attempt: v.attempt ?? 1,
      totalAttempts: null,
      isDemo: v.repoId.startsWith("demo__"),
      git: null,
      flags: [],
      integrity: v.integrity?.terminated ? ("flagged" as const) : null,
      stale: false,
    }));

  res.json({
    open: !process.env.RECRUITER_KEY,
    candidates: [...rows, ...pendingRows].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
  });
});
