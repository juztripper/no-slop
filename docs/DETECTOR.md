# The detector

NO SLOP makes a conservative judgment about content quality. It does not prove whether a person or a model made something, establish factual truth, or judge the effort behind a work. Helpful AI-assisted material stays. Amateur writing, a political viewpoint, a catchy title, and a topic about AI are not sufficient reasons to filter.

## How an item is assessed

1. The extension extracts one complete content unit: a result, post, video card, reply, or paragraph, with nearby context where available. It sends only bounded fields after the user enables detection.
2. Images are ignored. The extension does not extract or send thumbnail URLs. Saved image preferences and legacy API requests normalize to disabled; the detector never downloads an image or calls a vision model.
3. If destination inspection is enabled, search results are fetched by the service before the user opens them. The fetcher follows at most three redirects and extracts public HTML text with Mozilla Readability, capped at 12,000 DOM elements. A semantic-text fallback preserves short spam/doorway pages that have no readable article. Extracted text is capped at 10,000 characters. Scripts never execute. Social-media permalinks are not fetched as search destinations.
4. Jev receives the text, context, and available destination text. Four `noul` questions assess substantial poor quality, specific synthetic clues, deceptive hooks, and evidence sufficiency. The rubric judges the visible item, including direct manipulative claims, circular filler, keyword doorways, spam and unfinished generator residue. Quotation, criticism, satire, useful detail and honest limits are explicit counterexamples.
5. A deterministic policy combines these answers into a verdict. The user's category toggles, threshold, and presentation settings determine what the extension changes.

Jev uses OpenRouter's dedicated [`POST /api/alpha/decisions`](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-questions-and-answers-request), with the requested alias `~typesafe/jev-latest`. A live request on 2026-09-19 resolved to `typesafe/jev-1.13-20260917`. Jev currently accepts [text only](https://docs.typesafe.ai/concepts/system-one). Its [`noul` answer](https://docs.typesafe.ai/primitives/noul) is a yes-probability, not a free-form explanation. The reasons shown to users are explicit policy descriptions; they are not fabricated model reasoning.

## Decisions and uncertainty

Policy `text-quality-v2.0` uses the model's poor-quality score directly. Evidence sufficiency must first reach 0.70; otherwise the detector abstains. Poor quality must reach 0.60 to receive a slop category, and must also meet the user's threshold before filtering. Synthetic clues select the category: at least 0.85 selects `ai-slop`, at most 0.25 selects `human-slop`, and intermediate values select `slop`. They do not subtract from the quality score. These model-derived scores are not independently calibrated probabilities of real-world accuracy; the interface calls the threshold a minimum score.

| Verdict | Meaning |
| --- | --- |
| `ai-slop` | Strong poor-quality evidence and specific synthetic clues; never proof of AI authorship. |
| `human-slop` | Traditional spam or poor-quality content without strong synthetic clues; human authorship is unknown. |
| `slop` | Strong poor-quality evidence with unclear authorship. Filtered only when both category toggles are enabled. |
| `quality` | No strong quality problem found in the available evidence. This is not an endorsement or fact check. |
| `uncertain` | Available evidence is insufficient or mixed. Kept visible. |

The default threshold is 0.85; Gentle uses 0.95 and Strict uses 0.70. Scores are rounded to six decimal places to avoid floating-point boundary errors. A deceptive hook is an explanatory signal, not a sufficient reason by itself to filter. Vague titles stay; an explicit promise of huge guaranteed rewards without effort can provide enough evidence in its own wording. A failed destination fetch is disclosed and never treated as a quality defect. Its preview can still be assessed if independently sufficient. Failed provider requests and malformed model outputs produce per-item errors, never guessed verdicts.

## Evaluation evidence

Run `npm run eval:text` with a configured OpenRouter key. It makes 40 paid Jev requests and writes [`evaluations/text-candidate.json`](evaluations/text-candidate.json), including the corpus hash, exact questions, individual answers, preset outcomes, timing and reported cost. The evaluation uses a separate bounded ledger so it does not race a running local service's ledger. No API key is written.

