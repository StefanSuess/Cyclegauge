# Platform verification

This development change is not a declaration of production support. A green unit matrix is not native Kiro acceptance. Published releases retain their own documented support boundary.

## What each layer proves

| Layer | Checks | Does not establish |
| --- | --- | --- |
| Unit/core integration (`pnpm test`) | Exact billing/forecast contracts, actual synthetic collector and owned SQLite, restart, transaction rollback, source mutation, account isolation, permission rejection | Electron runtime, native UI/watchers, actual Kiro log formats |
| Package/release (`pnpm test:release`) | VSIX allowlist, privacy diagnostics, bundled UI against a simulated API, promotion policy and protected publisher | Native editor behavior |
| VS Code host (`pnpm test:host candidate.vsix`) | Actual packaged JavaScript in a real extension host: the `logs/<timestamp>/window1/exthost` layout beneath the user-data root, activation, commands, webview tab, SQLite in the editor's default per-extension storage folder, external-source watcher before the minute timer, real minute polling, process restart/deduplication, source immutability and privacy sentinels | Native Kiro APIs/format discovery, visual layout, all Advisor interactions, minimum editor version |
| Native Kiro smoke (same harness with a local executable) | The same synthetic checks in that exact Kiro/OS/architecture/runtime | Real-account observations, real default discovery paths, other Kiro versions/OSes, full manual acceptance |

CI uses Windows x64 (`windows-2025`), Ubuntu x64 (`ubuntu-24.04`) and macOS ARM64 (`macos-latest`, currently ARM64 for public repositories). Host output records actual architecture and VS Code/Node/Electron versions. The host is pinned to VS Code 1.141.0; `@vscode/test-electron` is a locked development dependency. The pin is an integration target, **not** a tested minimum runtime.

The Ubuntu job builds **one universal VSIX**, verifies it and compares an independent rebuild's payload hashes. All host jobs download the same artifact, check its full SHA-256 and content allowlist, and load its unchanged extracted extension payload through `--extensionDevelopmentPath`. This tests shipped code but does not test the editor's VSIX installation UI. Test code/profile/fixtures are separate and never packaged. No per-platform native npm module is shipped; SQLite comes from the host's `node:sqlite`.

## Compatibility audit and boundaries

