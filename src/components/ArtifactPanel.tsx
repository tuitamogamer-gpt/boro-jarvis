import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Code2,
  Copy,
  FileText,
  FolderOpen,
  GitBranch,
  Image as ImageIcon,
  LayoutGrid,
  Loader,
  Maximize2,
  Minimize2,
  StickyNote,
  Table as TableIcon,
  X,
} from "lucide-react";
import mermaid from "mermaid";
import type { RickyArtifact } from "../vite-env";

type ArtifactPanelProps = {
  artifact: RickyArtifact | null;
  visible: boolean;
  fullscreen: boolean;
  canPrev?: boolean;
  canNext?: boolean;
  onPrev?: () => void;
  onNext?: () => void;
  onToggleVisible: () => void;
  onToggleFullscreen: () => void;
};

type MermaidState = {
  svg: string;
  error: string | null;
  source: string;
};

type NoteCard = {
  id?: string;
  text?: string;
  tags?: string[];
  createdAt?: string;
};

type ThumbnailBoardData = {
  view?: "grid" | "selected";
  selectedId?: string | null;
  references?: Array<{ id?: string; label?: string; path?: string }>;
  page?: {
    page?: number;
    pageSize?: number;
    totalImages?: number;
    totalPages?: number;
    nextNumber?: number;
  };
  images?: Array<{
    id?: string;
    number?: number;
    src?: string;
    prompt?: string;
    type?: string;
    status?: "loading" | string;
    loadingLabel?: string;
    createdAt?: string;
    selected?: boolean;
  }>;
};

type DemoFlowData = {
  audience?: {
    guest?: string;
    company?: string;
    meetingWindow?: string;
  };
  headline?: string;
  promise?: string;
  triggerPrompt?: string;
  packet?: {
    source?: string;
    receivedAt?: string;
    documents?: Array<{
      name?: string;
      pages?: number;
      status?: string;
      signal?: string;
    }>;
    extractedFields?: Array<{ label?: string; value?: string }>;
  };
  notes?: Array<{
    tag?: string;
    title?: string;
    body?: string;
    confidence?: number;
  }>;
  handoff?: {
    agent?: string;
    objective?: string;
    contextPackage?: string[];
    nextActions?: string[];
    handoffMessage?: string;
  };
  walkthrough?: Array<{
    time?: string;
    title?: string;
    words?: string;
  }>;
};

const KIND_ICONS: Record<RickyArtifact["kind"], typeof FileText> = {
  text: FileText,
  markdown: FileText,
  code: Code2,
  table: TableIcon,
  notes: StickyNote,
  mermaid: GitBranch,
  image: ImageIcon,
  imageLoading: ImageIcon,
  thumbnailBoard: LayoutGrid,
  demoFlow: GitBranch,
  progress: Loader,
};

mermaid.initialize({
  startOnLoad: false,
  theme: "dark",
  securityLevel: "strict",
});

