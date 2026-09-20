# Verification record

Latest local checks on 20 September 2026. This file distinguishes implemented behavior, measured checks, and launch work that has not happened.

## Automated checks

`npm run check` passed: strict TypeScript, **167 tests across 14 files**, the extension production build, and the compiled service build. The suite covers settings persistence, extension message trust, consent revocation, secret redaction, queue/deadline behavior, stale/recycled nodes, privacy paths, full-card boundaries, restored app styles, nested replies, focus safety, reduced motion, SSRF and redirects, schema failures, provider errors, CORS, authentication, quotas, and caching.

Eight extension-reload regressions exercise the actual content entry and controller with a simulated Chrome runtime. They cover synchronous throws and rejected promises during startup/status reporting, runtime loss in quiet tabs, returning from the back-forward cache, late analysis results, removal of treatments/listeners/timers, and retention after temporary message failures. The refreshed build still requires a manual installed-extension reload check; existing tabs must be refreshed to replace older scripts.

Rate-limit regressions simulate sustained requests from four tabs and verify at most 30 admitted batches per minute, shared server cooldowns, worker-restart persistence, automatic retries without user activity, re-extraction of recycled cards, offscreen deferral, and cancellation after pause, consent revocation, restore or disposal. These are automated timing/integration tests; the refreshed unpacked extension still needs reloading in the user's browser for live confirmation.

The production build scans every output file for configured credentials and rejects any packaged environment file. `npm audit --audit-level=moderate` reported no known vulnerabilities at verification time. The compiled service was started separately and its health endpoint responded successfully. Docker configuration is supplied, but a Docker runtime was not available for a container smoke test in this environment.

## Actual provider checks

Current policy `text-quality-v2.0` ignores all images. A 40-case authored text comparison caught 14/14 poor examples and retained 26/26 keep examples at Balanced; the preceding policy missed seven on the same corpus. Both reports, exact questions and raw scores are preserved as `text-baseline.json` and `text-candidate.json`. This is a development comparison, not an independent accuracy benchmark.

After rebuilding and restarting the compiled local service, a real HTTP batch with an older client's `inspectThumbnails:true` returned no errors and `evidence.thumbnail=false` for both items. Jev assigned an explicit zero-work guaranteed-income pitch a 0.98 poor-quality score and kept an honest craft-income report visible. `/health` advertises thumbnail support as disabled. Regression tests cover saved-preference migration, omission of image URLs, thumbnail changes not triggering new analysis, and missing destination evidence without a blanket filtering veto.

The following records describe the earlier policy and its now-disabled image pipeline; they are retained as historical integration evidence.

| Check | Observed result |
| --- | --- |
| OpenRouter Decisions with `~typesafe/jev-latest` | Successful typed Jev responses; resolved model `typesafe/jev-1.13-20260917` |
| Download a real YouTube thumbnail, inspect image bytes with Gemini, then decide with Jev | Completed; `evidence.thumbnail=true` |
| Fetch MDN public HTML and classify with Jev | Completed; `evidence.destination=true` |
| Follow a current Google opaque `/goto?url=…` result link with safe destination fetch | Resolved to the public Wagner Meters woodworking article; received its HTML without browser cookies |
| Main development corpus | 18/20 expected outcomes, no false positives; two conservative misses at the default 0.85 threshold |
| Separately authored follow-up set, policy held fixed | 24/24 expected outcomes, no false positives |

The historical main corpus has 15 keep examples and five filter examples; three of those five were filtered. The follow-up has 16 keep examples and eight filter examples. Together, those snapshots caught 11/13 authored poor examples and retained 31/31 keep examples. These samples are synthetic development material, not representative user feeds, independent research, or an authorship benchmark. No general accuracy percentage is asserted. The first baseline, corrected main run, and follow-up report are retained in `docs/evaluations/`.

