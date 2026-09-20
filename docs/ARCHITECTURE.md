# Architecture

The source uses runtime-validated contracts in `src/shared/contracts.ts`, shared Jev questions and verdict policy in `src/shared/decision.ts`, and separately built browser and optional server surfaces. A provider key is never required to build or test deterministic behavior.

## Browser

`src/content` extracts known independent units, gates them by visibility, watches DOM and SPA changes, and associates decisions with content fingerprints. An element reference alone is not an identity: virtualized feeds reuse elements for different posts. Complete cards can be hidden or covered; prose and dependent discussions retain annotations. Rendering keeps framework-owned nodes mounted and restores prior styles on undo. Injected controls use a shadow root.

`src/background` is a Manifest V3 service worker. It validates senders and bounded messages, enforces consent, domain exceptions, enabled platforms, top-frame-only analysis and private-page exclusions. It serializes settings changes and aborts outstanding requests when settings change or a tab navigates. Provider keys and service tokens are retained only in trusted local extension storage; they are redacted from content-script settings. This storage is not an encrypted vault and is not Chrome Sync.

New installations default to direct OpenRouter mode with analysis disabled. Legacy saved settings migrate to self-hosted mode so an upgrade does not silently change the recipient of page text. Changes to processing mode, provider key or detector address require fresh consent.

### Direct OpenRouter processing

`src/background/direct.ts` constructs bounded visible-text records and calls OpenRouter's Jev Decisions endpoint with the user's key. It uses the shared questions, response schema and deterministic verdict policy. Direct mode does not fetch destination URLs, images or thumbnails. Provider credentials go to the fixed OpenRouter endpoint, with redirects forbidden; content scripts cannot choose a provider endpoint or read the key.

A persistent local UTC-day counter reserves paid requests before dispatch, including failed attempts. The default cap is 100 requests, configurable from 1 to 10,000. Persistence survives worker suspension and browser restarts; clearing extension data resets this local protection. It is a request-count allowance, not a currency limit. Users must set an independent OpenRouter key spending limit.

A bounded cache retains content hashes and verdicts without persisting raw text. Work is bounded and cancellable. Network failures and invalid provider output leave content visible. The connection test authenticates the saved key without submitting a paid model decision; it is not a model-quality or balance guarantee.

### Scheduling and interface

Analysis batches share a two-second admission interval across tabs. Request-pacing metadata is stored in trusted session storage so a service-worker restart does not reset it. A deferred batch returns immediately rather than holding a worker fetch open. Upstream HTTP 429 cooldowns use `Retry-After`; content remains visible while retries are deferred. A timer re-extracts current visible items. Pause, consent revocation, restore, navigation and disposal cancel page retries. Daily call limits are separate from pacing.

`src/ui` provides the popup, options and standalone demonstration. It distinguishes demo state from real tab state. The preview never stores a real provider key or silently switches to provider-backed inference. Settings support keyboard use and reduced motion.

## Optional detector service

In self-hosted mode, background requests go to the configured HTTPS or loopback detector, with redirects forbidden and an optional separate service token. Fastify accepts bounded batches at `POST /v1/analyze`. Its OpenRouter key stays in the server environment.

The server can enrich search previews with public destination HTML before asking Jev. It uses the same decision questions, schemas and verdict policy as direct mode. Images and legacy thumbnail requests are ignored. Jev returns typed scores, not generated explanations. Evidence sufficiency gates poor-quality assessment; authorship clues select a category; user settings decide whether to act. These scores are not calibrated estimates of real-world accuracy.

Destination requests validate public addresses and pin DNS connections. Redirects are revalidated, body sizes and timeouts are bounded, cookies are never forwarded and HTML is never executed. Provider output is parsed as data. Fetch failures are not quality signals.

A finite queue limits work. A bounded TTL cache stores hash-keyed verdicts and coalesces identical in-flight work. A persistent UTC-day ledger reserves paid calls before dispatch. The server deliberately supports one process; multiple replicas need shared atomic quotas and budgets. CORS and a token embedded in a public extension cannot by themselves prevent abuse.

## Boundaries

- Quality is subjective. No category proves human or AI authorship.
- Direct mode assesses visible text and context. Optional public HTML fetching cannot establish protected content, all script-driven behavior, accessibility or factual truth.
- No mode inspects images or transcribes video/audio. A text preview cannot establish everything in a video.
- DOM fixtures catch known regressions but cannot replace account-specific live-browser qualification.
- Local builds and passing tests do not publish a release, qualify a hosted service or establish browser-store approval.
