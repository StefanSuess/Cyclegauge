# Installing and using Cyclegauge for Kiro IDE

> Extension ID: `StefanSuess.cyclegauge`; commands and settings use the `cyclegauge.*` prefix.

## Install the published beta or build a development VSIX

The published beta is available on [Open VSX](https://open-vsx.org/extension/StefanSuess/cyclegauge) and under [GitHub Releases](https://github.com/StefanSuess/Cyclegauge/releases). To test unreleased changes, build a VSIX from a checkout (Node.js 24.13 or newer and pnpm):

```sh
pnpm install --frozen-lockfile
pnpm package:vsix
```

Then run **Extensions: Install from VSIX...** in Kiro and select the file in `dist/`. Reload the window if Kiro asks, then open **Cyclegauge: Show Account Credits** (command ID `cyclegauge.showUsage`) or click the status-bar item. This command only opens the local billing view.

Settings: `cyclegauge.sourceRoot`, `cyclegauge.storageRoot`, and `cyclegauge.sourceTimezone`. Blank settings use the platform's default IDE/app-owned locations and device timezone. `cyclegauge.sourceRoot` exists for testing and demos with synthetic logs; normal use leaves it blank. Offset-free historical log timestamps may be ambiguous if the device timezone changed. Stale or unavailable values are labeled. CLI and Crew session metering and add-on balance aggregation are not read.

## Upgrading from 0.5.x

<a id="upgrading-from-052-or-an-earlier-build"></a>

Starting with 0.7.0 the extension stores its history in the editor's per-extension storage folder (`User/globalStorage/stefansuess.cyclegauge` under the editor's data root; on macOS `~/Library/Application Support/Kiro/User/globalStorage/stefansuess.cyclegauge`). An upgrade with blank storage settings therefore starts with no prior history or historical forecast coverage. Existing directories are not moved, imported or deleted.

Earlier locations: Cyclegauge 0.5.2 used the `EasyKiroGauge` directory; 0.5.3 used the `Cyclegauge` directory (on macOS `~/Library/Application Support/EasyKiroGauge` and `~/Library/Application Support/Cyclegauge`).

To keep using that history, disable any earlier extension first, then set **user-level** `cyclegauge.storageRoot` to the directory you previously used before activating this build, using the full canonical path. A chosen location must be outside Kiro's data folder; use only an existing Cyclegauge-owned directory, never Kiro-owned storage. The CLI can select it with `--store-dir`. Do not run two builds against the same directory at once; side-by-side installation is not blocked.

Transfer any explicit `easykirogauge.sourceRoot`, `easykirogauge.storageRoot` and `easykirogauge.sourceTimezone` values to the corresponding `cyclegauge.*` user settings. The old keys are no longer read; blank current settings use the default source, storage and device timezone. Replace custom `easykirogauge.showUsage` shortcuts with `cyclegauge.showUsage`, then reload the window.

## Upgrading from 0.7.x

By design, the storage location and store version are unchanged from 0.7.0, so existing history and forecast coverage should carry over without changing settings. A native upgrade test has not been recorded.

## Workspace audit

Run **Cyclegauge: Audit Kiro Workspace** (command ID `cyclegauge.auditWorkspace`) from the command palette. It audits a trusted, local workspace folder (you choose one if several are open) and shows a report. It runs only when you invoke it, and a progress notification lets you cancel.

What it does: it walks the folder reading only file names and sizes, plus the ignore files listed in Agent Ignore Files (`kiroAgent.agentIgnoreFiles`). It never reads other file contents, and it writes no files and sends nothing (the clipboard is used only if you choose Copy suggestions). Global ignore files are not read.

Reading the report:

- Findings are grouped by kind (secrets and credentials, databases and dumps, archives, logs, large data files, build output, dependencies, other large files). They are potential risks, not measured credit use, and being in the workspace does not mean Kiro read the file.
- **Not covered** means no workspace ignore file excludes the path. **Unknown** means coverage could not be established (for example a scan limit was reached or the setting could not be read); unknown is never treated as covered or as safe.
- A **Partial** result lists the reason, such as a file-count or time limit. Scan limits are 50,000 entries, depth 24 and 10 seconds.
- Detection is by file name and size only. A clean result does not prove there are no secrets.
- The contents of folders such as `.git`, `.ssh`, `.aws` and `node_modules` are not scanned, and symbolic links are skipped.
- Only the first 200 findings are listed; the rest are counted.
- Some folders are refused: a filesystem root, your home folder or one containing it, folders overlapping Kiro data or Cyclegauge storage, folders inside `.kiro`, or inside `.git`, `.ssh`, `.aws`, `node_modules`-type or `kiro-cli` folders, symbolic links, and untrusted workspaces. Only local folders are offered.

