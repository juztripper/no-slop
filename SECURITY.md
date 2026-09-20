# Security

Do not post API keys, service tokens, private content, or exploitable vulnerability details in a public issue. Use **Security → Report a vulnerability** in this GitHub repository to report privately. If that option is unavailable, open an issue asking for a private reporting channel without including vulnerability details.

The current threat model includes hostile web content, malicious URLs and redirects, invalid model responses, untrusted content-script messages, overlarge batches, and requests intended to exhaust the detector operator's model budget. See [deployment boundaries](docs/DEPLOYMENT.md) and the server tests.

The developer preview is self-hosted: each operator supplies their own OpenRouter key and pays for their own provider usage. No project-funded detector is included. Provider keys remain server-side; never paste them into extension settings or commit them. Keep the local detector bound to loopback, and configure authentication, exact allowed origins, rate limits and provider spending controls before exposing a service to other users.

Content analysis requires consent. The browser fails open on network/model errors. Remote model output is parsed as data and never executed as code. Destination requests validate public DNS addresses and pin the connection; every redirect is checked again. Unknown extraction layouts remain visible.

This is a new project. Passing tests is not an independent security audit. The source release and unpacked Chromium build are a developer preview, not a browser-store listing or a qualified hosted service. Anyone operating a public detector is responsible for reviewing its logging, retention, authentication and spending limits. Browser-store publication requires its own permission and data-use review.
