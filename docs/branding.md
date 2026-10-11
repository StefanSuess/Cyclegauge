# Branding and icon assets

Status: icon assets only. Technical identifiers (`easykirogauge` package name, publisher, commands, settings, storage directory) are unchanged here; renaming them is the separate extension-identity migration.

## Canonical icon

The current official Cyclegauge icon is `assets/branding/source/cyclegauge-icon-source-1254.png`. Every other file in `assets/branding/` is generated from it: cropped to the rounded tile, black corner background made transparent, then resized with Lanczos resampling. Do not edit the derivatives by hand; regenerate them from the source and keep the filenames stable (`cyclegauge-icon-<size>.png`).

The icon stands for Cyclegauge only. Product branding stays "Cyclegauge for Kiro IDE" (unofficial, not affiliated with AWS or Kiro). Do not combine the icon with a Kiro logo or Kiro-derived artwork, and do not use it in a way that suggests endorsement.

## Where each size is used

- Extension metadata: `package.json` `"icon"` points to `assets/branding/cyclegauge-icon-256.png`. Marketplaces need a PNG of at least 128×128; 256 keeps it sharp on high-DPI screens.
- GitHub project branding (avatar): `cyclegauge-icon-1024.png`. Uploading it is a manual repository setting, not part of this change.
- GitHub social preview: `cyclegauge-github-social-preview-1280x640.png`. It is not applied automatically; a repository admin sets it manually under GitHub repo **Settings > Social preview**. The original upload had the icon on an opaque black square; this version composites the transparent-corner icon (`cyclegauge-icon-1024.png`) on the navy background.
- README: see below.
- First beta release materials: `cyclegauge-icon-512.png` or `-1024.png`.

## README

The README header shows `cyclegauge-icon-128.png` through an absolute `raw.githubusercontent.com` URL (a VSIX README cannot use relative image paths). The image only resolves once this file is on the default branch. A product screenshot is a separate task once the dashboard is final.

## Packaging impact

`.vscodeignore` excludes everything by default, so only the 256 px icon is allow-listed. Measured with `vsce package` on the 0.5.1 baseline:

| | Files | VSIX size |
| --- | --- | --- |
| Before | 5 | 62.1 KB |
| After | 6 | 128.2 KB |

(Measured on the 0.5.1 baseline before the license entry landed; with `LICENSE` the VSIX has 7 entries.)

The icon adds about 66 KB (lossless RGBA). If size matters more later, the 128 px file is about 20 KB, and an 8-bit palette-quantized 256 px version is about 8 KB with slight dithering in the dark background. The source, larger derivatives and the social preview are never packaged.

Any release check that asserts an exact VSIX file list must include `extension/assets/branding/cyclegauge-icon-256.png`.
