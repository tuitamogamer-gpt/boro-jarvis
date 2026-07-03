import { X } from "lucide-react";
import type { RickyEagerness, RickySettings, RickyTheme } from "../vite-env";

type SettingsPopoverProps = {
  settings: RickySettings;
  isConnected: boolean;
  onChangeVoice: (voice: string) => void;
  onChangeTheme: (theme: RickyTheme) => void;
  onChangeEagerness: (eagerness: RickyEagerness) => void;
  onChangeHomeCity: (homeCity: string) => void;
  onClose: () => void;
};

const VOICES = ["cedar", "marin", "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"];

const THEMES: Array<{ id: RickyTheme; label: string }> = [
  { id: "cyan", label: "Cyan" },
  { id: "crimson", label: "Crimson" },
  { id: "amber", label: "Amber" },
  { id: "emerald", label: "Emerald" },
  { id: "violet", label: "Violet" },
];

export function SettingsPopover({
  settings,
  isConnected,
  onChangeVoice,
  onChangeTheme,
  onChangeEagerness,
  onChangeHomeCity,
  onClose,
}: SettingsPopoverProps) {
  return (
    <section className="settings-popover" aria-label="Ricky settings">
      <header className="settings-header">
        <span className="eyebrow">Settings</span>
        <button onClick={onClose} aria-label="Close settings" title="Close settings">
          <X size={14} />
        </button>
      </header>

      <div className="settings-group">
        <label className="settings-label" htmlFor="voice-select">
          Voice
        </label>
        <select id="voice-select" value={settings.voice} onChange={(event) => onChangeVoice(event.target.value)}>
          {VOICES.map((voice) => (
            <option value={voice} key={voice}>
              {voice.charAt(0).toUpperCase() + voice.slice(1)}
            </option>
          ))}
        </select>
        {isConnected ? <small className="settings-hint">Applies after you reconnect the mic.</small> : null}
      </div>

      <div className="settings-group">
        <label className="settings-label" htmlFor="eagerness-select">
          Reaction speed
        </label>
        <select
          id="eagerness-select"
          value={settings.eagerness}
          onChange={(event) => onChangeEagerness(event.target.value as RickyEagerness)}
        >
          <option value="low">Relaxed — waits for you to finish</option>
          <option value="medium">Balanced</option>
          <option value="high">Snappy — jumps in quickly</option>
        </select>
        {isConnected ? <small className="settings-hint">Applies after you reconnect the mic.</small> : null}
      </div>

      <div className="settings-group">
        <label className="settings-label" htmlFor="home-city-input">
          Home city
        </label>
        <input
          id="home-city-input"
          className="settings-input"
          value={settings.homeCity}
          onChange={(event) => onChangeHomeCity(event.target.value)}
          placeholder="e.g. Belgrade"
        />
        <small className="settings-hint">Used for the daily briefing weather.</small>
      </div>

      <div className="settings-group">
        <span className="settings-label">Theme</span>
        <div className="theme-swatches">
          {THEMES.map((theme) => (
            <button
              key={theme.id}
              className={settings.theme === theme.id ? `theme-swatch theme-swatch-${theme.id} selected` : `theme-swatch theme-swatch-${theme.id}`}
              onClick={() => onChangeTheme(theme.id)}
              aria-label={`${theme.label} theme`}
              title={theme.label}
            />
          ))}
        </div>
        <small className="settings-hint">You can also say: “Switch the theme to crimson.”</small>
      </div>
    </section>
  );
}
