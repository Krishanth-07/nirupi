import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, FolderGit2, Headphones, Mic, MicOff, RotateCcw, ShieldAlert, WifiOff } from "lucide-react";
import { Logo } from "../components/ui/Logo";
import { Button } from "../components/ui/Button";
import { VoiceOrb } from "../components/viva/VoiceOrb";
import { TranscriptPanel } from "../components/viva/TranscriptPanel";
import { StepRail, WARMUP_STEPS, type RailStep } from "../components/viva/StepRail";
import { ControlBar, MicPill } from "../components/viva/ControlBar";
import { useLiveSession, type LiveError, type Speaker } from "../lib/live/useLiveSession";
import { liveRelayPath, startViva, type VivaStart } from "../lib/api";
import { enterExamMode, exitExamMode, useIntegrity } from "../lib/integrity";
import { ExamRules, ExamWarningOverlay, RulesConsent } from "../components/viva/ExamRules";

const STAGE_ORDER = ["warmup", "q1", "q2", "q3", "done"];

export default function VivaRoom() {
  const [params] = useSearchParams();
  const location = useLocation();
  const repoId = params.get("repoId") ?? (location.state as { repoId?: string } | null)?.repoId ?? null;
  const isViva = !!repoId;

  const navigate = useNavigate();
  const live = useLiveSession();
  const [speaker, setSpeaker] = useState<Speaker>("none");
  const [stage, setStage] = useState("warmup");
  const [viva, setViva] = useState<VivaStart | null>(null);

  // Refs so callbacks from the live session always see the latest values.
  const vivaIdRef = useRef<string | null>(null);
  const stageRef = useRef("warmup");
  stageRef.current = stage;

  // The server records the transcript and stage itself; the browser only mirrors them for display.
  const moveTo = useCallback(
    (next: string) => {
      if (STAGE_ORDER.indexOf(next) <= STAGE_ORDER.indexOf(stageRef.current)) return;
      stageRef.current = next;
      setStage(next);
      live.setStageTag(next);
    },
    [live],
  );

  const onToolCall = useCallback(
    async (name: string, args: Record<string, unknown>) => {
      if (name === "set_stage" && typeof args.stage === "string") moveTo(args.stage);
      if (name === "finish_viva") {
        moveTo("done");
        await live.whenSilent(); // let the examiner finish their goodbye
        live.end();
      }
    },
    [live, moveTo],
  );

  const begin = useCallback(() => {
    setStage("warmup");
    stageRef.current = "warmup";
    vivaIdRef.current = null;
    setViva(null);
    if (isViva) void enterExamMode(); // full-screen must be requested inside the click
    void live.start(
      isViva
        ? {
            relay: async () => {
              const v = await startViva(repoId!);
              vivaIdRef.current = v.vivaId;
              setViva(v);
              return liveRelayPath(v.vivaId, "viva");
            },
            onToolCall,
          }
        : { relay: async () => "/api/live?mode=warmup" },
    );
  }, [isViva, repoId, live, onToolCall]);

  // Exam mode: tab switches, window focus and full-screen exits go to the server while the viva is live.
  const exam = useIntegrity(isViva && live.status === "live", live.reportIntegrity, live.violations);
  useEffect(() => {
    if (live.status === "ended" || live.status === "error") void exitExamMode();
  }, [live.status]);

  const steps: RailStep[] = useMemo(() => {
    if (!viva) return WARMUP_STEPS;
    return [
      { id: "warmup", label: "Hello", detail: "A quick introduction", icon: "warmup" },
      ...viva.questions.map((q, i) => ({
        id: q.id,
        label: `Question ${i + 1}`,
        detail: `${q.file.split("/").pop()}:${q.line}`,
        file: q.file,
        excerpt: { ...q.excerpt, line: q.line },
      })),
      { id: "bug", label: "Bug hunt", detail: "Fix a small change", icon: "bug" as const },
    ];
  }, [viva]);

  const activeId = stage === "done" ? "bug" : stage;
  const doneIds = STAGE_ORDER.slice(0, Math.max(0, STAGE_ORDER.indexOf(stage)));
  const repoLabel = viva?.repoName ?? repoId?.replace("__", "/") ?? null;
  const questionNo = ["q1", "q2", "q3"].indexOf(stage) + 1;

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh">
      <header className="mx-auto flex w-full max-w-[1100px] items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Logo disabled={isViva && live.status === "live"} />
        <div className="flex items-center gap-3">
          {live.status === "live" && <Elapsed since={live.startedAt} />}
          {live.status === "live" && <MicPill muted={live.muted} speaking={speaker === "student"} />}
        </div>
      </header>

      <main id="main" tabIndex={-1} className="mx-auto grid w-full max-w-[1100px] flex-1 gap-6 px-4 pb-6 sm:px-6 lg:min-h-0 lg:grid-cols-[240px_minmax(0,1fr)_340px]">
        {/* Left: progress */}
        <aside className="flex flex-col gap-4 lg:min-h-0 lg:overflow-y-auto lg:pt-2">
          <StepRail steps={steps} activeId={activeId} doneIds={doneIds} />
          {repoLabel && (
            <div className="hidden items-center gap-2 px-3 text-small text-muted lg:flex">
              <FolderGit2 size={14} strokeWidth={1.5} className="shrink-0" />
              <span className="truncate" title={repoLabel}>
                {repoLabel}
              </span>
            </div>
          )}
        </aside>

        {/* Centre: the orb */}
        <section className="relative flex flex-col items-center justify-center gap-8 rounded-card bg-surface px-6 py-10 shadow-soft lg:py-0">
          {live.status === "live" && isViva && (
            <motion.span
              key={stage}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              className="absolute top-5 rounded-full bg-accent-soft px-3 py-1 text-small font-medium text-accent-strong"
            >
              {questionNo > 0 ? `Question ${questionNo} of 3` : stage === "done" ? "Wrapping up" : "Getting started"}
              {viva && viva.attempt > 1 ? `, attempt ${viva.attempt}` : ""}
            </motion.span>
          )}

          <ExamWarningOverlay
            open={exam.warningOpen}
            reason={exam.reason}
            count={exam.violations.count}
            max={exam.violations.max}
            problem={exam.fullscreenProblem}
            onResume={exam.resume}
          />

          <VoiceOrb status={live.status} getLevels={live.getLevels} onSpeakerChange={setSpeaker} />

          <AnimatePresence mode="wait">
            <motion.div
              key={live.status + (live.error?.kind ?? "")}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="flex w-full max-w-[380px] flex-col items-center gap-6 text-center"
            >
              {live.status === "idle" && <IdleIntro isViva={isViva} onStart={begin} />}
              {live.status === "connecting" && (
                <StatusLine
                  title={isViva ? "Preparing your examiner…" : "Connecting to your examiner…"}
                  sub={isViva ? "Loading your three questions." : "This takes a second or two."}
                />
              )}
              {live.status === "live" && (
                <>
                  <StatusLine
                    title={
                      live.muted
                        ? "You're muted"
                        : speaker === "ai"
                          ? "Nirupi is speaking"
                          : speaker === "student"
                            ? "Listening…"
                            : "Your turn — speak naturally"
                    }
                    sub={live.muted ? "Unmute when you're ready to answer." : "Take your time. You can interrupt at any time."}
                  />
                  <ControlBar muted={live.muted} onToggleMute={live.toggleMute} onEnd={live.end} />
                </>
              )}
              {live.status === "ended" && (
                <EndedCard
                  isViva={isViva}
                  completed={stage === "done"}
                  turns={live.turns.length}
                  onRestart={begin}
                  onBugHunt={vivaIdRef.current ? () => navigate(`/bughunt?vivaId=${encodeURIComponent(vivaIdRef.current!)}`) : undefined}
                  reportHref={vivaIdRef.current ? `/report/${encodeURIComponent(vivaIdRef.current)}` : undefined}
                />
              )}
              {live.status === "error" && live.error && (
                <ErrorCard
                  error={live.error}
                  onRetry={begin}
                  reportHref={vivaIdRef.current ? `/report/${encodeURIComponent(vivaIdRef.current)}` : undefined}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </section>

        {/* Right: transcript */}
        <div className="lg:min-h-0">
          <TranscriptPanel turns={live.turns} status={live.status} />
        </div>
      </main>
    </div>
  );
}

function IdleIntro({ isViva, onStart }: { isViva: boolean; onStart: () => void }) {
  const [agreed, setAgreed] = useState(false);
  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-[2rem] leading-tight">{isViva ? "Before you start" : "Ready for a quick warm-up?"}</h1>
        {!isViva && <p className="text-muted">A short spoken chat about something you built. No trick questions.</p>}
      </div>
      {isViva && (
        <div className="flex w-full flex-col gap-5 rounded-card bg-bg p-5 text-left ring-1 ring-line">
          <ExamRules compact />
          <RulesConsent checked={agreed} onChange={setAgreed} />
        </div>
      )}
      <Button
        size="lg"
        onClick={onStart}
        disabled={isViva && !agreed}
        icon={<Mic size={18} strokeWidth={1.5} />}
        className="w-full sm:w-auto"
      >
        Start viva
      </Button>
      <p className="inline-flex items-center gap-2 text-small text-muted">
        <Headphones size={14} strokeWidth={1.5} />
        Headphones give the best experience.
      </p>
    </>
  );
}

