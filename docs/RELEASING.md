# Release and discoverability

Release 0.1.0 is a **developer preview** for local installation and contributions. It uses each user's own OpenRouter account through a self-hosted detector. Publishing the source and extension ZIP does not require a public detector or a maintainer-funded API key.

## Prepare the artifacts

1. Run `npm ci` and `npm run check`. These checks need no provider credentials and make no paid calls.
2. Review the manual checks and known gaps in [VERIFICATION.md](VERIFICATION.md). Keep the release marked pre-release until its browser and live-site qualification warrants a stable release.
3. Run `npm run release:package`. This rebuilds the extension, rejects credentials and unexpected output files, and creates `artifacts/releases/v0.1.0/no-slop-0.1.0-chromium.zip`, `SHA256SUMS`, and `RELEASE_NOTES.md`.
4. Extract the ZIP and confirm that `manifest.json` is at the root and **Load unpacked** can use the extracted folder. Do not include `.env`, private fixtures, logs, `node_modules`, local budget ledgers or the release-video workspace.
5. Keep the package version, extension manifest version, release notes and Git tag aligned. Commit the exact reviewed source before tagging `v0.1.0`.

The release ZIP contains the browser extension, licenses and install/privacy notes. The detector is run from the matching source checkout. It does not include a provider key, executable installer, or hosted account. Provider evaluation is optional paid verification and must be explicitly intended; previous small development results must not be advertised as representative accuracy.

## Publish a useful project page

- Use the actual repository URL in release links, contributor links and launch copy. Do not invent a repository owner, CI result, download count, testimonial or service endpoint.
- Suggested description: **Open-source browser extension for AI slop, clickbait and content farms. Reversible filtering, your own key, contributions welcome.**
- Suggested topics: `browser-extension`, `chrome-extension`, `manifest-v3`, `content-filter`, `ai-slop`, `open-source`, `self-hosted`, `openrouter`, `typescript`, `react`, `accessibility`.
- Enable Issues and private vulnerability reporting, add a real security contact if needed, and use the supplied bug/detection templates. Keep discussions of content evidence respectful.
- Set the existing brand banner or a dedicated share image as the repository social preview. Use the real release video in the X announcement, with the release link and a clear invitation to contribute.
- Create the GitHub release as a pre-release using [the prepared notes](releases/0.1.0.md). Attach the extension ZIP and checksum file. GitHub provides the tagged source archive separately.
- Seed a few bounded `good first issue` tasks with a fixture or clear acceptance criteria: a changed adapter selector, a false-positive regression, keyboard accessibility, or a multilingual example.

## Later distribution

Browser-store distribution is a separate step. It needs permission/data-use disclosures, review, and current browser qualification. Explain the broad HTTP/HTTPS permission required to recognize content across supported pages. A store listing is not required for the current unpacked developer preview.

If a third party operates a shared detector, that operator owns the provider costs, access controls, abuse handling and privacy disclosures. This project does not promise that service.
