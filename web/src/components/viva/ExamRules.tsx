import { AnimatePresence, motion } from "framer-motion";
import { Maximize } from "lucide-react";
import { Button } from "../ui/Button";

/** The exam rules, shown before the viva starts. Kept short, plain and specific. */
export const EXAM_RULES: { title: string; body: string }[] = [
  { title: "Answer out loud, in your own words", body: "The examiner only listens to your voice. Typed answers aren't accepted." },
  { title: "Stay in full screen", body: "The viva opens in full screen. Leaving it, or switching tabs or windows, is recorded in your report." },
  { title: "Close other apps and AI tools", body: "Have only your own code open. The time you take before each answer is measured." },
  { title: "Three minutes for the bug hunt", body: "The timer starts when you press start and can't be paused or reset. Copy and paste are turned off." },
  { title: "Every attempt counts", body: "You can retake the viva, but each attempt is shown on your report." },
  { title: "Your voice is transcribed", body: "The transcript is saved for your report. A quiet room and headphones work best." },
];

export function ExamRules({ compact = false }: { compact?: boolean }) {
  return (
    <ol className={`flex flex-col ${compact ? "gap-2.5" : "gap-4"}`}>
      {EXAM_RULES.map((r, i) => (
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
export function RulesConsent({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="tap-target flex cursor-pointer items-start gap-3 rounded-ctl text-left">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 size-4 shrink-0 accent-[#1a73e8]"
      />
      <span className="text-body">I've read the rules and I'm ready. I'll answer on my own, without help.</span>
    </label>
  );
}

/**
 * Shown when the student leaves full screen mid-viva. The session keeps running underneath;
 * it explains what was recorded, offers a one-click return, and never traps them.
 */
export function ExamPauseOverlay({
  open,
  problem,
  onReturn,
  onDismiss,
}: {
  open: boolean;
  problem: string | null;
  onReturn: () => void;
  onDismiss: () => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="exam-pause-title"
        >
          <motion.div
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="w-full max-w-[440px] rounded-card bg-surface p-6 shadow-lift"
          >
            <h2 id="exam-pause-title" className="font-heading text-h2">
              You left full screen
            </h2>
            <p className="mt-2 text-muted">
              That's noted in your report. Your viva is still running, so go back to full screen to carry on.
            </p>
            {problem && (
              <p role="alert" className="mt-4 rounded-ctl bg-warn-soft px-4 py-3 text-small text-[#8a5300]">
                Your browser didn't allow it ({problem}). Press <kbd className="font-mono">F11</kbd> on Windows, or{" "}
                <kbd className="font-mono">Ctrl+Cmd+F</kbd> on a Mac, to go full screen yourself.
              </p>
            )}
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button size="lg" autoFocus onClick={onReturn} icon={<Maximize size={18} strokeWidth={1.5} />}>
                Return to full screen
              </Button>
              <button type="button" onClick={onDismiss} className="tap-target rounded-ctl px-2 py-2 text-small font-medium text-muted hover:text-ink">
                Continue without full screen
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
