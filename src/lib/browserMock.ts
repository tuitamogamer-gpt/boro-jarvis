import type { RickySettings } from "../vite-env";

// When the renderer is opened in a plain browser (vite dev preview without
// Electron), window.ricky does not exist. Install a minimal mock so the UI
// still renders and can be inspected.
if (typeof window !== "undefined" && !window.ricky) {
  const storageKey = "ricky-mock-settings";

  const defaults: RickySettings = { voice: "cedar", theme: "cyan", eagerness: "medium", homeCity: "" };

  const readSettings = (): RickySettings => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) return { ...defaults, ...(JSON.parse(raw) as Partial<RickySettings>) };
    } catch {
      // fall through to defaults
    }
    return { ...defaults };
  };

  const mock: Window["ricky"] = {
    createRealtimeToken: () => Promise.reject(new Error("Voice requires the Electron app. Run: npm run dev")),
    executeTool: () => Promise.resolve({ ok: false, error: "Tools require the Electron app." }),
    getToolSpecs: () => Promise.resolve([]),
    getSettings: () => Promise.resolve(readSettings()),
    updateSettings: (patch) => {
      const next = { ...readSettings(), ...patch };
      window.localStorage.setItem(storageKey, JSON.stringify(next));
      return Promise.resolve(next);
    },
    revealPath: () => Promise.resolve(false),
    onEvent: () => () => {},
  };

  window.ricky = mock;
}

export {};
