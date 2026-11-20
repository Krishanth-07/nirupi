export interface RepoFile {
  path: string;
  size: number;
  lines: number;
  language: string;
}

export interface Question {
  id: string;
  file: string;
  line: number;
  question: string;
  goodAnswerCovers: string[];
  excerpt: { startLine: number; code: string };
}

export interface Analysis {
  summary: string;
  techStack: string[];
  keyFiles: { path: string; why: string }[];
  questions: Question[];
  model: string;
  createdAt: string;
}

export interface RepoDoc {
  id: string;
  url: string;
  owner: string;
  repo: string;
  ref: string;
  ingestedAt: string;
  fileCount: number;
  totalBytes: number;
  languages: { name: string; bytes: number }[];
  skipped: { ignored: number; tooLarge: number; binary: number; overCap: number };
  files: RepoFile[];
  analysis?: Analysis;
  isDemo?: boolean;
}

export type IngestEvent =
  | { type: "stage"; stage: "download"; bytes: number }
  | { type: "stage"; stage: "read"; files: number }
  | { type: "stage"; stage: "save" }
  | { type: "done"; repo: RepoDoc }
  | { type: "error"; message: string };

export type AnalyseEvent =
  | { type: "stage"; stage: "map" | "questions" }
  | { type: "notice"; message: string }
  | { type: "ping" }
  | { type: "done"; analysis: Analysis }
  | { type: "error"; message: string };

type Streamed = { type: string } | { type: "error"; message: string };

/** POSTs and reads an NDJSON progress stream. Resolves with the final "done" event. */
async function streamNdjson<E extends Streamed>(
  url: string,
  body: unknown,
  onEvent: (e: E) => void,
  signal?: AbortSignal,
): Promise<Extract<E, { type: "done" }>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
    signal,
  });
  if (!res.ok || !res.body) throw new Error("We couldn't reach Nirupi. Check your connection and try again.");

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const event = JSON.parse(line) as E;
      onEvent(event);
      if (event.type === "error") throw new Error((event as { message: string }).message);
      if (event.type === "done") return event as Extract<E, { type: "done" }>;
    }
  }
  throw new Error("The connection closed before we finished. Please try again.");
}

/** Step 2: download + filter + store the repo. */
export async function ingestRepo(url: string, onEvent: (e: IngestEvent) => void, signal?: AbortSignal): Promise<RepoDoc> {
  return (await streamNdjson<IngestEvent>("/api/repo", { url }, onEvent, signal)).repo;
}

/** Step 3: Gemini code map + 3 questions. */
export async function analyseRepo(id: string, onEvent: (e: AnalyseEvent) => void, signal?: AbortSignal): Promise<Analysis> {
  return (await streamNdjson<AnalyseEvent>(`/api/repo/${encodeURIComponent(id)}/analyse`, {}, onEvent, signal)).analysis;
}

/* ---------------- Step 4: live viva ---------------- */

export interface VivaStart {
  vivaId: string;
  repoName: string;
  attempt: number;
  questions: { id: string; file: string; line: number; excerpt: { startLine: number; code: string } }[];
}

export async function startViva(repoId: string): Promise<VivaStart> {
  const res = await fetch("/api/viva", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repoId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "We couldn't start your viva. Please try again.");
  return body as VivaStart;
}

/** Voice relay URL. The server holds the Gemini session and records the transcript itself. */
export const liveRelayPath = (vivaId: string, mode: "viva" | "bug") =>
  `/api/live?vivaId=${encodeURIComponent(vivaId)}&mode=${mode}`;

/* ---------------- Demo mode ---------------- */

export async function startDemo(): Promise<{ repoId: string; repoName: string }> {
  const res = await fetch("/api/demo", { method: "POST" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "The demo project isn't ready yet. Please try again in a moment.");
  return body;
}

export async function getRepoDoc(id: string, signal?: AbortSignal): Promise<RepoDoc> {
  const res = await fetch(`/api/repo/${encodeURIComponent(id)}`, { signal });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "We couldn't find that project.");
  return body as RepoDoc;
}

/* ---------------- Step 5: bug hunt ---------------- */

export type BugResultKind = "solved" | "partial" | "not_solved";

export interface BugHuntResult {
  result: BugResultKind;
  reason: string;
  secondsUsed: number;
  timedOut: boolean;
}

export interface BugHuntTask {
  file: string;
  functionName: string;
  startLine: number;
  /** null until the bug hunt has started on the server. */
  buggyCode: string | null;
  taskText: string;
  durationSec: number;
  repoName: string;
  /** Server time the 3 minutes started (null until started). */
  startedAt: string | null;
  /** Closed because the report was generated before submitting. */
  closed: boolean;
  /** Present if this bug hunt was already submitted. */
  result: BugHuntResult | null;
}

