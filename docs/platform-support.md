# Platform support and limitations

Cyclegauge for Kiro IDE is an unofficial project. The table separates what has been observed from what has not.

| Platform | Status |
| --- | --- |
| macOS | Verified target: synthetic tests, plus VSIX installation, activation, status bar and detail view observed in Kiro 1.2.56. |
| Ubuntu | **Unverified.** The code has Linux default paths (`${XDG_CONFIG_HOME:-~/.config}/Kiro`, `${XDG_DATA_HOME:-~/.local/share}/Cyclegauge`), but no native verification has been done. |
| RHEL | **Unverified, best effort.** Not an officially supported Kiro platform. |
| Windows | **Unverified.** Owner-only NTFS storage is implemented and fails closed when it cannot be verified; no native Kiro verification has been done. See [platform verification](platform-verification.md). |

macOS observations for one Kiro version do not verify any other platform or version.

## Known limitations

- Account figures come from Kiro's existing local logs. They are the last observed values with an as-of time, not a live balance. If Kiro has not written a recent response, the view shows stale or unavailable data instead of guessing.
- The credit limit Kiro reports is not verified as base-only or total capacity. Add-on balances, purchases and overages are not known to the extension.
- Consumption between observations is unknown, never assumed to be zero.
- One account at a time. Several account partitions, or logs without a supported identity, withhold the account view; there is no account selector.
- Kiro's log format is not a documented contract and may change. Unsupported formats produce an unavailable status.
- Kiro's own SQLite cache and CLI/Crew session metering are not read.
- Forecasts are qualified constant-rate scenarios, not guarantees or confidence intervals.

See [how-values-are-calculated.md](how-values-are-calculated.md), [forecasting.md](forecasting.md) and [privacy-and-storage.md](privacy-and-storage.md) for the details behind these points.
