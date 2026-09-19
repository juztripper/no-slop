import { useEffect, useState, type FormEvent } from "react";
import { Button, Callout, IconButton, TextField } from "@radix-ui/themes";
import { Globe2, Heart, LockKeyhole, ShieldCheck, X } from "lucide-react";
import type { Settings, Platform } from "../shared/contracts";
import { request } from "./bridge";
import { Toggle, ModeControl, Sensitivity } from "./components";
import { FeedPreview } from "./FeedPreview";

const platforms: [Platform, string, string][] = [
  ["youtube", "YouTube", "Videos, Shorts, posts and comments"],
  ["google", "Google Search", "Search results and destination context"],
  ["instagram", "Instagram", "Posts, captions and comments"],
  ["facebook", "Facebook", "Posts and conversations"],
  ["tiktok", "TikTok", "Video captions and comments"],
  ["x", "X", "Posts, threads and replies"],
  ["reddit", "Reddit", "Posts and comment threads"],
  ["forum", "Forums", "Discussions and replies"],
  ["generic", "Other websites", "Recognizable content and paragraphs"],
];

export function FilterSettings({
  settings,
  update,
}: {
  settings: Settings;
  update: (patch: Partial<Settings>) => unknown;
}) {
  return (
    <>
      <div className="intro">
        <div>
          <h1>
            Your feed.
            <br />
            With a higher standard.
          </h1>
          <p>
            Make room for content that’s worth your attention.
            <br className="desktop-break" /> You decide what gets through.
          </p>
        </div>
        <div className="intro-mark" aria-hidden="true">
          GOOD
          <br />
          STUFF
          <br />
          <span>ONLY.</span>
        </div>
      </div>
      <div className="filter-layout">
        <div className="filter-controls">
          <h2>What gets filtered</h2>
          <Toggle
            checked={settings.aiSlop}
            onChange={(aiSlop) => update({ aiSlop })}
            label="AI slop"
            description="Mass-produced filler, fabricated hooks and low-effort generated content."
          />
          <Toggle
            checked={settings.humanSlop}
            onChange={(humanSlop) => update({ humanSlop })}
            label="Human slop"
            description="Clickbait, content farms and empty pages. Low quality existed before AI."
          />
          <div className="control-section">
            <h2>When something gets flagged</h2>
            <ModeControl settings={settings} update={update} />
          </div>
          <Sensitivity settings={settings} update={update} />
        </div>
        <div className="preview-column">
          <FeedPreview settings={settings} />
          <Callout.Root className="consideration" size="1" color="gray">
            <Callout.Icon>
              <ShieldCheck size={20} />
            </Callout.Icon>
            <div>
              <strong>Quality is a judgment. Yours comes first.</strong>
              <Callout.Text>
                Using AI doesn’t automatically make something slop. Uncertain
                results stay, and censored content can always be revealed.
              </Callout.Text>
            </div>
          </Callout.Root>
        </div>
      </div>
      <section className="preferences-section">
        <h2>The finishing touches</h2>
        <div className="preferences-pair">
          <Toggle
            checked={settings.animations}
            onChange={(animations) => update({ animations })}
            label="A little motion"
            description="A quiet stamp or a gentle exit. Your device’s reduced-motion setting always wins."
          />
          <Toggle
            checked={settings.annotateParagraphs}
            onChange={(annotateParagraphs) => update({ annotateParagraphs })}
            label="Keep paragraphs in context"
            description="Mark questionable passages without deleting the words or breaking the story."
          />
        </div>
      </section>
    </>
  );
}