export function ArtifactPanel({
  artifact,
  visible,
  fullscreen,
  canPrev = false,
  canNext = false,
  onPrev,
  onNext,
  onToggleVisible,
  onToggleFullscreen,
}: ArtifactPanelProps) {
  const [mermaidState, setMermaidState] = useState<MermaidState>({ svg: "", error: null, source: "" });
  const [copied, setCopied] = useState(false);
  const rawId = useId();
  const mermaidId = useMemo(() => `mermaid-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`, [rawId]);

  useEffect(() => {
    let cancelled = false;
    if (artifact?.kind !== "mermaid") {
      setMermaidState({ svg: "", error: null, source: "" });
      return;
    }

    const source = normalizeMermaidSource(artifact.content, artifact.title);
    mermaid
      .render(mermaidId, source)
      .then((result) => {
        if (!cancelled) setMermaidState({ svg: result.svg, error: null, source });
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        const fallback = fallbackMermaidSource(artifact.title);
        mermaid
          .render(`${mermaidId}-fallback`, fallback)
          .then((result) => {
            if (!cancelled) setMermaidState({ svg: result.svg, error: message, source });
          })
          .catch(() => {
            if (!cancelled) setMermaidState({ svg: "", error: message, source });
          });
      });

    return () => {
      cancelled = true;
    };
  }, [artifact, mermaidId]);

  useEffect(() => {
    setCopied(false);
  }, [artifact]);

  if (!visible) {
    return (
      <button className="artifact-tab" onClick={onToggleVisible}>
        <LayoutGrid size={13} />
        Artifacts
      </button>
    );
  }

  const KindIcon = artifact ? KIND_ICONS[artifact.kind] || FileText : LayoutGrid;
  const canCopy = Boolean(artifact && artifact.kind !== "image" && artifact.kind !== "imageLoading" && artifact.kind !== "thumbnailBoard");

  async function copyContent() {
    if (!artifact) return;
    try {
      await navigator.clipboard.writeText(artifact.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard may be unavailable; ignore.
    }
  }

  return (
    <aside className={`artifact-panel ${fullscreen ? "artifact-fullscreen" : ""}`}>
      <header className="artifact-header">
        <div className="artifact-title">
          <span className="artifact-kind-badge">
            <KindIcon size={13} />
            <span>{artifact ? artifact.kind : "ready"}</span>
          </span>
          <h2>{artifact?.title || "Ready"}</h2>
        </div>
        <div className="artifact-actions">
          {canPrev || canNext ? (
            <>
              <button onClick={onPrev} disabled={!canPrev} aria-label="Previous artifact" title="Previous artifact">
                <ChevronLeft size={14} />
              </button>
              <button onClick={onNext} disabled={!canNext} aria-label="Next artifact" title="Next artifact">
                <ChevronRight size={14} />
              </button>
            </>
          ) : null}
          {canCopy ? (
            <button onClick={() => void copyContent()} aria-label="Copy content" title="Copy content">
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          ) : null}
          <button onClick={onToggleFullscreen} aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"} title={fullscreen ? "Exit fullscreen" : "Fullscreen"}>
            {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button onClick={onToggleVisible} aria-label="Hide artifacts" title="Hide artifacts">
            <X size={14} />
          </button>
        </div>
      </header>
      <div className="artifact-body" key={artifact ? `${artifact.title}-${artifact.kind}-${artifact.content.length}` : "empty"}>
        {artifact ? renderArtifact(artifact, mermaidState) : <EmptyArtifact />}
      </div>
    </aside>
  );
}

function EmptyArtifact() {
  return (
    <div className="empty-artifact">
      <div className="empty-artifact-glyph" aria-hidden="true">
        <LayoutGrid size={26} />
      </div>
      <p>Ask Spasoje to show web results, weather, charts, notes, records, code, images, or progress here.</p>
    </div>
  );
}

function renderArtifact(artifact: RickyArtifact, mermaidState: MermaidState) {
  if (artifact.kind === "table") {
    return <JsonTable content={artifact.content} />;
  }

  if (artifact.kind === "notes") {
    return <NotesGrid content={artifact.content} />;
  }

  if (artifact.kind === "mermaid") {
    return (
      <div className="mermaid-stack">
        <div className="mermaid-output" dangerouslySetInnerHTML={{ __html: mermaidState.svg }} />
        {mermaidState.error ? (
          <details className="mermaid-repair">
            <summary>Spasoje repaired this chart so it would still display.</summary>
            <p>The original Mermaid syntax did not parse, so a safe fallback chart was shown.</p>
            <pre>{mermaidState.source}</pre>
          </details>
        ) : null}
      </div>
    );
  }

  if (artifact.kind === "image") {
    const isDataUrl = artifact.content.startsWith("data:");
    const isRemote = artifact.content.startsWith("http");
    const src = isDataUrl || isRemote || artifact.content.startsWith("file://") ? artifact.content : `file://${artifact.content}`;
    const localPath = !isDataUrl && !isRemote ? artifact.content.replace(/^file:\/\//, "") : null;
    return (
      <div className="image-artifact">
        <img className="artifact-image" src={src} alt={artifact.title} />
        {localPath ? (
          <button className="image-reveal" onClick={() => void window.ricky.revealPath(localPath)}>
            <FolderOpen size={13} />
            Reveal in Finder
          </button>
        ) : null}
      </div>
    );
  }

  if (artifact.kind === "imageLoading") {
    return (
      <div className="image-loading-artifact">
        <div className="image-loading-frame">
          <div className="image-loading-grid" />
          <div className="image-loading-orb" />
          <div className="image-loading-scan" />
        </div>
        <div className="image-loading-copy">
          <span>Generating image</span>
          <p>{artifact.content}</p>
        </div>
      </div>
    );
  }

  if (artifact.kind === "thumbnailBoard") {
    return <ThumbnailBoard content={artifact.content} />;
  }

  if (artifact.kind === "demoFlow") {
    return <DemoFlow content={artifact.content} />;
  }

  if (artifact.kind === "code") {
    return (
      <pre className="code-artifact">
        <code>{highlightCode(artifact.content)}</code>
      </pre>
    );
  }

  if (artifact.kind === "markdown") {
    return <MarkdownArtifact content={artifact.content} />;
  }

  if (artifact.kind === "progress") {
    return (
      <div className="progress-card">
        <div className="progress-pulse" />
        <p>{artifact.content}</p>
      </div>
    );
  }

  return <pre className="text-artifact">{artifact.content}</pre>;
}

function ThumbnailBoard({ content }: { content: string }) {
  const board = parseThumbnailBoard(content);
  if (!board) return <pre className="text-artifact">{content}</pre>;

  const images = board.images || [];
  const selected = images.find((image) => image.selected) || images.find((image) => image.id === board.selectedId) || null;
  const page = board.page || {};

  if (board.view === "selected" && selected) {
    return (
      <section className="thumbnail-selected">
        <div className="thumbnail-selected-frame">
          <img src={selected.src} alt={`Thumbnail ${selected.number || ""}`} />
          <span className="thumbnail-number-large">{selected.number}</span>
        </div>
        <div className="thumbnail-selected-copy">
          <span>{selected.type || "thumbnail"}</span>
          <p>{selected.prompt || "Selected thumbnail"}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="thumbnail-board">
      <header className="thumbnail-board-meta">
        <div>
          <span>{page.totalImages ?? images.length} thumbnails</span>
          <p>{(board.references || []).length} reference image{(board.references || []).length === 1 ? "" : "s"} loaded</p>
        </div>
        <small>Page {page.page || 1}/{page.totalPages || 1} · next #{page.nextNumber || "?"}</small>
      </header>
      {images.length > 0 ? (
        <div className="thumbnail-grid">
          {images.map((image) => (
            <article className={image.status === "loading" ? "thumbnail-card thumbnail-card-loading" : "thumbnail-card"} key={image.id || image.number}>
              {image.status === "loading" ? (
                <div className="thumbnail-loading-wrap">
                  <div className="thumbnail-loading-grid" />
                  <div className="thumbnail-loading-orb" />
                  <span>{image.number}</span>
                </div>
              ) : (
                <div className="thumbnail-image-wrap">
                  <img src={image.src} alt={`Thumbnail ${image.number || ""}`} />
                  <span>{image.number}</span>
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
        <div className="thumbnail-empty">
          <p>reference image loaded. Ask Spasoje: “Generate a 16:9 thumbnail of me about Cursor agents.”</p>
        </div>
      )}
    </section>
  );
}

function DemoFlow({ content }: { content: string }) {
  const data = parseDemoFlow(content);
  const [activeIndex, setActiveIndex] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setActiveIndex(0);
    setCopied(false);
  }, [content]);

  if (!data) return <pre className="text-artifact">{content}</pre>;
  const demo = data;

  const steps = [
    {
      id: "intake",
      title: "Document intake",
      subtitle: "Spasoje receives the packet and identifies the operational facts.",
      icon: <FileText size={15} />,
    },
    {
      id: "notes",
      title: "Note extraction",
      subtitle: "The packet becomes decisions, risks, missing inputs, and system updates.",
      icon: <StickyNote size={15} />,
    },
    {
      id: "handoff",
      title: "Agent handoff",
      subtitle: "A specialist agent gets the context package and next actions.",
      icon: <GitBranch size={15} />,
    },
  ];
  const activeStep = steps[activeIndex] || steps[0];

  async function copyHandoff() {
    const message = demo.handoff?.handoffMessage || "";
    if (!message) return;
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard may be unavailable; ignore.
    }
  }

  return (
    <section className="demo-flow">
      <header className="demo-hero">
        <div>
          <span className="demo-client">
            {demo.audience?.company || "Tehnosoft"} / {demo.audience?.guest || "Rikard"}
          </span>
          <h1>{demo.headline || "Document intake -> note extraction -> agent handoff"}</h1>
          <p>{demo.promise}</p>
        </div>
        <div className="demo-command">
          <span>Say to Spasoje</span>
          <p>{demo.triggerPrompt}</p>
        </div>
      </header>

      <div className="demo-layout">
        <nav className="demo-steps" aria-label="Demo stages">
          {steps.map((step, index) => (
            <button className={index === activeIndex ? "demo-step active" : "demo-step"} key={step.id} onClick={() => setActiveIndex(index)}>
              <span className="demo-step-icon">{step.icon}</span>
              <span>
                <strong>{step.title}</strong>
                <small>{step.subtitle}</small>
              </span>
            </button>
          ))}
        </nav>

        <section className="demo-stage" aria-live="polite">
          <header className="demo-stage-header">
            <div>
              <span>Step {activeIndex + 1} of {steps.length}</span>
              <h2>{activeStep.title}</h2>
            </div>
            <div className="demo-stage-controls">
              <button onClick={() => setActiveIndex(Math.max(0, activeIndex - 1))} disabled={activeIndex === 0}>
                <ChevronLeft size={14} />
                Back
              </button>
              <button onClick={() => setActiveIndex(Math.min(steps.length - 1, activeIndex + 1))} disabled={activeIndex === steps.length - 1}>
                Next
                <ChevronRight size={14} />
              </button>
            </div>
          </header>

          {activeIndex === 0 ? <DemoIntake data={demo} /> : null}
          {activeIndex === 1 ? <DemoNotes data={demo} /> : null}
          {activeIndex === 2 ? <DemoHandoff data={demo} copied={copied} onCopy={() => void copyHandoff()} /> : null}
        </section>

        <aside className="demo-script">
          <header>
            <span>Call track</span>
            <strong>5 minutes</strong>
          </header>
          <ol>
            {(demo.walkthrough || []).map((item, index) => (
              <li className={index === activeIndex ? "active" : ""} key={`${item.time}-${item.title}`}>
                <time>{item.time}</time>
                <strong>{item.title}</strong>
                <p>{item.words}</p>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </section>
  );
}

function DemoIntake({ data }: { data: DemoFlowData }) {
  const documents = data.packet?.documents || [];
  const fields = data.packet?.extractedFields || [];

  return (
    <div className="demo-intake">
      <section className="demo-packet-strip">
        <div>
          <span>Source</span>
          <strong>{data.packet?.source || "Document packet"}</strong>
        </div>
        <div>
          <span>Received</span>
          <strong>{data.packet?.receivedAt || "Just now"}</strong>
        </div>
        <div>
          <span>Status</span>
          <strong>Ready for extraction</strong>
        </div>
      </section>

      <div className="demo-document-grid">
        {documents.map((document, index) => (
          <article className="demo-document" key={document.name || index}>
            <FileText size={18} />
            <div>
              <strong>{document.name || "Document"}</strong>
              <span>{document.pages ? `${document.pages} page${document.pages === 1 ? "" : "s"}` : "Parsed"}</span>
            </div>
            <small>{document.status || "Indexed"}</small>
            <p>{document.signal}</p>
          </article>
        ))}
      </div>

      <div className="demo-field-grid">
        {fields.map((field, index) => (
          <div className="demo-field" key={field.label || index}>
            <span>{field.label}</span>
            <strong>{field.value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function DemoNotes({ data }: { data: DemoFlowData }) {
  const notes = data.notes || [];

  return (
    <div className="demo-notes">
      {notes.map((note, index) => (
        <article className="demo-note" key={note.title || index}>
          <header>
            <span>{note.tag}</span>
            <strong>{note.confidence ?? 0}%</strong>
          </header>
          <h3>{note.title}</h3>
          <p>{note.body}</p>
        </article>
      ))}
    </div>
  );
}

function DemoHandoff({ data, copied, onCopy }: { data: DemoFlowData; copied: boolean; onCopy: () => void }) {
  const handoff = data.handoff || {};

  return (
    <div className="demo-handoff">
      <section className="demo-agent-card">
        <span>Target agent</span>
        <h3>{handoff.agent || "Specialist Agent"}</h3>
        <p>{handoff.objective}</p>
      </section>

      <div className="demo-handoff-columns">
        <section>
          <h4>Context package</h4>
          <ul>
            {(handoff.contextPackage || []).map((item) => (
              <li key={item}>
                <Check size={13} />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h4>Next actions</h4>
          <ul>
            {(handoff.nextActions || []).map((item) => (
              <li key={item}>
                <ChevronRight size={13} />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="demo-handoff-message">
        <header>
          <span>Handoff message</span>
          <button onClick={onCopy}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </header>
        <p>{handoff.handoffMessage}</p>
      </section>
    </div>
  );
}

function parseThumbnailBoard(content: string): ThumbnailBoardData | null {
  try {
    const value = JSON.parse(content) as unknown;
    if (!value || typeof value !== "object") return null;
    return value as ThumbnailBoardData;
  } catch {
    return null;
  }
}

function parseDemoFlow(content: string): DemoFlowData | null {
  try {
    const value = JSON.parse(content) as unknown;
    if (!value || typeof value !== "object") return null;
    return value as DemoFlowData;
  } catch {
    return null;
  }
}

function MarkdownArtifact({ content }: { content: string }) {
  const [visibleContent, setVisibleContent] = useState("");

  useEffect(() => {
    setVisibleContent("");
    let index = 0;
    const step = Math.max(8, Math.ceil(content.length / 180));
    const timer = window.setInterval(() => {
      index = Math.min(content.length, index + step);
      setVisibleContent(content.slice(0, index));
      if (index >= content.length) window.clearInterval(timer);
    }, 14);

    return () => window.clearInterval(timer);
  }, [content]);

  return (
    <div className="markdown-artifact">
      <div className="stream-line" />
      {renderMarkdown(visibleContent)}
    </div>
  );
}

function renderMarkdown(content: string): ReactNode[] {
  const lines = content.split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.trimStart().startsWith("```")) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trimStart().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push(
        <pre className="md-code" key={`code-${index}`}>
          <code>{highlightCode(codeLines.join("\n"))}</code>
        </pre>,
      );
      continue;
    }

    if (line.trimStart().startsWith("|")) {
      const tableLines: string[] = [];
      while (index < lines.length && lines[index].trimStart().startsWith("|")) {
        tableLines.push(lines[index].trim());
        index += 1;
      }
      blocks.push(<MarkdownTable lines={tableLines} key={`table-${index}`} />);
      continue;
    }

    if (line.startsWith("# ")) {
      blocks.push(<h1 key={index}>{renderInline(line.slice(2))}</h1>);
    } else if (line.startsWith("## ")) {
      blocks.push(<h2 key={index}>{renderInline(line.slice(3))}</h2>);
    } else if (line.startsWith("### ")) {
      blocks.push(<h3 key={index}>{renderInline(line.slice(4))}</h3>);
    } else if (/^(-{3,}|\*{3,})\s*$/.test(line.trim())) {
      blocks.push(<hr className="md-hr" key={index} />);
    } else if (line.startsWith("> ")) {
      blocks.push(
        <blockquote className="md-quote" key={index}>
          {renderInline(line.slice(2))}
        </blockquote>,
      );
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      blocks.push(<li key={index}>{renderInline(line.slice(2))}</li>);
    } else if (/^\d+\.\s/.test(line)) {
      blocks.push(
        <li className="md-ordered" key={index}>
          {renderInline(line.replace(/^\d+\.\s/, ""))}
        </li>,
      );
    } else if (!line.trim()) {
      blocks.push(<div className="markdown-gap" key={index} />);
    } else {
      blocks.push(<p key={index}>{renderInline(line)}</p>);
    }
    index += 1;
  }

  return blocks;
}

function MarkdownTable({ lines }: { lines: string[] }) {
  const rows = lines
    .filter((line) => !/^\|[\s:\-|]+\|$/.test(line))
    .map((line) =>
      line
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim()),
    );

  if (rows.length === 0) return null;
  const [head, ...body] = rows;

  return (
    <div className="table-wrap md-table">
      <table>
        <thead>
          <tr>
            {head.map((cell, cellIndex) => (
              <th key={cellIndex}>{renderInline(cell)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{renderInline(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const INLINE_REGEX = /(\[([^\]]+)\]\((https?:\/\/[^)]+)\))|(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\*([^*]+)\*)/g;

function renderInline(text: string): ReactNode {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  INLINE_REGEX.lastIndex = 0;

  while ((match = INLINE_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));

    if (match[1]) {
      parts.push(
        <a href={match[3]} key={`link-${match.index}`} target="_blank" rel="noreferrer">
          {match[2]}
        </a>,
      );
    } else if (match[4]) {
      parts.push(<strong key={`bold-${match.index}`}>{match[5]}</strong>);
    } else if (match[6]) {
      parts.push(
        <code className="md-inline-code" key={`code-${match.index}`}>
          {match[7]}
        </code>,
      );
    } else if (match[8]) {
      parts.push(<em key={`em-${match.index}`}>{match[9]}</em>);
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts.length > 0 ? parts : text;
}

const CODE_TOKEN_REGEX =
  /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b(\d+(?:\.\d+)?)\b|\b(const|let|var|function|return|if|else|for|while|class|import|export|from|async|await|new|try|catch|throw|type|interface|extends|implements|def|lambda|print|self|None|True|False|null|undefined|true|false|public|private|void|int|string|bool)\b/g;

function highlightCode(code: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  CODE_TOKEN_REGEX.lastIndex = 0;

  while ((match = CODE_TOKEN_REGEX.exec(code)) !== null) {
    if (match.index > lastIndex) parts.push(code.slice(lastIndex, match.index));

    const [token] = match;
    const className = match[1] ? "tok-comment" : match[2] ? "tok-string" : match[3] ? "tok-number" : "tok-keyword";
    parts.push(
      <span className={className} key={`tok-${match.index}`}>
        {token}
      </span>,
    );
    lastIndex = match.index + token.length;
  }

  if (lastIndex < code.length) parts.push(code.slice(lastIndex));
  return parts;
}

function NotesGrid({ content }: { content: string }) {
  const notes = parseNotes(content);
  if (notes.length === 0) return <pre className="text-artifact">{content}</pre>;

  return (
    <div className="notes-grid">
      {notes.map((note, index) => (
        <article className="note-card" key={note.id || index}>
          <p>{note.text || "Untitled note"}</p>
          <footer>
            <span>{formatDate(note.createdAt)}</span>
            {note.tags && note.tags.length > 0 ? <small>{note.tags.map((tag) => `#${tag}`).join(" ")}</small> : null}
          </footer>
        </article>
      ))}
    </div>
  );
}

function parseNotes(content: string): NoteCard[] {
  try {
    const value = JSON.parse(content) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((note): note is NoteCard => note !== null && typeof note === "object");
  } catch {
    return [];
  }
}

function formatDate(value: string | undefined): string {
  if (!value) return "just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function normalizeMermaidSource(content: string, title: string): string {
  const stripped = content
    .replace(/```mermaid/gi, "")
    .replace(/```/g, "")
    .replace(/\r/g, "")
    .trim();

  if (!stripped) return fallbackMermaidSource(title);

  const lines = stripped
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, "-"));

  const first = lines[0] || "";
  const hasHeader = /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|mindmap|timeline)\b/i.test(first);
  return hasHeader ? lines.join("\n") : `flowchart TD\n${lines.join("\n")}`;
}

function fallbackMermaidSource(title: string): string {
  const safeTitle = title.replace(/["<>]/g, "") || "Chart";
  return `flowchart TD\n  A["${safeTitle}"] --> B["Chart syntax issue"]\n  B --> C["Fallback displayed"]`;
}

function JsonTable({ content }: { content: string }) {
  const parsed = parseRows(content);
  if (!parsed) return <pre className="text-artifact">{content}</pre>;

  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const keys = Array.from(
    rows.reduce<Set<string>>((set, row) => {
      Object.keys(row).forEach((key) => set.add(key));
      return set;
    }, new Set()),
  );

  if (rows.length === 0 || keys.length === 0) {
    return <pre className="text-artifact">{content}</pre>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{keys.map((key) => <th key={key}>{key}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.id || index}`}>
              {keys.map((key) => (
                <td key={key}>{formatCell(row[key])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function parseRows(content: string): Array<Record<string, unknown>> | Record<string, unknown> | null {
  try {
    const value = JSON.parse(content) as unknown;
    if (Array.isArray(value) && value.every((row) => row && typeof row === "object" && !Array.isArray(row))) {
      return value as Array<Record<string, unknown>>;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
