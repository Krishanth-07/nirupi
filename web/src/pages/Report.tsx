import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { Check, ChevronDown, Copy, ExternalLink, RotateCcw, ShieldAlert } from "lucide-react";
import { Logo } from "../components/ui/Logo";
import { Button } from "../components/ui/Button";
import { Cite } from "../components/ui/Cite";
import { generateReport, getReport, type Report as ReportData } from "../lib/api";

export default function Report() {
  const { id = "" } = useParams();
  const [report, setReport] = useState<ReportData | null>(null);
  const [state, setState] = useState<"loading" | "generating" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setState("loading");
    (async () => {
      try {
        let r = await getReport(id, ctrl.signal);
        if (!r) {
          setState("generating");
          r = await generateReport(id, ctrl.signal);
        }
        setReport(r);
        setState("ready");
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setError((e as Error).message);
        setState("error");
      }
    })();
    return () => ctrl.abort();
  }, [id, attempt]);

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-[1000px] items-center justify-between gap-4 px-4 py-5 sm:px-6">
        <Logo />
        {state === "ready" && <CopyLink />}
      </header>
      <main id="main" tabIndex={-1} className="mx-auto max-w-[1000px] px-4 pb-20 sm:px-6">
        {state === "ready" && report ? (
          <ReportSheet r={report} />
        ) : state === "error" ? (
          <ErrorState message={error} onRetry={() => setAttempt((a) => a + 1)} />
        ) : (
          <Generating generating={state === "generating"} />
        )}
      </main>
    </div>
  );
}

/* ================================================================== */
/* The marked answer script                                            */
/* ================================================================== */

const VERDICT = {
  strong: { label: "Strong ownership", tone: "bg-good-soft text-[#137333]", dot: "bg-good" },
  moderate: { label: "Moderate ownership", tone: "bg-warn-soft text-[#8a5300]", dot: "bg-warn" },
  weak: { label: "Weak ownership", tone: "bg-bad-soft text-[#b3261e]", dot: "bg-bad" },
} as const;

const STAGE_LABEL: Record<string, string> = {
  warmup: "Introduction",
  q1: "Question 1",
  q2: "Question 2",
  q3: "Question 3",
  done: "Wrap-up",
  bug: "Bug hunt",
};

const BUG = {
  solved: { label: "Solved", points: 25 },
  partial: { label: "Partly solved", points: 12.5 },
  not_solved: { label: "Not solved", points: 0 },
  not_attempted: { label: "Not attempted", points: 0 },
} as const;

