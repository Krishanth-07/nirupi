import { patchRepo, type RepoDoc } from "../store.js";

/**
 * Ownership evidence from GitHub history — independent of what the student says.
 * Uses the public REST API (60 req/hour without a token; set GITHUB_TOKEN for 5,000/hour).
 * Every finding is phrased neutrally: it's evidence for a human, never an accusation.
 */

export interface GitEvidence {
  available: boolean;
  reason?: string; // why it isn't available (rate limit, private repo…)
  fetchedAt: string;
  ownerLogin: string;
  ownerIsOrg: boolean;
  isFork: boolean;
  forkOf?: string;
  createdAt?: string;
  totalCommits?: number;
  ownerCommits?: number;
  ownerCommitShare?: number; // 0..1
  contributors?: { login: string; commits: number }[];
  firstCommitAt?: string;
  lastCommitAt?: string;
  activeDays?: number; // distinct days with commits (among the latest 100)
  snapshotSha?: string; // the commit we examined
  files?: { path: string; commits: number; ownerCommits: number; authors: string[] }[];
  flags: string[];
}

const API = "https://api.github.com";

/**
 * Returns stored evidence, or fetches it if it's missing / previously failed (e.g. rate limit)
 * and a couple of minutes have passed. Saves the result on the repo.
 */
export async function ensureGitEvidence(repo: RepoDoc): Promise<GitEvidence | undefined> {
  const stale = !repo.git || (!repo.git.available && Date.now() - Date.parse(repo.git.fetchedAt) > 2 * 60_000);
  if (!stale || !repo.analysis) return repo.git;
  const git = await fetchGitEvidence(repo.owner, repo.repo, repo.analysis.questions.map((q) => q.file));
  // Keep an older successful result rather than replacing it with a failure.
  if (git.available || !repo.git?.available) {
    await patchRepo(repo.id, { git });
    repo.git = git;
  }
  return repo.git;
}

/** Set when GitHub rejects the token (expired/revoked): fall back to anonymous access instead of failing. */
let tokenRejected = false;

async function gh<T>(path: string): Promise<{ data: T; link: string | null }> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "nirupi-viva",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN && !tokenRejected) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  let res = await fetch(API + path, { headers, signal: AbortSignal.timeout(10_000) });
  if (res.status === 401 && headers.Authorization) {
    tokenRejected = true;
    console.warn("[git] GITHUB_TOKEN was rejected (expired or revoked); using anonymous GitHub access (60 requests/hour)");
    delete headers.Authorization;
    res = await fetch(API + path, { headers, signal: AbortSignal.timeout(10_000) });
  }
  if (res.status === 403 || res.status === 429) throw new Error("GitHub's rate limit was reached");
  if (res.status === 404) throw new Error("the repo isn't visible on GitHub's API");
  if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
  return { data: (await res.json()) as T, link: res.headers.get("link") };
}

/** Page number of rel="last" in a Link header (= total count when per_page=1). */
function lastPage(link: string | null): number | null {
  const m = link?.match(/[?&]page=(\d+)[^>]*>;\s*rel="last"/);
  return m ? Number(m[1]) : null;
}

interface CommitItem {
  sha: string;
  author: { login: string } | null;
  commit: { author: { date: string; name: string } };
}

export async function fetchGitEvidence(owner: string, repo: string, files: string[]): Promise<GitEvidence> {
  const questionedFiles = [...new Set(files)];
  const base: GitEvidence = { available: false, fetchedAt: new Date().toISOString(), ownerLogin: owner, ownerIsOrg: false, isFork: false, flags: [] };
  const R = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const isOwner = (login?: string | null) => !!login && login.toLowerCase() === owner.toLowerCase();

  try {
    const info = (await gh<{ fork: boolean; parent?: { full_name: string }; created_at: string; owner: { login: string; type: string } }>(R)).data;
    const ev: GitEvidence = {
      ...base,
      available: true,
      ownerLogin: info.owner.login,
      ownerIsOrg: info.owner.type === "Organization",
      isFork: info.fork,
      forkOf: info.parent?.full_name,
      createdAt: info.created_at,
    };

    // Latest commit (snapshot) + total commit count via pagination trick.
    const latest = await gh<CommitItem[]>(`${R}/commits?per_page=1`);
    ev.snapshotSha = latest.data[0]?.sha;
    ev.lastCommitAt = latest.data[0]?.commit.author.date;
    ev.totalCommits = lastPage(latest.link) ?? latest.data.length;
    if (ev.totalCommits > 1) {
      const first = await gh<CommitItem[]>(`${R}/commits?per_page=1&page=${ev.totalCommits}`);
      ev.firstCommitAt = first.data[0]?.commit.author.date;
    } else {
      ev.firstCommitAt = ev.lastCommitAt;
    }

    const [contributors, recent, ...fileCommits] = await Promise.all([
      gh<{ login?: string; name?: string; contributions: number }[]>(`${R}/contributors?per_page=100&anon=1`).then((r) => r.data).catch(() => []),
      gh<CommitItem[]>(`${R}/commits?per_page=100`).then((r) => r.data).catch(() => [] as CommitItem[]),
      ...questionedFiles.map((p) =>
        gh<CommitItem[]>(`${R}/commits?per_page=100&path=${encodeURIComponent(p)}`)
          .then((r) => r.data)
          .catch(() => [] as CommitItem[]),
      ),
    ]);

    ev.contributors = contributors.slice(0, 8).map((c) => ({ login: c.login ?? c.name ?? "anonymous", commits: c.contributions }));
    const totalFromContrib = contributors.reduce((s, c) => s + c.contributions, 0);
    ev.ownerCommits = contributors.filter((c) => isOwner(c.login)).reduce((s, c) => s + c.contributions, 0);
    ev.ownerCommitShare = totalFromContrib ? ev.ownerCommits / totalFromContrib : undefined;
    ev.activeDays = new Set(recent.map((c) => c.commit.author.date.slice(0, 10))).size;
    ev.files = questionedFiles.map((p, i) => {
      const list = fileCommits[i] ?? [];
      const authors = [...new Set(list.map((c) => c.author?.login ?? c.commit.author.name))];
      return { path: p, commits: list.length, ownerCommits: list.filter((c) => isOwner(c.author?.login)).length, authors };
    });

    // Neutral, factual flags for the reviewer.
    if (ev.isFork) ev.flags.push(`This repo is a fork${ev.forkOf ? ` of ${ev.forkOf}` : ""}; some code may come from the original project.`);
    if (ev.ownerIsOrg) ev.flags.push("The repo belongs to an organisation, so individual authorship can't be inferred from ownership.");
    else if (ev.ownerCommitShare !== undefined && ev.ownerCommitShare < 0.5)
      ev.flags.push(`The repo owner made ${Math.round(ev.ownerCommitShare * 100)}% of the commits.`);
    if ((ev.totalCommits ?? 0) <= 3) ev.flags.push(`Short history: ${ev.totalCommits} commit${ev.totalCommits === 1 ? "" : "s"} in total, so the code may have been added in one go.`);
    for (const f of ev.files) {
      if (!ev.ownerIsOrg && f.commits > 0 && f.ownerCommits === 0) ev.flags.push(`No commits to ${f.path.split("/").pop()} were made by the repo owner.`);
    }
    return ev;
  } catch (err) {
    return { ...base, reason: (err as Error).message };
  }
}
