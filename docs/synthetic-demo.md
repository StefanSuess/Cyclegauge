# Test the plugin with invented usage

The same setup command is designed to run on **Windows, macOS and Linux**; it has been run on macOS only. It creates 36 invented daily observations and a fresh
isolated Kiro profile, workspace, extension directory and store. Your normal profile and real logs are not used.
On macOS, setup places the demo folder under `/tmp` when the usual `$TMPDIR` path would make Kiro's IPC socket exceed the 103-character Unix socket limit.

## Start

Install Node.js **24.13 or newer**, pnpm and Kiro IDE. From the project folder:

```sh
pnpm install --frozen-lockfile
pnpm demo:setup --open
```

Setup checks the synthetic data and VSIX contents, then opens a window titled **SYNTHETIC DEMO - not real usage**.
In **that window**, open the Command Palette (`Cmd+Shift+P` on macOS, `Ctrl+Shift+P` on Windows/Linux), choose
**Extensions: Install from VSIX...**, and select the printed **install-this.vsix** file. Reload if prompted.
Skip sign-in and importing settings; do not open real projects or use Kiro's agent in this window.

The default builds your current checkout. To test an existing VSIX without rebuilding it:

```sh
pnpm demo:setup --open --vsix "path/to/candidate.vsix"
```

If Kiro is installed in a custom location, add `--kiro "path/to/Kiro executable"` (the **IDE executable**, not
`kiro-cli`, a `.cmd` wrapper or the macOS `.app` directory). Setup tries common installation locations; those paths
are not a guarantee about every installer. You can also omit `--open` to prepare everything without launching Kiro. Add `--pace high` to invent about 200 credits/day instead of 20, so the budget warning and the overage projection appear (the 5000 limit is reached before the reset). Late in the month the invented usage can exceed the 5000 limit, which shows the over-limit state; this is expected.

## Five quick checks

| Check | Expected on macOS/Linux |
| --- | --- |
| Run **Cyclegauge: Show Credit Budget**; click the budget status bar item | Both open **Your credit budget**, with a usage chart |
| Compare with the numbers printed by setup | Limit **5000**, matching used/remaining credits, a fresh observation and next UTC-month reset |
| Read the forecast | **Regular** estimate; invented consumption is **20 credits/day** |
| Run **Cyclegauge: Open Cost Advisor**; select **Pro Max → Personal subscription (consumer) → No purchased add-on credits** | A conditional, modelled pre-tax USD comparison; expandable details, no guaranteed savings claim |
| Cancel an Advisor question, then **Clear my answers**, then **Developer: Reload Window** | Cancel preserves answers; clear/reload removes them; usage/history stays unchanged |

**Windows:** the same checks apply. The demo's chosen storage folder is verified with an owner-only permission
check, so setup needs Windows PowerShell and a local NTFS drive; where that is blocked, setup stops with
`STORAGE_UNAVAILABLE`.

Linux setup and UI results need to be checked on a Linux host; macOS results do not establish Linux compatibility.
Setup's automated checks exercise the collector in this checkout and verify the selected VSIX's content. The
checklist tests the installed plugin itself. A supplied VSIX may behave differently from the current source.

## Refresh and cleanup

Run setup again for a fresh demo; each run creates a new folder and observations go stale after 24 hours.
To reopen an existing demo, use the printed `node ".../open-demo.mjs"` command. For a custom installation, append
the IDE executable path to that command. Close the demo window, then delete **only the printed
`synthetic-cyclegauge-demo-*` folder** when finished. Do not delete your normal Kiro or Cyclegauge storage.

All data is invented. UTC timestamps preserve the cycle reset and provide pooled history even at the start of a
month. `synthetic-anchor.txt` records generation time. No derived statistics are inserted into the store. The
plugin/setup makes no authenticated Kiro requests; Kiro itself may run its own background services.

For formal release approval, also follow [macos-acceptance.md](macos-acceptance.md) and use the exact CI artifact.

Local check on 2026-10-13 (macOS, Node 26.11.1): current-checkout build and supplied-VSIX setup passed ingestion of
36 observations, repeat-import deduplication, regular forecast and content verification. The packaged Advisor test
also passed against a stub host. Native UI checks were not part of that run.
