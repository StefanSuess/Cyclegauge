# Changelog

All notable changes to Cyclegauge for Kiro IDE. Cyclegauge is an unofficial project. Versions with an odd minor number (0.5.x, 0.7.x) are beta (pre-release) builds; versions with an even minor number (1.0.x) are stable releases; see [versioning](docs/release-process.md#versioning).

## 1.0.0 (stable, macOS, Windows, Ubuntu)

The first stable release. Since 0.7.0 Cyclegauge has gone from counting credits to helping you keep them: it warns before your reported credits run out, values a projected overage in dollars next to the cost of the next larger plan, hints when a smaller plan would have been enough, finds files Kiro probably does not need (with their total size), reviews your Steering and Hooks for avoidable credit use, and adds an interactive dashboard with a cycle comparison, a results summary and a shareable cycle recap. On macOS it can also remind you when your latest session's context is nearly full and note when its model is listed above Auto's credit rate. A **Report a Problem** command turns a fixed-codes-and-counts diagnostics report into a ready GitHub issue. The versions 0.9.0, 0.11.0 and 0.13.0 that were once planned as betas were never published; everything in them is in this release. Collector, store, projection, billing, forecast and Cost Advisor algorithms and data formats are preserved.

**Upgrade from 0.7.x:** nothing is migrated away.

- **Storage.** The location is unchanged from 0.7.0 (the editor's per-extension storage folder, `User/globalStorage/stefansuess.cyclegauge`, or your `cyclegauge.storageRoot`) and so is the store version (1; the ordered migration list is still empty, so no migration runs). Your history and forecast coverage should carry over without changing any setting. A store written by a newer Cyclegauge is refused and never modified. Import evidence is now bounded to 10,000 rows (only old import-evidence rows are pruned, never snapshots or sources). A native upgrade test of this exact release is part of the acceptance round and is not recorded in these notes. If you come from 0.5.x or earlier, read the [upgrade guide](docs/usage.md#upgrading-from-05x) first.
- **Existing settings.** `cyclegauge.sourceRoot`, `cyclegauge.storageRoot` and `cyclegauge.sourceTimezone` are unchanged (machine scope, blank by default).
- **New settings, all user-level (a workspace cannot change them).** On by default: `cyclegauge.budgetWarnings` (on), `cyclegauge.budgetWarningPercent` (80, 0 turns only that notice off), `cyclegauge.supportPrompts` (on), `cyclegauge.auditReminderDays` (30, 0 = off) and `cyclegauge.sessionHints` (on, macOS only). Off by default: `cyclegauge.auditAutomatically` (`off`; `onOpen` or `onOpenAndChanges`) and `cyclegauge.configReviewAutomatically` (`off`; `onOpen` or `onOpenAndChanges`).
- **What you will notice after updating.** Budget notices, an occasional support prompt and (once, for a workspace that was never checked) an audit reminder can appear; on macOS session hints read Kiro's session metadata (see Privacy). New users get a one-time walkthrough; users who already had Cyclegauge state do not. The credit view now runs one bundled script (see Privacy).
- **New saved state** is small and lives in the editor's own storage: dates and flags for prompts, budget notices, the walkthrough and the automatic-review offer, per-workspace audit dates and salted hashes of items you hid, and the two summary and recap keys described below. Nothing contains paths, amounts or identifiers. **Cyclegauge: Reset Support Prompts and Summary** clears the prompt, summary and recap state.

### Added

**Budget, cost and plan**

- **Budget warnings** inside Kiro: a short notice when a fresh, regular forecast (not a provisional early estimate) reaches your reported credit limit before the reset, when usage reaches `cyclegauge.budgetWarningPercent` of it (default 80, 0 = off), or when the limit is reached. Each notice appears at most once per billing cycle and once per window, only the most severe when several are due, with **Show details** and **Turn off** buttons. `cyclegauge.budgetWarnings` (user level, default on) turns them off. The status bar item uses the error colour when the limit is reached or a regular forecast says it will be before the reset; this colour belongs to the gauge and does not depend on the setting. Accounts with unsupported extra credits get no budget notices, and the support prompt does not appear in a window that showed a budget notice. The only state kept is the cycle and the notices already shown, in editor global storage, written before a notice is shown.
- A **modelled overage cost** in the credit view and in the forecast and limit notices: projected credits over the reported limit at the observed pace (and credits already above it at the last update), valued at the per-credit price of the reviewed price list, rounded to whole cents, with the price and the price list's review date (and version in the credit view). Shown only with a valid price list; a modelled scenario, not an invoice, and whether overage applies depends on your plan and settings. Left out for accounts with unsupported extra credits.
- **Next larger plan beside a projected overage**: the credit view adds "For comparison: Pro+ costs $20 a month more than Pro and includes 1000 more credits (list prices, price list reviewed …)" after the projected-overage line, and the forecast and limit notices that carry an overage cost append a short form. Only the two list-price differences from the reviewed price list; no recommendation and no saving claim. Nothing for Power, an unknown plan, accounts with extra credits or an invalid price list; an inferred plan is prefixed "If you are on …".
- **Plan right-sizing hint**, read-only on top of the Cost Advisor's 1-month comparison. When a smaller plan would have served both the forecast and the last completed billing cycle, the credit view says so, and a lowest-priority budget notice mentions it once per cycle in the last 7 days before the reset ("You will likely leave about N credits unused this cycle, and the last cycle also fit within Pro …"). The smaller plan must cover the projected usage, so the unused part is at least the gap between the plans. "Fit" means the last cycle's observed usage plus an allowance for its last unobserved hours, taken from stored history only where it is fully backed (three observed cycles); nothing is shown otherwise. Modelled, not advice or an invoice; moving to Free is never suggested.

**Interactive dashboard**

- The credit view is now an interactive dashboard: usage chart with hover and keyboard tooltips and forecast scenarios, today's pace (the observed net change within the UTC day, with its start and elapsed time, never extrapolated), a comparison with the previous billing cycle (shown only where both cycles have evidence-backed starts, otherwise bracketing observations or "not comparable"), live updates, and the Cost Advisor as an inline form with the same result as the native pickers (answers are still never persisted).
- **Your Cyclegauge summary**: the exclusions you saved in the observed billing cycle (items, possible secrets, known bytes, shown as a lower bound when sizes are unknown) and an observed-use trend against the preceding period, built only from known facts. Gaps read "not observed" or "not comparable", never zero, and no "saved credits" are estimated.
- **Your Kiro cycle (cycle recap)**: when a new billing cycle is first observed and the previous one has an evidence-backed start and end, a dismissible card shows credits used, whether they lasted until the reset (yes only with below-limit usage seen in the last 6 hours before it, no only if usage at or above the limit was observed, otherwise unknown), the comparable trend, the exclusions you saved and the busiest observed UTC day, labelled as a partial observation. It is rendered locally with no identifiers, paths or workspace names; preview it, then **Save image…** (save dialog, guarded target) or **Copy text**. The Open VSX link on the card is left out when `cyclegauge.supportPrompts` is off.
- **Export CSV…** of your own accepted history, through the save dialog: allowlisted columns, exact decimals, `unknown` instead of zero, no free text. A fixed message replaces the export when several or unknown accounts are present.

**Workspace audit**

- **Cyclegauge: Audit Kiro Workspace** and the **Kiro Workspace Audit** view in the Explorer. Checks a trusted local workspace folder for files that could add cost or risk if Kiro reads them (secrets and credentials, databases and dumps, large archives, logs and data files, build output, dependencies and other large files) and whether the workspace ignore files already cover them. It runs when you start it, or automatically only if you opt in. It reads only file names and sizes plus the ignore files listed in Agent Ignore Files (`kiroAgent.agentIgnoreFiles`); it writes no files and sends nothing, and file contents are never read. Results that cannot be established are shown as unknown rather than guessed. The view opens with a summary ("N items Kiro may read", with "· M unclear" or "M items to review" when coverage could not be established, or "No risky files found", with the folder and when it was checked) and plain wording: each group has a short reason, each entry says "Kiro may read this" or "Unclear", and the size is in the tooltip. Each entry has **Exclude from Kiro** (prepares an unsaved `.kiroignore` change that you review and save; with auto-save on, the lines open in a separate tab), **Not a problem — hide** (hidden per workspace; only salted hashes are stored) and **Show in Explorer**; the view also offers Exclude all from Kiro and Copy .kiroignore lines, and notes when a `.kiroignore` exists but is not active because Agent Ignore Files does not list it.
- **Audit size total**: the view header shows the total size of the files Kiro may read but probably does not need (for example "about 240.3 MiB"), and the Workspace check card shows it after the count (for example "4 items Kiro may read (about 240.3 MiB)"), with "at least" when some sizes are unknown or the list is cut short. Nested files are not counted twice. It is an exposure figure, not a saving or a measurement.
- A **Workspace check** card in the credit view (item count and when it was last checked, no paths, no measured savings) with **Check now** and **Show** buttons, the **Cyclegauge: Show Workspace Audit** command, and an **Open Cost Advisor** button at the end of the Cost Advisor section. The credit view's command links are limited to five Cyclegauge commands (Cost Advisor, the two audit commands, Share and Report a Problem) through the webview's command allowlist, none with arguments.
- Audit reminders: a one-time prompt for a never-audited workspace and a reminder after `cyclegauge.auditReminderDays` (default 30, 0 = off). Opt-in `cyclegauge.auditAutomatically` (`off` by default; `onOpen` or `onOpenAndChanges`; the earlier `true` means `onOpen`) re-runs an audit that is at least one UTC day old silently when the workspace opens. `onOpenAndChanges` also watches the folder for new files matching the audit's own name patterns, re-checks a few seconds after they settle and shows at most one notice per window and UTC day, only when a new file is a secrets finding. Both are user-level settings only; per workspace only the last audit date, a snooze date and a do-not-remind flag are stored. Detection is by file name and size only. Findings are potential risks, not measured credit use; review suggestions before adding them, because ignoring files can hide them from Kiro.
- After a workspace has been checked, saving `.kiroignore` or a file named in Agent Ignore Files, or changing `kiroAgent.agentIgnoreFiles`, silently re-runs the check about a second later, so the audit view and the Workspace check card reflect the new rules.
- More audit name patterns: additional SSH and other private keys, keystores, password-manager databases, credential stores (`.netrc`, `.pgpass`, `.git-credentials`, `.htpasswd`, …), shell and database histories, Terraform state, VPN profiles and tool credential files (secrets); SQL Server and SQL dump files (databases); network captures and array/model data files (data); more build caches; `Pods`, `.yarn/cache`, `bower_components`, `jspm_packages`, `.terraform` and `.pnpm-store` (dependencies). `.ssh`, `.gnupg` and `.aws` folders are now listed as secrets instead of being skipped silently. Patterns are our own, informed by eth0izzle/shhgit (MIT), github-linguist/linguist (MIT) and github/gitignore (CC0); detection remains by name and size only.

**Steering and Hooks review**

- **Cyclegauge: Review Kiro Steering and Hooks** (`cyclegauge.reviewKiroConfig`), also in the Audit view, flags large always-included Steering files and broad, overlapping or agent-starting Hook triggers, with unsaved previews of narrower alternatives. It runs when you click it, never from the filename audit, and needs a trusted workspace. It reads only root `AGENTS.md` (size), `.kiro/steering/*.md` (the first few bytes, up to 2 KiB only when the file starts with front matter) and `.kiro/hooks/*.json` (parsed up to 64 KiB per file) in up to eight trusted local roots; it executes nothing, writes nothing and shows no credit estimates.
- **Automatic review (opt-in)**: the user setting `cyclegauge.configReviewAutomatically` (`off` by default, `onOpen`, `onOpenAndChanges`) runs the same review once per window shortly after a trusted workspace opens and, if chosen, after root `AGENTS.md`, `.kiro/steering/*.md` or `.kiro/hooks/*.json` change. Runs are debounced, at least 30 seconds apart and capped at 20 per window; the first run is silent and later runs show one fixed message only for a kind of finding not yet seen (at most three per window). After a manual review Cyclegauge may offer once to turn it on; the offer respects `cyclegauge.supportPrompts`, whose description mentions feature offers.

**Session hints (macOS only, on by default)**

- **Context reminder**: a non-modal notice when your most recent Kiro session in this workspace is about 70 % and again about 85 % full ("as of HH:MM"). The percentage is the latest value Kiro wrote for that session, a snapshot of the selected model's window, not Kiro's live meter. A threshold is armed again once the value falls 10 points below it (compaction, model switch). The thresholds are educated guesses, not evidence.
- **Model hint**: a notice when the session's model is listed by Kiro above Auto's credit rate ("Kiro lists it at about 1.3x the credits of Auto (Kiro model table, as of 2026-10-18); actual credits per task vary"). It uses a dated table inside the extension, and is silent for Auto, unknown models and models at or below 1.0x. The table covers the 22 models of Kiro's published table (as of 2026-10-18); GPT-5.6 notices say "from about" because Kiro bills a higher factor above 272K tokens, and the retired Claude Sonnet 4.0 stays silent. Only Claude Sonnet 4.5 (and two cheaper MiniMax models) were seen in real session files; other identifiers come from Kiro's documentation or its published names and may be wrong or out of date, in which case no hint appears.
- At most one notice per check, per session at most one in 30 minutes and three per run; only for sessions active after the window started and within about 10 minutes. The setting `cyclegauge.sessionHints` (user level, default on) and the notice's **Turn off** button switch it off.

**Getting started, community and support**

- A **Get started with Cyclegauge** walkthrough (command **Cyclegauge: Get Started**) that opens once for new users inside Kiro: your credits, the workspace check (which needs no history), budget warnings, the session hints and when the forecast appears (about 2 days and 3 updates provisional, 7 days and 8 updates regular). Uses the packaged icon only and one global-state flag, `cyclegauge.walkthrough.shown.v1`. Not yet verified in native Kiro; if the editor cannot open it, nothing happens.
- A quiet **footer** in the credit view with fixed links to rate Cyclegauge on Open VSX, star it on GitHub and support it on Ko-fi, a **Share** link that runs **Cyclegauge: Share Cyclegauge** (copies a fixed text with the Open VSX link) and a **Report a problem** link. Links open only on click; no tracking parameters.
- A **support prompt** inside Kiro, at most once per window: about a minute after saving an **Exclude from Kiro** edit (at least one UTC day after first use), after opening the credit view on three distinct UTC days, or after completing a Cost Advisor review. The fallback remains about three minutes after start, at least seven UTC days after first use with a forecast or finding seen. Cancelled reviews and clearing answers do not count. **Rate** or **Support** pause it for 120 days; **Later** or dismissing for 60 days. The message points users to Cyclegauge settings to turn off reminders. `cyclegauge.supportPrompts` (user level, default on) turns it off; **Cyclegauge: Reset Support Prompts** clears all saved dates and flags. Existing users who chose the retired **Don't ask again** remain opted out through the legacy flag, which reset still clears. Prompt state remains in editor global storage; an explicit isolated synthetic-demo override permits native timing tests.
- Outside Kiro (and without `cyclegauge.sourceRoot`), when no Kiro logs are found: a "Kiro not detected" status bar item and credit view message instead of "Collecting data", and a one-time note that Cyclegauge is built for Kiro.

**Diagnostics and robustness**

- **Report a problem**: the command **Cyclegauge: Report a Problem** (`cyclegauge.reportProblem`) builds the same fixed-codes-and-counts report as Copy Diagnostics, opens it in an unsaved document, copies it and then opens Cyclegauge's fixed GitHub bug-report form in the browser. Nothing is put in the address, nothing is sent by Cyclegauge and nothing new is persisted. It is also offered as a **Report a problem** button on Cyclegauge's own error notifications and as a footer link in the credit view.
- **Cyclegauge: Copy Diagnostics** and CLI `--diagnostics`: a short report of fixed codes, counts and platform metadata to review and paste into an issue. Diagnostics also show `session_hints` (the last check's fixed code), `session_hint_notices` (a count) and `session_hint_capped` (a count of workspace folders skipped because they hold more than 200 sessions).
- A clear "Kiro: update needed" status-bar message on runtimes without SQLite and for data written by a newer Cyclegauge, instead of a generic failure.

### Changed

- The store has an ordered schema migration path (initially empty, store version 1). A store written by a newer Cyclegauge is refused and never modified.
- Import evidence is bounded to 10,000 rows; unchanged codes refresh the latest row's time instead of adding rows. Pruning removes only old import-evidence rows, never snapshots or sources.
- The bundle loads SQLite lazily.
- The shared bounded file reader of the workspace audit was generalised (whole-file and tail modes); the audit's behaviour is unchanged.

### Privacy

- Everything runs locally: no telemetry, no sign-in and no network code. Kiro's files are only read, never changed. Feedback arrives only through the Report a Problem command, GitHub issues and Open VSX reviews.
- **Session hints** are macOS only, local extension host only (no remote, WSL or SSH window), and only in Kiro. When the setting is off, on another platform or in a remote window, no filesystem access happens at all. Cyclegauge parses up to 20 of the most recently changed sessions' `session.json` files (each whole, in memory, including titles and workspace paths) to find the newest session of your open folder, then loads up to the last 256 KiB of that session's `messages.jsonl` (which can contain prompts and replies) into memory. It keeps only that session's model identifier, context percentage and time, compares workspace paths only to find your open folder, and never stores, logs, shows or sends anything else. Nothing is written; Kiro's files are opened read-only. The root (`~/.kiro/sessions`) is fixed; if `~/.kiro` is a symlink, the feature stays silent.
- The **workspace audit** reads only file names and sizes and the ignore files listed in Agent Ignore Files; the **Steering and Hooks review** (manual or automatic) reads exactly the allowlist above and nothing else. Only your user setting can enable the automatic modes, never a workspace, and the watcher handler reads no file and keeps no path. Neither writes workspace files, and previews are unsaved documents. The automatic review's offer is recorded in one global-state key, `cyclegauge.configReview.offered.v1` (a boolean, no data, cleared by **Reset Support Prompts and Summary**).
- The credit view now runs **one bundled script** (nonce-based content security policy that blocks all network connections, validated message protocol) for the chart, the inline Advisor form, CSV export and recap actions. Its command links stay limited to five Cyclegauge commands and its three fixed web links open only when clicked.
- The summary and recap keep one key each in the editor's global state, not the workspace and not Settings Sync (`cyclegauge.results.v1`: at most the two most recent cycles with saved exclusions as counts and bytes; `cyclegauge.recap.v1`: the cycle and a shown or dismissed flag). Saving the recap image or exporting CSV writes only a file you choose, after the save dialog, never inside Cyclegauge's or Kiro's folders and never to a link or special file. Copy and save happen only when you click.

### Platform status

- macOS (Apple Silicon): the maintainer tests the exact 1.0.0 candidate in native Kiro before publication; earlier evidence is 0.7.0 synthetic-data testing in Kiro 1.2.56 and an earlier 0.9.0 candidate (audit, Copy Diagnostics, gauge) tested natively on macOS. macOS Intel is unverified.
- Windows 11 Pro and Ubuntu 26: earlier (0.7.0) smoke test of a development candidate in native Kiro by the maintainer (2026-10-14; Kiro versions not recorded). No itemised acceptance yet. The exact 1.0.0 candidate is smoke-tested on each platform before publication; results are recorded in [platform verification](docs/platform-verification.md) afterwards.
- RHEL is unverified. Session hints work on macOS only; on Windows and Ubuntu they do nothing.
- Not yet verified in native Kiro when these notes were written: the audit view wording, the Workspace check card, the Exclude and hide actions, reminders and the watcher, the footer links, Share, Report a Problem (including the error-notification button and opening the form), the support prompt, the walkthrough, budget warnings, the overage and plan comparisons, the dashboard and recap, the Steering and Hooks review, session hints and the update-needed message and migration path; the "Kiro not detected" note has not been verified in any non-Kiro editor. They are covered by synthetic tests and CI; the native acceptance checklist is in [docs/validation/1.0-acceptance.md](docs/validation/1.0-acceptance.md). The oldest Kiro version that works is not established; `engines.vscode` (`^1.90.0`) is an API claim, not a tested minimum.

### Unchanged

- Collector, projection, billing, forecast and Cost Advisor algorithms and data formats are preserved. Kiro's log format is undocumented and may change; figures are the last values Kiro logged with an as-of time, not a live balance.
- The history location is unchanged from 0.7.0, by design. Advisor answers are never persisted (SC5 open). SC1 (Windows storage protection) is implemented and stays open only for itemised native Windows acceptance.

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