The authored corpus contains 14 filter examples and 26 keep examples, including contrast pairs in English, Portuguese and Spanish. Before the change, the same corpus produced 33/40 expected outcomes: seven missed low-quality items and no false positives, preserved in [`evaluations/text-baseline.json`](evaluations/text-baseline.json). The first text-quality-v2.0 run produced 40/40 expected outcomes at Balanced: all 14 poor items detected and all 26 keep items retained. These are development cases used to evaluate the change, not an independent test set. Reports for the earlier policy in `latest.json`, `baseline.json` and `holdout.json` are historical, including their old image checks.

The cases cover manipulative wealth claims versus transparent business reports, filler versus practical answers, generator residue versus quoted criticism, useful AI-assisted work, honest promotion, short replies, satire and missing context. Model outputs vary between runs; repeating a small corpus is not a substitute for broader qualification.

This is not a representative accuracy benchmark. Before a broad public release, gather consented examples from each supported surface, have multiple reviewers label them using a published rubric, separate a held-out evaluation set, and report precision, recall, abstention, and false positives by language and content type. Include adversarial content, minority dialects, satire, art, and useful machine-assisted work. Check decisions again whenever the moving Jev alias changes. Prefer a pinned model after qualification.

## Resource and privacy boundaries

- No content, authorization headers, prompts, or provider responses are logged. The verdict cache is bounded in memory, keyed by a digest of content, options, policy, and model names. Its default TTL is 30 minutes. In-flight duplicate items share work.
- Public fetching rejects IP literals, private/reserved addresses, mixed public/private DNS, credentials, nonstandard ports, and local hostnames. Each redirect is checked again. The validated address is pinned to the socket while preserving TLS hostname verification. Requests use GET and send no browser cookies or user credentials.
- Destination HTML is capped at 750 KB; compressed responses are rejected. The parser does not run scripts or fetch subresources. Images are not requested.
- The service bounds request bodies, item counts, text lengths, per-IP rate, concurrency, and queue length. Each item has a 25-second absolute deadline including queue time. Abort signals reach every network stage; expired queued work is removed before it can call a paid provider. Destination fetching and Jev each allow 6 seconds within that deadline.
- A persisted daily counter reserves each paid provider request before sending it. The default limit is 10,000 calls, including failed calls. It is a call cap, not a monetary cap. Set an additional OpenRouter key/workspace spending limit. Run one service process per ledger; multiple replicas require a shared atomic quota and rate-limit store.
- The ledger contains only a UTC date and call count. Put `BUDGET_FILE` on persistent storage for hosting. An unreadable or corrupt ledger fails closed. Deleting the ledger or using ephemeral storage resets that protection.
- CORS permits unpacked Chrome extension origins only on the default localhost binding. Hosted deployments must list exact origins in `ALLOWED_ORIGINS`; a configurable bearer service token is checked independently. CORS is not authentication and public extension tokens are extractable. Use a gateway with abuse controls before opening a subsidized public endpoint.
- The API key stays on the server. `OPENROUTER_API_KEY` is canonical. For this project's existing local environment, `OPENAI_API_KEY` is accepted only when its value begins with OpenRouter's `sk-or-` prefix.

Public fetching contacts the destination from the server and can appear in its access logs. Provider retention and routing are governed by OpenRouter and the selected providers. Configure the provider account's privacy controls for the hosted service and disclose the actual operator, processors, and retention policy before publication.

## Known limits

The service sees extracted previews and selected public page text, not the full experience of a website. JavaScript-only pages, logins, bot challenges, video/audio content, image-only claims and paywalls may provide too little evidence. Destination inspection cannot certify performance, safety, truthfulness, or whether a site works for the user. Prompt boundaries and typed schemas reduce injection opportunities; model judgment remains fallible.

Keep the extension's reveal, restore, allowlist, and undo controls available. False positives are more costly than leaving a doubtful item visible.
