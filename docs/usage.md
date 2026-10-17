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

| Setting | Scope | Default | Purpose |
| --- | --- | --- | --- |
| `cyclegauge.sourceRoot` | machine | empty | Synthetic logs for tests and demos; empty reads Kiro's standard data folder |
| `cyclegauge.storageRoot` | machine | empty | Private Cyclegauge storage folder; empty uses the editor's per-extension storage |
| `cyclegauge.sourceTimezone` | machine | empty | IANA timezone for offset-free log timestamps; empty uses the device timezone |
| `cyclegauge.auditReminderDays` | user | 30 | Days between workspace audit reminders; 0 turns them off |
| `cyclegauge.auditAutomatically` | user | off | Run a due workspace audit silently |
| `cyclegauge.supportPrompts` | user | on | Occasionally ask whether you'd rate, star or support Cyclegauge; off stops it |

## Upgrading from 0.5.x

<a id="upgrading-from-052-or-an-earlier-build"></a>

Starting with 0.7.0 the extension stores its history in the editor's per-extension storage folder (`User/globalStorage/stefansuess.cyclegauge` under the editor's data root; on macOS `~/Library/Application Support/Kiro/User/globalStorage/stefansuess.cyclegauge`). An upgrade with blank storage settings therefore starts with no prior history or historical forecast coverage. Existing directories are not moved, imported or deleted.

Earlier locations: Cyclegauge 0.5.2 used the `EasyKiroGauge` directory; 0.5.3 used the `Cyclegauge` directory (on macOS `~/Library/Application Support/EasyKiroGauge` and `~/Library/Application Support/Cyclegauge`).

To keep using that history, disable any earlier extension first, then set **user-level** `cyclegauge.storageRoot` to the directory you previously used before activating this build, using the full canonical path. A chosen location must be outside Kiro's data folder; use only an existing Cyclegauge-owned directory, never Kiro-owned storage. The CLI can select it with `--store-dir`. Do not run two builds against the same directory at once; side-by-side installation is not blocked.

Transfer any explicit `easykirogauge.sourceRoot`, `easykirogauge.storageRoot` and `easykirogauge.sourceTimezone` values to the corresponding `cyclegauge.*` user settings. The old keys are no longer read; blank current settings use the default source, storage and device timezone. Replace custom `easykirogauge.showUsage` shortcuts with `cyclegauge.showUsage`, then reload the window.

## Upgrading from 0.7.x

By design, the storage location and store version are unchanged from 0.7.0, so existing history and forecast coverage should carry over without changing settings. A native upgrade test has not been recorded.

## Workspace audit

