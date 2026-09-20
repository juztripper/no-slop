import { useEffect, useState, type FormEvent } from "react";
import { Button, Callout, IconButton, RadioCards, TextField } from "@radix-ui/themes";
import { Globe2, Heart, LockKeyhole, ShieldCheck, X } from "lucide-react";
import type { Settings, Platform } from "../shared/contracts";
import { isExtension, request } from "./bridge";
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
  const [mode, setMode] = useState(settings.connectionMode);
  const [key, setKey] = useState(isExtension ? settings.openRouterKey : "");
  const [limit, setLimit] = useState(String(settings.dailyCallLimit));
  const [endpoint, setEndpoint] = useState(settings.endpoint);
  const [token, setToken] = useState(isExtension ? settings.serviceToken : "");
  const [connection, setConnection] = useState("");
  const [connectionError, setConnectionError] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setMode(settings.connectionMode);
    setKey(isExtension ? settings.openRouterKey : "");
    setLimit(String(settings.dailyCallLimit));
    setEndpoint(settings.endpoint);
    setToken(isExtension ? settings.serviceToken : "");
  }, [settings.connectionMode, settings.openRouterKey, settings.dailyCallLimit,
    settings.endpoint, settings.serviceToken]);
  const direct = mode === "direct";
  const dirty = mode !== settings.connectionMode || (direct
    ? key !== settings.openRouterKey || limit !== String(settings.dailyCallLimit)
    : endpoint !== settings.endpoint || token !== settings.serviceToken);
  const configured = direct ? Boolean(settings.openRouterKey) : Boolean(settings.endpoint);
  function edit(action: () => void) {
    action();
    setConnection("");
    setConnectionError(false);
  }
  async function saveConnection(event?: FormEvent) {
    event?.preventDefault();
    if (!isExtension || busy) return;
    setBusy(true);
    setConnectionError(false);
    try {
      let patch: Partial<Settings> = { connectionMode: mode };
      if (direct) {
        if (!key.trim()) throw new Error("Add your OpenRouter API key before saving.");
        const dailyCallLimit = Number(limit);
        if (!Number.isInteger(dailyCallLimit) || dailyCallLimit < 1 || dailyCallLimit > 10000)
          throw new Error("Choose a whole number from 1 to 10,000 requests per day.");
        patch = { ...patch, openRouterKey: key.trim(), dailyCallLimit };
      } else {
        const url = new URL(endpoint.trim());
        if (url.username || url.password || url.search || url.hash)
          throw new Error("Use a detector URL without credentials, query parameters or a fragment.");
        if (url.protocol !== "https:" && !(url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
          throw new Error("Use HTTPS, or HTTP for a detector on localhost.");
        patch = { ...patch, endpoint: url.href.replace(/\/$/, ""), serviceToken: token.trim() };
      }
      const saved = await update(patch);
      if (saved === false)
        throw new Error("The connection could not be saved. Check the settings error and try again.");
      const changedConnection = mode !== settings.connectionMode || (direct
        ? patch.openRouterKey !== settings.openRouterKey
        : patch.endpoint !== settings.endpoint || patch.serviceToken !== settings.serviceToken);
      setConnection(settings.consent && !changedConnection
        ? "Settings saved. Content analysis is still allowed."
        : "Connection saved. Check the connection, then allow content analysis below.");
    } catch (reason) {
      setConnectionError(true);
      setConnection(reason instanceof Error ? reason.message : "Could not save the connection.");
    } finally {
      setBusy(false);
    }
  }
  async function removeKey() {
    if (!isExtension || busy) return;
    setBusy(true);
    setConnectionError(false);
    try {
      const saved = await update({ openRouterKey: "", consent: false });
      if (saved === false) throw new Error("The key could not be removed. Try again.");
      setKey("");
      setConnection("API key removed. Content analysis is off.");
    } catch (reason) {
      setConnectionError(true);
      setConnection(reason instanceof Error ? reason.message : "Could not remove the key.");
    } finally {
      setBusy(false);
    }
  }
  async function testConnection() {
    if (!isExtension || busy || dirty || !configured) return;
    setBusy(true);
    setConnection(direct ? "Checking your OpenRouter key…" : "Checking the detector…");
    setConnectionError(false);
    try {
      const result = await request<{ ok: boolean; error?: string }>({ type: "HEALTH_CHECK" });
      if (!result.ok)
        throw new Error(result.error || "Connection failed. Check your saved connection details.");
      setConnection(direct
        ? "Connected to OpenRouter. This check did not run paid analysis."
        : "Connected. The detector is ready.");
    } catch (reason) {
      setConnectionError(true);
      setConnection(reason instanceof Error ? reason.message : "Connection failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <h1>Your connection. Your control.</h1>
        <p>
          Add your own OpenRouter key, review what gets shared, then allow content
          analysis. No separate server is needed.
        </p>
      </div>
      <Callout.Root className="privacy-callout" size="2">
        <Callout.Icon><LockKeyhole size={23} /></Callout.Icon>
        <div>
          <h2>{direct ? "You pay for your own usage." : "An optional service you control."}</h2>
          <Callout.Text>
            {direct
              ? "NO SLOP sends text to OpenRouter using your key. Set a spending cap on that key in OpenRouter to control provider charges."
              : "Your detector calls the model provider using its server-side key. The detector operator controls provider usage and any destination fetching."}
          </Callout.Text>
        </div>
      </Callout.Root>
      <section className="connection-section">
        <h2>Connection</h2>
        <RadioCards.Root
          className="connection-modes"
          size="1"
          highContrast
          columns="2"
          gap="2"
          value={mode}
          disabled={busy}
          onValueChange={(value) => {
            if (value === "direct" || value === "server") edit(() => setMode(value));
          }}
          aria-label="Analysis connection"
        >
          <RadioCards.Item value="direct">
            <span>OpenRouter<small>No server needed</small></span>
          </RadioCards.Item>
          <RadioCards.Item value="server">
            <span>Self-hosted detector<small>Advanced · optional</small></span>
          </RadioCards.Item>
        </RadioCards.Root>
        {!isExtension && (
          <p className="field-hint" id="preview-credentials-hint">
            Preview only. Add credentials in the installed extension; this page
            cannot save keys or connect to a provider.
          </p>
        )}
        <form onSubmit={saveConnection}>
          {direct ? (
            <>
              <label className="field-label" htmlFor="openrouter-key">OpenRouter API key</label>
              <TextField.Root
                className="service-input"
                size="3"
                id="openrouter-key"
                type="password"
                value={key}
                disabled={!isExtension || busy}
                onChange={(event) => edit(() => setKey(event.target.value))}
                placeholder={isExtension ? "Paste your own API key" : "Available in the installed extension"}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                aria-describedby="openrouter-key-hint"
              />
              <p className="field-hint" id="openrouter-key-hint">
                <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer">Create a key and set its spending cap</a>.
                {" "}Your key is saved on this device, in extension storage. It is not
                synced or shared with web pages. Remove it here at any time.
              </p>
              <label className="field-label" htmlFor="daily-call-limit">Daily request allowance</label>
              <TextField.Root
                className="daily-limit-input"
                size="3"
                id="daily-call-limit"
                type="number"
                min="1"
                max="10000"
                step="1"
                value={limit}
                disabled={busy}
                onChange={(event) => edit(() => setLimit(event.target.value))}
                aria-describedby="daily-call-limit-hint"
              />
              <p className="field-hint" id="daily-call-limit-hint">
                Maximum analysis requests per day on this device, from 1 to 10,000.
                Resets at midnight UTC. This is a request limit, not a dollar budget. Use OpenRouter’s key
                spending cap to limit costs.
              </p>
            </>
          ) : (
            <>
              <label className="field-label" htmlFor="endpoint">Service URL</label>
              <TextField.Root
                className="service-input" size="3" id="endpoint" type="url"
                value={endpoint} disabled={busy}
                onChange={(event) => edit(() => setEndpoint(event.target.value))}
                placeholder="https://your-detector.example" autoComplete="url"
                spellCheck={false} aria-describedby="endpoint-hint"
              />
              <p className="field-hint" id="endpoint-hint">
                Use a detector you run or trust. It must remain running while
                you browse. Direct OpenRouter mode does not need this service.
              </p>
              <label className="field-label" htmlFor="service-token">
                Service access token <span>Optional</span>
              </label>
              <TextField.Root
                className="service-input" size="3" id="service-token" type="password"
                value={token} disabled={!isExtension || busy}
                onChange={(event) => edit(() => setToken(event.target.value))}
                placeholder={isExtension ? "Provided by the detector operator" : "Available in the installed extension"}
                autoComplete="off" spellCheck={false} aria-describedby="service-token-hint"
              />
              <p className="field-hint" id="service-token-hint">
                A service token, not an OpenRouter API key. Saved on this device
                in extension storage; never synced.
              </p>
            </>
          )}
          <div className="button-row connection-actions">
            <Button className="button button-primary" highContrast size="2" variant="solid"
              type="submit" disabled={!isExtension || !dirty || busy || (direct && !key.trim())}>
              Save connection
            </Button>
            <Button className="button button-secondary" size="2" variant="soft" type="button"
              disabled={!isExtension || busy || dirty || !configured} onClick={testConnection}>
              {busy ? "Working…" : "Check connection"}
            </Button>
            {direct && settings.openRouterKey && isExtension && (
              <Button size="2" variant="ghost" color="gray" type="button"
                disabled={busy} onClick={removeKey}>Remove key</Button>
            )}
          </div>
          {isExtension && dirty && <p className="field-hint">Save these changes before checking or allowing analysis.</p>}
          {isExtension && direct && !dirty && !configured && <p className="field-hint">Save a key to check your connection. The check does not run paid analysis.</p>}
          {connection && (
            <Callout.Root role="status" size="1" color={connectionError ? "red" : "gray"}
              className={connectionError ? "error-message" : "success-message"}>
              <Callout.Text>{connection}</Callout.Text>
            </Callout.Root>
          )}
        </form>
      </section>
      <section className="preferences-section">
        <h2>{direct ? "What OpenRouter may see" : "What the detector may see"}</h2>
        <div className="data-description">
          <p>
            <strong>Content snippets and context.</strong> Titles, visible text,
            captions, surrounding context{direct ? "" : " and content links"} may be sent to
            {direct ? " OpenRouter and its model provider" : " your detector and its model provider"},
            including content in a signed-in feed. Password fields and direct-message
            interfaces are excluded where recognized. Avoid enabling it on sensitive sites.
          </p>
        </div>
        {!direct && (
          <Toggle
            checked={settings.inspectDestinations}
            disabled={dirty || busy || !isExtension}
            onChange={(inspectDestinations) => update({ inspectDestinations })}
            label="Inspect search destinations"
            description="Let the service fetch public result pages before you visit them. This adds context and may increase latency."
          />
        )}
        <div className={`consent-box ${settings.consent && !dirty ? "consent-granted" : ""}`}>
          <Toggle
            checked={settings.consent}
            disabled={!isExtension || busy || (!settings.consent && (dirty || !configured))}
            onChange={(consent) => update({ consent })}
            label="Allow content analysis"
            description={direct
              ? "I allow text snippets and context from enabled sites to be sent directly to OpenRouter and its model provider using my key. Images are not analyzed. Linked pages are not fetched. I can revoke this at any time."
              : "I allow text snippets and context from enabled sites to be sent to this detector and its model provider. When selected above, public search destination pages may also be fetched and analyzed. Images are not analyzed. I can revoke this at any time."}
          />
          <p>
            {dirty
              ? "Changes take effect when saved. A new key or service requires consent again."
              : settings.consent
                ? "Content analysis is allowed for this connection."
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
          <span>Version 0.2.0</span>
          <span>AGPL-3.0</span>
          <span>
            <Heart size={13} /> Community-built
          </span>
        </div>
      </div>
    </>
  );
}
