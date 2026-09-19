# Architecture

The source has one shared runtime-validated contract (`src/shared/contracts.ts`) and three separately built surfaces. A provider key is never required to build the extension or interface preview.

## Browser

`src/content` extracts known independent units, gates them by visibility, watches DOM and SPA changes, and associates decisions with content fingerprints. An element reference alone is not an identity: virtualized feeds reuse the same element for different posts. Complete cards can be hidden or covered, while prose and dependent discussions remain visible with annotations. Rendering keeps framework-owned nodes mounted and restores prior styles on undo. Injected controls use a shadow root.

`src/background` is a Manifest V3 service worker. It validates content messages, enforces first-run consent, domain exceptions, enabled platforms, top-frame-only analysis, and known private-page exclusions. It serializes settings saves, keeps tokens in trusted local extension storage, redacts tokens from content-script settings, and stores only counters in session storage. It aborts outstanding requests when settings change or a tab navigates. Credentials go only to the configured HTTPS or loopback detector; redirects are forbidden for that request.

`src/ui` provides the popup, options, and a standalone demonstration. It distinguishes demo state from real tab state. Settings are usable with keyboard and reduced motion. The website preview never silently switches to provider-backed inference.

## Detector service

Fastify accepts bounded batches at `POST /v1/analyze`. The server performs three operations when requested: retrieve public destination HTML; retrieve an allowlisted thumbnail and summarize its visible evidence with a vision model; send the resulting text record to Jev's Decisions API. Jev returns typed probabilities, not generated explanations. A deterministic function maps these signals to a verdict. The browser's settings decide whether to act on it.

Untrusted URLs use public-address validation plus a DNS-pinned connection. Redirects are revalidated, body sizes and timeouts are bounded, cookies are never forwarded, and HTML is never executed. Provider output is parsed against schemas and displayed as text. Provider failures leave content visible.

A finite queue limits work. A bounded TTL cache stores hashed-key verdicts, and identical in-flight work is coalesced. A persisted UTC-day counter reserves paid calls before dispatch. The initial service deliberately supports one process; multi-replica deployments need shared atomic quotas and budgets. CORS and a token embedded in a public extension cannot by themselves prevent abuse.

## Important boundaries

- Detecting low quality is subjective. None of the categories proves human or AI authorship.
- Public HTML fetching cannot assess all script-driven behavior, protected content, accessibility, or factual truth. Blocked/unsupported pages must not masquerade as inspected destinations.
- Title/thumbnail analysis cannot establish everything inside a video. The product does not transcribe video or audio.
- DOM fixtures catch known regressions but cannot substitute for current, account-specific browser qualification.
- A local build and passing tests do not deploy a hosted service, publish a repository, or constitute store approval.
