import { useCallback, useEffect, useRef, useState } from "react";

/** How long focus can be elsewhere (a notification, the address bar) before it counts as leaving. */
const WINDOW_LEFT_MS = 2000;

/**
 * Exam mode while a viva or bug hunt is live:
 *  - records tab switches, leaving the window, full-screen exits and navigation attempts (server-timestamped);
 *  - blocks the Back button and asks before reloading/closing;
 *  - shows a warning each time the server counts a violation (it ends the session at the limit).
 */
export function useIntegrity(
  active: boolean,
  report: (kind: string, detail?: string) => void,
  violations: { count: number; max: number },
) {
  const [leftFullscreen, setLeftFullscreen] = useState(false);
  const [fullscreenProblem, setFullscreenProblem] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(0);
  const [lastReason, setLastReason] = useState<ViolationReason>("left");
  const leaveTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!active) return;

    const onVisibility = () => {
      if (document.hidden) {
        setLastReason("tab");
        report("tab_hidden");
      } else report("tab_visible");
    };
    const onBlur = () => {
      report("window_blur");
      if (leaveTimer.current) window.clearTimeout(leaveTimer.current);
      leaveTimer.current = window.setTimeout(() => {
        // Still away, and not just a hidden tab (that's already recorded above).
        if (!document.hasFocus() && !document.hidden) {
          setLastReason("window");
          report("window_left");
        }
      }, WINDOW_LEFT_MS);
    };
    const onFocus = () => {
      if (leaveTimer.current) window.clearTimeout(leaveTimer.current);
      report("window_focus");
    };
    const onFullscreen = () => {
      if (!document.fullscreenElement) {
        setLastReason("fullscreen");
        setLeftFullscreen(true);
        report("fullscreen_exit");
      } else {
        setLeftFullscreen(false);
        setFullscreenProblem(null);
      }
    };

    // Back button: keep an extra history entry so "Back" lands here; record the attempt.
    history.pushState({ nirupiExam: true }, "", location.href);
    const onPopState = () => {
      history.pushState({ nirupiExam: true }, "", location.href);
      setLastReason("navigation");
      report("nav_attempt");
    };
    // Reload, close tab, or typing another address: the browser asks "Leave site?".
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("fullscreenchange", onFullscreen);
    window.addEventListener("popstate", onPopState);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      if (leaveTimer.current) window.clearTimeout(leaveTimer.current);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("fullscreenchange", onFullscreen);
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [active, report]);

  /** Must be called directly from a click: re-enters full screen if needed and dismisses the warning. */
  const resume = useCallback(() => {
    setAcknowledged(violations.count);
    if (!document.fullscreenElement && fullscreenSupported()) {
      void enterExamMode().then((r) => {
        if (r.ok) {
          setLeftFullscreen(false);
          setFullscreenProblem(null);
        } else setFullscreenProblem(r.reason);
      });
    }
  }, [violations.count]);

  const unacknowledged = violations.count > acknowledged;
  return {
    /** Show the warning: a new violation was counted, or the student is still out of full screen. */
    warningOpen: active && (unacknowledged || (leftFullscreen && fullscreenSupported())),
    reason: lastReason,
    violations,
    fullscreenProblem,
    stillOutOfFullscreen: leftFullscreen,
    resume,
  };
}

export type ViolationReason = "tab" | "window" | "fullscreen" | "navigation" | "left";

type FullscreenEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

/**
 * Full-screen "exam mode". Must be called synchronously from a click (browsers require a user gesture).
 * Never throws: resolves with the reason when the browser refuses, so the UI can explain it.
 */
export function enterExamMode(): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (document.fullscreenElement) return Promise.resolve({ ok: true });
  const el = document.documentElement as FullscreenEl;
  try {
    // Call synchronously (no await before this line) so the click still counts as the user gesture.
    const request = el.requestFullscreen ? el.requestFullscreen() : el.webkitRequestFullscreen?.();
    if (!request) {
      // Older WebKit returns nothing; no API at all means full screen isn't supported here.
      return Promise.resolve(
        el.webkitRequestFullscreen ? ({ ok: true } as const) : ({ ok: false, reason: "This browser doesn't support full screen." } as const),
      );
    }
    return Promise.resolve(request)
      .then(() => ({ ok: true }) as const)
      .catch((e: Error) => ({ ok: false, reason: e?.message || "The browser blocked full screen." }) as const);
  } catch (e) {
    return Promise.resolve({ ok: false, reason: (e as Error)?.message || "The browser blocked full screen." });
  }
}

export async function exitExamMode(): Promise<void> {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
  } catch {
    /* ignore */
  }
}

/** Whether this device can do full screen at all (iPhones can't), so we don't ask for the impossible. */
export const fullscreenSupported = () =>
  typeof document !== "undefined" && !!(document.fullscreenEnabled || (document.documentElement as FullscreenEl).webkitRequestFullscreen);