/** A row of the answer sheet: the examiner's margin on the left, the answer on the right. */
function Row({ margin, children, className = "" }: { margin?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`grid gap-x-12 gap-y-3 lg:grid-cols-[176px_minmax(0,1fr)] ${className}`}>
      <div className="min-w-0 lg:pl-5 lg:text-right">{margin}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Marks written in the margin, in examiner's blue ink. */
function Mark({ value, of, muted = false }: { value: number | string; of?: number; muted?: boolean }) {
  return (
    <span className={`font-display text-[2rem] leading-none tabular-nums ${muted ? "text-muted" : "text-accent-strong"}`}>
      {value}
      {of !== undefined && <span className="text-h3 font-normal opacity-60">/{of}</span>}
    </span>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Row className="border-t border-line pt-10">
      <h2 className="font-heading text-h2">{children}</h2>
    </Row>
  );
}

function ReportSheet({ r }: { r: ReportData }) {
  const verdict = VERDICT[r.ownershipVerdict];
  const date = new Date(r.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  const bug = r.bugHunt?.result ?? "not_attempted";
  const shownSkills = r.skills.filter((s) => s.evidence);

  return (
    <article className="sheet relative overflow-hidden">
      {/* Answer-script paper: a tinted margin column and the red margin rule */}
      <div aria-hidden="true" className="absolute inset-y-0 left-0 hidden w-[200px] bg-paper-margin lg:block" />
      <div aria-hidden="true" className="absolute inset-y-0 left-[200px] hidden w-px bg-margin/45 lg:block" />

      <div className="relative flex flex-col gap-10 px-5 py-8 sm:px-8 sm:py-10 lg:pr-12 lg:pl-0">
        {/* Title block */}
        <Row margin={<Seal date={date} />}>
          <div className="flex flex-col gap-5 lg:pt-2">
            <div>
              <h1 className="font-display text-[clamp(2.25rem,5.5vw,3.5rem)] leading-[1] break-words">{r.repoName.split("/")[1] ?? r.repoName}</h1>
              <p className="mt-3 text-h3 text-muted">
                Viva on <span className="font-medium text-ink">@{r.owner}</span>'s repo, {date}
              </p>
              <p className="mt-1 text-small text-muted">
                {r.totalAttempts > 1 ? `Attempt ${r.attempt} of ${r.totalAttempts} on this repo. ` : "First attempt on this repo. "}
                The person who took the viva didn't sign in, so their identity isn't verified.
                {r.isDemo ? " This was a demo project." : ""}
              </p>
              <a
                href={r.repoUrl}
                target="_blank"
                rel="noreferrer"
                className="tap-target mt-2 inline-flex items-center gap-1.5 rounded-ctl text-small font-medium break-all text-accent-strong hover:underline"
              >
                {r.repoUrl.replace(/^https:\/\//, "")}
                <ExternalLink size={13} strokeWidth={1.5} />
              </a>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 font-semibold ${verdict.tone}`}>
                <span className={`size-2 rounded-full ${verdict.dot}`} />
                {verdict.label}
              </span>
              {r.vivaStatus !== "completed" && !r.integrity?.terminated && (
                <span className="text-small text-muted">The viva ended before every question was finished.</span>
              )}
            </div>
            {r.integrity?.status === "flagged" && (
              <div role="alert" className="flex gap-3 rounded-ctl bg-bad-soft px-4 py-3 text-[#8c1d18]">
                <ShieldAlert size={20} strokeWidth={1.5} className="mt-0.5 shrink-0" />
                <p>
                  <span className="font-semibold">Integrity flagged.</span> The viva was ended after {r.integrity.terminated?.violations ?? r.integrity.violations}{" "}
                  violations (leaving the exam window, full screen or the page). Review the details below before relying on these scores.
                </p>
              </div>
            )}
          </div>
        </Row>

        {/* Scores */}
        <Row>
          <div className="grid gap-8 rounded-card bg-bg/60 p-6 ring-1 ring-line sm:grid-cols-2">
            <ScoreRing value={r.technicalScore0to100} label="Technical understanding" sub="Their grasp of their own code" />
            <ScoreRing value={r.communicationScore0to100} label="Communication" sub="How clearly they explained it" />
            <p className="text-small text-muted sm:col-span-2">
              Scored independently. Language, accent and grammar never lower the technical score. Questions make up 75% of it and the
              bug hunt 25%.
            </p>
          </div>
        </Row>

        {/* Answers, marked */}
        <SectionTitle>Answers</SectionTitle>
        {r.questions.map((q, i) => {
          const s = r.perQuestion?.find((p) => p.id === q.id);
          const answered = !!s?.answered;
          return (
            <Row
              key={q.id}
              margin={
                <div className="flex items-center justify-between gap-3 lg:flex-col lg:items-end">
                  <Mark value={answered ? s!.score0to10 : 0} of={10} muted={!answered} />
                  <Cite file={q.file} line={q.line} />
                </div>
              }
            >
              <p className="text-small text-muted">Question {i + 1}</p>
              <p className="mt-1 text-h3 font-medium">{q.question}</p>
              {answered && s?.evidence ? (
                <blockquote className="mt-4 border-l-2 border-accent pl-4 text-h3 leading-relaxed">“{s.evidence}”</blockquote>
              ) : (
                <p className="mt-4 border-l-2 border-line pl-4 text-muted">{answered ? "Answered, but no quote could be verified." : "No answer given."}</p>
              )}
              {s?.note && answered && <p className="mt-3 text-muted">{s.note}</p>}
            </Row>
          );
        })}

        {/* Bug hunt */}
        {r.bugHunt && (
          <>
            <SectionTitle>Bug hunt</SectionTitle>
            <Row
              margin={
                <div className="flex items-center justify-between gap-3 lg:flex-col lg:items-end">
                  <Mark value={BUG[bug].points} of={25} muted={BUG[bug].points === 0} />
                  <Cite file={r.bugHunt.file} line={r.bugHunt.startLine} />
                </div>
              }
            >
              <BugHunt b={r.bugHunt} />
            </Row>
          </>
        )}

        {/* Ownership evidence from GitHub */}
        <SectionTitle>Evidence from Git history</SectionTitle>
        <GitSection r={r} />

        {/* Exam integrity */}
        <SectionTitle>Exam integrity</SectionTitle>
        <IntegritySection r={r} />

        {/* Skills */}
        <SectionTitle>Skills shown</SectionTitle>
        {shownSkills.length ? (
          shownSkills.map((s) => (
            <Row key={s.name} margin={<Mark value={s.score0to10} of={10} />}>
              <p className="text-h3 font-medium">{s.name}</p>
              <div
                className="mt-3 h-1.5 w-full max-w-[420px] overflow-hidden rounded-full bg-subtle"
                role="meter"
                aria-valuenow={s.score0to10}
                aria-valuemin={0}
                aria-valuemax={10}
                aria-label={s.name}
              >
                <div className="h-full rounded-full bg-accent" style={{ width: `${s.score0to10 * 10}%` }} />
              </div>
              <blockquote className="mt-3 text-muted">“{s.evidence}”</blockquote>
            </Row>
          ))
        ) : (
          <Row>
            <p className="text-muted">No skills were demonstrated. A skill only appears here when the student's own words back it up.</p>
          </Row>
        )}

        {/* Examiner's notes */}
        <SectionTitle>Examiner's notes</SectionTitle>
        <Row margin={<span className="font-heading text-[#137333]">Strengths</span>}>
          <Notes items={r.highlights} empty="None recorded." />
        </Row>
        <Row margin={<span className="font-heading text-[#8a5300]">Worth probing</span>}>
          <Notes items={r.concerns} empty="Nothing flagged." />
        </Row>

        {/* Transcript */}
        <div className="border-t border-line pt-8">
          <Row>
            <Transcript turns={r.englishTranscript} />
          </Row>
        </div>
      </div>

      <footer className="relative border-t border-line bg-surface px-5 py-6 sm:px-8 lg:pl-[224px]">
        <p className="font-medium">AI collects evidence; humans make hiring decisions.</p>
        <p className="mt-1 text-small text-muted">Questions came from this repository's code. Treat the scores as a guide for a conversation, not a verdict.</p>
      </footer>
    </article>
  );
}

/* ---------------- evidence sections ---------------- */

const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "unknown");

function GitSection({ r }: { r: ReportData }) {
  const g = r.git;
  if (!g?.available) {
    return (
      <Row>
        <p className="text-muted">
          GitHub history wasn't available for this report{g?.reason ? ` (${g.reason})` : ""}. The answers above are still the main evidence.
        </p>
      </Row>
    );
  }
  const share = g.ownerCommitShare !== undefined ? Math.round(g.ownerCommitShare * 100) : null;
  const commitUrl = g.snapshotSha ? `${r.repoUrl}/commit/${g.snapshotSha}` : null;
  return (
    <>
      <Row margin={share !== null && !g.ownerIsOrg ? <Mark value={`${share}%`} /> : undefined}>
        <p className="text-h3 font-medium">
          {g.ownerIsOrg
            ? `The repo belongs to the ${g.ownerLogin} organisation.`
            : `@${g.ownerLogin} made ${g.ownerCommits ?? 0} of ${g.totalCommits ?? "?"} commits.`}
        </p>
        <p className="mt-1 text-muted">
          {g.totalCommits ?? "?"} commits from {fmtDate(g.firstCommitAt)} to {fmtDate(g.lastCommitAt)}, on {g.activeDays ?? "?"} different days
          {g.isFork ? `. It's a fork of ${g.forkOf ?? "another repo"}.` : "."}
        </p>
        {g.contributors && g.contributors.length > 1 && (
          <p className="mt-1 text-small text-muted">
            Contributors: {g.contributors.map((c) => `${c.login} (${c.commits})`).join(", ")}
          </p>
        )}
        {commitUrl && (
          <a href={commitUrl} target="_blank" rel="noreferrer" className="tap-target mt-2 inline-flex items-center gap-1.5 text-small font-medium text-accent-strong hover:underline">
            Code examined at commit <code className="font-mono">{g.snapshotSha!.slice(0, 7)}</code>
            <ExternalLink size={13} strokeWidth={1.5} />
          </a>
        )}
      </Row>
      {g.files?.map((f) => (
        <Row key={f.path} margin={<Cite file={f.path} />}>
          <p>
            {f.commits === 0
              ? "No commit history found for this file."
              : `${f.commits} commit${f.commits === 1 ? "" : "s"} to the file you were asked about. ${f.ownerCommits} by the repo owner${f.authors.length > 1 ? `; authors: ${f.authors.join(", ")}` : ""}.`}
          </p>
        </Row>
      ))}
      <Row>
        <Notes items={g.flags} empty="Nothing unusual in the history." />
      </Row>
    </>
  );
}

function IntegritySection({ r }: { r: ReportData }) {
  const i = r.integrity;
  const delays = Object.entries(i?.answerDelays ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const stat = (label: string, value: string | number, warn = false) => (
    <div className="flex flex-col">
      <span className={`font-display text-[1.75rem] leading-none tabular-nums ${warn ? "text-[#8a5300]" : ""}`}>{value}</span>
      <span className="mt-1 text-small text-muted">{label}</span>
    </div>
  );
  return (
    <>
      <Row>
        <div className="grid grid-cols-2 gap-6 rounded-card bg-bg/60 p-5 ring-1 ring-line sm:grid-cols-4">
          {stat("Tab switches", i?.tabSwitches ?? 0, (i?.tabSwitches ?? 0) > 0)}
          {stat("Seconds away", i?.secondsAway ?? 0, (i?.secondsAway ?? 0) >= 3)}
          {stat("Full-screen exits", i?.fullscreenExits ?? 0, (i?.fullscreenExits ?? 0) > 0)}
          {stat(`Violations (limit ${i?.maxViolations ?? 3})`, i?.violations ?? 0, (i?.violations ?? 0) > 0)}
        </div>
        {delays.length > 0 && (
          <p className="mt-4 text-small text-muted">
            Time before starting each answer: {delays.map(([q, s]) => `${STAGE_LABEL[q] ?? q} ${s}s`).join(", ")}.
          </p>
        )}
      </Row>
      <Row>
        <Notes items={i?.flags ?? []} empty="No integrity signals were recorded." />
        <p className="mt-4 text-small text-muted">
          The voice session ran through Nirupi's server, so this transcript was recorded server-side and can't be edited from the browser.
          These signals are context for a conversation, not proof of anything.
        </p>
      </Row>
    </>
  );
}

/* ---------------- pieces ---------------- */

/** The embossed seal. Stamps in once when the report opens. */
function Seal({ date }: { date: string }) {
  return (
    <div className="flex justify-start lg:justify-end">
      <svg viewBox="0 0 140 140" className="animate-stamp size-[112px] text-accent-strong lg:size-[132px]" role="img" aria-label={`Verified by Nirupi, ${date}`}>
        <defs>
          <path id="seal-top" d="M 70 70 m -50 0 a 50 50 0 1 1 100 0" />
          <path id="seal-bottom" d="M 70 70 m -54 0 a 54 54 0 0 0 108 0" />
        </defs>
        <circle cx="70" cy="70" r="66" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx="70" cy="70" r="60" fill="none" stroke="currentColor" strokeWidth="0.75" strokeDasharray="2 3" />
        <circle cx="70" cy="70" r="38" fill="currentColor" fillOpacity="0.08" stroke="currentColor" strokeWidth="1.25" />
        <text fill="currentColor" fontSize="12" fontWeight="700" letterSpacing="3" fontFamily="Google Sans Flex, sans-serif">
          <textPath href="#seal-top" startOffset="50%" textAnchor="middle">VERIFIED BY NIRUPI</textPath>
        </text>
        <text fill="currentColor" fontSize="9.5" fontWeight="500" letterSpacing="1.5" fontFamily="Google Sans Flex, sans-serif">
          <textPath href="#seal-bottom" startOffset="50%" textAnchor="middle">{date}</textPath>
        </text>
        <path d="M58 82V58l24 24V58" fill="none" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function band(v: number) {
  return v >= 75 ? "var(--color-good)" : v >= 50 ? "var(--color-warn)" : "var(--color-bad)";
}

function ScoreRing({ value, label, sub }: { value: number; label: string; sub: string }) {
  const still = useReducedMotion();
  const r = 48;
  const c = 2 * Math.PI * r;
  const mv = useMotionValue(still ? value : 0);
  const offset = useTransform(mv, (v) => c * (1 - v / 100));
  const [n, setN] = useState(still ? value : 0);
  useEffect(() => {
    if (still) return;
    const controls = animate(mv, value, { duration: 1.1, ease: [0.22, 1, 0.36, 1], delay: 0.45 });
    const unsub = mv.on("change", (v) => setN(Math.round(v)));
    return () => {
      controls.stop();
      unsub();
    };
  }, [mv, value, still]);

  return (
    <div className="flex items-center gap-5">
      <div className="relative grid size-[116px] shrink-0 place-items-center">
        <svg width="116" height="116" viewBox="0 0 116 116" className="-rotate-90" aria-hidden="true">
          <circle cx="58" cy="58" r={r} fill="none" stroke="var(--color-subtle)" strokeWidth="9" />
          <motion.circle cx="58" cy="58" r={r} fill="none" stroke={band(value)} strokeWidth="9" strokeLinecap="round" strokeDasharray={c} style={{ strokeDashoffset: offset }} />
        </svg>
        <span className="absolute font-display text-[2.25rem] leading-none tabular-nums" aria-hidden="true">
          {n}
        </span>
      </div>
      <div>
        <p className="font-heading text-h3">{label}</p>
        <p className="mt-1 text-small text-muted">{sub}</p>
        <span className="sr-only">
          {value} out of 100
        </span>
      </div>
    </div>
  );
}

function Notes({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return <p className="text-muted">{empty}</p>;
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((t) => (
        <li key={t} className="flex gap-3">
          <span className="mt-[0.7em] h-px w-3 shrink-0 bg-muted/60" aria-hidden="true" />
          {t}
        </li>
      ))}
    </ul>
  );
}

function BugHunt({ b }: { b: NonNullable<ReportData["bugHunt"]> }) {
  const [showIntended, setShowIntended] = useState(false);
  const diff = useMemo(() => (b.studentCode ? lineDiff(b.buggyCode, b.studentCode) : null), [b.buggyCode, b.studentCode]);
  const changed = diff?.some((d) => d.kind !== "same");
  const tone = { solved: "text-[#137333]", partial: "text-[#8a5300]", not_solved: "text-[#b3261e]", not_attempted: "text-muted" }[b.result];
  const used =
    b.result === "not_attempted"
      ? null
      : b.timedOut
        ? "Ran out of time."
        : `Took ${Math.floor(b.secondsUsed / 60)}:${String(b.secondsUsed % 60).padStart(2, "0")} of 3:00.`;

  return (
    <div>
      <p className="text-small text-muted">
        One bug was slipped into <code className="font-mono text-[13px] text-ink">{b.functionName}()</code>. The task: {b.taskText}
      </p>
      <p className={`mt-2 text-h3 font-semibold ${tone}`}>{BUG[b.result].label}</p>
      <p className="mt-1">{b.reason}</p>
      {used && <p className="mt-1 text-small text-muted">{used}</p>}

      {diff && (
        <figure className="mt-5">
          <figcaption className="mb-2 text-small text-muted">{changed ? "What they changed in the buggy version" : "They didn't change the buggy code."}</figcaption>
          <pre className="overflow-x-auto rounded-ctl bg-[#1f1f1f] py-3 font-mono text-[12px] leading-5 text-[#e8eaed]">
            {diff.map((d, i) => (
              <div key={i} className={`px-3 whitespace-pre ${d.kind === "add" ? "bg-[#34a853]/20" : d.kind === "del" ? "bg-[#ea4335]/20 text-[#f6aea9]" : ""}`}>
                <span className="mr-3 inline-block w-3 text-[#9aa0a6] select-none">{d.kind === "add" ? "+" : d.kind === "del" ? "−" : " "}</span>
                {d.text || " "}
              </div>
            ))}
          </pre>
        </figure>
      )}

      <button
        type="button"
        onClick={() => setShowIntended((v) => !v)}
        aria-expanded={showIntended}
        className="tap-target mt-3 inline-flex items-center gap-1.5 rounded-ctl py-1 text-small font-medium text-accent-strong hover:underline"
      >
        {showIntended ? "Hide the original code" : "Show the original code"}
        <ChevronDown size={15} strokeWidth={1.5} className={`transition-transform ${showIntended ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence initial={false}>
        {showIntended && (
          <motion.pre
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="mt-2 overflow-hidden rounded-ctl bg-[#1f1f1f] font-mono text-[12px] leading-5 text-[#e8eaed]"
          >
            <div className="overflow-x-auto px-3 py-3 whitespace-pre">{b.originalCode}</div>
          </motion.pre>
        )}
      </AnimatePresence>
    </div>
  );
}

function Transcript({ turns }: { turns: ReportData["englishTranscript"] }) {
  const [open, setOpen] = useState(false);
  let lastStage = "";
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-baseline justify-between gap-4 rounded-ctl text-left"
      >
        <span className="font-heading text-h2">Full transcript</span>
        <span className="inline-flex items-center gap-1.5 text-small font-medium text-accent-strong">
          {open ? "Hide" : `Show ${turns.length} messages, in English`}
          <ChevronDown size={16} strokeWidth={1.5} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="flex flex-col gap-3 pt-6">
              {turns.map((t, i) => {
                const header = t.stage !== lastStage ? (STAGE_LABEL[t.stage] ?? t.stage) : null;
                lastStage = t.stage;
                const student = t.speaker === "Student";
                return (
                  <div key={i} className="flex flex-col gap-3">
                    {header && <p className="pt-3 font-heading text-muted">{header}</p>}
                    <div className={`flex flex-col gap-1 ${student ? "items-end" : "items-start"}`}>
                      <span className="px-1 text-small text-muted">{student ? "Student" : "Nirupi"}</span>
                      <p className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${student ? "rounded-tr-md bg-subtle" : "rounded-tl-md bg-accent-soft"}`}>{t.text}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CopyLink() {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="secondary"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(window.location.href);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          /* clipboard blocked */
        }
      }}
      icon={copied ? <Check size={16} strokeWidth={2} className="text-good" /> : <Copy size={16} strokeWidth={1.5} />}
    >
      <span aria-live="polite">{copied ? "Link copied" : "Copy link"}</span>
    </Button>
  );
}

function Generating({ generating }: { generating: boolean }) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="sheet relative mx-auto max-w-[640px] overflow-hidden px-8 py-12" role="status">
      <div aria-hidden="true" className="absolute inset-y-0 left-6 w-px bg-margin/45" />
      <div className="pl-6">
        <h1 className="font-display text-[clamp(2rem,4.5vw,2.75rem)] leading-[1.05]">{generating ? "Marking your viva" : "Opening the report"}</h1>
        {generating && (
          <>
            <p className="mt-4 text-h3 leading-relaxed text-muted">
              Each answer and your bug fix are checked against your actual code. Technical skill and communication are scored separately.
            </p>
            <p className="mt-6 inline-flex items-center gap-3 text-small text-muted">
              <span className="relative flex size-2.5">
                <span className="absolute inset-0 animate-ping rounded-full bg-accent/40" />
                <span className="relative size-2.5 rounded-full bg-accent" />
              </span>
              <span className="font-mono tabular-nums">{secs}s</span>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mx-auto mt-6 max-w-[640px] border-l-2 border-warn pl-6">
      <h1 className="font-display text-[clamp(2rem,4.5vw,2.75rem)] leading-[1.05]">This report isn't ready</h1>
      <p className="mt-4 text-h3 leading-relaxed text-muted">{message}</p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button size="lg" onClick={onRetry} icon={<RotateCcw size={18} strokeWidth={1.5} />}>
          Try again
        </Button>
        <Link to="/" className="rounded-ctl px-3 py-2 text-small font-medium text-muted hover:text-ink">
          Back to home
        </Link>
      </div>
    </div>
  );
}

/** Minimal line diff (LCS); functions are small. */
function lineDiff(a: string, b: string): { kind: "same" | "add" | "del"; text: string }[] {
  const x = a.replace(/\r\n/g, "\n").split("\n");
  const y = b.replace(/\r\n/g, "\n").split("\n");
  const dp = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: { kind: "same" | "add" | "del"; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      out.push({ kind: "same", text: x[i++] });
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ kind: "del", text: x[i++] });
    else out.push({ kind: "add", text: y[j++] });
  }
  while (i < x.length) out.push({ kind: "del", text: x[i++] });
  while (j < y.length) out.push({ kind: "add", text: y[j++] });
  return out;
}
