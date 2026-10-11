# Native macOS acceptance for a release candidate

Replaces the old EasyKiroGauge 0.5.x GUI checklist (extension ID `easykirogauge.*`, command names "EasyKiroGauge: …", a single install, no migration). Cyclegauge is a **new extension**: an installed EasyKiroGauge does not upgrade, so migration and side-by-side behaviour are part of acceptance.

Rules: isolated synthetic instance only (own `HOME`, user-data and extensions directories, synthetic source and storage). Never use your normal Kiro profile, logs or store, not even metadata. Do not sign in. Do not use Kiro's agent. No real billing numbers in notes or screenshots. This is a macOS observation; it verifies nothing for Windows, Ubuntu or RHEL.

## 0. Candidate

Download the `release-candidate` artifact of the CI run for the commit you intend to release and check it:

```sh
mkdir -m 700 ~/cg-rc && gh run download <RUN_ID> --repo StefanSuess/Cyclegauge -n release-candidate -D ~/cg-rc
shasum -a 256 ~/cg-rc/candidate.vsix   # must equal the SHA-256 in the run summary and SHA256SUMS.txt
```

Record: macOS version and architecture, Kiro version (About), SHA-256, run id. Stop on a mismatch.

## 1. Isolated instance

```sh
D=$HOME/.cg-iso            # any new empty directory
mkdir -p $D/home $D/user-data/User $D/extensions $D/workspace $D/source
# point the instance at synthetic data only; the settings are machine-scoped, so they belong in user settings
cat > $D/user-data/User/settings.json <<EOF
{ "cyclegauge.sourceRoot": "$D/source", "cyclegauge.storageRoot": "$D/storage" }
EOF
```

Fill `$D/source` with the synthetic data generator or fixture described in `docs/development.md` (invented values only). Quit any other isolated instance first (`pgrep -f -- "--user-data-dir $D/user-data" | wc -l` prints 0). Launch with `HOME=$D/home /Applications/Kiro.app/Contents/MacOS/Kiro --user-data-dir $D/user-data --extensions-dir $D/extensions --new-window $D/workspace`.

## A. Fresh install (record pass / fail / blocked)

| # | Check | Expected |
|---|---|---|
| A1 | Extensions: Install from VSIX, pick `candidate.vsix` | Installs as **Cyclegauge for Kiro IDE**, ID `StefanSuess.cyclegauge`, flagged pre-release; icon shows |
| A2 | Reload window | Status bar item `Kiro: …` appears (not "paused"); no error toast |
| A3 | Click it | A tab "Your credit budget" opens; hero, metrics, usage bar, chart with accessible text; tooltip is short and contains no path |
| A4 | Command Palette, type "Cyclegauge" | Entries start with "Cyclegauge:"; no "EasyKiroGauge:" entries, no duplicates |
| A5 | Cost Advisor via Command Palette, lightbulb title action and panel-visible status item | All open the native questions; Clear my answers resets; cancelling changes nothing. No old Optimizer commands |
| A6 | Settings UI, search "cyclegauge" | Three settings, each shown as a user-level setting; the legacy `easykirogauge.*` keys show a deprecation message |
| A7 | Cmd+Q, relaunch | Extension activates again; history from the first run is still reflected |

## B. Settings hardening (new in 0.5.2)

| # | Check | Expected |
|---|---|---|
| B1 | Put `{ "cyclegauge.sourceRoot": "/tmp/cg-should-be-ignored", "cyclegauge.storageRoot": "/tmp/cg-should-be-ignored/store" }` into `$D/workspace/.vscode/settings.json`, reload | The values are ignored (VS Code reports the setting as unsupported in workspace); `/tmp/cg-should-be-ignored` is **not created**; the view still uses the user-level roots |
| B2 | Remove that workspace file | Nothing else changed |

## C. Coming from EasyKiroGauge (migration, not an upgrade)

