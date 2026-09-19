import { useId } from "react";
import { Check, EyeOff, Stamp } from "lucide-react";
import type { Settings } from "../shared/contracts";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`logo ${compact ? "logo-compact" : ""}`}>
      <img src="/brand/mark.svg" alt="" width="38" height="38" />
      <span>
        NO SLOP<span className="logo-period">.</span>
      </span>
    </span>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  small = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  small?: boolean;
}) {
  const id = useId();
  return (
    <div className={`toggle-row ${small ? "toggle-small" : ""}`}>
      <label htmlFor={id}>
        <span className="control-label">{label}</span>
        {description && (
          <span className="control-description" id={`${id}-description`}>
            {description}
          </span>
        )}
      </label>
      <button
        id={id}
        className="switch"
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? `${id}-description` : undefined}
        onClick={() => onChange(!checked)}
        disabled={disabled}
      >
        <span />
      </button>
    </div>
  );
}

export function ModeControl({
  settings,
  update,
  compact = false,
}: {
  settings: Settings;
  update: (patch: Partial<Settings>) => unknown;
  compact?: boolean;
}) {
  return (
    <div
      className={`mode-control ${compact ? "mode-compact" : ""}`}
      role="group"
      aria-label="What to do with detected content"
    >
      <button
        aria-pressed={settings.mode === "censor"}
        className={settings.mode === "censor" ? "selected" : ""}
        onClick={() => update({ mode: "censor" })}
      >
        <Stamp size={19} />
        <span>
          Censor{!compact && <small>Cover it. Keep the choice.</small>}
        </span>
        {!compact && settings.mode === "censor" && (
          <Check size={16} className="mode-check" />
        )}
      </button>
      <button
        aria-pressed={settings.mode === "hide"}
        className={settings.mode === "hide" ? "selected" : ""}
        onClick={() => update({ mode: "hide" })}
      >
        <EyeOff size={19} />
        <span>Hide{!compact && <small>Make it disappear.</small>}</span>
        {!compact && settings.mode === "hide" && (
          <Check size={16} className="mode-check" />
        )}
      </button>
    </div>
  );
}

export function Sensitivity({
  settings,
  update,
  compact = false,
}: {
  settings: Settings;
  update: (patch: Partial<Settings>) => unknown;
  compact?: boolean;
}) {
  const presets = [
    { label: "Gentle", value: 0.95 },
    { label: "Balanced", value: 0.85 },
    { label: "Strict", value: 0.7 },
  ];
  return (
    <div className={`sensitivity ${compact ? "sensitivity-compact" : ""}`}>
      <div className="label-line">
        <span className="control-label">Filter strength</span>
        <span className="quiet">
          {Math.round(settings.threshold * 100)}% confidence
        </span>
      </div>
      <div className="segmented" role="group" aria-label="Filter strength">
        {presets.map((preset) => (
          <button
            key={preset.label}
            className={settings.threshold === preset.value ? "active" : ""}
            aria-pressed={settings.threshold === preset.value}
            onClick={() => update({ threshold: preset.value })}
          >
            {preset.label}
          </button>
        ))}
      </div>
      {!compact && (
        <p className="control-description">
          {settings.threshold >= 0.95
            ? "Only the clearest cases. More content stays visible."
            : settings.threshold >= 0.85
              ? "A little breathing room. Ambiguous content stays visible."
              : "Catches more low-quality content, with a higher risk of mistakes."}
        </p>
      )}
    </div>
  );
}
