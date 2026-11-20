import { downloadZip, extractSources, IngestError, parseGitHubUrl } from "./github.js";
import { saveRepo, type RepoDoc } from "../store.js";

export type IngestProgress =
  | { stage: "download"; bytes: number }
  | { stage: "read"; files: number }
  | { stage: "save" };

/** Stable storage id for a repo URL (optionally namespaced, e.g. "demo__"). */
export function repoIdFor(url: string, prefix = ""): string {
  const ref = parseGitHubUrl(url);
  return prefix + `${ref.owner}__${ref.repo}${ref.ref === "HEAD" ? "" : "__" + ref.ref}`.toLowerCase().replace(/[^\w.-]/g, "_");
}

/** Download a public repo, keep only source files, and store it. Shared by /api/repo and demo mode. */
export async function ingestToStore(
  url: string,
  opts: { idPrefix?: string; onProgress?: (p: IngestProgress) => void } = {},
): Promise<RepoDoc> {
  const progress = opts.onProgress ?? (() => {});
  const ref = parseGitHubUrl(url);
  progress({ stage: "download", bytes: 0 });
  const zip = await downloadZip(ref, (bytes) => progress({ stage: "download", bytes }));

  const result = extractSources(zip);
  if (result.files.length === 0) {
    throw new IngestError("We couldn't find any source code in that repo. Is it the right one?", 422);
  }
  progress({ stage: "read", files: result.files.length });

  const doc: RepoDoc = {
    id: repoIdFor(url, opts.idPrefix),
    url: ref.url,
    owner: ref.owner,
    repo: ref.repo,
    ref: ref.ref,
    ingestedAt: new Date().toISOString(),
    fileCount: result.files.length,
    totalBytes: result.totalBytes,
    languages: result.languages,
    skipped: result.skipped,
    files: result.files,
  };
  progress({ stage: "save" });
  await saveRepo(doc, result.contents);
  return doc;
}
