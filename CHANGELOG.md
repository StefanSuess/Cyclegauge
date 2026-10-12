# Changelog

All notable changes to Cyclegauge for Kiro IDE. Cyclegauge is an unofficial pre-release; versions with an odd minor number (0.5.x) are beta builds.

## 0.5.2 (beta, macOS)

First public beta of **Cyclegauge for Kiro IDE** (extension ID `StefanSuess.cyclegauge`).

### Added

- Script-free Cost Advisor with unconfirmed plan hints, account-bound session answers and native Command Palette, title-bar and panel-visible status-bar entry points.
- Clearly labelled modelled pre-tax USD comparisons for the next full billing cycle, plus 1/3/6-cycle details and hypothetical usage sensitivity. Unknown inputs remain conditional or unavailable; no guaranteed savings, purchases, network calls or telemetry.

### Changed

- Commands and settings use `cyclegauge.*`; the Command Palette entries start with "Cyclegauge:".
- Source and storage root settings (`cyclegauge.sourceRoot`, `cyclegauge.storageRoot`, `cyclegauge.sourceTimezone`) are machine-scoped: a workspace's `.vscode/settings.json` can no longer change them. Set them in your user settings.
- Release builds are verified by an exact-content check (allowlist, manifest, bundle) and can be reproduced from the commit.

### Unchanged

- Collector, store, projection, billing and forecast algorithms and data formats are preserved. The cost engine accepts two existing forecast-demand assumption codes so automatic comparisons can run; pricing and simulation algorithms are preserved. The Advisor replaces the standalone Cost Optimizer UI. The detail view stays script-free, with no network code or telemetry.
- Windows storage stays disabled (SC1 open). Advisor answers are never persisted (SC5 open). Native acceptance of this exact 0.5.2 candidate remains pending.

### Known limitations

- Verified on macOS only (Kiro 1.2.56). Windows storage is deliberately disabled; Linux and RHEL are unverified.
- Figures are the last values Kiro logged, not a live balance. Kiro's log format is undocumented and may change.

## 0.5.1

UI-only simplification of the detail view.

## Earlier

0.5.0 usage chart, 0.4.x cost optimizer and pooled forecasting, 0.3.x history and forecasts, 0.2 extension, 0.1 collector. See [version history](https://github.com/StefanSuess/Cyclegauge/blob/HEAD/docs/version-history.md).
