# Technical identity migration: EasyKiroGauge to Cyclegauge (design and review)

Status: the identity migration and Cost Advisor shipped together in v0.5.2, the first public Cyclegauge beta under the new extension identity. This document preserves the original design and review record; it does not describe a pending migration. Storage migration is **not** part of this change and needs its own security review and approval (security checkpoint SC1 stays open; Windows storage stays disabled). The published v0.5.2 release is historical and immutable.

## Decisions (approved in principle by the maintainer, 2026-10-11)

| Item | Before (v0.5.1) | After |
| --- | --- | --- |
| Display name | EasyKiroGauge | Cyclegauge for Kiro IDE |
| Package name | `easykirogauge` | `cyclegauge` |
| Publisher | `easykirogauge` | `StefanSuess` (0.5.2); namespace exists; public verification remains false (2026-10-12) |
| Commands | `easykirogauge.*` | `cyclegauge.*`; only `easykirogauge.showUsage` stays aliased; old Optimizer IDs are removed |
| Settings | `easykirogauge.sourceRoot`, `storageRoot`, `sourceTimezone` | `cyclegauge.*`; old keys still read as fallback |
| Webview panel type | `easykirogauge.usage` | `cyclegauge.usage` |
| Storage folder | `EasyKiroGauge` | **unchanged** |
| Data formats, billing, forecasts | | unchanged |

## What changes in code

- `src/extension/identity.ts` holds every identifier, the alias list, and the two helpers (`registerCommand`, `readSetting`). It has no `vscode` import and is unit tested (`tests/unit/identity.test.ts`).
- Commands use `cyclegauge.*`. Only `easykirogauge.showUsage` remains as an alias. The three old Optimizer commands are removed under both prefixes; use `cyclegauge.costAdvisor` in new bindings. No legacy alias is added for the Advisor.
- Settings: both prefixes are declared in `contributes.configuration`; the legacy keys carry a `deprecationMessage`. Resolution order: `cyclegauge.*` if non-empty, else `easykirogauge.*` if non-empty, else the platform default. Values are read once at activation, as before.
- The status bar item, command titles, CLI help text and VSIX file name (`cyclegauge-<version>.vsix`) use the new name.

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
- There is no automatic uninstall and no data import; the transition is manual and documented here. Version 0.5.2 shipped this identity change as the first public Cyclegauge beta.

## Custom keybindings and the three Cost Optimizer commands

`configureCostOptimizer`, `editCostScenario` and `clearCostInputs` exist only in the v0.5.1 line. The Cost Advisor in 0.5.2 replaces them. Those three IDs are **removed, not redirected** to different functionality, from `LEGACY_COMMAND_SUFFIXES` and the manifest. Only `easykirogauge.showUsage` stays as an alias. A user keybinding or task that still points to a removed ID will show VS Code's normal "command not found". Release notes for that version must say: replace those bindings with `cyclegauge.showUsage` / the new Cost Advisor command, or remove them.

## Packaging

The VSIX contains exactly `extension/package.json`, `extension/readme.md`, `extension/LICENSE.txt` (byte-identical to the repository `LICENSE`), `extension/changelog.md` and `extension/dist/extension.cjs`, `extension/assets/branding/cyclegauge-icon-256.png` (package `icon`) plus the two VSIX manifest files (8 entries). Check commands are in [development.md](development.md).

## Publisher / Open VSX namespace

From 0.5.2 `package.json` says `publisher: StefanSuess`, so the published extension ID is `StefanSuess.cyclegauge` (maintainer decision, 2026-10-11). The [public namespace API](https://open-vsx.org/api/StefanSuess) reports that the namespace exists and is unverified (2026-10-12). This does not establish the maintainer's current publishing permission. Namespace verification remains pending, and do not assume Open VSX Trusted Publishing is configured until the namespace is verified and the GitHub publisher is registered. `LEGACY_EXTENSION_ID` (`easykirogauge.easykirogauge`) stays as it is: it identifies the old build for the side-by-side gate, and tests pin that it differs from the published ID.

## Historical identity integration planning and conflicts

The following is historical planning, not current release instructions. The identity migration and PR #17 Cost Advisor changes shipped in v0.5.2. Platform/storage work remains separate.

The original recommendation was to merge the identity change into `main` first (then at v0.5.1 plus the public docs) and update other lines by merging `main` into them. This was considered a small manifest and identifier change, and the guard test was expected to flag later unmapped identifiers. The recommendation is historical; identity migration and PR #17 shipped in v0.5.2.

Open lines checked against `main` (all branched from the v0.5.1 baseline):

| Line | Overlap with this change | Resolution when `main` is merged in |
| --- | --- | --- |
| `feature/cross-platform` | `package.json` adds `showDiagnostics` command; `extension.ts` adds the diagnostics command, `EasyKiroGauge` strings in diagnostics messages and `labels.ts`; `paths.ts` is rewritten (three `EasyKiroGauge` folder names must stay) | rename `showDiagnostics` to `cyclegauge.showDiagnostics` (no alias, it never shipped), register it through `registerCommand`, rename the visible strings |
| Cost Advisor phase A (PR 3) | removes the three optimizer commands and menus, adds `easykirogauge.costAdvisor` and a second status bar item (`advisorItem`); same `extension.ts` regions | take `cyclegauge.costAdvisor` (no alias); remove the three suffixes from `LEGACY_COMMAND_SUFFIXES` only if the commands are really removed (the manifest test will say so); update the menu `when` clause |
| Dashboard redesign (PR 4, on PR 3) | same manifest and `extension.ts` lines as PR 3 | follows PR 3 |
| New Cost Advisor savings PR | not inspected in detail; expected to add or reuse `costAdvisor` | same rule: new commands use `cyclegauge.*` only |

Expected textual conflicts are limited to `package.json` command/menu blocks and the top of `extension.ts`; no algorithm or storage code is affected. The 0.5.2 decision is settled: remove the three Optimizer IDs under both prefixes; only `easykirogauge.showUsage` remains aliased.

## Verification

- `pnpm typecheck`, `pnpm test` (including `tests/unit/identity.test.ts`), `python3 tests/fixtures/kiro/validate.py`, `git diff --check`.
- `pnpm package:vsix` builds `cyclegauge-<version>.vsix` with the eight-entry allowlist (manifest, readme, `LICENSE.txt`, `changelog.md`, bundle, icon and the two VSIX manifest files).
- Unit tests cover settings precedence, command compatibility and aliases, the manifest identity, the legacy-extension gate and the VSIX allowlist.
- Not verified: behaviour inside a real Kiro IDE (side-by-side pause, alias registration, settings fallback). That needs a native check on a synthetic Kiro profile and is outside this cloud change.
