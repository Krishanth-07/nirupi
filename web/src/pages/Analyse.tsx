import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, FolderGit2, RotateCcw } from "lucide-react";
import { Logo } from "../components/ui/Logo";
import { Button } from "../components/ui/Button";
import { Cite } from "../components/ui/Cite";
import { ExamRules } from "../components/viva/ExamRules";
import { analyseRepo, formatBytes, getRepoDoc, ingestRepo, type Analysis, type RepoDoc } from "../lib/api";
type StageId = "download" | "read" | "save" | "map" | "questions";
const STAGES: StageId[] = ["download", "read", "save", "map", "questions"];
const MIN_STAGE_MS = 650; // keep each real step on screen long enough to read

interface Progress {
  stage: StageId;
  bytes: number;
  files: number;
  mapStartedAt: number | null;
  notice: string | null;
}

const initialProgress: Progress = { stage: "download", bytes: 0, files: 0, mapStartedAt: null, notice: null };

export default function Analyse() {
  const [params] = useSearchParams();
  const url = params.get("repo") ?? "";
  /** An already-analysed project (demo mode) opens straight to the ready screen. */
  const repoIdParam = params.get("repoId");
  const navigate = useNavigate();
  const [progress, setProgress] = useState<Progress>(initialProgress);
  const [repo, setRepo] = useState<RepoDoc | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const repoRef = useRef<RepoDoc | null>(null); // survives retries so we don't re-download

  const run = useCallback(
    async (signal: AbortSignal) => {
      setError(null);
      setAnalysis(null);

      // Stage changes are played back with a short minimum dwell so fast steps stay readable.
      let shownAt = performance.now();
      let chain = Promise.resolve();
      const show = (patch: Partial<Progress>) => {
        chain = chain.then(async () => {
          const wait = MIN_STAGE_MS - (performance.now() - shownAt);
          if (wait > 0) await new Promise((r) => setTimeout(r, wait));
          shownAt = performance.now();
          if (!signal.aborted) setProgress((p) => ({ ...p, ...patch }));
        });
        return chain;
      };

      try {
        if (repoIdParam && !repoRef.current) {
          const existing = await getRepoDoc(repoIdParam, signal);
          repoRef.current = existing;
          setRepo(existing);
          if (existing.analysis) {
            setAnalysis(existing.analysis);
            return;
          }
        }
        let doc = repoRef.current;
        if (!doc) {
          setProgress(initialProgress);
          doc = await ingestRepo(
            url,
            (e) => {
              if (e.type !== "stage") return;
              if (e.stage === "download") setProgress((p) => ({ ...p, bytes: e.bytes })); // live counter, no dwell
              else if (e.stage === "read") void show({ stage: "read", files: e.files });
              else void show({ stage: "save" });
            },
            signal,
          );
          repoRef.current = doc;
          setRepo(doc);
        } else {
          setProgress((p) => ({ ...p, stage: "map", files: doc!.fileCount }));
        }

        const result = await analyseRepo(
          doc.id,
          (e) => {
            if (e.type === "notice") setProgress((p) => ({ ...p, notice: e.message }));
            if (e.type !== "stage") return;
            if (e.stage === "map") void show({ stage: "map", mapStartedAt: Date.now() });
            else void show({ stage: "questions", notice: null });
          },
          signal,
        );
        await chain;
        await show({});
        if (!signal.aborted) setAnalysis(result);
      } catch (err) {
        if (signal.aborted) return;
        await chain;
        setError((err as Error).message || "Something went wrong. Please try again.");
      }
    },
    [url, repoIdParam],
  );

  useEffect(() => {
    if (!url && !repoIdParam) return;
    const ctrl = new AbortController();
    void run(ctrl.signal);
    return () => ctrl.abort();
  }, [url, repoIdParam, attempt, run]);

  const repoName = url.replace(/^(https?:\/\/)?(www\.)?github\.com\//i, "").replace(/\/$/, "");

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-[1100px] items-center justify-between px-4 py-5 sm:px-6">
        <Logo />
        {(url || repo) && (
          <span className="inline-flex min-w-0 items-center gap-2 text-small text-muted">
            <FolderGit2 size={14} strokeWidth={1.5} className="shrink-0" />
            <span className="truncate">{repo ? `${repo.owner}/${repo.repo}` : repoName}</span>
          </span>
        )}
      </header>

      <main id="main" tabIndex={-1} className="mx-auto max-w-[760px] px-4 pt-6 pb-24 sm:px-6 sm:pt-12">
        {!url && !repoIdParam ? (
          <NoRepo />
        ) : (
          <AnimatePresence mode="wait">
            {error ? (
              <Swap key="error">
                <ErrorState message={error} stillHaveRepo={!!repoRef.current} onRetry={() => setAttempt((a) => a + 1)} />
              </Swap>
            ) : repo && analysis ? (
              <Swap key="done">
                <Ready repo={repo} analysis={analysis} onStart={() => navigate(`/viva?repoId=${encodeURIComponent(repo.id)}`)} />
              </Swap>
            ) : (
              <Swap key="working">
                <Working progress={progress} />
              </Swap>
            )}
          </AnimatePresence>
        )}
      </main>
    </div>
  );
}

