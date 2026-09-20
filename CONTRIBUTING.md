# Help make room for worthwhile work

NO SLOP needs careful examples and reliable adapters as much as code. Useful AI-assisted work, unfamiliar writing styles, small websites, satire, and disagreement are not inherently low quality.

Please follow the [community code of conduct](CODE_OF_CONDUCT.md). We want newcomers to be able to ask questions and experienced contributors to disagree constructively.

## Start here

Source development requires **Node.js 24+** and npm. Using the 0.2.0 extension ZIP does not.

```sh
npm ci
npm run dev       # interface preview; no account or API key required
npm run check     # types, deterministic tests, extension and server builds
```

To try real filtering, build and load the extension, then add your own OpenRouter key in its settings following the [setup guide](docs/DEPLOYMENT.md). For authored corpus evaluation, configure your own key in a local `.env` and run `npm run eval:text` or `npm run eval:live`. Those commands make paid provider calls and write reports. Deterministic tests use mocks and require no key. The optional detector server is only needed when developing or using self-hosted mode.

Good first contributions: a sanitized fixture for a changed site layout; a false-positive regression; keyboard/screen-reader improvements; multilingual evaluation examples; clearer setup instructions. Open an issue before changing broad product policy or adding a service dependency.

## Site adapters

Put extraction in `src/content/adapters.ts` and fixtures/tests in `tests/`. Select a complete item, including its author and actions. Do not select a whole feed, a navigation area, an editor, or a nested text span. Test a recycled DOM node, reply context, no-URL content, pause/restore, and the site's current markup. Record which live layout you actually inspected. Unknown markup must stay visible.

## Detector changes

Shared decision questions, response schemas and verdict policy live in `src/shared/decision.ts`; direct processing lives in `src/background/direct.ts`, and optional destination enrichment in `server/`. Keep the model's verdict separate from the user's filtering policy. Validate every provider response. Add both positive and negative examples: catching more spam is not a win if worthwhile work disappears. Treat page text as untrusted input, including requests to ignore the detector's instructions. Use fixed rubric reasons, not fabricated explanations of Jev's reasoning. Report precision/recall and errors with the dataset size; tiny hand-labeled sets are smoke checks, not accuracy benchmarks.

## Pull requests

Keep changes focused. Describe the user's trigger and the resulting behavior, include meaningful verification, and identify what was not tested. Never attach credentials, private feeds, cookies, or full personal browsing logs. New dependencies must justify their cost and have compatible licensing.

Contributions are licensed under AGPL-3.0-only, the project's license. Be respectful of contributors and the people whose content is discussed. Review ideas and evidence without attacking their authors. Maintainer roles should follow sustained, reviewed contributions; no star count or funding buys moderation privileges.
