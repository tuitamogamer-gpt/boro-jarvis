/// <reference types="vite/client" />

export type RickyArtifact = {
  title: string;
  kind:
    | "text"
    | "markdown"
    | "code"
    | "table"
    | "notes"
    | "mermaid"
    | "image"
    | "imageLoading"
    | "thumbnailBoard"
    | "demoFlow"
    | "progress";
  content: string;
  language?: string;
  fullscreen?: boolean;
};

export type RickyToolSpec = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type RickyToolCall = {
  name: string;
  arguments: Record<string, unknown>;
};

export type RickyToolResult = {
  ok: boolean;
  artifact?: RickyArtifact;
  mode?: "display" | "computer";
  message?: string;
  error?: string;
  [key: string]: unknown;
};

export type RickyTheme = "cyan" | "crimson" | "amber" | "emerald" | "violet";

export type RickyEagerness = "low" | "medium" | "high";

export type RickySettings = {
  voice: string;
  theme: RickyTheme;
  eagerness: RickyEagerness;
  homeCity: string;
};

export type RickyTimer = {
  id: string;
  label: string;
  endsAt?: number;
  remainingSeconds?: number;
};

export type RickyEvent =
  | { type: "timer_fired"; timer: RickyTimer }
  | { type: "timers_changed"; timers: RickyTimer[] }
  | { type: "artifact_push"; artifact: RickyArtifact | null; sound?: string | null; announce?: string | null };

declare global {
  interface Window {
    ricky: {
      createRealtimeToken: () => Promise<{ value: string; expiresAt: number | null }>;
      executeTool: (toolCall: RickyToolCall) => Promise<RickyToolResult>;
      getToolSpecs: () => Promise<RickyToolSpec[]>;
      getSettings: () => Promise<RickySettings>;
      updateSettings: (patch: Partial<RickySettings>) => Promise<RickySettings>;
      revealPath: (targetPath: string) => Promise<boolean>;
      onEvent: (callback: (payload: RickyEvent) => void) => () => void;
    };
  }
}