/** Crossfade between the three states (the only motion on this page besides progress). */
function Swap({ children }: { children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
      {children}
    </motion.div>
  );
}

/* ---------------- working ---------------- */

function Working({ progress }: { progress: Progress }) {
  const idx = STAGES.indexOf(progress.stage);
  const n = progress.files;
  const steps: Record<StageId, { active: string; done: string }> = {
    download: {
      active: progress.bytes > 0 ? `Downloading your repository (${formatBytes(progress.bytes)})` : "Downloading your repository",
      done: progress.bytes > 0 ? `Downloaded ${formatBytes(progress.bytes)}` : "Downloaded your repository",
    },
    read: { active: n ? `Reading ${n} source files` : "Reading source files", done: `Read ${n} source files` },
    save: { active: "Saving your project", done: "Project saved" },
    map: { active: "Mapping how the project fits together", done: "Architecture mapped" },
    questions: { active: "Choosing three lines to ask you about", done: "Questions ready" },
  };
  const thinking = progress.stage === "map" || progress.stage === "questions";

  return (
    <div>
      <h1 className="font-display text-[clamp(2.25rem,5vw,3rem)] leading-[1.02]">Reading your code</h1>
      <p className="mt-4 max-w-[520px] text-h3 leading-relaxed text-muted">
        Gemini goes through your project and picks three spots worth talking about. We skip builds, binaries and secrets.
      </p>

      <ol className="mt-12 flex flex-col" role="status" aria-live="polite">
        {STAGES.map((id, i) => {
          const state = i < idx ? "done" : i === idx ? "active" : "pending";
          return (
            <li key={id} className="relative flex items-center gap-4 py-3">
              {/* the thread that connects the steps */}
              {i < STAGES.length - 1 && (
                <span
                  aria-hidden="true"
                  className={`absolute top-[calc(50%+14px)] left-[13px] h-[calc(100%-28px)] w-0.5 rounded-full ${i < idx ? "bg-good" : "bg-line"}`}
                />
              )}
              <StepIcon state={state} />
              <span className={`flex-1 text-h3 ${state === "pending" ? "text-muted" : "text-ink"} ${state === "active" ? "font-medium" : ""}`}>
                {state === "done" ? steps[id].done : steps[id].active}
                {state === "active" && <span className="text-muted">…</span>}
              </span>
              {state === "active" && thinking && <Elapsed since={progress.mapStartedAt} />}
            </li>
          );
        })}
      </ol>

      {thinking && (
        <p
          key={progress.notice ?? "hint"}
          role={progress.notice ? "status" : undefined}
          className={`mt-6 border-l-2 pl-4 text-body ${progress.notice ? "border-warn text-[#8a5300]" : "border-line text-muted"}`}
        >
          {progress.notice ?? "This usually takes under a minute. Keep this tab open."}
        </p>
      )}
    </div>
  );
}

function Elapsed({ since }: { since: number | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!since) return null;
  return <span className="font-mono text-small text-muted tabular-nums">{Math.max(0, Math.round((now - since) / 1000))}s</span>;
}

function StepIcon({ state }: { state: "done" | "active" | "pending" }) {
  if (state === "done") {
    return (
      <motion.span
        initial={{ scale: 0.6 }}
        animate={{ scale: 1 }}
        className="relative z-10 grid size-7 shrink-0 place-items-center rounded-full bg-good text-white"
      >
        <Check size={15} strokeWidth={2.25} />
      </motion.span>
    );
  }
  if (state === "active") {
    return (
      <span className="relative z-10 grid size-7 shrink-0 place-items-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-accent/25 [animation-duration:1.6s]" />
        <span className="relative size-3.5 rounded-full bg-accent" />
      </span>
    );
  }
  return (
    <span className="relative z-10 grid size-7 shrink-0 place-items-center">
      <span className="size-3 rounded-full border-2 border-line bg-bg" />
    </span>
  );
}

