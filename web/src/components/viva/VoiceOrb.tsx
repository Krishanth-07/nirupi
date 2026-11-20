import { useEffect, useRef, useState } from "react";
import type { LiveStatus, Speaker } from "../../lib/live/useLiveSession";

interface VoiceOrbProps {
  status: LiveStatus;
  getLevels: () => { level: number; speaker: Speaker };
  onSpeakerChange?: (s: Speaker) => void;
  /** "lg" when the orb is the focus; "sm" when other content (rules, code) needs the space. */
  size?: "lg" | "sm";
}

/** Audio-reactive orb. Levels are written straight to CSS variables every frame (no re-renders). */
export function VoiceOrb({ status, getLevels, onSpeakerChange, size = "lg" }: VoiceOrbProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [speaker, setSpeaker] = useState<Speaker>("none");

  useEffect(() => {
    if (status !== "live") {
      ref.current?.style.setProperty("--lvl", "0");
      setSpeaker("none");
      return;
    }
    let raf = 0;
    let smooth = 0;
    let current: Speaker = "none";
    let lastSwitch = 0;
    const tick = (t: number) => {
      const { level, speaker: s } = getLevels();
      // Fast attack, slow release feels natural.
      smooth = level > smooth ? smooth + (level - smooth) * 0.5 : smooth + (level - smooth) * 0.08;
      ref.current?.style.setProperty("--lvl", smooth.toFixed(3));
      // Debounce speaker changes so colour doesn't flicker between syllables.
      if (s !== current && (s !== "none" || t - lastSwitch > 450)) {
        current = s;
        lastSwitch = t;
        setSpeaker(s);
      } else if (s === current && s !== "none") {
        lastSwitch = t;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [status, getLevels]);

  useEffect(() => {
    onSpeakerChange?.(speaker);
  }, [speaker, onSpeakerChange]);

  const mode = status === "connecting" ? "orb-connecting" : speaker === "none" ? "orb-idle" : "";

  return (
    <div
      ref={ref}
      data-speaker={speaker}
      className={`orb ${mode} aspect-square transition-[width] duration-500 ${size === "sm" ? "w-[min(40vw,150px)]" : "w-[min(68vw,280px)]"} ${status === "ended" || status === "error" ? "opacity-60 grayscale-[0.4]" : ""}`}
      aria-hidden="true"
    >
      <span className="orb-ring orb-ring-3" />
      <span className="orb-ring orb-ring-2" />
      <span className="orb-ring orb-ring-1" />
      <span className="orb-core" />
    </div>
  );
}
