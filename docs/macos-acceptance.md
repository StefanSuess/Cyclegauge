# Native macOS acceptance for a release candidate

Native macOS acceptance checklist for a Cyclegauge release candidate.

Rules: isolated synthetic instance only (own `HOME`, user-data and extensions directories, synthetic source and storage). Never use your normal Kiro profile, logs or store, not even metadata. Do not sign in. Do not use Kiro's agent. No real billing numbers in notes or screenshots. This is a macOS observation; it verifies nothing for Windows, Ubuntu or RHEL.

## 0. Candidate

Download the `release-candidate` artifact of the CI run for the commit you intend to release and check it:

```sh
mkdir -m 700 ~/cg-rc && gh run download <RUN_ID> --repo StefanSuess/Cyclegauge -n release-candidate -D ~/cg-rc
shasum -a 256 ~/cg-rc/candidate.vsix   # must equal the SHA-256 in the run summary and SHA256SUMS.txt
```

Record: macOS version and architecture, Kiro version (About), SHA-256, run id. Stop on a mismatch.

## 1. Isolated instance

Run the exact [synthetic setup and CLI preflight in development.md](development.md#reproducible-synthetic-native-acceptance-setup), in the same shell. It defines `$D` and creates 36 invented daily account-response envelopes ending at the current UTC time. Do not use a static 2030 fixture or copy real logs. The preflight must print `SYNTHETIC_PREFLIGHT_PASS`.

Quit any previous isolated instance for that profile; this must print zero:

```sh
pgrep -f -- "--user-data-dir $D/user-data" | wc -l
HOME="$D/home" /Applications/Kiro.app/Contents/MacOS/Kiro --user-data-dir "$D/user-data" --extensions-dir "$D/extensions" --new-window "$D/workspace"
```

Do not sign in or use Kiro's agent. Install the exact candidate VSIX in this instance. Synthetic freshness is relative to setup time; create a new profile if more than 24 hours pass. The current-date setup spans UTC cycles, preserves counter resets, and uses explicit UTC settings and timestamp offsets.

## A. Fresh install (record pass / fail / blocked)

| # | Check | Expected |
|---|---|---|
| A1 | Extensions: Install from VSIX, pick `candidate.vsix` | Installs as **Cyclegauge for Kiro IDE**, ID `StefanSuess.cyclegauge`, flagged pre-release; icon shows |
| A2 | Reload window | Status bar item `Kiro: …` appears; no error toast |
| A3 | Click it | A tab "Your credit budget" opens; hero, metrics, usage bar, chart with accessible text; tooltip is short and contains no path |
| A4 | Command Palette, type "Cyclegauge" | Entries start with "Cyclegauge:"; no duplicates |
| A5 | Cost Advisor via Command Palette, lightbulb title action and panel-visible status item | All open the native questions; Clear my answers resets; cancelling changes nothing. No old Optimizer commands |
| A6 | Settings UI, search "cyclegauge" | Three settings, each shown as a user-level setting |
| A7 | Cmd+Q, relaunch | Extension activates again; history from the first run is still reflected |

## B. Settings hardening (new in 0.5.2)

| # | Check | Expected |
|---|---|---|
| B1 | Put `{ "cyclegauge.sourceRoot": "/tmp/cg-should-be-ignored", "cyclegauge.storageRoot": "/tmp/cg-should-be-ignored/store" }` into `$D/workspace/.vscode/settings.json`, reload | The values are ignored (VS Code reports the setting as unsupported in workspace); `/tmp/cg-should-be-ignored` is **not created**; the view still uses the user-level roots |
| B2 | Remove that workspace file | Nothing else changed |

## C. After publishing (installs the public listing, not a local file)

| # | Check | Expected |
|---|---|---|
| C1 | In a clean isolated profile, search "Cyclegauge" in the Extensions view | The listing is found, shows icon, description, README and Changelog tab, the pre-release marker and the "macOS beta" wording |
| C2 | Install from the listing | Same file as the candidate: the extension version equals the changelog entry; repeat A2 and A3 |
| C3 | Installed extension's contents (Developer: Show Running Extensions, or inspect the extensions directory) | No `src/`, tests or logs; metadata only |

## D. Themes, width, states

| # | Check | Expected |
|---|---|---|
| D1 | Light, dark and one High Contrast theme | Status, bar, chart and warnings readable |
| D2 | Narrow panel (about 400 px) | No horizontal scroll; chart legible |
| D3 | Collecting data, stale (24 h+), unavailable states | Each shows its own label and colour; nothing implies certainty it does not have |
| D4 | Keyboard and screen reader | Tab reaches the collapsible sections; heading is read first |

## E. Cost Advisor on this exact candidate (required before publication)

Use the exact current-date [development setup](development.md#reproducible-synthetic-native-acceptance-setup) and its preflight, not an unspecified generator. Run the candidate in a fresh profile. In the Advisor choose **Pro Max → Personal subscription (consumer) → No purchased add-on credits**. The 5000-credit reported limit, fresh pooled forecast and 20 invented credits/day exercise a modelled next-reset difference. Record the exact candidate SHA-256 and setup UTC anchor with E1–E6 results.

| # | Check | Expected |
|---|---|---|
| E1 | Advisor before answering, then explicit plan/billing/no-add-ons answers | Hint stays labelled unconfirmed until selected; explicit plan wins, even after a reported limit change |
| E2 | Low-usage synthetic paid plan with qualified forecast | Modelled pre-tax USD figure, UTC period and caveats; no supported/guaranteed savings claim; expandable 1/3/6-cycle and 75/100/125% details |
| E3 | Unknown plan, not-sure add-ons, entered add-ons, Enterprise, changed limit, stale/no forecast | Assumptions are explicit; unsupported inputs withhold figures, never become zero; no purchases or online calls |
| E4 | Cancel each question, clear answers, reload, account change/ambiguity | Cancellation preserves prior answers; clear/reload/account changes remove them; no answer file or values in diagnostics |
| E5 | Hide/reveal/dispose budget panel | Advisor status item appears only while visible; budget item remains; no duplicate commands/items after reload |
| E6 | Keyboard, narrow panel, light/dark/High Contrast | Advisor figures, uncertainty and details are readable and reachable; webview stays script-free and command-URI-free |

## F. Shut down and record

Cmd+Q, `pgrep` prints 0, nothing was written outside `$D` (and `/tmp` for B1 only if B1 failed). Record pass / fail / blocked per row, versions, SHA-256 and date in the release notes. A fail in A, B, D or E blocks publication. Section C is checked after publication; failures require a fixed higher version, never replacement of the published VSIX.
