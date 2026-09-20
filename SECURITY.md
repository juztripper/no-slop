# Security

Do not post API keys, service tokens, private content, or exploitable vulnerability details in a public issue. Use **Security → Report a vulnerability** in this GitHub repository to report privately. If that option is unavailable, open an issue asking for a private reporting channel without including vulnerability details.

The threat model includes hostile page content, untrusted content-script messages, malformed model responses, oversized batches, credential exposure and requests intended to exhaust the user's provider budget. Optional self-hosted destination inspection also handles malicious URLs, DNS answers and redirects. See [deployment boundaries](docs/DEPLOYMENT.md), [architecture](docs/ARCHITECTURE.md) and the corresponding tests.

## Direct provider credentials

In direct mode, the user supplies their own OpenRouter key through the extension's settings. The key is stored in device-local `chrome.storage.local`, restricted to trusted extension contexts. It is never included in content-script settings, exposed to web pages, stored in Chrome Sync or bundled into a build. Browser-profile access and extension debugging can still expose local secrets; this storage is not an encrypted vault.

Use a dedicated OpenRouter key with a provider spending limit. The extension's persistent daily request cap is a count of paid calls, including failures, not a monetary cap or an abuse-proof account quota. Clearing extension data resets it. The project supplies no maintainer-funded key or service. Never commit keys, put them in fixtures, or include them in bug reports.

Analysis requires explicit consent. Existing self-hosted installations retain their mode; changing mode or credentials requires consent again. The background validates the sender and bounded input before calling the provider. Direct processing uses a fixed OpenRouter endpoint, forbids redirected credential-bearing requests, and does not fetch linked destinations. Model output is validated as data and never executed. Network/model errors leave content visible.

## Optional detector service

A self-hosted detector keeps the OpenRouter key in its environment. The extension's service token is a separate access credential, not the provider key. Keep local detectors bound to loopback. Before exposing one, configure authentication, exact allowed origins, persistent budgets, rate limits and provider spending controls. CORS alone is not authentication.

Destination requests validate public DNS addresses and pin the connection; every redirect is checked again. Unknown extraction layouts remain visible. Anyone operating a public detector must review its logging, retention, access controls, abuse handling and spending limits.

This is a new project. Passing tests is not an independent security audit. The source and unpacked Chromium build remain a developer preview; browser-store publication and hosted services require their own qualification and data-use review.