Run **Cyclegauge: Audit Kiro Workspace** (command ID `cyclegauge.auditWorkspace`) from the command palette, or use **Check workspace** in the **Kiro Workspace Audit** view in the Explorer, or the **Check now** button of the Workspace check card in the credit view. It audits a trusted, local workspace folder (you choose one if several are open), and a progress notification lets you cancel. Results appear in the **Kiro Workspace Audit** view. **Cyclegauge: Show Workspace Audit** (or the card's **Show** button) opens that view, and runs the check first if there is no result yet.

What it does: it walks the folder reading only file names and sizes, plus the ignore files listed in Agent Ignore Files (`kiroAgent.agentIgnoreFiles`). It never reads other file contents, writes no files and sends nothing. Global ignore files are not read.

Reading the results:

- The first line is a summary: **N items Kiro may read** (optionally followed by **· M unclear**; if none are known to be unexcluded but some are unclear, **M items to review**) with the folder and when it was checked ("just now", "5 min ago", "today", "yesterday", "N days ago"; this time is kept only in memory for the current window), or **No risky files found** when nothing was listed. Hover it for what the count means and which reasons applied.
- Findings are grouped by kind (secrets and credentials, databases and dumps, archives, logs, large data files, build output, dependencies, other large files), each with a short reason such as "may contain passwords or keys". They are potential risks, not measured credit use, and being in the workspace does not mean Kiro read the file. Excluding files Kiro does not need keeps its context smaller and can save credits; no saving is measured.
- Each entry says **Kiro may read this** (no ignore file in this folder excludes it; global ignore files were not checked) or **Unclear** (Cyclegauge could not establish whether it is excluded, for example because a scan limit was reached or the setting could not be read; unclear is never treated as excluded or as safe). The size is in the tooltip. After you exclude an entry it reads "rule prepared (unsaved)" until you save the change.
- A partial check says "partial check" in the summary and lists the reasons in its tooltip, such as a file-count or time limit. Scan limits are 50,000 entries, depth 24 and 10 seconds.
- Detection is by file name and size only. A clean result does not prove there are no secrets.
- The contents of folders such as `.git`, `.ssh`, `.aws` and `node_modules` are not scanned, and symbolic links are skipped.
- Only the first 200 findings are listed; the rest are counted.
- Some folders are refused: a filesystem root, your home folder or one containing it, folders overlapping Kiro data or Cyclegauge storage, folders inside `.kiro`, or inside `.git`, `.ssh`, `.aws`, `node_modules`-type or `kiro-cli` folders, symbolic links, and untrusted workspaces. Only local folders are offered.

Acting on findings (buttons on each entry, and at the top of the view):

- **Exclude from Kiro** prepares a root-anchored `.kiroignore` line as an **unsaved** change: it opens `.kiroignore` with the line added, or an unsaved new `.kiroignore` if there is none. Review it and save it yourself; Cyclegauge does not save it. If your editor saves files automatically (`files.autoSave`), the lines open in a separate new tab instead, for you to copy into `.kiroignore`. **Exclude all from Kiro** does the same for every listed item.
- **Not a problem — hide** hides an item for this workspace. Only salted hashes are stored in the editor's per-workspace storage, never paths. The entry **N hidden by you** (**Show again**) brings them back. This does not exclude the file from Kiro.
- **Show in Explorer** reveals the file or folder in the Explorer without opening it.
- **Copy .kiroignore lines** copies the lines to the clipboard instead.

Suggestions include unclear findings, so review them before saving. "No safe rule could be suggested" appears when a path has unsafe characters or a rule would also match other files. According to Kiro's documentation (not verified by Cyclegauge), for Kiro IDE to use `.kiroignore` it must be listed in `kiroAgent.agentIgnoreFiles`; the view shows ".kiroignore isn't active yet" when a `.kiroignore` exists but is not listed, and opens that setting when you select it. Only this folder's ignore files are checked, not global ones. Excluding files can hide files Kiro needs, so add only what you want excluded.

Reminders and automatic runs: about 30 seconds after Kiro starts, Cyclegauge checks once whether the open workspace (a single trusted local folder) is due. A workspace that was never audited gets one prompt; afterwards you are reminded after `cyclegauge.auditReminderDays` days (default 30, 0 turns reminders off), with **Run audit**, **Later** (7 days) and **Don't remind me**. If you turn on `cyclegauge.auditAutomatically` (default off), a due audit runs silently with the same limits and only notifies you when it finds something; a never-audited workspace still asks first. Both settings apply only from your user settings, so a repository cannot turn automatic runs on or reminders off. Per workspace only the last audit date, a snooze date and a do-not-remind flag are stored. **Cyclegauge: Reset workspace audit reminder** clears the snooze and the flag.

The credit view (**Show Account Credits**) has a small **Workspace check** card below the main figures: it shows the number of items and when the check ran (or an invitation to check with the last check date in UTC, or "This folder can't be checked. Run Check now to see why."), with **Check now** and, once checked, **Show**. It shows no folder name or path and claims no measured savings. A **Cost Advisor** button at the top of the view opens the same Cost Advisor as the editor-title button and the status bar item. The view still runs no scripts; its only command links are these four Cyclegauge commands (`cyclegauge.costAdvisor`, `cyclegauge.auditWorkspace`, `cyclegauge.audit.show`, `cyclegauge.share`), enabled through the webview's command allowlist, none with arguments. A quiet footer line also links to rating Cyclegauge on Open VSX, starring it on GitHub and supporting it on Ko-fi (fixed addresses, opened only when you click), plus **Share**, which copies a short fixed text with the Open VSX link to your clipboard.

The audit, Copy Diagnostics and the gauge of an earlier 0.9.0 candidate were tested by the maintainer in native Kiro on macOS; the audit view wording, the Workspace check card, the Exclude and hide actions, reminders, the footer links, Share and the support prompt have not yet been verified in native Kiro, the "Kiro not detected" note and status have not been verified in any non-Kiro editor, and no 0.9.0 testing on Windows or Ubuntu is recorded. Earlier (0.7.0) testing is described in the changelog.

## Support prompts

Besides the footer in the credit view, Cyclegauge may ask once per window, inside Kiro only, whether it is useful to you, with **Rate**, **Star on GitHub**, **Support ☕**, **Not now** and **Don't ask again**. It can appear about one minute after you save an **Exclude from Kiro** edit, once at least one UTC day has passed since first use. Opening **Show Account Credits** on three distinct UTC days or completing a Cost Advisor review can also trigger it earlier, without a seven-day wait. Opening or cancelling the Advisor, or clearing its answers, does not count. Otherwise, the fallback check is about three minutes after start, at least seven UTC days after first use and only after a forecast or audit finding was shown. A pending saved-exclusion prompt waits its full minute unless a separate medium signal qualifies. Rate, Star or Support pause it for 120 days; **Not now** or closing the message pauses it for 60 days; **Don't ask again** stops it. Turn it off at any time with the user setting `cyclegauge.supportPrompts` (a workspace cannot change it). **Cyclegauge: Reset Support Prompts** (command `cyclegauge.support.reset`, in the Command Palette) clears all saved support dates and flags, including the detail-view days and Advisor-used flag; it does not allow a second prompt in the same window. Prompt state is only dates (at most three detail-view days) and flags in the editor's global storage. Nothing is sent anywhere; a link opens only when you click it.

Maintainer native test (synthetic profile only): run `CYCLEGAUGE_SYNTHETIC_SUPPORT_TEST=1 pnpm demo:setup --open --vsix <candidate.vsix>` on macOS/Linux (PowerShell: `$env:CYCLEGAUGE_SYNTHETIC_SUPPORT_TEST='1'; pnpm demo:setup --open --vsix <candidate.vsix>`). The generated opener supplies a marker matching the demo source; the extension also requires the isolated demo home and global storage. Install the supplied candidate in that demo window, run **Reset Support Prompts**, create an invented `.env` in the demo workspace, run the audit, choose **Exclude from Kiro**, then save as `.kiroignore` in that workspace. The prompt should appear about a minute later. This opt-in only treats first use as yesterday; it preserves the setting, Kiro detection, snoozes, never flag and once-per-window limit. A reload is needed to test another prompt after one has appeared. Without the explicit flag, the demo uses ordinary timing. No native verification of this change is claimed.

In an editor that is not Kiro (and without `cyclegauge.sourceRoot`), when Cyclegauge finds no Kiro logs it shows "Kiro not detected" in the status bar, says the same in the credit view and explains once that it is built for Kiro. If Kiro is installed next to that editor and its logs are found, it works normally and shows no note. The workspace audit still works.

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
