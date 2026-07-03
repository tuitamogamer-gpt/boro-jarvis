import { useEffect, useRef } from "react";
import { Bot, Download, Info, Trash2, User, Wrench, X } from "lucide-react";
import type { TranscriptEntry } from "../lib/realtime";

type ChatPanelProps = {
  entries: TranscriptEntry[];
  onClear: () => void;
  onClose: () => void;
};

export function ChatPanel({ entries, onClear, onClose }: ChatPanelProps) {
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [entries]);

  return (
    <section className="chat-panel" aria-label="Conversation history">
      <header className="chat-header">
        <div>
          <span className="eyebrow">Conversation</span>
          <small>{entries.length} messages</small>
        </div>
        <div className="chat-header-actions">
          <button onClick={() => exportTranscript(entries)} disabled={entries.length === 0} aria-label="Export conversation" title="Export conversation as Markdown">
            <Download size={14} />
          </button>
          <button onClick={onClear} aria-label="Clear conversation" title="Clear conversation">
            <Trash2 size={14} />
          </button>
          <button onClick={onClose} aria-label="Close conversation" title="Close conversation">
            <X size={14} />
          </button>
        </div>
      </header>
      <div className="chat-list" ref={listRef}>
        {entries.length === 0 ? (
          <p className="chat-empty">No messages yet. Connect the mic and start talking.</p>
        ) : (
          entries.map((entry) => <ChatBubble entry={entry} key={entry.id} />)
        )}
      </div>
    </section>
  );
}

function exportTranscript(entries: TranscriptEntry[]) {
  const roleName = (role: TranscriptEntry["role"]) =>
    role === "ricky" ? "Spasoje" : role === "user" ? "You" : role === "tool" ? "Tool" : "System";
  const lines = [
    "# Spasoje Conversation",
    "",
    `Exported: ${new Date().toLocaleString()}`,
    "",
    ...entries.map((entry) => `**${roleName(entry.role)}** (${entry.at}):\n${entry.text}\n`),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `ricky-conversation-${new Date().toISOString().slice(0, 10)}.md`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ChatBubble({ entry }: { entry: TranscriptEntry }) {
  if (entry.role === "system") {
    return (
      <div className="chat-system">
        <Info size={11} />
        <span>{entry.text}</span>
      </div>
    );
  }

  if (entry.role === "tool") {
    return (
      <div className="chat-tool">
        <Wrench size={11} />
        <span>{entry.text}</span>
        <time>{entry.at}</time>
      </div>
    );
  }

  const isUser = entry.role === "user";
  return (
    <article className={isUser ? "chat-bubble chat-bubble-user" : "chat-bubble chat-bubble-ricky"}>
      <header>
        {isUser ? <User size={12} /> : <Bot size={12} />}
        <strong>{isUser ? "You" : "Spasoje"}</strong>
        <time>{entry.at}</time>
      </header>
      <p>{entry.text}</p>
    </article>
  );
}