| Area | Implementation / remaining limitation |
| --- | --- |
| Source/storage roots | Native `node:path`. Source: macOS Application Support, Windows APPDATA, Linux XDG. Extension storage: the editor's per-extension storage folder from the extension API; CLI storage: Application Support, LOCALAPPDATA, XDG. Empty/relative environment roots fall back to home defaults. Explicit machine-scoped settings remain available. Actual Windows/Linux Kiro log layout still needs native evidence. |
| Windows storage | **Default locations (the editor's per-extension storage folder; `%LOCALAPPDATA%\Cyclegauge` for the CLI): not verified by Cyclegauge.** It relies on the user profile's own permissions (the user, SYSTEM and administrators), as desktop applications normally do, and needs no PowerShell. This holds only when the editor's data folder is inside the user profile; a portable install or a custom `--user-data-dir` on a shared drive is not protected by profile permissions. Symlink, junction, hard-link and location checks still apply. **A chosen `cyclegauge.storageRoot` or CLI `--store-dir`** may be shared, so it is verified as follows. Local fixed NTFS only. Windows PowerShell 5.1/.NET creates the directory with a protected owner-only, inheritable FullControl DACL. Existing directory, key, database and SQLite sidecars are checked for ownership and exactly one allow entry naming the current user. The directory must be owned by the user; a file may instead be owned by the process's default owner, because an elevated process's files belong to Administrators (observed on `windows-2025` CI). The DACL grants no other principal access, but administrators and SYSTEM can always take ownership, and a storage root under a parent that others can modify is not protected against replacement. Existing unsafe ACLs are rejected without repair. No ACL, SID or child-process error is printed. |
| Windows restrictions | Reject junctions/reparse points, symlinks, hard-linked sensitive files, non-NTFS volumes, UNC/device paths and unavailable/blocked PowerShell. No execution-policy bypass. Restricted enterprise environments may remain unavailable. Windows Server CI does not certify Windows 10/11, redirected homes, WSL or network storage. |
| POSIX permissions | Existing 0700 directory / 0600 key and database rules remain. Read-only source tests assert unchanged metadata and no new sidecars. The POSIX mode-bit test is inapplicable on Windows and is replaced there by dedicated DACL tests. |
| SQLite | Core tests use Node 24.13.0. Host tests use Electron's actual built-in SQLite, not the CI Node executable. Editors without `node:sqlite` still load the bundle: the gauge shows "update needed" (`RUNTIME_UNSUPPORTED`) and the workspace audit keeps working; `engines.vscode` expresses API compatibility, not a SQLite runtime guarantee. No fallback native SQLite dependency or Kiro-owned database reader is introduced. |
| Discovery/watchers | Existing bounded, allowlisted log discovery and stable read checks remain; unrelated filenames are ignored. Host test requires a change outside the workspace to import within 20 seconds, before polling can hide a broken watcher. The real 60-second timer is tested without further source writes. Rotation/truncation/same-size replacement stay in the core tests. |
| Case/symlinks/atomicity | Native containment comparisons preserve Windows case semantics; cross-drive overlap is rejected. Canonical source spelling is conservative; storage/source overlap is compared case-insensitively on Windows and macOS. Reparse paths remain unsupported. SQLite transactions provide owned-store atomicity; no homegrown rename scheme is added. Source checks detect ordinary mutation, not malicious same-user races. |
| Packaging/publishing | Universal JS-only candidate, same allowlist and reproducible payload check. All three verification and host jobs are required by promotion policy. `release.yml` remains manual-only with its protected environment, immutable artifact selection and post-approval main check. |

The two publisher-runtime archive tests require POSIX shell/tar behavior and still run on Ubuntu and macOS. They are explicitly inapplicable on Windows because the protected publisher runs on Ubuntu; all other release tests run on Windows too.

## Native Kiro automation

The [official VS Code test runner](https://github.com/microsoft/vscode-test) accepts a supplied executable. Kiro's public [installation documentation](https://kiro.dev/docs/getting-started/installation/) describes desktop packages for the target systems, but the investigated documentation does not establish a supported, pinned native IDE CI test interface. [Kiro CLI headless automation](https://github.com/kirodotdev/Kiro) is a different product surface and cannot validate this extension.

Run the harness with `CYCLEGAUGE_TEST_KIRO_EXECUTABLE` set to a local Kiro **GUI executable** and a verified candidate path:

```sh
pnpm test:host path/to/candidate.vsix
```

The harness creates a fresh synthetic source, storage, user-data and extensions directory, disables telemetry/updates and the Kiro agent extension, and uses basic password storage to avoid the OS credential store. It never authenticates, invokes an agent or opens the user's Kiro profile. It emits only fixed phase/status codes, versions/platform and candidate digest; native logs are discarded and temporary profiles removed. It runs the same payload twice to prove restart behavior. An installed signed Kiro app is needed; the harness does not download or modify Kiro.

Do not add a mandatory Kiro download job until all target binaries can be pinned and verified and unauthenticated isolated startup is reliable. Generic VS Code CI remains the low-cost repeatable gate. Native Kiro smoke and the existing manual [acceptance checklist](macos-acceptance.md) remain separate release evidence.

## Evidence and remaining gates

Observed on 2026-10-13, commit `1f88e48`, CI run 38436192620: all seven jobs passed. Unit and release suites ran on `windows-2025`, `ubuntu-24.04` and `macos-latest`; one candidate (SHA-256 `815de9eb…f0390`) passed the host test, including restart, on win32 x64, linux x64 and darwin arm64 under VS Code 1.141.0 / Electron 43.7.7 / Node 24.21.0. On Windows, the eleven DACL tests ran without skips on an elevated runner; a non-elevated Windows session has not been exercised. The first attempt of the macOS and Ubuntu host jobs failed while downloading VS Code (checksum mismatch, corrupt archive) and passed on rerun, so the editor download is a known source of spurious failures.

For a chosen storage location, Windows PowerShell is started for each storage check, which blocks the extension host briefly on every store open; environments that block it (Constrained Language Mode, AppLocker) stay unavailable and retry on each refresh.

Maintainer observation on 2026-10-14 (native Kiro installs, directory names only, Kiro and OS versions not recorded): the IDE user-data root is `%APPDATA%\Kiro` on Windows and `~/.config/Kiro` on Linux, matching the default source roots. Beneath it both show `logs/<timestamp>/window1/exthost/kiro.kiroAgent`, the same layout as macOS. That directory contains `q-client.log` on Linux and a `q-client` text document on Windows (Explorer hides the extension, so `.log` is assumed).

Maintainer-reported native test on 2026-10-14: the CI candidate from run 38445220723 (SHA-256 `fc93f899…8419`) was installed in native Kiro on Windows 11 Pro and on Ubuntu 26 and reported as working on both. The Kiro version and the individual checks were not recorded, so this is a smoke result, not the itemised acceptance used for macOS.

Pending: itemised native acceptance on Windows and Ubuntu with recorded Kiro versions, a non-default or portable Kiro data folder on Windows, macOS Intel native validation, and final release-candidate manual acceptance. SC1 (Windows storage protection) is implemented and stays open only for itemised native Windows acceptance (issue #61). Do not close SC1 or advertise all-platform production support merely because the DACL tests or generic host tests pass.

References: [VS Code integration CI](https://code.visualstudio.com/api/working-with-extensions/continuous-integration), [GitHub runner platforms](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), [.NET directory creation with security](https://learn.microsoft.com/en-us/dotnet/api/system.io.directory.createdirectory?view=netframework-4.8.1). Documentation investigated 2026-10-13.
