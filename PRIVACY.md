# Privacy and data handling

This release is bring-your-own-key: you run the detector on your computer or a server you control and pay for inference through your own OpenRouter account. The project does not operate a shared detector or collect your provider key. Local hosting does not make inference offline: selected text is sent to OpenRouter and Jev when analysis is enabled.

NO SLOP starts with remote analysis disabled until you consent in its settings. Pausing the extension stops new analysis and restores filtered items. You can exclude individual domains, disable platforms, turn off destination checks, and revoke consent. Image analysis is disabled, including for installations that previously enabled it.

When active, the extension sends bounded text/title snippets, content type, site adapter name and optional public content URLs to the detector address you configured. Comment context may include the public page heading. It does not send images or thumbnail URLs, or request cookies, passwords, browsing history, input values or drafts. Known mail, private-message, account and local-network pages are excluded. Generic detection cannot recognize every private website: exclude any sensitive site before enabling processing there.

The detector sends extracted text and optional public page text to OpenRouter and TypeSafe's Jev. No vision provider is called. Thumbnail fields from older clients are ignored. Destination checks retrieve public HTML without browser cookies or script execution. Queries/fragments are removed from destination links except necessary YouTube IDs and Google redirect parameters. The destination sees the server's IP address.

The service keeps a bounded, temporary cache of decisions keyed by hashes. It does not log submitted text or retain a browsing history. A small persistent ledger stores only the UTC day and reserved model-call count. Hosting infrastructure and OpenRouter/providers may have their own request metadata and retention policies. Review the provider settings and terms for your account. If you operate a detector for other people, disclose your contact details, infrastructure, processors and retention practices. This document does not promise zero retention at third parties.

Settings and an optional service access token stay in local extension storage. Tab counters stay in browser session storage. No analytics or advertising SDK is included. The demo interface stores its demonstration settings in localStorage and does not perform model inference.

To remove local settings, uninstall the extension. Closing a tab clears its counters; cache entries expire automatically. To stop processing immediately, switch off filtering or revoke consent. A request already delivered to a provider cannot be recalled.
