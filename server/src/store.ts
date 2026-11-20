import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RepoFile } from "./ingest/github.js";
import type { Analysis } from "./ai/analyse.js";
import type { BugHunt } from "./ai/bugHunt.js";
import type { GitEvidence } from "./ingest/gitEvidence.js";

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
  skipped: Record<string, number>;
  files: RepoFile[];
  analysis?: Analysis;
  /** Demo mode: pre-analysed repo with a ready-made bug hunt, so the demo needs no live Gemini text calls. */
  isDemo?: boolean;
  demoBugHunt?: BugHunt;
  /** Ownership evidence from GitHub history. */
  git?: GitEvidence;
}

/** Local JSON storage in server/.data (repos, vivas, reports). */
const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.data");

export const storeKind = "local";

/* ---------- generic documents (vivas, reports) ---------- */

export async function putDoc<T extends object>(collection: string, id: string, data: T, merge = true): Promise<void> {
  const dir = path.join(dataDir, collection);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${safeId(id)}.json`);
  const prev = merge ? await readFile(file, "utf8").then(JSON.parse).catch(() => ({})) : {};
  await writeFile(file, JSON.stringify({ ...prev, ...data }));
}

export async function getDoc<T>(collection: string, id: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path.join(dataDir, collection, `${safeId(id)}.json`), "utf8")) as T;
  } catch {
    return null;
  }
}

export async function saveRepo(doc: RepoDoc, contents: Record<string, string>): Promise<void> {
  await mkdir(path.join(dataDir, "repos"), { recursive: true });
  await writeFile(path.join(dataDir, "repos", `${safeId(doc.id)}.json`), JSON.stringify({ ...doc, contents }));
}

export async function getRepo(id: string): Promise<RepoDoc | null> {
  try {
    const { contents: _c, ...doc } = JSON.parse(await readFile(path.join(dataDir, "repos", `${safeId(id)}.json`), "utf8"));
    return doc as RepoDoc;
  } catch {
    return null;
  }
}

export async function getRepoContents(id: string): Promise<Record<string, string> | null> {
  try {
    return JSON.parse(await readFile(path.join(dataDir, "repos", `${safeId(id)}.json`), "utf8")).contents;
  } catch {
    return null;
  }
}

export async function saveAnalysis(id: string, analysis: Analysis): Promise<void> {
  await patchRepo(id, { analysis });
}

/** Merge fields into a stored repo (analysis, git evidence, demo bug hunt…). */
export async function patchRepo(id: string, patch: Partial<RepoDoc>): Promise<void> {
  const file = path.join(dataDir, "repos", `${safeId(id)}.json`);
  const data = JSON.parse(await readFile(file, "utf8"));
  await writeFile(file, JSON.stringify({ ...data, ...patch }));
}

/** All docs in a collection (small collections only — used by the recruiter view). */
export async function listDocs<T>(collection: string): Promise<T[]> {
  const dir = path.join(dataDir, collection);
  const names = await readdir(dir).catch(() => [] as string[]);
  const docs = await Promise.all(
    names
      .filter((n) => n.endsWith(".json"))
      .map((n) =>
        readFile(path.join(dir, n), "utf8")
          .then((t) => JSON.parse(t) as T)
          .catch(() => null),
      ),
  );
  return docs.filter((d): d is Awaited<T> => d !== null) as T[];
}

function safeId(id: string): string {
  return id.replace(/[^\w.-]/g, "_");
}
