<img src="https://raw.githubusercontent.com/StefanSuess/Cyclegauge/HEAD/assets/branding/cyclegauge-icon-128.png" alt="Cyclegauge icon" width="96" height="96">

# Cyclegauge for Kiro IDE

**See your Kiro credits run out before they do, and spend fewer of them**

[![Kiro IDE](https://img.shields.io/badge/IDE-Kiro-blue)](https://github.com/StefanSuess/Cyclegauge#install)
[![macOS beta](https://img.shields.io/badge/macOS-beta-lightgrey)](https://github.com/StefanSuess/Cyclegauge#platform-support-and-limitations)
[![Ubuntu beta](https://img.shields.io/badge/Ubuntu-beta-lightgrey)](https://github.com/StefanSuess/Cyclegauge#platform-support-and-limitations)
[![Windows beta](https://img.shields.io/badge/Windows-beta-lightgrey)](https://github.com/StefanSuess/Cyclegauge#platform-support-and-limitations)

[![CI + coverage ≥80%](https://img.shields.io/github/actions/workflow/status/StefanSuess/Cyclegauge/ci.yml?branch=main&label=CI%20%2B%20coverage%20%E2%89%A580%25)](https://github.com/StefanSuess/Cyclegauge/actions/workflows/ci.yml?query=branch%3Amain)
[![CI VSIX attestations](https://img.shields.io/badge/CI%20VSIX-attestations-blue)](https://github.com/StefanSuess/Cyclegauge/attestations)

[![Open VSX version](https://img.shields.io/open-vsx/v/StefanSuess/cyclegauge)](https://open-vsx.org/extension/StefanSuess/cyclegauge)
![Development version 0.9.0 beta](https://img.shields.io/badge/development-0.9.0%20beta-orange)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](https://github.com/StefanSuess/Cyclegauge/blob/HEAD/LICENSE)

Cyclegauge adds a status-bar item and a dashboard to Kiro IDE. It warns you while you can still change something, and shows where credits and money could be saved:

- **Warns before credits run out.** A notice, at most one at a time and each kind once per billing cycle, when a regular forecast says the reported limit will be reached before the reset, at 80 % of it (adjustable), or when it is reached, so you can adjust early.
- **Shows the overage in dollars.** The projected overage is valued as modelled USD from a dated price list, next to the cost difference of the next larger plan. A modelled scenario, not an invoice; credits and money are always shown separately.
- **Hints at the right plan.** When a smaller plan would have covered both this forecast and your last completed cycle, it says so (a hint, not advice).
- **Finds files Kiro probably doesn't need.** The workspace audit lists secrets, dumps, build output and other large files that no ignore rule covers, with their total size, and prepares a `.kiroignore` you can copy or review and save yourself. It shows exposure, not measured credit savings.
- **Reviews Hooks and Steering.** One command (its own button in the Audit view, and run together with every manual workspace audit) flags large always-included Steering files and broad or agent-starting hooks, with one-click actions that prepare an unsaved edit in the file (load a Steering file only when needed, narrow its pattern, run a hook only manually or disable it) for you to review and save. Run it when you like, or turn on automatic checks when a workspace opens and when those files change.
- **Session hints (macOS; Windows and Linux enabled, not yet verified natively).** A reminder when your latest session's context is about 70 % or 85 % full, and a note when its model is listed above Auto's credit rate. On by default, one setting to turn off.
- **Interactive dashboard with a cycle recap.** Usage chart with forecast scenarios, pace against your daily budget and a recap of the cycle that just ended (when your history supports it) that you can copy as text or save as an image to a file you choose.

<!-- TODO(maintainer): add a short synthetic GIF of the warning, overage cost and workspace audit here (see docs/launch/demo-script.md). Synthetic data only. -->

Everything runs locally: no telemetry, no sign-in, Kiro's files are only read, never changed (details under Privacy).

<p align="center">
  <img src="https://raw.githubusercontent.com/StefanSuess/Cyclegauge/main/docs/media/dashboard.jpg" alt="Cyclegauge dashboard with synthetic data: 58.4 of 1000 reported credits used, 941.6 remaining, a November 1 reset, and a regular forecast. No personal account information is shown." width="900">
</p>

<details>
<summary>Cost Advisor and usage trajectory</summary>

<p align="center">
  <img src="https://raw.githubusercontent.com/StefanSuess/Cyclegauge/main/docs/media/cost-advisor.jpg" alt="Cost Advisor presents an unconfirmed Pro plan and a modelled USD 20 next-cycle estimate above the synthetic usage trajectory chart, which shows observed credits, the reported limit, expected usage scenarios, daily budget pace, and reset date." width="820">
</p>

The plan hint is unconfirmed and the estimate is conditional, modelled, and before tax. It is not a guaranteed saving or an invoice. Unknown purchase or billing rules are not filled in.

</details>

> Unofficial open-source project. Not affiliated with, endorsed by or sponsored by Amazon Web Services or Kiro. "Kiro" is a trademark of its owner.

## Features

- **Status bar at a glance:** your daily credit budget and forecast outlook (collecting data, provisional, on track, at risk, likely to exceed, stale or unavailable).
- **Detail view:** credits used, remaining reported capacity, daily budget, next reset and how fresh the data is.
- **Usage trajectory chart:** observed usage, the reported limit, the reset, and (when there is enough history) scenario lines. Unknown periods are hatched, never filled with zero. Accessible text and a data table accompany the chart.
- **Qualified forecasts:** a provisional estimate (at least 3 comparable snapshots over 48 hours) and a regular forecast (8 snapshots over 7 days), both needing fresh data without long gaps. They are labeled scenarios, not guarantees.
- **Cost Advisor:** automatic conditional plan comparisons from your forecast, with session-only answers. Numerical estimates show modelled pre-tax USD list-price differences for the next full billing cycle; 1/3/6-cycle details and hypothetical 75/100/125% usage sensitivity stay expandable. Plan hints are unconfirmed, and estimates are not guaranteed savings or invoices. Use **Cyclegauge: Open Cost Advisor** or the lightbulb status item while the detail view is open.
- **Session hints (macOS observed, Windows and Linux not yet verified natively; on by default):** a short notice when your most recent Kiro session in this workspace is about 70 % or 85 % full, or set to a model Kiro lists above Auto's credit rate. See Privacy for exactly what is read; the user setting `cyclegauge.sessionHints` turns it off.
- **Workspace audit:** the **Workspace Audit** view summarizes how many files in a trusted local folder Kiro may read but probably doesn't need (secrets, database dumps, build output and similar). Suggestions are grouped by what to do (**Exclude from Kiro**, **Load only when needed**, **Run only manually**, **Worth a look**); each group's button (**Exclude from Kiro…**, **Load only when needed…**, **Run only manually…**) shows the exact edit in the editor's change preview, then leaves it unsaved for you to review and save, **Hide this item** hides an item, a **Workspace check** card in the credit view shows the result without any paths, and an optional reminder (or opt-in automatic re-run) keeps it current. Findings are potential risks, not measured credit use.
- **Not Kiro?** In an editor other than Kiro, Cyclegauge shows "Kiro not detected" in the status bar and explains once that the credit view stays empty there (the workspace audit still works).
- **Diagnostics:** **Cyclegauge: Copy Diagnostics** or **Cyclegauge: Report a Problem** (or CLI `--diagnostics`) produces a short report of fixed codes and counts to review before pasting into an issue.
- **Command-line tool:** print the same figures in a terminal, optionally as JSON.

## Install

Cyclegauge is a **beta** for Kiro IDE on macOS, Windows and Ubuntu (extension ID `StefanSuess.cyclegauge`).

1. Install the published beta from the [Open VSX listing](https://open-vsx.org/extension/StefanSuess/cyclegauge), or download the VSIX from the [latest GitHub pre-release](https://github.com/StefanSuess/Cyclegauge/releases) and select **Extensions: Install from VSIX...** in Kiro.
2. Reload the window if Kiro asks.
3. Click the status-bar item, or run **Cyclegauge: Show Credit Budget**, to open the detail view.

It shows "Collecting data" until Kiro has written account usage to its logs and a few observations have been recorded. Your daily budget is available from the first fresh account update in the tooltip and the detail view. Settings, the CLI and troubleshooting notes are in the [usage guide](https://github.com/StefanSuess/Cyclegauge/blob/HEAD/docs/usage.md).

To build from source you need Node.js 24.13 or newer and [pnpm](https://pnpm.io): `pnpm install --frozen-lockfile && pnpm package:vsix`, then install the file from `dist/`.

**Test with invented usage:** after installing dependencies, run `pnpm demo:setup --open`. Follow the
[five-check synthetic demo guide](https://github.com/StefanSuess/Cyclegauge/blob/HEAD/docs/synthetic-demo.md).
Setup uses the same command across platforms.

**Upgrading from 0.5.x?** The default history directory changes and earlier compatibility settings are no longer read. Read the [upgrade guide](https://github.com/StefanSuess/Cyclegauge/blob/HEAD/docs/usage.md#upgrading-from-05x) before installing to retain access to existing history.

## Privacy

- **Read-only.** Kiro's files and databases are never modified. Cyclegauge does not run Kiro commands or call Kiro services.
- **Local only.** No telemetry and no network code. Derived numbers are kept in the extension's own private directory.
- **Minimal data.** Each complete log line is parsed briefly in memory, but only allowlisted billing fields are extracted and stored. Prompts, code, conversations, tool data and credentials are dropped after parsing and never stored or shown. Raw account identifiers are not stored; a device-local key is used to tell accounts apart.
- **Session hints (macOS observed, Windows and Linux not yet verified natively; on by default).** Cyclegauge parses up to 20 of the most recently changed sessions' `session.json` files (each whole, in memory, including titles and workspace paths) to find the newest session of your open folder, then loads up to the last 256 KiB of that session's conversation file into memory, which can contain prompts and replies. It keeps only that session's model identifier, context percentage and time, compares workspace paths only to find your open folder, and never stores, logs, shows or sends anything else. Local Kiro window only, fixed folder `~/.kiro/sessions`, files opened read-only, nothing written. Turn it off with the user setting `cyclegauge.sessionHints`; when off (or on other platforms or in a remote window) nothing is read. On Windows and Linux the folder and path format are unverified; if they differ, nothing is shown.
- **Workspace audit.** Runs when you start it, or automatically only if you turn that on in your user settings. It reads only file names and sizes and the ignore files listed in Agent Ignore Files, never other file contents or global ignore files (a manual audit also runs the Steering and Hooks review, which has its own bounded reads, see below). It writes no files and sends nothing: Exclude from Kiro prepares an unsaved change that you save yourself. Per workspace it stores only the last audit date, reminder state and salted hashes of items you hid. Review suggestions before saving them; excluding files can hide them from Kiro.
- **Separate Steering and Hook review (unreleased).** **Cyclegauge: Review Kiro Steering and Hooks** runs with every manual workspace audit (the Workspace Audit view's refresh button), from the Command Palette, or automatically only if you turn on the user setting `cyclegauge.configReviewAutomatically` (off by default; on open and, if chosen, when those files change). It checks up to eight trusted local roots with the audit's folder guards. It reads the first few bytes of each `.kiro/steering/*.md` file (up to 2 KiB only when it starts with front matter), parses `.kiro/hooks/*.json` up to 64 KiB per file, and reads only the size of root `AGENTS.md`. Escaped hook names appear only in sidebar labels; no Steering body, pattern, matcher, prompt or command text is kept or shown. Its **Review changes…** actions show the edit in the editor's change preview and only prepare an unsaved edit in the file for you to review and save; Cyclegauge writes nothing itself, and nothing is stored or sent. Results stay in memory and do not affect the credit dashboard or support prompts.
- **Cycle recap and exports.** The recap keeps only a cycle identifier and a shown/dismissed flag in the extension's own storage. Saving the recap image or exporting CSV writes only a file you choose, never inside Kiro's or Cyclegauge's storage; copy and save happen only when you click.
- **Credit view and dashboard.** The credit view runs one bundled, nonce'd script under a strict content security policy that blocks all network connections; it drives the chart, the inline Cost Advisor form, CSV export and recap actions, and the view still renders its figures without it. The detail view's only command links are five Cyclegauge commands (Cost Advisor, check workspace, show workspace audit, share, report a problem), none with arguments, plus three fixed web links in the footer (rate, star, support) that open only when you click them.

Details: [privacy and storage](https://github.com/StefanSuess/Cyclegauge/blob/HEAD/docs/privacy-and-storage.md). Never post real Kiro data in issues or pull requests.

## Release integrity

For future releases, CI attests the exact VSIX after its checks pass on `main`. Before publication, the release workflow verifies the VSIX bytes and their signed provenance against this repository, the CI workflow and the selected commit. [Inspect the CI VSIX attestations](https://github.com/StefanSuess/Cyclegauge/attestations). Earlier published versions predate this gate. An attestation establishes origin and integrity; it does not certify that an extension is free of malware or vulnerabilities. See the [release process](https://github.com/StefanSuess/Cyclegauge/blob/HEAD/docs/release-process.md).

## Platform support and limitations

| Platform | Status |
| --- | --- |
| macOS | Beta (Apple Silicon; Intel unverified); maintainer-reported synthetic-data testing (Kiro 1.2.56) |
| Ubuntu | Beta; a development candidate was smoke-tested in native Kiro (Ubuntu 26), no itemised acceptance yet |
| RHEL | Unverified, best effort; not an officially supported Kiro platform |
| Windows | Beta; a development candidate was smoke-tested in native Kiro (Windows 11 Pro), no itemised acceptance yet |

Cross-platform CI and the precise remaining gates are described in [platform verification](https://github.com/StefanSuess/Cyclegauge/blob/main/docs/platform-verification.md). One universal VSIX is retained; generic VS Code host tests do not establish native Kiro support.

Figures are the last values Kiro logged, shown with an as-of time. They are not a live balance. Kiro's log format is not a documented contract and may change. More in [platform support and limitations](https://github.com/StefanSuess/Cyclegauge/blob/HEAD/docs/platform-support.md).

## Documentation and project

- The Ubuntu [CI check](https://github.com/StefanSuess/Cyclegauge/actions/workflows/ci.yml) requires at least 80% line coverage among source modules loaded by synthetic unit tests; it does not measure unloaded modules or native Kiro behavior.
- [Documentation index](https://github.com/StefanSuess/Cyclegauge/blob/HEAD/docs/README.md): usage, calculations, forecasting, chart, privacy, architecture
- [Contributing](https://github.com/StefanSuess/Cyclegauge/blob/HEAD/CONTRIBUTING.md) and [security policy](https://github.com/StefanSuess/Cyclegauge/blob/HEAD/SECURITY.md)
- [Changelog](https://github.com/StefanSuess/Cyclegauge/blob/HEAD/CHANGELOG.md)
- [Roadmap](https://github.com/StefanSuess/Cyclegauge/blob/HEAD/ROADMAP.md) and [version history](https://github.com/StefanSuess/Cyclegauge/blob/HEAD/docs/version-history.md)

**Finding Cyclegauge useful?**

[Leave a review on Open VSX](https://open-vsx.org/extension/StefanSuess/cyclegauge) · [Star on GitHub](https://github.com/StefanSuess/Cyclegauge) · [Support development ☕](https://ko-fi.com/stefansuess)

Cyclegauge is free and open source, with no paid features. Support is entirely optional.

## License

[MIT](https://github.com/StefanSuess/Cyclegauge/blob/HEAD/LICENSE)
