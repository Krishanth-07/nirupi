import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { FolderGit2 } from "lucide-react";
import { Logo } from "../components/ui/Logo";
import { Button } from "../components/ui/Button";
import { Cite } from "../components/ui/Cite";
import { startDemo, type VivaMode } from "../lib/api";

const GITHUB_RE = /^(https?:\/\/)?(www\.)?github\.com\/[\w.-]+\/[\w.-]+?(\.git)?(\/tree\/[^?#]+)?\/?([?#].*)?$/i;

/** Times are from a typical run: warm-up, three questions, a three-minute bug hunt. */
const TIMELINE = [
  { at: "0:00", title: "Gemini reads the repo", body: "It picks three lines worth asking about: a design decision, a tricky branch, an edge case." },
  { at: "0:30", title: "Three questions, out loud", body: "A calm examiner asks about each line and follows up when an answer stays vague." },
  { at: "5:00", title: "A three-minute bug hunt", body: "The candidate finds and fixes one small bug planted in their own code." },
  { at: "8:00", title: "Evidence for your team", body: "Scores, the candidate's own words, git history and integrity signals land in your hiring dashboard." },
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

          <AnswerSheet />
        </section>

        {/* The argument, in one sentence */}
        <section aria-labelledby="why" className="border-t border-line py-16 sm:py-24">
          <h2 id="why" className="max-w-[820px] font-display text-[clamp(2rem,4.6vw,3.25rem)] leading-[1.04]">
            A CV says React. A conversation shows whether they understand it.
          </h2>
          <div className="mt-8 grid max-w-[820px] gap-6 text-body text-muted sm:grid-cols-2 sm:gap-10">
            <p>
              AI can write a whole project in an afternoon, so a GitHub link shows what exists, not what the candidate understands. Nirupi
              talks to them about their own code, line by line.
            </p>
            <p>
              Technical understanding is scored separately from spoken English, so a strong engineer isn't marked down for their accent, and
              a fluent one can't talk their way past a line they don't understand.
            </p>
          </div>
        </section>

        {/* A real sequence with real times, so it gets a timeline */}
        <section aria-labelledby="how" className="border-t border-line py-16 sm:py-24">
          <h2 id="how" className="font-heading text-h2">
            An assessment, minute by minute
          </h2>
          <ol className="relative mt-12 grid gap-10 lg:grid-cols-4 lg:gap-8">
            <span aria-hidden="true" className="absolute top-[7px] right-0 left-0 hidden h-px bg-line lg:block" />
            <span aria-hidden="true" className="absolute top-2 bottom-2 left-[7px] w-px bg-line lg:hidden" />
            {TIMELINE.map((step) => (
              <li key={step.at} className="relative pl-10 lg:pt-10 lg:pl-0">
                <span aria-hidden="true" className="absolute top-0 left-0 size-[15px] rounded-full border-2 border-accent-strong bg-bg" />
                <p className="font-display text-h2 leading-none tabular-nums text-accent-strong">
                  <span className="sr-only">At minute </span>
                  {step.at}
                </p>
                <h3 className="mt-3 font-heading text-h3">{step.title}</h3>
                <p className="mt-2 text-muted">{step.body}</p>
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

/* The hero: one marked answer script, the same artifact a hiring team receives. */
const CODE: { n: number; text: string }[] = [
  { n: 199, text: "if (this.statusCode === 204 ||" },
  { n: 200, text: "    this.statusCode === 304) {" },
  { n: 201, text: "  this.removeHeader('Content-Length');" },
  { n: 202, text: "  this.removeHeader('Content-Type');" },
  { n: 203, text: "  chunk = '';" },
];
const ANSWER =
  "A 204 or 304 never has a body. If Content-Length stayed, a proxy would sit waiting for bytes that are never coming, so it clears the headers and the chunk together.";

function AnswerSheet() {
  const still = useReducedMotion();
  const [typed, setTyped] = useState(0);
  const done = still || typed >= ANSWER.length;

  // The one orchestrated moment: the answer arrives like live transcription, then it gets marked.
  useEffect(() => {
    if (still) return;
    let i = 0;
    let timer: number | undefined;
    const start = window.setTimeout(() => {
      timer = window.setInterval(() => {
        i = Math.min(ANSWER.length, i + 2);
        setTyped(i);
        if (i >= ANSWER.length) window.clearInterval(timer);
      }, 32);
    }, 900);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(timer);
    };
  }, [still]);

  const shown = still ? ANSWER : ANSWER.slice(0, typed);

  return (
    <figure
      className="sheet relative min-w-0 overflow-hidden"
      aria-label="Example: a marked answer from a Nirupi assessment, with the question, the code it points to, the candidate's spoken answer and the examiner's mark"
    >
      <div aria-hidden="true" className="absolute inset-y-0 left-0 w-14 bg-paper-margin sm:w-20" />
      <div aria-hidden="true" className="absolute inset-y-0 left-14 w-px bg-margin/50 sm:left-20" />

      <div className="relative grid grid-cols-[3.5rem_minmax(0,1fr)] sm:grid-cols-[5rem_minmax(0,1fr)]">
        {/* Question */}
        <div className="pt-6 text-center font-display text-h2 leading-none text-muted sm:pt-7">2</div>
        <div className="min-w-0 px-5 pt-6 sm:px-7 sm:pt-7">
          <Cite file="lib/response.js" line={199} />
          <p className="mt-3 font-heading text-h3 leading-snug">
            Why does <code className="font-mono text-[0.9em]">res.send</code> strip the body headers when the status is 204 or 304?
          </p>
          <pre className="mt-4 overflow-x-auto rounded-[4px] bg-subtle py-2 font-mono text-[12px] leading-[21px] text-ink [font-variant-ligatures:none]">
            {CODE.map((l) => (
              <div key={l.n} className={`px-3 ${l.n <= 200 ? "bg-accent-soft" : ""}`}>
                <span className="mr-3 inline-block w-6 text-right text-muted select-none">{l.n}</span>
                {l.text}
              </div>
            ))}
          </pre>
        </div>

        {/* The candidate's spoken answer, and the mark in the margin */}
        <div className="relative pt-8 text-center">
          <motion.span
            aria-hidden={!done}
            initial={false}
            animate={done ? { opacity: 1, scale: 1, rotate: -8 } : { opacity: 0, scale: 1.4, rotate: -20 }}
            transition={still ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 18 }}
            className="inline-block font-display text-[1.75rem] leading-none text-accent-strong tabular-nums sm:text-[2rem]"
          >
            8<span className="text-[0.6em] opacity-70">/10</span>
          </motion.span>
        </div>
        <div className="min-w-0 px-5 pt-8 sm:px-7">
          <p className="text-small font-medium text-muted">Candidate, spoken</p>
          <p className="sr-only">{ANSWER}</p>
          <p aria-hidden="true" className="mt-1.5 min-h-[4.5em] text-body leading-relaxed">
            {shown}
            {!done && <span className="ml-0.5 inline-block animate-pulse text-accent-strong">▍</span>}
          </p>
        </div>

        {/* The examiner follows up */}
        <div />
        <motion.div
          initial={false}
          animate={{ opacity: done ? 1 : 0 }}
          transition={still ? { duration: 0 } : { delay: 0.5, duration: 0.4 }}
          className="min-w-0 px-5 pt-5 pb-7 sm:px-7"
        >
          <p className="border-l-2 border-accent pl-3 text-small text-muted">
            <span className="font-medium text-ink">Examiner follows up:</span> what would break if line 203 were deleted?
          </p>
        </motion.div>
      </div>
    </figure>
  );
}
