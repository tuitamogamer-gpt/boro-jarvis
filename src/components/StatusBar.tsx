import { useEffect, useState } from "react";
import type { RickyConnectionState, RickyMood } from "../lib/realtime";

type StatusBarProps = {
  connectionState: RickyConnectionState;
  mood: RickyMood;
  mode: "display" | "computer";
  status: string;
};

const MOOD_LABELS: Record<RickyMood, string> = {
  idle: "Standing by",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  working: "Working",
  error: "Error",
};

export function StatusBar({ connectionState, mood, mode, status }: StatusBarProps) {
  const [clock, setClock] = useState(() => formatClock());

  useEffect(() => {
    const timer = window.setInterval(() => setClock(formatClock()), 20_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <header className="status-bar">
      <div className="status-left">
        <span className={`status-dot status-dot-${connectionState}`} />
        <strong className="status-name">SPASOJE</strong>
        <span className="status-chip status-chip-version">MK&nbsp;II</span>
      </div>
      <div className="status-center" title={status}>
        <span className="status-message">{status}</span>
      </div>
      <div className="status-right">
        <span className={`status-chip status-chip-mood status-chip-mood-${mood}`}>{MOOD_LABELS[mood]}</span>
        <span className="status-chip status-chip-mode">{mode === "computer" ? "COMPUTER" : "DISPLAY"}</span>
        <span className="status-clock">{clock}</span>
      </div>
    </header>
  );
}

function formatClock(): string {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
