import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { FolderGit2 } from "lucide-react";
import { Logo } from "../components/ui/Logo";
import { Button } from "../components/ui/Button";
import { Cite } from "../components/ui/Cite";
import { startDemo, type VivaMode } from "../lib/api";

const GITHUB_RE = /^(https?:\/\/)?(www\.)?github\.com\/[\w.-]+\/[\w.-]+?(\.git)?(\/tree\/[^?#]+)?\/?([?#].*)?$/i;

/** The story, in three beats. Not a sequence, so not numbered. */
const WHY = [
  {
    title: "CVs stopped showing skill",
    body: "AI can write a whole project in an afternoon. A GitHub link shows what exists, not what the candidate understands.",
  },
  {
    title: "A conversation does",
    body: "Nirupi asks three spoken questions about real lines in the candidate's own code, then hands them one small bug to fix in three minutes.",
  },
  {
    title: "Your team gets evidence",
    body: "Technical understanding and communication are scored separately, backed by the candidate's own words, git history and exam integrity signals.",
  },
];

export default function Landing() {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [demoState, setDemoState] = useState<"idle" | "loading" | "error">("idle");

  const openDemo = async () => {
    setDemoState("loading");
    try {
      const { repoId } = await startDemo();
      navigate(`/analyse?repoId=${encodeURIComponent(repoId)}&mode=assessment`);
    } catch {
      setDemoState("error");
    }
  };

  const go = (mode: VivaMode) => {
    const trimmed = url.trim();
    if (!GITHUB_RE.test(trimmed)) {
      setError("Paste a link to a public GitHub repo, like github.com/candidate/project.");
      document.getElementById("repo")?.focus();
      return;
    }
    navigate(`/analyse?repo=${encodeURIComponent(trimmed)}&mode=${mode}`);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    go("assessment");
  };

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-[1100px] items-center justify-between px-4 py-5 sm:px-6">
        <Logo />
        <Link to="/recruiter" className="tap-target rounded-ctl px-3 py-2 text-small font-medium text-muted hover:bg-subtle hover:text-ink">
          Hiring dashboard
        </Link>
      </header>

      <main id="main" tabIndex={-1} className="mx-auto max-w-[1100px] px-4 sm:px-6">
        {/* Hero */}
        <section className="grid items-center gap-12 pt-10 pb-20 sm:pt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-16 lg:pt-20 lg:pb-28">
          <div className="min-w-0 max-w-[540px]">
            <h1 className="font-display text-[clamp(2.75rem,7vw,4.5rem)] leading-[0.98]">Hire for real understanding.</h1>
            <p className="mt-6 text-h3 leading-relaxed text-muted">
              CVs and GitHub links can't tell you who actually understands their code. Nirupi interviews each candidate live, by voice, on
              their own project, and gives your hiring team a report backed by evidence.
            </p>

            <form onSubmit={submit} noValidate className="mt-10">
              <label htmlFor="repo" className="mb-2 block text-small font-medium">
                Candidate's public GitHub repo
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <div
                  className={`flex flex-1 items-center gap-2.5 rounded-ctl bg-surface px-4 shadow-soft ring-1 transition-shadow focus-within:ring-2 focus-within:ring-accent-strong ${
                    error ? "ring-bad" : "ring-line"
                  }`}
                >
                  <FolderGit2 size={18} strokeWidth={1.5} className="shrink-0 text-muted" />
                  <input
                    id="repo"
                    type="url"
                    inputMode="url"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="github.com/candidate/project"
                    value={url}
                    onChange={(e) => {
                      setUrl(e.target.value);
                      setError(null);
                    }}
                    aria-invalid={!!error}
                    aria-describedby="repo-help"
                    className="h-12 w-full bg-transparent outline-none placeholder:text-muted"
                  />
                </div>
                <Button type="submit" size="lg">
                  Start the assessment
                </Button>
              </div>
              <p id="repo-help" className={`mt-3 text-small ${error ? "text-[#b3261e]" : "text-muted"}`} role={error ? "alert" : undefined}>
                {error ?? "About 8 minutes for the candidate. Public repos only; we never read secrets, builds or binaries."}
              </p>
            </form>

            <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-6">
              <Button variant="secondary" onClick={openDemo} disabled={demoState === "loading"}>
                {demoState === "loading" ? "Opening the demo…" : "Try a demo assessment"}
              </Button>
              <p className="text-small text-muted" role={demoState === "error" ? "alert" : undefined}>
                {demoState === "error" ? "The demo isn't ready yet. Try again in a few seconds." : "A sample project that's already been read, so you can start the viva straight away."}
              </p>
            </div>
          </div>

          <Specimen />
        </section>

        {/* The story */}
        <section aria-labelledby="why" className="border-t border-line py-16 sm:py-20">
          <h2 id="why" className="font-heading text-h2">
            Why Nirupi
          </h2>
          <div className="mt-10 grid gap-10 sm:grid-cols-3 sm:gap-8">
            {WHY.map((w) => (
              <div key={w.title} className="border-l-2 border-accent pl-5">
                <h3 className="font-heading text-h3">{w.title}</h3>
                <p className="mt-2 text-muted">{w.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* How an assessment works: a real sequence, so it's numbered */}
        <section aria-labelledby="how" className="border-t border-line py-16 sm:py-20">
          <h2 id="how" className="font-heading text-h2">
            How an assessment works
          </h2>
          <ol className="mt-10 grid gap-10 sm:grid-cols-3 sm:gap-8">
            {[
              ["The candidate connects a repo", "Gemini reads their project and picks three specific lines worth talking about."],
              ["A live viva and a bug hunt", "A calm AI examiner asks about those lines out loud, then the candidate fixes one small bug in their own code."],
              ["Your team reviews the evidence", "Scores, quotes, git history and integrity signals land in your hiring dashboard, ready for a human decision."],
            ].map(([title, body], i) => (
              <li key={title} className="flex gap-4">
                <span className="font-display text-[2.5rem] leading-none text-accent-strong/25 tabular-nums" aria-hidden="true">
                  {i + 1}
                </span>
                <div>
                  <h3 className="font-heading text-h3">{title}</h3>
                  <p className="mt-2 text-muted">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* Secondary: candidates can practise first */}
        <section aria-labelledby="practise" className="border-t border-line py-14">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-[560px]">
              <h2 id="practise" className="font-heading text-h3">
                Candidates can practise first
              </h2>
              <p className="mt-1 text-muted">
                The same viva, privately. Practice reports come with a list of what to work on and are never shown to companies.
              </p>
            </div>
            <Button variant="secondary" onClick={() => go("practice")}>
              Practise with this repo
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <p className="mx-auto max-w-[1100px] px-4 py-8 text-small text-muted sm:px-6">AI collects evidence; humans make hiring decisions.</p>
      </footer>
    </div>
  );
}
/* A worked example of the core idea: a real line of public code, and the question pinned to it. */
const CODE: { n: number; text: string }[] = [
  { n: 196, text: "  // freshness" },
  { n: 197, text: "  if (req.fresh) this.status(304);" },
  { n: 198, text: "" },
  { n: 199, text: "  if (204 === this.statusCode || 304 === this.statusCode) {" },
  { n: 200, text: "    this.removeHeader('Content-Type');" },
  { n: 201, text: "    this.removeHeader('Content-Length');" },
  { n: 202, text: "    this.removeHeader('Transfer-Encoding');" },
  { n: 203, text: "    chunk = '';" },
  { n: 204, text: "  }" },
];

function Specimen() {
  const still = useReducedMotion();
  const t = (delay: number) => (still ? { duration: 0 } : { delay, duration: 0.5, ease: [0.22, 1, 0.36, 1] as const });

  return (
    <figure className="relative min-w-0 pb-44 sm:pb-[290px]" aria-label="Example: a question Nirupi asks about a real line of code, and the report a hiring team receives">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={t(0.1)}
        className="overflow-hidden rounded-card bg-[#1f1f1f] shadow-lift"
      >
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
          <Cite file="expressjs/express/lib/response.js" full tone="dark" />
          <span className="text-small text-[#9aa0a6]">res.send()</span>
        </div>
        <pre className="overflow-x-auto py-3 font-mono text-[12.5px] leading-[22px] text-[#e8eaed]">
          {CODE.map((l) => (
            <div key={l.n} className="relative px-4">
              {l.n === 199 && (
                <motion.span
                  aria-hidden="true"
                  className="absolute inset-y-0 left-0 origin-left bg-[#4285f4]/25"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={t(0.65)}
                  style={{ width: "100%" }}
                />
              )}
              <span className="relative mr-4 inline-block w-7 text-right text-[#6b6f75] select-none">{l.n}</span>
              <span className="relative">{l.text || " "}</span>
            </div>
          ))}
        </pre>
      </motion.div>

      {/* The examiner's note, pinned to line 199 */}
      <motion.figcaption
        initial={{ opacity: 0, x: 16 }}
        animate={{ opacity: 1, x: 0 }}
        transition={t(1.05)}
        className="absolute right-0 bottom-0 left-6 rounded-card bg-surface p-5 shadow-lift ring-1 ring-line sm:-right-3 sm:bottom-auto sm:left-auto sm:top-[150px] sm:w-[min(340px,78%)]"
      >
        <Cite file="lib/response.js" line={199} />
        <p className="mt-3 text-body font-medium">
          Why does <code className="font-mono text-[13px]">res.send</code> strip the body headers when the status is 204 or 304?
        </p>
        <p className="mt-2 text-small text-muted">Asked out loud, about the candidate's own code.</p>
      </motion.figcaption>

      {/* ...and what the hiring team gets back */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={t(1.6)}
        className="absolute top-[345px] left-0 hidden w-[320px] rounded-card bg-surface p-5 shadow-lift ring-1 ring-line sm:block"
        aria-hidden="true"
      >
        <div className="flex items-center justify-between">
          <span className="text-small font-medium text-muted">Example report</span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-good-soft px-2.5 py-0.5 text-small font-semibold whitespace-nowrap text-[#137333]">
            <span className="size-1.5 rounded-full bg-good" />
            Strong understanding
          </span>
        </div>
        <div className="mt-4 flex items-center gap-5">
          <MiniRing value={82} label="Technical" delay={1.9} still={!!still} />
          <MiniRing value={74} label="Communication" delay={2.05} still={!!still} />
        </div>
        <p className="mt-4 border-l-2 border-accent pl-3 text-small text-muted italic">
          "A 204 has no body, so sending Content-Length would make proxies wait for bytes that never come."
        </p>
      </motion.div>
    </figure>
  );
}

function MiniRing({ value, label, delay, still }: { value: number; label: string; delay: number; still: boolean }) {
  const r = 20;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-2.5">
      <svg width="48" height="48" viewBox="0 0 48 48" className="-rotate-90">
        <circle cx="24" cy="24" r={r} fill="none" stroke="var(--color-subtle)" strokeWidth="5" />
        <motion.circle
          cx="24"
          cy="24"
          r={r}
          fill="none"
          stroke="var(--color-good)"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: still ? c * (1 - value / 100) : c }}
          animate={{ strokeDashoffset: c * (1 - value / 100) }}
          transition={still ? { duration: 0 } : { delay, duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <div>
        <p className="font-display text-h3 leading-none tabular-nums">{value}</p>
        <p className="mt-1 text-small text-muted">{label}</p>
      </div>
    </div>
  );
}
