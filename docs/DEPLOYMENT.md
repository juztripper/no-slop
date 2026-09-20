# Install and connect your account

NO SLOP 0.2.0 uses your own OpenRouter key directly from the extension by default. You pay for your provider usage; the project supplies no shared credits or hosted account. A separate server is optional.

These instructions describe the [0.2.0 developer preview](https://github.com/juztripper/no-slop/releases/tag/v0.2.0). The older 0.1.0 package still needs a detector; use its [versioned instructions](releases/0.1.0.md) if you have not upgraded.

## Install the extension

You need Chrome or Edge and an OpenRouter account with provider credits. You do **not** need Node.js, a source checkout, or a running terminal to use the 0.2.0 extension ZIP.

1. Extract `no-slop-0.2.0-chromium.zip` into a permanent folder.
2. Open `chrome://extensions` or `edge://extensions`. Enable **Developer mode**, choose **Load unpacked**, and select the extracted folder. `manifest.json` must be at its root.
3. Open NO SLOP's settings → **Privacy & connection** and choose **OpenRouter**.
4. Create a dedicated key at [OpenRouter → API keys](https://openrouter.ai/settings/keys). Set a dollar spending limit there, then paste the key into NO SLOP and save it.
5. Choose **Check connection**. This authenticates the key without requesting a paid model decision; it does not prove model availability or detection quality.
6. Choose a daily request limit, review the data-sharing notice, give consent, and enable analysis. Refresh existing feed tabs.

The default is **100 paid requests per UTC day**, configurable from 1 to 10,000. Requests are reserved before dispatch; failures can count. This is a request cap, **not a dollar cap**. Set the independent OpenRouter key limit too. Clearing local extension data can reset the local counter.

Your key is stored on this device in trusted extension storage, never Chrome Sync or content scripts. This is not an encrypted vault. Direct mode sends bounded text, titles, captions, snippets and context to OpenRouter/Jev; it does not fetch destination pages or images. Read [PRIVACY.md](../PRIVACY.md) before enabling analysis.

Use the popup to pause or restore the page. Removing the key or revoking consent stops new processing; requests already sent cannot be recalled. Revoke a compromised key from your OpenRouter account.

## Update an existing installation

Replace the files in the same unpacked folder, reload NO SLOP from the extensions page, and refresh feed tabs. Existing content scripts cannot use a reloaded extension until the page is refreshed.

Existing 0.1.0 installations retain self-hosted mode, their detector address and their prior settings. To stop needing that server, choose **OpenRouter**, save your own provider key, test it, and consent again. Changing processing mode, provider key, or detector address revokes analysis consent. Keep the old detector running until you have intentionally switched.

## Build or contribute from source

Only source development and the optional Node.js detector require **Node.js 24+** and npm:

```sh
npm ci
npm run check
```

Load `dist/` as an unpacked extension and follow the direct setup above. The build, interface preview (`npm run dev`) and deterministic tests need no key or server. `npm run release:package` creates the extension ZIP, checksum and release notes under `artifacts/releases/v0.2.0/`.

Corpus evaluation uses a local `.env` containing your own `OPENROUTER_API_KEY`. `npm run eval:text`, `npm run eval:live`, and `npm run eval:holdout` make paid provider calls. They are optional and separate from the free connection test.

## Optional self-hosted detector

Self-hosted mode is useful for public search-destination inspection or running a detector under your own infrastructure controls. The server calls OpenRouter; it does not run an AI model locally. Direct mode needs no part of this setup.

1. In the source directory, run `npm ci`. Copy `.env.example` to `.env` if it does not exist.
2. Set `OPENROUTER_API_KEY` to your own key. Keep `HOST=127.0.0.1` and `PORT=8787` for local use. Set an OpenRouter key spending limit and a `DAILY_CALL_BUDGET`; the latter counts reserved calls, not currency.
3. Start the detector and keep its terminal running:

   ```sh
   npm run server:dev
   ```

4. In NO SLOP's **Privacy & connection** settings, choose **Self-hosted detector**, set `http://localhost:8787`, and save. The service token stays empty with the default local setup.
5. Test the connection, review the data flow, consent and enable analysis. Destination inspection is available only in this mode. If the detector stops, content stays visible.

In self-hosted mode, the provider key belongs in the server environment. The optional **service token** is a separate password for your detector, not the OpenRouter key. Never commit `.env`. `OPENAI_API_KEY` remains a legacy server variable only when its value starts with `sk-or-`; new configurations should use `OPENROUTER_API_KEY`.

`curl http://localhost:8787/health` checks server configuration/readiness without a paid model request. It does not verify provider balance or model availability.

### Docker on your computer

The supplied `compose.yaml` binds port 8787 to the host's loopback interface. Docker listens on `0.0.0.0` inside its container, so explicitly allow your extension origin:

1. Load the extension and copy its ID from the browser's extensions page.
2. Set `ALLOWED_ORIGINS=chrome-extension://YOUR_EXTENSION_ID` in `.env`, replacing the placeholder. Comma-separate origins for multiple browser profiles.
3. Set `SERVICE_TOKEN` to a random secret and enter the same token in the extension's self-hosted settings.
4. Run `docker compose up --build -d` and check `curl http://localhost:8787/health`.

The image runs without root. Its filesystem is read-only except the budget volume and temporary directory. Preserve the budget volume across restarts. Docker configuration is provided; see [VERIFICATION.md](VERIFICATION.md) for checks actually completed.

### Host on a server you control

Use a private single-instance deployment. The limiter, queue and cache are per process; the budget ledger is not a distributed counter.

1. Store `OPENROUTER_API_KEY` as a host secret and apply an independent provider spending limit.
2. Set a random `SERVICE_TOKEN` and exact extension origins in `ALLOWED_ORIGINS`. CORS is not authentication: other clients can forge an origin.
3. Mount persistent storage for `BUDGET_FILE=/data/budget.json`. A corrupt ledger prevents startup; do not delete it to restart the service.
4. Put a TLS reverse proxy in front of port 8787. Keep that port bound to loopback. Set `TRUST_PROXY` to the proxy's actual IP/CIDR, never a wildcard.
5. Add host/edge rate limits, monitor provider balance and errors, and review infrastructure logging and retention.
6. Set the extension's self-hosted address to your HTTPS URL, enter the service token, test and consent again.
7. Verify the health route, restart persistence and installed extension. Actual model decisions use your provider credits.

Operating a service for other people requires separate access controls, provider/data-use disclosures and abuse handling. It is not required to use or contribute to NO SLOP.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| OpenRouter authentication fails | Save the complete key in direct-mode settings; check whether the key was revoked. The test makes no paid model request. |
| Key works, but model calls fail | Check credits, key spending limit and Jev availability. Authentication success does not qualify inference. |
| Daily request limit reached | Wait until the next UTC day or intentionally change the local cap. The OpenRouter spending limit remains independent. |
| Self-hosted connection fails | Start the detector and check its address and `/health`; use HTTP only on localhost, or HTTPS remotely. |
| Self-hosted request is unauthorized | Use the detector's separate `SERVICE_TOKEN` in its service-token field. |
| Origin rejected | Allow the exact extension ID for Docker/remote hosting. Unpacked IDs may change when the folder changes. |
| “Resuming shortly…” | The extension is respecting request pacing or an upstream rate limit and will retry. |
| Older page stops scanning after update | Reload the extension, then refresh the tab. |
| Content stays visible | Analysis may be paused, consent may be off, evidence may be uncertain, the layout may be unsupported, or a request may have failed. |

Chrome and Edge are the development targets. Firefox, Safari, store distribution and every account-specific feed layout remain outside this preview's qualification.
