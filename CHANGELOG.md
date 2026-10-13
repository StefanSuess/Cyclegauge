# Changelog

All notable changes to Cyclegauge for Kiro IDE. Cyclegauge is an unofficial pre-release; versions with an odd minor number (0.5.x) are beta builds; see [versioning](docs/release-process.md#versioning).

## 0.5.3 (beta, macOS)

Documentation, support-metadata and release-process update, with removal of deprecated command and setting aliases and a new default storage directory. Collector, store, projection, billing, forecast and Cost Advisor algorithms and data formats are preserved.

### Added

- Optional, never-required Ko-fi support: a "Support Cyclegauge" section in the README (which is also the extension listing text) and the standard `sponsor` field in the extension manifest. Cyclegauge stays free, open source and without paid features.
- A repository Sponsor button that links to Ko-fi.
- A manually approved, immutable release pipeline (checks, exact-content verification of the candidate VSIX, and approval-gated promotion to GitHub and Open VSX). It is release tooling only and is not part of the packaged extension.
- README screenshots of the dashboard and Cost Advisor.

### Changed

- Documentation now describes reported credits without assuming a base-only limit.
- Deprecated `easykirogauge.*` settings and the `easykirogauge.showUsage` command alias are removed. Transfer any explicit source, storage and timezone settings to their `cyclegauge.*` keys before upgrading.
- The default owned storage directory changes from `EasyKiroGauge` to `Cyclegauge`, including for users upgrading from Cyclegauge 0.5.2. Existing files are not moved, imported or deleted automatically. Without an explicit storage-root setting, existing history and forecast coverage will not appear in the new directory. See the [upgrade guide](docs/usage.md#upgrading-from-052-or-an-earlier-build) to reuse prior history.
- The side-by-side installation gate is removed. Disable the earlier extension before configuring a shared storage directory.

### Unchanged

- Cyclegauge remains a macOS beta. Windows storage stays disabled (SC1 open), Advisor answers are never persisted (SC5 open), and Linux and RHEL are unverified.
- v0.5.2 is already published and stays unchanged. Its notes below are kept as they were released.

## 0.5.2 (beta, macOS)

First public beta under the new extension identity **Cyclegauge for Kiro IDE** (extension ID `StefanSuess.cyclegauge`).

### Important if you used EasyKiroGauge

- This is a **different extension**, not an update. Kiro will not upgrade an installed EasyKiroGauge build to Cyclegauge.
- Install Cyclegauge, then disable or uninstall EasyKiroGauge and reload the window. While both are enabled Cyclegauge pauses itself (status bar "Cyclegauge: paused") and reads and writes nothing.
- Your history stays where it is: the storage folder keeps its legacy name `EasyKiroGauge`. Nothing is moved, copied or deleted.
- Old `easykirogauge.*` settings still work as a fallback. Only `easykirogauge.showUsage` remains as a command alias. The old `configureCostOptimizer`, `editCostScenario` and `clearCostInputs` IDs are removed under both prefixes; replace custom bindings with `cyclegauge.costAdvisor`, or remove them.

### Added

- Script-free Cost Advisor with unconfirmed plan hints, account-bound session answers and native Command Palette, title-bar and panel-visible status-bar entry points.
- Clearly labelled modelled pre-tax USD comparisons for the next full billing cycle, plus 1/3/6-cycle details and hypothetical usage sensitivity. Unknown inputs remain conditional or unavailable; no guaranteed savings, purchases, network calls or telemetry.

### Changed

- New names: commands and settings are `cyclegauge.*`; the Command Palette entries start with "Cyclegauge:".
- Source and storage root settings (`cyclegauge.sourceRoot`, `cyclegauge.storageRoot`, `cyclegauge.sourceTimezone` and their legacy keys) are machine-scoped: a workspace's `.vscode/settings.json` can no longer change them. Set them in your user settings.
- Release builds are verified by an exact-content check (allowlist, manifest, bundle) and can be reproduced from the commit.

### Unchanged

- Collector, store, projection, billing and forecast algorithms and data formats are preserved. The cost engine accepts two existing forecast-demand assumption codes so automatic comparisons can run; pricing and simulation algorithms are preserved. The Advisor replaces the standalone Cost Optimizer UI. The detail view stays script-free, with no network code or telemetry.
- Windows storage stays disabled (SC1 open). Advisor answers are never persisted (SC5 open). Native acceptance of this exact 0.5.2 candidate remains pending.

### Known limitations

- Verified on macOS only (Kiro 1.2.56). Windows storage is deliberately disabled; Linux and RHEL are unverified.
- Figures are the last values Kiro logged, not a live balance. Kiro's log format is undocumented and may change.

## 0.5.1

UI-only simplification of the detail view (published only as a local VSIX under the name EasyKiroGauge).

## Earlier

0.5.0 usage chart, 0.4.x cost optimizer and pooled forecasting, 0.3.x history and forecasts, 0.2 extension, 0.1 collector. See [version history](https://github.com/StefanSuess/Cyclegauge/blob/HEAD/docs/version-history.md).
