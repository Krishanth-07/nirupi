import { Mic, MicOff, PhoneOff } from "lucide-react";
import { Button } from "../ui/Button";

interface ControlBarProps {
  muted: boolean;
  onToggleMute: () => void;
  onEnd: () => void;
}

export function ControlBar({ muted, onToggleMute, onEnd }: ControlBarProps) {
  return (
    <div className="flex items-center justify-center gap-3">
      <Button
        variant="secondary"
        size="lg"
        onClick={onToggleMute}
        aria-pressed={muted}
        aria-label={muted ? "Unmute microphone" : "Mute microphone"}
        icon={muted ? <MicOff size={18} strokeWidth={1.5} /> : <Mic size={18} strokeWidth={1.5} />}
        className={muted ? "text-[#b3261e]" : ""}
      >
        {muted ? "Unmute" : "Mute"}
      </Button>
      <Button variant="danger" size="lg" onClick={onEnd} icon={<PhoneOff size={18} strokeWidth={1.5} />}>
        End viva
      </Button>
    </div>
  );
}

export function MicPill({ muted, speaking }: { muted: boolean; speaking: boolean }) {
  const label = muted ? "Mic muted" : speaking ? "Hearing you" : "Mic on";
  return (
    <span
      role="status"
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-small font-medium ${
        muted ? "bg-bad-soft text-[#b3261e]" : "bg-good-soft text-[#137333]"
      }`}
    >
      {muted ? (
        <MicOff size={14} strokeWidth={1.5} />
      ) : (
        <span className="relative flex size-2">
          {speaking && <span className="absolute inset-0 animate-ping rounded-full bg-good opacity-60" />}
          <span className="relative size-2 rounded-full bg-good" />
        </span>
      )}
      {label}
    </span>
  );
}
