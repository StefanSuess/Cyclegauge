# Changelog

All notable changes to Cyclegauge for Kiro IDE. Cyclegauge is an unofficial pre-release; versions with an odd minor number (0.5.x) are beta builds.

## 0.5.2 (beta, macOS)

First public beta under the new extension identity **Cyclegauge for Kiro IDE** (extension `cyclegauge`).

### Important if you used EasyKiroGauge

- This is a **different extension**, not an update. Kiro will not upgrade an installed EasyKiroGauge build to Cyclegauge.
- Install Cyclegauge, then disable or uninstall EasyKiroGauge and reload the window. While both are enabled Cyclegauge pauses itself (status bar "Cyclegauge: paused") and reads and writes nothing.
- Your history stays where it is: the storage folder keeps its legacy name `EasyKiroGauge`. Nothing is moved, copied or deleted.
- Old `easykirogauge.*` settings still work as a fallback. The commands `showUsage`, `configureCostOptimizer`, `editCostScenario` and `clearCostInputs` keep their `easykirogauge.*` IDs as aliases for now.

### Changed

- New names: commands and settings are `cyclegauge.*`; the Command Palette entries start with "Cyclegauge:".
- Source and storage root settings (`cyclegauge.sourceRoot`, `cyclegauge.storageRoot`, `cyclegauge.sourceTimezone` and their legacy keys) are machine-scoped: a workspace's `.vscode/settings.json` can no longer change them. Set them in your user settings.
- Release builds are verified by an exact-content check (allowlist, manifest, bundle) and can be reproduced from the commit.

### Unchanged

- Collector, store, projection, billing, forecast and cost-optimizer behaviour and data formats are identical to 0.5.1. The detail view is still script-free, and the extension still has no network code and no telemetry.

### Known limitations

- Verified on macOS only (Kiro 1.2.56). Windows storage is deliberately disabled; Linux and RHEL are unverified.
- Figures are the last values Kiro logged, not a live balance. Kiro's log format is undocumented and may change.

## 0.5.1

UI-only simplification of the detail view (published only as a local VSIX under the name EasyKiroGauge).

## Earlier

0.5.0 usage chart, 0.4.x cost optimizer and pooled forecasting, 0.3.x history and forecasts, 0.2 extension, 0.1 collector. See [version history](https://github.com/StefanSuess/Cyclegauge/blob/HEAD/docs/version-history.md).
