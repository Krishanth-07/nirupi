/** Integrity signals: recorded with SERVER timestamps and stages, shown neutrally to reviewers. */

export const INTEGRITY_KINDS = [
  "tab_hidden", // the viva/bug-hunt tab went to the background
  "tab_visible",
  "window_blur", // focus moved elsewhere (often harmless, e.g. a notification)
  "window_focus",
  "window_left", // focus stayed away for more than 2 seconds (switched to another app/window)
  "fullscreen_exit", // left full-screen exam mode
  "nav_attempt", // tried to go back / leave the viva page (blocked)
  "paste_blocked", // tried to paste into the bug-hunt editor
  "copy_blocked", // tried to copy code out of the bug-hunt editor
] as const;
export type IntegrityKind = (typeof INTEGRITY_KINDS)[number] | "reconnect";

/** Events that count towards the violation limit. */
export const VIOLATION_KINDS: IntegrityKind[] = ["tab_hidden", "window_left", "fullscreen_exit", "nav_attempt", "paste_blocked", "copy_blocked"];

/** Two warnings, then the third violation ends the session. Override with INTEGRITY_MAX_VIOLATIONS. */
export const MAX_VIOLATIONS = Math.max(1, Number(process.env.INTEGRITY_MAX_VIOLATIONS) || 3);

/** Events this close together are one incident (switching tabs also exits full screen, etc.). */
const INCIDENT_GAP_MS = 4000;

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
  /** Set when the server ended the session for exceeding the violation limit. */
  terminated?: { at: string; stage: string; violations: number };
}

export const emptyIntegrity = (): IntegrityLog => ({ events: [], answerDelays: {} });

/** Violation incidents so far (events within a few seconds of each other count once). */
export function countViolations(events: IntegrityEvent[]): number {
  let incidents = 0;
  let last = -Infinity;
  for (const e of events) {
    if (!VIOLATION_KINDS.includes(e.kind)) continue;
    const t = Date.parse(e.at);
    if (t - last > INCIDENT_GAP_MS) incidents++;
    last = t;
  }
  return incidents;
}

export interface IntegritySummary {
  status: "clear" | "warnings" | "flagged";
  violations: number;
  maxViolations: number;
  terminated: IntegrityLog["terminated"] | null;
  tabSwitches: number;
  secondsAway: number;
  windowBlurs: number;
  windowLeaves: number;
  fullscreenExits: number;
  navAttempts: number;
  pasteAttempts: number;
  copyAttempts: number;
  reconnects: number;
  answerDelays: Record<string, number>;
  flags: string[];
}

const STAGE_NAME: Record<string, string> = { warmup: "the introduction", q1: "question 1", q2: "question 2", q3: "question 3", done: "the wrap-up", bug: "the bug hunt" };
const times = (n: number) => `${n} time${n === 1 ? "" : "s"}`;

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

  const violations = countViolations(events);
  const terminated = log?.terminated ?? null;
  const s: IntegritySummary = {
    status: terminated ? "flagged" : violations > 0 ? "warnings" : "clear",
    violations,
    maxViolations: MAX_VIOLATIONS,
    terminated,
    tabSwitches: count("tab_hidden"),
    secondsAway: Math.round(secondsAway),
    windowBlurs: count("window_blur"),
    windowLeaves: count("window_left"),
    fullscreenExits: count("fullscreen_exit"),
    navAttempts: count("nav_attempt"),
    pasteAttempts: count("paste_blocked"),
    copyAttempts: count("copy_blocked"),
    reconnects: count("reconnect"),
    answerDelays: log?.answerDelays ?? {},
    flags: [],
  };

  if (terminated) {
    s.flags.push(`The session was ended during ${STAGE_NAME[terminated.stage] ?? terminated.stage} after ${terminated.violations} integrity violations.`);
  }
  for (const [stage, secs] of Object.entries(awayByStage)) {
    if (secs >= 3) s.flags.push(`Left the tab for ${Math.round(secs)}s during ${STAGE_NAME[stage] ?? stage}.`);
  }
  if (s.windowLeaves > 0) s.flags.push(`Switched to another app or window ${times(s.windowLeaves)}.`);
  if (s.fullscreenExits > 0) s.flags.push(`Left full-screen mode ${times(s.fullscreenExits)}.`);
  if (s.navAttempts > 0) s.flags.push(`Tried to leave the viva page ${times(s.navAttempts)} (blocked).`);
  if (s.pasteAttempts > 0) s.flags.push(`Tried to paste into the bug-hunt editor ${times(s.pasteAttempts)} (blocked).`);
  if (s.copyAttempts > 0) s.flags.push(`Tried to copy code out of the bug-hunt editor ${times(s.copyAttempts)} (blocked).`);
  if (s.reconnects > 0) s.flags.push(`The voice connection was re-opened ${times(s.reconnects)}.`);
  for (const [stage, secs] of Object.entries(s.answerDelays)) {
    if (secs >= 12) s.flags.push(`Took ${Math.round(secs)}s to start answering ${STAGE_NAME[stage] ?? stage}.`);
  }
  return s;
}
