# Installing and using Cyclegauge for Kiro IDE

> Extension ID: `StefanSuess.cyclegauge`; commands and settings use the `cyclegauge.*` prefix.

## Install the published beta or build a development VSIX

The published macOS beta is available on [Open VSX](https://open-vsx.org/extension/StefanSuess/cyclegauge) and as the [v0.5.2 GitHub pre-release](https://github.com/StefanSuess/Cyclegauge/releases/tag/v0.5.2). The repository currently contains the unreleased 0.5.3 development version. To test that version, build a VSIX from a checkout (Node.js 24.13 or newer and pnpm):

```sh
pnpm install --frozen-lockfile
pnpm package:vsix
```

Then run **Extensions: Install from VSIX...** in Kiro and select the file in `dist/`. Reload the window if Kiro asks, then open **Cyclegauge: Show Account Credits** (command ID `cyclegauge.showUsage`) or click the status-bar item. This command only opens the local billing view.

Settings: `cyclegauge.sourceRoot`, `cyclegauge.storageRoot`, and `cyclegauge.sourceTimezone`. Blank settings use the platform's default IDE/app-owned locations and device timezone. `cyclegauge.sourceRoot` exists for testing and demos with synthetic logs; normal use leaves it blank. Offset-free historical log timestamps may be ambiguous if the device timezone changed. Stale or unavailable values are labeled. CLI and Crew session metering and add-on balance aggregation are not read.

## Upgrading from 0.5.2 or an earlier build

Pre-release note: from this development version the extension stores its history in the editor's per-extension storage folder. History in the earlier `Cyclegauge` application-data directory is not moved; set `cyclegauge.storageRoot` to that directory to keep using it.

Cyclegauge 0.5.2 itself stores history in the previous `EasyKiroGauge` directory. The extension now defaults to the editor's per-extension storage folder (`User/globalStorage/stefansuess.cyclegauge` under the editor's data root; on macOS `~/Library/Application Support/Kiro/User/globalStorage/stefansuess.cyclegauge`), so an upgrade with blank storage settings starts with no prior history or historical forecast coverage. Existing directories are not moved, imported or deleted automatically.

To keep using your history, disable any earlier extension first, then set **user-level** `cyclegauge.storageRoot` to the directory you previously used before activating this build. On macOS the previous default is `~/Library/Application Support/EasyKiroGauge`; use the full canonical path in the setting. Use only the existing Cyclegauge-owned directory, never Kiro-owned storage. The CLI can select it with `--store-dir`. Do not run two builds against the same directory at once; this build no longer blocks a side-by-side installation.

Transfer any explicit `easykirogauge.sourceRoot`, `easykirogauge.storageRoot` and `easykirogauge.sourceTimezone` values to the corresponding `cyclegauge.*` user settings. The old keys are no longer read; blank current settings use the default source, storage and device timezone. Replace custom `easykirogauge.showUsage` shortcuts with `cyclegauge.showUsage`, then reload the window.

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
| `--store-dir <directory>` | Dedicated private app-owned directory outside the source `logs/` and Git repositories |
| `--max-age-hours <hours>` | Observation freshness threshold, default 24; operational policy, not measured service latency |
| `--json` | Local billing/quality query output without account, source or deduplication keys |

Default source candidates: macOS `~/Library/Application Support/Kiro`; Windows `%APPDATA%\Kiro`; Linux `${XDG_CONFIG_HOME:-~/.config}/Kiro`. Only `logs/<run>/<window>/exthost/kiro.kiroAgent/q-client.log` and numeric suffixes such as `q-client.log.1` are read. These suffixes are an explicitly supported synthetic rotation convention, not a verified Kiro rotation contract.

Default owned storage. **Extension:** the editor's own per-extension storage folder, `User/globalStorage/stefansuess.cyclegauge` beneath the editor's data root, like other extensions (on macOS `~/Library/Application Support/Kiro/User/globalStorage/stefansuess.cyclegauge`). **CLI** (no editor available): macOS `~/Library/Application Support/Cyclegauge`; Linux `${XDG_DATA_HOME:-~/.local/share}/Cyclegauge`; Windows `%LOCALAPPDATA%\Cyclegauge`. The two defaults differ, so pass `--store-dir` to query the extension's store from the CLI. On POSIX, storage must have owner-only access. A chosen location must be outside the source root. On Windows the defaults rely on the user profile's permissions only when the editor's data folder is inside the user profile (a portable install or a custom `--user-data-dir` on a shared drive is not protected), and a chosen location is verified (see [platform verification](platform-verification.md)). The source `logs/` folder, anything containing the source root, Git repositories, symlink paths and `kiro-cli`/`.kiro` directories are rejected as store locations. On macOS, use canonical paths when a path includes system aliases such as `/tmp` or `/var`.

The CLI prints observed usage, reported limit, remaining reported credits, reset UTC instant, as-of time, quality flags and fixed import diagnostic codes. A successful query exits 0 even when values are unavailable; configuration, storage or fatal collection failures exit 1 with a fixed code. JSON output follows the same policy.

## Troubleshooting

- **"Collecting data" for a long time.** The extension only reads usage that Kiro has already written to its logs. Wait for the next scan, which runs every minute and when log files change. A forecast additionally needs several observations over days; see [forecasting.md](forecasting.md).
- **"Unavailable".** The logs could not be read or have an unsupported format, the storage location is not safe (for example on Windows a chosen storage location that cannot be verified is refused, or a path containing a symlink), or several accounts were detected. No numbers are invented in these cases.
- **Settings changes do not apply.** `cyclegauge.sourceRoot`, `cyclegauge.storageRoot` and `cyclegauge.sourceTimezone` are read when the extension activates. Reload the window after changing them.
- **Node.js.** Node.js 24.13+ is required to build and for the CLI. The installed extension runs inside Kiro's own extension host; which Node features that host provides has only been observed on Kiro 1.2.56 (macOS), and no minimum Kiro version is established.
- **Remote or SSH workspaces.** Not verified. The extension is declared as a UI extension that reads local files.
- **Removing local data.** Delete the storage folder listed under "Default owned storage" above. Kiro's own files are never touched.
