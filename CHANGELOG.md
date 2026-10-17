# Changelog

All notable changes to Cyclegauge for Kiro IDE. Cyclegauge is an unofficial pre-release; versions with an odd minor number (0.5.x, 0.7.x, 0.9.x) are beta builds; see [versioning](docs/release-process.md#versioning).

## 0.9.0 (beta, macOS, Windows, Ubuntu)

Adds a workspace audit with a native view, Accept/Ignore actions and reminders, a diagnostics report, a clear "update needed" message on unsupported runtimes, and a storage migration path. Collector, store, projection, billing, forecast and Cost Advisor algorithms and data formats are preserved.

### Added

- **Cyclegauge: Audit Kiro Workspace** and the **Kiro Workspace Audit** view in the Explorer. Checks a trusted local workspace folder for files that could add cost or risk if Kiro reads them (secrets and credentials, databases and dumps, large archives, logs and data files, build output, dependencies and other large files) and whether the workspace ignore files already cover them. It runs when you start it, or automatically only if you opt in. It reads only file names and sizes plus the ignore files listed in Agent Ignore Files (`kiroAgent.agentIgnoreFiles`); it writes no files and sends nothing, and file contents are never read. Results that cannot be established are shown as unknown rather than guessed. The view opens with a summary ("N items Kiro may read", with "· M unclear" or "M items to review" when coverage could not be established, or "No risky files found", with the folder and when it was checked) and plain wording: each group has a short reason, each entry says "Kiro may read this" or "Unclear", and the size is in the tooltip. Each entry has **Exclude from Kiro** (prepares an unsaved `.kiroignore` change that you review and save; with auto-save on, the lines open in a separate tab), **Not a problem — hide** (hidden per workspace; only salted hashes are stored) and **Show in Explorer**; the view also offers Exclude all from Kiro and Copy .kiroignore lines, and notes when a `.kiroignore` exists but is not active because Agent Ignore Files does not list it.
- A **Workspace check** card in the credit view (item count and when it was last checked, no paths, no measured savings) with **Check now** and **Show** buttons, the **Cyclegauge: Show Workspace Audit** command, and an **Open Cost Advisor** button at the end of the Cost Advisor section. The buttons use the editor theme's button colours (Check now and Open Cost Advisor primary, Show secondary), and the credit figures stack in a single column in narrow panels. The view still runs no scripts; its command links are limited to four Cyclegauge commands (Cost Advisor, the two audit commands and Share) through the webview's command allowlist, none with arguments.
- Audit reminders: a one-time prompt for a never-audited workspace and a reminder after `cyclegauge.auditReminderDays` (default 30, 0 = off). Opt-in `cyclegauge.auditAutomatically` (default off) re-runs a due audit silently. Both are user-level settings only; per workspace only the last audit date, a snooze date and a do-not-remind flag are stored. Detection is by file name and size only. Findings are potential risks, not measured credit use; review suggestions before adding them, because ignoring files can hide them from Kiro.
- A quiet **footer** in the credit view with fixed links to rate Cyclegauge on Open VSX, star it on GitHub and support it on Ko-fi, and a **Share** link that runs **Cyclegauge: Share Cyclegauge** (copies a fixed text with the Open VSX link). Links open only on click; no tracking parameters.
- A **support prompt** inside Kiro, at most once per window: about a minute after saving an **Exclude from Kiro** edit (at least one UTC day after first use), after opening the credit view on three distinct UTC days, or after completing a Cost Advisor review. The fallback remains about three minutes after start, at least seven UTC days after first use with a forecast or finding seen. Cancelled reviews and clearing answers do not count. **Rate** or **Support** pause it for 120 days; **Later** or dismissing for 60 days. The three buttons are Rate, Support and Later; the message points users to Cyclegauge settings to turn off reminders. The user-level setting `cyclegauge.supportPrompts` (default on) turns it off; **Cyclegauge: Reset Support Prompts** clears all saved dates and flags. Existing users who chose the retired **Don't ask again** remain opted out through the legacy flag, which reset still clears. Prompt state remains in editor global storage; an explicit isolated synthetic-demo override permits native timing tests.
- Outside Kiro (and without `cyclegauge.sourceRoot`), when no Kiro logs are found: a "Kiro not detected" status bar item and credit view message instead of "Collecting data", and a one-time note that Cyclegauge is built for Kiro.
- After a workspace has been checked, saving `.kiroignore` or a file named in Agent Ignore Files, or changing `kiroAgent.agentIgnoreFiles`, silently re-runs the check about a second later, so the audit view and the Workspace check card reflect the new rules.
- **Cyclegauge: Copy Diagnostics** and CLI `--diagnostics`: a short report of fixed codes, counts and platform metadata to review and paste into an issue.
- A clear "Kiro: update needed" status-bar message on runtimes without SQLite and for data written by a newer Cyclegauge, instead of a generic failure.

### Changed

- The store has an ordered schema migration path. A store written by a newer Cyclegauge is refused and never modified.
- Import evidence is bounded to 10,000 rows; unchanged codes refresh the latest row's time instead of adding rows. Pruning removes only old import-evidence rows, never snapshots or sources.
- The bundle loads SQLite lazily.

### Platform status

- macOS: beta; earlier (0.7.0) maintainer synthetic-data testing in Kiro 1.2.56.
- Windows 11 Pro and Ubuntu 26: beta; earlier (0.7.0) smoke test in native Kiro by the maintainer (a development candidate, 2026-10-14; Kiro versions not recorded). No itemised acceptance yet.
- RHEL and macOS Intel are unverified.
- An earlier 0.9.0 candidate (audit report, Copy Diagnostics, gauge) was tested by the maintainer in native Kiro on macOS. The audit view, Accept/Ignore, reminders, the update-needed message and the migration path have not yet been verified in native Kiro, nor have the footer links, Share, the support prompt and (in any non-Kiro editor) the "Kiro not detected" note; no 0.9.0 testing on Windows or Ubuntu is recorded.

### Unchanged

- Collector, projection, billing, forecast and Cost Advisor algorithms and data formats are preserved.
- The history location is unchanged from 0.7.0, by design: the storage location and store version are unchanged, so history should carry over; a native upgrade test has not been recorded. Advisor answers are never persisted (SC5 open).

## 0.7.0 (beta, macOS, Windows, Ubuntu)

Cross-platform beta: Windows storage, a new default storage location, three-OS CI with real extension-host tests, and a portable synthetic demo. Collector, store, projection, billing, forecast and Cost Advisor algorithms and data formats are preserved.

**Upgrade note:** the extension's default storage location changed, so history and forecast coverage start fresh. To keep using earlier history, set `cyclegauge.storageRoot` to the directory your earlier version used: 0.5.3 used `Cyclegauge`, 0.5.2 used `EasyKiroGauge` (both under `~/Library/Application Support` on macOS). Nothing is moved or deleted. See the [upgrade guide](docs/usage.md#upgrading-from-05x).

### Added

- Windows storage: default locations rely on the user profile's permissions, and a chosen location gets a verified owner-only NTFS DACL (fails closed otherwise).
- CI on Windows x64, Ubuntu x64 and macOS ARM64, including one universal candidate VSIX run in a real VS Code extension host on each.
- A portable synthetic demo (`pnpm demo:setup`, see [the demo guide](docs/synthetic-demo.md)).
- Documented versioning scheme and agent orchestration rules.

### Changed

- The extension's default owned storage moves to the editor's per-extension storage folder (`User/globalStorage/stefansuess.cyclegauge` under the editor's data root); the CLI keeps the `Cyclegauge` application-data directory. Existing files are not moved, imported or deleted.
- `cyclegauge.sourceRoot` is documented as a testing and demo setting; normal use leaves it blank.

### Platform status

- macOS: beta, with maintainer synthetic-data testing in Kiro 1.2.56.
- Windows 11 Pro and Ubuntu 26: beta, smoke-tested in native Kiro by the maintainer (a development candidate, 2026-10-14; Kiro versions not recorded). No itemised acceptance yet.
- RHEL and macOS Intel are unverified.

### Unchanged

- Collector, projection, billing, forecast and Cost Advisor algorithms and data formats are preserved.
- Advisor answers are never persisted (SC5 open). SC1 (Windows storage protection) is implemented and stays open only for itemised native Windows acceptance.

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
