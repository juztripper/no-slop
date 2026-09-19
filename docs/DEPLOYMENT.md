# Hosting the free detector

The browser never contains the sponsor's OpenRouter key. It talks to this service, which holds the key, enriches public evidence, and calls Jev. The repository is prepared for deployment; it does not claim a public endpoint or store listing exists.

## Local use

Use Node 24 or later. Copy `.env.example` to `.env` only if you do not already have a key file. Set `OPENROUTER_API_KEY`, then run `npm ci`, `npm run build`, and `npm run server:dev`. Load `dist/` from `chrome://extensions` using **Developer mode → Load unpacked**. The first-run settings explain the data flow and require consent. The service defaults to `http://localhost:8787`.

`OPENAI_API_KEY` is accepted as a legacy variable only when its value begins with `sk-or-`. New setups should use the canonical variable. Never commit `.env`.

## A single public instance

1. Choose a host that supports Docker, outbound HTTPS and DNS, and a persistent volume. Run one replica for this release; the rate limit and cache are per process, and the budget ledger is not a distributed counter.
2. Set `OPENROUTER_API_KEY` as a host secret. Apply an OpenRouter key credit/spend limit independently of this service. `DAILY_CALL_BUDGET` caps reserved model calls, not dollars; vision and text have different prices.
3. Set `ALLOWED_ORIGINS` to the exact published extension origin, for example `chrome-extension://<32-character-extension-id>`. Get the actual ID from the packaged extension. For Docker development, allow the exact unpacked extension origin as well.
4. Use a persistent `/data` volume for `BUDGET_FILE=/data/budget.json`. The service refuses to start with a corrupt ledger. Do not erase the volume to restart the service.
5. Put a TLS reverse proxy in front of port 8787. The supplied Compose configuration binds its port only to the host's loopback interface. Forward the real client IP and set `TRUST_PROXY` to that proxy's actual IP/CIDR. A wildcard makes per-IP limits ineffective.
6. Configure an edge rate limit/WAF and an operator alert for provider balance and service errors. Origins can be forged outside a browser; CORS is not authentication or billing protection. A shared token shipped to every user is also not a secret. Keep the global budget and upstream spending cap enabled for the sponsored service.
7. Verify `GET /health`, a known good item and a known poor item through `POST /v1/analyze`, and a real installed extension from outside the host network. Check 429 behavior and a restart without resetting the budget.
8. Set the extension's service address to the HTTPS origin. For a public build, change only the non-secret default endpoint in `src/shared/contracts.ts`, build again, and complete store review.

For a private/self-hosted deployment set `SERVICE_TOKEN` to a random secret and enter it in **Service & privacy** in the extension. It stays in local extension storage, is hidden from content scripts, and is never synced. The provider key stays on the server.

```sh
docker compose up --build -d
curl http://localhost:8787/health
```

The image is non-root, the Compose filesystem is read-only except the budget volume and temporary directory, and no page bodies are logged. The health route confirms configuration/readiness, not provider balance or model availability. Run the live evaluation before a release.

## Scaling and release gates

Before adding replicas, replace the local limiter, queue coordination, and budget ledger with shared atomic storage. Before advertising unrestricted public availability, validate abuse controls under load, choose a support/privacy contact, publish the privacy policy, qualify every supported logged-in site, and submit browser-store permission/privacy disclosures. Current tests cannot establish that every account's personalized DOM works.

Public costs depend heavily on cache hit rate, feed volume, thumbnail frequency, and the selected vision model. Measure actual provider `usage.cost` with `npm run eval:live`; do not price a hosted service from text-token cost alone.
