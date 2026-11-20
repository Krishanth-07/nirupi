/** Integrity signals: recorded with SERVER timestamps and stages, shown neutrally to reviewers. */

export const INTEGRITY_KINDS = [
  "tab_hidden", // the viva/bug-hunt tab went to the background
  "tab_visible",
  "window_blur", // focus moved to another window/app
  "window_focus",
  "fullscreen_exit", // left full-screen exam mode
  "paste_blocked", // tried to paste into the bug-hunt editor
  "copy_blocked", // tried to copy code out of the bug-hunt editor
] as const;
export type IntegrityKind = (typeof INTEGRITY_KINDS)[number] | "reconnect";

export interface IntegrityEvent {
  kind: IntegrityKind;
  stage: string;
  at: string; // server time
  detail?: string;
}

export interface IntegrityLog {
  events: IntegrityEvent[];
  /** Seconds between the examiner finishing a main question and the student starting to answer. */
  answerDelays: Record<string, number>;
}

export const emptyIntegrity = (): IntegrityLog => ({ events: [], answerDelays: {} });

export interface IntegritySummary {
  tabSwitches: number;
  secondsAway: number;
  windowBlurs: number;
  fullscreenExits: number;
  pasteAttempts: number;
  copyAttempts: number;
  reconnects: number;
  answerDelays: Record<string, number>;
  flags: string[];
}

const STAGE_NAME: Record<string, string> = { warmup: "the introduction", q1: "question 1", q2: "question 2", q3: "question 3", done: "the wrap-up", bug: "the bug hunt" };

/** Turns the raw event log into counts and neutral, human-readable flags. */
export function summariseIntegrity(log: IntegrityLog | undefined): IntegritySummary {
  const events = log?.events ?? [];
  const count = (k: IntegrityKind) => events.filter((e) => e.kind === k).length;

  // Time away = each hidden→visible gap.
  let secondsAway = 0;
  let hiddenAt: number | null = null;
  const awayByStage: Record<string, number> = {};
  for (const e of events) {
    if (e.kind === "tab_hidden") hiddenAt = Date.parse(e.at);
    if (e.kind === "tab_visible" && hiddenAt !== null) {
      const s = (Date.parse(e.at) - hiddenAt) / 1000;
      secondsAway += s;
      awayByStage[e.stage] = (awayByStage[e.stage] ?? 0) + s;
      hiddenAt = null;
    }
  }

  const s: IntegritySummary = {
    tabSwitches: count("tab_hidden"),
    secondsAway: Math.round(secondsAway),
    windowBlurs: count("window_blur"),
    fullscreenExits: count("fullscreen_exit"),
    pasteAttempts: count("paste_blocked"),
    copyAttempts: count("copy_blocked"),
    reconnects: count("reconnect"),
    answerDelays: log?.answerDelays ?? {},
    flags: [],
  };

  for (const [stage, secs] of Object.entries(awayByStage)) {
    if (secs >= 3) s.flags.push(`Left the tab for ${Math.round(secs)}s during ${STAGE_NAME[stage] ?? stage}.`);
  }
  if (s.windowBlurs - s.tabSwitches >= 2) s.flags.push(`Switched to another window ${s.windowBlurs} times.`);
  if (s.fullscreenExits > 0) s.flags.push(`Left full-screen mode ${s.fullscreenExits} time${s.fullscreenExits === 1 ? "" : "s"}.`);
  if (s.pasteAttempts > 0) s.flags.push(`Tried to paste into the bug-hunt editor ${s.pasteAttempts} time${s.pasteAttempts === 1 ? "" : "s"} (blocked).`);
  if (s.copyAttempts > 0) s.flags.push(`Tried to copy code out of the bug-hunt editor ${s.copyAttempts} time${s.copyAttempts === 1 ? "" : "s"} (blocked).`);
  if (s.reconnects > 0) s.flags.push(`The voice connection was re-opened ${s.reconnects} time${s.reconnects === 1 ? "" : "s"}.`);
  for (const [stage, secs] of Object.entries(s.answerDelays)) {
    if (secs >= 12) s.flags.push(`Took ${Math.round(secs)}s to start answering ${STAGE_NAME[stage] ?? stage}.`);
  }
  return s;
}