function StatusLine({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="flex flex-col gap-1" role="status">
      <p className="font-heading text-h3">{title}</p>
      <p className="text-small text-muted">{sub}</p>
    </div>
  );
}

function EndedCard({
  isViva,
  completed,
  turns,
  onRestart,
  onBugHunt,
  reportHref,
}: {
  isViva: boolean;
  completed: boolean;
  turns: number;
  onRestart: () => void;
  onBugHunt?: () => void;
  reportHref?: string;
}) {
  if (isViva) {
    return (
      <>
        <div className="flex flex-col items-center gap-2">
          <CheckCircle2 size={28} strokeWidth={1.5} className={completed ? "text-good" : "text-muted"} />
          <h2 className="font-display text-[2rem] leading-tight">{completed ? "Questions complete" : "Viva paused"}</h2>
          <p className="text-muted">
            {completed
              ? "Great work. Your answers are saved — next up is a short bug hunt."
              : "We saved everything you said so far. You can start again whenever you're ready."}
          </p>
        </div>
        <div className="flex w-full flex-col items-center gap-3">
          {onBugHunt && (
            <Button
              size="lg"
              onClick={onBugHunt}
              className={`w-full sm:w-auto ${completed ? "" : "hidden"}`}
            >
              Continue to bug hunt
            </Button>
          )}
          <Button variant={completed ? "ghost" : "secondary"} size={completed ? "md" : "lg"} onClick={onRestart} icon={<RotateCcw size={16} strokeWidth={1.5} />}>
            {completed ? "Retake the viva" : "Start again"}
          </Button>
          {!completed && onBugHunt && (
            <button type="button" onClick={onBugHunt} className="tap-target rounded-ctl px-2 py-1 text-small font-medium text-accent-strong hover:underline">
              Skip to the bug hunt
            </button>
          )}
          {!completed && reportHref && (
            <Link to={reportHref} className="tap-target rounded-ctl px-2 py-1 text-small font-medium text-muted hover:text-ink hover:underline">
              Get my report with what I've answered
            </Link>
          )}
        </div>
      </>
    );
  }
  return (
    <>
      <div className="flex flex-col items-center gap-2">
        <CheckCircle2 size={28} strokeWidth={1.5} className="text-good" />
        <h2 className="font-display text-[2rem] leading-tight">Nicely done</h2>
        <p className="text-muted">
          {turns > 0
            ? `Warm-up complete — ${turns} ${turns === 1 ? "message" : "messages"} captured.`
            : "The session ended before anything was said."}
        </p>
      </div>
      <div className="flex flex-col items-center gap-3">
        <Button variant="secondary" size="lg" onClick={onRestart} icon={<RotateCcw size={18} strokeWidth={1.5} />}>
          Start again
        </Button>
        <Link to="/" className="tap-target rounded-ctl px-3 py-1 text-small font-medium text-accent-strong hover:underline">
          Connect your repo for the real viva
        </Link>
      </div>
    </>
  );
}

