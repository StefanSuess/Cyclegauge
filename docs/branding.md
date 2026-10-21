# Branding and icon assets

Status: icon assets. Technical identifiers (package `bobert`, `bobert.*` commands and settings, and publisher) are recorded in the manifest and source; the icon work does not change them.

## Canonical icon

The official Bobert icon is the vector file `assets/branding/source/bobert-icon.svg`: a teal robot head whose mouth is a gauge, on a navy rounded tile. Every PNG in `assets/branding/` is rendered from it, for example `rsvg-convert -w 256 -h 256 assets/branding/source/bobert-icon.svg -o assets/branding/bobert-icon-256.png`. Do not edit the PNGs by hand; regenerate them from the SVG and keep the filenames stable (`bobert-icon-<size>.png`). Keep the robot visibly our own design, not resembling any existing cartoon character.

The icon stands for Bobert only. Product branding stays "Bobert: Kiro Credit Tracker" (unofficial, not affiliated with AWS or Kiro). Do not combine the icon with a Kiro logo or Kiro-derived artwork, and do not use it in a way that suggests endorsement.

The Bobert name, icon and mascot are not covered by the MIT License; see [TRADEMARKS.md](../TRADEMARKS.md).

## Bobert, the mascot

Bobert is a small robot whose mouth is a credit gauge. He is the product's personality: a little anxious about your credits, so you don't have to be. Use him to make the product memorable, never to make figures look less serious.

- **Tagline:** "Bobert worries about your Kiro credits, so you don't have to."
- **Running joke:** Bobert looks like he has seen a ghost. He has: your credit forecast. (A nod to Kiro's ghost; in text only, never combined with Kiro's logo or artwork.)
- **Moods (idea for after 1.0):** his face could follow the budget state, for example smiling when "On track", worried when "Likely to exceed", alarmed at the limit. Any mood must match the state the status bar already shows, never add drama to a calm forecast.
- **Tone:** playful in the README, listing, icon and social posts; plain and precise in notices, the credit view and diagnostics. Jokes never replace a caveat, a number or an action.

## Where each size is used

- Extension metadata: `package.json` `"icon"` points to `assets/branding/bobert-icon-256.png`. Marketplaces need a PNG of at least 128×128; 256 keeps it sharp on high-DPI screens.
- GitHub project branding (avatar): `bobert-icon-1024.png`. Uploading it is a manual repository setting, not part of this change.
- GitHub social preview: `bobert-github-social-preview-1280x640.png`. It is not applied automatically; a repository admin sets it manually under GitHub repo **Settings > Social preview**. It shows the icon, the name and the subtitle on the navy background.
- README: see below.
- First beta release materials: `bobert-icon-512.png` or `-1024.png`.

## README

The README header shows `bobert-icon-128.png` through an absolute `raw.githubusercontent.com` URL (a VSIX README cannot use relative image paths). The image only resolves once this file is on the default branch. A product screenshot is a separate task once the dashboard is final.

## Packaging impact

`.vscodeignore` excludes everything by default, so only the 256 px icon is allow-listed. Measured with `vsce package` on the 0.5.1 baseline:

| | Files | VSIX size |
| --- | --- | --- |
| Before | 5 | 62.1 KB |
| After | 6 | 128.2 KB |

(Measured on the 0.5.1 baseline before the license entry landed; with `LICENSE` the VSIX has 7 entries.)

The icon adds about 66 KB (lossless RGBA). If size matters more later, the 128 px file is about 20 KB, and an 8-bit palette-quantized 256 px version is about 8 KB with slight dithering in the dark background. The source, larger derivatives and the social preview are never packaged.

Any release check that asserts an exact VSIX file list must include `extension/assets/branding/bobert-icon-256.png`.
