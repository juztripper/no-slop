import { useEffect, useState } from "react";
import { Button, Callout, IconButton } from "@radix-ui/themes";
import {
  ChevronRight,
  Info,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Undo2,
} from "lucide-react";
import { EMPTY_STATS, isAllowlisted } from "../shared/contracts";
import { isSensitivePage } from "../shared/security";
import { isExtension, request, type TabState } from "./bridge";
import { useSettings } from "./useSettings";
import { Logo, Toggle, ModeControl, Sensitivity } from "./components";

export function Popup() {
  const { settings, update, loaded, saveState, error } = useSettings();
  const [tab, setTab] = useState<TabState>({ stats: EMPTY_STATS });
  const [actionStatus, setActionStatus] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const refresh = () =>
      request<TabState>({ type: "GET_TAB_STATE" })
        .then(setTab)
        .catch(() => setActionStatus("Open a website to use NO SLOP."));
    void refresh();
    const interval = window.setInterval(refresh, 1600);
    return () => clearInterval(interval);
  }, []);
  const hostname = (() => {
    try {
      const url = new URL(tab.url || "");
      return ["http:", "https:"].includes(url.protocol) ? url.hostname : "";
    } catch {
      return "";
    }
  })();
  const pageEligible = Boolean(tab.url) && !isSensitivePage(tab.url!);
  const paused = hostname ? isAllowlisted(hostname, settings.allowlist) : false;
  const excludedByParent = settings.allowlist.find(
    (domain) => hostname !== domain && hostname.endsWith(`.${domain}`),
  );
  const openOptions = () =>
    isExtension
      ? chrome.runtime.openOptionsPage()
      : window.open("/options.html", "_blank");
  async function pageAction(type: "RESTORE_PAGE" | "RESCAN_PAGE") {
    setBusy(true);
    setActionStatus("");
    try {
      const result = await request<{ ok: boolean; error?: string }>({ type });
      if (!result.ok)
        throw new Error(
          result.error || "Open a supported website and try again.",
        );
      setActionStatus(
        isExtension
          ? type === "RESTORE_PAGE"
            ? "Original content restored on this page."
            : "Page scan requested."
          : "Preview only. Install the extension to use page actions.",
      );
    } catch (reason) {
      setActionStatus(
        reason instanceof Error
          ? reason.message
          : "Could not update this page.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="popup">
      <header className="popup-header">
        <Logo compact />
        <IconButton
          className="icon-button"
          size="2"
          variant="ghost"
          color="gray"
          aria-label="Open settings"
          onClick={openOptions}
        >
          <Settings2 size={20} />
        </IconButton>
      </header>
      {!isExtension && (
        <Callout.Root className="popup-demo" size="1" color="gray">
          <Callout.Icon>
            <Info size={14} />
          </Callout.Icon>
          <Callout.Text>Popup preview. No live detection.</Callout.Text>
        </Callout.Root>
      )}
      <div className="popup-site">
        <div>
          <span
            className={`status-dot ${settings.enabled && !paused && settings.consent && pageEligible ? "running" : ""}`}
          />
          <strong>{hostname || "No website selected"}</strong>
        </div>
        <Toggle
          small
          checked={settings.enabled}
          onChange={(enabled) => update({ enabled })}
          label="Enable NO SLOP"
          disabled={!loaded}
        />
      </div>
      {!settings.consent && (
        <Button
          className="popup-setup"
          variant="soft"
          size="2"
          onClick={openOptions}
        >
          <ShieldCheck size={19} />
          <span>
            <strong>Set up your detector</strong>
            <span>Connect and review privacy to start.</span>
          </span>
          <ChevronRight size={16} />
        </Button>
      )}
      <section className="popup-filters" aria-label="Content filters">
        <Toggle
          small
          checked={settings.aiSlop}
          onChange={(aiSlop) => update({ aiSlop })}
          label="Filter AI slop"
        />
        <Toggle
          small
          checked={settings.humanSlop}
          onChange={(humanSlop) => update({ humanSlop })}
          label="Filter human slop"
        />
      </section>
      <ModeControl compact settings={settings} update={update} />
      <Sensitivity compact settings={settings} update={update} />
      <div className="popup-stats">
        <span>
          <strong>{tab.stats.scanned}</strong> checked
        </span>
        <span>
          <strong>{tab.stats.filtered}</strong> filtered
        </span>
        <span
          className={`scan-state ${tab.stats.status === "error" ? "scan-error" : ""}`}
        >
          {!settings.enabled || paused
            ? "Paused"
            : !settings.consent
              ? "Not connected"
              : !pageEligible
                ? hostname
                  ? "Private page excluded"
                  : "Unsupported page"
                : tab.stats.status === "scanning"
                  ? "Checking…"
                  : tab.stats.status === "waiting"
                    ? "Resuming shortly…"
                    : tab.stats.status === "ready"
                      ? "Up to date"
                      : tab.stats.status === "error"
                        ? "Needs attention"
                        : "Ready to scan"}
        </span>
      </div>
      {tab.stats.error && (
        <Callout.Root
          className="error-message"
          color="red"
          size="1"
          role="alert"
        >
          <Callout.Text>{tab.stats.error}</Callout.Text>
        </Callout.Root>
      )}
      <div className="popup-page-actions">
        <Button
          size="1"
          variant="soft"
          color="gray"
          disabled={busy || !hostname}
          onClick={() => pageAction("RESTORE_PAGE")}
        >
          <Undo2 size={15} /> Restore page
        </Button>
        <Button
          size="1"
          variant="soft"
          color="gray"
          disabled={
            busy ||
            !pageEligible ||
            !settings.consent ||
            paused ||
            !settings.enabled
          }
          onClick={() => pageAction("RESCAN_PAGE")}
        >
          <RotateCcw size={15} /> Scan again
        </Button>
      </div>
      <div className="popup-pause">
        <Toggle
          small
          checked={paused}
          disabled={!hostname || Boolean(excludedByParent)}
          onChange={(value) =>
            update({
              allowlist: value
                ? [...new Set([...settings.allowlist, hostname])]
                : settings.allowlist.filter((domain) => domain !== hostname),
            })
          }
          label="Always pause on this site"
        />
        {excludedByParent && (
          <p className="field-hint">
            Covered by {excludedByParent}. Edit exceptions in settings.
          </p>
        )}
      </div>
      <div className="popup-message" role="status">
        {error || actionStatus || saveState}
      </div>
      <footer className="popup-footer">
        <span>Good stuff gets through.</span>
        <Button size="1" variant="ghost" onClick={openOptions}>
          All settings <ChevronRight size={13} />
        </Button>
      </footer>
    </main>
  );
}
