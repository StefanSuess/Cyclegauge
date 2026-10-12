# Installing and using Cyclegauge for Kiro IDE

> Technical identity: extension `cyclegauge`, commands and settings `cyclegauge.*`. Old `easykirogauge.*` settings still work as a deprecated fallback and the v0.5.1 command IDs remain aliases for now. The storage folder is still named `EasyKiroGauge`. Moving from an installed EasyKiroGauge build is a manual step, see [identity-migration.md](identity-migration.md).

## Install a VSIX (pre-release)

There is no marketplace listing yet. Build a VSIX from a checkout (Node.js 24.13 or newer and pnpm):

```sh
pnpm install --frozen-lockfile
pnpm package:vsix
```

Then run **Extensions: Install from VSIX...** in Kiro and select the file in `dist/`. Reload the window if Kiro asks, then open **Cyclegauge: Show Account Credits** (command ID `cyclegauge.showUsage`) or click the status-bar item. This command only opens the local billing view.

Settings: `cyclegauge.sourceRoot`, `cyclegauge.storageRoot`, and `cyclegauge.sourceTimezone` (the old `easykirogauge.*` keys are read when the new one is empty). Blank settings use the platform's default IDE/app-owned locations and device timezone. Offset-free historical log timestamps may be ambiguous if the device timezone changed. Stale or unavailable values are labeled. CLI and Crew session metering and add-on balance aggregation are not read.

## Requirements and command-line tool

Node.js **24.13 or newer**. Runtime uses built-in modules only; TypeScript and Node type definitions are development dependencies. Install development tools with `pnpm install --frozen-lockfile`.

Run from this checkout:

```sh
node --disable-warning=ExperimentalWarning src/cli.ts --source-timezone Europe/Berlin
node --disable-warning=ExperimentalWarning src/cli.ts --source-timezone Europe/Berlin --json
node --disable-warning=ExperimentalWarning src/cli.ts --help
```

Declare the timezone actually used by the source logs. Europe/Berlin is supported by the discovery observation, not a universal default. Offset-free timestamps without a declared IANA timezone are unavailable. DST overlaps and nonexistent wall times are rejected rather than guessed. Offset-aware timestamps preserve their spelling and normalize their instant to UTC.

Options:

| Option | Purpose |
| --- | --- |
| `--source-root <directory>` | Override the Kiro IDE data root, containing `logs/` |
| `--source-timezone <IANA>` | Interpret offset-free source timestamps |
| `--store-dir <directory>` | Dedicated private app-owned directory outside source roots and Git repositories |
| `--max-age-hours <hours>` | Observation freshness threshold, default 24; operational policy, not measured service latency |
| `--json` | Local billing/quality query output without account, source or deduplication keys |

Default source candidates: macOS `~/Library/Application Support/Kiro`; Windows `%APPDATA%\Kiro`; Linux `${XDG_CONFIG_HOME:-~/.config}/Kiro`. Only `logs/<run>/<window>/exthost/kiro.kiroAgent/q-client.log` and numeric suffixes such as `q-client.log.1` are read. These suffixes are an explicitly supported synthetic rotation convention, not a verified Kiro rotation contract.

Default owned storage: macOS `~/Library/Application Support/EasyKiroGauge`; Linux `${XDG_DATA_HOME:-~/.local/share}/EasyKiroGauge`. The design candidate for Windows is `%LOCALAPPDATA%\EasyKiroGauge`, but this implementation **fails closed on Windows** until owner-only ACL creation and validation are implemented and verified. Existing storage must have owner-only access. Source roots, Git repositories, symlink paths and Kiro storage directories are rejected as store locations. On macOS, use canonical paths when a path includes system aliases such as `/tmp` or `/var`.

The CLI prints observed usage, reported limit, remaining reported credits, reset UTC instant, as-of time, quality flags and fixed import diagnostic codes. A successful query exits 0 even when values are unavailable; configuration, storage or fatal collection failures exit 1 with a fixed code. JSON output follows the same policy.

## Troubleshooting

- **"Collecting data" for a long time.** The extension only reads usage that Kiro has already written to its logs. Wait for the next scan, which runs every minute and when log files change. A forecast additionally needs several observations over days; see [forecasting.md](forecasting.md).
- **"Unavailable".** The logs could not be read or have an unsupported format, the storage location is not safe (for example on Windows, where storage is intentionally disabled, or a path containing a symlink), or several accounts were detected. No numbers are invented in these cases.
- **Settings changes do not apply.** `cyclegauge.sourceRoot`, `cyclegauge.storageRoot` and `cyclegauge.sourceTimezone` are read when the extension activates. Reload the window after changing them.
- **Node.js.** Node.js 24.13+ is required to build and for the CLI. The installed extension runs inside Kiro's own extension host; which Node features that host provides has only been observed on Kiro 1.2.56 (macOS), and no minimum Kiro version is established.
- **Remote or SSH workspaces.** Not verified. The extension is declared as a UI extension that reads local files.
- **Removing local data.** Delete the storage folder (still named `EasyKiroGauge`) listed under "Default owned storage" above. Kiro's own files are never touched.
