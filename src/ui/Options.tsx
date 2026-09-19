import { useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleHelp,
  EyeOff,
  Globe2,
  Info,
  LockKeyhole,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { isExtension } from "./bridge";
import { useSettings } from "./useSettings";
import { Logo, Toggle } from "./components";
import {
  FilterSettings,
  SitesSettings,
  PrivacySettings,
  AboutSettings,
} from "./preferences";

type Section = "filters" | "sites" | "privacy" | "about";

export function Options() {
  const state = useSettings();
  const [section, setSection] = useState<Section>(() => {
    const value = location.hash.slice(1);
    return ["filters", "sites", "privacy", "about"].includes(value)
      ? (value as Section)
      : "filters";
  });
  const nav: [Section, ReactNode, string][] = [
    ["filters", <SlidersHorizontal size={18} />, "Your filter"],
    ["sites", <Globe2 size={18} />, "Websites"],
    ["privacy", <LockKeyhole size={18} />, "Privacy & service"],
    ["about", <CircleHelp size={18} />, "About NO SLOP"],
  ];
  const { settings, update } = state;
  function navigate(next: Section) {
    setSection(next);
    history.replaceState(null, "", `#${next}`);
    window.scrollTo({ top: 0 });
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand-link"
          href="#filters"
          onClick={(event) => {
            event.preventDefault();
            navigate("filters");
          }}
          aria-label="NO SLOP settings home"
        >
          <Logo />
        </a>
        <p className="brand-tagline">A better kind of browsing.</p>
        <nav aria-label="Settings sections">
          {nav.map(([key, icon, label]) => (
            <button
              key={key}
              className={section === key ? "nav-item current" : "nav-item"}
              aria-current={section === key ? "page" : undefined}
              onClick={() => navigate(key)}
            >
              {icon}
              <span>{label}</span>
              {section === key && <ChevronRight size={14} />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="mini-stamp">NS</span>
            <p>
              Less noise.
              <br />
              More internet.
            </p>
          </div>
          <span className="version">Open source. Open to better.</span>
        </div>
      </aside>
      <div className="workspace">
        <header className="workspace-header">
          <span className="breadcrumb">
            Settings <ChevronRight size={12} />{" "}
            {nav.find(([key]) => key === section)?.[2]}
          </span>
          <div className="header-actions">
            <span className="save-status" role="status">
              {state.saveState && <Check size={13} />} {state.saveState}
            </span>
            <Toggle
              small
              checked={settings.enabled}
              onChange={(enabled) => update({ enabled })}
              label={settings.enabled ? "Enabled" : "Paused"}
              disabled={!state.loaded}
            />
          </div>
        </header>
        {!isExtension && (
          <div className="preview-banner">
            <span>
              <Info size={14} /> Interactive preview. Changes stay in this
              browser; no page content is analyzed.
            </span>
            <a href="/popup.html" target="_blank" rel="noreferrer">
              See popup <ArrowUpRight size={13} />
            </a>
          </div>
        )}
        <main id="main-content" aria-busy={!state.loaded}>
          {state.error && (
            <div className="global-error" role="alert">
              {state.error}
            </div>
          )}
          {!settings.enabled && (
            <div className="paused-notice">
              <EyeOff size={16} /> NO SLOP is paused. Your preferences are
              saved.
            </div>
          )}
          {!settings.consent && section !== "privacy" && (
            <button
              className="setup-notice"
              onClick={() => navigate("privacy")}
            >
              <span className="setup-icon">
                <ShieldCheck size={17} />
              </span>
              <span>
                <strong>One thing before we start</strong>
                <span>Connect your detector and choose what you share.</span>
              </span>
              <ChevronRight size={17} />
            </button>
          )}
          {section === "filters" && (
            <FilterSettings settings={settings} update={update} />
          )}
          {section === "sites" && (
            <SitesSettings settings={settings} update={update} />
          )}
          {section === "privacy" && (
            <PrivacySettings settings={settings} update={update} />
          )}
          {section === "about" && <AboutSettings />}
        </main>
        <footer className="page-footer">
          <span>Made for people who care what they consume.</span>
          <span>
            NO SLOP <span className="footer-version">/ 0.1.0</span>
          </span>
        </footer>
      </div>
    </div>
  );
}
