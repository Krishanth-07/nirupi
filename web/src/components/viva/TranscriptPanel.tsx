import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MessageSquareText } from "lucide-react";
import type { LiveStatus, Turn } from "../../lib/live/useLiveSession";

export function TranscriptPanel({ turns, status }: { turns: Turn[]; status: LiveStatus }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [turns]);

  return (
    <section
      aria-label="Live transcript"
      className="flex min-h-[320px] flex-col rounded-card bg-surface shadow-soft lg:h-full lg:min-h-0"
    >
      <header className="flex items-center justify-between border-b border-line px-5 py-4">
        <h2 className="font-heading text-body">Transcript</h2>
        {status === "live" && (
          <span className="inline-flex items-center gap-1.5 text-small text-muted">
            <span className="size-1.5 animate-pulse rounded-full bg-bad" />
            Live
          </span>
        )}
      </header>

      {/* A chat log: screen readers hear each message once it's complete, not every streamed word. */}
      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-busy={turns.some((t) => !t.final)}
        aria-label="Conversation"
        tabIndex={0}
        className="flex-1 space-y-3 overflow-y-auto px-5 py-5"
      >
        {turns.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 py-8 text-center">
            <span className="grid size-10 place-items-center rounded-full bg-subtle text-muted">
              <MessageSquareText size={18} strokeWidth={1.5} />
            </span>
            <p className="max-w-[220px] text-small text-muted">
              {status === "live"
                ? "Your examiner is about to say hello. Answer out loud."
                : "Your conversation will appear here, word by word."}
            </p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {turns.map((t) => (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
                className={`flex flex-col gap-1 ${t.role === "student" ? "items-end" : "items-start"}`}
              >
                <span className="px-1 text-small font-medium text-muted">
                  {t.role === "ai" ? "Nirupi" : "You"}
                </span>
                <p
                  className={`max-w-[88%] rounded-2xl px-4 py-2.5 text-body ${
                    t.role === "ai"
                      ? "rounded-tl-md bg-accent-soft text-ink"
                      : "rounded-tr-md bg-subtle text-ink"
                  } ${t.final ? "" : "opacity-90"}`}
                >
                  {t.text.replace(/`/g, "")}
                  {!t.final && (
                    <span aria-hidden="true" className="ml-0.5 inline-block animate-pulse text-muted">
                      ▍
                    </span>
                  )}
                </p>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>
    </section>
  );
}