Copy suggestions: after the audit, choose **Copy suggestions** in the notification to copy `.kiroignore` lines. Copy suggestions covers only the listed findings and includes Unknown ones, so review them before adding. "No safe suggestion" appears when a path has unsafe characters or a rule would also match other files. Add them to your `.kiroignore`. According to Kiro's documentation (not verified by Cyclegauge), for Kiro IDE to use that file `.kiroignore` must be listed in `kiroAgent.agentIgnoreFiles`; the report tells you when a `.kiroignore` exists but is not listed. Ignoring files can hide files Kiro needs, so add only what you want excluded.

The new 0.9.0 features (audit, diagnostics, update-needed message, migration path) have not been verified in native Kiro on any platform. Earlier (0.7.0) testing is described in the changelog.

## Diagnostics

Run **Cyclegauge: Copy Diagnostics** (`cyclegauge.copyDiagnostics`) to open the report in an unsaved document and copy it to the clipboard. The extension command writes no file. Alternatively run the CLI with `--diagnostics`: it first performs the normal import into Cyclegauge's own store and writes nothing else.

The report contains only fixed codes, counts and platform metadata: Cyclegauge, editor and editor version, Node and Electron versions, platform, architecture, SQLite availability, store state and version, whether storage, source and timezone are default or chosen, status and forecast tier, gauge state, whether the audit is available, counts of snapshots, accounts and unassociated snapshots, a collection result (CLI only), a freshness bracket, import codes and a discovered-log count. It contains no paths, identifiers, amounts or log content. Review it before pasting it into an issue.

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
| `--diagnostics` | Print the diagnostics report (fixed codes and counts); first performs the normal import into Cyclegauge's own store |
| `--json` | Local billing/quality query output without account, source or deduplication keys |

Default source candidates: macOS `~/Library/Application Support/Kiro`; Windows `%APPDATA%\Kiro`; Linux `${XDG_CONFIG_HOME:-~/.config}/Kiro`. Only `logs/<run>/<window>/exthost/kiro.kiroAgent/q-client.log` and numeric suffixes such as `q-client.log.1` are read. These suffixes are an explicitly supported synthetic rotation convention, not a verified Kiro rotation contract.

Default owned storage. **Extension:** the editor's own per-extension storage folder, `User/globalStorage/stefansuess.cyclegauge` beneath the editor's data root, like other extensions (on macOS `~/Library/Application Support/Kiro/User/globalStorage/stefansuess.cyclegauge`). **CLI** (no editor available): macOS `~/Library/Application Support/Cyclegauge`; Linux `${XDG_DATA_HOME:-~/.local/share}/Cyclegauge`; Windows `%LOCALAPPDATA%\Cyclegauge`. The two defaults differ, so pass `--store-dir` to query the extension's store from the CLI. On POSIX, storage must have owner-only access. A chosen location must be outside the source root. On Windows the defaults rely on the user profile's permissions only when the editor's data folder is inside the user profile (a portable install or a custom `--user-data-dir` on a shared drive is not protected), and a chosen location is verified (see [platform verification](platform-verification.md)). The source `logs/` folder, anything containing the source root, Git repositories, symlink paths and `kiro-cli`/`.kiro` directories are rejected as store locations. On macOS, use canonical paths when a path includes system aliases such as `/tmp` or `/var`.

The CLI prints observed usage, reported limit, remaining reported credits, reset UTC instant, as-of time, quality flags and fixed import diagnostic codes. A successful query exits 0 even when values are unavailable; configuration, storage or fatal collection failures exit 1 with a fixed code. JSON output follows the same policy.

## Troubleshooting

- **"Collecting data" for a long time.** The extension only reads usage that Kiro has already written to its logs. Wait for the next scan, which runs every minute and when log files change. A forecast additionally needs several observations over days; see [forecasting.md](forecasting.md).
- **"Unavailable".** The logs could not be read or have an unsupported format, the storage location is not safe (for example on Windows a chosen storage location that cannot be verified is refused, or a path containing a symlink), or several accounts were detected. No numbers are invented in these cases.
- **Settings changes do not apply.** `cyclegauge.sourceRoot`, `cyclegauge.storageRoot` and `cyclegauge.sourceTimezone` are read when the extension activates. Reload the window after changing them.
- **"Kiro: update needed".** The runtime has no SQLite support, or the stored data was written by a newer Cyclegauge. Update Kiro or Cyclegauge; stored data is never modified. **Cyclegauge: Copy Diagnostics** shows which case applies.
- **Node.js.** Node.js 24.13+ is required to build and for the CLI. The installed extension runs inside Kiro's own extension host; which Node features that host provides has only been observed on Kiro 1.2.56 (macOS), and no minimum Kiro version is established.
- **Remote or SSH workspaces.** Not verified. The extension is declared as a UI extension that reads local files.
- **Removing local data.** Delete the storage folder listed under "Default owned storage" above. Kiro's own files are never touched.