/* ---------------- ready ---------------- */

const LANG_COLORS = ["#4285F4", "#34A853", "#F9AB00", "#EA4335", "#A142F4", "#24C1E0", "#9AA0A6"];

function Ready({ repo, analysis, onStart }: { repo: RepoDoc; analysis: Analysis; onStart: () => void }) {
  const [showQuestions, setShowQuestions] = useState(false);
  // The server only sends question wording for the presenter's demo project; real vivas keep it for the examiner.
  const canPreview = analysis.questions.some((q) => q.question);
  return (
    <div>
      {repo.isDemo && (
        <p className="mb-6 inline-flex items-center gap-2 rounded-full bg-accent-soft px-3 py-1 text-small font-medium text-accent-strong">
          Demo project, prepared in advance
        </p>
      )}
      <h1 className="font-display text-[clamp(2.25rem,5vw,3rem)] leading-[1.02]">Your viva is ready</h1>
      <p className="mt-4 text-h3 leading-relaxed text-muted">{analysis.summary}</p>
      {analysis.techStack.length > 0 && (
        <ul className="mt-5 flex flex-wrap gap-2" aria-label="Tech stack">
          {analysis.techStack.map((t) => (
            <li key={t} className="rounded-full bg-subtle px-3 py-1 text-small font-medium">
              {t}
            </li>
          ))}
        </ul>
      )}

      {/* The rules come first, so nobody meets them for the first time mid-exam. */}
      <section aria-labelledby="rules" className="mt-12 rounded-card bg-surface p-6 shadow-soft sm:p-8">
        <h2 id="rules" className="font-heading text-h2">
          How the viva works
        </h2>
        <p className="mt-1 text-muted">About 8 minutes: three spoken questions, then a 3-minute bug hunt. Please read these before you start.</p>
        <div className="mt-6">
          <ExamRules />
        </div>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button size="lg" onClick={onStart}>
            Continue to the viva
          </Button>
          <p className="text-small text-muted">You'll confirm you've read these before the viva starts.</p>
        </div>
      </section>

      {/* The three places you'll be asked about — the citation is the point */}
      <section className="mt-14" aria-labelledby="qs">
        <div className="flex items-baseline justify-between gap-4 border-b border-line pb-3">
          <h2 id="qs" className="font-heading text-h3">You'll be asked about these lines</h2>
          {canPreview ? (
            <button
              type="button"
              onClick={() => setShowQuestions((s) => !s)}
              aria-expanded={showQuestions}
              className="tap-target shrink-0 rounded-ctl px-2 py-1 text-small font-medium text-accent-strong hover:bg-accent-soft"
            >
              {showQuestions ? "Hide questions" : "Preview questions"}
            </button>
          ) : (
            <span className="shrink-0 text-small text-muted">You'll hear the questions in the viva</span>
          )}
        </div>
        <ol className="divide-y divide-line">
          {analysis.questions.map((q, i) => (
            <li key={q.id} className="grid gap-x-6 gap-y-2 py-4 sm:grid-cols-[200px_minmax(0,1fr)]">
              <div className="flex items-center gap-3">
                <span className="w-4 font-heading text-muted tabular-nums">{i + 1}</span>
                <Cite file={q.file} line={q.line} />
              </div>
              <div className="min-w-0">
                <p className="truncate font-mono text-small text-muted" title={q.file}>
                  {q.file}
                </p>
                <AnimatePresence initial={false}>
                  {showQuestions && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25 }}
                      className="overflow-hidden"
                    >
                      <p className="pt-2 text-body">{q.question}</p>
                      <pre className="mt-3 overflow-x-auto rounded-ctl bg-[#1f1f1f] py-2 font-mono text-[12px] leading-5 text-[#e8eaed]">
                        {q.excerpt.code.split("\n").map((l, j) => {
                          const n = q.excerpt.startLine + j;
                          return (
                            <div key={n} className={`px-3 whitespace-pre ${n === q.line ? "bg-[#4285f4]/25" : ""}`}>
                              <span className="mr-3 inline-block w-6 text-right text-[#6b6f75] select-none">{n}</span>
                              {l || " "}
                            </div>
                          );
                        })}
                      </pre>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-12" aria-labelledby="kf">
        <h2 id="kf" className="border-b border-line pb-3 font-heading text-h3">
          How your project fits together
        </h2>
        <dl className="divide-y divide-line">
          {analysis.keyFiles.map((k) => (
            <div key={k.path} className="grid gap-x-6 gap-y-1 py-3.5 sm:grid-cols-[200px_minmax(0,1fr)]">
              <dt className="min-w-0">
                <Cite file={k.path} tone="plain" />
              </dt>
              <dd className="text-muted">{k.why}</dd>
            </div>
          ))}
        </dl>
      </section>

      <CodeWeRead repo={repo} />

      <p className="mt-12 text-small text-muted">
        Not your project?{" "}
        <Link to="/" className="font-medium text-accent-strong hover:underline">
          Use a different repo
        </Link>
      </p>
    </div>
  );
}

function CodeWeRead({ repo }: { repo: RepoDoc }) {
  const [open, setOpen] = useState(false);
  const top = repo.languages.slice(0, 5);
  const rest = repo.languages.slice(5).reduce((n, l) => n + l.bytes, 0);
  const segments = rest > 0 ? [...top, { name: "Other", bytes: rest }] : top;
  const nonCode = repo.skipped.ignored + repo.skipped.binary + repo.skipped.tooLarge;
  const color = (i: number) => LANG_COLORS[Math.min(i, LANG_COLORS.length - 1)];

  return (
    <section className="mt-12">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-baseline justify-between gap-4 border-b border-line pb-3 text-left"
      >
        <span className="font-heading text-h3">The code we read</span>
        <span className="inline-flex items-center gap-1.5 text-small text-muted">
          {repo.fileCount} files, {formatBytes(repo.totalBytes)}
          <ChevronDown size={16} strokeWidth={1.5} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>

      <div className="mt-4 flex h-2 w-full gap-0.5 overflow-hidden rounded-full" role="img" aria-label="Language breakdown">
        {segments.map((l, i) => (
          <span key={l.name} style={{ background: color(i), flexGrow: Math.max(l.bytes, repo.totalBytes * 0.01), flexBasis: 0 }} />
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
        {segments.map((l, i) => (
          <li key={l.name} className="inline-flex items-center gap-2 text-small">
            <span className="size-2 rounded-full" style={{ background: color(i) }} />
            <span className="font-medium">{l.name}</span>
            <span className="text-muted">{Math.max(1, Math.round((l.bytes / repo.totalBytes) * 100))}%</span>
          </li>
        ))}
      </ul>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <ul className="mt-4 max-h-80 divide-y divide-line overflow-y-auto rounded-ctl bg-surface shadow-soft">
              {repo.files.map((f) => (
                <li key={f.path} className="flex items-center justify-between gap-4 px-4 py-2">
                  <span className="truncate font-mono text-small" title={f.path}>
                    {f.path}
                  </span>
                  <span className="shrink-0 text-small text-muted tabular-nums">{f.lines} lines</span>
                </li>
              ))}
            </ul>
            {(nonCode > 0 || repo.skipped.overCap > 0) && (
              <p className="mt-3 text-small text-muted">
                {nonCode > 0 && `Skipped ${nonCode} non-code or generated files. `}
                {repo.skipped.overCap > 0 && `${repo.skipped.overCap} more didn't fit the 500 KB limit, so core code came first.`}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

/* ---------------- edge states ---------------- */

function ErrorState({ message, stillHaveRepo, onRetry }: { message: string; stillHaveRepo: boolean; onRetry: () => void }) {
  return (
    <div className="border-l-2 border-warn pl-6">
      <h1 className="font-display text-[clamp(2rem,4.5vw,2.75rem)] leading-[1.05]">Your questions aren't ready</h1>
      <p className="mt-4 max-w-[520px] text-h3 leading-relaxed text-muted">{message}</p>
      {stillHaveRepo && <p className="mt-2 text-small text-muted">Your code is saved, so trying again skips the download.</p>}
      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button size="lg" onClick={onRetry} icon={<RotateCcw size={18} strokeWidth={1.5} />}>
          Try again
        </Button>
        <Link to="/" className="rounded-ctl px-3 py-2 text-small font-medium text-muted hover:text-ink">
          Use a different repo
        </Link>
      </div>
    </div>
  );
}

function NoRepo() {
  return (
    <div>
      <h1 className="font-display text-[clamp(2rem,4.5vw,2.75rem)] leading-[1.05]">Which project is yours?</h1>
      <p className="mt-4 text-h3 text-muted">Paste a public GitHub link on the home page and we'll take it from there.</p>
      <Link
        to="/"
        className="mt-8 inline-flex h-12 items-center rounded-ctl bg-accent-strong px-6 font-semibold text-white shadow-soft hover:bg-[#1765cc]"
      >
        Connect a repo
      </Link>
    </div>
  );
}