export async function getBugHunt(vivaId: string, signal?: AbortSignal): Promise<BugHuntTask> {
  const res = await fetch(`/api/viva/${encodeURIComponent(vivaId)}/bughunt`, { signal });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "We couldn't prepare your bug hunt. Please try again.");
  return body as BugHuntTask;
}

/** Starts the clock on the server. Returns the server's start time and current time (to correct clock skew). */
export async function startBugHunt(
  vivaId: string,
): Promise<{ startedAt: string; serverNow: string; durationSec: number; buggyCode: string }> {
  const res = await fetch(`/api/viva/${encodeURIComponent(vivaId)}/bughunt/start`, { method: "POST" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "We couldn't start the bug hunt.");
  return body;
}

export async function submitBugHunt(vivaId: string, code: string): Promise<BugHuntResult> {
  const res = await fetch(`/api/viva/${encodeURIComponent(vivaId)}/bughunt/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "We couldn't check your fix. Please try again.");
  return body as BugHuntResult;
}

/* ---------------- Recruiter view ---------------- */

export interface CandidateRow {
  id: string;
  status: "scored" | "unscored";
  repoName: string;
  owner: string;
  createdAt: string;
  technical: number | null;
  communication: number | null;
  ownership: "strong" | "moderate" | "weak" | null;
  bug: BugResultKind | "not_attempted";
  answered: number | null;
  attempt: number;
  totalAttempts: number | null;
  isDemo: boolean;
  git: { ownerShare: number | null; isFork: boolean; commits: number | null } | null;
  flags: string[];
  stale: boolean;
}

export async function getCandidates(key: string): Promise<{ open: boolean; candidates: CandidateRow[] }> {
  const res = await fetch("/api/recruiter/candidates", { headers: key ? { "x-recruiter-key": key } : {} });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) throw Object.assign(new Error(body.error || "That access key isn't right."), { unauthorised: true });
  if (!res.ok) throw new Error(body.error || "We couldn't load candidates.");
  return body;
}
/* ---------------- Step 6: report ---------------- */

export interface Report {
  id: string;
  vivaId: string;
  repoName: string;
  repoUrl: string;
  owner: string;
  createdAt: string;
  vivaStatus: "live" | "completed" | "ended_early";
  attempt: number;
  totalAttempts: number;
  identityVerified: false;
  isDemo: boolean;
  git: GitEvidence | null;
  integrity: IntegritySummary;
  skills: { name: string; score0to10: number; evidence: string }[];
  technicalScore0to100: number;
  communicationScore0to100: number;
  ownershipVerdict: "strong" | "moderate" | "weak";
  highlights: string[];
  concerns: string[];
  englishTranscript: { speaker: "Nirupi" | "Student"; stage: string; text: string }[];
  perQuestion: { id: string; answered: boolean; score0to10: number; evidence: string; note: string }[];
  questions: { id: string; file: string; line: number; question: string }[];
  bugHunt: null | {
    file: string;
    functionName: string;
    startLine: number;
    taskText: string;
    originalCode: string;
    buggyCode: string;
    studentCode: string | null;
    result: BugResultKind | "not_attempted";
    reason: string;
    secondsUsed: number;
    timedOut: boolean;
  };
  model: string;
}

export type ReportEvent = { type: "stage"; stage: string } | { type: "ping" } | { type: "done"; report: Report } | { type: "error"; message: string };

/** Returns null if the report hasn't been generated yet. */
export async function getReport(id: string, signal?: AbortSignal): Promise<Report | null> {
  const res = await fetch(`/api/report/${encodeURIComponent(id)}`, { signal });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("We couldn't load this report. Please try again.");
  return (await res.json()) as Report;
}

export async function generateReport(id: string, signal?: AbortSignal): Promise<Report> {
  return (await streamNdjson<ReportEvent>(`/api/report/${encodeURIComponent(id)}`, {}, () => {}, signal)).report;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export interface GitEvidence {
  available: boolean;
  reason?: string;
  ownerLogin: string;
  ownerIsOrg: boolean;
  isFork: boolean;
  forkOf?: string;
  createdAt?: string;
  totalCommits?: number;
  ownerCommits?: number;
  ownerCommitShare?: number;
  contributors?: { login: string; commits: number }[];
  firstCommitAt?: string;
  lastCommitAt?: string;
  activeDays?: number;
  snapshotSha?: string;
  files?: { path: string; commits: number; ownerCommits: number; authors: string[] }[];
  flags: string[];
}

export interface IntegritySummary {
  tabSwitches: number;
  secondsAway: number;
  windowBlurs: number;
  fullscreenExits: number;
  pasteAttempts: number;
  copyAttempts: number;
  reconnects: number;
  answerDelays: Record<string, number>;
  flags: string[];
}