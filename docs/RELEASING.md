# Release and discoverability

Before publishing, choose the GitHub owner/repository and the public detector domain. Do not replace these with fictional links in the README. The README's badges currently describe static project properties; there is intentionally no fake passing-CI or download-count badge.

1. Run `npm ci` and `npm run check`; run the live evaluation with a spending-limited provider key. Inspect regressions, not only aggregate scores.
2. Run the manual checks in `VERIFICATION.md` against the built unpacked extension in each supported browser and platform layout. Record the actual version, account/login state, and outcomes.
3. Review `PRIVACY.md`, configure a real security reporting contact, enable private vulnerability reporting, and confirm outbound providers and hosting retention.
4. Configure and qualify the sponsored service using `DEPLOYMENT.md`. Set the real non-secret service URL before producing the public browser build. Keep the provider key in server secrets.
5. Publish the repository under AGPL-3.0-only, set its description to “Open-source browser extension that filters AI slop, clickbait, spam, and content-farm results with Jev.”
6. Suggested GitHub topics: `browser-extension`, `chrome-extension`, `manifest-v3`, `content-filter`, `ai-slop`, `jev`, `openrouter`, `typescript`, `youtube`, `privacy`. Add the real repository CI badge, issue links, social preview, and release downloads after they exist.
7. Create a versioned release with the extension ZIP, source tag, checksums, verification notes, and detector/prompt version. Never include `.env`, private fixtures, logs, node_modules, or local budgets.
8. Submit the extension to the Chrome Web Store/Edge Add-ons with truthful permission and data-use disclosures. The broad HTTP/HTTPS permission enables cross-site filtering and needs explanation. Firefox/Safari are not qualified in this release.

Use “good first issue” for a bounded, reproducible task with a fixture or clear acceptance criteria. Invite contributors through useful issues and responsive review; avoid keyword stuffing, inflated claims, and fabricated endorsements.
