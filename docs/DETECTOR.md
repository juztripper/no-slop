# The detector

NO SLOP makes a conservative judgment about content quality. It does not prove whether a person or a model made something, establish factual truth, or judge the effort behind a work. Helpful AI-assisted material stays. Amateur writing, a political viewpoint, a catchy title, and a topic about AI are not sufficient reasons to filter.

## How an item is assessed

1. The extension extracts one complete content unit: a result, post, video card, reply, or paragraph, with nearby context where available. It sends only bounded fields after the user enables detection.
2. If thumbnail inspection is enabled, the service downloads an image from a supported platform CDN. `google/gemini-2.5-flash-lite` describes visible evidence as validated JSON. Actual image bytes reach the vision model; a URL string alone is never called image analysis.
3. If destination inspection is enabled, search results are fetched by the service before the user opens them. The fetcher follows at most three redirects and extracts public HTML text with Mozilla Readability, capped at 12,000 DOM elements. A semantic-text fallback preserves short spam/doorway pages that have no readable article. Extracted text is capped at 10,000 characters. Scripts never execute. Social-media permalinks are not fetched as search destinations.
4. Jev receives the text, context, and available enrichment. Four independent `noul` questions assess substantial poor quality, specific synthetic clues, deceptive hooks, and evidence sufficiency.
5. A deterministic policy combines these answers into a verdict. The user's category toggles, threshold, and presentation settings determine what the extension changes.

Jev uses OpenRouter's dedicated [`POST /api/alpha/decisions`](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-questions-and-answers-request), with the requested alias `~typesafe/jev-latest`. A live request on 2026-09-19 resolved to `typesafe/jev-1.13-20260917`. Jev currently accepts [text only](https://docs.typesafe.ai/concepts/system-one). Its [`noul` answer](https://docs.typesafe.ai/primitives/noul) is a yes-probability, not a free-form explanation. The reasons shown to users are explicit policy descriptions; they are not fabricated model reasoning.

## Decisions and uncertainty

Let `L` be the model's poor-quality score, `S` its synthetic-evidence score, and `E` its evidence-sufficiency score. The policy uses the conservative lower bound `max(0, L + E − 1)` for poor quality with sufficient evidence. For the synthetic category, it uses `max(0, L + E + S − 2)`. This avoids assuming independent answers are statistically independent. These model-derived scores are not independently calibrated probabilities of real-world accuracy.

| Verdict | Meaning |
| --- | --- |
| `ai-slop` | Strong poor-quality evidence and specific synthetic clues; never proof of AI authorship. |
| `human-slop` | Traditional spam or poor-quality content without strong synthetic clues; human authorship is unknown. |
| `slop` | Strong poor-quality evidence with unclear authorship. Filtered only when both category toggles are enabled. |
| `quality` | No strong quality problem found in the available evidence. This is not an endorsement or fact check. |
| `uncertain` | Evidence is insufficient, mixed, or requested inspection failed. Kept visible. |

The default threshold is 0.85. Confidence is rounded to six decimal places to avoid floating-point boundary errors. A deceptive hook is an explanatory signal, not a sufficient reason by itself to filter. A short title without context generally stays. A requested thumbnail or destination that fails inspection cannot silently produce a filtering verdict. Failed provider requests and malformed model outputs produce per-item errors, never guessed verdicts.

## Evaluation evidence

Run `npm run eval:live -- --media` with a configured OpenRouter key. It makes paid API calls. The script writes [`evaluations/latest.json`](evaluations/latest.json) with individual verdicts, scores, timing, and failures. No API key is written. [`evaluations/baseline.json`](evaluations/baseline.json) preserves the initial run before the unknown-authorship policy and floating-point fix.

