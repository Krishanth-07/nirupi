import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Firestore, WriteBatch } from "firebase-admin/firestore";
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

/**
 * Firestore when FIREBASE_PROJECT_ID is set. Credentials, in order:
 *  1. FIREBASE_SERVICE_ACCOUNT — the service-account JSON (raw or base64). Works on any host,
 *     including free ones, with a Firebase project on the no-billing Spark plan.
 *  2. Application Default Credentials — automatic on Cloud Run.
 * Otherwise a local JSON fallback in server/.data so the app works with zero setup.
 */
const useFirestore = !!process.env.FIREBASE_PROJECT_ID;
const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.data");

function serviceAccountFromEnv(): Record<string, string> | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (!raw) return null;
  const json = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  return JSON.parse(json);
}

let db: Firestore | null = null;
async function firestore(): Promise<Firestore> {
  if (db) return db;
  const { initializeApp, getApps, applicationDefault, cert } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const account = serviceAccountFromEnv();
  if (!getApps().length) {
    initializeApp({ credential: account ? cert(account) : applicationDefault(), projectId: process.env.FIREBASE_PROJECT_ID });
  }
  db = getFirestore();
  // Our records have optional fields (e.g. git.forkOf); Firestore rejects `undefined` unless told to skip it.
  db.settings({ ignoreUndefinedProperties: true });
  return db;
}

export const storeKind = useFirestore ? "firestore" : "local";

/* ---------- generic documents (vivas, reports) ---------- */

export async function putDoc<T extends object>(collection: string, id: string, data: T, merge = true): Promise<void> {
  if (!useFirestore) {
    const dir = path.join(dataDir, collection);
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${safeId(id)}.json`);
    const prev = merge ? await readFile(file, "utf8").then(JSON.parse).catch(() => ({})) : {};
    await writeFile(file, JSON.stringify({ ...prev, ...data }));
    return;
  }
  await (await firestore()).collection(collection).doc(id).set(data, { merge });
}

export async function getDoc<T>(collection: string, id: string): Promise<T | null> {
  if (!useFirestore) {
    try {
      return JSON.parse(await readFile(path.join(dataDir, collection, `${safeId(id)}.json`), "utf8")) as T;
    } catch {
      return null;
    }
  }
  const snap = await (await firestore()).collection(collection).doc(id).get();
  return snap.exists ? (snap.data() as T) : null;
}

export async function saveRepo(doc: RepoDoc, contents: Record<string, string>): Promise<void> {
  if (!useFirestore) {
    await mkdir(path.join(dataDir, "repos"), { recursive: true });
    await writeFile(path.join(dataDir, "repos", `${doc.id}.json`), JSON.stringify({ ...doc, contents }));
    return;
  }
  const fs = await firestore();
  const repoRef = fs.collection("repos").doc(doc.id);
  // Contents live in a subcollection: one doc per file keeps us far under Firestore's 1 MiB doc limit.
  const old = await repoRef.collection("files").listDocuments();
  const writes: ((b: WriteBatch) => void)[] = [
    ...old.map((d) => (b: WriteBatch) => b.delete(d)),
    (b) => b.set(repoRef, doc),
    ...Object.entries(contents).map(([p, content]) => (b: WriteBatch) =>
      b.set(repoRef.collection("files").doc(encodeURIComponent(p)), { path: p, content }),
    ),
  ];
  for (let i = 0; i < writes.length; i += 400) {
    const batch = fs.batch();
    writes.slice(i, i + 400).forEach((w) => w(batch));
    await batch.commit();
  }
}

export async function getRepo(id: string): Promise<RepoDoc | null> {
  if (!useFirestore) {
    try {
      const { contents: _c, ...doc } = JSON.parse(await readFile(path.join(dataDir, "repos", `${safeId(id)}.json`), "utf8"));
      return doc as RepoDoc;
    } catch {
      return null;
    }
  }
  const snap = await (await firestore()).collection("repos").doc(id).get();
  return snap.exists ? (snap.data() as RepoDoc) : null;
}

export async function getRepoContents(id: string): Promise<Record<string, string> | null> {
  if (!useFirestore) {
    try {
      return JSON.parse(await readFile(path.join(dataDir, "repos", `${safeId(id)}.json`), "utf8")).contents;
    } catch {
      return null;
    }
  }
  const snaps = await (await firestore()).collection("repos").doc(id).collection("files").get();
  if (snaps.empty) return null;
  return Object.fromEntries(snaps.docs.map((d) => [d.get("path") as string, d.get("content") as string]));
}

export async function saveAnalysis(id: string, analysis: Analysis): Promise<void> {
  await patchRepo(id, { analysis });
}

/** Merge fields into a stored repo (analysis, git evidence, demo bug hunt…). */
export async function patchRepo(id: string, patch: Partial<RepoDoc>): Promise<void> {
  if (!useFirestore) {
    const file = path.join(dataDir, "repos", `${safeId(id)}.json`);
    const data = JSON.parse(await readFile(file, "utf8"));
    await writeFile(file, JSON.stringify({ ...data, ...patch }));
    return;
  }
  await (await firestore()).collection("repos").doc(id).update(patch);
}

/** All docs in a collection (small collections only — used by the recruiter view). */
export async function listDocs<T>(collection: string): Promise<T[]> {
  if (!useFirestore) {
    const { readdir } = await import("node:fs/promises");
    const dir = path.join(dataDir, collection);
    const names = await readdir(dir).catch(() => [] as string[]);
    const docs = await Promise.all(
      names.filter((n) => n.endsWith(".json")).map((n) => readFile(path.join(dir, n), "utf8").then((t) => JSON.parse(t) as T).catch(() => null)),
    );
    return docs.filter((d): d is Awaited<T> => d !== null) as T[];
  }
  const snap = await (await firestore()).collection(collection).limit(500).get();
  return snap.docs.map((d) => d.data() as T);
}

function safeId(id: string): string {
  return id.replace(/[^\w.-]/g, "_");
}