function ErrorCard({ error, onRetry, reportHref }: { error: LiveError; onRetry: () => void; reportHref?: string }) {
  const isMic = error.kind === "mic";
  if (error.kind === "terminated") {
    return (
      <>
        <div className="flex flex-col items-center gap-3">
          <span className="grid size-11 place-items-center rounded-full bg-bad-soft text-[#b3261e]">
            <ShieldAlert size={20} strokeWidth={1.5} />
          </span>
          <h2 className="font-heading text-h2">Viva ended</h2>
          <p className="text-muted">{error.message}</p>
        </div>
        {reportHref && (
          <Link
            to={reportHref}
            className="inline-flex h-12 items-center justify-center rounded-ctl bg-accent-strong px-6 font-semibold text-white shadow-soft hover:bg-[#1765cc]"
          >
            See the report
          </Link>
        )}
      </>
    );
  }
  return (
    <>
      <div className="flex flex-col items-center gap-3">
        <span className="grid size-11 place-items-center rounded-full bg-warn-soft text-[#b06000]">
          {isMic ? <MicOff size={20} strokeWidth={1.5} /> : <WifiOff size={20} strokeWidth={1.5} />}
        </span>
        <h2 className="font-heading text-h2">{isMic ? "Microphone needed" : "The connection dropped"}</h2>
        <p className="text-muted">{error.message}</p>
        {isMic && (
          <p className="text-small text-muted">Click the lock icon in your address bar, allow the microphone, then try again.</p>
        )}
      </div>
      <Button size="lg" onClick={onRetry} icon={<RotateCcw size={18} strokeWidth={1.5} />}>
        Try again
      </Button>
    </>
  );
}

function Elapsed({ since }: { since: number | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const s = since ? Math.max(0, Math.floor((now - since) / 1000)) : 0;
  return (
    <span className="font-mono text-small tabular-nums text-muted" aria-label="Elapsed time">
      {String(Math.floor(s / 60)).padStart(2, "0")}:{String(s % 60).padStart(2, "0")}
    </span>
  );
}
