# Branding and icon assets

Status: icon assets only. Technical identifiers (`easykirogauge` package name, publisher, commands, settings, storage directory) are unchanged here; renaming them is the separate extension-identity migration.

## Canonical icon

The current official Cyclegauge icon is `assets/branding/source/cyclegauge-icon-source-1254.png`. Every other file in `assets/branding/` is generated from it: cropped to the rounded tile, black corner background made transparent, then resized with Lanczos resampling. Do not edit the derivatives by hand; regenerate them from the source and keep the filenames stable (`cyclegauge-icon-<size>.png`).

The icon stands for Cyclegauge only. Product branding stays "Cyclegauge for Kiro IDE" (unofficial, not affiliated with AWS or Kiro). Do not combine the icon with a Kiro logo or Kiro-derived artwork, and do not use it in a way that suggests endorsement.

## Where each size is used

- Extension metadata: `package.json` `"icon"` points to `assets/branding/cyclegauge-icon-256.png`. Marketplaces need a PNG of at least 128×128; 256 keeps it sharp on high-DPI screens.
- GitHub project branding (social preview, avatar): `cyclegauge-icon-1024.png`. Uploading these is a manual repository setting, not part of this change.
- README: see below.
- First beta release materials: `cyclegauge-icon-512.png` or `-1024.png`.

## README

The README does not reference the icon yet. The branding rewrite in the pending README PR rewrites the same header, and a VSIX README needs absolute `https://` image URLs that only resolve once the file is on the default branch. Add a small header image (`cyclegauge-icon-128.png`, absolute URL) in a follow-up after that PR merges. A product screenshot is not required for the icon; screenshots are a separate task once the dashboard is final.

## Packaging impact

`.vscodeignore` excludes everything by default, so only the 256 px icon is allow-listed. Measured with `vsce package` on the 0.5.1 baseline:

| | Files | VSIX size |
| --- | --- | --- |
| Before | 5 | 62.1 KB |
| After | 6 | 128.2 KB |

The icon adds about 66 KB (lossless RGBA). If size matters more later, the 128 px file is about 20 KB, and an 8-bit palette-quantized 256 px version is about 8 KB with slight dithering in the dark background. The source and larger derivatives are never packaged.

Any release check that asserts an exact VSIX file list must include `extension/assets/branding/cyclegauge-icon-256.png`.
