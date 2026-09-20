import { useId } from "react";
import { RadioCards, SegmentedControl, Switch } from "@radix-ui/themes";
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
        <span className="control-label" id={`${id}-label`}>{label}</span>
        {description && (
          <span className="control-description" id={`${id}-description`}>
            {description}
          </span>
        )}
      </label>
      <Switch
        id={id}
        className="switch"
        size={small ? "1" : "2"}
        highContrast
        checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-description` : undefined}
        onCheckedChange={onChange}
        disabled={disabled}
      />
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
  if (compact) {
    return (
      <SegmentedControl.Root
        className="mode-control mode-compact"
        size="2"
        value={settings.mode}
        onValueChange={(mode) => {
          if (mode === "censor" || mode === "hide") update({ mode });
        }}
        aria-label="What to do with detected content"
      >
        <SegmentedControl.Item value="censor">
          <span className="mode-option-label">
            <Stamp size={16} /> Censor
          </span>
        </SegmentedControl.Item>
        <SegmentedControl.Item value="hide">
          <span className="mode-option-label">
            <EyeOff size={16} /> Hide
          </span>
        </SegmentedControl.Item>
      </SegmentedControl.Root>
    );
  }
  return (
    <RadioCards.Root
      className="mode-control"
      size="1"
      highContrast
      columns="2"
      gap="2"
      value={settings.mode}
      onValueChange={(mode) => {
        if (mode === "censor" || mode === "hide") update({ mode });
      }}
      aria-label="What to do with detected content"
    >
      <RadioCards.Item
        value="censor"
        className={`mode-option ${settings.mode === "censor" ? "selected" : ""}`}
      >
        <Stamp size={19} />
        <span className="mode-option-copy">
          Censor<small>Blur it. Keep the choice.</small>
        </span>
        {settings.mode === "censor" && (
          <Check size={16} className="mode-check" aria-hidden="true" />
        )}
      </RadioCards.Item>
      <RadioCards.Item
        value="hide"
        className={`mode-option ${settings.mode === "hide" ? "selected" : ""}`}
      >
        <EyeOff size={19} />
        <span className="mode-option-copy">
          Hide<small>Make it disappear.</small>
        </span>
        {settings.mode === "hide" && (
          <Check size={16} className="mode-check" aria-hidden="true" />
        )}
      </RadioCards.Item>
    </RadioCards.Root>
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
          {Math.round(settings.threshold * 100)}% minimum score
        </span>
      </div>
      <SegmentedControl.Root
        className="segmented"
        size="2"
        value={String(settings.threshold)}
        onValueChange={(value) => {
          const preset = presets.find(
            (candidate) => String(candidate.value) === value,
          );
          if (preset) update({ threshold: preset.value });
        }}
        aria-label="Filter strength"
      >
        {presets.map((preset) => (
          <SegmentedControl.Item
            key={preset.label}
            value={String(preset.value)}
            className={settings.threshold === preset.value ? "active" : ""}
          >
            {preset.label}
          </SegmentedControl.Item>
        ))}
      </SegmentedControl.Root>
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
