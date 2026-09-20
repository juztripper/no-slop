# Run your own detector

NO SLOP is bring-your-own-key. The extension talks to a detector you run, and that detector calls Jev through **your OpenRouter account**. You control the key and pay the provider usage. The project does not supply a hosted endpoint, shared credits, or a maintainer-funded key.

The key belongs in the detector's environment, never in extension settings, browser storage, a release ZIP, or a public repository. The optional **service token** is a separate password for your detector; it is not your OpenRouter key.

## Local setup

You need Node.js 24+, npm, Chrome or Edge, the project source, and your own OpenRouter API key with provider credits for detection. The interface preview and deterministic tests work without a key.

1. In the source directory, install and build:

   ```sh
   npm ci
   npm run build
   ```

2. Copy `.env.example` to `.env` if the file does not already exist. Set `OPENROUTER_API_KEY` to your own key. Keep `HOST=127.0.0.1` and `PORT=8787` for local use. Set an upstream key spending limit and choose a `DAILY_CALL_BUDGET` you are comfortable with. The daily limit counts reserved calls, including failures; it does not cap currency spend.

3. Start the detector and leave this terminal running:

   ```sh
   npm run server:dev
   ```

4. Open `chrome://extensions` or `edge://extensions`, enable **Developer mode**, click **Load unpacked**, and select `dist/`.

   If you downloaded `no-slop-0.1.0-chromium.zip`, extract it into a permanent folder and select that folder instead. `manifest.json` must be at the selected folder's root. The ZIP only replaces the extension build step; the detector still runs from the matching project source.

5. Open NO SLOP's settings → **Privacy & service**. Leave the detector address at `http://localhost:8787`, test the connection, review the data flow, and enable content analysis. With the default local setup the service token field stays empty. Refresh existing feed tabs.

6. Keep the detector running while browsing. Closing its terminal stops detection; content stays visible if the detector is unavailable. Use the popup to pause filtering or restore the page.

After rebuilding, reload the extension on the browser's extensions page and refresh feed tabs. Existing content scripts cannot use a reloaded extension until the page is refreshed.

`OPENAI_API_KEY` is accepted as a legacy variable only when its value begins with `sk-or-`. New setups should use `OPENROUTER_API_KEY`. Never commit `.env`.

## Check the setup without spending credits

```sh
curl http://localhost:8787/health
npm run check
```

The health route checks configuration/readiness, not provider balance or model availability. Deterministic tests use mocks. `npm run eval:text`, `npm run eval:live`, and `npm run eval:holdout` make paid provider calls; run them only when you intend to use your account credits.

## Docker on your computer

The supplied `compose.yaml` binds port 8787 to the host's loopback interface. Docker runs the service on `0.0.0.0` inside the container, so you must explicitly allow your extension origin:

1. Load the extension and copy its ID from the browser's extensions page.
2. Set `ALLOWED_ORIGINS=chrome-extension://YOUR_EXTENSION_ID` in `.env`. Replace the placeholder with the actual ID. Comma-separate origins if you use multiple browser profiles.
3. Set `SERVICE_TOKEN` to a random secret and enter the same token under **Privacy & service**.
4. Start the container:

   ```sh
   docker compose up --build -d
   curl http://localhost:8787/health
   ```

The image runs without root. Its filesystem is read-only except the budget volume and temporary directory. The persistent budget volume must survive restarts. Docker configuration is provided; see the [verification record](VERIFICATION.md) for the checks actually completed.

## Host on a server you control

Use a private single-instance deployment for this release. The limiter, queue and cache are per process, and the budget ledger is not a distributed counter.

1. Store your `OPENROUTER_API_KEY` as a host secret. Apply a provider key spending limit independently of `DAILY_CALL_BUDGET`.
2. Set a random `SERVICE_TOKEN` and the exact extension origin(s) in `ALLOWED_ORIGINS`. CORS is not authentication: non-browser clients can forge an origin.
3. Mount persistent storage for `BUDGET_FILE=/data/budget.json`. The service refuses to start with a corrupt ledger. Do not delete the ledger to restart the service.
4. Put a TLS reverse proxy in front of port 8787. Keep the container port bound to loopback. Set `TRUST_PROXY` to the proxy's actual IP/CIDR; never use a wildcard.
5. Add appropriate host/edge rate limits, monitor provider balance and errors, and review the infrastructure's logging and retention.
6. Set the extension's service address to your HTTPS URL and enter the service token. Changing the address revokes consent; review and enable analysis again.
7. Verify the health route, restart persistence, and the installed extension. An actual detection test uses your provider credits.

There is no need to change or rebuild the extension's default endpoint: the address is configurable. Do not expose your private detector to the internet without access controls. Operating a service for other people is a separate responsibility and requires clear provider/data-use disclosures and abuse controls.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Connection test fails | Keep the detector running; check the address and `/health`; use HTTP only on localhost or HTTPS remotely. |
| Unauthorized response | Use your detector's `SERVICE_TOKEN` in extension settings, not the OpenRouter key. |
| Origin rejected | For Docker/remote hosting, allow the exact extension ID shown in your browser. Unpacked IDs can change when the folder changes. |
| Connected, but provider errors appear | Check your own key, credits and provider access. Health checks do not call Jev. |
| “Resuming shortly…” | The extension is respecting a rate limit; it retries automatically. A reached daily limit requires the next UTC day or an intentional budget change. |
| Older page stops scanning after reload | Reload the extension, then refresh the feed tab to load its new content script. |
| Content stays visible | Analysis may be paused, consent may be off, the layout may be unsupported, evidence may be uncertain, or the detector may be unavailable. |

Chrome and Edge are the development targets. Firefox, Safari, store distribution, and every account-specific feed layout remain outside this preview's qualification.
