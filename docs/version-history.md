# Version history and milestone notes

Condensed notes that used to sit in the README. Detailed evidence lives in the per-milestone validation reports listed in the [documentation index](README.md).

## Release summary

- **0.5.3** Documentation, optional Ko-fi support metadata and release-pipeline update; no behavior change. See [CHANGELOG.md](../CHANGELOG.md).
- **0.5.2** First public Cyclegauge beta under the new extension identity `StefanSuess.cyclegauge`. The contemporaneous changelog records that native acceptance of the exact candidate remained pending; Windows storage remains disabled, and Linux/RHEL remain unverified. See [CHANGELOG.md](../CHANGELOG.md) for its release notes and limitations.
- **0.5.1** UI-only simplification of the detail view (concise default reading flow, one collapsed "Advanced details" section). See [milestone-5-1-validation.md](milestone-5-1-validation.md).
- **0.5.0** Usage trajectory chart, see [usage-chart.md](usage-chart.md).
- **0.4.1** Pooled multi-week forecasting that survives weekends and billing resets, see [milestone-4c-validation.md](milestone-4c-validation.md).
- **0.4.0** Local Cost Optimizer (Milestone 4B) in the budget detail view, see [cost-optimizer.md](cost-optimizer.md).
- **0.3.2** Budget-first status bar and detail view, see [forecasting.md](forecasting.md).
- **0.3.x** Credit history and qualified forecasts (Milestone 3), see [forecasting.md](forecasting.md).
- **0.2** Kiro IDE extension with status bar and detail view (Milestone 2).
- **0.1** Local read-only collector and CLI (Milestone 1).

## Original summary text

Version 0.5.1 simplifies the detail view (concise default reading flow, one collapsed "Advanced details" section; UI only, see docs/milestone-5-1-validation.md). Version 0.5.0 adds the Milestone 5 usage trajectory chart. Milestone 4B adds a local Cost Optimizer to the existing credit-budget detail view. The daily-budget status bar and forecast policy are preserved. Version 0.4.1 adds pooled multi-week forecasting that survives weekends and billing resets (see docs/milestone-4c-validation.md). It uses native Kiro inputs and a script-disabled view; no network requests, purchases or persistent manual profiles.

## Milestone 1

Milestone 1: a local, read-only `GetUsageLimitsCommand` CREDIT collector with persistent observations and a CLI. It reads existing Kiro IDE account-response logs; it never starts Kiro, calls its services, reads credentials, or accesses its SQLite cache or sessions.

## Milestones 2 and 3 (extension)

Milestone 3 extends the Kiro IDE extension with credit history and qualified forecasts. Its status bar emphasizes daily budget and forecast outlook: collecting data, provisional, on track, tight, over budget with a conditional exhaustion date, stale or unavailable. Remaining base credits stay in the detail view alongside account usage, daily budget and forecast status. Click it to open account usage, base limit, reset, UTC-day allocation, observation time, freshness and warnings. The extension reads existing Kiro IDE account-response logs and writes normalized observations only to EasyKiroGauge-owned storage. It does not call Kiro services or need a separate Node installation.

## Milestone 3 verification record (2026-10-10)

Milestone 3 verification on 2026-10-10: **59 synthetic tests passed**, typechecking passed, fixture validator passed seven synthetic files/twenty contracts, and `git diff --check` passed. A fresh review found two exact-arithmetic boundary defects; regression tests failed before their fixes and passed afterward. VSIX contains only bundle, package manifest and public README (plus VSIX metadata). Local VSIX 0.3.1 installation, extension-host restart and policy v2/unavailable rendering passed; live evidence did not support an estimate. No real billing values, account keys, private paths or screenshots are included in the validation report. (At that time packaging warned about absent repository metadata and license. `package.json` now declares `license`, `repository`, `bugs` and `homepage`, so those warnings no longer appear; the VSIX remains a local pre-release artifact, not a marketplace release.)

## Milestone 2 and 3 verification notes (2026-10-10, historical)

Milestone 2 status/details were previously verified in macOS Kiro 1.2.56. The earlier Milestone 3 VSIX 0.3.0 was installed and its history, coverage, forecast labels and insufficient-coverage explanation verified in a clean local Kiro window on 2026-10-10. The progressive-forecast update, VSIX 0.3.1, was installed, restarted and its policy v2/unavailable detail rendering verified locally on the same date. Eligible provisional/regular rendering is covered synthetically; live predictive accuracy remains unverified. Windows, Ubuntu and RHEL remain unverified.
