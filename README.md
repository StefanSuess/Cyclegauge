<img src="https://raw.githubusercontent.com/StefanSuess/Cyclegauge/HEAD/assets/branding/cyclegauge-icon-128.png" alt="Cyclegauge icon" width="96" height="96">

# Cyclegauge for Kiro IDE

**Credit usage & forecasting for Kiro IDE**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](https://github.com/StefanSuess/Cyclegauge/blob/HEAD/LICENSE)
![Version 0.5.1 pre-release](https://img.shields.io/badge/version-0.5.1%20pre--release-orange)
![Verified on macOS](https://img.shields.io/badge/verified-macOS-lightgrey)

Know how many AI credits you've used, how many remain, and whether they'll last until your next reset.

Cyclegauge adds a status-bar item and a detail view to Kiro IDE. It reads the usage logs Kiro already writes on your machine, so there is nothing to sign in to and nothing is sent anywhere.

> Unofficial open-source project. Not affiliated with, endorsed by or sponsored by Amazon Web Services or Kiro. "Kiro" is a trademark of its owner.

## Features

- **Status bar at a glance:** your daily credit budget and forecast outlook (collecting data, provisional, on track, tight, over budget, stale or unavailable).
- **Detail view:** credits used, remaining reported capacity, daily budget, next reset and how fresh the data is.
- **Usage trajectory chart:** observed usage, the reported limit, the reset, and (when there is enough history) scenario lines. Unknown periods are hatched, never filled with zero. Accessible text and a data table accompany the chart.
- **Qualified forecasts:** a provisional estimate (at least 3 comparable snapshots over 48 hours) and a regular forecast (8 snapshots over 7 days), both needing fresh data without long gaps. They are labeled scenarios, not guarantees.
- **Cost Optimizer:** an optional, session-only comparison of plan and credit-pack costs from assumptions you enter.
- **Command-line tool:** print the same figures in a terminal, optionally as JSON.

## Quick start

Cyclegauge is pre-release and not yet on a marketplace. You need Kiro IDE, Node.js 24.13 or newer and [pnpm](https://pnpm.io) to build it.

```sh
git clone https://github.com/StefanSuess/Cyclegauge.git
cd Cyclegauge
pnpm install --frozen-lockfile
pnpm package:vsix
```

1. In Kiro, run **Extensions: Install from VSIX...** and select the file in `dist/`.
2. Reload the window if Kiro asks.
3. Click the status-bar item, or run **Cyclegauge: Show Account Credits**, to open the detail view.

It shows "Collecting data" until Kiro has written account usage to its logs and a few observations have been recorded. Settings, the CLI and troubleshooting notes are in the [usage guide](https://github.com/StefanSuess/Cyclegauge/blob/HEAD/docs/usage.md).

## Privacy

- **Read-only.** Kiro's files and databases are never modified, and Kiro is never started or called.
- **Local only.** No telemetry and no network code. Derived numbers are kept in the extension's own private directory.
- **Minimal data.** Each complete log line is parsed briefly in memory, but only allowlisted billing fields are extracted and stored. Prompts, code, conversations, tool data and credentials are dropped after parsing and never stored or shown. Raw account identifiers are not stored; a device-local key is used to tell accounts apart.
- **Script-free view.** The detail view runs no scripts.

Details: [privacy and storage](https://github.com/StefanSuess/Cyclegauge/blob/HEAD/docs/privacy-and-storage.md). Never post real Kiro data in issues or pull requests.

## Platform support and limitations

| Platform | Status |
| --- | --- |
| macOS | Verified (Kiro 1.2.56) |
| Ubuntu | Unverified |
| RHEL | Unverified, best effort; not an officially supported Kiro platform |
| Windows | Unverified; storage is deliberately disabled for now |

Figures are the last values Kiro logged, shown with an as-of time. They are not a live balance. Kiro's log format is not a documented contract and may change. More in [platform support and limitations](https://github.com/StefanSuess/Cyclegauge/blob/HEAD/docs/platform-support.md).

## Documentation and project

- [Documentation index](https://github.com/StefanSuess/Cyclegauge/blob/HEAD/docs/README.md): usage, calculations, forecasting, chart, privacy, architecture
- [Contributing](https://github.com/StefanSuess/Cyclegauge/blob/HEAD/CONTRIBUTING.md) and [security policy](https://github.com/StefanSuess/Cyclegauge/blob/HEAD/SECURITY.md)
- [Roadmap](https://github.com/StefanSuess/Cyclegauge/blob/HEAD/ROADMAP.md) and [version history](https://github.com/StefanSuess/Cyclegauge/blob/HEAD/docs/version-history.md)

## License

[MIT](https://github.com/StefanSuess/Cyclegauge/blob/HEAD/LICENSE)
