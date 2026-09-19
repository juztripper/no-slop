# NO SLOP design

The extension behaves like a thoughtful margin note: it makes a judgment visible, explains it, and leaves the reader in control. The central visual device is an ink stamp, used sparingly on the brand mark and censored content.

## Foundations

| Token    | Value     | Use                           |
| -------- | --------- | ----------------------------- |
| Cloud    | `#FCFCFE` | Main working surface          |
| Lavender | `#F3F0F8` | App canvas and quiet controls |
| Graphite | `#29242F` | Primary text                  |
| Ink red  | `#BD3049` | Active filters and the stamp  |
| Oxblood  | `#93243A` | Pressed controls and emphasis |
| Plum     | `#6C456E` | Navigation and supporting UI  |

The wordmark uses a heavy system sans with tight spacing. Interface copy uses the platform's system font. There are no remote fonts or image dependencies. The mark is an original `NS` monogram; the preview thumbnails are original vector illustrations.

The layout follows the job: four persistent settings destinations, one reading pane, a working preview beside the filter controls, and a compact extension popup. Settings are grouped by user decisions, rather than equal-sized dashboard cards. The popover uses real tab statistics only; the browser preview is explicitly labeled and never contacts the detector.

## Content and behavior

- Say “likely” and explain concrete quality signals. A model judgment is not proof of authorship.
- Censor is the default. Revealing a result is one action. Whole cards are hidden when safe; paragraphs stay in context.
- Disabled motion removes the stamp and exit animation. Device-level reduced motion overrides the extension setting.
- Preferences save immediately. Service credentials use a separate save action so partially typed URLs are not used for analysis.
- Changing the detector address revokes analysis consent. The consent describes snippets, provider processing, thumbnails and search destination fetching.
- A failed save shows an error and does not report success. Rapid preference changes are serialized.
- Disabled or unavailable actions remain understandable. The preview does not fake live scan counts or connection status.

## Contribution checks

Use sentence case for labels, maintain visible keyboard focus, label every input, and do not convey status through color alone. Keep the small-popup and narrow settings layouts usable. Check motion with the operating system's reduced-motion preference. Avoid adding external assets to extension pages or exposing provider API keys in browser storage.

Brand source files are in `public/brand/`. Use the SVG mark for documentation and generate browser icon sizes from that source. The README banner contains no claim of a published service or repository owner.
