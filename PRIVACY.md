# Privacy and data handling

NO SLOP 0.2.0 lets you use your own OpenRouter key directly from the browser extension. You pay your own provider usage. The project supplies no shared key, credits, or hosted detector and does not receive your key. Inference is remote: selected text goes to OpenRouter and Jev when analysis is enabled.

## Consent and controls

New installations start with analysis disabled. Review the data flow and consent before enabling it. Existing installations retain their self-hosted mode; they are not silently switched to direct processing. Changing processing mode, the provider key, or the detector address requires fresh consent.

Pausing stops new analysis and restores filtered items. You can exclude domains, disable platforms, and revoke consent. A request already delivered to a provider cannot be recalled. Known mail, private-message, account and local-network pages are excluded. Generic detection cannot recognize every private website: exclude sensitive sites before enabling processing there.

## Direct OpenRouter mode

After consent, the extension's background worker sends bounded visible text, titles, captions, snippets and available context to OpenRouter's Jev Decisions endpoint. Context may include a public page heading. Direct mode does not fetch destination links, images or thumbnails, execute website scripts, or transcribe audio/video. It does not read input values, drafts, passwords, cookies or browser history.

Your OpenRouter key stays in `chrome.storage.local` on this browser profile. Access is restricted to trusted extension contexts; content scripts and website pages do not receive it. It is never put in Chrome Sync. This is device-local storage, **not an encrypted credential vault**: someone with access to your browser profile or trusted extension debugging tools may access it. Use a dedicated key with an OpenRouter spending limit and revoke it from your OpenRouter account if needed.

A durable local UTC-day counter reserves each paid request before dispatch, including requests that later fail. The default cap is 100 requests per day and can be set from 1 to 10,000. It limits request count, not currency. Clearing local extension data or reinstalling can reset this local protection; use OpenRouter's key spending controls as the independent dollar limit.

The extension retains a bounded cache of content hashes and verdicts. It does not persist the submitted raw text or a browsing history. Settings and the request ledger stay locally; tab counters and pacing information use browser session storage. The browser sends network metadata, including its IP address, to OpenRouter. OpenRouter and its providers have their own retention and routing policies; review the settings and terms for your account. This document does not promise zero third-party retention.

## Optional self-hosted mode

You can instead run a detector on your computer or a server you control. Its OpenRouter key stays in the server environment; the extension stores only the configured address and an optional, separate service access token. Bounded content records and optional public content URLs go to that detector, which calls OpenRouter/Jev.

When you enable destination inspection in this mode, the detector retrieves public HTML without browser cookies or script execution. Query strings and fragments are removed except necessary YouTube IDs and Google redirect parameters. Destinations see the detector's IP address. Images and legacy thumbnail fields are ignored.

The server keeps a bounded temporary hash-keyed verdict cache and a persistent ledger containing only the UTC date and reserved model-call count. It does not log submitted text or retain a browsing history. Hosting infrastructure may retain request metadata. Anyone operating a detector for other people must disclose their contact details, infrastructure, processors and retention practices.

## Removal and the interface preview

Remove a saved key from settings or uninstall the extension to remove its local settings. Revoke the key in OpenRouter to stop that credential from being used anywhere. Closing a tab clears its counters; cached verdicts expire automatically. Server operators must manage their own ledger and infrastructure data separately.

No analytics or advertising SDK is included. The standalone interface demo stores demonstration settings in localStorage and does not perform model inference or store a real provider key.
