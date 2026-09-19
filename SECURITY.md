# Security

Do not post API keys, service tokens, private content, or an exploitable live-service URL in a public issue. Until a repository owner configures GitHub private vulnerability reporting, use a private contact chosen by the maintainer; this repository intentionally does not invent an email address.

The current threat model includes hostile web content, malicious URLs and redirects, invalid model responses, untrusted content-script messages, overlarge batches, and requests intended to exhaust the sponsor's model budget. See [deployment boundaries](docs/DEPLOYMENT.md) and the server tests.

Provider keys remain server-side. Hosted processing is opt-in. The browser fails open on network/model errors. Remote model output is parsed as data and never executed as code. Destination requests validate public DNS addresses and pin the connection; every redirect is checked again. Unknown extraction layouts remain visible.

This is a new project. Passing tests is not an independent security audit. Public launch must include operational rate limits, a provider spending cap, a real disclosure contact, browser-store review, and a review of the deployed service's logging and retention.
