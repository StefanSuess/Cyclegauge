# Technical identity migration: EasyKiroGauge to Cyclegauge (design and review)

Status: implemented in a draft PR for review. Nothing is merged, tagged or published. Storage migration is **not** part of this change and needs its own security review and approval (security checkpoint SC1 stays open; Windows storage stays disabled).

## Decisions (approved in principle by the maintainer, 2026-10-11)

| Item | Before (v0.5.1) | After |
| --- | --- | --- |
| Display name | EasyKiroGauge | Cyclegauge for Kiro IDE |
| Package name | `easykirogauge` | `cyclegauge` |
| Publisher | `easykirogauge` | **unchanged, provisional**: no Open VSX namespace is chosen yet |
| Commands | `easykirogauge.*` | `cyclegauge.*`; the four v0.5.1 IDs stay as runtime aliases |
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
- Running both at once is unsupported: both would read and write the same private storage folder (concurrent-writer behaviour is not verified), and both would try to own the `easykirogauge.*` command IDs and show two status bar items.
- Mitigation implemented: at activation Cyclegauge checks whether the legacy extension (`easykirogauge.easykirogauge`) is installed. If so it skips the legacy aliases (avoids ID conflicts, and a failing alias never blocks the primary command) and shows one fixed warning asking the user to disable or uninstall it. It does not touch the other extension.
- User settings under `easykirogauge.*` stay valid and keep working through the fallback.
- There is no automatic uninstall and no data import; the transition is manual and documented here. Because current builds are private/VSIX-only, doing this before the first marketplace beta keeps the impact small.

## Publisher / Open VSX namespace: open decision

`package.json` still says `publisher: easykirogauge` because `vsce` requires a value and no verified namespace exists. This is a provisional, unclaimed string; the resulting ID (`easykirogauge.cyclegauge`) is not final. Before the first marketplace beta the maintainer must claim a namespace, after which one `publisher` line and `LEGACY_EXTENSION_ID` stay as they are (it identifies the old build). Not selected here by design.

## Where this change should land, and conflicts

Recommendation: merge the identity change into `main` first (it is based on `main` at v0.5.1 plus the public docs), then update the other lines by merging `main` into them. Rationale: it is small, touches mostly manifest/identifier lines, and the guard test fails loudly when a later branch adds an unmapped identifier. Landing it on the Cost Advisor line instead would tie a rename to an unmerged feature.

Open lines checked against `main` (all branched from the v0.5.1 baseline):

| Line | Overlap with this change | Resolution when `main` is merged in |
| --- | --- | --- |
| `feature/cross-platform` | `package.json` adds `showDiagnostics` command; `extension.ts` adds the diagnostics command, `EasyKiroGauge` strings in diagnostics messages and `labels.ts`; `paths.ts` is rewritten (three `EasyKiroGauge` folder names must stay) | rename `showDiagnostics` to `cyclegauge.showDiagnostics` (no alias, it never shipped), register it through `registerCommand`, rename the visible strings |
| Cost Advisor phase A (PR 3) | removes the three optimizer commands and menus, adds `easykirogauge.costAdvisor` and a second status bar item (`advisorItem`); same `extension.ts` regions | take `cyclegauge.costAdvisor` (no alias); remove the three suffixes from `LEGACY_COMMAND_SUFFIXES` only if the commands are really removed (the manifest test will say so); update the menu `when` clause |
| Dashboard redesign (PR 4, on PR 3) | same manifest and `extension.ts` lines as PR 3 | follows PR 3 |
| New Cost Advisor savings PR | not inspected in detail; expected to add or reuse `costAdvisor` | same rule: new commands use `cyclegauge.*` only |

Expected textual conflicts are limited to `package.json` command/menu blocks and the top of `extension.ts`; no algorithm or storage code is affected. Decision for the branches that remove the optimizer commands: whether removing already-shipped v0.5.1 command IDs needs an alias (for keybinding users) is a product call for PR 3, not for this change.

## Verification

- `pnpm typecheck`, `pnpm test` (including `tests/unit/identity.test.ts`), `python3 tests/fixtures/kiro/validate.py`, `git diff --check`.
- `pnpm package:vsix` builds `cyclegauge-0.5.1.vsix` with the same five-file allowlist.
- Not verified: behaviour inside a real Kiro IDE (side-by-side warning, alias registration, settings fallback). That needs a native check on a synthetic Kiro profile and is outside this cloud change.
