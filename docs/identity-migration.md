# Technical identity migration: EasyKiroGauge to Cyclegauge (design and review)

Status: implemented in a draft PR for review (merged into main; the Cost Advisor line integrates it as described below). Nothing is merged, tagged or published. Storage migration is **not** part of this change and needs its own security review and approval (security checkpoint SC1 stays open; Windows storage stays disabled).

## Decisions (approved in principle by the maintainer, 2026-10-11)

| Item | Before (v0.5.1) | After |
| --- | --- | --- |
| Display name | EasyKiroGauge | Cyclegauge for Kiro IDE |
| Package name | `easykirogauge` | `cyclegauge` |
| Publisher | `easykirogauge` | **unchanged, provisional**: no Open VSX namespace is chosen yet |
| Commands | `easykirogauge.*` | `cyclegauge.*`; the four v0.5.1 IDs stay as runtime aliases (`easykirogauge.showUsage` is the only kept alias) |
| Settings | `easykirogauge.sourceRoot`, `storageRoot`, `sourceTimezone` | `cyclegauge.*`; old keys still read as fallback |
| Webview panel type | `easykirogauge.usage` | `cyclegauge.usage` |
| Storage folder | `EasyKiroGauge` | **unchanged** |
| Data formats, billing, forecasts | | unchanged |

## What changes in code

- `src/extension/identity.ts` holds every identifier, the alias list, and the two helpers (`registerCommand`, `readSetting`). It has no `vscode` import and is unit tested (`tests/unit/identity.test.ts`).
- Commands: each command is registered as `cyclegauge.<name>`. Only the four commands that shipped in v0.5.1 (`showUsage`, `configureCostOptimizer`, `editCostScenario`, `clearCostInputs`) also get an `easykirogauge.<name>` alias, registered at runtime and **not** contributed in `package.json`, so the command palette shows one entry per command. Existing keybindings and tasks keep working. Commands added later never get an alias.
- Settings: both prefixes are declared in `contributes.configuration`; the legacy keys carry a `deprecationMessage`. Resolution order: `cyclegauge.*` if non-empty, else `easykirogauge.*` if non-empty, else the platform default. Values are read once at activation, as before.
- The status bar item, command titles, CLI help text and VSIX file name (`cyclegauge-0.5.1.vsix`) use the new name.

## Storage: deliberately untouched

The default storage folder remains `EasyKiroGauge` (macOS Application Support, Linux XDG data home; the Windows design candidate stays disabled). `usage.sqlite` and `device.key` must stay together, and renaming or moving the folder would orphan history and forecasts. Therefore:

- No automatic move, copy, rename or deletion. A unit test pins the three default paths to the legacy folder name.
- A future move, if ever wanted, is a separate proposal: copy-then-verify with owner-only permission checks, never deleting the old folder automatically, reviewed under the SC5-style account-bound storage review. Recommended default remains "keep the old folder".

## New extension ID = a different extension

Changing the package name (and later the publisher) produces a new extension ID. VS Code-compatible IDEs treat it as an unrelated extension:

- An installed EasyKiroGauge build does **not** update to Cyclegauge. A manual transition is required: install the Cyclegauge VSIX, then disable and uninstall EasyKiroGauge.
- Running both at once is not supported: both would read and write the same private storage folder (concurrent-writer behaviour is not verified) and both would show a status bar item.
- **Hard gate (implemented):** at activation Cyclegauge checks whether the legacy extension (`easykirogauge.easykirogauge`) is installed and enabled. If so it does **not** read settings, resolve the storage path, start the collector or open the store; it creates no webview. It shows a paused status bar item ("Cyclegauge: paused"), registers its contributed commands only as a notice, and shows one fixed warning. No alias is registered, so the legacy extension keeps its command IDs. Nothing is read or written until the user disables or uninstalls EasyKiroGauge and reloads the window. A disabled extension is not detected and therefore counts as removed.
- User settings under `easykirogauge.*` stay valid and keep working through the fallback.
- There is no automatic uninstall and no data import; the transition is manual and documented here. Because current builds are private/VSIX-only, doing this before the first marketplace beta keeps the impact small.

## Custom keybindings and the three Cost Optimizer commands

`configureCostOptimizer`, `editCostScenario` and `clearCostInputs` exist only in the v0.5.1 line. When the Cost Advisor (PR #3) replaces them, those three IDs are **removed, not redirected** to different functionality: drop them from `LEGACY_COMMAND_SUFFIXES` and the manifest. Only `easykirogauge.showUsage` stays as an alias. A user keybinding or task that still points to a removed ID will show VS Code's normal "command not found". Release notes for that version must say: replace those bindings with `cyclegauge.showUsage` / the new Cost Advisor command, or remove them.

## Packaging

The VSIX contains exactly `extension/package.json`, `extension/readme.md`, `extension/LICENSE.txt` (byte-identical to the repository `LICENSE`) and `extension/dist/extension.cjs`, `extension/assets/branding/cyclegauge-icon-256.png` (package `icon`) plus the two VSIX manifest files (7 entries). Check commands are in [development.md](development.md).

## Publisher / Open VSX namespace: open decision

`package.json` still says `publisher: easykirogauge` because `vsce` requires a value and no verified namespace exists. This is a provisional, unclaimed string; the resulting ID (`easykirogauge.cyclegauge`) is not final. Before the first marketplace beta the maintainer must claim a namespace, after which one `publisher` line and `LEGACY_EXTENSION_ID` stay as they are (it identifies the old build). Not selected here by design.

## Integration into the Cost Advisor / cross-platform line

After this change was merged into `main`, `main` was merged into `feature/cross-platform` (which contains the Cost Advisor from PR #3 and the savings estimates from PR #11; the dashboard redesign PR #4 is not part of that line yet). Resolution:

- `cyclegauge.costAdvisor` and `cyclegauge.showDiagnostics` are new identifiers with **no** legacy alias, because neither ever shipped under `easykirogauge.*`.
- The three v0.5.1 Cost Optimizer IDs (`configureCostOptimizer`, `editCostScenario`, `clearCostInputs`) are **removed, not redirected**. `LEGACY_COMMAND_SUFFIXES` is now only `showUsage`; a unit test pins that none of the three is contributed or aliased.
- Release tooling (`release:build`, `release:verify`, `release:smoke`) now expects the 7-entry package, including `LICENSE.txt` and the icon, and the `cyclegauge.*` identifiers.
- Settings keep `scope: machine` under both prefixes.

For users with custom keybindings or tasks on a removed ID, the release notes of the version that ships the Cost Advisor must say: replace the binding with `cyclegauge.costAdvisor`, or remove it; VS Code will report "command not found" otherwise.

The dashboard redesign (PR #4) and any later branch must add new commands as `cyclegauge.*` only and extend `src/extension/identity.ts` nowhere except the alias list.

## Verification

- `pnpm typecheck`, `pnpm test` (including `tests/unit/identity.test.ts`), `python3 tests/fixtures/kiro/validate.py`, `git diff --check`.
- `pnpm package:vsix` builds `cyclegauge-0.5.1.vsix` with the seven-entry allowlist (manifest, readme, `LICENSE.txt`, bundle, icon and the two VSIX manifest files).
- Unit tests cover settings precedence, command compatibility and aliases, the manifest identity, the legacy-extension gate and the VSIX allowlist.
- Not verified: behaviour inside a real Kiro IDE (side-by-side pause, alias registration, settings fallback). That needs a native check on a synthetic Kiro profile and is outside this cloud change.