export function SitesSettings({
  settings,
  update,
}: {
  settings: Settings;
  update: (patch: Partial<Settings>) => unknown;
}) {
  const [domain, setDomain] = useState("");
  const [error, setError] = useState("");
  function addDomain(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const value = domain.trim();
      const url = new URL(value.includes("://") ? value : `https://${value}`);
      const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
      if (
        !hostname.includes(".") ||
        /[^a-z0-9.-]/.test(hostname) ||
        url.username ||
        url.password ||
        !/^https?:$/.test(url.protocol)
      )
        throw new Error("Enter a domain like example.com.");
      if (settings.allowlist.length >= 500)
        throw new Error(
          "You can keep up to 500 sites unfiltered. Remove a site first.",
        );
      update({ allowlist: [...new Set([...settings.allowlist, hostname])] });
      setDomain("");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Enter a valid domain.",
      );
    }
  }
  return (
    <>
      <div className="page-heading">
        <h1>Meet you where you browse.</h1>
        <p>
          Choose the sites NO SLOP works on. A site’s layout can change; content
          that cannot be safely identified stays visible.
        </p>
      </div>
      <section>
        <h2>Enabled websites</h2>
        <div className="platform-list">
          {platforms.map(([key, name, description]) => (
            <Toggle
              key={key}
              label={name}
              description={description}
              checked={settings.platforms[key]}
              onChange={(checked) =>
                update({ platforms: { ...settings.platforms, [key]: checked } })
              }
            />
          ))}
        </div>
      </section>
      <section className="preferences-section">
        <h2>Always leave these sites alone</h2>
        <p className="section-description">
          An exception also covers its subdomains. No content is sent from these
          sites.
        </p>
        <form className="domain-form" onSubmit={addDomain}>
          <label className="sr-only" htmlFor="domain">
            Site domain
          </label>
          <TextField.Root
            className="domain-input"
            size="2"
            id="domain"
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
            placeholder="example.com"
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "domain-error" : undefined}
          />
          <Button
            className="button button-primary"
            highContrast
            size="2"
            variant="solid"
            type="submit"
            disabled={!domain.trim()}
          >
            Add exception
          </Button>
        </form>
        {error && (
          <Callout.Root
            className="error-message"
            color="red"
            size="1"
            role="alert"
            id="domain-error"
          >
            <Callout.Text>{error}</Callout.Text>
          </Callout.Root>
        )}
        {settings.allowlist.length === 0 ? (
          <p className="empty-state">
            No exceptions yet. You can also pause a site from the extension
            popup.
          </p>
        ) : (
          <ul className="domain-list">
            {settings.allowlist.map((site) => (
              <li key={site}>
                <Globe2 size={15} />
                <span>{site}</span>
                <IconButton
                  className="icon-button"
                  size="1"
                  variant="ghost"
                  color="gray"
                  aria-label={`Remove exception for ${site}`}
                  onClick={() =>
                    update({
                      allowlist: settings.allowlist.filter(
                        (entry) => entry !== site,
                      ),
                    })
                  }
                >
                  <X size={16} />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

export function PrivacySettings({
  settings,
  update,
}: {
  settings: Settings;
  update: (patch: Partial<Settings>) => Promise<unknown>;
}) {
  const [endpoint, setEndpoint] = useState(settings.endpoint);
  const [token, setToken] = useState(settings.serviceToken);
  const [connection, setConnection] = useState("");
  const [connectionError, setConnectionError] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setEndpoint(settings.endpoint);
    setToken(settings.serviceToken);
  }, [settings.endpoint, settings.serviceToken]);
  const dirty =
    endpoint !== settings.endpoint || token !== settings.serviceToken;
  async function saveConnection(event?: FormEvent) {
    event?.preventDefault();
    setConnectionError(false);
    try {
      const url = new URL(endpoint.trim());
      if (url.username || url.password || url.search || url.hash)
        throw new Error(
          "Use a detector URL without credentials, query parameters or a fragment.",
        );
      if (
        url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        )
      )
        throw new Error("Use HTTPS, or HTTP for a detector on localhost.");
      const saved = await update({
        endpoint: url.href.replace(/\/$/, ""),
        serviceToken: token.trim(),
        consent: endpoint !== settings.endpoint ? false : settings.consent,
      });
      if (saved === false)
        throw new Error(
          "The connection could not be saved. Check the settings error and try again.",
        );
      setConnection("Connection saved.");
      return true;
    } catch (reason) {
      setConnectionError(true);
      setConnection(
        reason instanceof Error ? reason.message : "Enter a valid service URL.",
      );
      return false;
    }
  }
  async function testConnection() {
    setBusy(true);
    setConnection("Checking the detector…");
    setConnectionError(false);
    try {
      if (dirty && !(await saveConnection())) return;
      const result = await request<{ ok: boolean; error?: string }>({
        type: "HEALTH_CHECK",
      });
      if (!result.ok)
        throw new Error(
          result.error ||
            "The detector did not respond. Check the URL and service token.",
        );
      setConnection("Connected. The detector is ready.");
    } catch (reason) {
      setConnectionError(true);
      setConnection(
        reason instanceof Error ? reason.message : "Connection failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <h1>A clear view of what leaves your browser.</h1>
        <p>
          Detection uses a service you choose. Connect it, review what gets
          shared, then turn on content analysis.
        </p>
      </div>
      <Callout.Root className="privacy-callout" size="2">
        <Callout.Icon>
          <LockKeyhole size={23} />
        </Callout.Icon>
        <div>
          <h2>Your API key stays on your server.</h2>
          <Callout.Text>
            The extension talks to a detector service. That service calls the
            model provider. Never put your OpenRouter key in the extension.
          </Callout.Text>
        </div>
      </Callout.Root>
      <section className="connection-section">
        <h2>Detector connection</h2>
        <form onSubmit={saveConnection}>
          <label className="field-label" htmlFor="endpoint">
            Service URL
          </label>
          <TextField.Root
            className="service-input"
            size="3"
            id="endpoint"
            type="url"
            value={endpoint}
            onChange={(event) => setEndpoint(event.target.value)}
            placeholder="https://your-detector.example"
            autoComplete="url"
            spellCheck={false}
            aria-describedby="endpoint-hint"
          />
          <p className="field-hint" id="endpoint-hint">
            The local default is ready for self-hosting. A free public detector
            has not been configured in this build.
          </p>
          <label className="field-label" htmlFor="service-token">
            Service access token <span>Optional</span>
          </label>
          <TextField.Root
            className="service-input"
            size="3"
            id="service-token"
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="Provided by the detector operator"
            autoComplete="off"
            spellCheck={false}
            aria-describedby="service-token-hint"
          />
          <p className="field-hint" id="service-token-hint">
            A service token, not an OpenRouter API key. Stored locally in this
            browser.
          </p>
          <div className="button-row">
            <Button
              className="button button-primary"
              highContrast
              size="2"
              variant="solid"
              type="submit"
              disabled={!dirty || busy}
            >
              Save connection
            </Button>
            <Button
              className="button button-secondary"
              size="2"
              variant="soft"
              type="button"
              disabled={busy}
              onClick={testConnection}
            >
              {busy ? "Checking…" : "Test connection"}
            </Button>
          </div>
          {connection && (
            <Callout.Root
              role="status"
              size="1"
              color={connectionError ? "red" : "gray"}
              className={connectionError ? "error-message" : "success-message"}
            >
              <Callout.Text>{connection}</Callout.Text>
            </Callout.Root>
          )}
        </form>
      </section>
      <section className="preferences-section">
        <h2>What the detector may see</h2>
        <div className="data-description">
          <p>
            <strong>Content snippets and context.</strong> Titles, visible text,
            captions, surrounding context and content links may be sent to your
            detector and its model provider, including content in a signed-in
            feed. Password fields and direct-message interfaces are excluded
            where recognized. Avoid enabling it on sensitive sites.
          </p>
        </div>
        <Toggle
          checked={settings.inspectThumbnails}
          onChange={(inspectThumbnails) => update({ inspectThumbnails })}
          label="Inspect thumbnails"
          description="Send thumbnail URLs so the detector can fetch and inspect public images. Provider capabilities may limit image analysis."
        />
        <Toggle
          checked={settings.inspectDestinations}
          onChange={(inspectDestinations) => update({ inspectDestinations })}
          label="Inspect search destinations"
          description="Let the service fetch public result pages before you visit them. This adds context and may increase latency."
        />
        <div
          className={`consent-box ${settings.consent ? "consent-granted" : ""}`}
        >
          <Toggle
            checked={settings.consent}
            onChange={(consent) => update({ consent })}
            label="Allow content analysis"
            description="I allow snippets and context from enabled sites to be sent to this detector and its model provider. When selected above, thumbnail images and public search destination pages may also be fetched and analyzed. I can revoke this at any time."
          />
          <p>
            {settings.consent
              ? "Content analysis is allowed for this detector."
              : "Nothing is sent for analysis until you turn this on."}
          </p>
        </div>
      </section>
    </>
  );
}

export function AboutSettings() {
  return (
    <>
      <div className="page-heading">
        <h1>
          The internet is still
          <br />
          full of good things.
        </h1>
        <p>NO SLOP makes a little more room for them.</p>
      </div>
      <div className="about-wordmark">
        NO SLOP<span>.</span>
      </div>
      <div className="about-content">
        <h2>A filter you can question.</h2>
        <p>
          NO SLOP is an open-source browser extension for identifying low-effort
          generated content, clickbait and human-made filler. It filters
          complete results and posts where it can do so safely, and annotates
          passages when removing them would break the context.
        </p>
        <p>
          The detector uses Jev through OpenRouter. A quality judgment is not
          proof of how content was made. AI-assisted work can be excellent;
          human work can be empty. Uncertainty should leave room for the reader.
        </p>
        <h2>Built to be opened up.</h2>
        <p>
          Contribute a site adapter, improve the evaluation set, report a false
          positive, or help make the interface more accessible. The source
          includes deployment instructions, a contributor guide and documented
          privacy boundaries.
        </p>
        <div className="about-meta">
          <span>Version 0.1.0</span>
          <span>AGPL-3.0</span>
          <span>
            <Heart size={13} /> Community-built
          </span>
        </div>
      </div>
    </>
  );
}