The earlier policy missed a keyword doorway and content with explicit generator residue because combined evidence scores stayed just below the default threshold. The text-quality-v2.0 comparison above uses direct quality scores with a separate evidence-sufficiency gate, retaining the same Balanced threshold of 0.85.

## Real browser checks

- On 20 September, reviewed the blur treatment using the actual renderer in `dev/presentation.html`. Checked dark posts, light search results, horizontal videos, narrow cards, thumbnails, 40-pixel replies and 64 × 28 cards. Measured all seven controls inside their card bounds, changed a card's size without replacing its treatment, and reviewed a 390-pixel viewport. The accessibility tree excludes censored links and retains seven named reveal buttons. Reduced-motion emulation reports no mask animations; Restore all removes every treatment and inert attribute. Reveal event isolation and focus restoration pass unit tests; the current browser automation cannot click into the closed shadow root, so this revision still needs manual reveal activation in the installed extension.
- Inspected current YouTube search cards (`ytd-video-renderer`) and current Shorts cards (`ytm-shorts-lockup-view-model`), including image URLs and available description snippets.
- Inspected Google's complete organic `.tF2Cxc` cards and its opaque redirect links. Corresponding fixtures cover those structures.
- Ran `dev/qa.html` against the real local detector. Production extraction produced three complete cards; Jev retained a practical repair guide and checked AI-assisted lesson, and filtered a scam. The actual production renderer censored it, revealed it with its original controls, hid the whole card, and restored it.
- Verified in Chromium's accessibility tree that the covered card's original link/actions disappear and **Show original content** remains an accessible button. Tab traversal reached Show. Pointer activation restored the original content. The browser automation surface cannot dispatch a key into a closed shadow root; Enter activation remains a manual release check, while native button handling and focus restoration have regression tests.
- Reviewed settings and popup visually, switched presentation modes, added/removed a domain exception, rejected a remote HTTP endpoint, and verified that the demonstration does not falsely report a live service connection.
- Checked a 390-pixel settings layout: document and content widths fit without horizontal page overflow. Reset the temporary viewport override after review.
- After the Radix Themes visual refresh, verified Switch activation with Space, RadioCards selection with arrow keys, and SegmentedControl arrow focus followed by Enter activation. Censor/reveal/replay, adding and removing website exceptions, and rejection of an insecure remote service URL still work.
- Reviewed the final neutral/red theme at desktop and 390-pixel widths and the 380-pixel popup. All four settings destinations remain visible at narrow widths. The popup preview measures about 647 pixels tall, including its 60-pixel preview notice and margin; that notice is absent in the extension. Reduced-motion emulation removes the hide animation immediately. The Inter font and its license are packaged locally.

The integration workbench uses authored fixtures and actual production modules. It is explicitly labeled and excluded from the extension build. It does **not** stand in for an installed extension running on authenticated social feeds.

## Qualification still required beyond the developer preview

1. Install the unpacked build in Chrome and Edge, grant/revoke consent, connect the user's chosen local or remote detector, and verify background-worker suspension/restart plus page actions end to end.
2. Test logged-in YouTube home/watch/comments, Instagram, Facebook, TikTok, X, and Reddit feeds for current account-specific layouts, infinite scroll, comments/replies, navigation, and restore. These adapters currently have deterministic fixtures; they are not claimed as universally live-qualified.
3. Test keyboard Enter/Space activation, a screen reader, reduced motion, browser zoom, mobile-width content pages, narrow/short browser windows, and websites with restrictive CSS/CSP.
4. Expand detection evaluation using consented, independently labeled real examples. Measure precision/recall per platform and language, with an untouched evaluation set and disagreement review.
5. If a third party offers a shared detector, separately qualify its load handling, spending cap, persistent volume and operator privacy/security contacts. Browser-store distribution also requires its own review. Neither service hosting nor store publication is included in this self-hosted developer preview.

The code is ready to inspect, run locally, and contribute to. It is a pre-release; the unchecked qualification steps above are not presented as complete.
