# Platform support and limitations

Bobert is an unofficial project. The table separates what has been observed from what has not.

| Platform | Status |
| --- | --- |
| macOS | **Stable release line (Apple Silicon; Intel unverified).** Verified target: synthetic tests, plus VSIX installation, activation, status bar and detail view observed in Kiro 1.2.56. |
| Ubuntu | **Smoke-tested (stable release line).** Automated tests in a real VS Code host on Ubuntu 24.04; the maintainer reported a development candidate working in native Kiro on Ubuntu 26 (2026-10-14). No itemised acceptance yet. See [platform verification](platform-verification.md). |
| RHEL | **Unverified, best effort.** Not an officially supported Kiro platform. |
| Windows | **Smoke-tested (stable release line).** Automated tests in a real VS Code host on Windows Server 2025; the maintainer reported a development candidate working in native Kiro on Windows 11 Pro (2026-10-14). No itemised acceptance yet. Default storage (the editor's per-extension folder) relies on the Windows user profile's permissions; a chosen storage location gets a verified owner-only NTFS DACL and fails closed otherwise. See [platform verification](platform-verification.md). |

macOS observations for one Kiro version do not verify any other platform or version.

## Known limitations

- Account figures come from Kiro's existing local logs. They are the last observed values with an as-of time, not a live balance. If Kiro has not written a recent response, the view shows stale or unavailable data instead of guessing.
- The credit limit Kiro reports is not verified as base-only or total capacity. Add-on balances, purchases and overages are not known to the extension: a modelled overage figure is shown (projected credits over the reported limit at the bundled per-credit price), but actual overage charges remain unknown to it.
- Consumption between observations is unknown, never assumed to be zero.
- One account at a time. Several account partitions, or logs without a supported identity, withhold the account view; there is no account selector.
- Kiro's log format is not a documented contract and may change. Unsupported formats produce an unavailable status.
- Kiro's own SQLite cache and CLI/Crew session metering are not read.
- The optional session hints (context reminder and model hint) read the newest IDE session's metadata on **macOS (observed), Windows and Linux (enabled 2026-10-18, not yet verified natively)**, in a local extension host; they are silent in remote windows and for CLI sessions, and on Windows and Linux whenever the session folder or path format differs from the macOS layout. The field semantics were observed on one macOS installation only (see the [data proof](wp11-13-data-proof.md)).
- Forecasts are qualified constant-rate scenarios, not guarantees or confidence intervals.

See [how-values-are-calculated.md](how-values-are-calculated.md), [forecasting.md](forecasting.md) and [privacy-and-storage.md](privacy-and-storage.md) for the details behind these points.
