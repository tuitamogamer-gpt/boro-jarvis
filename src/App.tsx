import { useEffect, useRef, useState } from "react";
import {
  BrainCircuit,
  Expand,
  FileText,
  Keyboard,
  MessageSquare,
  Mic,
  MicOff,
  MonitorCog,
  Send,
  Settings,
  VolumeX,
} from "lucide-react";
import { ArtifactPanel } from "./components/ArtifactPanel";
import { ChatPanel } from "./components/ChatPanel";
import { RickyFace } from "./components/RickyFace";
import { SettingsPopover } from "./components/SettingsPopover";
import { StatusBar } from "./components/StatusBar";
import { newEntry, RickyRealtimeClient, type MouthShape, type RickyConnectionState, type RickyMood, type TranscriptEntry } from "./lib/realtime";
import type { RickyArtifact, RickySettings, RickyTheme, RickyTimer } from "./vite-env";

type RickyMode = "display" | "computer";

const TRANSCRIPT_STORAGE_KEY = "ricky-transcript";
const TRANSCRIPT_LIMIT = 200;
const ARTIFACT_HISTORY_LIMIT = 24;

type ArtifactState = { items: RickyArtifact[]; index: number };

export default function App() {
  const [connectionState, setConnectionState] = useState<RickyConnectionState>("idle");
  const [mood, setMood] = useState<RickyMood>("idle");
  const [mode, setMode] = useState<RickyMode>("display");
  const [artifactState, setArtifactState] = useState<ArtifactState>({ items: [], index: -1 });
  const [artifactVisible, setArtifactVisible] = useState(true);
  const [booting, setBooting] = useState(true);
  const [timers, setTimers] = useState<RickyTimer[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [artifactFullscreen, setArtifactFullscreen] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showTypeInput, setShowTypeInput] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [mouthShape, setMouthShape] = useState<MouthShape>({ open: 0, width: 0.18, round: 0, teeth: 0 });
  const [inputLevel, setInputLevel] = useState(0);
  const [outputLevel, setOutputLevel] = useState(0);
  const [caption, setCaption] = useState("");
  const [muted, setMuted] = useState(false);
  const [settings, setSettings] = useState<RickySettings>({ voice: "cedar", theme: "cyan", eagerness: "medium", homeCity: "" });
  const [transcript, setTranscript] = useState<TranscriptEntry[]>(loadTranscript);
  const [status, setStatus] = useState("Standing by. Connect the mic to start.");
  const [textPrompt, setTextPrompt] = useState("");
  const clientRef = useRef<RickyRealtimeClient | null>(null);

  const isConnected = connectionState === "connected";
  const artifact = artifactState.index >= 0 ? artifactState.items[artifactState.index] ?? null : null;

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  useEffect(() => {
    const timer = window.setTimeout(() => setBooting(false), 2600);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (timers.length === 0) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [timers.length]);

  useEffect(() => {
    window.ricky
      .getSettings()
      .then((saved) => setSettings(saved))
      .catch(() => {});
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(TRANSCRIPT_STORAGE_KEY, JSON.stringify(transcript.slice(-TRANSCRIPT_LIMIT)));
    } catch {
      // Storage may be unavailable; skip persistence.
    }
  }, [transcript]);

  useEffect(() => {
    const unsubscribe = window.ricky.onEvent((payload) => {
      if (payload.type === "timer_fired") {
        playTimerChime();
        addEntry(newEntry("system", `⏰ Timer finished: ${payload.timer.label}`));
        clientRef.current?.notifyTimerFired(payload.timer.label);
      }
      if (payload.type === "timers_changed") {
        setTimers(payload.timers);
        setNow(Date.now());
      }
      if (payload.type === "artifact_push") {
        if (payload.artifact) handleIncomingArtifact(payload.artifact);
        if (payload.sound === "thumbnail" || payload.sound === "image") playThumbnailReadySound();
        if (payload.announce) clientRef.current?.notifyBackground(payload.announce);
      }
    });
    return unsubscribe;
  }, []);

  function addEntry(entry: TranscriptEntry) {
    setTranscript((items) => [...items, entry].slice(-TRANSCRIPT_LIMIT));
    if (entry.role === "user" || entry.role === "ricky") {
      void window.ricky.executeTool({ name: "memory_log", arguments: { role: entry.role, text: entry.text } }).catch(() => {});
    }
  }

  function handleIncomingArtifact(nextArtifact: RickyArtifact) {
    pushArtifact(nextArtifact);
    setArtifactVisible(true);
    if (nextArtifact.fullscreen) setArtifactFullscreen(true);
  }

  function pushArtifact(next: RickyArtifact) {
    setArtifactState((state) => {
      const items = [...state.items, next].slice(-ARTIFACT_HISTORY_LIMIT);
      return { items, index: items.length - 1 };
    });
  }

  function navigateArtifact(step: number) {
    setArtifactState((state) => ({
      ...state,
      index: Math.max(0, Math.min(state.items.length - 1, state.index + step)),
    }));
  }

  function cancelTimer(id: string) {
    void window.ricky.executeTool({ name: "timer_cancel", arguments: { id } }).catch(() => {});
  }

  async function connect() {
    clientRef.current?.disconnect();
    const client = new RickyRealtimeClient({
      onConnectionState: setConnectionState,
      onMood: setMood,
      onMouthShape: setMouthShape,
      onInputLevel: setInputLevel,
      onOutputLevel: setOutputLevel,
      onCaption: setCaption,
      onTranscript: addEntry,
      onTheme: (theme) => {
        if (isRickyTheme(theme)) setSettings((current) => ({ ...current, theme }));
      },
      onArtifact: handleIncomingArtifact,
      onMode: (nextMode) => {
        setMode(nextMode);
        if (nextMode === "computer") {
          setArtifactVisible(false);
          setArtifactFullscreen(false);
          setShowChat(false);
          setShowTypeInput(false);
          setShowSettings(false);
        } else {
          setArtifactVisible(true);
        }
      },
      onStatus: (message) => {
        setStatus(message);
        addEntry(newEntry("system", message));
      },
      onThumbnailReady: playThumbnailReadySound,
    });
    clientRef.current = client;
    setMuted(false);
    playConnectSound();
    await client.connect();
  }

  function disconnect() {
    clientRef.current?.disconnect();
    clientRef.current = null;
    setMuted(false);
    setStatus("Disconnected.");
    playDisconnectSound();
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    clientRef.current?.setMuted(next);
    setStatus(next ? "Microphone muted." : "Microphone live.");
  }

  async function switchMode(nextMode: RickyMode) {
    setMode(nextMode);
    const result = await window.ricky.executeTool({ name: "set_mode", arguments: { mode: nextMode } });
    if (result.artifact) pushArtifact(result.artifact);
    if (nextMode === "computer") {
      setArtifactVisible(false);
      setArtifactFullscreen(false);
      setShowChat(false);
      setShowTypeInput(false);
      setShowSettings(false);
    } else {
      setArtifactVisible(true);
    }
    addEntry(newEntry("system", `Mode switched to ${nextMode}.`));
  }

  async function startTehnosoftDemo() {
    const result = await window.ricky.executeTool({ name: "tehnosoft_demo_start", arguments: {} });
    if (result.artifact) {
      pushArtifact(result.artifact);
      setArtifactVisible(true);
      setArtifactFullscreen(false);
    }
    setStatus(result.message || "Tehnosoft demo loaded.");
    addEntry(newEntry("system", result.message || "Tehnosoft demo loaded."));
  }

  function sendTextPrompt() {
    const trimmed = textPrompt.trim();
    if (!trimmed) return;
    clientRef.current?.sendText(trimmed);
    setTextPrompt("");
  }

  function changeVoice(voice: string) {
    setSettings((current) => ({ ...current, voice }));
    void window.ricky.updateSettings({ voice }).catch(() => {});
  }

  function changeTheme(theme: RickyTheme) {
    setSettings((current) => ({ ...current, theme }));
    void window.ricky.updateSettings({ theme }).catch(() => {});
  }

  function changeEagerness(eagerness: RickySettings["eagerness"]) {
    setSettings((current) => ({ ...current, eagerness }));
    void window.ricky.updateSettings({ eagerness }).catch(() => {});
  }

  function changeHomeCity(homeCity: string) {
    setSettings((current) => ({ ...current, homeCity }));
    void window.ricky.updateSettings({ homeCity }).catch(() => {});
  }

  function clearTranscript() {
    setTranscript([]);
    try {
      window.localStorage.removeItem(TRANSCRIPT_STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  if (mode === "computer") {
    return (
      <main className="app-shell app-shell-mini">
        <section className="mini-companion" aria-label="Spasoje computer use mini mode">
          <RickyFace mood={mood} mouthShape={mouthShape} inputLevel={inputLevel} outputLevel={outputLevel} />
          <button
            className="mini-restore-button"
            onClick={() => void switchMode("display")}
            aria-label="Return to full Spasoje window"
            title="Return to full Spasoje window"
          >
            <Expand size={14} />
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <div className="window-drag-strip" aria-hidden="true" />
      {booting ? (
        <div className="boot-overlay" aria-hidden="true">
          <div className="boot-ring" />
          <div className="boot-title">
            SPASOJE <span>MK II</span>
          </div>
          <div className="boot-lines">
            <span>Initializing audio pipeline</span>
            <span>Loading toolkit</span>
            <span>Online</span>
          </div>
        </div>
      ) : null}
      <section className="companion-window">
        <StatusBar connectionState={connectionState} mood={mood} mode={mode} status={status} />

        <section className="face-stage">
          <div className="stage-ambient" aria-hidden="true" />
          <RickyFace mood={mood} mouthShape={mouthShape} inputLevel={inputLevel} outputLevel={outputLevel} />
          {caption ? (
            <div className="caption-bar" aria-live="polite">
              <p>{caption.length > 220 ? `…${caption.slice(-220)}` : caption}</p>
            </div>
          ) : null}
        </section>

        <footer className="bottom-console">
          {timers.length > 0 ? (
            <section className="timer-strip" aria-label="Active timers">
              {timers.map((timer) => (
                <span className="timer-chip" key={timer.id}>
                  <span className="timer-chip-dot" />
                  <strong>{timer.label}</strong>
                  <time>{formatCountdown((timer.endsAt ?? now) - now)}</time>
                  <button onClick={() => cancelTimer(timer.id)} aria-label={`Cancel timer ${timer.label}`} title="Cancel timer">
                    ×
                  </button>
                </span>
              ))}
            </section>
          ) : null}
          {showTypeInput ? (
            <section className="prompt-box">
              <input
                value={textPrompt}
                onChange={(event) => setTextPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") sendTextPrompt();
                  if (event.key === "Escape") setShowTypeInput(false);
                }}
                autoFocus
                placeholder="Type to Spasoje…"
              />
              <button onClick={sendTextPrompt} aria-label="Send typed prompt" title="Send typed prompt">
                <Send size={15} />
              </button>
            </section>
          ) : null}

          <section className="control-strip">
            <button
              className={isConnected ? "console-button active mic-button" : "console-button mic-button"}
              onClick={isConnected ? disconnect : () => void connect()}
              disabled={connectionState === "connecting"}
              aria-label={isConnected ? "Disconnect voice" : "Connect voice"}
              title={isConnected ? "Disconnect voice" : "Connect voice"}
            >
              <span className="mic-level" style={{ transform: `scaleY(${Math.min(1, inputLevel * 1.6)})` }} aria-hidden="true" />
              {isConnected ? <MicOff size={16} /> : <Mic size={16} />}
              <small>{connectionState === "connecting" ? "Linking…" : isConnected ? "Live" : "Connect"}</small>
            </button>
            {isConnected ? (
              <button
                className={muted ? "console-button warning active" : "console-button"}
                onClick={toggleMute}
                aria-label={muted ? "Unmute microphone" : "Mute microphone"}
                title={muted ? "Unmute microphone" : "Mute microphone"}
              >
                <VolumeX size={16} />
                <small>{muted ? "Muted" : "Mute"}</small>
              </button>
            ) : null}
            <button
              className={showTypeInput ? "console-button active" : "console-button"}
              onClick={() => setShowTypeInput((value) => !value)}
              aria-label="Type to Spasoje"
              title="Type to Spasoje"
            >
              <Keyboard size={16} />
              <small>Type</small>
            </button>
            <button
              className={showChat ? "console-button active" : "console-button"}
              onClick={() =>
                setShowChat((value) => {
                  if (!value) setShowSettings(false);
                  return !value;
                })
              }
              aria-label="Toggle conversation"
              title="Toggle conversation"
            >
              <MessageSquare size={16} />
              <small>Chat</small>
            </button>
            <button
              className={artifactVisible ? "console-button active" : "console-button"}
              onClick={() => setArtifactVisible((value) => !value)}
              aria-label="Toggle artifacts"
              title="Toggle artifacts"
            >
              <BrainCircuit size={16} />
              <small>Panel</small>
            </button>
            <button
              className="console-button demo"
              onClick={() => void startTehnosoftDemo()}
              aria-label="Start Tehnosoft demo"
              title="Start Tehnosoft demo"
            >
              <FileText size={16} />
              <small>Demo</small>
            </button>
            <button
              className={showSettings ? "console-button active" : "console-button"}
              onClick={() =>
                setShowSettings((value) => {
                  if (!value) setShowChat(false);
                  return !value;
                })
              }
              aria-label="Settings"
              title="Settings"
            >
              <Settings size={16} />
              <small>Setup</small>
            </button>
            <button
              className="console-button danger"
              onClick={() => void switchMode("computer")}
              aria-label="Computer use mode"
              title="Computer use mode"
            >
              <MonitorCog size={16} />
              <small>Control</small>
            </button>
          </section>
        </footer>

        {showSettings ? (
          <SettingsPopover
            settings={settings}
            isConnected={isConnected}
            onChangeVoice={changeVoice}
            onChangeTheme={changeTheme}
            onChangeEagerness={changeEagerness}
            onChangeHomeCity={changeHomeCity}
            onClose={() => setShowSettings(false)}
          />
        ) : null}

        {showChat ? <ChatPanel entries={transcript} onClear={clearTranscript} onClose={() => setShowChat(false)} /> : null}
      </section>

      <ArtifactPanel
        artifact={artifact}
        visible={artifactVisible}
        fullscreen={artifactFullscreen}
        canPrev={artifactState.index > 0}
        canNext={artifactState.index >= 0 && artifactState.index < artifactState.items.length - 1}
        onPrev={() => navigateArtifact(-1)}
        onNext={() => navigateArtifact(1)}
        onToggleVisible={() => setArtifactVisible((value) => !value)}
        onToggleFullscreen={() => setArtifactFullscreen((value) => !value)}
      />
    </main>
  );
}

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}:${String(minutes % 60).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function playConnectSound() {
  playTone([
    { frequency: 520, rampTo: 780, duration: 0.1 },
    { frequency: 780, rampTo: 1040, duration: 0.12, delay: 0.1 },
  ]);
}

function playDisconnectSound() {
  playTone([
    { frequency: 780, rampTo: 520, duration: 0.12 },
    { frequency: 520, rampTo: 390, duration: 0.14, delay: 0.11 },
  ]);
}

function isRickyTheme(value: string): value is RickyTheme {
  return value === "cyan" || value === "crimson" || value === "amber" || value === "emerald" || value === "violet";
}

function loadTranscript(): TranscriptEntry[] {
  try {
    const raw = window.localStorage.getItem(TRANSCRIPT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is TranscriptEntry =>
        Boolean(entry) && typeof entry === "object" && typeof (entry as TranscriptEntry).id === "string" && typeof (entry as TranscriptEntry).text === "string",
    );
  } catch {
    return [];
  }
}

function playThumbnailReadySound() {
  playTone([
    { frequency: 880, rampTo: 1320, duration: 0.13 },
  ]);
}

function playTimerChime() {
  playTone([
    { frequency: 660, rampTo: 660, duration: 0.16 },
    { frequency: 880, rampTo: 880, duration: 0.16, delay: 0.18 },
    { frequency: 1100, rampTo: 1320, duration: 0.28, delay: 0.36 },
  ]);
}

type ToneStep = { frequency: number; rampTo: number; duration: number; delay?: number };

function playTone(steps: ToneStep[]) {
  try {
    const audio = new window.AudioContext();
    let latestEnd = 0;

    for (const step of steps) {
      const start = audio.currentTime + (step.delay || 0);
      const end = start + step.duration;
      latestEnd = Math.max(latestEnd, end);

      const gain = audio.createGain();
      const osc = audio.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(step.frequency, start);
      if (step.rampTo !== step.frequency) {
        osc.frequency.exponentialRampToValueAtTime(step.rampTo, end);
      }
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.05, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(gain);
      gain.connect(audio.destination);
      osc.start(start);
      osc.stop(end + 0.01);
    }

    window.setTimeout(() => void audio.close(), (latestEnd + 0.2) * 1000);
  } catch {
    // Audio cues are optional; ignore browsers that block short sounds.
  }
}
