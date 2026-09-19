# NO SLOP design

The extension behaves like a thoughtful margin note: it makes a judgment visible, explains it, and leaves the reader in control. Its interface uses Radix Themes with a gray accent, neutral white and gray surfaces, charcoal text, and medium radius. The original red stamp provides the brand color. Preserve the established layout and refine how these elements blend together.

## Foundations

| Token | Value | Use |
| --- | --- | --- |
| White | `#FFFFFF` | Main surfaces |
| Gray 2 | `#F9F9F9` | Quiet canvas and inset surfaces |
| Gray 6 | `#E4E4E4` | Boundaries between functional regions |
| Gray 11 | `#646464` | Supporting copy |
| Gray 12 | `#202020` | Primary text and brand letterforms |
| Stamp red | `#BD3049` | Original brand mark and censorship treatment |
| Stamp wash | `#FCF5F6` | Quiet background behind a quality note or stamp |
| Stamp line | `#EBC8CF` | Boundaries within the stamp treatment |

Use the real Radix Themes components and semantic color scales rather than imitating them with unrelated control styles. Set the theme to `accentColor="gray"`, `grayColor="gray"`, and `radius="medium"`, with high-contrast switches. Primary actions and selection use the neutral ink palette; reserve red for the original mark and content filtering. Component state colors, focus rings, contrast, and spacing should come from the theme.

Typography is **Inter Variable**, using 400 for body copy, 500 for labels and interface headings, and 600 for emphasis. The **900-weight wordmark** retains the original brand's strong silhouette. Keep the UI in sentence case; uppercase belongs to the product name and stamp. The variable font is packaged locally through Fontsource, with no runtime font requests to a third party.

The original mark stays unchanged: a white `NS` monogram, rotated slightly inside its red rounded stamp tile. Preserve its proportions, corner radius, stroke weight, and red when generating browser icons or placing it in the interface. The README masthead embeds that exact mark with Inter letterforms on white. Its text is outlined in the SVG from the packaged font so it renders consistently without depending on installed fonts or remote resources. The source includes an accessible title and description. Avoid introducing a competing accent color, alternate logo, or new layout treatment.

The accepted layout stays intact: four persistent settings destinations, one reading pane, a working preview beside the filter controls, and a compact extension popup. Settings are grouped by user decisions, rather than equal-sized dashboard cards. The popover uses real tab statistics only; the browser preview is explicitly labeled and never contacts the detector. Keep spacing and hierarchy calm; use borders to separate controls and content, not as decoration.

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
