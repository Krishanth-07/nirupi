import { AnimatePresence, motion } from "framer-motion";
import { Bug, Check, Sparkles } from "lucide-react";
import { Cite } from "../ui/Cite";

export interface RailStep {
  id: string;
  label: string;
  detail: string;
  icon?: "warmup" | "bug";
  /** Source file this step is about (shown as a citation tab). */
  file?: string;
  /** Code shown under the step while it's active (the line being discussed is highlighted). */
  excerpt?: { startLine: number; code: string; line: number };
}

export const WARMUP_STEPS: RailStep[] = [
  { id: "warmup", label: "Warm-up", detail: "Tell us about your project", icon: "warmup" },
  { id: "q1", label: "Question 1", detail: "About your code" },
  { id: "q2", label: "Question 2", detail: "About your code" },
  { id: "q3", label: "Question 3", detail: "About your code" },
  { id: "bug", label: "Bug hunt", detail: "Fix a small change", icon: "bug" },
];

export function StepRail({ steps, activeId, doneIds = [] }: { steps: RailStep[]; activeId: string; doneIds?: string[] }) {
  return (
    <nav aria-label="Viva progress">
      {/* Desktop: vertical list */}
      <ol className="hidden flex-col gap-1 lg:flex">
        {steps.map((s, i) => {
          const active = s.id === activeId;
          const done = doneIds.includes(s.id);
          return (
            <motion.li
              key={s.id}
              layout
              aria-current={active ? "step" : undefined}
              className={`flex flex-col rounded-ctl px-3 py-3 transition-colors ${active ? "bg-surface shadow-soft" : ""}`}
            >
              <div className="flex items-start gap-3">
                <span
                  className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-small font-semibold transition-colors ${
                    done ? "bg-good text-white" : active ? "bg-accent-strong text-white" : "bg-subtle text-muted"
                  }`}
                >
                  {done ? (
                    <Check size={14} strokeWidth={2} />
                  ) : s.icon === "warmup" ? (
                    <Sparkles size={13} strokeWidth={1.5} />
                  ) : s.icon === "bug" ? (
                    <Bug size={13} strokeWidth={1.5} />
                  ) : (
                    i
                  )}
                </span>
                <span className="flex min-w-0 flex-col items-start gap-1">
                  <span className={`font-heading text-body ${active ? "text-ink" : "text-muted"}`}>{s.label}</span>
                  {s.excerpt && s.file ? (
                    <Cite file={s.file} line={s.excerpt.line} tone={active ? "light" : "plain"} />
                  ) : (
                    <span className="truncate text-small text-muted" title={s.detail}>
                      {s.detail}
                    </span>
                  )}
                </span>
              </div>

              <AnimatePresence initial={false}>
                {active && s.excerpt && (
                  <motion.pre
                    initial={{ height: 0, opacity: 0, marginTop: 0 }}
                    animate={{ height: "auto", opacity: 1, marginTop: 12 }}
                    exit={{ height: 0, opacity: 0, marginTop: 0 }}
                    transition={{ duration: 0.3 }}
                    className="overflow-hidden rounded-ctl bg-[#1f1f1f] py-2 font-mono text-[11px] leading-[18px] text-[#e8eaed]"
                  >
                    <div className="overflow-x-auto">
                      {s.excerpt.code.split("\n").map((l, j) => {
                        const n = s.excerpt!.startLine + j;
                        return (
                          <div key={n} className={`whitespace-pre px-2 ${n === s.excerpt!.line ? "bg-[#4285f4]/30" : ""}`}>
                            <span className="mr-2 inline-block w-5 text-right text-[#9aa0a6] select-none">{n}</span>
                            {l || " "}
                          </div>
                        );
                      })}
                    </div>
                  </motion.pre>
                )}
              </AnimatePresence>
            </motion.li>
          );
        })}
      </ol>

      {/* Mobile: horizontal chips */}
      <ol className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:hidden">
        {steps.map((s) => {
          const active = s.id === activeId;
          const done = doneIds.includes(s.id);
          return (
            <li
              key={s.id}
              aria-current={active ? "step" : undefined}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-small font-medium ${
                active ? "bg-accent-strong text-white" : done ? "bg-good-soft text-[#137333]" : "bg-surface text-muted shadow-soft"
              }`}
            >
              {done && <Check size={12} strokeWidth={2} />}
              {s.label}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
