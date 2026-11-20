import { unzipSync } from "fflate";
import { classify, priority, MAX_TOTAL_BYTES, MAX_ZIP_BYTES, type SkipReason } from "./filters.js";

export interface RepoRef {
  owner: string;
  repo: string;
  ref: string; // branch / tag / sha, or HEAD for the default branch
  url: string;
}

export interface RepoFile {
  path: string;
  size: number;
  lines: number;
  language: string;
}

export interface IngestResult {
  files: RepoFile[];
  contents: Record<string, string>;
  totalBytes: number;
  languages: { name: string; bytes: number }[];
  skipped: Record<SkipReason, number>;
}

export class IngestError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** Accepts github.com/owner/repo, with optional https://, .git, or /tree/<branch>. */
export function parseGitHubUrl(input: string): RepoRef {
  const m = input
    .trim()
    .match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/([^?#]+))?\/?(?:[?#].*)?$/i);
  if (!m) throw new IngestError("That doesn't look like a GitHub repo link. Try github.com/you/your-project");
  const [, owner, repo, ref] = m;
  return { owner, repo, ref: ref ? decodeURIComponent(ref) : "HEAD", url: `https://github.com/${owner}/${repo}` };
}

/** Streams the zipball, reporting bytes as they arrive. Public repos only. */
export async function downloadZip(ref: RepoRef, onProgress: (bytes: number) => void): Promise<Uint8Array> {
  const zipUrl = `https://codeload.github.com/${ref.owner}/${ref.repo}/zip/${encodeURIComponent(ref.ref).replace(/%2F/g, "/")}`;
  const headers: Record<string, string> = { "User-Agent": "nirupi-ingest" };
  const res = await fetch(zipUrl, { headers, redirect: "follow" });
  if (res.status === 404) {
    throw new IngestError("We couldn't find that repo. Check the link, and make sure the repo is public.", 404);
  }
  if (!res.ok || !res.body) throw new IngestError(`GitHub didn't send the repo (status ${res.status}). Please try again.`, 502);

  const chunks: Uint8Array[] = [];
  let received = 0;
  let lastReport = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_ZIP_BYTES) {
      await reader.cancel();
      throw new IngestError("This repo is too large for a viva (over 80 MB). Try a smaller project or a specific branch.", 413);
    }
    chunks.push(value);
    if (received - lastReport > 256 * 1024) {
      lastReport = received;
      onProgress(received);
    }
  }
  onProgress(received);

  const out = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** Unzips, keeps only real source files, and caps the total at ~500 KB (most important files first). */
export function extractSources(zip: Uint8Array): IngestResult {
  const skipped: Record<SkipReason, number> = { ignored: 0, tooLarge: 0, binary: 0, overCap: 0 };
  const candidates = new Map<string, string>(); // zip entry name → language

  const entries = unzipSync(zip, {
    filter: (f) => {
      if (f.name.endsWith("/")) return false; // directory
      const rel = stripRoot(f.name);
      if (!rel) return false;
      const c = classify(rel, f.originalSize);
      if (!c.keep) {
        skipped[c.reason]++;
        return false;
      }
      candidates.set(f.name, c.language);
      return true;
    },
  });

  const decoder = new TextDecoder("utf-8", { fatal: false });
  const readable: { path: string; text: string; size: number; language: string }[] = [];
  for (const [name, bytes] of Object.entries(entries)) {
    if (bytes.includes(0)) {
      skipped.binary++; // has NUL bytes → not text, whatever the extension says
      continue;
    }
    readable.push({ path: stripRoot(name), text: decoder.decode(bytes), size: bytes.byteLength, language: candidates.get(name)! });
  }

  readable.sort((a, b) => priority(a.path, a.language) - priority(b.path, b.language) || a.size - b.size);

  const files: RepoFile[] = [];
  const contents: Record<string, string> = {};
  const langBytes = new Map<string, number>();
  let totalBytes = 0;
  for (const f of readable) {
    if (totalBytes + f.size > MAX_TOTAL_BYTES) {
      skipped.overCap++;
      continue;
    }
    totalBytes += f.size;
    contents[f.path] = f.text;
    files.push({ path: f.path, size: f.size, lines: f.text.split("\n").length, language: f.language });
    langBytes.set(f.language, (langBytes.get(f.language) ?? 0) + f.size);
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  const languages = [...langBytes].map(([name, bytes]) => ({ name, bytes })).sort((a, b) => b.bytes - a.bytes);
  return { files, contents, totalBytes, languages, skipped };
}

/** GitHub zips wrap everything in "<repo>-<ref>/". */
function stripRoot(name: string): string {
  const i = name.indexOf("/");
  return i === -1 ? "" : name.slice(i + 1);
}