Use a **separate** isolated profile with the legacy VSIX (`easykirogauge-0.5.1`, built from tag `v0.5.1`) installed first and synthetic data collected.

| # | Check | Expected |
|---|---|---|
| C1 | Install the candidate next to the legacy extension, reload | Status bar item "Cyclegauge: paused" plus one fixed warning; Cyclegauge creates no webview and writes nothing (storage directory unchanged: compare `ls -lR` before and after, metadata only) |
| C2 | Legacy extension still works (its status item and its `easykirogauge.showUsage`) | Unaffected; no command ID stolen |
| C3 | Disable the legacy extension, reload | Cyclegauge starts normally and **shows the history the legacy build had collected** (same `EasyKiroGauge` storage folder) |
| C4 | Old keys: set `easykirogauge.sourceRoot` in user settings, clear `cyclegauge.sourceRoot`, reload | Fallback works; the new key wins when both are set |
| C5 | Command Palette: run `easykirogauge.showUsage` through a keybinding or Run Command | Alias still opens the detail view |
| C6 | Uninstall the legacy extension | Storage folder and history untouched |

## D. After publishing (installs the public listing, not a local file)

| # | Check | Expected |
|---|---|---|
| D1 | In a clean isolated profile, search "Cyclegauge" in the Extensions view | The listing is found, shows icon, description, README and Changelog tab, the pre-release marker and the "macOS beta" wording |
| D2 | Install from the listing | Same file as the candidate: the extension version equals the changelog entry; repeat A2 and A3 |
| D3 | Installed extension's contents (Developer: Show Running Extensions, or inspect the extensions directory) | No `src/`, tests or logs; metadata only |

## E. Themes, width, states (carry-over of the visual checks)

| # | Check | Expected |
|---|---|---|
| E1 | Light, dark and one High Contrast theme | Status, bar, chart and warnings readable |
| E2 | Narrow panel (about 400 px) | No horizontal scroll; chart legible |
| E3 | Collecting data, stale (24 h+), unavailable states | Each shows its own label and colour; nothing implies certainty it does not have |
| E4 | Keyboard and screen reader | Tab reaches the collapsible sections; heading is read first |

## F. Cost Advisor on this exact candidate (required before publication)

Use only invented account responses as described in [development.md](development.md). The donor branch's demo and owner-run scripts are not included. Create several comparable observations over at least 48 hours, with a fresh last observation, matching reported limit and UTC reset; use synthetic Pro Max (5000 credits) with low usage to exercise a modelled next-reset comparison.

| # | Check | Expected |
|---|---|---|
| F1 | Advisor before answering, then explicit plan/billing/no-add-ons answers | Hint stays labelled unconfirmed until selected; explicit plan wins, even after a reported limit change |
| F2 | Low-usage synthetic paid plan with qualified forecast | Modelled pre-tax USD figure, UTC period and caveats; no supported/guaranteed savings claim; expandable 1/3/6-cycle and 75/100/125% details |
| F3 | Unknown plan, not-sure add-ons, entered add-ons, Enterprise, changed limit, stale/no forecast | Assumptions are explicit; unsupported inputs withhold figures, never become zero; no purchases or online calls |
| F4 | Cancel each question, clear answers, reload, account change/ambiguity | Cancellation preserves prior answers; clear/reload/account changes remove them; no answer file or values in diagnostics |
| F5 | Hide/reveal/dispose budget panel | Advisor status item appears only while visible; budget item remains; no duplicate commands/items after reload |
| F6 | Keyboard, narrow panel, light/dark/High Contrast | Advisor figures, uncertainty and details are readable and reachable; webview stays script-free and command-URI-free |

## G. Shut down and record

Cmd+Q, `pgrep` prints 0, nothing was written outside `$D` (and `/tmp` for B1 only if B1 failed). Record pass / fail / blocked per row, versions, SHA-256 and date in the release notes. A fail in A, B, C1 to C3, F or D blocks the release; E failures are fixed or documented as known issues by the maintainer.
