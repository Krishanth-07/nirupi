import { AnimatePresence, motion } from "framer-motion";
import { Maximize } from "lucide-react";
import { Button } from "../ui/Button";
import type { ViolationReason } from "../../lib/integrity";

type Rule = { title: string; body: string };

/** Assessment rules (for hiring): strict, shown before the viva starts. Kept short, plain and specific. */
export const ASSESSMENT_RULES: Rule[] = [
  { title: "Answer out loud, in your own words", body: "The examiner only listens to your voice. Typed answers aren't accepted." },
  {
    title: "Stay on this page, in full screen",
    body: "Switching tabs or apps, leaving full screen, or going back counts as a violation. You get two warnings; the third ends the viva and flags your report.",
  },
  { title: "Close other apps and AI tools", body: "Have only your own code open. The time you take before each answer is measured." },
  { title: "Three minutes for the bug hunt", body: "The timer starts when you press start and can't be paused or reset. Copy and paste are turned off." },
  { title: "The company sees every attempt", body: "You can retake the assessment, but each attempt is shown to the hiring team." },
  { title: "Your voice is transcribed", body: "The transcript is saved for your report. A quiet room and headphones work best." },
];

/** Practice rules (for training): same format as the real thing, but nothing ends the session. */
export const PRACTICE_RULES: Rule[] = [
  { title: "Answer out loud, in your own words", body: "It's the same viva a company would run, so treat it like the real thing." },
  {
    title: "Exam rules are on, but only as warnings",
    body: "Leaving the page or full screen shows a warning, just like an assessment, but it won't end your practice.",
  },
  { title: "Three minutes for the bug hunt", body: "Practise thinking aloud while you debug. Copy and paste are turned off, as in an assessment." },
  { title: "Only you see this report", body: "Practice reports never appear in a company's hiring dashboard. Retake as often as you like." },
  { title: "Your voice is transcribed", body: "You'll get the transcript and a list of what to practise next. Headphones work best." },
];

export function ExamRules({ compact = false, practice = false }: { compact?: boolean; practice?: boolean }) {
  const rules = practice ? PRACTICE_RULES : ASSESSMENT_RULES;
  return (
    <ol className={`flex flex-col ${compact ? "gap-2.5" : "gap-4"}`}>
      {rules.map((r, i) => (
        <li key={r.title} className="flex gap-3">
          <span className="w-4 shrink-0 pt-px font-heading text-muted tabular-nums">{i + 1}</span>
          <div>
            <p className={compact ? "text-small font-medium" : "font-medium"}>{r.title}</p>
            {!compact && <p className="mt-0.5 text-small text-muted">{r.body}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** "I understand" checkbox that gates the Start button. */
export function RulesConsent({ checked, onChange, practice = false }: { checked: boolean; onChange: (v: boolean) => void; practice?: boolean }) {
  return (
    <label className="tap-target flex cursor-pointer items-start gap-3 rounded-ctl text-left">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 size-4 shrink-0 accent-[#1a73e8]"
      />
      <span className="text-body">
        {practice ? "I've read how practice works and I'm ready." : "I've read the rules and I'm ready. I'll answer on my own, without help."}
      </span>
    </label>
  );
}

const REASON_TEXT: Record<ViolationReason, string> = {
  tab: "You switched to another tab.",
  window: "You switched to another app or window.",
  fullscreen: "You left full screen.",
  navigation: "You tried to leave the viva page.",
  left: "You left the exam window.",
};

/**
 * Exam-mode warning. Appears each time the server counts a violation (and while the student is out of
 * full screen). The session keeps running underneath; at the limit the server ends it.
 */
export function ExamWarningOverlay({
  open,
  reason,
  count,
  max,
  problem,
  onResume,
}: {
  open: boolean;
  reason: ViolationReason;
  count: number;
  max: number;
  problem: string | null;
  onResume: () => void;
}) {
  const left = Math.max(0, max - count);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4 backdrop-blur-sm"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="exam-warning-title"
          aria-describedby="exam-warning-body"
        >
          <motion.div initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="w-full max-w-[460px] rounded-card bg-surface p-6 shadow-lift">
            {count > 0 &&
              (max === 0 ? (
                <p className="inline-flex rounded-full bg-warn-soft px-3 py-1 text-small font-semibold text-[#8a5300]">Practice warning {count}</p>
              ) : (
                <p className="inline-flex rounded-full bg-bad-soft px-3 py-1 text-small font-semibold text-[#b3261e]">
                  Violation {count} of {max}
                </p>
              ))}
            <h2 id="exam-warning-title" className="mt-3 font-heading text-h2">
              {REASON_TEXT[reason]}
            </h2>
            <p id="exam-warning-body" className="mt-2 text-muted">
              {count === 0
                ? "Please go back to full screen to continue your viva."
                : max === 0
                  ? "In a company assessment this would count as a violation, and the third one ends the viva. Practice staying on the page."
                  : left === 1
                    ? "This is recorded in your report. One more violation ends your viva and flags the report."
                    : `This is recorded in your report. ${left} more violations end your viva and flag the report.`}
            </p>
            {problem && (
              <p role="alert" className="mt-4 rounded-ctl bg-warn-soft px-4 py-3 text-small text-[#8a5300]">
                Your browser didn't allow full screen ({problem}). Press <kbd className="font-mono">F11</kbd> on Windows, or{" "}
                <kbd className="font-mono">Ctrl+Cmd+F</kbd> on a Mac.
              </p>
            )}
            <Button size="lg" autoFocus onClick={onResume} icon={<Maximize size={18} strokeWidth={1.5} />} className="mt-6 w-full sm:w-auto">
              Return to the viva
            </Button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}