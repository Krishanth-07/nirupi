import "../lib/monaco";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import Editor from "@monaco-editor/react";
import {
  Bug,
  CheckCircle2,
  CircleDashed,
  FileCode2,
  Mic,
  MicOff,
  RotateCcw,
  Send,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { Logo } from "../components/ui/Logo";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { languageFor } from "../lib/monaco";
import { useLiveSession } from "../lib/live/useLiveSession";
import { getBugHunt, liveRelayPath, startBugHunt, submitBugHunt, type BugHuntResult, type BugHuntTask } from "../lib/api";
import { enterExamMode, exitExamMode, useIntegrity } from "../lib/integrity";
import { ExamWarningOverlay } from "../components/viva/ExamRules";

type Phase = "loading" | "error" | "ready" | "running" | "checking" | "done" | "closed";

export default function BugHunt() {
  const [params] = useSearchParams();
  const vivaId = params.get("vivaId") ?? "";
  const [phase, setPhase] = useState<Phase>("loading");
  const [task, setTask] = useState<BugHuntTask | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BugHuntResult | null>(null);
  const [code, setCode] = useState("");
  const [left, setLeft] = useState(180);
  const [attempt, setAttempt] = useState(0);
  /** When the 3 minutes started, in this browser's clock (server start time corrected for clock skew). */
  const startedAtRef = useRef(0);
  const codeRef = useRef("");
  const submittingRef = useRef(false);
  const [blockedNotice, setBlockedNotice] = useState(false);
  const live = useLiveSession();
  codeRef.current = code;

  const toLocalClock = (serverStartedAt: string, serverNow?: string) =>
    Date.parse(serverStartedAt) - (serverNow ? Date.parse(serverNow) - Date.now() : 0);

  const connectVoice = useCallback(() => {
    live.setStageTag("bug");
    // The explanation is recorded by the server relay, not sent from the browser.
    void live.start({ relay: async () => liveRelayPath(vivaId, "bug") });
  }, [live, vivaId]);

  // Load the task (prepared in the background during the viva). The code itself only arrives once started.
  useEffect(() => {
    if (!vivaId) return;
    const ctrl = new AbortController();
    setPhase("loading");
    getBugHunt(vivaId, ctrl.signal)
      .then((t) => {
        setTask(t);
        setLeft(t.durationSec);
        if (t.result) {
          setResult(t.result);
          setPhase("done");
        } else if (t.closed) {
          setPhase("closed");
        } else if (t.startedAt && t.buggyCode) {
          // Reloaded mid-hunt: the server clock keeps running — no fresh 3 minutes.
          startedAtRef.current = toLocalClock(t.startedAt);
          setCode(t.buggyCode);
          setPhase("running");
          connectVoice();
        } else setPhase("ready");
      })
      .catch((e: Error) => {
        if (ctrl.signal.aborted) return;
        setError(e.message);
        setPhase("error");
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vivaId, attempt]);

  const submit = useCallback(
    async (_timedOut: boolean) => {
      if (!task || submittingRef.current) return;
      submittingRef.current = true;
      setPhase("checking");
      live.end();
      void exitExamMode();
      try {
        // Only the code goes up: time and explanation are taken from the server's own records.
        const r = await submitBugHunt(vivaId, codeRef.current);
        setResult(r);
        setPhase("done");
      } catch (e) {
        setError((e as Error).message);
        setPhase("running"); // let them retry submitting; the server clock keeps counting
        submittingRef.current = false;
      }
    },
    [task, live, vivaId],
  );

  const start = async () => {
    if (!task) return;
    void enterExamMode(); // must run inside the click
    setError(null);
    try {
      const s = await startBugHunt(vivaId);
      startedAtRef.current = toLocalClock(s.startedAt, s.serverNow);
      setCode(s.buggyCode);
      setTask({ ...task, buggyCode: s.buggyCode, startedAt: s.startedAt });
      setPhase("running");
      connectVoice();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // Countdown from the server's start time; auto-submit at zero.
  useEffect(() => {
    if (phase !== "running" || !task) return;
    const id = setInterval(() => {
      const remaining = Math.max(0, task.durationSec - Math.floor((Date.now() - startedAtRef.current) / 1000));
      setLeft(remaining);
      if (remaining === 0) void submit(true);
    }, 250);
    return () => clearInterval(id);
  }, [phase, task, submit]);

  // Ended by the server for integrity violations: close the hunt and say why.
  const [closedMessage, setClosedMessage] = useState<string | null>(null);
  useEffect(() => {
    if (live.error?.kind === "terminated") {
      setClosedMessage(live.error.message);
      setPhase("closed");
      void exitExamMode();
    }
  }, [live.error]);

  // Exam mode while the hunt runs: tab switches / focus / full-screen exits go to the server.
  const exam = useIntegrity(phase === "running" && live.status === "live", live.reportIntegrity, live.violations);

  // No pasting in (e.g. from an AI tool) and no copying out — attempts are recorded.
  // Depends only on the stable reportIntegrity callback, so listeners are attached exactly once.
  const report = live.reportIntegrity;
  const blockClipboard = useCallback(
    (node: HTMLElement | null) => {
      if (!node) return;
      const flash = () => {
        setBlockedNotice(true);
        window.setTimeout(() => setBlockedNotice(false), 3500);
      };
      const onPaste = (e: Event) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        report("paste_blocked");
        flash();
      };
      const onCopy = (e: Event) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        report("copy_blocked");
        flash();
      };
      const onBeforeInput = (e: InputEvent) => {
        if (e.inputType === "insertFromPaste" || e.inputType === "insertFromDrop") onPaste(e);
      };
      const onKey = (e: KeyboardEvent) => {
        const mod = e.ctrlKey || e.metaKey;
        if (mod && e.key.toLowerCase() === "v") onPaste(e);
        if (mod && (e.key.toLowerCase() === "c" || e.key.toLowerCase() === "x")) onCopy(e);
        if (e.shiftKey && e.key === "Insert") onPaste(e);
      };
      node.addEventListener("paste", onPaste, true);
      node.addEventListener("copy", onCopy, true);
      node.addEventListener("cut", onCopy, true);
      node.addEventListener("drop", onPaste, true);
      node.addEventListener("beforeinput", onBeforeInput as EventListener, true);
      node.addEventListener("keydown", onKey, true);
    },
    [report],
  );

  if (!vivaId) return <Shell><Missing /></Shell>;

  return (
    <Shell repoName={task?.repoName} locked={phase === "running"}>
      {phase === "loading" && <Preparing />}
      {phase === "error" && !task && <LoadError message={error ?? ""} onRetry={() => setAttempt((a) => a + 1)} />}
      {task && phase !== "loading" && (
        <div className="grid flex-1 gap-6 lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_340px]">
          {/* Editor */}
          <section className="flex min-h-[440px] flex-col overflow-hidden rounded-card bg-[#1f1f1f] shadow-lift lg:min-h-0">
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
              <div className="flex min-w-0 items-center gap-2 text-small text-[#c4c7c5]">
                <FileCode2 size={15} strokeWidth={1.5} className="shrink-0" />
                <span className="truncate font-mono" title={task.file}>
                  {task.file}
                </span>
                <span className="hidden shrink-0 rounded-full bg-white/10 px-2 py-0.5 font-mono text-[12px] sm:inline">
                  {task.functionName}()
                </span>
              </div>
              {phase === "running" && code !== task.buggyCode && (
                <button
                  type="button"
                  onClick={() => setCode(task.buggyCode ?? "")}
                  className="tap-target inline-flex shrink-0 items-center gap-1.5 rounded-ctl px-2 py-1 text-small text-[#c4c7c5] hover:bg-white/10 hover:text-white"
                >
                  <RotateCcw size={14} strokeWidth={1.5} />
                  Reset code
                </button>
              )}
            </div>
            <div className="relative flex-1" ref={blockClipboard}>
              <Editor
                value={code}
                onChange={(v) => setCode(v ?? "")}
                language={languageFor(task.file)}
                path={`bughunt/${task.file}`}
                theme="nirupi-dark"
                loading={<div className="grid h-full place-items-center text-small text-[#9aa0a6]">Opening the editor…</div>}
                options={{
                  readOnly: phase !== "running",
                  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                  fontSize: 14,
                  lineHeight: 22,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  padding: { top: 16, bottom: 16 },
                  lineNumbers: (n) => String(n + task.startLine - 1), // real line numbers from the file
                  renderLineHighlight: "line",
                  smoothScrolling: true,
                  tabSize: 2,
                  automaticLayout: true,
                  wordWrap: "on",
                  // Exam mode: no right-click menu (copy/paste) and no drag-and-drop of text.
                  contextmenu: false,
                  dragAndDrop: false,
                  dropIntoEditor: { enabled: false },
                }}
              />
              <AnimatePresence>
                {blockedNotice && (
                  <motion.p
                    role="status"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-x-4 bottom-4 rounded-ctl bg-[#3c2a00] px-4 py-2.5 text-small text-[#fde293]"
                  >
                    Copy and paste are off during the bug hunt. Type your fix, and the attempt is noted in your report.
                  </motion.p>
                )}
              </AnimatePresence>
              <ExamWarningOverlay
            open={exam.warningOpen}
            reason={exam.reason}
            count={exam.violations.count}
            max={exam.violations.max}
            problem={exam.fullscreenProblem}
            onResume={exam.resume}
          />
              {/* Before starting, the code is blurred so the 3 minutes are fair. */}
              <AnimatePresence>
                {phase === "ready" && (
                  <motion.div
                    initial={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.35 }}
                    className="absolute inset-0 grid place-items-center bg-[#1f1f1f]/70 backdrop-blur-md"
                  >
                    <p className="text-small text-[#c4c7c5]">The code appears when your timer starts.</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </section>

          {/* Side panel */}
          <aside className="flex flex-col gap-4 lg:min-h-0 lg:overflow-y-auto">
            <AnimatePresence mode="wait">
              {phase === "done" && result ? (
                <motion.div key="result" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-4">
                  <ResultCard result={result} durationSec={task.durationSec} vivaId={vivaId} />
                </motion.div>
              ) : phase === "closed" ? (
                <motion.div key="closed" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col gap-4">
                  <Card className="p-6">
                    <p className="font-heading text-h3">{closedMessage ? "Bug hunt ended" : "This bug hunt is closed"}</p>
                    <p className="mt-2 text-muted">
                      {closedMessage ??
                        "The report was opened before a fix was submitted, so the bug hunt can't be taken now. The report shows it as not attempted."}
                    </p>
                  </Card>
                  <Link
                    to={`/report/${encodeURIComponent(vivaId)}`}
                    className="inline-flex h-12 items-center justify-center rounded-ctl bg-accent-strong font-semibold text-white shadow-soft hover:bg-[#1765cc]"
                  >
                    See the report
                  </Link>
                </motion.div>
              ) : (
                <motion.div key="work" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-col gap-4">
                  <Card className="flex items-center gap-5 p-5">
                    <Countdown left={left} total={task.durationSec} running={phase === "running"} />
                    <div className="min-w-0">
                      <p className="text-small font-medium text-muted">Bug hunt</p>
                      <p className="font-heading text-h3">One small bug</p>
                      <p className="text-small text-muted">in your own {task.functionName}()</p>
                    </div>
                  </Card>

                  <Card className="p-5">
                    <div className="flex items-center gap-2 text-small font-medium text-muted">
                      <Bug size={14} strokeWidth={1.5} />
                      Your task
                    </div>
                    <p className="mt-2 text-body">{task.taskText}</p>
                  </Card>

                  {phase === "ready" ? (
                    <Card className="flex flex-col gap-4 p-5">
                      <p className="text-small text-muted">
                        You'll have {Math.round(task.durationSec / 60)} minutes, starting the moment you press start. Talk us through
                        what you're checking. It runs in full screen with copy and paste turned off, and we never run your code.
                      </p>
                      {error && (
                        <p role="alert" className="rounded-ctl bg-bad-soft px-3 py-2 text-small text-[#b3261e]">
                          {error}
                        </p>
                      )}
                      <Button size="lg" onClick={() => void start()} icon={<Mic size={18} strokeWidth={1.5} />}>
                        Start bug hunt
                      </Button>
                    </Card>
                  ) : (
                    <>
                      <ExplainCard live={live} />
                      {error && (
                        <p role="alert" className="rounded-ctl bg-bad-soft px-3 py-2 text-small text-[#b3261e]">
                          {error}
                        </p>
                      )}
                      <Button
                        size="lg"
                        onClick={() => submit(false)}
                        disabled={phase === "checking"}
                        icon={<Send size={18} strokeWidth={1.5} />}
                      >
                        {phase === "checking" ? "Checking your fix…" : "Submit fix"}
                      </Button>
                    </>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </aside>
        </div>
      )}
    </Shell>
  );
}

/* ---------------- pieces ---------------- */

function Shell({ children, repoName, locked = false }: { children: React.ReactNode; repoName?: string; locked?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh">
      <header className="mx-auto flex w-full max-w-[1100px] items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Logo disabled={locked} />
        {repoName && <span className="truncate text-small text-muted">{repoName}</span>}
      </header>
      <main id="main" tabIndex={-1} className="mx-auto flex w-full max-w-[1100px] flex-1 flex-col px-4 pb-6 sm:px-6 lg:min-h-0">{children}</main>
    </div>
  );
}

function Countdown({ left, total, running }: { left: number; total: number; running: boolean }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, left / total);
  const color = left <= 30 ? "var(--color-bad)" : left <= 60 ? "var(--color-warn)" : "var(--color-accent)";
  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, "0");
  return (
    <div className="relative grid size-[84px] shrink-0 place-items-center" role="timer" aria-label={`${mm} minutes ${ss} seconds left`}>
      <svg width="84" height="84" viewBox="0 0 84 84" className="-rotate-90">
        <circle cx="42" cy="42" r={r} fill="none" stroke="var(--color-subtle)" strokeWidth="6" />
        <circle
          cx="42"
          cy="42"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          style={{ transition: "stroke-dashoffset 250ms linear, stroke 400ms ease" }}
        />
      </svg>
      <span
        className={`absolute font-mono text-h3 font-semibold tabular-nums ${left <= 30 && running ? "animate-pulse" : ""}`}
        style={{ color: left <= 60 ? color : undefined }}
      >
        {mm}:{ss}
      </span>
    </div>
  );
}

function ExplainCard({ live }: { live: ReturnType<typeof useLiveSession> }) {
  const lastStudent = [...live.turns].reverse().find((t) => t.role === "student");
  const lastAi = [...live.turns].reverse().find((t) => t.role === "ai");
  const micOk = live.status === "live";
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-small font-medium text-muted">Explain as you go</span>
        {micOk ? (
          <button
            type="button"
            onClick={live.toggleMute}
            aria-pressed={live.muted}
            className={`tap-target inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-small font-medium ${
              live.muted ? "bg-bad-soft text-[#b3261e]" : "bg-good-soft text-[#137333]"
            }`}
          >
            {live.muted ? <MicOff size={13} strokeWidth={1.5} /> : <Mic size={13} strokeWidth={1.5} />}
            {live.muted ? "Muted" : "Listening"}
          </button>
        ) : live.status === "connecting" ? (
          <span className="text-small text-muted">Connecting…</span>
        ) : (
          <span className="text-small text-muted">Mic off</span>
        )}
      </div>
      {live.status === "error" ? (
        <p className="text-small text-muted">We couldn't use your microphone — that's okay, you can still fix the code and submit.</p>
      ) : (
        <div className="flex flex-col gap-2 text-small">
          {lastAi && <p className="rounded-xl rounded-tl-md bg-accent-soft px-3 py-2">{lastAi.text}</p>}
          {lastStudent ? (
            <p className="self-end rounded-xl rounded-tr-md bg-subtle px-3 py-2">{lastStudent.text}</p>
          ) : (
            <p className="text-muted">Say what you're checking, e.g. "I'm looking at the condition on this line…"</p>
          )}
        </div>
      )}
    </Card>
  );
}

const RESULT_STYLE = {
  solved: { label: "Solved", icon: CheckCircle2, tone: "bg-good-soft text-[#137333]", ring: "text-good" },
  partial: { label: "Partly solved", icon: CircleDashed, tone: "bg-warn-soft text-[#b06000]", ring: "text-warn" },
  not_solved: { label: "Not solved yet", icon: XCircle, tone: "bg-bad-soft text-[#b3261e]", ring: "text-bad" },
} as const;

function ResultCard({ result, durationSec, vivaId }: { result: BugHuntResult; durationSec: number; vivaId: string }) {
  const s = RESULT_STYLE[result.result];
  const used = result.timedOut ? durationSec : result.secondsUsed;
  return (
    <>
      <Card className="flex flex-col items-center gap-3 p-6 text-center">
        <motion.span initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 18 }}>
          <s.icon size={40} strokeWidth={1.5} className={s.ring} />
        </motion.span>
        <span className={`rounded-full px-3 py-1 text-small font-semibold ${s.tone}`}>{s.label}</span>
        <p className="text-body">{result.reason}</p>
        <p className="text-small text-muted">
          {result.timedOut ? "Time ran out" : `Finished in ${Math.floor(used / 60)}:${String(used % 60).padStart(2, "0")}`}
        </p>
      </Card>
      <Card className="p-5 text-small text-muted">
        That's the end of your viva. Your answers, fix and explanation are ready to be scored.
      </Card>
      <Link
        to={`/report/${encodeURIComponent(vivaId)}`}
        className="inline-flex h-12 items-center justify-center gap-2 rounded-ctl bg-accent-strong font-semibold text-white shadow-soft hover:bg-[#1765cc] hover:shadow-lift"
      >
        See my report
      </Link>
    </>
  );
}

function Preparing() {
  return (
    <div className="grid flex-1 place-items-center py-20">
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="relative grid size-12 place-items-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-accent/20 [animation-duration:1.6s]" />
          <span className="relative grid size-12 place-items-center rounded-full bg-accent-soft text-accent-strong">
            <Bug size={22} strokeWidth={1.5} />
          </span>
        </span>
        <h1 className="font-display text-[2rem] leading-tight">Setting up your bug hunt</h1>
        <p className="max-w-[360px] text-muted">Picking one of your own functions and slipping in a single small bug…</p>
      </div>
    </div>
  );
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="grid flex-1 place-items-center py-16">
      <Card className="flex max-w-[460px] flex-col items-center gap-4 px-6 py-10 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-warn-soft text-[#b06000]">
          <TriangleAlert size={22} strokeWidth={1.5} />
        </span>
        <h1 className="font-heading text-h2">The bug hunt couldn't load</h1>
        <p className="text-muted">{message}</p>
        <Button size="lg" onClick={onRetry} icon={<RotateCcw size={18} strokeWidth={1.5} />}>
          Try again
        </Button>
      </Card>
    </div>
  );
}

function Missing() {
  return (
    <div className="grid flex-1 place-items-center py-16">
      <Card className="flex max-w-[460px] flex-col items-center gap-4 px-6 py-10 text-center">
        <h1 className="font-heading text-h2">Start with your viva</h1>
        <p className="text-muted">The bug hunt comes right after your three questions.</p>
        <Link to="/" className="inline-flex h-12 items-center rounded-ctl bg-accent-strong px-6 font-semibold text-white shadow-soft">
          Connect a repo
        </Link>
      </Card>
    </div>
  );
}
