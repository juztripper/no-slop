# Release and discoverability

Version 0.2.0 is a **developer preview** with direct, user-funded OpenRouter processing by default. It does not require a hosted detector or maintainer-funded key. A release-notes file or local ZIP does not mean publication has happened. Historical [0.1.0 notes](releases/0.1.0.md) remain unchanged.

## Prepare the artifacts

1. Run `npm ci` and `npm run check`. These checks need no provider credentials and make no paid calls.
2. Review [VERIFICATION.md](VERIFICATION.md). Record actual checks separately from pending installed-browser or live-provider qualification. Keep the release marked pre-release until its qualification warrants stable distribution.
3. Run `npm run release:package`. It rebuilds the extension, rejects credentials and unexpected files, and creates `artifacts/releases/v0.2.0/no-slop-0.2.0-chromium.zip`, `SHA256SUMS` and `RELEASE_NOTES.md`.
4. Extract the ZIP, verify the checksum, and confirm `manifest.json` is at the root. Check that its install instructions describe direct setup without a terminal. Exclude `.env`, private fixtures, logs, `node_modules`, budget ledgers and the release-video workspace.
5. Check the source package, lockfile, built manifest and release notes all name 0.2.0. Commit the exact reviewed source before tagging `v0.2.0`.
6. Verify a new installation defaults to direct mode without consent, and an upgraded 0.1.0 profile retains self-hosted mode. Check key changes, storage access boundaries, consent, worker restart, daily limits and failure behavior. State which checks used mocks and which used an installed extension.

The ZIP contains the extension, licenses and installation/privacy/release notes. It contains no key, executable installer, account or server process. Optional self-hosted users run the detector from matching source. Live provider evaluation spends the operator's credits and must be intentionally run; previous authored examples must not be advertised as representative accuracy.

## Publication

- Use actual repository and release URLs. Never invent a CI result, download count, testimonial or hosted endpoint.
- Suggested description: **Open-source browser extension for AI slop, clickbait and content farms. Reversible filtering, your own key, contributions welcome.**
- Suggested topics: `browser-extension`, `chrome-extension`, `manifest-v3`, `content-filter`, `ai-slop`, `open-source`, `bring-your-own-key`, `openrouter`, `typescript`, `react`, `accessibility`.
- Retain Issues, private vulnerability reporting, and the supplied bug/detection templates. Keep discussion of content evidence respectful.
- Create a GitHub pre-release from [the 0.2.0 notes](releases/0.2.0.md), attaching the ZIP and checksum. GitHub supplies the tagged source archive separately.
- After publication is verified, replace preparation notices in the README and setup/release documents with the actual release link. Record the release URL, source commit and artifact checksum. Do not imply an X announcement or browser-store release happened without verifying it separately.
- Make contributor invitations specific: site fixtures, false-positive regressions, keyboard accessibility and multilingual examples, with bounded acceptance criteria.

## Later distribution

Browser-store distribution needs its own permission/data-use disclosures, review and current browser qualification. Explain the broad HTTP/HTTPS permission used to recognize content across supported pages and the transmission of selected text to OpenRouter. A store listing is not required for the unpacked preview.

Third parties operating shared detectors own their provider costs, access controls, abuse handling and privacy disclosures. The project does not promise that service.