The 2026-09-19 development smoke corpus contains 18 authored examples and two integration examples. The corrected run passed 18/20 expectations, with no false positives among 15 keep examples and 3/5 intentionally poor items detected at 0.85. A keyword doorway and synthetic placeholder article scored 0.82 and 0.84 and stayed visible. These misses remain in the report. Model outputs vary slightly between runs; repeated runs are not a substitute for a held-out dataset.

The cases cover useful AI-assisted writing, honest catchy headlines, amateur English, Portuguese and Spanish, satire, promotion, scams, prompt injection, and missing context. The integration cases successfully downloaded and interpreted a real YouTube thumbnail and fetched an MDN destination. They establish that both pipelines execute, not that all thumbnails or search destinations are correctly understood.

This is a small development smoke test, not a representative accuracy benchmark. There is no claim of 90% real-world accuracy. Before a broad public release, gather consented examples from each supported surface, have multiple reviewers label them using a published rubric, separate a held-out evaluation set, and report precision, recall, abstention, and false positives by language and content type. Include adversarial content, minority dialects, satire, art, and useful machine-assisted work. Check decisions again whenever the moving Jev alias or vision model changes. Prefer a pinned model after qualification.

## Resource and privacy boundaries

- No content, authorization headers, prompts, or provider responses are logged. The verdict cache is bounded in memory, keyed by a digest of content, options, policy, and model names. Its default TTL is 30 minutes. In-flight duplicate items share work.
- Public fetching rejects IP literals, private/reserved addresses, mixed public/private DNS, credentials, nonstandard ports, and local hostnames. Each redirect is checked again. The validated address is pinned to the socket while preserving TLS hostname verification. Requests use GET and send no browser cookies or user credentials.
- Only JPEG, PNG, and WebP thumbnails from explicit platform CDN domains are accepted, with content-type and file-signature checks. HTML is capped at 750 KB and images at 1.5 MB; compressed responses are rejected. The parser does not run scripts or fetch subresources.
- The service bounds request bodies, item counts, text lengths, per-IP rate, concurrency, and queue length. Each item has a 25-second absolute deadline including queue time. Abort signals reach every network stage; expired queued work is removed before it can call a paid provider. Fetches allow 6 seconds, vision 8 seconds, and Jev 6 seconds within that deadline.
- A persisted daily counter reserves each paid provider request before sending it. The default limit is 10,000 calls, including failed calls. It is a call cap, not a monetary cap. Set an additional OpenRouter key/workspace spending limit. Run one service process per ledger; multiple replicas require a shared atomic quota and rate-limit store.
- The ledger contains only a UTC date and call count. Put `BUDGET_FILE` on persistent storage for hosting. An unreadable or corrupt ledger fails closed. Deleting the ledger or using ephemeral storage resets that protection.
- CORS permits unpacked Chrome extension origins only on the default localhost binding. Hosted deployments must list exact origins in `ALLOWED_ORIGINS`; a configurable bearer service token is checked independently. CORS is not authentication and public extension tokens are extractable. Use a gateway with abuse controls before opening a subsidized public endpoint.
- The API key stays on the server. `OPENROUTER_API_KEY` is canonical. For this project's existing local environment, `OPENAI_API_KEY` is accepted only when its value begins with OpenRouter's `sk-or-` prefix.

Public fetching contacts the destination from the server and can appear in its access logs. Provider retention and routing are governed by OpenRouter and the selected providers. Configure the provider account's privacy controls for the hosted service and disclose the actual operator, processors, and retention policy before publication.

## Known limits

The service sees extracted previews and selected public page text, not the full experience of a website. JavaScript-only pages, logins, bot challenges, video/audio content, unavailable images, and paywalls may provide too little evidence. Destination inspection cannot certify performance, safety, truthfulness, or whether a site works for the user. Thumbnail analysis cannot establish the quality of an unseen video. Prompt boundaries and typed schemas reduce injection opportunities; model judgment remains fallible.

Keep the extension's reveal, restore, allowlist, and undo controls available. False positives are more costly than leaving a doubtful item visible.
