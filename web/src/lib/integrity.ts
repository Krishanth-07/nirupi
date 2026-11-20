import { useCallback, useEffect, useState } from "react";

/**
 * Exam-mode integrity signals while a viva or bug hunt is live.
 * Events go to the server (which timestamps them); the student sees a calm notice, never an accusation.
 */
export function useIntegrity(active: boolean, report: (kind: string, detail?: string) => void) {
  const [leftFullscreen, setLeftFullscreen] = useState(false);
  const [fullscreenProblem, setFullscreenProblem] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!active) return;
    const onVisibility = () => report(document.hidden ? "tab_hidden" : "tab_visible");
    const onBlur = () => report("window_blur");
    const onFocus = () => report("window_focus");
    const onFullscreen = () => {
      if (!document.fullscreenElement) {
        report("fullscreen_exit");
        setLeftFullscreen(true);
        setDismissed(false);
      } else {
        setLeftFullscreen(false);
        setFullscreenProblem(null);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("fullscreenchange", onFullscreen);
    };
  }, [active, report]);

  /** Must be called directly from a click. Shows the browser's reason if it refuses. */
  const returnToFullscreen = useCallback(() => {
    void enterExamMode().then((r) => {
      if (r.ok) {
        setLeftFullscreen(false);
        setFullscreenProblem(null);
      } else setFullscreenProblem(r.reason);
    });
  }, []);

  return {
    leftFullscreen: active && leftFullscreen && !dismissed,
    fullscreenProblem,
    returnToFullscreen,
    /** Carry on without full screen (it's already been recorded). */
    dismiss: () => setDismissed(true),
  };
}

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
