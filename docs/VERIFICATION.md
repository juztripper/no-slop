# Verification record

Verified locally on 19 September 2026. This file distinguishes implemented behavior, measured checks, and launch work that has not happened.

## Automated checks

`npm run check` passed: strict TypeScript, **136 tests across 12 files**, the extension production build, and the compiled service build. The suite covers settings persistence, extension message trust, consent revocation, secret redaction, queue/deadline behavior, stale/recycled nodes, privacy paths, full-card boundaries, restored app styles, nested replies, focus safety, reduced motion, SSRF and redirects, schema failures, provider errors, CORS, authentication, quotas, and caching.

The production build scans every output file for configured credentials and rejects any packaged environment file. `npm audit --audit-level=moderate` reported no known vulnerabilities at verification time. The compiled service was started separately and its health endpoint responded successfully. Docker configuration is supplied, but a Docker runtime was not available for a container smoke test in this environment.

## Actual provider checks

| Check | Observed result |
| --- | --- |
| OpenRouter Decisions with `~typesafe/jev-latest` | Successful typed Jev responses; resolved model `typesafe/jev-1.13-20260917` |
| Download a real YouTube thumbnail, inspect image bytes with Gemini, then decide with Jev | Completed; `evidence.thumbnail=true` |
| Fetch MDN public HTML and classify with Jev | Completed; `evidence.destination=true` |
| Follow a current Google opaque `/goto?url=…` result link with safe destination fetch | Resolved to the public Wagner Meters woodworking article; received its HTML without browser cookies |
| Main development corpus | 18/20 expected outcomes, no false positives; two conservative misses at the default 0.85 threshold |
| Separately authored follow-up set, policy held fixed | 24/24 expected outcomes, no false positives |

The main corpus has 15 keep examples and five filter examples; three of those five were filtered. The follow-up has 16 keep examples and eight filter examples. Together, the current snapshots caught 11/13 authored poor examples and retained 31/31 keep examples. These samples are synthetic development material, not representative user feeds, independent research, or an authorship benchmark. No general accuracy percentage is asserted. The first baseline, corrected main run, and follow-up report are retained in `docs/evaluations/`.

The two misses are a keyword doorway and content with explicit generator residue, whose combined evidence scores stayed just below the default threshold. More aggressive presets exist, with a greater risk of mistakes. The evaluation scripts intentionally expose these errors rather than lowering the threshold to fit a small dataset.

## Real browser checks

- Inspected current YouTube search cards (`ytd-video-renderer`) and current Shorts cards (`ytm-shorts-lockup-view-model`), including image URLs and available description snippets.
- Inspected Google's complete organic `.tF2Cxc` cards and its opaque redirect links. Corresponding fixtures cover those structures.
- Ran `dev/qa.html` against the real local detector. Production extraction produced three complete cards; Jev retained a practical repair guide and checked AI-assisted lesson, and filtered a scam. The actual production renderer censored it, revealed it with its original controls, hid the whole card, and restored it.
- Verified in Chromium's accessibility tree that the covered card's original link/actions disappear and **Show original content** remains an accessible button. Tab traversal reached Show. Pointer activation restored the original content. The browser automation surface cannot dispatch a key into a closed shadow root; Enter activation remains a manual release check, while native button handling and focus restoration have regression tests.
- Reviewed settings and popup visually, switched presentation modes, added/removed a domain exception, rejected a remote HTTP endpoint, and verified that the demonstration does not falsely report a live service connection.
- Checked a 390-pixel settings layout: document and content widths fit without horizontal page overflow. Reset the temporary viewport override after review.
- After the Radix Themes visual refresh, verified Switch activation with Space, RadioCards selection with arrow keys, and SegmentedControl arrow focus followed by Enter activation. Censor/reveal/replay, adding and removing website exceptions, and rejection of an insecure remote service URL still work.
- Reviewed the final neutral/red theme at desktop and 390-pixel widths and the 380-pixel popup. All four settings destinations remain visible at narrow widths. The popup preview measures about 647 pixels tall, including its 60-pixel preview notice and margin; that notice is absent in the extension. Reduced-motion emulation removes the hide animation immediately. The Inter font and its license are packaged locally.

The integration workbench uses authored fixtures and actual production modules. It is explicitly labeled and excluded from the extension build. It does **not** stand in for an installed extension running on authenticated social feeds.

## Qualification still required before public launch

1. Install the unpacked build in Chrome and Edge, grant/revoke consent, connect the actual hosted endpoint, and verify background-worker suspension/restart plus page actions end to end.
2. Test logged-in YouTube home/watch/comments, Instagram, Facebook, TikTok, X, and Reddit feeds for current account-specific layouts, infinite scroll, comments/replies, navigation, and restore. These adapters currently have deterministic fixtures; they are not claimed as universally live-qualified.
3. Test keyboard Enter/Space activation, a screen reader, reduced motion, browser zoom, mobile-width content pages, narrow/short browser windows, and websites with restrictive CSS/CSP.
4. Expand detection evaluation using consented, independently labeled real examples. Measure precision/recall per platform and language, with an untouched evaluation set and disagreement review.
5. Deploy and load-test the sponsored service, verify the spending cap and persistent volume, publish the repository and operator privacy/security contacts, and complete browser-store review.

The code is ready to inspect, run locally, and contribute to. It is a pre-release; the unchecked qualification steps above are not presented as complete.
